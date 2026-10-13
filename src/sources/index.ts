import { all, exec } from "../db.ts";
import { settings, type Settings } from "../settings.ts";
import { jobrightPostings } from "./jobright.ts";
import { linkedinPostings } from "./linkedin.ts";
import { tsentaPostings } from "./tsenta.ts";
import { canonical, postingKey, roleKey } from "./url.ts";

export { canonical, roleKey };

// Where the runner finds postings. Each source returns what it sees; discover() merges them
// and drops anything filtered by settings or already seen (fit checked, applied, or queued).

export type Posting = {
  url: string;
  title: string;
  company: string;
  location: string;
  postedAt?: string;
  source: "linkedin" | "jobright" | "tsenta";
  /** Listing text when the source hands it over (Jobright's summary), used if the page can't be read. */
  description?: string;
};

/** Settings filters: skipTitleWords as whole words, skipCompanies as substrings, both case-insensitive. */
export function wanted(p: Posting, s: Pick<Settings, "skipTitleWords" | "skipCompanies"> = settings()): boolean {
  const title = p.title.toLowerCase();
  const company = p.company.toLowerCase();
  const word = (w: string) => new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(title);
  return !s.skipTitleWords.some(word) && !s.skipCompanies.some((c) => c && company.includes(c.toLowerCase()));
}

/**
 * New postings from every enabled source, filtered and deduped against everything seen before
 * (by URL, and by company + title). Each source fails on its own, so one broken source never
 * loses the others' results. Jobright and Tsenta run headless unless `headless: false` is passed,
 * one after the other since both open the same Chrome profile.
 */
export async function discover(opts: { headless?: boolean; cdp?: string } = {}): Promise<Posting[]> {
  const { sources } = settings();
  const headless = opts.headless ?? true;
  const jobright = sources.includes("jobright") ? jobrightPostings(headless, opts.cdp) : Promise.resolve([]);
  const batches = await Promise.allSettled([
    sources.includes("linkedin") ? linkedinPostings() : [],
    jobright,
    sources.includes("tsenta") ? jobright.catch(() => []).then(() => tsentaPostings(headless, opts.cdp)) : [],
  ]);
  const names = ["linkedin", "jobright", "tsenta"] as const;
  const postings = batches.flatMap((b, i) => {
    if (b.status === "fulfilled") return b.value;
    console.log(`${names[i]}: ${String(b.reason).split("\n")[0]}`);
    return [];
  });
  const rows = all<{ url: string | null; company: string | null; title: string | null }>(
    `SELECT url, company, title FROM fit_checks UNION SELECT url, company, title FROM applications
     UNION SELECT url, company, title FROM job_queue UNION SELECT url, NULL, NULL FROM application_urls`,
  );
  // Seen = same posting id (any URL form), or the same company + title.
  const seen = new Set(rows.flatMap((r) => [
    ...(r.url ? [postingKey(r.url)] : []),
    ...(r.company && r.title ? [roleKey(r.company, r.title)] : []),
  ]));
  // The same role is often posted once per city; the tracker treats company + title as one job.
  const fresh = new Map<string, Posting>();
  for (const p of postings) {
    const url = canonical(p.url);
    const key = postingKey(url);
    const role = roleKey(p.company, p.title);
    if (!seen.has(key) && !seen.has(role) && wanted(p)) fresh.set(url, { ...p, url });
    seen.add(key).add(role);
  }
  // One line per sweep so a quiet source (logged out, all overlap) is visible in the log.
  console.log(`sources: ${names.map((n, i) => {
    const got = batches[i]?.status === "fulfilled" ? (batches[i] as PromiseFulfilledResult<Posting[]>).value : [];
    return `${n} ${got.length} (${got.filter((p) => fresh.has(canonical(p.url))).length} new)`;
  }).join(", ")}`);
  return [...fresh.values()];
}
