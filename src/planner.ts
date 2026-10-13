import { z } from "zod";
import { bestOption, normalize, type Bank } from "./answers.ts";
import type { ResumeId } from "./config.ts";
import type { Field } from "./fields.ts";
import { jevPlan } from "./jevfill.ts";
import { settings } from "./settings.ts";
import { llm } from "./llm.ts";
import { facts, fullName, location, profile, ruleAnswer } from "./profile.ts";

// Decides what goes in each field, cheapest source first: rule (profile.ts) -> exact bank match
//   -> EEO decline -> Jev (jevfill.ts) -> model.
// Only the leftovers cost an LLM call, and they're batched into one call per role.

export type Source = "rule" | "bank" | "eeo" | "resume" | "jev" | "model" | "skip";

export type Planned = {
  field: Field;
  value: string;
  values: string[];
  source: Source;
  /** Model's call: true when the answer is right for any company, so it can go in the bank. */
  reusable: boolean;
  note: string;
};

export type Job = { url: string; company: string; title: string; location: string; description: string };

/** Salary and pay questions: answered per job from the posting, never from the bank. */
const SALARY = /\b(salary|compensation|pay (range|expectations?|requirements?)|desired pay|expected pay|base pay|hourly rate|rate expectations?)\b/;
export const EEO = /gender|race|ethnic|veteran|disabilit|hispanic|latin[oax]|sexual orientation|transgender|lgbt|indigenous|aboriginal|first nations|inuit|visible minorit/;
const DECLINE = /decline|prefer not|(do not|don.?t) wish|wish not|not to (answer|disclose|say|self)|choose not|rather not/i;

