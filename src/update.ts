import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { HARNESS, HOME } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";

// Tells you when a newer job-harness is on npm. At most one registry call a day, in the
// background while the command runs: it never fails a command, and offline it says nothing. The
// answer is printed (to stderr) on later starts. JH_NO_UPDATE_CHECK=1 turns it off.

const REGISTRY = "https://registry.npmjs.org/job-harness/latest";
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = "update-check";

/** Kept in the kv table: when the registry was last asked, and what it said. */
export type UpdateState = { checkedAt: number; latest?: string };

/** True when `latest` is a higher x.y.z than `current`. Pre-releases and anything unparseable never count. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number);
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/**
 * What to do on this start: the line to print (from the last check's answer), and whether a new
 * check is due (never checked, the last one is a day old, or the clock went backwards).
 */
export function plan(state: UpdateState | undefined, current: string, now: number, fromGit: boolean) {
  const latest = state?.latest && isNewer(state.latest, current) ? state.latest : undefined;
  const how = fromGit ? "git pull && pnpm install" : "npm i -g job-harness";
  return {
    notice: latest ? `job-harness ${latest} is out (you have ${current}): ${how}` : undefined,
    check: !state || now - state.checkedAt >= DAY_MS || now < state.checkedAt,
  };
}

/**
 * The version npm calls latest. Capped at 1.5 seconds, so on the one start a day that checks,
 * a slow registry holds up jh's exit by at most that, never the command's work.
 */
async function fetchLatest(): Promise<string | undefined> {
  const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(1500), headers: { accept: "application/json" } });
  if (!res.ok) return undefined;
  return z.object({ version: z.string() }).safeParse(await res.json()).data?.version;
}

/** Runs on every `jh` start: prints the update line if the last check found one, and starts a new check when due. Never throws. */
export function updateCheck() {
  if (process.env.JH_NO_UPDATE_CHECK === "1" || !existsSync(HOME)) return;
  try {
    const { version } = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(join(HARNESS, "package.json"), "utf8")));
    const state = kvGet<UpdateState>(KEY);
    const { notice, check } = plan(state, version, Date.now(), existsSync(join(HARNESS, ".git")));
    if (notice) console.error(notice);
    if (!check) return;
    // Recorded before asking, so an offline machine tries once a day, not on every command.
    kvSet(KEY, { ...state, checkedAt: Date.now() });
    fetchLatest()
      .then((latest) => latest && kvSet(KEY, { checkedAt: Date.now(), latest }))
      .catch(() => {});
  } catch {
    // An update check is never worth a failed command.
  }
}
