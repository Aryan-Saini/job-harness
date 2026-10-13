import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-dedupe-")), "jh.db");
const { postingKey, roleKey, sameCompany, similarTitle } = await import("../src/sources/url.ts");
const { priorApplication, recordApplication } = await import("../src/applications.ts");

describe("postingKey", () => {
  it("gives every URL form of one posting the same key", () => {
    expect(postingKey("https://job-boards.greenhouse.io/embed/job_app?for=assetwatch&token=4730476005"))
      .toBe(postingKey("https://job-boards.greenhouse.io/assetwatch/jobs/4730476005?utm_source=jobright"));
    expect(postingKey("https://boards.greenhouse.io/figma/jobs/5426468004?gh_jid=5426468004")).toBe("greenhouse:5426468004");
    expect(postingKey("https://jobs.lever.co/leadershipconnect/ea312697-dee9-4c08-a5b0-896ad43cfa3b/apply"))
      .toBe(postingKey("https://jobs.lever.co/leadershipconnect/ea312697-dee9-4c08-a5b0-896ad43cfa3b"));
    expect(postingKey("https://jobs.ashbyhq.com/xero/ea1597a0-aa1c-43e4-9195-b279f003fe08/application"))
      .toBe(postingKey("https://jobs.ashbyhq.com/xero/EA1597A0-AA1C-43E4-9195-B279F003FE08"));
    expect(postingKey("https://www.linkedin.com/jobs/search-results/?currentJobId=4474446362&f_AL=true"))
      .toBe(postingKey("https://www.linkedin.com/jobs/view/software-engineer-at-syntrace-4474446362/"));
    expect(postingKey("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Systems-Software-Engineer---GPU-Software_JR2020271"))
      .toBe(postingKey("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x/y_JR2020271/apply/applyManually"));
  });
  it("keys a Tsenta job by its id, with or without the slug", () => {
    expect(postingKey("https://tsenta.com/jobs/marigold-senior-software-engineer-28f110cb-79f9-4391-8339-51c9bd597f6c"))
      .toBe(postingKey("https://tsenta.com/jobs/28f110cb-79f9-4391-8339-51c9bd597f6c"));
  });
  it("keeps different postings apart", () => {
    expect(postingKey("https://jobs.lever.co/a/ea312697-dee9-4c08-a5b0-896ad43cfa3b")).not.toBe(postingKey("https://jobs.lever.co/a/fa312697-dee9-4c08-a5b0-896ad43cfa3b"));
  });
});

describe("similar roles", () => {
  it("matches the same role written differently, not a different level", () => {
    expect(sameCompany("Affirm, Inc.", "affirm")).toBe(true);
    expect(sameCompany("Affirm", "Afterpay")).toBe(false);
    expect(sameCompany("11x.ai", "11x")).toBe(true);
    expect(roleKey("11x.ai", "AI Engineer")).toBe(roleKey("11x, Inc.", "AI Engineer"));
    expect(roleKey("Labs", "AI Engineer")).not.toBe(roleKey("", "AI Engineer"));
    expect(similarTitle("Full Stack Engineer / Senior Full Stack Engineer", "Senior Full Stack Engineer / Full Stack Engineer")).toBe(true);
    expect(similarTitle("Software Engineer, Full Stack (Remote)", "Software Engineer - Full Stack")).toBe(true);
    expect(similarTitle("Software Engineer II", "Senior Software Engineer")).toBe(false);
    expect(similarTitle("Frontend Engineer", "Backend Engineer")).toBe(false);
  });
});

describe("priorApplication", () => {
  it("catches the same job by another URL, or by company + near-identical title", () => {
    recordApplication({
      job: { url: "https://jobright.ai/jobs/info/6a9b3f6b90a313642c6595a3", company: "Leadership Connect", title: "Full Stack Engineer", location: "Canada", description: "" },
      site: "lever", status: "applied", resume: "v6",
      urls: ["https://jobs.lever.co/leadershipconnect/ea312697-dee9-4c08-a5b0-896ad43cfa3b/apply"],
    });
    const viaAts = { url: "https://jobs.lever.co/leadershipconnect/ea312697-dee9-4c08-a5b0-896ad43cfa3b", company: "", title: "", location: "", description: "" };
    expect(priorApplication(viaAts)?.company).toBe("Leadership Connect");
    const reposted = { url: "https://www.linkedin.com/jobs/view/999/", company: "Leadership Connect, Inc.", title: "Full-Stack Engineer (Remote)", location: "", description: "" };
    expect(priorApplication(reposted)?.company).toBe("Leadership Connect");
    const other = { url: "https://www.linkedin.com/jobs/view/1000/", company: "Leadership Connect", title: "Data Engineer", location: "", description: "" };
    expect(priorApplication(other)).toBeUndefined();
  });
});
