import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

// The one place to change defaults: which model does what, and where things live.

/**
 * Everything about you lives in one folder, ~/.jh by default (JH_HOME to move it):
 * profile.json, context.md, resumes/*.pdf, the database, the browser profile and run logs.
 * `jh init` creates it.
 */
export const HOME = resolve(process.env.JH_HOME ?? join(homedir(), ".jh"));
export const HARNESS = resolve(import.meta.dirname, "..");

export const paths = {
  profile: join(HOME, "profile.json"),
  context: join(HOME, "context.md"),
  resumes: join(HOME, "resumes"),
  /** The SQLite database: tracker, answer bank, site catalog, settings, logins. */
  db: process.env.JH_DB ?? join(HOME, "jh.db"),
  runs: join(HOME, "runs"),
  browserProfile: join(HOME, "chrome-profile"),
  /** TypeSafe API key for Jev. Or set TYPESAFE_API_KEY. */
  typesafeKey: join(HOME, "typesafe.key"),
  templates: join(HARNESS, "templates"),
};

/**
 * Model spec: `<provider>:<model>[:<effort>]`. Every provider is a CLI logged into your own
 * subscription, so nothing needs an API key except opencode (per token).
 *   claude:opus:medium   claude:sonnet   claude:haiku
 *   codex:gpt-6.1-sol:low
 *   opencode:openrouter/z-ai/glm-5.3-flash:high
 * Override per run with `--model fill=claude:sonnet` or env `JH_MODEL_FILL=...`.
 */
export const models = {
  /** Maps form fields to answers: short facts, selects, yes/no. Cheap and fast. */
  fill: "claude:haiku",
  /** Free-text answers ("Why us?", cover letter boxes). */
  write: "claude:sonnet",
  /** Second opinion on every filled form before submit (settings.reviewAnswers). Not a filler. */
  review: "claude:sonnet",
} satisfies Record<string, string>;
export type ModelRole = keyof typeof models;

/**
 * Jev (TypeSafe's System One model) makes the fast typed calls: is this posting worth it,
 * which saved answer fits this question, which option is right. Thresholds are on Jev's
 * reported confidence; below them the field falls through to the `fill` model.
 */
export const jev = {
  model: "jev-latest",
  /** Pick an option on a select/radio/checkbox without the fill model. */
  pickConfidence: 0.85,
  /** Reuse a saved answer for a differently worded question. */
  bankMatch: 0.8,
};

/** Resume ids: the file names in ~/.jh/resumes without .pdf. `resume.pdf` is the id "resume". */
export type ResumeId = string;
export const listResumes = (): ResumeId[] =>
  existsSync(paths.resumes) ? readdirSync(paths.resumes).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => basename(f, ".pdf")).sort() : [];
export const resumePath = (id: ResumeId) => join(paths.resumes, `${id}.pdf`);
export const isResumeId = (id: string): id is ResumeId => listResumes().includes(id);

/** Your time zone: every date the harness records is your local date. JH_TZ overrides the system's. */
export const TZ = process.env.JH_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Today (or `at`) as YYYY-MM-DD in local time, never UTC. */
export const localDay = (at: Date = new Date()): string => at.toLocaleDateString("en-CA", { timeZone: TZ });
