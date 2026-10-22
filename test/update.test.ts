import { describe, expect, it } from "vitest";
import { isNewer, plan } from "../src/update.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-22T12:00:00Z");

describe("isNewer", () => {
  it("compares each part as a number", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });
  it("never calls a pre-release or junk newer", () => {
    expect(isNewer("0.2.0-beta.1", "0.1.0")).toBe(false);
    expect(isNewer("latest", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", "0.2.0-dev")).toBe(false);
  });
});

describe("plan", () => {
  it("checks the first time and then at most once a day", () => {
    expect(plan(undefined, "0.1.0", now, false).check).toBe(true);
    expect(plan({ checkedAt: now - DAY + 60_000 }, "0.1.0", now, false).check).toBe(false);
    expect(plan({ checkedAt: now - DAY }, "0.1.0", now, false).check).toBe(true);
    // A clock that went backwards doesn't silence the check for good.
    expect(plan({ checkedAt: now + DAY }, "0.1.0", now, false).check).toBe(true);
  });
  it("prints the last answer only when it's newer, with the right way to update", () => {
    expect(plan({ checkedAt: now, latest: "0.1.0" }, "0.1.0", now, false).notice).toBeUndefined();
    expect(plan({ checkedAt: now, latest: "0.2.0" }, "0.1.0", now, false).notice).toBe("job-harness 0.2.0 is out (you have 0.1.0): npm i -g job-harness");
    expect(plan({ checkedAt: now, latest: "0.2.0" }, "0.1.0", now, true).notice).toMatch(/: git pull/);
  });
});
