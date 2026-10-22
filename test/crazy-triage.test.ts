import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script module, no types
import { Breaker, nextMidnight, triage } from "../crazy/triage.mjs";

describe("crazy triage", () => {
  it("keeps real form failures as job failures", () => {
    expect(triage({ note: "BLOCKED(stuck-validation: Country)", ms: 400_000 }).kind).toBe("job");
    expect(triage({ note: "checker still wants fixes: Location", ms: 300_000 }).kind).toBe("job");
    // A filler that worked for minutes and then said nothing ran out of time on the form.
    expect(triage({ note: "filler gave no result", ms: 700_000 }).kind).toBe("job");
  });

  it("requeues jobs the machinery failed", () => {
    expect(triage({ note: "filler gave no result", ms: 4_000 })).toMatchObject({ kind: "infra" });
    expect(triage({ note: "You've hit your session limit · resets 9:20pm" })).toMatchObject({ kind: "infra", why: "usage limit" });
    expect(triage({ note: "BLOCKED(form)", raw: "Error: connect ECONNREFUSED 127.0.0.1:9777" })).toMatchObject({ kind: "infra" });
    expect(triage({ note: "checker dropped: no verdict" })).toMatchObject({ kind: "infra" });
  });

  it("pauses LinkedIn for the day and YC for the week instead of burning their jobs", () => {
    expect(triage({ note: "BLOCKED(LinkedIn daily Easy Apply limit reached)" })).toMatchObject({ kind: "pause", source: "linkedin" });
    const now = new Date("2026-10-22T10:00:00Z");
    const yc = triage({ note: "NOT_SUBMITTED(no confirmation; the Send dialog remained open)", source: "yc", now });
    expect(yc).toMatchObject({ kind: "pause", source: "yc", until: "2026-10-29T10:00:00.000Z" });
    // The same words on a company's own form are a form problem, not the YC cap.
    expect(triage({ note: "NOT_SUBMITTED(no confirmation)", source: "yc-direct", now }).kind).toBe("job");
  });

  it("pauses until the next local midnight", () => {
    const at = new Date(2026, 9, 22, 13, 30);
    expect(new Date(nextMidnight(at)).getTime()).toBe(new Date(2026, 9, 23, 0, 0).getTime());
  });
});

describe("crazy breaker", () => {
  it("trips on a burst of infra failures and cools down", () => {
    const b = new Breaker(5, 120_000, 300_000);
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) expect(b.hit(t + i * 1000)).toBe(false);
    expect(b.hit(t + 5000)).toBe(true);
    expect(b.open(t + 6000)).toBe(true);
    expect(b.open(t + 5000 + 300_000)).toBe(false);
  });

  it("ignores failures spread out over time", () => {
    const b = new Breaker(5, 120_000);
    for (let i = 0; i < 10; i++) expect(b.hit(i * 60_000)).toBe(false);
  });
});
