import { describe, expect, it } from "vitest";
import { numberFor, workOption } from "../src/planner.ts";

// Work authorization and sponsorship questions with options. Mostly for someone authorized in
// Canada only; the last case is a US citizen.

const canada = { location: "Toronto, Ontario, Canada" };
const us = { location: "New York, NY" };
const CA = ["Canada"];

describe("workOption", () => {
  it("says yes to being entitled to work in Canada even when the label mentions sponsorship", () => {
    const f = {
      label: "Are you currently legally entitled to work in Canada? Please note, Spellbook does not currently provide relocation or visa sponsorship support.",
      options: [
        "Yes, I am legally entitled to work in Canada at the time of this application.",
        "No, I am not legally entitled to work in Canada at the time of this application.",
        "No, but I am in the process of obtaining a visa/work permit to work in Canada at the time of this application.",
      ],
    };
    expect(workOption(f, canada, CA)).toBe(f.options[0]);
  });
  it("says no to needing sponsorship for Canada", () => {
    expect(workOption({ label: "Will you now or in the future require visa sponsorship?", options: ["Yes", "No"] }, canada, CA)).toBe("No");
  });
  it("says no to US authorization and yes to US sponsorship on a US job", () => {
    expect(workOption({ label: "Are you authorized to work in the United States?", options: ["Yes", "No"] }, us, CA)).toBe("No");
    expect(workOption({ label: "Will you require sponsorship to work in the US?", options: ["Yes", "No"] }, us, CA)).toBe("Yes");
  });
  it("says no to needing a visa to travel to the US", () => {
    expect(workOption({ label: "Do you require a visa to travel to the US (based on your passport)?", options: ["Yes", "No"] }, us, CA)).toBe("No");
  });
});

describe("workOption for a US citizen", () => {
  it("says yes to US authorization, no to sponsorship there, and yes to sponsorship in Canada", () => {
    const US = ["United States"];
    expect(workOption({ label: "Are you authorized to work in the U.S.?", options: ["Yes", "No"] }, us, US)).toBe("Yes");
    expect(workOption({ label: "Will you now or in the future require visa sponsorship?", options: ["Yes", "No"] }, us, US)).toBe("No");
    expect(workOption({ label: "Will you require sponsorship?", options: ["Yes", "No"] }, canada, US)).toBe("Yes");
  });
});

describe("numberFor", () => {
  it("keeps only the number for number inputs", () => {
    expect(numberFor("$80,000 CAD and up, flexible for the right role")).toBe("80000");
    expect(numberFor("85k")).toBe("85000");
    expect(numberFor("80000")).toBe("80000");
  });
});
