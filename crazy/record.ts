// Records one crazy-mode agent application: run folder crazy-<slug> with its card, transcripts and
// screenshots, an applications row when it was submitted, and its bench row either way.
// Usage (from the repo root): tsx crazy/record.ts <job.json>
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { recordApplication } from "../src/applications.ts";
import { listResumes, paths } from "../src/config.ts";
import { exec } from "../src/db.ts";
import { markQueued } from "../src/runner.ts";

type Rec = {
  slug: string; url: string; company: string; title: string; location: string;
  arm: string; models: Record<string, string>; outcome: "submitted" | "blocked" | "failed" | "skipped"; note: string;
  answers: { question: string; answer: string }[]; dir: string;
};

const r: Rec = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const run = `crazy-${r.slug}`;
const folder = `${paths.runs}/${run}`;
mkdirSync(folder, { recursive: true });
// Everything the agents left for this job: card, transcripts, screenshots.
for (const f of readdirSync(r.dir)) if (f.startsWith(`${r.slug}.`) || f.startsWith(`${r.slug}-`)) copyFileSync(`${r.dir}/${f}`, `${folder}/${f.slice(r.slug.length + 1)}`);

if (r.outcome === "submitted") {
  // The resume the agents uploaded (CRAZY_RESUME or the first in ~/.jh/resumes), as a resume id.
  const resume = process.env.CRAZY_RESUME ? basename(process.env.CRAZY_RESUME, ".pdf") : (listResumes()[0] ?? "resume");
  recordApplication({
    job: { url: r.url, company: r.company, title: r.title, location: r.location, description: "" },
    site: new URL(r.url).hostname, status: "applied", resume, confirmed: true, run,
    answers: r.answers.map((a) => ({ ...a, source: r.arm })),
    note: `submitted by crazy mode (${r.arm}): ${r.note}`.slice(0, 300),
  });
  markQueued(r.url, "done", `submitted by crazy mode (${r.arm})`);
} else markQueued(r.url, r.outcome === "skipped" ? "skipped" : "failed", `crazy mode ${r.outcome}: ${r.note}`.slice(0, 500));

exec([`INSERT OR REPLACE INTO bench (run, url, company, title, arm, models, filler, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?)`,
  [run, r.url, r.company, r.title, r.arm, JSON.stringify(r.models), r.outcome, r.note.slice(0, 500), new Date().toISOString()]]);
console.log(`recorded ${r.slug} ${r.outcome}`);
