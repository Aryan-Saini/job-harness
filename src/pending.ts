import { localDay } from "./config.ts";
import { normalize } from "./answers.ts";
import { all, exec, type Param } from "./db.ts";
import type { Field } from "./fields.ts";
import type { Job } from "./planner.ts";

// Questions the harness couldn't answer. A run that stops on them files them here;
// `jh answer` walks you through them and the answers go to the bank, so the
// next form that asks gets them for free. One row per question per posting.

export type Pending = { key: string; label: string; kind: string; options: string[]; url: string; company: string; title: string; created: string };

export function addPending(fields: Field[], job: Job) {
  const rows = fields.filter((f) => f.kind !== "file" && normalize(f.label));
  if (!rows.length) return;
  exec(...rows.map((f): [string, Param[]] => [
    `INSERT OR IGNORE INTO pending_questions (key, label, kind, options, url, company, title, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [normalize(f.label), f.label, f.kind, JSON.stringify(f.options), job.url, job.company, job.title, localDay()],
  ]));
  console.log(`\n${rows.length} question${rows.length > 1 ? "s" : ""} saved for you to answer: jh answer`);
}

export function listPending(): Pending[] {
  return all<Omit<Pending, "options"> & { options: string }>("SELECT * FROM pending_questions ORDER BY created, company")
    .map((r) => ({ ...r, options: JSON.parse(r.options) }));
}

/** Called once the bank has an answer for this question. */
export const resolvePending = (key: string) => exec(["DELETE FROM pending_questions WHERE key = ?", [key]]);
