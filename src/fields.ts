import type { Frame, Locator, Page } from "playwright";
import { bestOption } from "./answers.ts";
import { ERRORS, EXTRACT, type RawField } from "./dom.ts";

// Finds every fillable control on a page (all frames, so embedded Greenhouse/Lever iframes
// work) and fills them. Site-agnostic: nothing here knows which ATS it's on.

export type Field = RawField & { frame: Frame };
export type Answer = { value: string; values: string[] };

// New controls get ids unique to this process, extraction and frame; tagged ones keep theirs.
const session = Math.random().toString(36).slice(2, 6);
let extractions = 0;

/** Every fillable control on the page (or inside `root`). A control's id stays the same across calls. */
export async function extractFields(page: Page, root?: string): Promise<Field[]> {
  const frames = root ? [page.mainFrame()] : page.frames();
  const fields: Field[] = [];
  const run = ++extractions;
  for (const [i, frame] of frames.entries()) {
    try {
      const prefix = `jh${session}-${run}-${i}-`;
      const raw = (await frame.evaluate(`${EXTRACT}(${JSON.stringify([root ?? null, prefix])})`)) as RawField[];
      fields.push(...raw.map((f) => ({ ...f, frame })));
    } catch {
      // Detached or cross-origin frame we can't script. Skip it.
    }
  }
  for (const f of fields) {
    if (f.kind === "combobox" && !f.filled) f.options = await probeOptions(page, f);
  }
  return fields;
}

export async function visibleErrors(page: Page, root?: string): Promise<string[]> {
  return (await page.evaluate(`${ERRORS}(${JSON.stringify(root ?? null)})`)) as string[];
}

const loc = (f: Field, id = f.id): Locator => f.frame.locator(`[data-jh="${id}"]`);

/** A dropdown's open options: listbox options, or the items of a menu (BambooHR's select menus). */
const OPTIONS = "[role=option]:visible, [role=menu] [role=menuitem]:visible";

/** Opens a dropdown-style combobox just long enough to read its options. */
async function probeOptions(page: Page, f: Field): Promise<string[]> {
  try {
    await loc(f).click({ timeout: 2000 });
    await page.waitForTimeout(400);
    const options = await f.frame.locator(OPTIONS).allInnerTexts();
    await loc(f).press("Escape").catch(() => page.keyboard.press("Escape"));
    return options.map((o) => o.trim()).filter(Boolean).slice(0, 60);
  } catch {
    return [];
  }
}

/** Fills one field. Returns an error string when the answer couldn't be applied. */
export async function fillField(page: Page, f: Field, a: Answer, resumeFile: string): Promise<string | undefined> {
  try {
    switch (f.kind) {
      case "file":
        await loc(f).setInputFiles(resumeFile);
        return;
      case "text":
        if (/location|city|address/i.test(f.label)) return await typeAndSuggest(page, f, a.value);
        await loc(f).fill(a.value);
        return;
      case "textarea":
      case "date":
        await loc(f).fill(a.value);
        return;
      case "select": {
        const option = bestOption(a.value, f.options);
        if (!option) return `no option matches "${a.value}"`;
        await loc(f).selectOption({ label: option });
        return;
      }
      case "radio": {
        const i = indexOf(a.value, f.options);
        if (i < 0) return `no option matches "${a.value}"`;
        await check(loc(f, f.optionIds[i]), true);
        return;
      }
      case "checkboxes": {
        const wanted = a.values.length ? a.values : [a.value];
        for (const w of wanted) {
          const i = indexOf(w, f.options);
          if (i >= 0) await check(loc(f, f.optionIds[i]), true);
        }
        return;
      }
      case "checkbox":
        await check(loc(f), /^(yes|true|checked|agree|y|1|on)\b/i.test(a.value));
        return;
      case "combobox":
        return await pickCombobox(page, f, a.value);
    }
  } catch (error) {
    return String(error).split("\n")[0];
  }
}

function indexOf(want: string, options: string[]): number {
  const option = bestOption(want, options);
  return option === undefined ? -1 : options.indexOf(option);
}

/** Custom-styled radios and checkboxes hide the real input, so fall back to a raw click. */
/**
 * Ticks or unticks like a person would: clicks the visible label (custom-styled controls hide
 * the real input, and React forms only notice real clicks), then falls back to the input.
 * A pressable button (aria-pressed) is just clicked.
 */
