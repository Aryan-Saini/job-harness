# CLAUDE.md

Read [AGENTS.md](AGENTS.md). It's the canonical guide for this repo. The key rules:

- If `AGENTS.local.md` or `CLAUDE.local.md` exists, it overrides AGENTS.md. Never commit either.
- Before working, check for updates (`git fetch` and compare with `origin/main`, or
  `npm view job-harness version` against the installed one) and tell the user if they're behind.
- Never submit a real application while developing. Use `--submit dry` or the test fixtures.
- Never invent facts, and keep personal data out of the repo.
- Tests: `pnpm test` and `pnpm typecheck`.
