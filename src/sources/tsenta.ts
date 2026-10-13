import { openBrowser } from "../browser.ts";
import type { Posting } from "./index.ts";
import { htmlText } from "./linkedin.ts";

// Tsenta (tsenta.com, YC) matched jobs for your account. Tsenta watches company career pages
// and ranks new roles against your resume. The public board (tsenta.com/jobs) is server-rendered
// HTML, unpersonalized, and hides the employer link, so this reads the logged-in feed instead:
// it opens the dashboard's "Browse jobs" page in the harness's own Chrome profile (log in once with
// `jh open https://dashboard.tsenta.com`) and keeps the JSON the page itself fetches. The account is
// the agent mailbox's (login saved under dashboard.tsenta.com in data/logins.age).
//
// What the dashboard bundles (dashboard.tsenta.com/assets) show:
// - GET https://api.autojobs.me/api/v1/jobs/recommendations?limit=20&page=1&datePosted=7d&... is
//   the feed. Its filters (locations=country:CA, autoApplyOnly, ...) are saved server side per
//   account (PUT /users/<uid>/feed-filters), so change them in the dashboard. It needs a Firebase bearer token;
//   without one it answers 401 {"message":"Unauthorized: Bearer token is required"}.
//   /recommendations/count and /recommendations/sources are counters and source toggles, ignored.
// - Responses are {data: [job], pagination: {page, limit, total}}. A job has id (uuid), title,
//   companyName, companyWebsite, url (the employer's own posting: Ashby, Greenhouse, Workday, Dover,
//   Workable, ...), locations[], workplaceType (ONSITE/REMOTE/HYBRID), datePosted (ISO), matchScore,
//   atsType, jobType, salary*. No description in the feed.
// - tsenta.com/jobs/<uuid> opens the public page for a job, used when there's no employer URL.

const FEED_PAGE = "https://dashboard.tsenta.com/dashboard/recommendations";
const FEED = /\/api\/v1\/jobs\/recommendations(?!\/)/;
const SCROLLS = 3;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const external = (u: string) =>
  URL.canParse(u) && /^https?:$/.test(new URL(u).protocol) && !/(^|\.)(tsenta\.com|autojobs\.me)$/.test(new URL(u).hostname);

/** One feed job to a posting, or undefined if it isn't one. Company and title stay as the employer wrote them. */
function toPosting(job: unknown): Posting | undefined {
  if (!isObj(job)) return undefined;
  const id = str(job.id ?? job.jobId);
  const title = str(job.title ?? job.jobTitle);
  const company = str(job.companyName ?? job.company);
  if (!id || !title || !company) return undefined;
  const apply = [job.url, job.jobUrl, job.applicationUrl, job.applyUrl].map(str).find(external);
  const locations = Array.isArray(job.locations) ? job.locations.map(str).filter(Boolean) : [str(job.location)].filter(Boolean);
  const description = htmlText(str(job.description));
  return {
    url: apply ?? `https://tsenta.com/jobs/${id}`,
    title,
    company,
    location: locations.join("; ") || (job.workplaceType === "REMOTE" ? "Remote" : ""),
    postedAt: str(job.datePosted) || undefined,
    source: "tsenta",
    description: description || undefined,
  };
}

/** The postings in one /jobs/recommendations response body ({data: [...]}, or a bare array). */
export function tsentaJobs(body: unknown): Posting[] {
  const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.data) ? body.data : [];
  return list.map(toPosting).filter((p) => p !== undefined);
}

/**
 * Your Tsenta matches, or [] (with one log line) when the profile isn't logged in or the
 * browser won't start. Loads the feed page and scrolls a few times, one page of 20 per scroll.
 */
export async function tsentaPostings(headless = true, cdp?: string): Promise<Posting[]> {
  const found = new Map<string, Posting>();
  const opened = await openBrowser({ headless, cdp }).catch((error: unknown) => {
    console.log(`tsenta: couldn't open the browser: ${String(error).split("\n")[0]}`);
    return undefined;
  });
  if (!opened) return [];
  const { page, close } = opened;
  page.on("response", async (res) => {
    if (!FEED.test(res.url()) || !res.ok()) return;
    for (const p of tsentaJobs(await res.json().catch(() => undefined))) found.set(p.url, p);
  });
  try {
    await page.goto(FEED_PAGE, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(6000);
    if (found.size) {
      for (let i = 0; i < SCROLLS; i++) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll<HTMLElement>("*")) if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(2500);
      }
    }
  } catch (error) {
    console.log(`tsenta: ${String(error).split("\n")[0]}`);
  } finally {
    await close();
  }
  if (!found.size) console.log("tsenta: not logged in, run: jh open https://dashboard.tsenta.com");
  return [...found.values()];
}
