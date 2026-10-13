import { openBrowser } from "../browser.ts";
import type { Posting } from "./index.ts";

// Jobright (jobright.ai) recommendations for your account. There's no public API, so this
// opens the recommend page in the harness's own Chrome profile (log in once with
// `jh open https://jobright.ai`) and reads the JSON the page itself fetches while scrolling.
//
// What the JS bundles (static.jobright.ai/_next) and the public endpoints show:
// - GET /swan/recommend/list/jobs?count=10&position=&sortCondition=&refresh= is the logged-in
//   feed. Logged out it answers 401 {"success":false,"errorCode":41001,"errorMsg":"Cookie not found"}.
// - GET /swan/recommend/landing/jobs and POST /swan/recommend/visitor-list/jobs are the logged-out
//   feeds (generic, not yours), so they're ignored. /swan/agent/job/list is the agent's picks.
// - Responses are {success, errorCode, result: {jobList: [{jobResult, companyResult, displayScore, jobNotes}]}}.
//   jobResult: jobId (24-char hex), jobTitle, jobLocation, isRemote, workModel, publishTime
//   ("2026-10-10 17:29:52"), jobSummary, coreResponsibilities[], qualifications, applyLink,
//   originalUrl, url. companyResult: companyName, companyURL, companyLinkedinURL.
// - The UI applies via jobResult.applyLink ?? jobResult.originalUrl. In the public feed both point
//   back at https://jobright.ai/jobs/info/<id>; logged in they can be the employer's own page.

const RECOMMEND = "https://jobright.ai/jobs/recommend";
const FEEDS = /jobright\.ai\/swan\/(recommend\/(?!landing|visitor|count)|agent\/job\/list)/;
const SCROLLS = 5;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const external = (u: string) => URL.canParse(u) && /^https?:$/.test(new URL(u).protocol) && !/(^|\.)jobright\.ai$/.test(new URL(u).hostname);

/** One job list item (or a bare job object) to a posting, or undefined if it isn't one. */
function toPosting(item: unknown): Posting | undefined {
  if (!isObj(item)) return undefined;
  const job = isObj(item.jobResult) ? item.jobResult : item;
  const companyObj = isObj(item.companyResult) ? item.companyResult : isObj(job.company) ? job.company : undefined;
  const id = str(job.jobId ?? job.id);
  const title = str(job.jobTitle ?? job.title);
  const company = str(companyObj?.companyName ?? companyObj?.name ?? job.companyName ?? job.company);
  if (!id || !title || !company) return undefined;
  const apply = [job.applyLink, job.originalUrl, job.applyUrl, job.url].map(str).find(external);
  const summary = [str(job.jobSummary), ...(Array.isArray(job.coreResponsibilities) ? job.coreResponsibilities.map(str) : []), str(job.qualifications)];
  return {
    url: apply ?? `https://jobright.ai/jobs/info/${id}`,
    title,
    company,
    location: str(job.jobLocation ?? job.location) || (job.isRemote === true ? "Remote" : ""),
    postedAt: str(job.publishTime) || undefined,
    source: "jobright",
    description: summary.filter(Boolean).join("\n") || undefined,
  };
}

/** Every job found anywhere in a response body: any array whose items look like jobs. */
export function extractJobs(body: unknown): Posting[] {
  if (Array.isArray(body)) {
    const jobs = body.map(toPosting).filter((p) => p !== undefined);
    return jobs.length ? jobs : body.flatMap(extractJobs);
  }
  return isObj(body) ? Object.values(body).flatMap(extractJobs) : [];
}

/**
 * Your Jobright recommendations, or [] (with one log line) when the profile isn't logged in
 * or the browser won't start (say, the profile is open in another run).
 */
export async function jobrightPostings(headless = true, cdp?: string): Promise<Posting[]> {
  const found = new Map<string, Posting>();
  // With cdp, read the feed in a tab of an already logged-in Chrome.
  const opened = await openBrowser({ headless, cdp }).catch((error: unknown) => {
    console.log(`jobright: couldn't open the browser: ${String(error).split("\n")[0]}`);
    return undefined;
  });
  if (!opened) return [];
  const { page, close } = opened;
  page.on("response", async (res) => {
    if (!FEEDS.test(res.url()) || !res.ok()) return;
    for (const p of extractJobs(await res.json().catch(() => undefined))) found.set(p.url, p);
  });
  try {
    await page.goto(RECOMMEND, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(5000);
    if (!/login|sign-?in|signup/i.test(page.url()) && found.size) {
      for (let i = 0; i < SCROLLS; i++) {
        // The list scrolls inside its own container, so scroll every scrollable element.
        await page.evaluate(() => {
          for (const el of document.querySelectorAll<HTMLElement>("*")) if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(2500);
      }
    }
  } catch (error) {
    console.log(`jobright: ${String(error).split("\n")[0]}`);
  } finally {
    await close();
  }
  if (!found.size) console.log("jobright: not logged in, run: jh open https://jobright.ai");
  return [...found.values()];
}
