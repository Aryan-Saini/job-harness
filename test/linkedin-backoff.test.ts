import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// linkedinPostings' 429 backoff, with fetch stubbed and fake timers for the 12s+ request spacing.
process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-linkedin-")), "jh.db");
const { exec, kvGet, kvSet } = await import("../src/db.ts");
const { linkedinPostings } = await import("../src/sources/linkedin.ts");
const { setSetting } = await import("../src/settings.ts");

type Backoff = { until: number; strikes: number };
const HOUR = 3_600_000;
const NOW = new Date("2026-10-11T12:00:00Z").getTime();

/** Stubs fetch with one status per request, in order (200 once the list runs out). Returns the requested keyword/location pairs. */
function respond(...statuses: number[]) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    asked.push(`${q.get("keywords")}@${q.get("location")}`);
    return new Response("", { status: statuses.shift() ?? 200 });
  }));
  return asked;
}

/** Runs a sweep to completion, stepping fake time over the delays between requests. */
async function sweep() {
  const done = linkedinPostings();
  await vi.runAllTimersAsync();
  return done;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  vi.setSystemTime(NOW);
  exec(["DELETE FROM kv WHERE key LIKE 'linkedin-%'", []]);
  // 2 x 5 = 10 pairs, so a full sweep (6 requests) never wraps.
  setSetting("searches", "a | b");
  setSetting("locations", "l1 | l2 | l3 | l4 | l5");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("linkedin backoff", () => {
  it("a 429 rests 3h and keeps the cursor on the pair that was refused", async () => {
    const asked = respond(200, 200, 429);
    await sweep();
    expect(asked).toEqual(["a@l1", "a@l2", "a@l3"]);
    // The 429 is the last thing that happens, so "now" is when it came back.
    expect(kvGet<Backoff>("linkedin-backoff")).toEqual({ until: Date.now() + 3 * HOUR, strikes: 1 });
    expect(kvGet<number>("linkedin-cursor")).toBe(2);
  });

  it("sends nothing while resting, then resumes at the kept cursor", async () => {
    kvSet("linkedin-backoff", { until: NOW + HOUR, strikes: 1 });
    kvSet("linkedin-cursor", 2);
    const asked = respond();
    expect(await sweep()).toEqual([]);
    expect(asked).toEqual([]);

    vi.setSystemTime(NOW + 2 * HOUR);
    await sweep();
    expect(asked[0]).toBe("a@l3");
  });

  it("doubles the rest on each 429 in a row, capped at a day", async () => {
    const hours: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = kvGet<Backoff>("linkedin-backoff");
      if (before) vi.setSystemTime(before.until + 1);
      respond(429);
      await sweep();
      const after = kvGet<Backoff>("linkedin-backoff")!;
      hours.push((after.until - Date.now()) / HOUR);
    }
    expect(hours).toEqual([3, 6, 12, 24, 24]);
    expect(kvGet<Backoff>("linkedin-backoff")?.strikes).toBe(4);
  });

  it("a clean sweep lowers the strikes by one and moves the cursor past the pairs it asked", async () => {
    kvSet("linkedin-backoff", { until: NOW - 1, strikes: 3 });
    kvSet("linkedin-cursor", 1);
    const asked = respond();
    await sweep();
    expect(asked).toHaveLength(6);
    expect(kvGet<Backoff>("linkedin-backoff")).toEqual({ until: 0, strikes: 2 });
    expect(kvGet<number>("linkedin-cursor")).toBe(7);
    // The next 429 after that rests by the lowered strike count: 12h, not 24h.
    respond(429);
    await sweep();
    expect(kvGet<Backoff>("linkedin-backoff")).toEqual({ until: Date.now() + 12 * HOUR, strikes: 3 });
  });
});
