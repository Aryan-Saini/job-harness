// Crazy mode's usage gate: keeps every subscription a little short of its 5-hour limit, so a run
// never ends a window at 100% with jobs cut off halfway (and you keep some for yourself).
// Every 2 minutes it reads Claude's and each Codex account's 5-hour and weekly usage and writes
// gate.json: Claude on or off, and the Codex homes with room. crazy.mjs re-reads it for every job.
// A provider closes at CRAZY_CAP_5H percent (default 82) of its 5-hour window, or 99% of its week.
// A login that stops working (401) is reported through CRAZY_NOTIFY; for Codex it also starts a
// device login and sends you its code, so you can sign in from your phone.
// Usage: node crazy/gate.mjs   (alongside crazy.mjs; Ctrl-C to stop)
// These usage endpoints are the ones the Claude and Codex CLIs use themselves. They aren't a public
// API and can change; when one fails, that provider stays closed and the log says why.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIR, HOME, codexHomes, notify } from "./env.mjs";

const GATE = join(DIR, "gate.json");
const CAP_5H = Number(process.env.CRAZY_CAP_5H ?? 82);
const EVERY_MS = 2 * 60_000;
const CLAUDE_CREDS = join(HOME, ".claude", ".credentials.json");
const useClaude = process.env.CRAZY_CODEX !== "1" && existsSync(CLAUDE_CREDS);

const log = (...a) => appendFileSync(join(DIR, "gate.log"), `${new Date().toTimeString().slice(0, 8)} ${a.join(" ")}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, token, headers = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { authorization: `Bearer ${token}`, ...headers } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: r.status, body };
}

async function claudeUsage() {
  const token = JSON.parse(readFileSync(CLAUDE_CREDS, "utf8")).claudeAiOauth.accessToken;
  const r = await http("https://api.anthropic.com/api/oauth/usage", token, { "anthropic-beta": "oauth-2025-04-20" });
  if (r.status !== 200) throw new Error(`claude usage ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { five: r.body.five_hour?.utilization ?? 0, week: r.body.seven_day?.utilization ?? 0 };
}

async function codexUsage(home) {
  const token = JSON.parse(readFileSync(join(home, "auth.json"), "utf8")).tokens.access_token;
  const r = await http("https://chatgpt.com/backend-api/wham/usage", token);
  if (r.status !== 200) throw new Error(`codex usage ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const rl = r.body.rate_limit ?? r.body;
  return { five: rl.primary_window?.used_percent ?? 0, week: rl.secondary_window?.used_percent ?? 0 };
}

/** Last alert per account, so a dead login pages once every half hour, not every tick. */
const alerted = {};
const due = (key) => Date.now() - (alerted[key] ?? 0) > 30 * 60_000 && (alerted[key] = Date.now());

/** Starts a device login for a Codex home whose login died and sends you the code (valid 15 minutes). */
async function relogin(home) {
  if (!due(home)) return;
  const p = spawn("codex", ["login", "--device-auth"], { env: { ...process.env, CODEX_HOME: home }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const code = await new Promise((resolve) => {
    let out = "";
    const t = setTimeout(() => resolve(undefined), 20_000);
    const read = (d) => { out += d; const m = out.replace(/\x1b\[[0-9;]*m/g, "").match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/); if (m) { clearTimeout(t); resolve(m[0]); } };
    p.stdout.on("data", read); p.stderr.on("data", read);
    p.on("error", () => resolve(undefined));
  });
  p.unref();
  log(`${home}: login stopped working, device login ${code ?? "failed to start"}`);
  await notify(`Codex login needed (${home})`, code
    ? `Open auth.openai.com/codex/device and enter ${code} within 15 minutes.`
    : `Run CODEX_HOME=${home} codex login --device-auth.`);
}

async function tick() {
  const gate = { claude: false, codex: [], at: new Date().toISOString(), detail: {} };
  if (useClaude) {
    try {
      const u = await claudeUsage();
      gate.detail.claude = u;
      gate.claude = u.five < CAP_5H && u.week < 99;
    } catch (e) {
      log("claude:", e.message);
      if (/ 401 /.test(e.message) && due("claude")) await notify("Claude login expired", "Run claude and log in again on the machine running crazy mode.");
    }
  }
  for (const home of codexHomes) {
    try {
      const u = await codexUsage(home);
      gate.detail[home] = u;
      if (u.five < CAP_5H && u.week < 99) gate.codex.push(home);
    } catch (e) {
      log(`${home}:`, e.message);
      if (/ 401 |ENOENT/.test(e.message)) await relogin(home);
    }
  }
  writeFileSync(GATE, JSON.stringify(gate));
  log("gate", JSON.stringify({ open: { claude: gate.claude, codex: gate.codex }, usage: gate.detail }));
}

log(`gate up: cap ${CAP_5H}% of each 5h window, Claude ${useClaude ? "on" : "off"}, Codex homes ${codexHomes.join(", ")}`);
for (;;) { await tick(); await sleep(EVERY_MS); }
