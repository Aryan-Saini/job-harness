// Sorts a crazy-mode job that didn't go in: was it the job, or the machinery around it?
// A job failure is recorded and audited. Anything else must not cost the job its place in the queue:
//   infra  the agent never really ran (crashed in seconds, usage limit, browser or tab API down):
//          requeue it, and enough of these in a row pause the run (see Breaker).
//   pause  the site itself says "not today": requeue it and stop claiming that source until the limit
//          resets. LinkedIn's daily Easy Apply limit, and Work at a Startup's 5 sends a week (its Send
//          dialog just stays open once they're spent).

/** Sources that can be paused, as the job_queue predicate that picks their jobs. */
export const SOURCES = {
  linkedin: "url LIKE '%linkedin.com/%'",
  yc: "source = 'yc'",
};

const USAGE = /hit your (session|usage|weekly) limit|usage limit|rate.?limit|status(code)?[ :]*429|out of (credits|usage)|quota exceeded/i;
const BROKEN = /ECONNREFUSED|connectOverCDP|Target (page, context or browser )?(has been )?closed|browser has been closed|ERROR (forbidden|actions:)|socket hang up|tabapi.*(down|unreachable)/i;
const EASY_APPLY_LIMIT = /easy.?apply (daily )?limit|easy-apply-limit|reached today'?s easy apply limit|continue applying tomorrow/i;
const YC_SEND_STUCK = /no confirmation|dialog (remained|remains|stayed|still)|send (did nothing|didn't go)/i;
/** An agent that "gave no result" this fast never got to the form; a slow one ran out of time on it. */
const CRASH_MS = 90_000;

/**
 * Classifies one finished attempt. `note` is the recorded failure line, `raw` everything the agents
 * printed (stdout and stderr), `ms` how long the last agent call ran, `source` the job_queue source.
 * A pause carries `until` when it isn't LinkedIn's local midnight.
 * @returns {{ kind: "job" } | { kind: "infra", why: string } | { kind: "pause", source: keyof typeof SOURCES, why: string, until?: string }}
 */
export function triage({ note = "", raw = "", ms = Infinity, source = "", now = new Date() }) {
  if (EASY_APPLY_LIMIT.test(note)) return { kind: "pause", source: "linkedin", why: "LinkedIn daily Easy Apply limit" };
  if (source === "yc" && YC_SEND_STUCK.test(note)) {
    return { kind: "pause", source: "yc", why: "Work at a Startup Send didn't go through (weekly cap)", until: new Date(now.getTime() + 7 * 86_400_000).toISOString() };
  }
  if (USAGE.test(note) || USAGE.test(raw.slice(-4000))) return { kind: "infra", why: "usage limit" };
  if (BROKEN.test(note) || BROKEN.test(raw.slice(-4000))) return { kind: "infra", why: "browser or tab API down" };
  if (/^(filler|submit) gave no result$/.test(note) && ms < CRASH_MS) return { kind: "infra", why: `agent exited in ${Math.round(ms / 1000)}s with no result` };
  if (/^checker dropped: no verdict$/.test(note)) return { kind: "infra", why: "checker returned nothing" };
  return { kind: "job" };
}

/** LinkedIn's limit resets at local midnight; a pause runs until then. */
export function nextMidnight(now = new Date()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * Trips when `limit` infra failures land within `windowMs`: a dead CLI or browser would otherwise
 * burn the whole queue in minutes (272 jobs in two minutes on 2026-10-21). While tripped, slots
 * stop claiming until `until`.
 */
export class Breaker {
  constructor(limit = 5, windowMs = 2 * 60_000, coolMs = 5 * 60_000) {
    Object.assign(this, { limit, windowMs, coolMs, hits: [], until: 0 });
  }
  /** Records one infra failure; true when this one trips the breaker. */
  hit(now = Date.now()) {
    this.hits = [...this.hits.filter((t) => now - t < this.windowMs), now];
    if (this.hits.length < this.limit || now < this.until) return false;
    this.until = now + this.coolMs;
    this.hits = [];
    return true;
  }
  open(now = Date.now()) { return now < this.until; }
}
