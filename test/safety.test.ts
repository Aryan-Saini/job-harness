import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Throwaway db, data and key dirs: nothing here touches ~/.jh or real logins.
process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-db-")), "jh.db");
const { gateDecision, judgeSubmit } = await import("../src/apply.ts");
const { extractFields, fillField } = await import("../src/fields.ts");
const { handleAuth } = await import("../src/login.ts");
const { setCred } = await import("../src/secrets.ts");

const fixture = (name: string) => `file://${resolve(import.meta.dirname, "fixtures", name)}`;
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome" });
});
afterAll(() => browser.close());

describe("gateDecision", () => {
  const ok = { mode: "auto", missing: 0, filled: 5 } as const;
  it("submits a fully filled auto run", () => expect(gateDecision(ok).action).toBe("submit"));
  it("parks auto runs with empty required fields", () => expect(gateDecision({ ...ok, missing: 1 }).action).toBe("stop"));
  it("refuses to submit when this run filled nothing", () =>
    expect(gateDecision({ ...ok, filled: 0 })).toMatchObject({ action: "stop", note: expect.stringMatching(/filled nothing/) }));
  it("refuses to submit after a failed LinkedIn resume pick", () =>
    expect(gateDecision({ ...ok, resumeProblem: "no card" })).toMatchObject({ action: "stop", note: expect.stringMatching(/resume/) }));
  it("asks in review and never submits a dry run", () => {
    expect(gateDecision({ ...ok, mode: "review", filled: 0 }).action).toBe("ask");
    expect(gateDecision({ ...ok, mode: "dry" }).action).toBe("stop");
  });
});

describe("judgeSubmit", () => {
  const base = { thanks: false, thanksBefore: false, errors: [], submitThere: false };
  it("counts a new thank-you as confirmed", () =>
    expect(judgeSubmit({ ...base, thanks: true })).toMatchObject({ submitted: true, confirmed: true }));
  it("counts a vanished form without thanks as submitted, unconfirmed", () =>
    expect(judgeSubmit(base)).toMatchObject({ submitted: true, confirmed: false }));
  it("treats new validation errors as not submitted", () =>
    expect(judgeSubmit({ ...base, errors: ["Phone is required"] })).toMatchObject({ submitted: false, note: expect.stringMatching(/Phone is required/) }));
  it("treats a submit button that's still there as not submitted, even with thank-you text from before", () =>
    expect(judgeSubmit({ ...base, submitThere: true, thanks: true, thanksBefore: true }).submitted).toBe(false));
});

describe("extractFields ids", () => {
  it("keeps each control's id when a field is inserted above it", async () => {
    const page = await browser.newPage();
    await page.goto(fixture("insert.html"));
    const first = await extractFields(page);
    await page.evaluate("insertField()");
    const second = await extractFields(page);
    const idOf = (fields: typeof first, re: RegExp) => fields.find((f) => re.test(f.label))?.id;
    for (const re of [/^Email/, /salary/, /authorized/, /Sponsorship/]) expect(idOf(second, re)).toBe(idOf(first, re));
    const phone = idOf(second, /^Phone/);
    expect(phone).toBeDefined();
    expect(first.map((f) => f.id)).not.toContain(phone);
    expect(new Set(second.map((f) => f.id)).size).toBe(second.length);
    await page.close();
  });

  it("leaves a wrapped select's options out of its label", async () => {
    const page = await browser.newPage();
    await page.goto(fixture("insert.html"));
    const auth = (await extractFields(page)).find((f) => f.kind === "select");
    expect(auth?.label).toBe("Are you authorized to work in Canada?");
    await page.close();
  });
});

describe("handleAuth", () => {
  it("leaves an application form with an optional password box alone", async () => {
    setCred("default", "test@example.com", "hunter2-Example");
    const page = await browser.newPage();
    await page.goto(fixture("optional-password.html"));
    expect(await handleAuth(page)).toBe(false);
    expect(await page.evaluate("window.submitted")).toBeUndefined();
    expect(await page.inputValue("#pw")).toBe("");
    await page.close();
  });
});

describe("Ashby-style controls", () => {
  it("reads Yes/No buttons as a question and fills both kinds by clicking", async () => {
    const page = await browser.newPage();
    await page.goto(fixture("ashby.html"));
    const fields = await extractFields(page);
    const employed = fields.find((f) => /previously been employed/.test(f.label));
    const rights = fields.find((f) => /Working Rights/.test(f.label));
    expect(employed).toMatchObject({ kind: "radio", options: ["Yes", "No"], filled: false });
    expect(rights).toMatchObject({ kind: "radio", options: ["I am a citizen", "I need a visa"] });
    expect(await fillField(page, employed!, { value: "No", values: [] }, "")).toBeUndefined();
    expect(await fillField(page, rights!, { value: "I am a citizen", values: [] }, "")).toBeUndefined();
    expect(await page.evaluate("[window.q1, window.q2, window.clicked]")).toEqual(["no", "citizen", "citizen"]);
    await page.close();
  });
});
