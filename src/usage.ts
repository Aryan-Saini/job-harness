import { AsyncLocalStorage } from "node:async_hooks";
import { all, exec, type Param } from "./db.ts";

// Token and cost log for every model call: Claude, Codex, opencode and Jev. Entries are
// buffered in memory and written in one transaction when the process exits (or when a run
// ends), so logging never slows a model call down.
//   cost_usd: Jev is real money ($0.042 per million input tokens). Claude's is the list-price
//   equivalent Claude Code reports; on the subscription it isn't billed. Codex reports none.

export type Usage = {
  purpose: string;
  provider: string;
  model: string;
  input: number;
  cached: number;
  output: number;
  cost: number | null;
  ms: number;
  /** What was asked and answered, for debugging a bad answer later. */
  prompt?: string;
  response?: string;
};

let run = process.argv[2] ?? "jh";
/** Each application in flight has its own run name, so parallel drafts don't take each other's calls. */
type Scope = { run: string | null };
const scopes = new AsyncLocalStorage<Scope>();
const buffer: (Usage & { run: string | null; scope?: Scope; at: string })[] = [];

/** Runs `fn` with its own run name for usage, set by setRun inside it. */
export const inRunScope = <T>(fn: () => Promise<T>): Promise<T> => scopes.run({ run: null }, fn);

/** Calls made before a run folder exists (fit check, job read) are claimed by the next setRun in the same scope. */
export function setRun(name: string) {
  const scope = scopes.getStore();
  if (scope) scope.run = name;
  else run = name;
  for (const u of buffer) if (u.scope === scope) u.run ??= name;
}

export function logUsage(u: Usage, claimLater = false) {
  const scope = scopes.getStore();
  buffer.push({ ...u, run: claimLater ? null : (scope ? scope.run : run), scope, at: new Date().toISOString() });
}

export function flushUsage() {
  if (!buffer.length) return;
  const rows = buffer.splice(0);
  exec(...rows.map((u): [string, Param[]] => [
    `INSERT INTO usage (at, run, purpose, provider, model, input_tokens, cached_tokens, output_tokens, cost_usd, duration_ms, prompt, response)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [u.at, u.run ?? u.scope?.run ?? run, u.purpose, u.provider, u.model, u.input, u.cached, u.output, u.cost, u.ms, u.prompt ?? null, u.response ?? null],
  ]));
}
process.on("exit", () => {
  try {
    flushUsage();
  } catch {}
});

export type UsageRow = { run: string; purpose: string; provider: string; model: string; calls: number; input: number; cached: number; output: number; cost: number | null; ms: number };

/** Totals grouped by the given columns, over the last `days` days. */
export function usageBy(columns: ("run" | "purpose" | "provider" | "model")[], days: number, run?: string): UsageRow[] {
  const cols = columns.join(", ");
  const where = run ? "run = ?" : "at >= ?";
  return all<UsageRow>(
    `SELECT ${cols}, count(*) AS calls, sum(input_tokens) AS input, sum(cached_tokens) AS cached,
       sum(output_tokens) AS output, sum(cost_usd) AS cost, sum(duration_ms) AS ms
     FROM usage WHERE ${where} GROUP BY ${cols} ORDER BY sum(input_tokens) DESC`,
    run ?? new Date(Date.now() - days * 86_400_000).toISOString(),
  );
}
