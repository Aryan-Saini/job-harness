import { hostname } from "node:os";
import { apply, type ApplyResult, type SubmitMode } from "./apply.ts";
import { isResumeId, localDay, TZ } from "./config.ts";
import { all, exec } from "./db.ts";
import { checkFit } from "./fit.ts";
import { jevClient } from "./jev.ts";
import { guestJob } from "./linkedin.ts";
import type { Job } from "./planner.ts";
import { DEFAULTS, settings } from "./settings.ts";
import { canonical, discover, type Posting } from "./sources/index.ts";
import { htmlText, sleep } from "./sources/linkedin.ts";
import { flushUsage } from "./usage.ts";

// The long-running loop: find new postings, ask Jev about each, queue the ones worth it. In auto
// mode it also applies to the queue, best fit first, up to maxPerDay. In review mode it only
// queues, and `jh next` works through the queue with you. A job is claimed atomically before
// it's applied to, so two runners never take the same one; a claim older than CLAIM_TTL_MS is
// assumed dead and requeued.

/** `submit` overrides the setting for this process; undefined follows settings().submit live. */
export type RunOpts = { submit?: SubmitMode; headless: boolean; cdp?: string };
export type Summary = { discovered: number; fitChecked: number; queued: number; applied: number; unconfirmed: number; failed: number; skipped: number };
/** check: submitted but no confirmation page was seen, look at it by hand. */
export type QueueStatus = "queued" | "applying" | "done" | "check" | "failed" | "skipped";
export type QueueRow = {
  url: string;
  title: string;
  company: string;
  location: string;
  source: Posting["source"];
  fit_verdict: string;
  fit_score: number;
  status: QueueStatus;
  added_at: string;
  updated_at: string;
  note: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
};

const now = () => new Date().toISOString();
/** Local time for log lines: "Oct 10, 1:57 PM". */
const stamp = () => new Date().toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CLAIM_TTL_MS = 2 * 60 * 60_000;
const APPLY_TIMEOUT_MS = 15 * 60_000;
/** Who holds a claim: host and pid. */
const OWNER = `${hostname().split(".")[0]}:${process.pid}`;

/** Takes the best queued job and marks it applying in one statement. Undefined when the queue is empty. */
export function claimNext(owner = OWNER): QueueRow | undefined {
  const at = now();
  return all<QueueRow>(
    `UPDATE job_queue SET status = 'applying', claimed_by = ?, claimed_at = ?, updated_at = ?
     WHERE url = (SELECT url FROM job_queue WHERE status = 'queued' ORDER BY fit_score DESC, added_at ASC LIMIT 1)
       AND status = 'queued'
     RETURNING *`,
    owner, at, at,
  )[0];
}

/** Puts back jobs whose claim is older than CLAIM_TTL_MS (the runner holding them died). */
export function requeueStale(ttlMs = CLAIM_TTL_MS) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  exec([`UPDATE job_queue SET status = 'queued', claimed_by = NULL, claimed_at = NULL, note = 'requeued: claim expired', updated_at = ?
         WHERE status = 'applying' AND coalesce(claimed_at, updated_at) < ?`, [now(), cutoff]]);
}

export function markQueued(url: string, status: QueueStatus, note?: string) {
  exec(["UPDATE job_queue SET status = ?, note = coalesce(?, note), updated_at = ? WHERE url = ?", [status, note, now(), url]]);
}

/** The listing text for a fit check: LinkedIn's guest endpoint, else the page as plain text. */
async function readPosting(p: Posting): Promise<Job | undefined> {
  if (/linkedin\.com\/jobs\/view\//.test(p.url)) {
    const job = await guestJob(p.url);
    return job && { ...job, title: job.title || p.title, company: job.company || p.company, location: job.location || p.location };
  }
  const html = await fetch(p.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const text = htmlText(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  const description = text.length > 500 ? text : p.description;
  return description ? { url: p.url, title: p.title, company: p.company, location: p.location, description } : undefined;
}

/** Submissions the harness made today. */
const appliedToday = () =>
  all<{ n: number }>("SELECT count(DISTINCT application_id) AS n FROM application_history WHERE date = ? AND note = 'submit clicked'", localDay())[0]?.n ?? 0;

/** The browser couldn't start at all: retrying more jobs now would only fail them too. */
const browserDown = (message = "") => /launchPersistentContext|Target page, context or browser has been closed/.test(message);

/** Rejects after `ms` and aborts `work`'s signal, so the run stops instead of carrying on unseen. */
function deadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const abort = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Tell the run to stop too: it closes its tab and can never click Submit after this.
      abort.abort();
      reject(new Error(`${what} timed out after ${Math.round(ms / 60_000)} min`));
    }, ms);
  });
  return Promise.race([work(abort.signal), timeout]).finally(() => clearTimeout(timer));
}

