import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { guardClick, withDryLock } from "../src/drylock.ts";

// A draft must never press a button that sends the form; opening a form or paging through it is fine.
describe("dry-run click lock", () => {
  it("refuses submit/apply buttons on a filled form in a dry run, allows Next and opening Apply", async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    await page.setContent(`<a id="open" href="#form">Apply</a>
      <form><input id="n" value="Jane"><button id="next" type="submit">Next</button>
      <button id="send" type="submit">Submit application</button><button id="apply" type="button">Apply</button></form>`);
    const dryClick = (id: string) => withDryLock(true, () => guardClick(page.locator(`#${id}`)));
    await expect(dryClick("send")).rejects.toThrow(/refused/);
    await expect(dryClick("apply")).rejects.toThrow(/refused/);
    await expect(dryClick("next")).resolves.toBeUndefined();
    await expect(dryClick("open")).resolves.toBeUndefined();
    await expect(withDryLock(false, () => guardClick(page.locator("#send")))).resolves.toBeUndefined();
    await browser.close();
  }, 30_000);
});
