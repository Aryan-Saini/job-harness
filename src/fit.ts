import { choice, noul, score } from "@typesafe-ai/sdk";
import type { ResumeId } from "./config.ts";
import { candidate, jevAsk, jevClient, resumeText } from "./jev.ts";
import { recordFitCheck } from "./fitlog.ts";
import type { Job } from "./planner.ts";

// "Is this posting worth applying to?" Jev reads the resume and the listing and answers six
// narrow questions in one call. The verdict is plain code over those answers, so the weights
// and cut-offs below can change without asking Jev again.

export type Fit = { verdict: "apply" | "maybe" | "skip"; score: number; reasons: string[] };

const SENIORITY_VALUE = { below: 0.7, match: 1, stretch: 0.6, out_of_reach: 0.1 } as const;
const WEIGHTS = { role: 0.35, tech: 0.25, target: 0.2, seniority: 0.2 };

const questions = {
  role: score("How closely does the day-to-day work described in `listing` match work the candidate has actually done, per `resume`?", [
    "No overlap: a different discipline (hardware, sales, research science, design)",
    "Adjacent: same broad field, but the core work would be mostly new to them",
    "Partial: about half of the core responsibilities match their experience",
    "Strong: most core responsibilities match work shown in their resume",
    "Direct: the role describes almost exactly what they already do",
  ]),
  tech: score("How much of the tech stack `listing` requires appears in `resume`?", [
    "None of the required stack",
    "A little of it",
    "About half of it",
    "Most of it",
    "Nearly all of it",
  ]),
  seniority: choice("How does the experience level `listing` asks for compare with the candidate's `candidate.professional_experience`?", {
    below: "Internship, new grad or junior, under 2 years",
    match: "Asks for 0 to 3 years, or a mid-level role with no stated minimum",
    stretch: "Asks for 3 to 5 years, or a senior title without a hard high minimum",
    out_of_reach: "Staff, principal or manager-of-managers level, or 6+ years required",
  }),
  location: choice("Given where the role in `listing` is based and `candidate.work_authorization`, can the candidate take it?", {
    workable: "Based in a country the candidate can work in, or remote and open to people there",
    needs_visa: "Based in or limited to a country where the candidate would need a visa or sponsorship",
    unclear: "The listing does not say where the role is based or who can apply",
  }),
  target: noul("Is the role in `listing` the kind of role described in `candidate.target_roles`?"),
  blocker: noul(
    "Does `listing` state a hard requirement the candidate clearly does not meet: a security clearance, a professional license, fluency in a language they don't speak, or a degree they don't have?",
  ),
};

/** Jev's answers, kept as numbers so a stored check can be re-scored after a weight change. */
export type FitRaw = {
  role: number;
  tech: number;
  seniority: Record<keyof typeof SENIORITY_VALUE, number>;
  location: Record<keyof typeof questions.location.criteria, number>;
  target: number;
  blocker: number;
};

/** Returns undefined when Jev isn't available, so callers can just skip the check. */
export async function checkFit(job: Job, resume: ResumeId): Promise<Fit | undefined> {
  if (!jevClient()) return undefined;
  const { answers: a, model } = await jevAsk("fit check", {
    state: {
      candidate: candidate(),
      resume: resumeText(resume),
      listing: { title: job.title, company: job.company, location: job.location, description: job.description.slice(0, 12_000) },
    },
    questions,
  });
  const raw: FitRaw = {
    role: a.role.score,
    tech: a.tech.score,
    seniority: a.seniority.probabilities,
    location: a.location.probabilities,
    target: a.target.noul,
    blocker: a.blocker.noul,
  };
  const fit = verdictFrom(raw);
  // Every verdict is logged (file:// test fixtures aside) so `jh fits` can show how Jev is doing.
  if (!job.url.startsWith("file:")) recordFitCheck(job, resume, model, raw, fit);
  return fit;
}

const top = <K extends string>(probs: Record<K, number>) =>
  (Object.entries(probs) as [K, number][]).reduce((best, cur) => (cur[1] > best[1] ? cur : best));

/** The policy: weights, gates and cut-offs over Jev's answers. Pure, so it can re-score stored checks. */
export function verdictFrom(raw: FitRaw): Fit {
  const seniority = (Object.entries(raw.seniority) as [keyof typeof SENIORITY_VALUE, number][])
    .reduce((sum, [level, p]) => sum + p * SENIORITY_VALUE[level], 0);
  const total = WEIGHTS.role * (raw.role / 4) + WEIGHTS.tech * (raw.tech / 4)
    + WEIGHTS.target * raw.target + WEIGHTS.seniority * seniority;

  const [level, levelP] = top(raw.seniority);
  const [where, whereP] = top(raw.location);
  const reasons = [
    `role match ${raw.role.toFixed(1)}/4, stack ${raw.tech.toFixed(1)}/4, target role ${pct(raw.target)}`,
    `seniority: ${level} (${pct(levelP)}), location: ${where} (${pct(whereP)})`,
  ];
  const blocked: string[] = [];
  if (raw.blocker > 0.7) blocked.push(`hard requirement you don't meet (${pct(raw.blocker)})`);
  if (raw.location.needs_visa > 0.6) blocked.push("needs a visa or sponsorship");
  if (raw.seniority.out_of_reach > 0.6) blocked.push("well above your experience level");
  reasons.push(...blocked);

  const verdict = blocked.length ? "skip" : total >= 0.6 ? "apply" : total >= 0.4 ? "maybe" : "skip";
  return { verdict, score: total, reasons };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
