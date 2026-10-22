// Crazy mode: many AI agents apply to your job queue in parallel, each in its own Chrome tab.
// 3 checker lanes (Opus, or Sol when Claude is off), each with 2 Luna and 2 Haiku fillers. Fillers fill
// a form in their own tab (tabapi.cjs) and stop before Submit; the lane's checker reads the card and
// screenshot and passes, sends one round of fixes back, or drops it; on a pass the same filler clicks
// Submit. Every call is capped (BUDGET) so one bad job can't burn the subscription.
// Every step's transcript and tokens land in <state>/cards and then the run folder (record.ts).
// Usage: node crazy/crazy.mjs <minutes> [target]; with a target, slots stop claiming once that many
// have been submitted. CRAZY_LANES=defg runs those checker lanes (default abc). gate.json (written by
// gate.mjs) gates each job: Claude on or off, and which Codex homes (one per account) have room.
// `touch <state>/drain.<pid>` stops a run claiming new jobs, so a new run can take over cleanly.
// State lives in CRAZY_DIR (default ~/.jh/crazy); see crazy/README.md for setup.
// Beside the slots, an auditor reviews every failed job (records ones that really went in, requeues
// once with fix instructions, files questions only you can answer) and an hourly fixer turns
// repeated failures into tips in playbook.md or rules in the prompts, which are re-read per job.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { Breaker, SOURCES, nextMidnight, triage } from "./triage.mjs";
import { CARDS, DB, DIR, HOME, TABAPI, codexHomes, notify, renderPrompt, tsx } from "./env.mjs";
const END = Date.now() + Number(process.argv[2] ?? 120) * 60_000;
const TARGET = Number(process.argv[3] ?? Infinity);
mkdirSync(CARDS, { recursive: true });
const log = (...a) => { const l = `${new Date().toTimeString().slice(0, 8)} ${a.join(" ")}`; console.log(l); appendFileSync(`${DIR}/crazy.log`, l + "\n"); };
const tpl = renderPrompt;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Per-call caps. Claude calls stop at a dollar amount (API prices, a proxy for subscription use);
 *  Codex has no budget flag, so Luna gets minutes instead. */
const BUDGET = { haikuUsd: 0.25, checkUsd: 0.3, fillMin: 12, fixMin: 6, submitMin: 5, fixRounds: 2 };

/** At most `n` holders at once: one per checker lane. */
function semaphore(n) {
  let free = n;
  const waiting = [];
  return async (fn) => {
    if (free > 0) free--;
    else await new Promise((r) => waiting.push(r));
    try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else free++; }
  };
}
const LANES = (process.env.CRAZY_LANES ?? "abc").split("");
const checkers = Object.fromEntries(LANES.map((l) => [l, semaphore(1)]));

/** Runs a command with stdin, resolves {code, out}. `env` adds to this process's environment. */
function run(cmd, args, input, timeoutMs, cwd = DIR, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    // A child that exits before reading its prompt (codex failing fast) must not crash the run.
    p.stdin.on("error", () => {});
    p.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
    p.stdin.end(input);
  });
}

const sql = async (q) => {
  const { out, err } = await run("sqlite3", ["-json", "-cmd", ".timeout 20000", DB, q], "", 60_000);
  if (err.trim()) log("sql error", err.trim().slice(0, 200));
  return out.trim() ? JSON.parse(out) : [];
};
const q = (s) => `'${String(s ?? "").replaceAll("'", "''")}'`;