/** Where a finished application leaves its queue row. */
export function outcome(result: ApplyResult): [QueueStatus, string | undefined] {
  if (result.submitted) return result.confirmed ? ["done", undefined] : ["check", "submitted, no confirmation seen: check it by hand"];
  if (result.skipped) return ["skipped", result.note || "already applied"];
  // A click the site didn't accept is worth a human look; anything else waits on jh questions.
  if (/didn't go through/.test(result.note)) return ["check", result.note];
  return ["failed", `not submitted: ${result.note || "required fields left"} (jh questions)`];
}

/** One sweep: discover, fit check, queue, then (auto or dry mode) apply. */
export async function runOnce(opts: RunOpts): Promise<Summary> {
  const s = settings();
  if (!isResumeId(s.resume)) throw new Error(`Unknown resume "${s.resume}" in settings (jh resumes)`);
  if (!jevClient()) throw new Error("Jev isn't configured (TYPESAFE_API_KEY or ~/.jh/typesafe.key), so nothing can be fit checked");
  const summary: Summary = { discovered: 0, fitChecked: 0, queued: 0, applied: 0, unconfirmed: 0, failed: 0, skipped: 0 };
  requeueStale();

  const postings = await discover({ cdp: opts.cdp });
  summary.discovered = postings.length;
  for (const p of postings) {
    try {
      const job = await readPosting(p);
      // Unreadable now (often a LinkedIn 429): not recorded anywhere, so the next sweep retries it.
      if (!job) continue;
      const fit = await checkFit(job, s.resume);
      if (!fit) continue;
      summary.fitChecked++;
      if (fit.verdict === "skip" || (fit.verdict === "maybe" && s.minFit === "apply")) {
        summary.skipped++;
        continue;
      }
      exec([
        `INSERT OR IGNORE INTO job_queue (url, title, company, location, source, fit_verdict, fit_score, status, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [p.url, job.title, job.company, job.location, p.source, fit.verdict, fit.score, now(), now()],
      ]);
      summary.queued++;
    } catch (error) {
      console.log(`  fit check failed for ${p.url}: ${String(error).split("\n")[0]}`);
    } finally {
      if (p.source === "linkedin") await sleep(1000);
    }
  }
  flushUsage();
  await applyQueue(() => opts.submit ?? settings().submit, opts, summary);
  return summary;
}

/**
 * Applies to queued jobs up to the daily cap, in auto mode (a dry run tries one job). Review mode
 * applies nothing: `jh next` is how you work the queue. The mode is re-read before each job, so
 * `jh set submit review` stops a live auto runner.
 */
async function applyQueue(mode: () => SubmitMode, opts: RunOpts, summary: Summary) {
  let budget = mode() === "dry" ? 1 : settings().maxPerDay - appliedToday();
  while (budget > 0) {
    const submit = mode();
    if (submit === "review") break;
    const row = claimNext();
    if (!row) break;
    budget--;
    try {
      const result = await deadline(
        (signal) => apply({ signal, url: canonical(row.url), resume: settings().resume, submit, unattended: true, browser: { headless: opts.headless, cdp: opts.cdp }, fit: false }),
        APPLY_TIMEOUT_MS, "apply",
      );
      // Dry runs put the one job they tried back in the queue.
      if (submit === "dry") {
        markQueued(row.url, "queued", "dry run filled it");
        continue;
      }
      const [status, note] = outcome(result);
      if (status === "done") summary.applied++;
      else if (status === "check") summary.unconfirmed++;
      else if (status === "skipped") summary.skipped++;
      else summary.failed++;
      markQueued(row.url, status, note);
    } catch (error) {
      const message = String(error).split("\n")[0]?.slice(0, 500);
      // The browser itself failed: nothing was submitted, so the job goes back in the queue.
      if (browserDown(message)) {
        markQueued(row.url, "queued", `browser unavailable, will retry: ${message}`);
        console.log(`  browser unavailable, applying paused: ${message}`);
        break;
      }
      summary.failed++;
      markQueued(row.url, submit === "dry" ? "queued" : "failed", message);
      // A hung apply may still hold the browser profile; leave the rest for the next sweep.
      if (message?.includes("timed out")) break;
    }
  }
}

/** runOnce every settings().intervalMinutes, one line per sweep. Nothing a sweep throws stops the loop. */
export async function runForever(opts: RunOpts): Promise<never> {
  for (;;) {
    const started = Date.now();
    try {
      const r = await runOnce(opts);
      console.log(`${stamp()} sweep: ${r.discovered} new, ${r.fitChecked} fit checked, ${r.queued} queued, ${r.applied} applied, ${r.unconfirmed} unconfirmed, ${r.failed} failed, ${r.skipped} skipped (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (error) {
      console.log(`${stamp()} sweep failed: ${String(error).split("\n")[0]}`);
    }
    let minutes = DEFAULTS.intervalMinutes;
    try {
      minutes = settings().intervalMinutes;
    } catch {}
    await sleep(minutes * 60_000);
  }
}
