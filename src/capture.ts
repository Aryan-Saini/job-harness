import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { Application } from "./applications.ts";
import type { Job } from "./planner.ts";

// The paper trail for each run: a full-page screenshot plus the HTML of every page the
// harness saw (posting, each filled step, review, confirmation), and an answers.md.

/**
 * Inputs keep what was typed in properties, not attributes, so a plain HTML save shows empty
 * fields. This copies values, checks and selections into attributes first.
 */
const BAKE_VALUES = String.raw`(() => {
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (el.tagName === "TEXTAREA") el.textContent = el.value;
    else if (el.tagName === "SELECT") for (const o of el.options) o.toggleAttribute("selected", o.selected);
    else if (el.type === "checkbox" || el.type === "radio") el.toggleAttribute("checked", el.checked);
    else if (el.type !== "file" && el.type !== "password") el.setAttribute("value", el.value);
  }
})()`;

/** Lets a scrolling modal (LinkedIn Easy Apply) grow to full height so the screenshot shows all of it. */
const EXPAND_MODAL = (root: string) => String.raw`(() => {
  const s = document.createElement("style");
  s.id = "jh-expand";
  s.textContent = ${JSON.stringify(`${root.split(",")[0]} , ${root.split(",")[0]} * { max-height: none !important; overflow: visible !important; } ${root.split(",")[0]} { position: absolute !important; top: 0 !important; }`)};
  document.head.appendChild(s);
})()`;

/** Saves `<name>.png` and `<name>.html` (plus one .html per form iframe) into the run folder. */
export async function capture(page: Page, runDir: string, name: string, root?: string) {
  try {
    for (const frame of page.frames()) await frame.evaluate(BAKE_VALUES).catch(() => {});
    writeFileSync(join(runDir, `${name}.html`), await page.content());
    // Embedded application forms (a Greenhouse iframe on a company site). A modal form lives in
    // the main page, and the other iframes are ads and trackers.
    let i = 0;
    for (const frame of root ? [] : page.frames().slice(1)) {
      const html = await frame.content().catch(() => "");
      if (/<form\b/i.test(html) && /<(textarea|select)\b|type="?file/i.test(html)) writeFileSync(join(runDir, `${name}.frame-${++i}.html`), html);
    }
    if (root) await page.evaluate(EXPAND_MODAL(root)).catch(() => {});
    await page.screenshot({ path: join(runDir, `${name}.png`), fullPage: true });
    if (root) await page.evaluate(`document.getElementById("jh-expand")?.remove()`).catch(() => {});
  } catch (error) {
    console.log(`  (couldn't capture ${name}: ${String(error).split("\n")[0]})`);
  }
}

/** A readable record of the run, next to the screenshots. */
export function writeAnswers(runDir: string, job: Job, app: Pick<Application, "status" | "resume" | "fit" | "answers">) {
  const fit = app.fit ? `${app.fit.verdict} ${app.fit.score.toFixed(2)}: ${app.fit.reasons.join("; ")}` : "not checked";
  const lines = [
    `# ${job.title} at ${job.company}`,
    "",
    `- Status: ${app.status}`,
    `- Location: ${job.location}`,
    `- Posting: ${job.url}`,
    `- Resume: ${app.resume}`,
    `- Fit: ${fit}`,
    "",
    "## Questions and answers",
    "",
    ...app.answers.flatMap((a) => [`**${a.question}**  `, `${a.answer || "_(blank)_"}  `, `<sub>${a.source}</sub>`, ""]),
    "## Posting",
    "",
    job.description.slice(0, 20_000),
  ];
  writeFileSync(join(runDir, "answers.md"), `${lines.join("\n")}\n`);
}