/** The result line of an agent reply: the last line that starts with a protocol word, else the last line. */
function resultLine(text) {
  const lines = String(text).trim().split("\n").map((l) => l.replace(/^[\s*`>#-]+/, "").trim()).filter(Boolean);
  return lines.filter((l) => /^(FILLED|BLOCKED|CLOSED|SUBMITTED|NOT_SUBMITTED)\b/.test(l)).pop() ?? lines.pop() ?? "";
}

const CLAUDE = ["-p", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--output-format", "json"];
/** A filler turn on its model; Luna runs on the Codex account in `home`. Returns {line, tokens, raw}. */
async function filler(kind, prompt, minutes, home) {
  const t0 = Date.now();
  const f = await fill(kind, prompt, minutes, home);
  return { ...f, ms: Date.now() - t0 };
}
async function fill(kind, prompt, minutes, home) {
  if (kind === "haiku") {
    const r = await run("claude", [...CLAUDE, "--model", "haiku", "--max-budget-usd", String(BUDGET.haikuUsd), "--dangerously-skip-permissions", "--add-dir", HOME], prompt, minutes * 60_000);
    let j = {};
    try { j = JSON.parse(r.out); } catch {}
    const u = j.usage ?? {};
    return { line: resultLine(j.result ?? r.out), raw: r.out, err: r.err, tokens: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cost: j.total_cost_usd ?? null } };
  }
  const r = await run("codex", ["exec", "-m", "gpt-6-luna", "-c", "model_reasoning_effort=high", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json", "-"], prompt, minutes * 60_000, DIR, { CODEX_HOME: home });
  const events = r.out.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const msg = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").pop()?.item?.text ?? "";
  const usage = events.filter((e) => e.type === "turn.completed").reduce((a, e) => ({ input: a.input + (e.usage?.input_tokens ?? 0), output: a.output + (e.usage?.output_tokens ?? 0) }), { input: 0, output: 0 });
  return { line: resultLine(msg), raw: r.out, err: r.err, tokens: { ...usage, cost: null } };
}

/** CRAZY_CODEX=1 (Claude out of usage): Luna fills every slot and Sol judges. */
const CODEX_ONLY = process.env.CRAZY_CODEX === "1";

/** The usage gate, re-read for every job. No gate.json (gate.mjs not running): Claude on (unless CRAZY_CODEX) and every Codex home. */
function gate() {
  const g = { claude: !CODEX_ONLY, codex: codexHomes };
  try { return { ...g, ...JSON.parse(readFileSync(`${DIR}/gate.json`, "utf8")) }; } catch { return g; }
}
let turn = 0;
/** Models for one job: the slot's own filler when its provider is open, else the other one.
 *  Codex jobs alternate across the open accounts. null when nothing is open. */
function pick(kind) {
  const g = gate();
  const home = g.codex.length ? g.codex[turn++ % g.codex.length] : undefined;
  const fill = kind === "haiku" ? (g.claude ? "haiku" : home && "luna") : (home ? "luna" : g.claude && "haiku");
  const judge = g.claude ? "opus" : home && "sol";
  return fill && judge ? { fill, judge, home } : null;
}

/** A Sol judgment: the screenshots go in as images, the answer is schema-checked JSON. */
async function sol(prompt, schema, images, home) {
  const schemaFile = `${DIR}/schema-${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(schemaFile, JSON.stringify(schema));
  const imgs = images.filter((i) => existsSync(i)).flatMap((i) => ["-i", i]);
  const r = await run("codex", ["exec", "-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=medium", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json", "--output-schema", schemaFile, ...imgs, "-"], prompt, 8 * 60_000, DIR, { CODEX_HOME: home });
  rmSync(schemaFile, { force: true });
  const events = r.out.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const msg = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").pop()?.item?.text ?? "";
  const usage = events.filter((e) => e.type === "turn.completed").reduce((a, e) => ({ input: a.input + (e.usage?.input_tokens ?? 0), output: a.output + (e.usage?.output_tokens ?? 0) }), { input: 0, output: 0 });
  let out;
  try { out = JSON.parse(msg); } catch {}
  return { out, raw: r.out + r.err, tokens: { ...usage, cost: null } };
}

/** The checker's judgment: Opus with Read (vision), or Sol when the gate has Claude off. */
async function opus(prompt, schema, images, m, usd = BUDGET.checkUsd) {
  if (m.judge === "sol") return sol(prompt, schema, images, m.home);
  const effort = "medium";
  const r = await run("claude", [...CLAUDE, "--model", "opus", "--effort", effort, "--max-budget-usd", String(usd), "--tools", "Read", "--add-dir", HOME, "--json-schema", JSON.stringify(schema)], prompt, 8 * 60_000);
  try {
    const j = JSON.parse(r.out);
    const u = j.usage ?? {};
    return { out: j.structured_output, raw: r.out, tokens: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cost: j.total_cost_usd ?? null } };
  } catch {
    return { out: undefined, raw: r.out + r.err, tokens: { input: 0, output: 0, cost: null } };
  }
}

const tab = (slug, action, body = {}) => run("curl", ["-s", "-m", "60", "-XPOST", `${TABAPI}/${slug}/${action}`, "-d", JSON.stringify(body)], "", 70_000);
/** Job tabs still open in worker-chrome; whatever is left when the run stops gets closed by cleanup(). */
const openTabs = new Set();

/** Leaves nothing behind: closes this run's job tabs, sweeps orphaned worker-chrome tabs (tabapi closes
 *  every page no named tab owns), and removes temp schema files and drain markers of dead runs. */
async function cleanup() {
  await Promise.all([...openTabs].map((slug) => tab(slug, "close")));
  openTabs.clear();
  const r = await tab("sweeper", "sweep");
  for (const f of readdirSync(DIR)) {
    const pid = f.match(/^drain\.(\d+)$/)?.[1];
    if (f.startsWith("schema-") || (pid && !existsSync(`/proc/${pid}`))) rmSync(`${DIR}/${f}`, { force: true });
  }
  log("cleanup:", r.out.trim() || r.err.trim().slice(0, 100));
}

/** Usage rows go in the same table as the harness's, under the run folder this job will get. */
const usage = (slug, purpose, provider, model, t, text, response) =>
  sql(`INSERT INTO usage (at, run, purpose, provider, model, input_tokens, cached_tokens, output_tokens, cost_usd, duration_ms, prompt, response)
       VALUES (${q(new Date().toISOString())}, ${q(`crazy-${slug}`)}, ${q(purpose)}, ${q(provider)}, ${q(model)}, ${t.input}, 0, ${t.output}, ${t.cost ?? "NULL"}, 0, ${q(text)}, ${q(String(response).slice(0, 200_000))})`);

/** Companies you're already talking to; a second application there is your call, not the agents'. */
const TALKING = "lower(company) NOT IN (SELECT lower(company) FROM applications WHERE status IN ('interviewing', 'responded'))";

/** Sources a site has told us to leave alone for now ({source: {until, why}}), in pauses.json so a restart keeps them. */
const PAUSES = `${DIR}/pauses.json`;
const pauses = () => { try { return JSON.parse(readFileSync(PAUSES, "utf8")); } catch { return {}; } };
function pause(source, until, why) {
  if (pauses()[source]?.until >= until) return;
  writeFileSync(PAUSES, JSON.stringify({ ...pauses(), [source]: { until, why } }, null, 1));
  log(`paused ${source} until ${until}: ${why}`);
}
/** The claim filter that leaves out every source paused right now. */
const unpaused = () => Object.entries(pauses()).filter(([, p]) => p.until > new Date().toISOString())
  .map(([k]) => ` AND NOT (${SOURCES[k]})`).join("");

const push = notify;

/** Title tiers worked first: new grad and early career, then internships, then founding roles. CRAZY_TIERS=0 turns them off. */
const TITLE_TIER = {
  grad: "(lower(title) GLOB '*new grad*' OR lower(title) GLOB '*early career*' OR lower(title) GLOB '*entry*level*' OR lower(title) GLOB '*university grad*' OR lower(title) GLOB '*graduate*' OR lower(title) GLOB '*junior*' OR lower(title) GLOB '*engineer i' OR lower(title) GLOB '*engineer i,*' OR lower(title) GLOB '*engineer i *' OR lower(title) GLOB '*emerging talent*')",
  intern: "(lower(title) GLOB '*intern*' OR lower(title) GLOB '*co-op*' OR lower(title) GLOB '*coop*' OR lower(title) GLOB '*fellow*')",
  founding: "(lower(title) GLOB '*founding*')",
};
/** Agents work audit requeues first, then new grad, intern and founding titles, then hand-picked
 *  targets (source 'target'), then the harness's failures, then the bottom of the queue (the runner
 *  takes the top). */
async function claim() {
  const at = new Date().toISOString();
  const tiers = process.env.CRAZY_TIERS === "0" ? [] : Object.values(TITLE_TIER).map((t) => `status = 'queued' AND ${t}`);
  for (const where of [
    "status = 'queued' AND note LIKE 'requeued by audit%'",
    ...tiers,
    "status = 'queued' AND source = 'target'",
    "status = 'failed' AND coalesce(note,'') NOT LIKE '%crazy mode%'",
    "status = 'queued'",
  ]) {
    const [row] = await sql(`UPDATE job_queue SET status = 'drafting', claimed_by = 'crazy:agent', claimed_at = ${q(at)}, updated_at = ${q(at)}
      WHERE url = (SELECT url FROM job_queue WHERE ${where} AND ${TALKING}${unpaused()} ORDER BY fit_score ${where === "status = 'queued'" ? "ASC" : "DESC"} LIMIT 1)
      RETURNING url, company, title, location, note, source`);
    if (row) return row;
  }
}

const VERDICT = { type: "object", properties: { verdict: { type: "string", enum: ["pass", "fix", "drop", "submitted"] }, fixes: { type: "string" }, note: { type: "string" } }, required: ["verdict", "fixes", "note"], additionalProperties: false };

const stats = { submitted: 0, captcha: 0, failed: 0, requeued: 0 };
let seq = 0;
const breaker = new Breaker();
/** Infra requeues per url this run: a job that keeps "crashing" is probably the job, not the machine. */
const infraTries = new Map();

/**
 * Puts a job that failed for reasons outside it back in the queue, untouched: same note, so its
 * place in the claim order (audit requeues, title tiers) stays. Its cards stay in CARDS for reading.
 */
async function requeue(job, slug, t) {
  await sql(`UPDATE job_queue SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = ${q(new Date().toISOString())} WHERE url = ${q(job.url)} AND status = 'drafting'`);
  stats.requeued++;
  log(`[${slug}] requeued ${job.company}: ${t.why}`);
  if (t.kind === "pause") return pause(t.source, t.until ?? nextMidnight(), t.why);
  infraTries.set(job.url, (infraTries.get(job.url) ?? 0) + 1);
  if (breaker.hit()) {
    log(`breaker: ${breaker.limit} infra failures in ${breaker.windowMs / 60_000} min, no claims until ${new Date(breaker.until).toTimeString().slice(0, 8)} (last: ${t.why})`);
    await push("Crazy mode paused", `${breaker.limit} jobs failed outside the form in 2 minutes (last: ${t.why}). Claims resume in 5 minutes; check the box if it repeats.`);
  }
}

/** One filler slot: claims, fills, gets checked, submits, records. Loops until END or TARGET. */
async function slot(lane, kind, n) {
  while (Date.now() < END - 6 * 60_000 && stats.submitted < TARGET && !draining()) {
    if (breaker.open()) { await sleep(30_000); continue; }
    const m = pick(kind);
    if (!m) { await sleep(60_000); continue; }
    const job = await claim();
    if (!job) { await sleep(60_000); continue; }
    const fillProvider = m.fill === "luna" ? "codex" : "claude", fillModel = m.fill === "luna" ? "gpt-6-luna" : "haiku";
    const slug = `${lane}${m.fill[0]}${n}-${(++seq).toString(36)}${Date.now().toString(36).slice(-3)}`;
    const arm = `agent-${m.fill}`;
    const judge = m.judge === "sol" ? "codex:gpt-6.1-sol:medium" : "claude:opus:medium";
    const models = { filler: m.fill === "luna" ? "codex:gpt-6-luna:high" : "claude:haiku", checker: judge };
    const jobJson = JSON.stringify({ url: job.url, company: job.company, title: job.title, location: job.location, earlierAttempt: job.note || undefined });
    log(`[${slug}] ${m.fill} start ${job.company} | ${job.title}`);
    openTabs.add(slug);
    let outcome = "failed", note = "", checkerNote = "", ms = 0, raw = "";
    try {
      let prompt = tpl("filler.md", { JOB: jobJson, TAB: slug });
      let f = await filler(m.fill, prompt, BUDGET.fillMin, m.home);
      ({ ms } = f); raw = f.raw + f.err;
      writeFileSync(`${CARDS}/${slug}.fill-1.txt`, f.raw);
      await usage(slug, "fill", fillProvider, fillModel, f.tokens, prompt, f.line);
      for (let round = 1; ; round++) {
        if (/^CLOSED/.test(f.line)) { outcome = "skipped"; note = "closed"; break; }
        if (/captcha/i.test(f.line)) { outcome = "captcha"; note = f.line; break; }
        if (!/^FILLED/.test(f.line)) { note = f.line.slice(0, 300) || "filler gave no result"; break; }
        const card = `${CARDS}/${slug}.card.json`, shot = `${CARDS}/${slug}-filled.png`;
        const cp = tpl("checker.md", { CARD: card, SHOT: shot, JOB: jobJson, REPORT: f.line });
        const c = await checkers[lane](() => opus(cp, VERDICT, [shot], m));
        await usage(slug, `check ${round}`, m.judge === "sol" ? "codex" : "claude", m.judge === "sol" ? "gpt-6.1-sol" : "opus", c.tokens, cp, JSON.stringify(c.out ?? c.raw.slice(0, 2000)));
        checkerNote += `round ${round}: ${c.out?.verdict} ${c.out?.fixes || c.out?.note || ""}\n`;
        if (c.out?.verdict === "submitted") { outcome = "submitted"; note = `went in while filling: ${c.out.note}`.slice(0, 300); break; }
        if (!c.out || c.out.verdict === "drop") { note = `checker dropped: ${c.out?.note ?? "no verdict"}`; break; }
        if (c.out.verdict === "fix" && round <= BUDGET.fixRounds) {
          prompt = `${tpl("filler.md", { JOB: jobJson, TAB: slug })}\n\nThe form is ALREADY filled in your tab (do not open the url again unless the tab is blank). A checker found problems. Apply these fixes, then rewrite the card and screenshot:\n${c.out.fixes}`;
          f = await filler(m.fill, prompt, BUDGET.fixMin, m.home);
          ({ ms } = f); raw = f.raw + f.err;
          writeFileSync(`${CARDS}/${slug}.fill-${round + 1}.txt`, f.raw);
          await usage(slug, `fix ${round}`, fillProvider, fillModel, f.tokens, prompt, f.line);
          continue;
        }
        if (c.out.verdict !== "pass") { note = `checker still wants fixes: ${c.out.fixes}`.slice(0, 300); break; }
        // tabapi refuses Submit clicks and Enter until the tab is armed: only this step may submit.
        await tab(slug, "arm");
        const sub = tpl("submit.md", { TAB: slug, SHOT: `${CARDS}/${slug}-submitted.png` });
        const done = await filler(m.fill, sub, BUDGET.submitMin, m.home);
        ({ ms } = done); raw = done.raw + done.err;
        writeFileSync(`${CARDS}/${slug}.submit.txt`, done.raw);
        await usage(slug, "submit", fillProvider, fillModel, done.tokens, sub, done.line);
        // Older replies put both forms on one line; a NOT_SUBMITTED with a reason wins.
        if (/^SUBMITTED/.test(done.line) && !/NOT_SUBMITTED\(\s*\S/.test(done.line)) { outcome = "submitted"; note = done.line.slice(10, 300); }
        else if (/captcha/i.test(done.line)) { outcome = "captcha"; note = done.line.slice(0, 300); }
        else note = done.line.slice(0, 300) || "submit gave no result";
        break;
      }
    } catch (e) { note = String(e).slice(0, 300); }
    await tab(slug, "close");
    openTabs.delete(slug);
    if (outcome === "failed") {
      const t = triage({ note, raw, ms, source: job.source });
      if (t.kind !== "job" && (infraTries.get(job.url) ?? 0) < 3) { await requeue(job, slug, t); continue; }
    }
    // A filler can leave a malformed card; that job records without answers instead of killing every slot.
    let card = { answers: [] };
    try { card = JSON.parse(readFileSync(`${CARDS}/${slug}.card.json`, "utf8")); } catch {}
    const rec = { slug, url: job.url, company: job.company ?? "", title: job.title ?? "", location: job.location ?? "", arm, models, outcome: outcome === "captcha" ? "blocked" : outcome, note: outcome === "captcha" ? `captcha: ${note}` : note, answers: card.answers ?? [], dir: CARDS };
    writeFileSync(`${CARDS}/${slug}.rec.json`, JSON.stringify(rec));
    const r = await tsx(["crazy/record.ts", `${CARDS}/${slug}.rec.json`]);
    if (r.code !== 0) log(`[${slug}] record failed: ${(r.err || r.out).slice(0, 300)}`);
    await sql(`UPDATE bench SET checker = ${q(checkerNote)}, status = ${q(outcome)} WHERE run = ${q(`crazy-${slug}`)}`);
    stats[outcome === "submitted" ? "submitted" : outcome === "captcha" ? "captcha" : "failed"]++;
    log(`[${slug}] ${outcome} ${job.company}: ${note.slice(0, 160)}`);
  }
}

const draining = () => existsSync(`${DIR}/drain.${process.pid}`);
const AUDITED = `${DIR}/audited.json`, AUDITS = `${DIR}/audits.log`;
/** Failed jobs from this far back get audited (default: the last 12 hours). */
const AUDIT_SINCE = process.env.CRAZY_AUDIT_SINCE ?? new Date(Date.now() - 12 * 3600_000).toISOString();
const AUDIT = {
  type: "object", additionalProperties: false, required: ["verdict", "hint", "reason", "questions"],
  properties: {
    verdict: { type: "string", enum: ["submitted", "retry", "question", "final"] }, hint: { type: "string" }, reason: { type: "string" },
    questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "options"], properties: { label: { type: "string" }, options: { type: "array", items: { type: "string" } } } } },
  },
};

/** The final message in a filler transcript (Claude's JSON or Codex's JSONL). */
function finalText(raw) {
  try { return String(JSON.parse(raw).result ?? ""); } catch {}
  const events = raw.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  return events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").pop()?.item?.text ?? raw.slice(-1500);
}

/** Audits one failed bench row. null when no judge is open (nothing was tried), false when the audit failed. */
async function auditOne(row, state) {
  const m = pick("haiku");
  if (!m) return null;
  const slug = row.run.replace(/^crazy-/, "");
  const files = readdirSync(CARDS).filter((f) => f.startsWith(`${slug}.`) || f.startsWith(`${slug}-`)).map((f) => `${CARDS}/${f}`);
  const reports = files.filter((f) => /\.(fill-\d+|submit)\.txt$/.test(f)).map((f) => `${f.split("/").pop()}: ${finalText(readFileSync(f, "utf8")).slice(-1500)}`).join("\n\n");
  const job = { url: row.url, company: row.company, title: row.title };
  const prompt = tpl("audit.md", { FILES: files.join(", ") || "none", JOB: JSON.stringify(job), NOTE: row.note ?? "", CHECKER: row.checker || "none", REPORTS: reports || "none" });
  const c = await opus(prompt, AUDIT, files.filter((f) => f.endsWith(".png")), m, 0.8);
  await usage(slug, "audit", m.judge === "sol" ? "codex" : "claude", m.judge === "sol" ? "gpt-6.1-sol" : "opus", c.tokens, prompt, JSON.stringify(c.out ?? c.raw.slice(0, 2000)));
  const v = c.out;
  if (!v) return false;
  let verdict = v.verdict;
  if (verdict === "retry" && state.retries[row.url]) verdict = "final";
  if (verdict === "submitted" && existsSync(`${CARDS}/${slug}.rec.json`)) {
    const rec = JSON.parse(readFileSync(`${CARDS}/${slug}.rec.json`, "utf8"));
    writeFileSync(`${CARDS}/${slug}.rec.json`, JSON.stringify({ ...rec, outcome: "submitted", note: `went in (audit): ${v.reason}`.slice(0, 300) }));
    const r = await tsx(["crazy/record.ts", `${CARDS}/${slug}.rec.json`]);
    if (r.code !== 0) { log(`[audit ${slug}] record failed: ${(r.err || r.out).slice(0, 200)}`); return false; }
    stats.submitted++;
  } else if (verdict === "retry") {
    state.retries[row.url] = 1;
    await sql(`UPDATE job_queue SET status = 'queued', note = ${q(`requeued by audit: ${v.hint}`.slice(0, 1500))}, claimed_by = NULL, claimed_at = NULL, updated_at = ${q(new Date().toISOString())} WHERE url = ${q(row.url)} AND status IN ('failed', 'skipped')`);
  } else if (verdict === "question" && v.questions.length) {
    const r = await tsx(["crazy/ask.ts", JSON.stringify({ questions: v.questions, ...job })]);
    if (r.code !== 0) log(`[audit ${slug}] ask failed: ${(r.err || r.out).slice(0, 200)}`);
  }
  await sql(`UPDATE bench SET checker = coalesce(checker, '') || ${q(`\naudit: ${verdict}: ${v.reason}`)} WHERE run = ${q(row.run)}`);
  appendFileSync(AUDITS, JSON.stringify({ at: new Date().toISOString(), ...job, failure: (row.note ?? "").slice(0, 300), verdict, reason: v.reason, hint: v.hint, questions: v.questions.map((x) => x.label) }) + "\n");
  log(`[audit ${slug}] ${verdict} ${row.company}: ${v.reason.slice(0, 140)}`);
  return true;
}

const FIXED = ["filler.md", "checker.md", "submit.md", "playbook.md"];
/** Placeholders and result words each prompt must keep; a fixer edit that drops one is rolled back. */
const CONTRACT = { "filler.md": ["__JOB__", "__TAB__", "FILLED", "BLOCKED", "CLOSED"], "checker.md": ["__CARD__", "__SHOT__", "__JOB__", "__REPORT__", "verdict", "yc-note.md"], "submit.md": ["__TAB__", "__SHOT__", "SUBMITTED", "NOT_SUBMITTED"], "playbook.md": ["yc-note.md"] };

/** The hourly fixer: an agent turns repeated audit findings into playbook tips or prompt rules. */
async function fixer(since) {
  const audits = existsSync(AUDITS) ? readFileSync(AUDITS, "utf8").trim().split("\n").filter((l) => l && JSON.parse(l).at > since) : [];
  if (audits.length < 3) return;
  const m = pick("haiku");
  if (!m) return;
  const snap = `${DIR}/prompt-history/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  mkdirSync(snap, { recursive: true });
  for (const f of FIXED) copyFileSync(`${DIR}/${f}`, `${snap}/${f}`);
  const prompt = tpl("fixer.md", { AUDITS: audits.slice(-80).join("\n") });
  const r = m.judge === "opus"
    ? await run("claude", [...CLAUDE, "--model", "opus", "--effort", "high", "--max-budget-usd", "2", "--tools", "Read,Edit,Write,Grep", "--dangerously-skip-permissions", "--add-dir", HOME], prompt, 20 * 60_000)
    : await run("codex", ["exec", "-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=high", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-"], prompt, 20 * 60_000, DIR, { CODEX_HOME: m.home });
  const broken = FIXED.filter((f) => CONTRACT[f].some((w) => !readFileSync(`${DIR}/${f}`, "utf8").includes(w)));
  for (const f of broken) copyFileSync(`${snap}/${f}`, `${DIR}/${f}`);
  if (existsSync(`${DIR}/questions-new.json`)) {
    try { for (const a of [JSON.parse(readFileSync(`${DIR}/questions-new.json`, "utf8"))].flat()) await tsx(["crazy/ask.ts", JSON.stringify(a)]); } catch (e) { log("fixer questions:", String(e).slice(0, 200)); }
    rmSync(`${DIR}/questions-new.json`, { force: true });
  }
  const summary = (m.judge === "opus" ? finalText(r.out) : r.out.trim().split("\n").slice(-12).join("\n")).slice(-1500);
  appendFileSync(`${DIR}/fixes.log`, `## ${new Date().toISOString()} (${m.judge}, ${audits.length} audits)${broken.length ? ` rolled back ${broken.join(", ")}` : ""}\n${summary}\n\n`);
  log(`fixer ran on ${audits.length} audits${broken.length ? `, rolled back ${broken.join(", ")}` : ""}`);
}

/** Audits failed jobs every 10 minutes and runs the fixer hourly, until the run ends or drains. */
async function auditLoop() {
  let lastFix = Date.now() - 50 * 60_000;
  while (Date.now() < END - 6 * 60_000 && !draining()) {
    const state = existsSync(AUDITED) ? JSON.parse(readFileSync(AUDITED, "utf8")) : { runs: {}, retries: {} };
    const rows = await sql(`SELECT run, url, company, title, note, checker FROM bench WHERE run LIKE 'crazy-%' AND status = 'failed' AND created_at >= ${q(AUDIT_SINCE)} ORDER BY created_at`);
    for (const row of rows.filter((r) => !state.runs[r.run]).slice(0, 20)) {
      if (draining()) break;
      // Two tries per job: an audit that keeps failing must not burn every pass. A closed gate is not a try.
      state.tries = state.tries ?? {};
      let done;
      try { done = await auditOne(row, state); } catch (e) { done = false; log(`[audit] ${row.run}: ${String(e).slice(0, 200)}`); }
      if (done === null) break;
      state.tries[row.run] = (state.tries[row.run] ?? 0) + 1;
      if (done || state.tries[row.run] >= 2) state.runs[row.run] = new Date().toISOString();
      writeFileSync(AUDITED, JSON.stringify(state));
    }
    if (Date.now() - lastFix > 60 * 60_000) {
      try { await fixer(new Date(lastFix - 10 * 60_000).toISOString()); } catch (e) { log("fixer:", String(e).slice(0, 200)); }
      lastFix = Date.now();
    }
    for (let i = 0; i < 20 && !draining(); i++) await sleep(30_000);
  }
}

/** Crazy mode's own table in jh.db: one row per attempt, for the auditor and for comparing models. */
const BENCH = `CREATE TABLE IF NOT EXISTS bench (
  run TEXT PRIMARY KEY, url TEXT NOT NULL, company TEXT, title TEXT, arm TEXT NOT NULL, models TEXT,
  filler TEXT NOT NULL DEFAULT 'agent', status TEXT, note TEXT, checker TEXT, created_at TEXT NOT NULL)`;

async function main() {
  await sql(BENCH);
  log(`crazy mode until ${new Date(END).toTimeString().slice(0, 5)}, lanes ${LANES.join("")}, pid ${process.pid}`);
  // A restart orphans the last run's claims: they go back to the queue (or stay failed).
  await cleanup();
  // systemctl stop (watchdog restart, crazy-reset shutdown) must not leave this run's tabs open either.
  for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, async () => { log(`${sig}: cleaning up`); await cleanup(); process.exit(0); });
  await sql(`UPDATE job_queue SET status = CASE WHEN coalesce(note,'') = '' OR note LIKE 'requeued%' THEN 'queued' ELSE 'failed' END, claimed_by = NULL, claimed_at = NULL WHERE claimed_by = 'crazy:agent' AND status = 'drafting'`);
  const slots = [];
  for (const lane of LANES) for (const [kind, n] of CODEX_ONLY ? [["luna", 1], ["luna", 2], ["luna", 3], ["luna", 4]] : [["luna", 1], ["luna", 2], ["haiku", 1], ["haiku", 2]]) slots.push(slot(lane, kind, n));
  const timer = setInterval(() => log("stats", JSON.stringify(stats)), 5 * 60_000);
  await Promise.all([...slots, auditLoop()]);
  clearInterval(timer);
  await cleanup();
  log("done", JSON.stringify(stats));
}
main();
