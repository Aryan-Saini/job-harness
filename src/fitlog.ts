import { localDay } from "./config.ts";
import { normalize } from "./answers.ts";
import { all, exec } from "./db.ts";
import type { Fit, FitRaw } from "./fit.ts";
import type { Job } from "./planner.ts";

// Every Jev fit verdict, yes or no, with Jev's raw answers and the listing text, so we can
// check the classifier: you mark verdicts right or wrong (`jh judge`), `jh fits` shows
// accuracy per verdict, and stored raw answers can be re-scored after a weight change.
// One row per posting URL; a re-check updates it but keeps the label.

export type Label = "right" | "wrong";
export type FitCheck = {
  id: number;
  url: string;
  date: string;
  company: string;
  title: string;
  location: string;
  resume: string;
  model: string;
  verdict: Fit["verdict"];
  score: number;
  reasons: string[];
  raw: FitRaw;
  label: Label | null;
  label_note: string | null;
  /** Status of the matching application in the tracker, if there is one. */
  applied: string | null;
};

export function recordFitCheck(job: Job, resume: string, model: string, raw: FitRaw, fit: Fit) {
  exec([
    `INSERT INTO fit_checks (url, date, company, title, location, resume, model, verdict, score, reasons, raw, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET date = excluded.date, company = excluded.company, title = excluded.title,
       location = excluded.location, resume = excluded.resume, model = excluded.model, verdict = excluded.verdict,
       score = excluded.score, reasons = excluded.reasons, raw = excluded.raw, description = excluded.description`,
    [job.url, localDay(), job.company, job.title, job.location, resume, model,
      fit.verdict, fit.score, JSON.stringify(fit.reasons), JSON.stringify(raw), job.description.slice(0, 20_000)],
  ]);
}

type Row = Omit<FitCheck, "reasons" | "raw"> & { reasons: string; raw: string };

export function loadFitChecks(): FitCheck[] {
  return all<Row>(
    `SELECT f.id, f.url, f.date, f.company, f.title, f.location, f.resume, f.model, f.verdict, f.score, f.reasons, f.raw,
       f.label, f.label_note, (SELECT status FROM applications a WHERE a.url = f.url) AS applied
     FROM fit_checks f ORDER BY f.date DESC, f.id DESC`,
  ).map((r) => ({ ...r, reasons: JSON.parse(r.reasons), raw: JSON.parse(r.raw) }));
}

/** `#12`, `12`, or words matching company / title / url. */
export function findFitChecks(query: string): FitCheck[] {
  const checks = loadFitChecks();
  const id = query.match(/^#?(\d+)$/)?.[1];
  if (id) return checks.filter((c) => c.id === Number(id));
  const words = normalize(query).split(" ").filter(Boolean);
  return checks.filter((c) => words.every((w) => normalize(`${c.company} ${c.title} ${c.url}`).includes(w)));
}

export function labelFitCheck(id: number, label: Label, note: string) {
  exec(["UPDATE fit_checks SET label = ?, label_note = ? WHERE id = ?", [label, note || null, id]]);
}