/** Plans answers for fields in form order. */
export async function plan(fields: Field[], job: Job, bank: Bank, resume: ResumeId): Promise<Planned[]> {
  const me = profile();
  const out: Planned[] = [];
  const forModel: Field[] = [];
  const salary: Field[] = [];
  const done = (field: Field, value: string, source: Source, note = "", values: string[] = []) =>
    out.push({ field, value, values, source, reusable: source !== "model", note });

  for (const f of fields) {
    const key = normalize(f.label);
    if (f.kind === "file") {
      // One resume per form. Greenhouse labels both uploads "Attach", so after the first (or a
      // labelled resume slot) any other upload is the cover letter's and stays empty.
      const NOT_RESUME = /cover|autofill|photo|picture|avatar|image|headshot|transcript|portfolio|writing sample|certificat/;
      const named = (g: Field) => /resume|cv\b/.test(normalize(g.label));
      const slots = fields.filter((g) => g.kind === "file" && !NOT_RESUME.test(normalize(g.label)));
      const resumeSlot = slots.find(named) ?? slots[0];
      if (NOT_RESUME.test(key) && !/autofill/.test(key)) done(f, "", "skip", `not a resume upload (${f.label}), left empty`);
      else if (/cover/.test(normalize(f.section))) done(f, "", "skip", "cover letter upload, attach by hand if wanted");
      else if (/autofill/.test(key)) done(f, "", "skip", "resume autofill would overwrite answers");
      else if (f !== resumeSlot || out.some((p) => p.source === "resume")) done(f, "", "skip", "second upload slot (likely the cover letter), left empty");
      else done(f, "resume", "resume");
      continue;
    }
    if (f.kind === "text" && !f.required && /robots|honeypot|leave this (field )?(blank|empty)/.test(key)) {
      done(f, "", "skip", "honeypot");
      continue;
    }
    // A searchable combobox only showed part of its list, so any answer may be in it: type and match.
    const fits = (answer: string) => !f.options.length || partialList(f) || bestOption(answer, f.options) !== undefined;
    // Catch-all boxes ("Additional information"): blank when the form already asks for work
    // authorization and start date, else the one logistics line a recruiter needs. Never filler.
    if ((f.kind === "textarea" || f.kind === "text") && /^(additional|other|further) (information|info|comments?|details)|^anything else|^is there anything else|^comments?$|^notes?$/.test(key)) {
      const asked = (re: RegExp) => fields.some((g) => g !== f && re.test(normalize(g.label)));
      const covered = asked(/authori[sz]|eligib|sponsor|visa|citizen|right to work/) && asked(/start|availab|notice period|join/);
      if (covered && !f.required) done(f, "", "skip", "form already asks authorization and start date, left blank");
      else done(f, `${me.workAuthorization.summary} Based in ${location(me)}.`, "rule", "logistics line");
      continue;
    }
    // Pay depends on this job, so never a saved answer or Jev: the fill model reads the posting.
    if (SALARY.test(key)) {
      salary.push(f);
      continue;
    }
    // Demographic questions first: no other rule (residence, location) may answer one, even when
    // a long intro paragraph happens to contain words those rules look for.
    if (EEO.test(key)) {
      // Your own answers (profile.eeo) go to the fill model, which picks the matching option.
      const decline = f.options.find((o) => DECLINE.test(o));
      if (me.eeo !== "decline") forModel.push(f);
      else if (decline) done(f, decline, "eeo", "", [decline]);
      else if (!f.required) done(f, "", "skip", "voluntary demographic question");
      else forModel.push(f);
      continue;
    }
    // Work authorization and sponsorship with options: never a guess (see workOption).
    const sponsor = f.options.length && /sponsor|visa|work permit|entitled|authori[sz]|eligib|right to work/.test(key) ? workOption(f, job, me.workAuthorization.authorizedIn) : undefined;
    if (sponsor) {
      done(f, sponsor, "rule", "", [sponsor]);
      continue;
    }
    // A bare "Start date" on a form that also asks "End date" is a past job's (Jobvite's work
    // history has no heading to tell by), not when you can start.
    const history = /^start date$/.test(key) && fields.some((g) => /^end date$/.test(normalize(g.label)));
    const rule = history ? undefined : ruleAnswer(key, f.section, { description: job.description, kind: f.kind, hint: f.hint }, me);
    if (rule && fits(rule)) {
      done(f, rule, "rule");
      continue;
    }
    const banked = bank[key];
    if (banked && fits(banked.answer)) {
      done(f, banked.answer, "bank", "", banked.answer.split(" | "));
      continue;
    }
    forModel.push(f);
  }

  const fast = await (settings().jevFill ? jevPlan(forModel, job, bank, resume) : Promise.resolve({ planned: [], rest: forModel })).catch((e: Error) => {
    console.log(`  Jev unavailable (${e.message.split("\n")[0]}), using the fill model`);
    return { planned: [], rest: forModel };
  });
  out.push(...fast.planned);
  const longForm = fast.rest.filter(isLongForm);
  const short = [...fast.rest.filter((f) => !isLongForm(f)), ...salary];
  const [a, b] = await Promise.all([
    short.length ? askModel("fill", short, job) : [],
    longForm.length ? askModel("write", longForm, job) : [],
  ]);
  for (const p of a) if (salary.includes(p.field)) p.reusable = false;
  out.push(...a, ...b);
  // A field with fixed options gets one of its options, whatever the source said: a saved
  // "Vancouver, BC, Canada" becomes "Canada" in a country list.
  for (const p of out) {
    // A number input takes digits only: "$80,000 CAD and up" becomes 80000.
    if (p.field.type === "number" && p.value) p.value = numberFor(p.value);
    if (!p.field.options.length || !p.value || partialList(p.field)) continue;
    const pick = (v: string) => bestOption(v, p.field.options) ?? v;
    p.value = pick(p.value);
    p.values = p.values.map(pick);
  }
  return out;
}

const AUTHORIZED = /entitled to work|authori[sz]ed to work|eligible to work|right to work|legally (able|allowed|permitted|entitled|authori[sz]ed|eligible)/;
const ASKS_SPONSORSHIP = /(will|do|would) you (now or in the future )?(require|need)|require (visa )?sponsorship|need (visa )?sponsorship/;

