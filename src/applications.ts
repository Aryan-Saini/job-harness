import { localDay } from "./config.ts";
import { createHash } from "node:crypto";
import { normalize } from "./answers.ts";
import { all, exec, type Param } from "./db.ts";
import type { Fit } from "./fit.ts";
import type { Job, Planned } from "./planner.ts";
import { canonical, postingKey, sameCompany, similarTitle } from "./sources/url.ts";

// The application tracker: every job the harness touched (or you applied to by hand),
// with the resume used, Jev's fit verdict, every question and answer, and a status history.
// Tables applications / application_answers / application_history.
// `jh tracker`, `jh show`, `jh status`.

export const STATUSES = [
  "draft", //       prepared, never sent
  "unfinished", //  harness filled it, you quit before submitting
  "skipped", //     Jev said skip and we didn't apply
  "applied",
  "responded", //   a human replied
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type Status = (typeof STATUSES)[number];
export const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);

export type Application = {
  id: string;
  status: Status;
  /** Date it was applied to (or skipped / attempted), YYYY-MM-DD. */
  date: string;
  company: string;
  title: string;
  location: string;
  url: string;
  /** ATS or host, see sites.ts. */
  site: string;
  /** Resume id from config.ts, or a file name for applications made by hand. */
  resume: string;
  fit: Fit | null;
  answers: { question: string; answer: string; source: string }[];
  /** Saw a "thanks for applying" page after submitting. */
  confirmed: boolean;
  /** data/runs folder with screenshots and the raw run log. */
  run: string;
  notes: string;
  history: { date: string; status: Status; note: string }[];
};

const today = () => localDay();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * A readable id (date, company, start of the title) plus a short hash of the posting's
 * canonical URL, so two roles that share a prefix never land on one row.
 */
export function applicationId(job: Pick<Job, "url" | "company" | "title">, date = today()): string {
  const hash = createHash("sha256").update(job.url ? canonical(job.url) : `${job.company}|${job.title}`).digest("hex").slice(0, 8);
  return [date, slug(job.company || "job"), slug(job.title).slice(0, 24).replace(/-$/, ""), hash].filter(Boolean).join("-");
}

type AppRow = Omit<Application, "fit" | "confirmed" | "answers" | "history"> & { fit: string | null; confirmed: number };

