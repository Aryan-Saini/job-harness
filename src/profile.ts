import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { paths, TZ } from "./config.ts";

// Your hard facts, from ~/.jh/profile.json. Rules here answer the questions every form asks
// with no model call. Anything not covered falls through to the answer bank, then Jev, then
// the model (which reads all of context.md).

const month = z.string().describe('e.g. "September"');
const year = z.string().describe('e.g. "2022"');

export const profileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  pronouns: z.string().default(""),
  /** Used on every form and for new site accounts. */
  email: z.email(),
  phone: z.string(),
  linkedin: z.string().default(""),
  github: z.string().default(""),
  /** Portfolio or personal site. Falls back to github on "Website" fields. */
  website: z.string().default(""),
  address: z.object({
    street: z.string(),
    city: z.string(),
    /** Province or state, written out: "British Columbia", "California". */
    region: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  education: z.object({
    school: z.string(),
    degree: z.string(),
    major: z.string(),
    start: z.object({ month, year }),
    /** Graduation, or expected graduation. */
    end: z.object({ month, year }),
  }),
  workAuthorization: z.object({
    /** Countries you can work in without sponsorship, e.g. ["Canada"] or ["United States"]. */
    authorizedIn: z.array(z.string()).min(1),
    /** One line for forms and models, e.g. "Canadian citizen. Would need sponsorship for the US." */
    summary: z.string(),
  }),
  /** Years of professional experience, for forms that ask. */
  yearsExperience: z.number(),
  /** What to say about salary when the posting gives no range, e.g. "$80,000 to $90,000 CAD". */
  salary: z.string(),
  /**
   * Voluntary demographic (EEO) questions. "decline" picks "prefer not to say" everywhere. Or give
   * your answers in plain words, e.g. { "gender": "Woman", "veteran": "Not a veteran" }, and the
   * fill model picks the matching option.
   */
  eeo: z.union([z.literal("decline"), z.record(z.string(), z.string())]).default("decline"),
});
export type Profile = z.infer<typeof profileSchema>;

let cached: Profile | undefined;

/** Your profile.json, validated. Throws with what's wrong (or "run jh init") when it can't be used. */
export function profile(): Profile {
  if (cached) return cached;
  if (!existsSync(paths.profile)) throw new Error(`No profile at ${paths.profile}. Run \`jh init\` first.`);
  const parsed = profileSchema.safeParse(JSON.parse(readFileSync(paths.profile, "utf8")));
  if (!parsed.success) throw new Error(`${paths.profile} has problems:\n${z.prettifyError(parsed.error)}`);
  cached = parsed.data;
  return cached;
}

export const fullName = (p = profile()) => `${p.firstName} ${p.lastName}`;
export const location = (p = profile()) => `${p.address.city}, ${p.address.region}, ${p.address.country}`;

/** What a rule may look at beyond the label: the posting's text and the field's kind. */
export type RuleContext = { description?: string; kind?: string; hint?: string; now?: Date };

/** `section` limits a rule to fields under a matching heading; `notSection` keeps it out of some. */
type Rule = { match: RegExp; answer: string | ((ctx: RuleContext) => string); section?: RegExp; notSection?: RegExp };

const MONTH_OR_SEASON = "20\\d\\d|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter";
// "start date: January 2027", "starting in summer 2027", "positions begin September", "2027 start".
const NAMED_START = new RegExp(`\\b(start(s|ing)?|begin(s|ning)?|commenc\\w*)\\b[^.\\n]{0,40}\\b(${MONTH_OR_SEASON})\\b|\\b(${MONTH_OR_SEASON})\\b[^.\\n]{0,15}\\bstart\\b`, "i");

/**
 * When you can start: "Immediately" when the posting names its own start date, else two weeks
 * from today. A field that wants a date (a date input, or a hint like "mm/dd/yyyy") gets one in
 * its format, today when the answer is immediately.
 */
