// Where crazy mode reads and writes, who it applies as, and the helpers every crazy script shares.
// Everything about you comes from the harness's own folder (JH_HOME, default ~/.jh): profile.json,
// context.md, resumes/ and jh.db. Crazy mode's state (logs, cards, gate, its editable prompts)
// lives in CRAZY_DIR, default ~/.jh/crazy.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HOME = homedir();
export const JH = resolve(process.env.JH_HOME ?? join(HOME, ".jh"));
export const DIR = resolve(process.env.CRAZY_DIR ?? join(JH, "crazy"));
export const CARDS = join(DIR, "cards");
export const DB = process.env.JH_DB ?? join(JH, "jh.db");
/** The repo (or installed package) root: record.ts and ask.ts run from here against src/. */
export const HARNESS = resolve(import.meta.dirname, "..");
export const TABAPI = process.env.TABAPI_URL ?? `http://127.0.0.1:${process.env.TABAPI_PORT ?? 9777}`;
/** One Codex home per Codex account (CRAZY_CODEX_HOMES=~/.codex-a,~/.codex-b); Luna and Sol jobs alternate across them. */
export const codexHomes = (process.env.CRAZY_CODEX_HOMES ?? process.env.CODEX_HOME ?? join(HOME, ".codex"))
  .split(",").map((s) => s.trim().replace(/^~/, HOME)).filter(Boolean);

mkdirSync(CARDS, { recursive: true });

// The prompts ship in crazy/prompts. The run reads its own copies in DIR, because the hourly fixer
// edits them as it learns; a copy is made only when missing, so your edits and the fixer's survive updates.
const SHIPPED = join(HARNESS, "crazy", "prompts");
for (const f of readdirSync(SHIPPED)) if (!existsSync(join(DIR, f))) copyFileSync(join(SHIPPED, f), join(DIR, f));

/** The resume agents upload: CRAZY_RESUME, else the first PDF in ~/.jh/resumes. */
function resume() {
  if (process.env.CRAZY_RESUME) return process.env.CRAZY_RESUME;
  const dir = join(JH, "resumes");
  const pdf = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()[0] : undefined;
  if (!pdf) throw new Error(`no resume: put a PDF in ${dir} or set CRAZY_RESUME`);
  return join(dir, pdf);
}

/** How agents read a verification code a site emails: CRAZY_MAIL_HINT, else they report it and stop. */
const MAIL = process.env.CRAZY_MAIL_HINT
  ?? "There is no inbox access in this setup: report NOT_SUBMITTED(verification code) and stop.";

let vars;
/** Values every prompt can use as __NAME__: who applies, where things are. Read once, on first use. */
function globals() {
  if (vars) return vars;
  const p = JSON.parse(readFileSync(join(JH, "profile.json"), "utf8"));
  return (vars = {
    NAME: `${p.firstName} ${p.lastName}`,
    FIRST: p.firstName,
    // Applying from a separate inbox keeps the flood of confirmation mail out of your own.
    EMAIL: process.env.CRAZY_EMAIL ?? p.email,
    PHONE: p.phone ?? "",
    CONTEXT: join(JH, "context.md"),
    RESUME: resume(),
    DB,
    DIR,
    CARDS,
    TABAPI,
    MAIL,
  });
}

/** A prompt from DIR with its __KEY__ placeholders filled from `own` and globals(). */
export function renderPrompt(file, own = {}) {
  return Object.entries({ ...globals(), ...own }).reduce((s, [k, v]) => s.replaceAll(`__${k}__`, String(v)), readFileSync(join(DIR, file), "utf8"));
}

/** Runs a TypeScript helper (crazy/record.ts, crazy/ask.ts) from the harness root. Resolves {code, out, err}. */
export function tsx(args) {
  const cli = createRequire(import.meta.url).resolve("tsx/cli");
  return new Promise((done) => {
    const p = spawn(process.execPath, [cli, ...args], { cwd: HARNESS });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill("SIGKILL"), 120_000);
    p.on("close", (code) => { clearTimeout(t); done({ code, out, err }); });
    p.on("error", (e) => done({ code: -1, out, err: String(e) }));
  });
}

/**
 * Tells you something needs a look (a tripped breaker, a dead login). CRAZY_NOTIFY is any command;
 * it gets the title and body as its two arguments, e.g. a script that curls ntfy.sh. Without it the
 * message only goes to stderr.
 */
export function notify(title, body) {
  const cmd = process.env.CRAZY_NOTIFY;
  if (!cmd) { console.error(`[notify] ${title}: ${body}`); return Promise.resolve(); }
  return new Promise((done) => {
    const p = spawn(cmd, [title, body], { stdio: "ignore" });
    p.on("close", done);
    p.on("error", (e) => { console.error(`[notify] ${cmd}: ${e.message}`); done(); });
  });
}
