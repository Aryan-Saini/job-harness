import { localDay } from "./config.ts";
import { normalize } from "./answers.ts";
import { all, exec, type Param } from "./db.ts";
import type { Planned } from "./planner.ts";

// The site catalog (sites + site_questions tables). Every run records which questions a site asked, so `jh questions`
// can list the ones the bank can't answer yet and you can pre-answer them once.
// Known ATSes share one catalog across companies, since their forms repeat.

const ATS: [string, RegExp][] = [
  ["linkedin", /(^|\.)linkedin\.com$/],
  ["greenhouse", /greenhouse\.io$/],
  ["lever", /lever\.co$/],
  ["ashby", /ashbyhq\.com$/],
  ["workday", /myworkdayjobs\.com$|workday\.com$/],
  ["smartrecruiters", /smartrecruiters\.com$/],
  ["rippling", /rippling\.com$|rippling-ats\.com$/],
  ["workable", /workable\.com$/],
  ["bamboohr", /bamboohr\.com$/],
  ["jobvite", /jobvite\.com$/],
  ["icims", /icims\.com$/],
  ["taleo", /taleo\.net$/],
  ["successfactors", /successfactors\.(com|eu)$/],
  ["indeed", /indeed\.com$/],
  ["wellfound", /wellfound\.com$/],
  ["ycombinator", /workatastartup\.com$|ycombinator\.com$/],
];

/** Catalog key for a URL: the ATS name if known, else the bare hostname. */
export function siteKey(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return ATS.find(([, re]) => re.test(host))?.[0] ?? (host || "local");
}

type Question = { label: string; kind: string; options: string[]; seen: number };
export type Site = {
  site: string;
  hosts: string[];
  applications: number;
  lastUsed: string;
  questions: Record<string, Question>;
};

type SiteRow = { site: string; hosts: string; applications: number; last_used: string };
type QuestionRow = { site: string; key: string; label: string; kind: string; options: string; seen: number };

function toSite(row: SiteRow, questions: QuestionRow[]): Site {
  return {
    site: row.site,
    hosts: JSON.parse(row.hosts),
    applications: row.applications,
    lastUsed: row.last_used,
    questions: Object.fromEntries(questions.map((q) => [q.key, { label: q.label, kind: q.kind, options: JSON.parse(q.options), seen: q.seen }])),
  };
}

export function loadSite(site: string): Site {
  const row = all<SiteRow>("SELECT * FROM sites WHERE site = ?", site)[0]
    ?? { site, hosts: "[]", applications: 0, last_used: "" };
  return toSite(row, all<QuestionRow>("SELECT * FROM site_questions WHERE site = ?", site));
}

export function listSites(): Site[] {
  const questions = all<QuestionRow>("SELECT * FROM site_questions");
  return all<SiteRow>("SELECT * FROM sites ORDER BY last_used DESC")
    .map((row) => toSite(row, questions.filter((q) => q.site === row.site)));
}

export function recordSite(url: string, planned: Planned[], submitted: boolean) {
  const site = siteKey(url);
  const host = new URL(url).hostname;
  const hosts = new Set(loadSite(site).hosts).add(host);
  const statements: [string, Param[]][] = [[
    `INSERT INTO sites (site, hosts, applications, last_used) VALUES (?, ?, ?, ?)
     ON CONFLICT(site) DO UPDATE SET hosts = excluded.hosts, applications = applications + excluded.applications, last_used = excluded.last_used`,
    [site, JSON.stringify([...hosts]), submitted ? 1 : 0, localDay()],
  ]];
  for (const { field } of planned) {
    const key = normalize(field.label);
    if (!key || field.kind === "file") continue;
    statements.push([
      `INSERT INTO site_questions (site, key, label, kind, options, seen) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(site, key) DO UPDATE SET label = excluded.label, kind = excluded.kind, options = excluded.options, seen = seen + 1`,
      [site, key, field.label, field.kind, JSON.stringify(field.options)],
    ]);
  }
  exec(...statements);
}
