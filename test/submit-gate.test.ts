import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Field } from "../src/fields.ts";
import type { Job, Planned } from "../src/planner.ts";

// The submit gate end to end: apply() on local fixture pages in a headless Chrome, auto mode.
// gate() isn't exported, so this goes through apply() with the model calls stubbed (readJob and
// plan), and everything else on temp dirs and a temp db.
// Each fixture counts its submit clicks on window.submits; openBrowser is wrapped to read the
// count just before apply closes the browser.
const dir = mkdtempSync(join(tmpdir(), "jh-gate-"));
process.env.JH_DB = join(dir, "jh.db");

const submits = vi.hoisted(() => new Map<string, number>());
vi.mock("../src/browser.ts", async (real) => {
  const m = await real<typeof import("../src/browser.ts")>();
  return {
    ...m,
    openBrowser: async (opts: Parameters<typeof m.openBrowser>[0]) => {
      const b = await m.openBrowser(opts);
      return {
        ...b,
        close: async () => {
          submits.set(basename(b.page.url()), Number(await b.page.evaluate("window.submits ?? 0").catch(() => -1)));
          await b.close();
        },
      };
    },
  };
});
vi.mock("../src/capture.ts", async (real) => ({ ...(await real<object>()), syncRun: () => {} }));

const ANSWERS: Record<string, string> = { "first name": "Jane", email: "jane@example.com", "why sideco": "The product.", "do you have a college degree": "Yes" };
vi.mock("../src/planner.ts", async (real) => ({
  ...(await real<object>()),
  readJob: async (url: string, text: string): Promise<Job> =>
    ({ url, company: basename(url, ".html"), title: "Backend Engineer", location: "Remote", description: text }),
  plan: async (fields: Field[]): Promise<Planned[]> => fields.map((field) => {
    const key = Object.keys(ANSWERS).find((k) => field.label.toLowerCase().startsWith(k));
    return { field, value: key ? ANSWERS[key]! : "", values: [], source: key ? "rule" : "skip", reusable: false, note: "" };
  }),
}));

const { apply, namedInErrors } = await import("../src/apply.ts");
const { setSetting } = await import("../src/settings.ts");

const run = (name: string, submit: "auto" | "dry" = "auto") => apply({
  url: `file://${resolve(import.meta.dirname, "fixtures", name)}`,
  resume: "resume", submit, fit: false, unattended: true, browser: { headless: true },
});

beforeAll(() => {
  // The second-opinion review is a model call; the gate is what's under test.
  setSetting("reviewAnswers", "off");
});

describe("submit gate retry", () => {
  it("judges a required error that flashes before the thank-you as submitted, after one click", async () => {
    const result = await run("submit-flash.html");
    expect(result).toMatchObject({ submitted: true, confirmed: true });
    expect(submits.get("submit-flash.html")).toBe(1);
  }, 60_000);

  it("never clicks Submit once the runner has stopped the run (timeout)", async () => {
    const stopped = new AbortController();
    stopped.abort();
    const result = await apply({
      url: `file://${resolve(import.meta.dirname, "fixtures", "submit-stopped.html")}`,
      resume: "resume", submit: "auto", fit: false, unattended: true, signal: stopped.signal, browser: { headless: true },
    }).catch((e: unknown) => ({ submitted: false, error: String(e) }));
    expect(result.submitted).toBe(false);
    expect(submits.get("submit-stopped.html") ?? 0).toBe(0);
  }, 60_000);

  it("retypes a wiped answer after 'Missing entry for required field' and clicks once more", async () => {
    const result = await run("submit-wiped.html");
    expect(result).toMatchObject({ submitted: true, confirmed: true });
    expect(submits.get("submit-wiped.html")).toBe(2);
  }, 60_000);

  it("fills answers the form dropped from its state (box still shows them) again, then submits once more", async () => {
    const result = await run("submit-lost.html");
    expect(result).toMatchObject({ submitted: true, confirmed: true });
    expect(submits.get("submit-lost.html")).toBe(2);
  }, 60_000);

  it("clicks the form's Submit, not the posting's Apply button above the form", async () => {
    const result = await run("submit-apply-above.html");
    expect(result).toMatchObject({ submitted: true, confirmed: true });
    expect(submits.get("submit-apply-above.html")).toBe(1);
  }, 60_000);

  it("judges persistent errors with a disabled button as not submitted, without clicking again", async () => {
    const result = await run("submit-stuck.html");
    expect(result).toMatchObject({ submitted: false, confirmed: false, note: expect.stringMatching(/didn't go through: Phone is required/) });
    expect(submits.get("submit-stuck.html")).toBe(1);
  }, 60_000);
});

describe("namedInErrors", () => {
  const answer = (label: string) => ({ field: { label } });
  it("finds the questions a submit error quotes, with or without the 'Missing entry' prefix", () => {
    const answers = ["Phone Number", "Email", "Do you regularly use AI tools?", "Pronouns"].map(answer);
    const errors = ["Your form needs corrections Missing entry for required field: Phone Number", "Do you regularly use AI tools?"];
    expect(namedInErrors(answers, errors).map((a) => a.field.label)).toEqual(["Phone Number", "Do you regularly use AI tools?"]);
  });
  it("ignores labels too short to quote reliably", () => {
    expect(namedInErrors([answer("Age")], ["Missing entry for required field: Page"])).toEqual([]);
  });
});

describe("closed postings", () => {
  it("skips a posting that says it's no longer available and offers no form", async () => {
    expect(await run("posting-closed.html", "dry")).toMatchObject({ skipped: true, note: "posting closed" });
  }, 60_000);

  it("fills a live form whose sidebar lists other jobs as no longer available", async () => {
    const result = await run("posting-sidebar-closed.html", "dry");
    expect(result).toMatchObject({ skipped: false, submitted: false, note: "dry run" });
  }, 60_000);
});
