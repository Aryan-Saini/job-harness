import { describe, expect, it } from "vitest";
import { normalize } from "../src/answers.ts";
import { ruleAnswer, startDate } from "../src/profile.ts";

// Rule answers that depend on where a field sits on the form (its section heading). The profile
// is test/home/profile.json (vitest.config.ts sets JH_HOME).
const rule = (label: string, section?: string) => ruleAnswer(normalize(label), section);

describe("start and end date rules by section", () => {
  it("answers the profile's education dates under an Education heading", () => {
    expect(rule("Start date year", "Education")).toBe("2022");
    expect(rule("Start date month", "Education")).toBe("September");
    expect(rule("End date year *", "Education")).toBe("2026");
    expect(rule("End date month", "Academic history")).toBe("May");
  });
  it("leaves the same labels under Work experience to the model", () => {
    for (const label of ["Start date year", "Start date month", "End date year", "End date month"]) {
      expect(rule(label, "Work experience")).toBeUndefined();
    }
  });
  it("leaves the date parts alone with no section at all", () => {
    expect(rule("Start date year")).toBeUndefined();
    expect(rule("End date month")).toBeUndefined();
  });
  it("answers a bare Start date as availability, except inside education or job history", () => {
    expect(rule("Start date")).toBe(startDate());
    expect(rule("Earliest start date", "Additional questions")).toBe(startDate());
    expect(rule("When can you start?")).toBe(startDate());
    expect(rule("Date available")).toBe(startDate());
    expect(rule("If hired for the job, when could you start?*")).toBe(startDate());
    expect(rule("Start date", "Education")).toBeUndefined();
    expect(rule("Start date", "Employment history")).toBeUndefined();
    expect(rule("Start date", "Previous employer")).toBeUndefined();
  });
});

describe("startDate", () => {
  const now = new Date("2026-10-11T20:00:00Z");
  it("says Immediately when the posting names its own start", () => {
    for (const d of ["Start date: January 2027.", "This role starts in summer 2027", "Positions begin September 2027", "A 2027 start for new grads"]) {
      expect(startDate({ description: d, now }), d).toBe("Immediately");
    }
  });
  it("gives two weeks from today when it doesn't", () => {
    expect(startDate({ description: "Build our React frontend.", now })).toBe("October 25, 2026");
    expect(startDate({ description: "Build our React frontend.", kind: "date", now })).toBe("2026-10-25");
  });
  it("follows a date format hint", () => {
    expect(startDate({ hint: "mm/dd/yyyy", now })).toBe("10/25/2026");
    expect(startDate({ hint: "DD/MM/YYYY", now })).toBe("25/10/2026");
    expect(startDate({ description: "Start date: January 2027", hint: "mm/dd/yyyy", now })).toBe("10/11/2026");
  });
  it("puts today in a date input when the posting names its start", () => {
    expect(startDate({ description: "Starting January 2027", kind: "date", now })).toBe("2026-10-11");
  });
});

describe("residence questions", () => {
  it("answers Yes to living in the profile's country and leaves other countries to the model", () => {
    expect(rule("Are you located in Canada?*")).toBe("Yes");
    expect(rule("Do you currently reside in the U.S.?")).toBeUndefined();
    expect(rule("Are you located near us?")).toBeUndefined();
  });
});

describe("address rules", () => {
  it("fill from profile.address", () => {
    expect(rule("Postal code")).toBe("M5V 1A1");
    expect(rule("City")).toBe("Toronto");
    expect(rule("Province")).toBe("Ontario");
  });
});
