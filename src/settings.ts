import { isResumeId, listResumes } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";

// The toggles. Defaults live here; overrides live in the db (kv "settings"). CLI flags still win
// for a single run. `jh settings` shows them, `jh set <key> <value>` changes one.

export const DEFAULTS = {
  /** review: stop at Submit and ask. auto: submit when every required field is filled. */
  submit: "review" as "review" | "auto",
  /** Before submitting, the review model reads every answer against your facts and blocks the submit on a problem. */
  reviewAnswers: true,
  /** Jev's "is this worth applying to" check before filling anything. */
  fitCheck: true,
  /** Lowest fit verdict the runner applies to. */
  minFit: "maybe" as "apply" | "maybe",
  /** Jev answers options and reuses reworded saved answers before the fill model is asked. */
  jevFill: true,
  /** A resume in ~/.jh/resumes, by file name without .pdf (`jh resumes`). */
  resume: "resume",
  /** Where the runner finds postings: linkedin, jobright, tsenta. */
  sources: ["linkedin"] as ("linkedin" | "jobright" | "tsenta")[],
  /** Search terms for sources that take them (LinkedIn). */
  searches: ["software engineer"],
  /** Locations for sources that take them. */
  locations: ["United States"],
  /** Only postings newer than this (hours). */
  maxAgeHours: 24,
  /** The runner stops applying after this many submissions in a day. */
  maxPerDay: 40,
  /** Minutes between runner sweeps. */
  intervalMinutes: 30,
  /** Company names (case-insensitive substring) the runner never applies to. */
  skipCompanies: [] as string[],
  /** Title words (case-insensitive) that disqualify a posting before Jev is asked. */
  skipTitleWords: ["intern", "co-op", "coop", "principal", "staff", "director", "manager", "sales", "account executive"],
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

let cache: { value: Settings; at: number } | undefined;

/** Current toggles. Re-read at most once a minute, so a long-running runner picks up `jh set`. */
export function settings(): Settings {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = { value: { ...DEFAULTS, ...(kvGet<Partial<Settings>>("settings") ?? {}) }, at: Date.now() };
  }
  return cache.value;
}

/**
 * Sets one toggle from a CLI string. Booleans take true/false/on/off, numbers parse, lists
 * take "a | b" (or "a, b" when no item has a comma), enums are checked against the default's options.
 */
export function setSetting(key: string, raw: string): Settings {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting "${key}". Options: ${Object.keys(DEFAULTS).join(", ")}`);
  const k = key as SettingKey;
  const current = DEFAULTS[k];
  let value: unknown;
  if (typeof current === "boolean") {
    if (!/^(true|false|on|off|yes|no)$/i.test(raw)) throw new Error(`${key} is on/off`);
    value = /^(true|on|yes)$/i.test(raw);
  } else if (typeof current === "number") {
    value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${key} is a number`);
  } else if (Array.isArray(current)) {
    const items = raw.split(/[|;]/.test(raw) ? /[|;]/ : ",").map((s) => s.trim()).filter(Boolean);
    const sources = ["linkedin", "jobright", "tsenta"];
    if (k === "sources" && items.some((s) => !sources.includes(s))) throw new Error(`sources are some of ${sources.join(", ")}`);
    value = items;
  } else if (k === "resume") {
    if (!isResumeId(raw)) throw new Error(`resume is one of ${listResumes().join(", ") || "(none yet: put a PDF in ~/.jh/resumes)"}`);
    value = raw;
  } else {
    const allowed: Record<string, string[]> = { submit: ["review", "auto"], minFit: ["apply", "maybe"] };
    if (allowed[k] && !allowed[k].includes(raw)) throw new Error(`${key} is one of ${allowed[k].join(", ")}`);
    value = raw;
  }
  const stored = kvGet<Partial<Settings>>("settings") ?? {};
  kvSet("settings", { ...stored, [k]: value });
  cache = undefined;
  return settings();
}

/** Drops an override so the default applies again. */
export function resetSetting(key: string) {
  const stored = kvGet<Partial<Settings>>("settings") ?? {};
  delete stored[key as SettingKey];
  kvSet("settings", stored);
  cache = undefined;
}
