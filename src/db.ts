import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { paths } from "./config.ts";

// One SQLite file (~/.jh/jh.db, or JH_DB) for the tracker, the answer bank, the site catalog,
// settings and logins. Opened lazily on the first query.

export type Param = string | number | boolean | null | undefined;
type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, date TEXT NOT NULL, company TEXT, title TEXT, location TEXT,
  url TEXT, site TEXT, resume TEXT, fit TEXT, confirmed INTEGER DEFAULT 0, run TEXT, notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS applications_url ON applications(url);
CREATE TABLE IF NOT EXISTS application_answers (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, question TEXT, answer TEXT, source TEXT,
  PRIMARY KEY (application_id, position)
);
CREATE TABLE IF NOT EXISTS application_history (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  date TEXT NOT NULL, status TEXT NOT NULL, note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS answers (
  key TEXT PRIMARY KEY, question TEXT, answer TEXT, source TEXT, uses INTEGER DEFAULT 0, updated TEXT
);
CREATE TABLE IF NOT EXISTS sites (
  site TEXT PRIMARY KEY, hosts TEXT DEFAULT '[]', applications INTEGER DEFAULT 0, last_used TEXT
);
CREATE TABLE IF NOT EXISTS site_questions (
  site TEXT NOT NULL, key TEXT NOT NULL, label TEXT, kind TEXT, options TEXT DEFAULT '[]', seen INTEGER DEFAULT 0,
  PRIMARY KEY (site, key)
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS logins (site TEXT PRIMARY KEY, email TEXT NOT NULL, password TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, run TEXT, purpose TEXT, provider TEXT, model TEXT,
  input_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cost_usd REAL, duration_ms INTEGER, prompt TEXT, response TEXT
);
CREATE INDEX IF NOT EXISTS usage_run ON usage(run);
CREATE TABLE IF NOT EXISTS application_urls (
  key TEXT PRIMARY KEY, application_id TEXT NOT NULL, url TEXT, added TEXT
);
CREATE TABLE IF NOT EXISTS job_queue (
  url TEXT PRIMARY KEY, title TEXT, company TEXT, location TEXT, source TEXT, fit_verdict TEXT, fit_score REAL,
  status TEXT NOT NULL DEFAULT 'queued', added_at TEXT NOT NULL, updated_at TEXT NOT NULL, note TEXT,
  claimed_by TEXT, claimed_at TEXT, resume TEXT
);
CREATE TABLE IF NOT EXISTS pending_questions (
  key TEXT NOT NULL, label TEXT, kind TEXT, options TEXT DEFAULT '[]', url TEXT NOT NULL, company TEXT, title TEXT,
  created TEXT, PRIMARY KEY (key, url)
);
CREATE TABLE IF NOT EXISTS fit_checks (
  id INTEGER PRIMARY KEY, url TEXT UNIQUE NOT NULL, date TEXT NOT NULL, company TEXT, title TEXT, location TEXT,
  resume TEXT, model TEXT, verdict TEXT NOT NULL, score REAL, reasons TEXT, raw TEXT, description TEXT,
  label TEXT, label_note TEXT
);
`;

const bind = (params: Param[]) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p));

let db: DatabaseSync | undefined;
function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(paths.db), { recursive: true });
  db = new DatabaseSync(paths.db);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; ${SCHEMA}`);
  return db;
}

/** Rows from one SELECT, or from a write with RETURNING. */
export const all = <T = Row>(sql: string, ...params: Param[]): T[] => open().prepare(sql).all(...bind(params)) as T[];

/** Runs statements in one transaction. */
export function exec(...statements: [string, Param[]][]) {
  const d = open();
  d.exec("BEGIN");
  try {
    for (const [sql, params] of statements) d.prepare(sql).run(...bind(params));
    d.exec("COMMIT");
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

/**
 * One statement typed by a person or an agent (`jh sql`): read-only unless `write`, enforced by
 * SQLite itself (PRAGMA query_only), not by guessing at the SQL. One statement only, since the
 * driver would silently ignore the rest.
 */
export function query(sql: string, { write = false } = {}): Row[] {
  // Literals and comments can hold semicolons; what's left can't, unless there's a second statement.
  const bare = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith("-") || m.startsWith("/") ? " " : "''")).trim().replace(/;\s*$/, "");
  if (!bare) throw new Error("No SQL given");
  if (bare.includes(";")) throw new Error("One statement at a time");
  const d = open();
  d.exec(`PRAGMA query_only=${write ? 0 : 1}`);
  try {
    return d.prepare(sql.trim().replace(/;\s*$/, "")).all() as Row[];
  } finally {
    d.exec("PRAGMA query_only=0");
  }
}

/** Small JSON values that don't deserve a table (LinkedIn resume uploads). */
export function kvGet<T>(key: string): T | undefined {
  const row = all<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)[0];
  return row ? (JSON.parse(row.value) as T) : undefined;
}
export const kvSet = (key: string, value: unknown) =>
  exec(["INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]]);