export function startDate({ description = "", kind = "text", hint = "", now = new Date() }: RuleContext = {}): string {
  const named = NAMED_START.test(description);
  const day = new Date(now.getTime() + (named ? 0 : 14 * 86_400_000));
  const [y, m, d] = day.toLocaleDateString("en-CA", { timeZone: TZ }).split("-");
  if (kind === "date" || /yyyy-mm-dd/i.test(hint)) return `${y}-${m}-${d}`;
  if (/mm\/dd\/yyyy/i.test(hint)) return `${m}/${d}/${y}`;
  if (/dd\/mm\/yyyy/i.test(hint)) return `${d}/${m}/${y}`;
  return named ? "Immediately" : day.toLocaleDateString("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" });
}

const EDUCATION = /educat|school|degree|universit|college|academic/i;
const HISTORY = /educat|school|universit|experience|employment|work history|previous (job|role|employer)/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase();

/**
 * Ordered: first match wins. Patterns run against the normalized label (see normalize()).
 * Only questions with exactly one right answer belong here.
 */
export function rules(p = profile()): Rule[] {
  const { address: a, education: e } = p;
  const country = new RegExp(`\\b${escape(a.country)}\\b`);
  return [
    { match: /^(legal )?first name|^given name|^preferred first name/, answer: p.firstName },
    { match: /^(legal )?last name|^surname|^family name/, answer: p.lastName },
    { match: /^(full |legal )?name$|^your name$/, answer: fullName(p) },
    ...(p.pronouns ? [{ match: /^pronouns?$/, answer: p.pronouns }] : []),
    { match: /^e ?mail( address)?$|^confirm e ?mail/, answer: p.email },
    { match: /^(mobile |cell |primary )?phone( number)?$/, answer: p.phone },
    ...(p.linkedin ? [{ match: /linkedin/, answer: p.linkedin }] : []),
    ...(p.github ? [{ match: /github/, answer: p.github }] : []),
    ...(p.website || p.github ? [{ match: /^(website|portfolio|personal website|other website)/, answer: p.website || p.github }] : []),
    { match: /^(street |home |mailing |current )?address( line)?( 1)?$|^street( address)?$/, answer: a.street },
    { match: /^(postal|zip)( code)?$|^postal ?code ?\/ ?zip|^zip ?\/ ?postal/, answer: a.postalCode },
    { match: /^city$/, answer: a.city },
    { match: /^(province|state|province or state|state or province)$/, answer: a.region },
    { match: /^country$/, answer: a.country },
    { match: /^(current )?location( city)?$|^where are you (currently )?(located|based)/, answer: location(p) },
    // "Are you based in <your country>?" Other countries are left to the model.
    { match: new RegExp(`\\b(based|located|living|live|reside|residing|resident)\\b.*${country.source}`), answer: "Yes" },
    { match: /^(school|university|college)( name)?$/, answer: e.school },
    { match: /^degree$/, answer: e.degree },
    { match: /^(major|discipline|field of study)$/, answer: e.major },
    { match: /^(graduation|grad) (date|year)/, answer: `${e.end.month} ${e.end.year}` },
    // Under an Education heading (Greenhouse). The same labels under Work experience are a past
    // job's dates and are left to the model.
    { match: /^start date year$/, answer: e.start.year, section: EDUCATION },
    { match: /^start date month$/, answer: e.start.month, section: EDUCATION },
    { match: /^end date year$/, answer: e.end.year, section: EDUCATION },
    { match: /^end date month$/, answer: e.end.month, section: EDUCATION },
    // When you can start work: never a "Start date" inside an education or job-history section.
    { match: /^(earliest |available )?start date(?! (year|month))|when (can|could|would) you start|available to start|^date available|^availability date/, answer: (ctx) => startDate(ctx), notSection: HISTORY },
  ];
}

/** The rule answer for a normalized label, if one rule covers it. */
export function ruleAnswer(normalizedLabel: string, section = "", ctx: RuleContext = {}, p = profile()): string | undefined {
  const answer = rules(p).find((r) => r.match.test(normalizedLabel)
    && (!r.section || r.section.test(section)) && !(r.notSection && r.notSection.test(section)))?.answer;
  return typeof answer === "function" ? answer(ctx) : answer;
}

/** Everything the fill, write and review models read about you: profile.json, then context.md. */
export function facts(): string {
  const context = existsSync(paths.context) ? readFileSync(paths.context, "utf8") : "";
  return `## Profile (profile.json)\n\n${JSON.stringify(profile(), null, 1)}\n\n${context}`;
}
