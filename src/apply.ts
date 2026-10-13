import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Locator, Page } from "playwright";
import { loadBank, normalize, remember, saveBank, type Bank } from "./answers.ts";
import { ask, openBrowser, setHeadless, setInteractive, type BrowserOpts } from "./browser.ts";
import { clickButton, findButton, NEXT, settle, START, SUBMIT, SUBMIT_OR_APPLY } from "./buttons.ts";
import { paths, resumePath, type ResumeId } from "./config.ts";
import { answersFrom, priorApplication, recordApplication } from "./applications.ts";
import { capture, writeAnswers } from "./capture.ts";
import { checkFit, type Fit } from "./fit.ts";
import { extractFields, fillField, readValue, refill, visibleErrors, type Field } from "./fields.ts";
import { specFor } from "./llm.ts";
import * as linkedin from "./linkedin.ts";
import { addPending } from "./pending.ts";
import { handleAuth, hasCaptcha } from "./login.ts";
import { plan, readJob, type Job, type Planned } from "./planner.ts";
import { recordSite, siteKey } from "./sites.ts";
import { reviewAnswers } from "./review.ts";
import { settings } from "./settings.ts";
import { flushUsage, inRunScope, setRun } from "./usage.ts";
import { guardClick, withDryLock } from "./drylock.ts";

// One application, start to finish: open the posting, get to the form, fill every page,
// stop at the submit button for review (or submit, in auto mode), then record everything.

export type SubmitMode = "review" | "auto" | "dry";
export type ApplyOpts = {
  url: string;
  resume: ResumeId;
  submit: SubmitMode;
  browser: BrowserOpts;
  /** Ask Jev whether the posting is worth it before filling anything. */
  fit: boolean;
  /** Nobody at the terminal (the runner): never stop to ask, even in a dry run. */
  unattended?: boolean;
  /** Aborted when the runner gives up on this run (timeout): it closes its tab and never submits after. */
  signal?: AbortSignal;
};
export type ApplyResult = {
  job: Job;
  submitted: boolean;
  confirmed: boolean;
  skipped: boolean;
  runDir: string;
  /** Why it ended the way it did ("submitted, confirmed", "submit didn't go through: ...", ...). */
  note: string;
};

/** A posting that's gone: taken down, filled, or no longer accepting applications. */
const CLOSED = /job not found|job you requested was not found|no longer (accepting applications|available|open)|position has been filled|this job (has|is) (closed|expired)|page (you were looking for )?(could not be|was not) found/i;

// Not a bare "thank you": "Thank you for visiting" on a page the form vanished into isn't a confirmation.
const CONFIRMED = /thank you for (applying|your application|submitting|your interest in (joining|working))|thanks for (applying|your application)|application (has been |was )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|your application was sent|your application for [^\n]{1,160} (has been|was) (received|submitted)/i;

/** Applies to one posting. Runs in its own usage scope so parallel runs log their own model calls. */
export function apply(opts: ApplyOpts): Promise<ApplyResult> {
  return inRunScope(() => withDryLock(opts.submit === "dry", () => applyOne(opts)));
}

