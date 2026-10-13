import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Throwaway data, state and DB so the signup test never touches real logins.
// login.ts reaches db.ts through sites.ts; keep it on a temp file.
process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-db-")), "jh.db");
const { extractFields, fillField } = await import("../src/fields.ts");
const { handleAuth } = await import("../src/login.ts");
const { credFor, setCred } = await import("../src/secrets.ts");

const fixture = (name: string) => `file://${resolve(import.meta.dirname, "fixtures", name)}`;
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome" });
});
afterAll(() => browser.close());

describe("extractFields", () => {
  it("gives each field its section heading and help text", async () => {
    const page = await browser.newPage();
    await page.goto(fixture("hint.html"));
    const fields = await extractFields(page);
    const byLabel = (re: RegExp) => fields.find((f) => re.test(f.label));
    expect(byLabel(/Start date year/)).toMatchObject({ section: "Education", hint: "" });
    expect(byLabel(/backend vs frontend/)).toMatchObject({ section: "About your work", hint: "e.g. 80% backend, 20% frontend" });
    expect(byLabel(/AI tools/)?.hint).toBe("If so, how?");
    await page.close();
  });

  it("finds every control with its question and options", async () => {
    const page = await browser.newPage();
    await page.goto(fixture("form.html"));
    const fields = await extractFields(page);
    const byLabel = (re: RegExp) => fields.find((f) => re.test(f.label));
    expect(byLabel(/^First Name/)).toMatchObject({ kind: "text", required: true });
    expect(byLabel(/LinkedIn/)).toMatchObject({ kind: "text" });
    expect(byLabel(/Resume/)).toMatchObject({ kind: "file" });
    expect(byLabel(/authorized to work in Canada/)).toMatchObject({ kind: "select", options: ["Select...", "Yes", "No"], filled: false });
    expect(byLabel(/sponsorship/)).toMatchObject({ kind: "radio", options: ["Yes", "No"] });
    expect(byLabel(/^Gender/)?.options).toContain("I don't wish to answer");
    expect(byLabel(/privacy policy/)).toMatchObject({ kind: "checkbox" });
    expect(byLabel(/^Race/)).toMatchObject({ kind: "checkboxes", options: ["Asian", "White", "I prefer not to answer"] });

    const sponsor = byLabel(/sponsorship/)!;
    expect(await fillField(page, sponsor, { value: "Yes", values: [] }, "")).toBeUndefined();
    expect(await page.locator("input[name=sp][value=y]").isChecked()).toBe(true);
    await page.close();
  });
});

describe("menu-button selects", () => {
  it("reads a menu button over a hidden select as one dropdown and picks from its menu", async () => {
    const page = await browser.newPage();
    await page.goto(fixture("menu-select.html"));
    const fields = await extractFields(page);
    expect(fields.map((f) => [f.label, f.kind, f.required, f.filled])).toEqual([
      ["City *", "text", true, false],
      ["Province *", "combobox", true, false],
      ["Country *", "combobox", true, true],
    ]);
    const province = fields[1]!;
    expect(province.options).toEqual(["Alberta", "British Columbia", "Ontario"]);
    expect(await fillField(page, province, { value: "Ontario", values: [] }, "")).toBeUndefined();
    expect(await page.inputValue("#fab-select1")).toBe("9");
    expect((await extractFields(page))[1]).toMatchObject({ label: "Province *", filled: true });
    await page.close();
  });
});

describe("handleAuth", () => {
  it("switches to Create Account, signs up with the default login, and saves it for the host", async () => {
    setCred("default", "test@example.com", "hunter2-Example");
    const page = await browser.newPage();
    await page.goto(fixture("signup.html"));
    expect(await handleAuth(page)).toBe(true); // clicks Create Account
    expect(await handleAuth(page)).toBe(true); // fills and submits
    expect(await page.evaluate("window.created")).toEqual(["test@example.com", "hunter2-Example", "hunter2-Example", true]);
    expect(credFor("")).toMatchObject({ email: "test@example.com", saved: true }); // file:// host is ""
    await page.close();
  }, 15_000); // handleAuth waits out each click (1.5s + 3s)
});