/** Every application, newest first, with answers and history. */
export function loadApplications(where = "", ...params: Param[]): Application[] {
  const rows = all<AppRow>(`SELECT * FROM applications ${where} ORDER BY date DESC, company`, ...params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const answers = all<{ application_id: string; question: string; answer: string; source: string }>(
    `SELECT * FROM application_answers WHERE application_id IN (${marks}) ORDER BY position`, ...ids);
  const history = all<{ application_id: string; date: string; status: Status; note: string }>(
    `SELECT * FROM application_history WHERE application_id IN (${marks}) ORDER BY rowid`, ...ids);
  return rows.map((r) => ({
    ...r,
    fit: r.fit ? (JSON.parse(r.fit) as Fit) : null,
    confirmed: !!r.confirmed,
    notes: r.notes ?? "",
    answers: answers.filter((a) => a.application_id === r.id).map(({ question, answer, source }) => ({ question, answer, source })),
    history: history.filter((h) => h.application_id === r.id).map(({ date, status, note }) => ({ date, status, note })),
  }));
}

/** Insert-or-update of the application row, its answers (only when there are some), and one history entry. */
function write(app: Application, historyEntry?: Application["history"][number]) {
  const statements: [string, Param[]][] = [
    [
      `INSERT INTO applications (id, status, date, company, title, location, url, site, resume, fit, confirmed, run, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, date = excluded.date, company = excluded.company,
         title = excluded.title, location = excluded.location, url = excluded.url, site = excluded.site,
         resume = excluded.resume, fit = excluded.fit, confirmed = excluded.confirmed, run = excluded.run,
         notes = CASE WHEN excluded.notes = '' THEN applications.notes ELSE excluded.notes END`,
      [app.id, app.status, app.date, app.company, app.title, app.location, app.url, app.site, app.resume,
        app.fit ? JSON.stringify(app.fit) : null, app.confirmed, app.run, app.notes],
    ],
    ...(app.answers.length ? [["DELETE FROM application_answers WHERE application_id = ?", [app.id]] satisfies [string, Param[]]] : []),
    ...app.answers.map((a, i): [string, Param[]] => [
      "INSERT INTO application_answers (application_id, position, question, answer, source) VALUES (?, ?, ?, ?, ?)",
      [app.id, i, a.question, a.answer, a.source],
    ]),
  ];
  if (historyEntry) {
    statements.push(["INSERT INTO application_history (application_id, date, status, note) VALUES (?, ?, ?, ?)",
      [app.id, historyEntry.date, historyEntry.status, historyEntry.note]]);
  }
  exec(...statements);
}

/** Answers worth keeping from a run: everything that got a value, plus the resume file. */
export function answersFrom(planned: Planned[], resumeFile: string): Application["answers"] {
  return planned
    .filter((p) => p.source !== "skip" || p.field.required)
    .map((p) => ({
      question: p.field.label,
      answer: p.source === "resume" ? resumeFile : p.values.length > 1 ? p.values.join(" | ") : p.value,
      source: p.source,
    }));
}

type RecordInput = {
  job: Job;
  site: string;
  status: Status;
  resume: string;
  fit?: Fit | null;
  answers?: Application["answers"];
  confirmed?: boolean;
  run?: string;
  note?: string;
  /** Every other URL this application was reached by (listing, ATS form, final page). */
  urls?: string[];
};

/** application_urls rows for the job URL plus any extra ones, keyed by postingKey. */
function urlStatements(appId: string, input: RecordInput): [string, Param[]][] {
  const urls = [...new Set([input.job.url, ...(input.urls ?? [])].filter(Boolean))];
  return urls.map((url) => [
    "INSERT OR IGNORE INTO application_urls (key, application_id, url, added) VALUES (?, ?, ?, ?)",
    [postingKey(url), appId, url, today()],
  ]);
}

/**
 * Adds or updates the record for this job (matched by URL). A later run on the same job
 * replaces answers and moves the status forward, keeping history.
 */
export function recordApplication(input: RecordInput): Application {
  const existing = input.job.url ? loadApplications("WHERE url = ?", input.job.url)[0] : undefined;
  const app: Application = existing ?? fresh(input);
  Object.assign(app, {
    status: input.status,
    date: input.status === "applied" ? today() : app.date,
    company: input.job.company || app.company,
    title: input.job.title || app.title,
    location: input.job.location || app.location,
    resume: input.resume,
    fit: input.fit ?? app.fit,
    answers: input.answers?.length ? input.answers : app.answers,
    confirmed: input.confirmed ?? app.confirmed,
    run: input.run || app.run,
  });
  const entry = { date: today(), status: input.status, note: input.note ?? "" };
  app.history.push(entry);
  write(app, entry);
  exec(...urlStatements(app.id, input));
  return app;
}

function fresh(input: RecordInput): Application {
  return {
    id: applicationId(input.job),
    status: input.status,
    date: today(),
    company: input.job.company,
    title: input.job.title,
    location: input.job.location,
    url: input.job.url,
    site: input.site,
    resume: input.resume,
    fit: input.fit ?? null,
    answers: input.answers ?? [],
    confirmed: input.confirmed ?? false,
    run: input.run ?? "",
    notes: "",
    history: [],
  };
}

/** Finds applications by id prefix, or by words that all appear in company / title / url. */
export function findApplications(query: string): Application[] {
  const apps = loadApplications();
  const byId = apps.filter((a) => a.id.startsWith(query));
  if (byId.length) return byId;
  const words = normalize(query).split(" ").filter(Boolean);
  return apps.filter((a) => {
    const hay = normalize(`${a.company} ${a.title} ${a.url}`);
    return words.every((w) => hay.includes(w));
  });
}

export function setStatus(id: string, status: Status, note: string) {
  const app = loadApplications("WHERE id = ?", id)[0];
  if (!app) throw new Error(`No application ${id}`);
  app.status = status;
  if (note) app.notes = app.notes ? `${app.notes}\n${today()}: ${note}` : `${today()}: ${note}`;
  write(app, { date: today(), status, note });
}

/** Pipeline order. Email-driven updates only ever move an application forward along it. */
const STAGE: Record<Status, number> = { draft: 0, skipped: 0, unfinished: 1, applied: 2, responded: 3, interviewing: 4, offer: 5, rejected: 5, withdrawn: 5 };

/**
 * Moves an application to `status` only if that's further along than where it is now (read
 * fresh from the db); otherwise just adds a history note. Emails arrive out of order, so a
 * late "thanks for applying" must never undo a rejection or an interview.
 */
export function advanceStatus(id: string, status: Status, note: string) {
  const app = loadApplications("WHERE id = ?", id)[0];
  if (!app) throw new Error(`No application ${id}`);
  setStatus(id, STAGE[status] > STAGE[app.status] ? status : app.status, note);
}

/** Adds an application by hand (one made outside the harness, or an import). */
export function addApplication(app: Omit<Application, "history">, history: Application["history"]) {
  write({ ...app, history: [] });
  for (const entry of history) exec(["INSERT INTO application_history (application_id, date, status, note) VALUES (?, ?, ?, ?)",
    [app.id, entry.date, entry.status, entry.note]]);
}

/**
 * An earlier real application to this job: any of its URLs maps to a posting we applied to
 * (compared by the job board's posting id, so Jobright, embed and board links match), or the
 * same company with a near-identical title (word overlap >= 0.75) in the last 90 days.
 */
export function priorApplication(job: Job, urls: string[] = []): Application | undefined {
  const sent: Status[] = ["applied", "responded", "interviewing", "offer", "rejected", "withdrawn"];
  const apps = loadApplications().filter((a) => sent.includes(a.status));
  // 1. Any URL we've seen for this posting, compared by the job board's own posting id.
  const keys = [...new Set([job.url, ...urls].filter(Boolean).map(postingKey))];
  if (keys.length) {
    const marks = keys.map(() => "?").join(",");
    const hit = all<{ application_id: string }>(`SELECT application_id FROM application_urls WHERE key IN (${marks})`, ...keys)[0];
    const byKey = hit && apps.find((a) => a.id === hit.application_id);
    if (byKey) return byKey;
    const byUrl = apps.find((a) => a.url && keys.includes(postingKey(a.url)));
    if (byUrl) return byUrl;
  }
  // 2. Same company and nearly the same title in the last 90 days, whatever the URL.
  if (!job.company || !job.title) return undefined;
  const since = localDay(new Date(Date.now() - 90 * 86_400_000));
  return apps.find((a) => a.date >= since && sameCompany(a.company, job.company) && similarTitle(a.title, job.title));
}