async function applyOne(opts: ApplyOpts): Promise<ApplyResult> {
  setHeadless(opts.browser.headless);
  setInteractive(opts.submit !== "auto" && !opts.unattended);
  const site = siteKey(opts.url);
  const skip = (job: Job, fit: Fit | undefined, why: string): ApplyResult => {
    if (opts.submit !== "dry") recordApplication({ job, site, status: "skipped", resume: opts.resume, fit, note: why });
    return { job, submitted: false, confirmed: false, skipped: true, runDir: "", note: why };
  };
  const already = (job: Job): ApplyResult => ({ job, submitted: false, confirmed: false, skipped: true, runDir: "", note: "already applied" });
  // LinkedIn postings can be read and judged before a browser even opens.
  const guest = site === "linkedin" ? await linkedin.guestJob(opts.url) : undefined;
  let fit: Fit | undefined;
  if (guest) {
    if (!(await priorGate(guest, opts))) return already(guest);
    const gate = await fitGate(guest, opts);
    fit = gate.fit;
    if (!gate.go) return skip(guest, fit, "Jev fit: skip");
  }

  const { context, page: first, close } = await openBrowser(opts.browser);
  // Given up on: close this run's tab so whatever it's waiting on fails fast.
  opts.signal?.addEventListener("abort", () => void close().catch(() => {}), { once: true });
  context.setDefaultTimeout(5000);
  try {
    await first.goto(site === "linkedin" ? linkedin.jobUrl(opts.url) : opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(first);

    let job: Job;
    if (guest) job = guest;
    else {
      const text = await first.innerText("body").catch(() => "");
      const [read, gate] = await Promise.all([
        readJob(opts.url, text),
        fitGate({ url: opts.url, title: await first.title(), company: "", location: "", description: text }, opts),
      ]);
      job = read;
      fit = gate.fit;
      if (!(await priorGate(job, opts))) return already(job);
      if (!gate.go) return skip(job, fit, "Jev fit: skip");
    }
    console.log(`\n${job.title || "?"} at ${job.company || "?"} (${job.location || "?"})`);
    console.log(`resume ${opts.resume}, fill=${specFor("fill")}, write=${specFor("write")}, submit=${opts.submit}`);

    // Unique per run even when parallel drafts start the same second for the same company.
    const runDir = join(paths.runs, `${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}-${slug(job.company || "job")}-${randomBytes(3).toString("hex")}`);
    mkdirSync(runDir, { recursive: true });
    setRun(basename(runDir));
    const resumeFile = resumePath(opts.resume);
    // Never send an application without the resume.
    if (!existsSync(resumeFile)) throw new Error(`Resume not found at ${resumeFile}. See \`jh resumes\`.`);
    await capture(first, runDir, "00-posting");
    // Closed: the page says so and offers no way to apply (a "no longer available" in a sidebar of
    // other jobs doesn't count).
    if (CLOSED.test((await first.innerText("body").catch(() => "")).slice(0, 3000))
      && !(await findButton(first, /\bapply\b/i).catch(() => undefined))
      && !(await first.locator("input[type=file], textarea").count().catch(() => 0))) return skip(job, fit, "posting closed");

    const { page, root } = site === "linkedin"
      ? await startLinkedIn(first)
      : { page: await startForm(first), root: undefined };

    const bank = loadBank();
    // The moment the submit button is clicked the application exists, so record it before
    // anything else can fail. The full record below fills in answers and the verified outcome.
    const onClicked = () => safely("record the submission", () =>
      recordApplication({ job, site, status: "applied", resume: opts.resume, fit: fit ?? null, run: basename(runDir), note: "submit clicked", urls: [first.url(), page.url()] }));
    const result = await fillAndSubmit({ page, root, job, bank, opts, runDir, resumeFile, onClicked });

    const record = {
      status: result.submitted ? "applied" : opts.submit === "dry" ? "draft" : "unfinished",
      resume: opts.resume,
      fit: fit ?? null,
      answers: answersFrom(result.planned, basename(resumeFile)),
    } as const;
    writeAnswers(runDir, job, record);
    writeFileSync(join(runDir, "run.json"), JSON.stringify({
      url: opts.url,
      job: { ...job, description: job.description.slice(0, 2000) },
      resume: opts.resume,
      models: { fill: specFor("fill"), write: specFor("write") },
      submitted: result.submitted,
      confirmed: result.confirmed,
      note: result.note,
      fields: result.planned.map((p) => ({ label: p.field.label, section: p.field.section, kind: p.field.kind, value: p.value, values: p.values, source: p.source, note: p.note })),
    }, null, 2));

    if (opts.submit !== "dry") {
      const full = () => recordApplication({ job, site, ...record, confirmed: result.confirmed, run: basename(runDir), note: result.note, urls: [first.url(), page.url()] });
      // After a submit nothing may throw: the job went in, and the early record already has it.
      if (result.submitted) safely("update the application record", full);
      else full();
    }
    if (result.submitted) safely("save the answer bank", () => saveBank(bank));
    safely("catalog the site's questions", () => recordSite(page.url(), result.planned, result.submitted));
    // Unanswerable questions become a to-do for `jh answer`.
    if (!result.submitted && opts.submit !== "dry") safely("file the pending questions", () => addPending(result.missing, job));
    if (!result.submitted && opts.submit === "review" && !opts.browser.headless) {
      await ask("Browser stays open so you can finish by hand. Press enter to close it.");
    }
    console.log(`\n${result.submitted ? (result.confirmed ? "Submitted and confirmed." : "Submitted, no confirmation seen.") : `Not submitted (${result.note}).`} Log: ${runDir}`);
    return { job, submitted: result.submitted, confirmed: result.confirmed, skipped: false, runDir, note: result.note };
  } finally {
    await close();
    flushUsage();
  }
}

/**
 * Prints Jev's verdict and decides whether to go on. A "skip" asks in review mode, skips
 * outright in auto mode, and only informs on a dry run.
 */
async function fitGate(job: Job, opts: ApplyOpts): Promise<{ go: boolean; fit?: Fit }> {
  if (!opts.fit) return { go: true };
  const fit = await checkFit(job, opts.resume).catch((e: Error) => {
    console.log(`  fit check failed (${e.message}), carrying on`);
    return undefined;
  });
  if (!fit) return { go: true };
  console.log(`\nfit: ${fit.verdict.toUpperCase()} ${fit.score.toFixed(2)}  ${job.title}\n${fit.reasons.map((r) => `     ${r}`).join("\n")}`);
  if (fit.verdict !== "skip" || opts.submit === "dry") return { go: true, fit };
  if (opts.submit === "auto") {
    console.log("  skipped (auto mode). --no-fit to apply anyway");
    return { go: false, fit };
  }
  return { go: (await ask("Jev says skip. Apply anyway? [y/N]")).toLowerCase() === "y", fit };
}

/** Stops a second application to the same job. Asks in review mode, skips in auto mode. */
async function priorGate(job: Job, opts: ApplyOpts): Promise<boolean> {
  const prior = priorApplication(job);
  if (!prior) return true;
  console.log(`\nalready ${prior.status} on ${prior.date}: ${prior.title} at ${prior.company} (${prior.id})`);
  if (opts.submit === "dry") return true;
  if (opts.submit === "auto") return false;
  return (await ask("Apply again anyway? [y/N]")).toLowerCase() === "y";
}

async function startLinkedIn(page: Page): Promise<{ page: Page; root?: string }> {
  const root = await linkedin.openEasyApply(page);
  if (root) return { page, root };
  // External apply: LinkedIn opens the company's ATS in a new tab.
  const tab = await clickForTab(page, /^apply\b/i);
  if (!tab) throw new Error("No Easy Apply or Apply button on this LinkedIn posting (closed, or already applied?)");
  console.log(`  external application: ${tab.url()}`);
  return { page: await startForm(tab) };
}

/** Clicks a button and returns the page that results, a new tab if one opened. */
async function clickForTab(page: Page, pattern: RegExp): Promise<Page | undefined> {
  // The tab this click opens (a popup of this page), never another run's tab in a shared browser.
  const opened = page.waitForEvent("popup", { timeout: 6000 }).catch(() => undefined);
  if (!(await clickButton(page, pattern))) return undefined;
  const tab = (await opened) ?? page;
  await settle(tab);
  return tab;
}

/** Gets from a posting page to the actual form: clicks Apply, handles login walls. */
async function startForm(page: Page): Promise<Page> {
  await clickButton(page, /^(accept|accept all|accept all cookies|accept cookies|i accept|allow all|got it)$/i).catch(() => false);
  for (let i = 0; i < 4; i++) {
    if (await handleAuth(page)) {
      await settle(page);
      continue;
    }
    // An application form asks for a resume. Stray inputs on a posting page (a locale picker,
    // a hidden embedded form) don't make it one, so with no upload, try the Apply button first.
    const fields = await extractFields(page);
    const open = fields.filter((f) => !f.filled && f.kind !== "file");
    const hasUpload = fields.some((f) => f.kind === "file" && !/autofill/i.test(f.label));
    if (open.length >= 2 && hasUpload) return page;
    let moved: Page | undefined;
    for (const pattern of START) {
      moved = await clickForTab(page, pattern);
      if (moved) break;
    }
    if (!moved) return page;
    page = moved;
    await page.waitForTimeout(1500);
  }
  return page;
}

type Ctx = {
  page: Page;
  root?: string;
  job: Job;
  bank: Bank;
  opts: ApplyOpts;
  runDir: string;
  /** The PDF to upload: the stock resume, or one tailored to this job. */
  resumeFile: string;
  /** Called the instant the submit button is clicked, before the outcome is known. */
  onClicked: () => void;
  /** Site-specific bookkeeping that only makes sense once the application went in. */
  afterSubmit?: () => void;
};

/** What the fill loop knows when it reaches the submit button. */
type Progress = {
  planned: Planned[];
  /** Planned fields on the page currently shown (cleared on Next). */
  onPage: Planned[];
  /** Value each field read back right after the harness filled it, so site formatting isn't mistaken for an edit. */
  filledAs: Map<Planned, string | undefined>;
  /** Fields this run filled, plus a LinkedIn resume pick. Zero means it never saw a real form. */
  filled: number;
  /** Set when LinkedIn's resume step failed: it would send whatever resume it had selected. */
  resumeProblem?: string;
};

async function fillAndSubmit(ctx: Ctx): Promise<Outcome & { planned: Planned[] }> {
  const { page, root, resumeFile, opts } = ctx;
  const review = opts.submit === "review";
  const run: Progress = { planned: [], onPage: [], filledAs: new Map(), filled: 0 };
  const stop = (note: string) => ({ planned: run.planned, submitted: false, confirmed: false, missing: [], note });
  const attempted = new Set<string>();
  let lastSignature = "";
  let stuck = 0;
  let steps = 0;
  let resumeChosen = false;

  for (let step = 0; step < 25; step++) {
    if (!root && (await handleAuth(page))) {
      await settle(page);
      continue;
    }
    if (await hasCaptcha(page)) await ask("Captcha on screen. Solve it in the browser, then press enter.");
    if (root === linkedin.MODAL && !resumeChosen && (await linkedin.onResumeStep(page))) {
      resumeChosen = true;
      try {
        ctx.afterSubmit = await linkedin.chooseResume(page, opts.resume, resumeFile);
        run.filled++;
      } catch (e) {
        run.resumeProblem = (e instanceof Error ? e.message : String(e)).split("\n")[0];
        console.log(`  [resume] couldn't pick the resume (${run.resumeProblem}). Check it at review.`);
      }
    }

    // A few passes per page: answering one question can reveal another ("If yes, explain").
    for (let pass = 0; pass < 3; pass++) {
      const scopeText = await page.locator(root ?? "body").first().innerText().catch(() => "");
      const resumeShown = scopeText.includes(basename(resumeFile));
      const fresh = signatures(await extractFields(page, root), steps)
        .filter(({ field, sig }) => !field.filled && !attempted.has(sig) && !(field.kind === "file" && resumeShown));
      if (!fresh.length) break;
      fresh.forEach(({ sig }) => attempted.add(sig));
      const answers = await plan(fresh.map((f) => f.field), ctx.job, ctx.bank, opts.resume);
      for (const p of answers) {
        if (p.source !== "skip") {
          const error = await fillField(page, p.field, p, resumeFile);
          if (error) p.note = `fill failed: ${error}`;
          else {
            run.filled++;
            run.filledAs.set(p, await readValue(p.field));
          }
          // A beat for the form to take it in: fills racing a React re-render get dropped (Ashby).
          await page.waitForTimeout(250);
        }
        log(p);
      }
      run.planned.push(...answers);
      run.onPage.push(...answers);
      await page.waitForTimeout(500);
    }

    // Verify pass: forms re-render (Ashby resets a radio when a later field changes), so
    // re-read the page and fill again anything we answered that didn't stick. Twice at most.
    for (let check = 0; check < 2; check++) {
      const now = new Map((await extractFields(page, root)).map((f) => [f.id, f]));
      const lost = run.onPage.filter((p) => p.source !== "skip" && p.field.kind !== "file" && (p.value || p.values.length)
        && now.get(p.field.id)?.filled === false);
      if (!lost.length) break;
      for (const p of lost) {
        const error = await fillField(page, now.get(p.field.id)!, p, resumeFile);
        console.log(`  re-filled "${p.field.label.slice(0, 50)}" (it didn't stick)${error ? `: ${error}` : ""}`);
      }
      await page.waitForTimeout(500);
    }

    const signature = `${page.url()}|${(await extractFields(page, root)).map((f) => f.label).join("|")}`;
    stuck = signature === lastSignature ? stuck + 1 : 0;
    lastSignature = signature;
    const errors = await visibleErrors(page, root);
    if (stuck >= 2) {
      console.log(`  stuck on this page. Errors: ${errors.join(" / ") || "none shown"}`);
      if (opts.submit === "dry") {
        await capture(page, ctx.runDir, "stuck", root);
        return stop(`stuck: ${errors.join(" / ") || "no errors shown"}`);
      }
      if ((await ask("Fix it in the browser, then press enter (q to quit):")) === "q") return stop("quit while stuck");
      stuck = 0;
    }

    // Each filled page is kept (screenshot + HTML with the answers in it) before moving on.
    const next = await findButton(page, NEXT, root);
    if (next) {
      // This page's controls are gone after Next, so anything you changed is read now.
      if (review) await learnEdits(ctx.bank, run.onPage, run.filledAs);
      await capture(page, ctx.runDir, `step-${String(++steps).padStart(2, "0")}`, root);
      // A dry run never presses a "Next" that would actually send the form.
      await guardClick(next);
      await next.click({ timeout: 3000 }).catch(() => next.click({ force: true }));
      await settle(page);
      run.onPage = [];
      continue;
    }
    // A bare "Apply" is also how postings open their form; it only counts as Submit once something
    // was filled, and only when there's no real Submit: Greenhouse keeps the posting's "Apply" above
    // the form, and clicking it just scrolls up to First Name.
    let submitPattern = SUBMIT;
    let submitButton = await findButton(page, SUBMIT, root);
    if (!submitButton && run.filled) {
      submitPattern = SUBMIT_OR_APPLY;
      submitButton = await findButton(page, SUBMIT_OR_APPLY, root);
    }
    if (submitButton) {
      const outcome = await gate(ctx, run, submitButton, submitPattern);
      if (outcome === "rescan") continue;
      return { planned: run.planned, ...outcome };
    }
    if ((await ask("Can't find a Next or Submit button. Move the form forward in the browser, then press enter (q to quit):")) === "q") {
      return stop("quit: no Next or Submit button");
    }
  }
  throw new Error("Gave up after 25 steps");
}

/**
 * Adds a stable signature per field so a field is only answered once, even across re-scans.
 * `step` counts Next clicks, so a later step of a one-URL form can ask "Email" again.
 */
function signatures(fields: Field[], step: number) {
  const counts = new Map<string, number>();
  return fields.map((field) => {
    const base = `${step}|${field.frame.url()}|${field.kind}|${normalize(field.label)}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return { field, sig: `${base}#${n}` };
  });
}

type Outcome = { submitted: boolean; confirmed: boolean; missing: Field[]; note: string };

/**
 * What the submit gate does: stop (dry run, or an auto run that can't safely submit), ask
 * you (review), or submit (auto). Auto refuses when required fields are empty, when this
 * run filled nothing (it may be looking at a posting's Apply button, not a form), or when
 * LinkedIn's resume step failed.
 */
export function gateDecision(g: { mode: SubmitMode; missing: number; filled: number; resumeProblem?: string }):
  { action: "stop" | "ask" | "submit"; note: string } {
  if (g.mode === "dry") return { action: "stop", note: "dry run" };
  if (g.mode === "review") return { action: "ask", note: "" };
  if (g.missing) return { action: "stop", note: "auto mode: required questions it can't answer" };
  if (!g.filled) return { action: "stop", note: "auto mode: filled nothing this run, refusing to submit" };
  if (g.resumeProblem) return { action: "stop", note: `auto mode: LinkedIn resume not selected (${g.resumeProblem})` };
  return { action: "submit", note: "" };
}

/**
 * Reads the page after the submit click. New validation errors or a submit button that's
 * still there mean it didn't go through; a new thank-you (or one with the form gone) is a
 * confirmed submit; a form that's gone with no thank-you is submitted but unconfirmed.
 * `errors` should only hold errors that weren't on the page before the click.
 */
export function judgeSubmit(s: { thanks: boolean; thanksBefore: boolean; errors: string[]; submitThere: boolean }):
  { submitted: boolean; confirmed: boolean; note: string } {
  if (s.errors.length) return { submitted: false, confirmed: false, note: `submit didn't go through: ${s.errors.join(" / ").slice(0, 300)}` };
  if (s.thanks && (!s.thanksBefore || !s.submitThere)) return { submitted: true, confirmed: true, note: "submitted, confirmed" };
  if (s.submitThere) return { submitted: false, confirmed: false, note: "submit didn't go through: the submit button is still there" };
  return { submitted: true, confirmed: false, note: "submitted, no confirmation seen" };
}

/**
 * Answers on this page the site rejected after the submit click: the ones a submit error names
 * (by question), plus text answers whose box now reads empty. Location boxes are left out (they
 * need a picked suggestion, not typing), as are skipped fields and uploads.
 */
async function lostAnswers(onPage: Planned[], errors: string[]): Promise<Planned[]> {
  const named = namedInErrors(onPage, errors);
  const lost: Planned[] = [];
  for (const p of onPage) {
    if (p.source === "skip" || p.field.kind === "file" || !(p.value || p.values.length)) continue;
    if (p.field.kind === "text" && /location|city|address/i.test(p.field.label)) continue;
    if (named.includes(p)) lost.push(p);
    else if (p.field.kind === "text" || p.field.kind === "textarea") {
      const now = await readValue(p.field).catch(() => undefined);
      // undefined: the control is gone, nothing to refill.
      if (now !== undefined && !now.trim()) lost.push(p);
    }
  }
  return lost;
}

/** The answers whose question a submit error quotes ("Missing entry for required field: Phone Number"). */
export function namedInErrors<T extends { field: { label: string } }>(answers: T[], errors: string[]): T[] {
  const said = errors.map(normalize);
  return answers.filter((p) => {
    const label = normalize(p.field.label);
    return label.length >= 4 && said.some((e) => e.includes(label));
  });
}

/** Pre-ticked boxes that sign you up for something (LinkedIn's "Follow <company>", newsletters). */
const OPT_IN = /^follow\b|newsletter|marketing|job alerts?|talent (community|network)|keep me (updated|informed|posted)|subscribe/i;

/** The submit gate: review, auto-submit, or dry run. */
async function gate(ctx: Ctx, run: Progress, submitButton: Locator, submitPattern: RegExp): Promise<Outcome | "rescan"> {
  const { page, root, opts } = ctx;
  await capture(page, ctx.runDir, "review", root);
  const fields = await extractFields(page, root);
  const missing = fields.filter((f) => f.required && !f.filled);
  summarize(run.planned, missing);
  if (run.resumeProblem) console.log(`\nResume: LinkedIn's resume step failed (${run.resumeProblem}). It will send whichever resume is selected; check it.`);

  // Last duplicate check, now that we know the real form URL (a Jobright or LinkedIn listing
  // can lead to an ATS form we already applied through).
  const prior = opts.submit === "dry" ? undefined : priorApplication(ctx.job, [page.url()]);
  if (prior) {
    console.log(`  already ${prior.status} on ${prior.date}: ${prior.company} | ${prior.title}, not submitting again`);
    return { submitted: false, confirmed: false, missing, note: `duplicate of ${prior.id}` };
  }

  // Second opinion on every answer before anything is sent (settings.reviewAnswers).
  if (opts.submit !== "dry" && settings().reviewAnswers) {
    const review = await reviewAnswers(ctx.job, run.planned).catch((e: Error) => ({ approve: false, problems: [{ question: "(review)", answer: "", problem: `review failed: ${e.message.split("\n")[0]}`, fix: "check by hand" }] }));
    writeFileSync(join(ctx.runDir, "review.json"), JSON.stringify(review, null, 2));
    if (review.approve) console.log("  review: approved, every answer checks out against your facts");
    else {
      console.log(`  review: ${review.problems.length} problem(s)`);
      for (const p of review.problems) console.log(`    - ${p.question.slice(0, 70)}: ${p.problem}${p.fix ? ` (fix: ${p.fix})` : ""}`);
      if (opts.submit === "auto") {
        return { submitted: false, confirmed: false, missing, note: `review blocked: ${review.problems.map((p) => p.problem).join("; ").slice(0, 300)}` };
      }
    }
  }

  const decision = gateDecision({ mode: opts.submit, missing: missing.length, filled: run.filled, resumeProblem: run.resumeProblem });
  if (decision.action === "stop") {
    if (opts.submit === "auto") console.log(`  ${decision.note}, leaving this one unfinished`);
    return { submitted: false, confirmed: false, missing, note: decision.note };
  }
  if (decision.action === "ask") {
    const choice = (await ask("[s]ubmit, [r]escan after editing in the browser, [q]uit without submitting:")).toLowerCase();
    if (choice === "r") {
      await learnEdits(ctx.bank, run.onPage, run.filledAs);
      return "rescan";
    }
    if (choice !== "s") return { submitted: false, confirmed: false, missing, note: "quit before submitting" };
    await learnEdits(ctx.bank, run.onPage, run.filledAs);
  } else {
    for (const f of fields) {
      if (f.kind !== "checkbox" || !f.filled || f.required || !OPT_IN.test(f.label)) continue;
      const error = await fillField(page, f, { value: "no", values: [] }, "");
      console.log(`  unticked "${f.label.slice(0, 60)}"${error ? ` (failed: ${error})` : ""}`);
    }
  }

  const thanksBefore = CONFIRMED.test(await allText(page));
  const errorsBefore = new Set(await visibleErrors(page, root).catch(() => []));
  if (opts.signal?.aborted) throw new Error("run was stopped (timed out) before submitting");
  await submitButton.click();
  ctx.onClicked();
  let after = await watchSubmit(page, root, submitPattern, thanksBefore, errorsBefore);
  // Some forms (Lever's hCaptcha) challenge on submit. Only a person can clear that.
  if (after.captcha) {
    await capture(page, ctx.runDir, "captcha", root);
    if (opts.submit !== "review") {
      const note = `captcha on submit: needs you (jh apply ${ctx.job.url})`;
      console.log(`  ${note}`);
      return { submitted: false, confirmed: false, missing, note };
    }
    await ask("The site is showing a captcha. Solve it in the browser (it usually submits by itself), then press enter.");
    after = await watchSubmit(page, root, submitPattern, thanksBefore, errorsBefore);
  }
  let verdict = judgeSubmit({ ...after, thanksBefore });
  // The site says answers we filled are missing ("Missing entry for required field: Phone Number",
  // or just the question): React forms like Ashby can drop a value from their own state while the
  // box still shows it (two quick fills racing a re-render). Fill those again the way a person
  // would and submit once more, twice at most. Only when it's certain the click did nothing: same
  // page, no thank-you after a short wait.
  for (let retry = 0; retry < 2 && !verdict.submitted && after.errors.length; retry++) {
    const urlAtClick = page.url();
    await page.waitForTimeout(2500);
    // The errors were a flash during a submit that went through.
    if (!thanksBefore && CONFIRMED.test(await allText(page))) {
      verdict = { submitted: true, confirmed: true, note: "submitted, confirmed" };
      break;
    }
    if (page.url() !== urlAtClick) break;
    const lost = await lostAnswers(run.onPage, after.errors);
    const button = lost.length ? await findButton(page, submitPattern, root).catch(() => undefined) : undefined;
    if (!button) break;
    const now = new Map((await extractFields(page, root)).map((f) => [f.id, f]));
    for (const p of lost) await refill(page, now.get(p.field.id) ?? p.field, p, ctx.resumeFile);
    console.log(`  submit rejected (${after.errors[0]?.slice(0, 80)}): filled ${lost.length} lost answers again (${lost.map((p) => p.field.label.slice(0, 30)).join(", ")}), submitting again`);
    await page.waitForTimeout(1000);
    await capture(page, ctx.runDir, `submit-retry${retry ? retry + 1 : ""}`, root);
    if (opts.signal?.aborted) throw new Error("run was stopped (timed out) before resubmitting");
    await button.click();
    // Same baseline as the first click: errors that persist still count as a failed submit.
    after = await watchSubmit(page, root, submitPattern, thanksBefore, errorsBefore);
    verdict = judgeSubmit({ ...after, thanksBefore });
  }
  // The thank-you screen is the proof: let it finish rendering (or the redirect to it land)
  // before the shot.
  if (verdict.submitted) {
    await settle(page).catch(() => {});
    await page.waitForTimeout(verdict.confirmed ? 1500 : 4000);
  }
  await capture(page, ctx.runDir, verdict.submitted ? "submitted" : "submit-failed", root);
  if (!verdict.submitted) {
    console.log(`  ${verdict.note}`);
    return { submitted: false, confirmed: false, missing, note: verdict.note };
  }
  if (root) await clickButton(page, /^(done|dismiss)$/i).catch(() => false);
  bankAnswers(ctx.bank, run.planned);
  try {
    ctx.afterSubmit?.();
  } catch (e) {
    console.log(`  (couldn't save the LinkedIn resume card: ${String(e).split("\n")[0]})`);
  }
  return { submitted: true, confirmed: verdict.confirmed, missing: [], note: verdict.note };
}

/** Watches the page for up to 15s after the submit click: a new thank-you or new errors end it early. */
/** Visible text of the page and its frames: embedded forms (Stripe's Greenhouse) thank you inside the iframe. */
const allText = async (page: Page) =>
  (await Promise.all(page.frames().map((f) => f.locator("body").innerText({ timeout: 2000 }).catch(() => "")))).join("\n");

async function watchSubmit(page: Page, root: string | undefined, submitPattern: RegExp, thanksBefore: boolean, errorsBefore: Set<string>) {
  await settle(page);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const thanks = CONFIRMED.test(await allText(page));
    // A modal that closed took its form with it; errors elsewhere on the page aren't about the submit.
    const rootGone = !!root && !(await page.locator(root).count().catch(() => 0));
    const errors = rootGone ? [] : (await visibleErrors(page, root).catch(() => [])).filter((e) => !errorsBefore.has(e));
    const submitThere = !rootGone && !!(await findButton(page, submitPattern, root).catch(() => undefined));
    const captcha = await hasCaptcha(page);
    if (captcha || (thanks && !thanksBefore) || errors.length || Date.now() > deadline) return { thanks, errors, submitThere, captcha };
    await page.waitForTimeout(1000);
  }
}

