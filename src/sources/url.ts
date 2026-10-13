// URL identity for postings, kept free of other imports so the tracker can use it too.

/** One URL per posting, so the same LinkedIn job from a search and from Jobright dedupes. */
export function canonical(url: string): string {
  const id = url.match(/linkedin\.com\/jobs\/view\/(?:[^/?]*-)?(\d+)/)?.[1] ?? url.match(/[?&]currentJobId=(\d+)/)?.[1];
  if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
  if (!URL.canParse(url)) return url;
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key)) u.searchParams.delete(key);
  return u.toString();
}

/**
 * Company + title as one role, so the same job posted in several cities, or listed by several
 * sources under slightly different company names ("Affirm, Inc.", "11x.ai"), counts once.
 */
export function roleKey(company: string, title: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${companyKey(company)}|${norm(title)}`;
}

/**
 * A stable identity for a posting, whatever URL it was reached by: the job board's own id
 * when the URL has one (Jobright, Tsenta, LinkedIn, Greenhouse incl. embeds, Lever, Ashby, Workday,
 * Rippling, SmartRecruiters), else host + path without query, case or trailing slash.
 */
export function postingKey(url: string): string {
  if (!URL.canParse(url)) return url.toLowerCase();
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");
  const linkedin = canonical(url).match(/linkedin\.com\/jobs\/view\/(\d+)/)?.[1];
  if (linkedin) return `linkedin:${linkedin}`;
  const id = (re: RegExp) => path.match(re)?.[1];
  if (host.endsWith("tsenta.com")) return `tsenta:${id(/\/jobs\/(?:.*-)?([0-9a-f]{8}-[0-9a-f-]{27})$/i)?.toLowerCase() ?? path}`;
  if (host.endsWith("jobright.ai")) return `jobright:${id(/\/jobs\/info\/([a-z0-9]+)/i) ?? path}`;
  if (host.includes("greenhouse")) {
    const gh = u.searchParams.get("gh_jid") ?? u.searchParams.get("token") ?? id(/\/jobs\/(\d+)/);
    if (gh) return `greenhouse:${gh}`;
  }
  if (u.searchParams.get("gh_jid")) return `greenhouse:${u.searchParams.get("gh_jid")}`;
  const uuid = id(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuid && /lever\.co|ashbyhq\.com|rippling|smartrecruiters/.test(host)) return `${host.split(".").at(-2)}:${uuid.toLowerCase()}`;
  // Workday req ids end the job slug ("..._JR2020271", "..._R-12345"), before any /apply/... suffix.
  const workday = host.includes("myworkdayjobs") ? id(/_([A-Z]{0,4}-?\d{3,}(?:-\d+)?)(?:\/apply.*)?$/i) : undefined;
  if (workday) return `workday:${host.split(".")[0]}:${workday.toLowerCase()}`;
  return `${host}${path.replace(/\/(apply|application)$/i, "")}`.toLowerCase();
}

const TITLE_NOISE = new Set(["and", "or", "the", "a", "an", "of", "for", "to", "in", "at", "with", "remote", "hybrid", "onsite", "canada", "usa", "us", "role", "position"]);
const COMPANY_NOISE = /\b(inc|incorporated|ltd|limited|llc|corp|corporation|co|company|plc|gmbh|technologies|technology|labs)\b\.?/g;

const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").split(" ").filter((w) => w && !TITLE_NOISE.has(w)));

/** A company name without legal suffixes, a domain ending, parentheticals or punctuation: "11x.ai" and "11x, Inc." are both "11x". */
function companyKey(name: string): string {
  const key = name.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\.(ai|io|com|co|dev|app|so|xyz|tech|net|org)\b/g, " ")
    .replace(COMPANY_NOISE, " ").replace(/[^\p{L}\p{N}]+/gu, "");
  return key || name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Company names that differ only by suffixes, domain endings and punctuation ("Affirm, Inc." vs "Affirm", "11x.ai" vs "11x"). */
export function sameCompany(a: string, b: string): boolean {
  return !!companyKey(a) && companyKey(a) === companyKey(b);
}

/**
 * Titles that name the same role: word overlap (Jaccard) of at least 0.75 after dropping
 * filler and locations. "Software Engineer II" vs "Senior Software Engineer" is 0.5, so a
 * different level stays a different job.
 */
export function similarTitle(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.75;
}