async function check(l: Locator, on: boolean) {
  if ((await l.getAttribute("aria-pressed").catch(() => null)) !== null) {
    if ((await l.getAttribute("aria-pressed")) !== String(on)) await l.click({ timeout: 3000 });
    return;
  }
  if ((await l.isChecked().catch(() => !on)) === on) return;
  const id = await l.getAttribute("id").catch(() => null);
  const label = id ? l.page().locator(`label[for="${id.replace(/"/g, '\\"')}"]`) : l.locator("xpath=ancestor::label[1]");
  if (await label.first().isVisible().catch(() => false)) {
    await label.first().click({ timeout: 3000 }).catch(() => {});
    if ((await l.isChecked().catch(() => !on)) === on) return;
  }
  try {
    await l.setChecked(on, { force: true, timeout: 2000 });
  } catch {
    if ((await l.isChecked()) !== on) await l.dispatchEvent("click");
  }
}

async function pickCombobox(page: Page, f: Field, value: string): Promise<string | undefined> {
  const box = loc(f);
  await box.click({ timeout: 3000 });
  if (f.typeable) {
    await box.press("ControlOrMeta+a");
    await box.press("Backspace");
    // A static list filters on any text. An async search (cities) wants a short query.
    const query = f.options.length ? value.slice(0, 40) : (value.split(",")[0] ?? value);
    await box.pressSequentially(query, { delay: 30 });
  }
  // Proper listboxes use role=option; custom ones (Ashby's autocomplete) are plain list items.
  const optionLoc = f.frame.locator(
    `${OPTIONS}, [role=listbox] li:visible, [class*=option i]:not(:has(*)):visible, [class*=menu i] li:visible`,
  );
  // Async searches (cities) fill the list a beat after typing: wait for a match, up to 8s.
  let texts: string[] = [];
  let option: string | undefined;
  for (const deadline = Date.now() + (f.options.length ? 3000 : 8000); Date.now() < deadline; ) {
    await page.waitForTimeout(400);
    texts = (await optionLoc.allInnerTexts().catch(() => [])).map((t) => t.trim());
    option = bestOption(value, texts.filter((t) => t && t.length < 120));
    if (option) break;
  }
  if (option) {
    await optionLoc.nth(texts.indexOf(option)).click();
    return;
  }
  if (f.typeable) {
    // Most autocompletes highlight the first match; arrow onto it and confirm.
    await box.press("ArrowDown");
    await box.press("Enter");
    return;
  }
  await page.keyboard.press("Escape");
  return `no option matches "${value}"`;
}

const SUGGESTIONS = "[role=option]:visible, .pac-item:visible, [class*=dropdown-results] > div:visible, [class*=suggestion] li:visible, [class*=autocomplete] li:visible";

/** Location boxes often clear themselves unless you pick one of their suggestions. */
async function typeAndSuggest(page: Page, f: Field, value: string): Promise<string | undefined> {
  const box = loc(f);
  await box.fill("");
  await box.pressSequentially(value, { delay: 25 });
  const options = f.frame.locator(SUGGESTIONS);
  const shown = await options.first().waitFor({ timeout: 2500 }).then(() => true, () => false);
  if (!shown) return;
  await page.waitForTimeout(300);
  const texts = (await options.allInnerTexts()).map((t) => t.trim());
  const option = bestOption(value, texts) ?? texts[0];
  if (option !== undefined) await options.nth(texts.indexOf(option)).click();
}

/** Current value of a text-like or select field, used to learn from edits you make by hand. */
export async function readValue(f: Field): Promise<string | undefined> {
  try {
    if (f.kind === "text" || f.kind === "textarea" || f.kind === "date") return await loc(f).inputValue({ timeout: 3000 });
    if (f.kind === "select") {
      return (await loc(f).locator("option:checked").first().innerText()).trim();
    }
  } catch {}
  return undefined;
}

/**
 * Fills a field again after the site dropped its answer from its own state while the control
 * still shows it (Ashby's React form after two quick fills). Text is cleared and typed key by key;
 * a choice is moved to another option and back, since clicking the option already shown changes
 * nothing. Returns an error string like fillField.
 */
export async function refill(page: Page, f: Field, a: Answer, resumeFile: string): Promise<string | undefined> {
  try {
    if (f.kind === "text" || f.kind === "textarea") {
      const box = loc(f);
      await box.click({ timeout: 3000 });
      await box.fill("");
      await box.pressSequentially(a.value, { delay: 15 });
      await box.blur();
      return;
    }
    if (f.kind === "radio") {
      const i = indexOf(a.value, f.options);
      const other = f.optionIds.findIndex((_, j) => j !== i);
      if (i >= 0 && other >= 0) await check(loc(f, f.optionIds[other]), true);
    }
    return await fillField(page, f, a, resumeFile);
  } catch (error) {
    return String(error).split("\n")[0];
  }
}
