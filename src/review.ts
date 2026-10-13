import { z } from "zod";
import { llm } from "./llm.ts";
import { facts, fullName, profile } from "./profile.ts";
import type { Job, Planned } from "./planner.ts";

// A second opinion before submit. The fill models (rules, bank, Jev, LLM) answer the form;
// the review model reads every question and answer against your facts and blocks the submit
// when something is wrong. On by default (settings.reviewAnswers).

const reviewSchema = z.object({
  approve: z.boolean(),
  problems: z.array(z.object({ question: z.string(), answer: z.string(), problem: z.string(), fix: z.string() })),
});
export type Review = z.infer<typeof reviewSchema>;

export async function reviewAnswers(job: Job, planned: Planned[]): Promise<Review> {
  const qa = planned
    .filter((p) => p.field.kind !== "file")
    .map((p) => ({
      question: p.field.label.slice(0, 300),
      required: p.field.required,
      options: p.field.options.slice(0, 40),
      answer: p.values.length > 1 ? p.values.join(" | ") : p.value,
      answered_by: p.source,
    }));
  return llm({
    role: "review",
    purpose: "review answers",
    schema: reviewSchema,
    prompt: `You are checking a job application for ${fullName()} right before it is submitted. Other models filled it in. Your job is to catch real mistakes, not to restyle.

Block (approve=false) only for real problems:
- An answer that is false or unsupported by the facts below (wrong work authorization, wrong location, invented employers, numbers, skills, dates or credentials).
- A wrong choice on a select / radio / yes-no (for example "Yes" to needing sponsorship in a country listed in profile.workAuthorization.authorizedIn, or "Yes" to having worked at the company).
- A commitment the facts don't support (relocation, salary, start date).
- A required question left blank or answered with something meaningless.
- A demographic / EEO question answered against profile.eeo (when it is "decline", the decline option is right).
- Text that is clearly broken: placeholder text, notes to the candidate, wrong company name, another language than the question.
Do not block for tone, length, or a reasonable judgment call. The email on every form is ${profile().email} on purpose, so never flag it.

For each problem give the question, the answer, what's wrong, and the fix. approve=true with problems=[] when it's fine.

JOB
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
URL: ${job.url}
Description (excerpt):
${job.description.slice(0, 5000)}

FACTS ABOUT THE CANDIDATE
${facts()}

QUESTIONS AND ANSWERS
${JSON.stringify(qa, null, 1)}`,
  });
}
