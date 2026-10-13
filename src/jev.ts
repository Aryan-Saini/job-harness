import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { TypeSafeClient, type Questions, type SystemOneRequest, type SystemOneResult } from "@typesafe-ai/sdk";
import { jev, paths, resumePath, type ResumeId } from "./config.ts";
import { fullName, location, profile } from "./profile.ts";
import { logUsage } from "./usage.ts";

// Jev client plus the candidate facts every Jev question reads. Jev returns typed judgments
// (choices, scores, yes/no probabilities) in about a second, so it handles the decisions the
// harness makes most often. It doesn't write text: free-text answers stay with the LLM roles.

let client: TypeSafeClient | undefined;
let disabled = false;

export const disableJev = () => (disabled = true);

/** The client, or undefined when Jev is off or there's no key (callers fall back to the LLM). */
export function jevClient(): TypeSafeClient | undefined {
  if (disabled) return undefined;
  const apiKey = process.env.TYPESAFE_API_KEY
    ?? (existsSync(paths.typesafeKey) ? readFileSync(paths.typesafeKey, "utf8").trim() : undefined);
  if (!apiKey) return undefined;
  client ??= new TypeSafeClient({ apiKey, defaultModel: jev.model });
  return client;
}

/** Jev's price per input token (output is free), from docs.typesafe.ai/models. */
const JEV_USD_PER_TOKEN = 0.042 / 1_000_000;

/** client.systemOne plus a usage-log entry. Every Jev call in the harness goes through here. */
export async function jevAsk<Q extends Questions>(purpose: string, request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>> {
  const client = jevClient();
  if (!client) throw new Error("Jev isn't available");
  const started = Date.now();
  const result = await client.systemOne(request);
  logUsage({
    purpose,
    provider: "jev",
    model: result.model,
    input: result.usage.input_tokens,
    cached: 0,
    output: result.usage.output_tokens,
    cost: result.usage.input_tokens * JEV_USD_PER_TOKEN,
    ms: Date.now() - started,
    prompt: JSON.stringify(request),
    response: JSON.stringify(result),
  }, true);
  return result;
}

const resumeCache = new Map<ResumeId, string>();

/** Plain text of a resume PDF, for Jev to read. */
export function resumeText(id: ResumeId): string {
  const cached = resumeCache.get(id);
  if (cached) return cached;
  const text = execFileSync("pdftotext", ["-layout", resumePath(id), "-"], { encoding: "utf8" }).replace(/[ \t]+/g, " ");
  resumeCache.set(id, text);
  return text;
}

/** "## Target roles" from context.md, or "" when it has none. */
function targetRoles(): string {
  const md = readFileSync(paths.context, "utf8");
  return md.match(/## Target roles\n([\s\S]*?)(\n## |\n---|$)/)?.[1]?.trim() ?? "";
}

/** The facts about you that eligibility and option questions need. */
export function candidate() {
  const p = profile();
  const e = p.education;
  return {
    name: fullName(p),
    lives_in: location(p),
    work_authorization: {
      authorized_without_sponsorship_in: p.workAuthorization.authorizedIn,
      summary: p.workAuthorization.summary,
    },
    professional_experience: `About ${p.yearsExperience} years of professional experience`,
    education: `${e.degree}, ${e.major}, ${e.school}, ${e.end.month} ${e.end.year}`,
    start_date: "Immediately if the posting names its own start date, otherwise about two weeks from today",
    salary: p.salary,
    target_roles: targetRoles(),
  };
}
