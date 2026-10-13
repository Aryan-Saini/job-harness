import { statSync } from "node:fs";
import { basename } from "node:path";
import type { Page } from "playwright";
import { ask } from "./browser.ts";
import { clickButton, settle } from "./buttons.ts";
import type { ResumeId } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";
import type { Job } from "./planner.ts";

// LinkedIn specifics: getting into the Easy Apply dialog, and choosing the right resume in it.
// Everything else (filling, Next, Review, Submit) runs through the generic loop in apply.ts.

export const MODAL = "dialog[open], .jobs-easy-apply-modal, [data-test-modal-id=easy-apply-modal]";

/** Search URLs carry the job as ?currentJobId=. The job page is easier to work with. */
export function jobUrl(url: string): string {
  const id = new URL(url).searchParams.get("currentJobId");
  return id ? `https://www.linkedin.com/jobs/view/${id}/` : url;
}

/**
 * Reads a posting from LinkedIn's public job endpoint: no login, no browser, no model call.
 * Returns undefined if LinkedIn changes the markup.
 */
export async function guestJob(url: string): Promise<Job | undefined> {
  const id = jobUrl(url).match(/jobs\/view\/(\d+)/)?.[1];
  if (!id) return undefined;
  const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return undefined;
  const html = await res.text();
  const text = (s = "") => s.replace(/<br\s*\/?>|<\/(p|li|ul|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();
  const description = text(html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1]);
  if (!description) return undefined;
  const flavors = [...html.matchAll(/topcard__flavor[^>]*>([\s\S]*?)<\/(span|a)>/g)].map((m) => text(m[1])).filter(Boolean);
  return {
    url,
    title: text(html.match(/top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/)?.[1]),
    company: flavors[0] ?? "",
    location: flavors[1] ?? "",
    description,
  };
}

/** Opens Easy Apply. Returns the dialog selector, or undefined when the job only has an external Apply. */
export async function openEasyApply(page: Page): Promise<string | undefined> {
  const loggedOut = /authwall|\/login|\/signup|checkpoint/.test(page.url())
    || (await page.locator("a[href*='/login']:visible").count()) > 0;
  if (loggedOut) {
    await ask("Log in to LinkedIn in the browser window (once per machine), then press enter.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page);
  }
  if (!(await clickButton(page, /^easy apply( to this job)?$/i))) return undefined;
  await page.locator(MODAL).first().waitFor({ timeout: 15_000 });
  await settle(page);
  return MODAL;
}

/**
 * LinkedIn keeps uploaded resumes and pre-selects whichever was used last. Upload ours once
 * (again whenever the PDF changes), remember the card it became, and select that card later.
 * LinkedIn only keeps an upload if the application is submitted, so the returned callback
 * records it and should be called after a submit. A tailored resume (a new file per job) is
 * always uploaded fresh.
 */
type Uploads = Record<string, { name: string; date: string; mtime: number }>;

const uploadButton = (page: Page) => page.locator(MODAL).first().getByRole("button", { name: /upload resume/i });

/** True on the Easy Apply step that asks for a resume. */
export const onResumeStep = async (page: Page) => (await uploadButton(page).count()) > 0;

export async function chooseResume(page: Page, resume: ResumeId, file: string): Promise<(() => void) | undefined> {
  const dialog = page.locator(MODAL).first();
  const upload = uploadButton(page);

  const mtime = statSync(file).mtimeMs;
  const uploads = kvGet<Uploads>("linkedin-resumes") ?? {};
  const known = uploads[resume];

  if (known && known.mtime === mtime) {
    // LinkedIn sometimes swaps spaces for underscores in the stored name.
    const name = new RegExp(known.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ _]/g, "[ _]"));
    const card = dialog.locator("div").filter({ hasText: name }).filter({ hasText: known.date }).last();
    if (await card.count()) {
      await card.click();
      console.log(`  [resume] selected ${known.name} (${known.date}) already on LinkedIn`);
      return;
    }
  }

  const chooser = page.waitForEvent("filechooser", { timeout: 10_000 });
  await upload.click();
  await (await chooser).setFiles(file);
  await page.waitForTimeout(4000);
  console.log(`  [resume] uploaded ${basename(file)} to LinkedIn`);
  return () => {
    uploads[resume] = { name: basename(file), date: new Date().toLocaleDateString("en-US"), mtime };
    kvSet("linkedin-resumes", uploads);
  };
}
