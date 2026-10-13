import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyOpts, ApplyResult } from "../src/apply.ts";

// The queue, driven through runOnce. Discovery finds nothing and apply is a stub that records
// each call, so the calls are the claimed jobs in claim order.
const dir = mkdtempSync(join(tmpdir(), "jh-runner-"));
process.env.JH_DB = join(dir, "jh.db");

const applied = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("../src/apply.ts", () => ({
  apply: async (opts: ApplyOpts): Promise<ApplyResult> => {
    applied.urls.push(opts.url);
    return { job: { url: opts.url, company: "c", title: "t", location: "", description: "" }, submitted: true, confirmed: true, skipped: false, runDir: join("/tmp", "run-x"), note: "" };
  },
}));
vi.mock("../src/jev.ts", () => ({ jevClient: () => ({}) }));
vi.mock("../src/sources/index.ts", async (real) => ({ ...(await real<object>()), discover: async () => [] }));

const { all, exec } = await import("../src/db.ts");
const { requeueStale, runOnce } = await import("../src/runner.ts");

const queue = (url: string, score: number, status: string, added = "2026-10-10T00:00:00Z") => exec([
  `INSERT INTO job_queue (url, title, company, location, source, fit_verdict, fit_score, status, added_at, updated_at)
   VALUES (?, 't', 'c', 'l', 'linkedin', 'apply', ?, ?, ?, ?)`,
  [url, score, status, added, added],
]);
const statusOf = (url: string) => all<{ status: string }>("SELECT status FROM job_queue WHERE url = ?", url)[0]?.status;

beforeEach(() => {
  applied.urls = [];
  exec(["DELETE FROM job_queue", []]);
});

describe("auto mode", () => {
  it("applies to queued jobs by fit score, oldest first on a tie, and marks them done", async () => {
    queue("https://jobs.example.com/low", 0.3, "queued");
    queue("https://jobs.example.com/tie-new", 0.6, "queued", "2026-10-10T05:00:00Z");
    queue("https://jobs.example.com/tie-old", 0.6, "queued", "2026-10-10T01:00:00Z");
    queue("https://jobs.example.com/high", 0.9, "queued");
    queue("https://jobs.example.com/skipped", 0.99, "skipped");
    await runOnce({ submit: "auto", headless: true });
    expect(applied.urls).toEqual([
      "https://jobs.example.com/high",
      "https://jobs.example.com/tie-old",
      "https://jobs.example.com/tie-new",
      "https://jobs.example.com/low",
    ]);
    expect(statusOf("https://jobs.example.com/high")).toBe("done");
    expect(statusOf("https://jobs.example.com/skipped")).toBe("skipped");
  });
});

describe("review mode", () => {
  it("only queues: nothing is applied to", async () => {
    queue("https://jobs.example.com/a", 0.9, "queued");
    await runOnce({ submit: "review", headless: true });
    expect(applied.urls).toEqual([]);
    expect(statusOf("https://jobs.example.com/a")).toBe("queued");
  });
});

describe("requeueStale", () => {
  it("puts expired claims back in the queue and leaves fresh ones alone", () => {
    queue("https://jobs.example.com/stale", 0.5, "applying");
    queue("https://jobs.example.com/fresh", 0.5, "applying");
    exec(["UPDATE job_queue SET claimed_at = ?, claimed_by = 'mac:1' WHERE url LIKE '%stale'", ["2000-01-01T00:00:00Z"]],
      ["UPDATE job_queue SET claimed_at = ?, claimed_by = 'mac:2' WHERE url LIKE '%fresh'", [new Date().toISOString()]]);
    requeueStale();
    const rows = all<{ url: string; status: string; claimed_by: string | null }>("SELECT url, status, claimed_by FROM job_queue ORDER BY url");
    expect(rows).toEqual([
      { url: "https://jobs.example.com/fresh", status: "applying", claimed_by: "mac:2" },
      { url: "https://jobs.example.com/stale", status: "queued", claimed_by: null },
    ]);
  });
});
