import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Posting } from "../src/sources/index.ts";

process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-discover-")), "jh.db");

const posting = (source: Posting["source"], url: string, company: string, title: string): Posting =>
  ({ url, company, title, location: "Remote", source });

// The same jobs as two sources list them: one by the employer's URL, one by company + title only.
vi.mock("../src/sources/linkedin.ts", async (real) => ({ ...(await real<object>()), linkedinPostings: async () => [] }));
vi.mock("../src/sources/jobright.ts", () => ({
  jobrightPostings: async () => [
    posting("jobright", "https://jobs.lever.co/marigold/ea312697-dee9-4c08-a5b0-896ad43cfa3b?utm_source=jobright", "Marigold", "Senior Software Engineer"),
    posting("jobright", "https://jobright.ai/jobs/info/6aca7604e7a1d9333210b98a", "11x.ai", "AI Engineer"),
  ],
}));
vi.mock("../src/sources/tsenta.ts", () => ({
  tsentaPostings: async () => [
    posting("tsenta", "https://jobs.lever.co/marigold/ea312697-dee9-4c08-a5b0-896ad43cfa3b/apply", "Marigold Inc.", "Senior Software Engineer"),
    posting("tsenta", "https://tsenta.com/jobs/1e31fdd3-c52c-4050-9704-c988a9abae6d", "11x", "AI Engineer"),
    posting("tsenta", "https://tsenta.com/jobs/2e31fdd3-c52c-4050-9704-c988a9abae6d", "11x", "Forward Deployed Engineer"),
  ],
}));

const { discover } = await import("../src/sources/index.ts");
const { setSetting } = await import("../src/settings.ts");

describe("discover across sources", () => {
  it("collapses the same job from Jobright and Tsenta into one", async () => {
    setSetting("sources", "linkedin, jobright, tsenta");
    const found = await discover();
    expect(found.map((p) => [p.source, p.company, p.title])).toEqual([
      ["jobright", "Marigold", "Senior Software Engineer"],
      ["jobright", "11x.ai", "AI Engineer"],
      ["tsenta", "11x", "Forward Deployed Engineer"],
    ]);
  });
});