/**
 * Text you changed by hand in the browser becomes the bank answer, for reusable questions.
 * Review mode only, and only for fields on the page in front of you: a field counts as edited
 * when it differs from what it read right after the harness filled it.
 */
async function learnEdits(bank: Bank, onPage: Planned[], filledAs: Map<Planned, string | undefined>) {
  for (const p of onPage) {
    if (p.source === "rule" || p.source === "resume" || p.source === "eeo") continue;
    const now = await readValue(p.field);
    const before = filledAs.has(p) ? filledAs.get(p) : p.value;
    if (now === undefined || !now.trim() || now === before || now === p.value) continue;
    p.value = now;
    p.values = [];
    p.note = "edited by you";
    if (p.reusable) remember(bank, p.field.label, now, "you");
  }
}

function bankAnswers(bank: Bank, planned: Planned[]) {
  for (const p of planned) {
    if (p.note === "edited by you" || !p.reusable || !p.value) continue;
    if (p.source !== "model" && p.source !== "bank" && p.source !== "jev") continue;
    const answer = p.values.length > 1 ? p.values.join(" | ") : p.value;
    remember(bank, p.field.label, answer, bank[normalize(p.field.label)]?.source ?? "model");
  }
}

function log(p: Planned) {
  const value = p.values.length > 1 ? p.values.join(", ") : p.value;
  const short = value.length > 70 ? `${value.slice(0, 67)}...` : value;
  console.log(`  [${p.source.padEnd(6)}] ${p.field.label.slice(0, 60)} -> ${short || "(blank)"}${p.note ? `  (${p.note})` : ""}`);
}

function summarize(planned: Planned[], missing: Field[]) {
  const model = planned.filter((p) => p.source === "model" || p.source === "jev");
  if (model.length) {
    console.log("\nModel and Jev answers to check:");
    for (const p of model) console.log(`  - ${p.field.label.slice(0, 80)}\n    ${p.value.replace(/\n/g, "\n    ")}${p.reusable ? "" : "  [this job only]"}`);
  }
  const notes = planned.filter((p) => p.note && p.source !== "model");
  if (notes.length) console.log(`\nNotes:\n${notes.map((p) => `  - ${p.field.label.slice(0, 80)}: ${p.note}`).join("\n")}`);
  if (missing.length) console.log(`\nRequired and still empty:\n${missing.map((f) => `  - ${f.label.slice(0, 100)}`).join("\n")}`);
}

/** Runs bookkeeping that must not fail a run after submitting, logging what went wrong. */
function safely(what: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.log(`  (couldn't ${what}: ${String(e).split("\n")[0]})`);
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
