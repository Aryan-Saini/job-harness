// Files questions only you can answer, from crazy mode's auditor and fixer, into pending_questions:
// the same list `jh questions` / `jh answer` read. A question
// already pending for that posting is left alone.
// Usage (from the repo root): tsx crazy/ask.ts '<json>'
//   json: {"questions":[{"label":"...","options":["Yes","No"]}],"url":"...","company":"...","title":"..."}
import { normalize } from "../src/answers.ts";
import { localDay } from "../src/config.ts";
import { exec } from "../src/db.ts";

type Ask = { questions: { label: string; options?: string[] }[]; url: string; company?: string; title?: string };
const a: Ask = JSON.parse(process.argv[2]!);
for (const q of a.questions.filter((q) => normalize(q.label))) {
  exec([`INSERT OR IGNORE INTO pending_questions (key, label, kind, options, url, company, title, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [normalize(q.label), q.label, q.options?.length ? "select" : "text", JSON.stringify(q.options ?? []), a.url, a.company ?? "", a.title ?? "", localDay()]]);
}
console.log(`filed ${a.questions.length} question(s)`);
