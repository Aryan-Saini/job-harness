import { kvGet, kvSet } from "../db.ts";
import { settings } from "../settings.ts";
import type { Posting } from "./index.ts";

// LinkedIn's public guest job search: no login, no browser. Each request returns up to 10
// <li> cards (the page size is 10, not 25). To keep your IP out of trouble it
// stays gentle: a few slow requests per sweep, rotating through search x location across sweeps,
// and after a 429 it leaves LinkedIn alone for hours (doubling each time, up to a day).

const SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const PAGE = 10;
/** Requests per sweep. Every search x location is covered over several sweeps. */
const PER_SWEEP = 6;
const DELAY_MS = 12_000;
const BACKOFF_HOURS = [3, 6, 12, 24];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tag-stripped, entity-decoded, whitespace-collapsed text. */
export const htmlText = (s = "") => s.replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ").trim();

/** Search result HTML to postings. Cards without an id or title are dropped. */
export function parseCards(html: string): Posting[] {
  return html.split(/<li[\s>]/).flatMap((card): Posting[] => {
    const id = card.match(/urn:li:jobPosting:(\d+)/)?.[1];
    const title = htmlText(card.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
    if (!id || !title) return [];
    return [{
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      title,
      company: htmlText(card.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/)?.[1]),
      location: htmlText(card.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/)?.[1]),
      postedAt: card.match(/<time[^>]*datetime="([^"]+)"/)?.[1],
      source: "linkedin",
    }];
  });
}

type Backoff = { until: number; strikes: number };

/**
 * The next few search x location pairs (newest postings first, one page each), deduped by job
 * id. Returns [] while backing off from a 429.
 */
export async function linkedinPostings(): Promise<Posting[]> {
  const backoff = kvGet<Backoff>("linkedin-backoff");
  if (backoff && Date.now() < backoff.until) {
    console.log(`linkedin: resting after a 429 until ${new Date(backoff.until).toLocaleTimeString()}`);
    return [];
  }
  const { searches, locations, maxAgeHours } = settings();
  const pairs = searches.flatMap((keywords) => locations.map((location) => ({ keywords, location })));
  const cursor = kvGet<number>("linkedin-cursor") ?? 0;
  const found = new Map<string, Posting>();
  for (let i = 0; i < Math.min(PER_SWEEP, pairs.length); i++) {
    const { keywords, location } = pairs[(cursor + i) % pairs.length]!;
    const params = new URLSearchParams({ keywords, location, f_TPR: `r${Math.round(maxAgeHours * 3600)}`, sortBy: "DD", start: "0" });
    const res = await fetch(`${SEARCH}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (res?.status === 429) {
      const strikes = Math.min((backoff?.strikes ?? 0) + 1, BACKOFF_HOURS.length);
      kvSet("linkedin-backoff", { until: Date.now() + BACKOFF_HOURS[strikes - 1]! * 3_600_000, strikes });
      kvSet("linkedin-cursor", (cursor + i) % pairs.length);
      console.log(`linkedin: rate limited (429), resting ${BACKOFF_HOURS[strikes - 1]}h, kept ${found.size} postings`);
      return [...found.values()];
    }
    if (res?.ok) for (const p of parseCards(await res.text().catch(() => ""))) found.set(p.url, p);
    await sleep(DELAY_MS + Math.random() * 8_000);
  }
  kvSet("linkedin-cursor", (cursor + PER_SWEEP) % pairs.length);
  if (backoff) kvSet("linkedin-backoff", { until: 0, strikes: Math.max(backoff.strikes - 1, 0) });
  return [...found.values()];
}
