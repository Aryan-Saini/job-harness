import { choice, noul, type ChoiceResponse, type NoulResponse, type Question } from "@typesafe-ai/sdk";
import { bestOption, type Bank } from "./answers.ts";
import { jev, type ResumeId } from "./config.ts";
import type { Field } from "./fields.ts";
import { candidate, jevAsk, jevClient, resumeText } from "./jev.ts";
import type { Job, Planned } from "./planner.ts";

// The fast path for fields the rules and exact bank lookup missed. One Jev request asks, for
// every field at once:
//   b<i>  which saved question asks the same thing (so a reworded question reuses its answer), not on textareas or date inputs
//   p<i>  which option is true for you, on selects, radios and comboboxes
//   c<i>  whether a lone checkbox should be ticked
//   r<i>  whether the answer would hold for any company (so it can go in the bank)
// Confident answers are used directly; the rest fall through to the fill/write models.

const UNKNOWN = "__unknown";
const NONE = "__none";
const PLACEHOLDER = /^(select|choose|--|please select)/i;
/** Jev's Choice takes at most 255 options. */
const MAX_OPTIONS = 250;

export async function jevPlan(fields: Field[], job: Job, bank: Bank, resume: ResumeId): Promise<{ planned: Planned[]; rest: Field[] }> {
  const client = jevClient();
  if (!client || !fields.length) return { planned: [], rest: fields };

  const bankKeys = Object.entries(bank)
    .sort(([, a], [, b]) => b.uses - a.uses)
    .slice(0, MAX_OPTIONS)
    .map(([key]) => key);
  const options = (f: Field) => f.options.filter((o) => o.trim() && !PLACEHOLDER.test(o));

  const questions: Record<string, Question> = {};
  fields.forEach((f, i) => {
    const field = { label: f.label, kind: f.kind, options: options(f) };
    // Open text boxes get a written answer: a saved short answer (often an option picked on
    // another form) reads as a non-answer there. Exact bank matches still apply in the planner.
    // Free-text questions ("If so, how?") are written fresh, never matched to a saved short answer.
    if (bankKeys.length && f.kind !== "textarea" && f.kind !== "date" && !(f.kind === "text" && /\b(how|why|describe|explain|tell us|what do you)\b/i.test(f.label))) {
      questions[`b${i}`] = choice(
        {
          field,
          question: "Which saved question asks the same thing as `field.label`, so its saved answer can be reused unchanged? Questions about different countries, companies, or tools are not the same thing.",
        },
        { ...Object.fromEntries(bankKeys.map((k) => [k, null])), [NONE]: "No saved question asks the same thing" },
      );
    }
    if ((f.kind === "select" || f.kind === "radio" || f.kind === "combobox") && field.options.length && field.options.length <= MAX_OPTIONS) {
      questions[`p${i}`] = choice(
        { field, question: "Which option is the truthful answer for `candidate` on this job application field, given `resume` and `job`?" },
        { ...Object.fromEntries(field.options.map((o) => [o, null])), [UNKNOWN]: "The facts given don't settle which option is true" },
      );
    }
    if (f.kind === "checkbox") {
      questions[`c${i}`] = noul({
        field,
        question: "Should the candidate tick this checkbox? Yes for required consent, acknowledgement or privacy boxes and statements true of the candidate. No for optional marketing, following the company, or statements that aren't true of them.",
      });
    }
    questions[`r${i}`] = noul({
      field,
      question: "Would the same answer to `field.label` be correct on an application to any other company, rather than depending on this company, job, or office?",
    });
  });

  const { answers } = await jevAsk("fill fields", {
    state: {
      candidate: candidate(),
      resume: resumeText(resume),
      job: { title: job.title, company: job.company, location: job.location, description: job.description.slice(0, 6000) },
    },
    questions,
  });
  const pick = (id: string) => answers[id] as ChoiceResponse | undefined;
  const yes = (id: string) => (answers[id] as NoulResponse | undefined)?.noul;

  const planned: Planned[] = [];
  const rest: Field[] = [];
  fields.forEach((f, i) => {
    const reusable = (yes(`r${i}`) ?? 0) > 0.7;
    const matched = pick(`b${i}`);
    const saved = matched && matched.choice !== NONE && matched.confidence >= jev.bankMatch ? bank[matched.choice] : undefined;
    if (saved && (!f.options.length || bestOption(saved.answer, f.options))) {
      planned.push({ field: f, value: saved.answer, values: saved.answer.split(" | "), source: "bank", reusable: true, note: `same as saved "${saved.question}"` });
      return;
    }
    const option = pick(`p${i}`);
    if (option && option.choice !== UNKNOWN && option.confidence >= jev.pickConfidence) {
      planned.push({ field: f, value: option.choice, values: [option.choice], source: "jev", reusable, note: "" });
      return;
    }
    const tick = yes(`c${i}`);
    if (tick !== undefined && (tick > 0.85 || tick < 0.15)) {
      planned.push({ field: f, value: tick > 0.5 ? "yes" : "no", values: [], source: "jev", reusable, note: "" });
      return;
    }
    rest.push(f);
  });
  return { planned, rest };
}
