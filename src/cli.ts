import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { forget, loadBank, normalize, remember, saveBank } from "./answers.ts";
import { findApplications, isStatus, loadApplications, setStatus, STATUSES } from "./applications.ts";
import { apply, type SubmitMode } from "./apply.ts";
import { ask, askHidden, openBrowser } from "./browser.ts";
import { HOME, isResumeId, listResumes, models, paths, resumePath, type ModelRole } from "./config.ts";
import { setModel, specFor } from "./llm.ts";
import { listPending, resolvePending, type Pending } from "./pending.ts";
import { EEO } from "./planner.ts";
import { profile, ruleAnswer } from "./profile.ts";
import { defaultLogin, listLogins, setCred } from "./secrets.ts";
import { all } from "./db.ts";
import { checkFit, verdictFrom } from "./fit.ts";
import { claimNext, markQueued, runForever, runOnce, type QueueRow } from "./runner.ts";
import { DEFAULTS, resetSetting, setSetting, settings, type SettingKey } from "./settings.ts";
import { usageBy, type UsageRow } from "./usage.ts";
import { findFitChecks, labelFitCheck, loadFitChecks } from "./fitlog.ts";
import { disableJev } from "./jev.ts";
import * as linkedin from "./linkedin.ts";
import { listSites, loadSite, siteKey } from "./sites.ts";

const HELP = `jh: job application harness

  jh init                      Set up ~/.jh (profile.json, context.md, resumes/) and check what's installed
  jh apply <url> [options]     Fill an application (any site, LinkedIn Easy Apply included)
  jh batch <file> [options]    Apply to every URL in a file, one per line (# comments ok)
      --resume <id>            Resume to upload (default from jh settings). See \`jh resumes\`
      --submit review|auto|dry review: stop at submit and ask (default from jh settings)
                               auto: submit when every required field is filled
                               dry: fill everything, never submit
      --model role=spec        e.g. --model fill=claude:sonnet --model write=codex:gpt-6.1-sol
      --headless               No window. Runs that need a human fail instead
      --cdp <url>              Drive a Chrome that's already running, e.g. http://127.0.0.1:9222
      --no-fit                 Skip Jev's "is this worth applying to" check
      --no-jev                 No Jev at all: the fill model answers every field

  jh fit <url> [url...]        Jev's verdict on postings: APPLY / MAYBE / SKIP, nothing filled
  jh fits [apply|maybe|skip|right|wrong|unlabeled|words]   Every verdict Jev has given, with accuracy
  jh judge <#id|words> right|wrong ["why"]                 Mark a verdict, to check the classifier

  jh run [once]                Unattended: find new postings (LinkedIn, Jobright, Tsenta), fit-check, queue.
                               With submit=auto it also applies, up to maxPerDay. Loops every intervalMinutes
  jh queue [status]            What the runner queued (or done / failed / skipped / check)
  jh next [n]                  Apply to the best queued job(s) in review mode
  jh settings [json]           Every toggle: submit mode, fit check, sources, searches...
  jh set <key> <value>         Change one, jh reset <key> to undo

  jh tracker [status|words]    Every application: status, company, role, resume, fit
  jh show <id|words>           One application in full: answers, fit, notes, history
  jh status <id|words> <status> [note]   applied, responded, interviewing, offer, rejected...
  jh usage [days]              Tokens and cost by model, purpose and run (default 30 days)

  jh open [url]                Open the harness browser to log in somewhere by hand
  jh resumes | jh models | jh sites
  jh questions [site]          Questions runs couldn't answer (or a site's unanswered catalog)
  jh answer                    Answer them one by one; answers are reused on every form after
  jh answer "<question>" "<answer>"   Pre-answer a question (or fix an answer)
  jh answers [search]          Show the answer bank
  jh forget "<question>"       Remove a bank answer
  jh login default             Set the email and password used for every new account
  jh login set <host>          Save a login for one site
  jh login list                Show saved logins (no passwords)`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    resume: { type: "string" },
    submit: { type: "string" },
    model: { type: "string", multiple: true, default: [] },
    headless: { type: "boolean", default: false },
    cdp: { type: "string" },
    fit: { type: "boolean" },
    days: { type: "string" },
    jev: { type: "boolean" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, ...args] = positionals;

