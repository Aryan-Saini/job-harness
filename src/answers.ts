import { localDay } from "./config.ts";
import { all, exec, type Param } from "./db.ts";

// The answer bank: questions answered once and reused on every later form. Keyed by the
// normalized question text, so "Are you legally authorized to work in Canada? *" and
// "are you legally authorized to work in canada" hit the same entry. Job-specific answers
// ("Why do you want to work at Acme?") never land here, the model flags those as one-offs.

export type BankEntry = {
  question: string;
  answer: string;
  /** "you" = typed or edited by you, "context" = seeded from context.md, "model" = generated then submitted. */
  source: "you" | "context" | "model";
  uses: number;
  updated: string;
};
export type Bank = Record<string, BankEntry>;

/** Lowercases, strips required markers, punctuation and extra whitespace. */
export function normalize(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(required\)|\(optional\)|\*/g, " ")
    .replace(/[^\p{L}\p{N}+#/ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadBank(): Bank {
  const rows = all<BankEntry & { key: string }>("SELECT key, question, answer, source, uses, updated FROM answers");
  return Object.fromEntries(rows.map(({ key, ...entry }) => [key, entry]));
}

/** Writes every entry back (one transaction). Deletes go through forget(). */
export function saveBank(bank: Bank) {
  exec(...Object.entries(bank).map(([key, e]): [string, Param[]] => [
    `INSERT INTO answers (key, question, answer, source, uses, updated) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET question = excluded.question, answer = excluded.answer, source = excluded.source,
       uses = excluded.uses, updated = excluded.updated`,
    [key, e.question, e.answer, e.source, e.uses, e.updated],
  ]));
}

export const forget = (key: string) => exec(["DELETE FROM answers WHERE key = ?", [key]]);

export function remember(bank: Bank, question: string, answer: string, source: BankEntry["source"]) {
  const key = normalize(question);
  if (!key || !answer) return;
  const prev = bank[key];
  bank[key] = {
    question,
    answer,
    // An answer you typed is never downgraded by a later model answer.
    source: prev?.source === "you" && source === "model" && prev.answer === answer ? "you" : source,
    uses: (prev?.uses ?? 0) + 1,
    updated: localDay(),
  };
}

const NEGATIONS = new Set(["not", "no", "never", "none", "neither", "nor", "non", "without"]);
const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "with", "and", "or", "as", "is", "am", "are",
  "be", "been", "do", "does", "did", "will", "would", "can", "i", "me", "my", "you", "your", "we", "it", "this", "that", "have", "has"]);

/** Words of a label, with "n't" as "not" and possessive 's dropped ("Bachelor's" -> "bachelor"). */
function words(text: string): string[] {
  return normalize(text.replace(/n['’]t\b/gi, " not").replace(/['’]s\b/gi, "")).split(" ").filter(Boolean);
}

/** "unauthorized" -> "not authorized" when the other side has "authorized" (same for non-). */
function unprefix(ws: string[], other: string[]): string[] {
  return ws.flatMap((w) => {
    const stem = w.match(/^(?:un|non)(.{4,})$/)?.[1];
    return stem && other.includes(stem) ? ["not", stem] : [w];
  });
}

const negated = (ws: string[]) => ws.some((w) => NEGATIONS.has(w));
/** `small` appears in `big` as whole consecutive words. */
const containsPhrase = (big: string[], small: string[]) => ` ${big.join(" ")} `.includes(` ${small.join(" ")} `);

/**
 * Picks the option that best matches `want`, or undefined when none clearly does (the caller
 * then asks Jev or the model fresh). In order: exact match; whole-word containment either way;
 * then shared content words covering a majority of `want`'s. Never across a negation, so
 * "authorized to work" can't pick "Not authorized to work" and "No" can't pick "Not sure".
 */
export function bestOption(want: string, options: string[]): string | undefined {
  const w = normalize(want);
  if (!w) return undefined;
  const exact = options.find((o) => normalize(o) === w);
  if (exact !== undefined) return exact;

  const candidates = options.flatMap((option) => {
    const raw = words(option);
    const ws = unprefix(words(want), raw);
    const os = unprefix(raw, ws);
    return os.length && negated(ws) === negated(os) ? [{ option, ws, os }] : [];
  });
  // Closest in length first, so "Yes" prefers "Yes" phrasing over a long sentence that contains it.
  const byLength = (a: { ws: string[]; os: string[] }, b: { ws: string[]; os: string[] }) =>
    Math.abs(a.os.length - a.ws.length) - Math.abs(b.os.length - b.ws.length);
  const contained = candidates.filter(({ ws, os }) => containsPhrase(os, ws) || containsPhrase(ws, os)).sort(byLength)[0];
  if (contained) return contained.option;

  let best: { option: string; score: number; extra: number } | undefined;
  for (const { option, ws, os } of candidates) {
    const content = new Set(ws.filter((t) => !STOP.has(t)));
    const shared = new Set(os.filter((t) => content.has(t))).size;
    const extra = os.filter((t) => !STOP.has(t) && !content.has(t)).length;
    if (shared * 2 <= content.size) continue;
    if (!best || shared > best.score || (shared === best.score && extra < best.extra)) best = { option, score: shared, extra };
  }
  return best?.option;
}