/** Ways forms name countries. Any other country is matched by its name. */
const ALIASES: Record<string, RegExp> = {
  "united states": /\b(us|u\.s\.?|usa|u\.s\.a\.|united states|america)\b/,
  "united kingdom": /\b(uk|u\.k\.|united kingdom|great britain|britain|england)\b/,
  canada: /\bcanad(a|ian)\b/,
};
const KNOWN = Object.keys(ALIASES);
const named = (country: string) => ALIASES[country.toLowerCase()] ?? new RegExp(`\\b${country.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
/** The first country (yours or a well-known one) that `text` names. */
const countryIn = (text: string, yours: string[]) => [...yours, ...KNOWN].find((c) => named(c).test(text.toLowerCase()));

/**
 * The right option on a work authorization or sponsorship question, from the countries you can
 * work in (profile.workAuthorization.authorizedIn). The country is the one the question names,
 * else the job's location; neither means one you're authorized in. "Are you authorized to work
 * in X?" gets yes when you are; "Will you require sponsorship?" gets no when you're authorized.
 * A label that only mentions sponsorship in passing ("we don't sponsor visas") is still an
 * authorization question. A travel visa question gets no.
 */
export function workOption(f: Pick<Field, "label" | "options">, job: Pick<Job, "location">, authorizedIn: string[]): string | undefined {
  const label = f.label.toLowerCase();
  const country = countryIn(label, authorizedIn) ?? countryIn(job.location, authorizedIn);
  const authorized = !country || authorizedIn.some((c) => c.toLowerCase() === country.toLowerCase());
  const pick = (re: RegExp) => f.options.find((o) => re.test(o.toLowerCase()));
  const no = pick(/^no\b|do not|don't|will not|won't|not require|no sponsorship|not (legally )?(entitled|authori[sz]ed|eligible)/);
  const yes = pick(/^yes\b|will require|do require|i require|need sponsorship|i am (legally )?(entitled|authori[sz]ed|eligible)/);
  if (AUTHORIZED.test(label) && !ASKS_SPONSORSHIP.test(label)) return authorized ? yes : no;
  if (/visa to (travel|visit|enter)/.test(label)) return no;
  return authorized ? no : yes;
}

/** The first number in an answer, for number inputs: "$80,000 CAD" -> "80000", "85k" -> "85000". */
export function numberFor(value: string): string {
  const m = value.match(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i);
  if (!m?.[1]) return value;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return String(n);
}

/** A searchable list we only saw the first 60 of (schools, countries): the answer may be further down. */
const partialList = (f: Field) => f.kind === "combobox" && f.typeable && f.options.length >= 60;

function isLongForm(f: Field) {
  return f.kind === "textarea" || (f.kind === "text" && /\b(why|describe|tell us|explain|cover letter)\b/i.test(f.label));
}

const answerSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      value: z.string(),
      values: z.array(z.string()),
      reusable: z.boolean(),
      note: z.string(),
    }),
  ),
});

const RULES_FILL = `- Read each field's whole context before answering: its label, its section and its hint (help text). If the hint gives a format or an example ("e.g. 80% backend, 20% frontend"), answer in that format.
- Use only the facts below. Never invent employers, numbers, dates, addresses or contacts.
- If the facts don't cover a field (a reference's phone, a government ID number), set value "" and say why in note.
- For select, radio, checkbox and combobox fields with options, copy one option's text exactly into value. A combobox's options can be a partial list of a searchable field (schools, cities): then give the real answer (e.g. the candidate's school) even if it isn't in the list shown.
- Preference and ranking questions (role type, team, work style, first/second/third choice) are judgment calls, not facts: pick what fits the candidate's experience instead of leaving them blank. Each rank gets a different option. For multi-select checkboxes, put every chosen option in values.
- For a single checkbox, value is "yes" or "no". Tick consent / "I acknowledge" / privacy boxes with "yes".
- Work authorization and sponsorship: answer from profile.workAuthorization. authorizedIn lists the countries the candidate can work in without sponsorship; anywhere else needs sponsorship.
- Direct questions (a percentage, a split, a number, yes/no, which one, "how much", "how many", "how long"): give just the answer in a few words, like "About 50% backend, 50% frontend." Nothing after it. Explain only when the question literally asks you to ("why", "explain", "describe", "how do you", "tell us about").
- Years of experience: profile.yearsExperience overall. For a specific tool, estimate honestly from the facts; a tool the facts never mention gets 0. Number fields get a bare number, round down.
- Salary and pay: if the posting gives a range, answer its midpoint, in the posting's currency and unit (hourly if hourly). With no range, use profile.salary, adjusted for this title, level and market if the facts say how. A text field gets a short line like "$95,000 CAD"; a number field gets the bare number. Never below a posted range. Put the range or reasoning you used in note.
- Relocation, remote, hybrid and in-office questions: answer from the facts. If they don't say, answer yes.
- Previously worked at / employed by / contracted for this company, or related to an employee: No, unless the facts say otherwise.
- "How did you hear about us": pick LinkedIn or the job board, or "Company website".
- Voluntary demographic questions: answer from profile.eeo when it has an answer for that question, else pick the decline / prefer not to say option.
- reusable is true when the same answer is right for any company (work authorization, years with React). Salary is never reusable. False when it depends on this company or job.
- note is empty unless something needs the candidate's attention. Notes are always in English, even when the form is not.`;

const RULES_WRITE = `- Read the question's whole context first: label, section and hint (help text). Answer in the format the hint asks for.
- If the facts have a standard answer for this kind of question, start from it and reword it lightly for this company and role.
- Sound like the candidate typed it themselves: direct and plain, not a polished essay. If the facts describe how they write, follow that. A recruiter who has read a thousand AI answers should not be able to tell.
- Short. 2 to 4 sentences, 40 to 100 words unless the question clearly wants more. Answer the question that was asked and stop.
- A direct question in a text box ("How much of your role is backend vs frontend?", "How many years...", "Which...") gets just the answer in a few words. Only "why", "explain", "describe", "how do you" and "tell us about" questions get more.
- One concrete thing the candidate did, told plainly, that fits this question. Not a recap of the resume, not a tour of the stack, not education and citizenship unless asked.
- At most one number in the whole answer. Never stack metrics.
- First person. Point first, then the reason. Sentences of uneven length, contractions (I'm, I've, didn't), plain words: build, ship, fix, run, use.
- Never: em dashes, semicolons, "I am excited", "passionate", "leverage", "robust", "seamless", "end-to-end ownership", "I'd bring", "drive impact", "fast-paced", "cutting-edge", "thrive", lists of three adjectives, a closing line that sums up.
- Never invent anything not in the facts.
- "Why this company / why are you interested" questions: open with one specific thing about this company taken from the posting (a product, the problem they solve, who they serve), then tie it to one piece of the candidate's real work that matches it, then one line on what they'd bring to this role. 2 to 4 sentences, 50 to 120 words. Swap test: if the answer would still be true with another company's name in it, rewrite it. Never recite their mission or values back, never praise their culture.
- reusable is false for anything that mentions this company or role, true only for generic answers.
- Answer in the language the question is asked in. Notes are always in English.
- value holds the text, values is [].`;

async function askModel(role: "fill" | "write", fields: Field[], job: Job): Promise<Planned[]> {
  const payload = fields.map((f) => ({
    id: f.id,
    kind: f.kind === "text" ? `text (${f.type})` : f.kind,
    label: f.label,
    ...(f.section ? { section: f.section } : {}),
    ...(f.hint ? { hint: f.hint } : {}),
    required: f.required,
    options: f.options,
  }));
  const prompt = `You are filling out a job application for ${fullName()}. Answer every field below.

Rules:
${role === "fill" ? RULES_FILL : RULES_WRITE}

JOB
URL: ${job.url}
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Description (excerpt):
${job.description.slice(0, 8000)}

FACTS ABOUT THE CANDIDATE
${facts()}

FIELDS
${JSON.stringify(payload, null, 1)}`;

  const { answers } = await llm({ role, prompt, schema: answerSchema });
  const byId = new Map(answers.map((a) => [a.id, a]));
  return fields.map((field) => {
    const a = byId.get(field.id);
    return a?.value || a?.values.length
      ? { field, value: a.value || a.values[0] || "", values: a.values, source: "model" as const, reusable: a.reusable, note: a.note }
      : { field, value: "", values: [], source: "skip" as const, reusable: false, note: a?.note || "model gave no answer" };
  });
}

const jobSchema = z.object({ company: z.string(), title: z.string(), location: z.string() });

/** Reads company, title and location off the posting page text. */
export async function readJob(url: string, pageText: string): Promise<Job> {
  const description = pageText.slice(0, 15000);
  const info = await llm({
    role: "fill",
    purpose: "read job",
    schema: jobSchema,
    prompt: `From this job posting page, give the hiring company, the job title and the job location. Empty string if not shown.\nURL: ${url}\n\n${description.slice(0, 6000)}`,
  }).catch(() => ({ company: "", title: "", location: "" }));
  return { url, description, ...info };
}