async function main() {
  for (const m of flags.model) {
    const [role, spec] = m.split("=");
    if (!role || !spec || !(role in models)) throw new Error(`--model wants role=spec, roles: ${Object.keys(models).join(", ")}`);
    setModel(role as ModelRole, spec);
  }
  // Flags win for this run; otherwise the toggles (jh settings) decide. Only commands that
  // apply read the toggles.
  const needsToggles = ["apply", "batch", "fit", "next", "run"].includes(command ?? "");
  const toggles = needsToggles ? settings() : DEFAULTS;
  const resume = flags.resume ?? toggles.resume;
  if (needsToggles && !isResumeId(resume)) throw new Error(`No resume "${resume}" in ${paths.resumes}. Options: ${listResumes().join(", ") || "none yet, add a PDF"} (jh set resume <id>)`);
  const submit = (flags.submit ?? toggles.submit) as SubmitMode;
  if (!["review", "auto", "dry"].includes(submit)) throw new Error("--submit is review, auto or dry");
  const browser = { headless: flags.headless, cdp: flags.cdp };
  if (!(flags.jev ?? toggles.jevFill)) disableJev();
  const fit = flags.fit ?? toggles.fitCheck;

  switch (command) {
    case "init":
      return init();
    case "apply": {
      const url = args[0];
      if (!url) throw new Error("jh apply <url>");
      await apply({ url, resume, submit, browser, fit });
      return;
    }
    case "batch": {
      const file = args[0];
      if (!file) throw new Error("jh batch <file>");
      const urls = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      for (const [i, url] of urls.entries()) {
        console.log(`\n=== ${i + 1}/${urls.length} ${url}`);
        await apply({ url, resume, submit, browser, fit }).catch((e) => console.error(`  failed: ${e.message}`));
      }
      return;
    }
    case "fit": {
      if (!args.length) throw new Error("jh fit <url> [url...]");
      const { chromium } = await import("playwright");
      const b = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
      const pageJob = async (url: string) => {
        const page = await b.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(2500);
        const job = { url, title: await page.title(), company: "", location: "", description: await page.innerText("body") };
        await page.close();
        return job;
      };
      try {
        for (const url of args) {
          const job = (siteKey(url) === "linkedin" && (await linkedin.guestJob(url))) || (await pageJob(url));
          const label = job.company ? `${job.title} at ${job.company} (${job.location})` : job.title;
          const fit = await checkFit(job, resume);
          if (!fit) throw new Error(`Jev isn't available: no TYPESAFE_API_KEY and no ${paths.typesafeKey}`);
          console.log(`\n${fit.verdict.toUpperCase().padEnd(5)} ${fit.score.toFixed(2)}  ${label.slice(0, 100)}\n${fit.reasons.map((r) => `      ${r}`).join("\n")}`);
        }
      } finally {
        await b.close();
      }
      return;
    }
    case "open": {
      const { page, close } = await openBrowser(browser);
      await page.goto(args[0] ?? "https://www.linkedin.com/login");
      await ask("Log in wherever you need to. Press enter when done.");
      await close();
      return;
    }
    case "resumes": {
      const ids = listResumes();
      if (!ids.length) return console.log(`No resumes yet. Put a PDF in ${paths.resumes} (resume.pdf is the default).`);
      for (const id of ids) console.log(`${id === resume ? "*" : " "} ${id.padEnd(16)} ${resumePath(id)}`);
      return;
    }
    case "models":
      for (const role of Object.keys(models) as ModelRole[]) console.log(`${role.padEnd(6)} ${specFor(role)}`);
      return;
    case "sites":
      for (const s of listSites()) {
        console.log(`${s.site.padEnd(28)} ${String(s.applications).padStart(3)} applied  ${Object.keys(s.questions).length} questions  last ${s.lastUsed}`);
      }
      return;
    case "questions": {
      if (!args[0]) {
        const pending = listPending();
        console.log(pending.length ? "Waiting on you (jh answer):" : "Nothing waiting on you.");
        for (const p of pending) console.log(`  - ${p.label}  (${p.company || p.url})`);
        console.log("\nFor every catalogued question a site has asked: jh questions <site>  (see jh sites)");
        return;
      }
      const bank = loadBank();
      const sites = [loadSite(args[0])];
      for (const s of sites) {
        const open = Object.entries(s.questions).filter(([key]) => !bank[key] && !ruleAnswer(key) && !EEO.test(key));
        if (!open.length) continue;
        console.log(`\n${s.site}`);
        for (const [, q] of open) console.log(`  - ${q.label}${q.options.length ? `  [${q.options.join(" / ")}]` : ""}`);
      }
      console.log('\nAnswer one with: jh answer "<question>" "<answer>"');
      return;
    }
    case "answers": {
      const search = normalize(args[0] ?? "");
      for (const [key, e] of Object.entries(loadBank())) {
        if (search && !key.includes(search)) continue;
        console.log(`- ${e.question}\n  ${e.answer.replace(/\n/g, "\n  ")}\n  (${e.source}, used ${e.uses}x, ${e.updated})`);
      }
      return;
    }
    case "answer": {
      const [question, answer] = args;
      const bank = loadBank();
      if (question && answer) {
        remember(bank, question, answer, "you");
        saveBank(bank);
        resolvePending(normalize(question));
        console.log(`saved: ${normalize(question)}`);
        return;
      }
      // No arguments: walk the questions runs couldn't answer, one per distinct question.
      const byKey = new Map<string, Pending[]>();
      for (const p of listPending()) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
      if (!byKey.size) return console.log("No pending questions.");
      console.log(`${byKey.size} question${byKey.size > 1 ? "s" : ""} to answer. Enter skips, q stops.`);
      const rerun = new Set<string>();
      for (const [key, rows] of byKey) {
        const first = rows[0]!;
        console.log(`\n${first.label}\n  asked by ${rows.map((r) => r.company || r.url).join(", ")}${first.options.length ? `\n  options: ${first.options.join(" / ")}` : ""}`);
        const reply = await ask(">");
        if (reply === "q") break;
        if (!reply) continue;
        remember(bank, first.label, reply, "you");
        saveBank(bank);
        resolvePending(key);
        rows.forEach((r) => rerun.add(r.url));
      }
      if (rerun.size) console.log(`\nSaved. Re-run the jobs that were waiting:\n${[...rerun].map((u) => `  jh apply ${u}`).join("\n")}`);
      return;
    }
    case "forget": {
      const key = normalize(args[0] ?? "");
      if (!loadBank()[key]) throw new Error(`No bank answer for "${key}"`);
      forget(key);
      console.log(`removed: ${key}`);
      return;
    }
    case "fits": {
      const [filter] = args;
      const checks = loadFitChecks();
      const pick = !filter ? checks
        : ["apply", "maybe", "skip"].includes(filter) ? checks.filter((c) => c.verdict === filter)
        : ["right", "wrong"].includes(filter) ? checks.filter((c) => c.label === filter)
        : filter === "unlabeled" ? checks.filter((c) => !c.label)
        : findFitChecks(filter);
      const verdicts = ["apply", "maybe", "skip"] as const;
      console.log(`${checks.length} checks  ·  ${verdicts.map((v) => `${v} ${checks.filter((c) => c.verdict === v).length}`).join("  ·  ")}`);
      const labeled = checks.filter((c) => c.label);
      if (labeled.length) {
        const right = labeled.filter((c) => c.label === "right").length;
        const per = verdicts.map((v) => {
          const l = labeled.filter((c) => c.verdict === v);
          return l.length ? `${v} ${l.filter((c) => c.label === "right").length}/${l.length}` : "";
        }).filter(Boolean);
        console.log(`labeled ${labeled.length}: ${right} right, ${labeled.length - right} wrong (${Math.round((right / labeled.length) * 100)}%)  ·  ${per.join("  ·  ")}`);
      }
      for (const c of pick) {
        const now = verdictFrom(c.raw).verdict;
        const tags = [
          c.label && `${c.label}${c.label_note ? `: ${c.label_note}` : ""}`,
          c.applied && `tracker: ${c.applied}`,
          now !== c.verdict && `current weights say ${now}`,
        ].filter(Boolean);
        console.log(`\n#${c.id}  ${c.verdict.toUpperCase().padEnd(5)} ${c.score.toFixed(2)}  ${c.company ? `${c.company} | ` : ""}${c.title}${c.location ? ` (${c.location})` : ""}${tags.length ? `  [${tags.join("; ")}]` : ""}`);
        console.log(`${c.reasons.map((r) => `      ${r}`).join("\n")}\n      ${c.date}  ${c.url}`);
      }
      if (pick.length) console.log('\nMark one: jh judge <#id> right|wrong ["why"]');
      return;
    }
    case "judge": {
      const [query, label, ...note] = args;
      if (!query || (label !== "right" && label !== "wrong")) throw new Error('jh judge <#id|words> right|wrong ["why"]');
      const matches = findFitChecks(query);
      if (matches.length !== 1) throw new Error(matches.length ? `"${query}" matches ${matches.map((m) => `#${m.id}`).join(", ")}. Use the #id.` : `No fit check matches "${query}"`);
      labelFitCheck(matches[0]!.id, label, note.join(" "));
      console.log(`#${matches[0]!.id} ${matches[0]!.verdict} for ${matches[0]!.company} | ${matches[0]!.title}: ${label}`);
      return;
    }
    case "usage": {
      const days = Number(args[0] ?? 30);
      const fmt = (n: number | null) => (n ?? 0).toLocaleString("en-US");
      const money = (r: UsageRow) => (r.provider === "codex" ? "subscription" : r.provider === "claude" ? `$${(r.cost ?? 0).toFixed(2)} list (subscription)` : r.cost === null ? "" : `$${r.cost.toFixed(4)}`);
      const line = (label: string, r: UsageRow) =>
        console.log(`  ${label.padEnd(34)} ${String(r.calls).padStart(5)} calls  ${fmt(r.input).padStart(11)} in  ${fmt(r.cached).padStart(10)} cached  ${fmt(r.output).padStart(9)} out  ${(r.ms / 1000).toFixed(0).padStart(5)}s  ${money(r)}`);
      console.log(`Last ${days} days\n\nBy model:`);
      for (const r of usageBy(["provider", "model"], days)) line(`${r.provider} ${r.model}`, r);
      console.log("\nBy purpose:");
      for (const r of usageBy(["purpose", "provider"], days)) line(`${r.purpose} (${r.provider})`, r);
      console.log("\nBy run (top 15):");
      const runs = new Map<string, UsageRow[]>();
      for (const r of usageBy(["run", "provider"], days)) runs.set(r.run, [...(runs.get(r.run) ?? []), r]);
      for (const [name, rows] of [...runs].slice(0, 15)) {
        const sum = rows.reduce((t, r) => ({ ...t, calls: t.calls + r.calls, input: t.input + r.input, cached: t.cached + r.cached, output: t.output + r.output, ms: t.ms + r.ms }), { ...rows[0]!, calls: 0, input: 0, cached: 0, output: 0, ms: 0 });
        const jev = rows.find((r) => r.provider === "jev")?.cost ?? 0;
        line(name, { ...sum, provider: "jev", cost: jev });
      }
      return;
    }
    case "run": {
      // The unattended loop: find postings, fit-check, queue; in auto mode also apply.
      // No --submit: follow the live toggle, so `jh set submit review` stops an auto runner.
      const opts = { submit: flags.submit ? submit : undefined, headless: flags.headless, cdp: flags.cdp };
      if (args.includes("once")) console.log(await runOnce(opts));
      else await runForever(opts);
      return;
    }
    case "queue": {
      const status = args[0] ?? "queued";
      const rows = all<QueueRow>("SELECT * FROM job_queue WHERE status = ? ORDER BY fit_score DESC, added_at", status);
      const counts = all<{ status: string; n: number }>("SELECT status, count(*) AS n FROM job_queue GROUP BY status");
      console.log(counts.map((c) => `${c.status} ${c.n}`).join("  ·  ") || "queue is empty (jh run once)");
      for (const r of rows.slice(0, 50)) {
        console.log(`  ${r.fit_verdict.padEnd(5)} ${r.fit_score.toFixed(2)}  ${r.company} | ${r.title} (${r.location})  [${r.source}]${r.note ? `  ${r.note}` : ""}\n             ${r.url}`);
      }
      return;
    }
    case "next": {
      // Work the queue by hand: best fit first, review mode unless --submit says otherwise.
      const count = Number(args[0] ?? 1);
      for (let i = 0; i < count; i++) {
        const row = claimNext();
        if (!row) return console.log("Queue is empty. jh run once to fill it.");
        console.log(`\n=== ${row.company} | ${row.title}  (${row.fit_verdict} ${row.fit_score.toFixed(2)})`);
        const result = await apply({ url: row.url, resume, submit: flags.submit ? submit : "review", browser, fit: false })
          .catch((e: Error) => (markQueued(row.url, "failed", e.message.split("\n")[0]), undefined));
        if (result) {
          if (!result.submitted) markQueued(row.url, "skipped", "not submitted (you passed or quit)");
          else markQueued(row.url, result.confirmed ? "done" : "check", result.confirmed ? "submitted" : "submitted, no confirmation seen: check it");
        }
      }
      return;
    }
    case "settings": {
      const current = settings();
      if (args.includes("json")) return console.log(JSON.stringify({ current, defaults: DEFAULTS }));
      for (const [key, value] of Object.entries(current)) {
        const changed = JSON.stringify(value) !== JSON.stringify(DEFAULTS[key as SettingKey]);
        console.log(`${changed ? "*" : " "} ${key.padEnd(16)} ${Array.isArray(value) ? value.join(" | ") : String(value)}`);
      }
      console.log('\n* = changed from the default.  jh set <key> <value>  ·  jh reset <key>\nLists: jh set searches "software engineer | ai engineer" (commas work when no item has one)');
      return;
    }
    case "set": {
      const [key, ...value] = args;
      if (!key || !value.length) throw new Error("jh set <key> <value>   (see jh settings)");
      const next = setSetting(key, value.join(" "));
      const v = next[key as SettingKey];
      console.log(`${key} = ${Array.isArray(v) ? v.join(" | ") : String(v)}`);
      return;
    }
    case "reset": {
      if (!args[0]) throw new Error("jh reset <key>");
      resetSetting(args[0]);
      console.log(`${args[0]} back to default`);
      return;
    }
    case "tracker": {
      const [filter] = args;
      const apps = loadApplications().filter((a) => !filter || (isStatus(filter) ? a.status === filter : findApplications(filter).includes(a)));
      const counts = STATUSES.map((st) => [st, loadApplications().filter((a) => a.status === st).length] as const).filter(([, n]) => n);
      console.log(counts.map(([st, n]) => `${st} ${n}`).join("  ·  "));
      for (const a of apps) {
        const fit = a.fit ? `${a.fit.verdict} ${a.fit.score.toFixed(2)}` : "";
        console.log(`\n${a.date}  ${a.status.padEnd(12)} ${a.company} | ${a.title}`);
        console.log(`            ${[a.location, a.site, a.resume && `resume ${a.resume}`, fit, a.answers.length && `${a.answers.length} answers`].filter(Boolean).join("  ·  ")}`);
        console.log(`            ${a.id}`);
      }
      return;
    }
    case "show": {
      const query = args.join(" ");
      if (!query) throw new Error("jh show <id or company words>");
      const [a, ...more] = findApplications(query);
      if (!a) throw new Error(`Nothing in the tracker matches "${query}"`);
      if (more.length) console.log(`(${more.length} more match: ${more.map((m) => m.id).join(", ")})\n`);
      console.log(`${a.company} | ${a.title}\n${a.status}, ${a.date}  ·  ${a.location}  ·  ${a.site}  ·  resume ${a.resume}${a.confirmed ? "  ·  confirmed" : ""}`);
      if (a.run) {
        const name = basename(a.run);
        console.log(`${a.url}\nscreenshots + answers: ${join(paths.runs, name)}`);
      } else console.log(a.url);
      if (a.run) {
        const used = usageBy(["provider"], 0, basename(a.run));
        if (used.length) console.log(`tokens: ${used.map((u) => `${u.provider} ${u.calls} calls, ${(u.input ?? 0).toLocaleString("en-US")} in / ${(u.output ?? 0).toLocaleString("en-US")} out${u.provider === "jev" ? ` ($${(u.cost ?? 0).toFixed(4)})` : ""}`).join("  ·  ")}`);
      }
      if (a.fit) console.log(`\nfit: ${a.fit.verdict} ${a.fit.score.toFixed(2)}\n${a.fit.reasons.map((r) => `  ${r}`).join("\n")}`);
      if (a.answers.length) {
        console.log("\nanswers:");
        for (const q of a.answers) console.log(`  - ${q.question}  [${q.source}]\n    ${q.answer.replace(/\n/g, "\n    ")}`);
      }
      if (a.notes) console.log(`\nnotes:\n  ${a.notes.replace(/\n/g, "\n  ")}`);
      console.log(`\nhistory:\n${a.history.map((h) => `  ${h.date}  ${h.status}${h.note ? `  ${h.note}` : ""}`).join("\n")}`);
      return;
    }
    case "status": {
      const [query, status, ...note] = args;
      if (!query || !status || !isStatus(status)) throw new Error(`jh status <id or company> <${STATUSES.join("|")}> [note]`);
      const matches = findApplications(query);
      if (matches.length !== 1) throw new Error(matches.length ? `"${query}" matches ${matches.map((m) => m.id).join(", ")}. Use the id.` : `Nothing matches "${query}"`);
      setStatus(matches[0]!.id, status, note.join(" "));
      console.log(`${matches[0]!.company} | ${matches[0]!.title} -> ${status}`);
      return;
    }
    case "login":
      return login(args);
    default:
      console.log(HELP);
  }
}

async function login([sub, host]: string[]) {
  if (sub === "list") {
    console.log(`default  ${defaultLogin()?.email ?? "(not set, run jh login default)"}`);
    for (const l of listLogins()) console.log(`${l.site}  ${l.email}  (${l.created_at.slice(0, 10)})`);
    return;
  }
  if (sub !== "default" && !(sub === "set" && host)) throw new Error("jh login default | jh login set <host> | jh login list");
  const fallback = profile().email;
  const email = (await ask(`Email [${fallback}]:`)) || fallback;
  const password = await askHidden("Password: ");
  if (!password) throw new Error("Empty password, nothing saved");
  setCred(sub === "default" ? "default" : host!, email, password);
  console.log(`saved ${sub === "default" ? "default login" : host} (in ${paths.db})`);
}

/**
 * Creates ~/.jh from the templates (never overwriting what's there) and reports which of the
 * tools the harness shells out to are installed.
 */
function init() {
  mkdirSync(paths.resumes, { recursive: true });
  for (const [template, target] of [["profile.example.json", paths.profile], ["context.example.md", paths.context]] as const) {
    if (existsSync(target)) console.log(`  kept     ${target}`);
    else {
      copyFileSync(join(paths.templates, template), target);
      console.log(`  created  ${target}`);
    }
  }
  const has = (cmd: string, ...args: string[]) => {
    try {
      execFileSync(cmd, args.length ? args : ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  const jevKey = !!process.env.TYPESAFE_API_KEY || existsSync(paths.typesafeKey);
  const checks: [boolean, string, string][] = [
    [has("claude") || has("codex") || has("opencode"), "a model CLI (claude, codex or opencode)", "install Claude Code (claude) or Codex (codex) and log in"],
    [has("pdftotext", "-v"), "pdftotext (reads your resume for the fit check)", "brew install poppler / apt install poppler-utils"],
    [jevKey, "Jev key (optional: fit checks and faster option picks)", `get one at typesafe.ai, then put it in ${paths.typesafeKey}`],
    [listResumes().length > 0, "a resume PDF", `copy yours to ${join(paths.resumes, "resume.pdf")}`],
  ];
  console.log("");
  for (const [ok, what, fix] of checks) console.log(`  ${ok ? "ok  " : "TODO"}  ${what}${ok ? "" : `\n        ${fix}`}`);
  console.log(`
Next:
  1. Fill in ${paths.profile} (every form reads it) and ${paths.context} (everything else about you)
  2. jh login default          the email and password used when a site wants an account
  3. jh open                   log in to LinkedIn in the harness's browser, once
  4. jh apply <job url>        fills the form and stops at Submit so you can check it

Everything lives in ${HOME} (JH_HOME moves it).`);
}

main().catch((e: Error) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
