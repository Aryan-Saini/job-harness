import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CLOSED and CONFIRMED aren't exported from apply.ts, so their literals are read from the source.
// (The page-level checks around them, the closed-posting guard and the submit verdict, are
// exercised end to end in submit-gate.test.ts.)
const source = readFileSync(resolve(import.meta.dirname, "../src/apply.ts"), "utf8");
function literal(name: string): RegExp {
  const m = source.match(new RegExp(`^const ${name} = /(.+)/([a-z]*);$`, "m"));
  if (!m) throw new Error(`${name} regex not found in src/apply.ts`);
  return new RegExp(m[1]!, m[2]);
}
const CLOSED = literal("CLOSED");
const CONFIRMED = literal("CONFIRMED");

describe("CLOSED", () => {
  it("matches the ways a posting says it's gone", () => {
    for (const s of [
      "This position is no longer available",
      "This job is no longer accepting applications",
      "Sorry, the job you requested was not found",
      "This position has been filled.",
      "This job has expired",
      "The page you were looking for could not be found",
    ]) expect(s).toMatch(CLOSED);
  });
  it("leaves live postings alone", () => {
    for (const s of ["Apply for this job", "We are no longer remote-first, this role is in Toronto", "Applications close Friday"]) {
      expect(s).not.toMatch(CLOSED);
    }
  });
  it("also matches a sidebar's 'Other jobs no longer available', so the page guard must decide", () => {
    // Documented, not a bug: apply.ts only skips when there's also no Apply button and no form.
    expect("Other jobs no longer available").toMatch(CLOSED);
  });
});

describe("CONFIRMED", () => {
  it("matches confirmation pages", () => {
    for (const s of [
      "Your application for Senior Software Engineer, Platform has been received",
      "Your application was successfully submitted",
      "Application submitted",
      "Thanks for applying to Acme!",
      "We've received your application",
      "Your application was sent to Acme",
    ]) expect(s).toMatch(CONFIRMED);
  });
  it("ignores pages that only mention applications", () => {
    for (const s of ["Submit your application", "Application deadline: Friday", "Your application for this role\n\nhas been viewed"]) {
      expect(s).not.toMatch(CONFIRMED);
    }
  });
  // Bug: CONFIRMED in src/apply.ts starts with a bare "thank you", so a footer like this reads as
  // a confirmation: a form that vanishes into such a page is judged "submitted, confirmed".
  it("does not treat 'Thank you for visiting' as a confirmation", () => {
    expect("Thank you for visiting our careers site").not.toMatch(CONFIRMED);
    expect("Thank you for applying.").toMatch(CONFIRMED);
  });
});
