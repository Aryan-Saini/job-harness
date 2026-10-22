import { spawn } from "node:child_process";
import { trackChild } from "./shutdown.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { models, type ModelRole } from "./config.ts";
import { logUsage } from "./usage.ts";

// One function, `llm`, that asks a model for JSON matching a zod schema. Every provider is a
// local CLI logged into a subscription, so switching models never needs an API key.

const PROVIDERS = ["claude", "codex", "opencode"] as const;
type Provider = (typeof PROVIDERS)[number];
export type ModelSpec = { provider: Provider; model: string; effort?: string };

/** Parses `claude:opus:medium`. opencode models contain slashes, never colons. */
export function parseSpec(spec: string): ModelSpec {
  const [provider, model, effort] = spec.split(":");
  if (!PROVIDERS.includes(provider as Provider) || !model) {
    throw new Error(`Bad model spec "${spec}". Use <claude|codex|opencode>:<model>[:<effort>]`);
  }
  return { provider: provider as Provider, model, effort };
}

const overrides: Partial<Record<ModelRole, string>> = {};

/** Applies `--model fill=claude:sonnet` style overrides for this process. */
export function setModel(role: ModelRole, spec: string) {
  parseSpec(spec);
  overrides[role] = spec;
}

export function specFor(role: ModelRole): string {
  return overrides[role] ?? process.env[`JH_MODEL_${role.toUpperCase()}`] ?? models[role];
}

/**
 * Runs `prompt` on the model assigned to `role` and returns output validated by `schema`.
 * Retries once when the output fails validation. Schemas must be strict-mode friendly
 * (every key required, use `.nullable()` instead of `.optional()`), because codex enforces it.
 */
export async function llm<S extends z.ZodType>(opts: {
  role: ModelRole;
  prompt: string;
  schema: S;
  /** Label for the usage log; defaults to the role. */
  purpose?: string;
}): Promise<z.infer<S>> {
  const spec = parseSpec(specFor(opts.role));
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const { output, tokens } = await RUNNERS[spec.provider](spec, opts.prompt, jsonSchema);
      logUsage({ purpose: opts.purpose ?? opts.role, provider: spec.provider, model: spec.model, ...tokens, ms: Date.now() - started, prompt: opts.prompt, response: JSON.stringify(output) }, true);
      return opts.schema.parse(output);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${specFor(opts.role)} failed: ${String(lastError)}`);
}

type Tokens = { input: number; cached: number; output: number; cost: number | null };
type Runner = (spec: ModelSpec, prompt: string, schema: object) => Promise<{ output: unknown; tokens: Tokens }>;
const NO_TOKENS: Tokens = { input: 0, cached: 0, output: 0, cost: null };

const RUNNERS: Record<Provider, Runner> = {
  async claude(spec, prompt, schema) {
    const args = ["-p", "--model", spec.model, "--tools", "", "--no-session-persistence", "--strict-mcp-config",
      "--setting-sources", "", "--output-format", "json", "--json-schema", JSON.stringify(schema)];
    if (spec.effort) args.push("--effort", spec.effort);
    const out = JSON.parse(await run("claude", args, prompt, tmpdir()));
    if (out.is_error) throw new Error(out.result);
    const u = out.usage ?? {};
    return {
      output: out.structured_output,
      tokens: {
        input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        cached: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cost: out.total_cost_usd ?? null,
      },
    };
  },

  async codex(spec, prompt, schema) {
    const dir = await mkdtemp(join(tmpdir(), "jh-codex-"));
    try {
      const schemaFile = join(dir, "schema.json");
      await writeFile(schemaFile, JSON.stringify(schema));
      const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", dir,
        "-m", spec.model, "--output-schema", schemaFile];
      if (spec.effort) args.push("-c", `model_reasoning_effort=${spec.effort}`);
      args.push("-");
      // --json streams events: the last agent_message is the answer, turn.completed has usage.
      const events = (await run("codex", args, prompt, dir)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const message = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").at(-1);
      const usage = events.find((e) => e.type === "turn.completed")?.usage ?? {};
      if (!message) throw new Error("codex returned no message");
      return {
        output: JSON.parse(message.item.text),
        tokens: {
          input: usage.input_tokens ?? 0,
          cached: usage.cached_input_tokens ?? 0,
          output: (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0),
          cost: null,
        },
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },

  async opencode(spec, prompt, schema) {
    const args = ["run", "-m", spec.model];
    if (spec.effort) args.push("--variant", spec.effort);
    const fullPrompt = `${prompt}\n\nReply with only a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(schema)}`;
    args.push(fullPrompt);
    return { output: extractJson(await run("opencode", args, "", tmpdir())), tokens: NO_TOKENS };
  },
};

/** Pulls the last top-level JSON object out of free text. */
export function extractJson(text: string): unknown {
  const end = text.lastIndexOf("}");
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  throw new Error(`No JSON in output: ${text.slice(0, 300)}`);
}

/** A model call that runs longer than this is killed, so a hung CLI can't stall a run. */
const RUN_TIMEOUT_MS = 10 * 60_000;

function run(cmd: string, args: string[], stdin: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: RUN_TIMEOUT_MS, killSignal: "SIGKILL" });
    trackChild(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(signal ? `${cmd} killed (${signal}) after the ${RUN_TIMEOUT_MS / 60_000} min limit` : `${cmd} exited ${code}: ${stderr.slice(-1000)}`)),
    );
    child.stdin.end(stdin);
  });
}
