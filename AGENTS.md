# AGENTS.md

Instructions for coding agents (Claude Code, Codex, and others) working in this repo.
`CLAUDE.md` points here.

## Local overrides

If `AGENTS.local.md` or `CLAUDE.local.md` exists in the repo root, read it first. It overrides
this file. Both are gitignored and must never be committed.

## Before working: check for updates

Before you start, check whether this copy is behind and tell the user if it is:

- **Git checkout:** `git fetch origin` then `git status -sb` (or
  `git rev-list --count HEAD..origin/main`). If it's behind `origin/main`, say so and ask before
  pulling. Never pull, reset or rebase on your own if the user has local changes.
- **npm install:** compare `npm view job-harness version` with `jh`'s installed version
  (`npm ls -g job-harness`). If npm has a newer one, tell the user:
  `npm install -g job-harness@latest`.

Skip this if a local override says so.

## What this is

`jh`, a CLI that fills job applications in a real Chrome and stops at Submit unless the user
allows submitting. Model calls go through the `claude`, `codex` or `opencode` CLI the user is
logged into, so there are no API keys. Optional: Jev (TypeSafe) for fast typed calls and the fit
check. Published to npm as `job-harness`. TypeScript, run directly with `tsx` (no build step),
Node 24+ (`node:sqlite`).

Everything personal lives in the user's data folder, `~/.jh` (`JH_HOME` moves it). Nothing in
the repo is about any one user.

## Layout

| Path | What's there |
| --- | --- |
| `bin/jh.js` | Entry point. Registers tsx and loads `src/cli.ts` |
| `src/cli.ts` | Every command, the help text, `jh init` |
| `src/config.ts` | Paths under `~/.jh`, default models, Jev thresholds, resumes |
| `src/settings.ts` | Toggles (`jh settings`), stored in the db's `kv` table |
| `src/apply.ts` | One application end to end, and the submit gate |
| `src/planner.ts` | Each field's answer: rule, bank, EEO, Jev, model. The model prompts |
| `src/profile.ts` | `profile.json` schema and the no-model rules. `facts()` is what models see |
| `src/fields.ts`, `src/dom.ts` | Reading and filling form controls, every frame |
| `src/buttons.ts`, `src/drylock.ts` | Apply / Next / Submit, and the lock that keeps dry runs from submitting |
| `src/linkedin.ts`, `src/login.ts` | Easy Apply, sign-in, account creation, captcha detection |
| `src/review.ts` | The pre-submit review |
| `src/runner.ts`, `src/sources/` | `jh run`: discovery, fit check, queue, claims |
| `src/db.ts` | SQLite schema, `kvGet` / `kvSet`, `jh sql` |
| `src/update.ts` | Once-a-day npm version check |
| `templates/` | What `jh init` copies into `~/.jh` |
| `test/` | Vitest. `test/home` is a fake user, `test/fixtures` are saved forms |
| `docs/`, `platforms/`, `SETUP.md` | User docs |

## Tests

```bash
pnpm install
pnpm test          # vitest: unit tests and browser tests against test/fixtures, no model calls
pnpm typecheck     # tsc --noEmit
```

Tests run against a temp copy of `test/home` (see `vitest.config.ts`), never the user's `~/.jh`.
Browser tests need Chrome or `npx playwright install chromium`. If `pnpm test` refuses to run
because of ignored build scripts, `./node_modules/.bin/vitest run` works.

## Rules

- **Never submit an application** while developing or testing. Use `--submit dry` against real
  sites, or the fixtures. Don't weaken `src/drylock.ts` or the auto-mode gate in `src/apply.ts`.
- **Never invent facts** in prompts or rules. A field with no fact stays empty and becomes a
  pending question.
- **No personal data in the repo**: no names, emails, phone numbers, addresses, resumes or
  tokens in code, tests, fixtures or docs. Use placeholders like `you@example.com`.
- **Don't touch the user's `~/.jh`** unless they ask. It holds their passwords in plain text.
- TypeScript: no `any`, prefer inferred types, zod at the edges. A short comment above each
  function saying what it's for. Keep comments in sync with the code.
- Plain words in docs and help text. Short sentences. No em dashes.
- Commits use conventional commits: `feat(cli): ...`, `fix(apply): ...`, `docs: ...`.
