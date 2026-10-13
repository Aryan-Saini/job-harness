import { describe, expect, it } from "vitest";
import { bestOption, normalize } from "../src/answers.ts";
import { extractJson, parseSpec } from "../src/llm.ts";
import { ruleAnswer } from "../src/profile.ts";

describe("normalize", () => {
  it("makes the same question match across forms", () => {
    expect(normalize("Are you legally authorized to work in Canada? *")).toBe(normalize("are you legally authorized to work in canada (Required)"));
    expect(normalize("Current location ✱")).toBe("current location");
  });
});

describe("bestOption", () => {
  it("prefers exact, then prefix, then word overlap", () => {
    expect(bestOption("No", ["Yes", "No", "Not sure"])).toBe("No");
    expect(bestOption("Canada", ["United States", "Canada (+1)"])).toBe("Canada (+1)");
    expect(bestOption("I don't wish to answer", ["Male", "Female", "I don't wish to answer"])).toBe("I don't wish to answer");
    expect(bestOption("banana", ["Yes", "No"])).toBeUndefined();
  });
  it("never crosses a negation", () => {
    expect(bestOption("authorized to work", ["Not authorized to work", "Authorized to work in Canada"])).toBe("Authorized to work in Canada");
    expect(bestOption("authorized to work", ["Not authorized to work", "Other"])).toBeUndefined();
    expect(bestOption("No", ["Yes", "Not sure"])).toBeUndefined();
    expect(bestOption("I am authorized", ["I am unauthorized", "Prefer not to say"])).toBeUndefined();
    expect(bestOption("I don't need sponsorship", ["I need sponsorship", "I do not need sponsorship"])).toBe("I do not need sponsorship");
    expect(bestOption("No", ["Yes, I will require sponsorship", "No, I will not require sponsorship"])).toBe("No, I will not require sponsorship");
  });
  it("matches whole words, not character prefixes", () => {
    expect(bestOption("Man", ["Woman", "Mandarin"])).toBeUndefined();
    expect(bestOption("Yes", ["Yesterday", "Yes, I can"])).toBe("Yes, I can");
  });
  it("needs a majority of content words to overlap", () => {
    expect(bestOption("Bachelor of Science", ["Master of Science", "Bachelor's Degree", "High School"])).not.toBe("Master of Science");
    expect(bestOption("Bachelor of Science", ["Master of Science", "High School"])).toBeUndefined();
    expect(bestOption("Bachelor's degree in Computer Science", ["Master's Degree", "Bachelor's Degree", "PhD"])).toBe("Bachelor's Degree");
  });
});

describe("ruleAnswer", () => {
  it("answers identity questions without a model", () => {
    expect(ruleAnswer(normalize("First Name *"))).toBe("Jane");
    expect(ruleAnswer(normalize("LinkedIn Profile URL"))).toContain("linkedin.com/in/janedoe");
    expect(ruleAnswer(normalize("Location (City)*"))).toBe("Toronto, Ontario, Canada");
    expect(ruleAnswer(normalize("Why do you want to work here?"))).toBeUndefined();
  });
});

describe("model specs", () => {
  it("parses provider, model and effort", () => {
    expect(parseSpec("codex:gpt-6.1-sol:low")).toEqual({ provider: "codex", model: "gpt-6.1-sol", effort: "low" });
    expect(parseSpec("opencode:openrouter/z-ai/glm-5.3-flash")).toMatchObject({ model: "openrouter/z-ai/glm-5.3-flash" });
    expect(() => parseSpec("gpt-4")).toThrow();
  });
  it("pulls JSON out of chatty output", () => {
    expect(extractJson('Sure! {"a": {"b": 1}} hope that helps')).toEqual({ a: { b: 1 } });
  });
});

describe("demographic questions", () => {
  it("pick the decline option when profile.eeo is decline, with no model call", async () => {
    const { plan } = await import("../src/planner.ts");
    type Field = Parameters<typeof plan>[0][number];
    const field: Field = {
      id: "g", kind: "radio", type: "radio", label: "Gender", required: true, filled: false, options: ["Man", "Woman", "Decline to self-identify"], optionIds: [], typeable: false, section: "", hint: "",
      frame: undefined as unknown as Field["frame"],
    };
    const [p] = await plan([field], { url: "u", company: "c", title: "t", location: "", description: "" }, {}, "resume");
    expect(p).toMatchObject({ value: "Decline to self-identify", source: "eeo" });
  });
});
