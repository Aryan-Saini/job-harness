import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-db-")), "jh.db");
const { all } = await import("../src/db.ts");
const { advanceStatus, applicationId, findApplications, loadApplications, priorApplication, recordApplication, setStatus } = await import("../src/applications.ts");
const { loadBank, remember, saveBank, forget } = await import("../src/answers.ts");
const { verdictFrom } = await import("../src/fit.ts");
const { findFitChecks, labelFitCheck, loadFitChecks, recordFitCheck } = await import("../src/fitlog.ts");

const job = { url: "https://jobs.example.com/1", company: "Acme", title: "Full-Stack Engineer", location: "Toronto", description: "" };

describe("tracker", () => {
  it("records an application with answers and history, then updates it in place", () => {
    const answers = [{ question: "Why Acme?", answer: "Because it's good", source: "model" }];
    recordApplication({ job, site: "greenhouse", status: "unfinished", resume: "v6", answers });
    recordApplication({ job, site: "greenhouse", status: "applied", resume: "v6", answers, confirmed: true });
    setStatus(findApplications("acme")[0]!.id, "interviewing", "recruiter call");

    const [app, ...rest] = findApplications("acme full stack");
    expect(rest).toHaveLength(0);
    expect(app).toMatchObject({ status: "interviewing", confirmed: true, resume: "v6", answers });
    expect(app!.history.map((h) => h.status)).toEqual(["unfinished", "applied", "interviewing"]);
    expect(priorApplication({ ...job, url: "https://elsewhere" })?.id).toBe(app!.id);
  });
});

describe("application ids", () => {
  it("differ for roles that share a readable prefix, and are stable per posting", () => {
    const a = { url: "https://jobs.example.com/2", company: "Acme", title: "Software Engineer, Platform Infrastructure" };
    const b = { ...a, url: "https://jobs.example.com/3", title: "Software Engineer, Platform Infrastructure Tools" };
    expect(applicationId(a, "2026-10-10")).not.toBe(applicationId(b, "2026-10-10"));
    expect(applicationId(a, "2026-10-10")).toBe(applicationId({ ...a, url: `${a.url}?utm_source=x` }, "2026-10-10"));
    expect(applicationId(a, "2026-10-10")).toMatch(/^2026-10-10-acme-software-engineer-platfo-[0-9a-f]{8}$/);
  });
});

describe("answer bank", () => {
  it("round-trips and forgets", () => {
    const bank = loadBank();
    remember(bank, "Are you 18 or older?", "Yes", "you");
    saveBank(bank);
    expect(loadBank()["are you 18 or older"]).toMatchObject({ answer: "Yes", source: "you", uses: 1 });
    forget("are you 18 or older");
    expect(loadBank()["are you 18 or older"]).toBeUndefined();
  });
});

describe("fit log", () => {
  const raw = {
    role: 3, tech: 3, target: 0.8, blocker: 0.1,
    seniority: { below: 0, match: 0.9, stretch: 0.1, out_of_reach: 0 },
    location: { workable: 1, needs_visa: 0, unclear: 0 },
  };

  it("scores raw answers with the policy in code", () => {
    expect(verdictFrom(raw).verdict).toBe("apply");
    expect(verdictFrom({ ...raw, location: { ...raw.location, workable: 0, needs_visa: 1 } }).verdict).toBe("skip");
  });

  it("keeps a label through a re-check and links the tracker entry", () => {
    recordFitCheck(job, "v6", "jev-1.13.0", raw, verdictFrom(raw));
    const [check] = findFitChecks("acme");
    labelFitCheck(check!.id, "wrong", "too senior");
    recordFitCheck(job, "v6", "jev-1.13.0", raw, verdictFrom(raw));
    expect(loadFitChecks()).toHaveLength(1);
    expect(loadFitChecks()[0]).toMatchObject({ label: "wrong", label_note: "too senior", applied: "interviewing", verdict: "apply" });
  });
});

describe("advanceStatus", () => {
  it("never moves an application backwards, but still logs the event", () => {
    const app = recordApplication({ job: { ...job, url: "https://jobs.example.com/late-ack" }, site: "email", status: "applied", resume: "unknown" });
    advanceStatus(app.id, "rejected", "rejection email");
    advanceStatus(app.id, "applied", "confirmation email received");
    advanceStatus(app.id, "responded", "next step email");
    const [after] = findApplications(app.id);
    expect(after!.status).toBe("rejected");
    expect(after!.history.map((h) => h.note)).toContain("confirmation email received");
  });
});
