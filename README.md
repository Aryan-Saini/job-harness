# jh

A CLI that fills out job applications for you. Model calls run through the Claude Code or Codex
CLI you're already logged into, so you don't need an API key. It works on LinkedIn Easy Apply,
Greenhouse, Lever, Ashby, Workday and plain company forms.

By default it stops at the Submit button so you can check every answer. It only submits on its
own when you tell it to (`--submit auto`).

Heads up: this is kind of janky. I pulled it out of my own job hunt setup, so expect rough
edges and sites it chokes on. It's an okay starting spot, though. Issues and PRs are welcome.

## Quick start

You need Node 24+ and [Claude Code](https://claude.com/claude-code) (`claude`) or
[Codex](https://github.com/openai/codex) (`codex`), logged in.

```bash
npm install -g job-harness            # 1. install
jh init                               # 2. creates ~/.jh; fill in profile.json, context.md, resumes/
jh apply <job url> --submit dry       # 3. fill a real form without submitting, then look at it
```

When the dry run looks right, drop `--submit dry`. It fills the form, stops at Submit and asks
you `[s]ubmit / [r]escan / [q]uit`.

## Docs

- [SETUP.md](SETUP.md): step by step from nothing to your first application, plus troubleshooting
- [docs/modes.md](docs/modes.md): every way to run it (single apply, batch, the runner, review
  and dry runs) and what each one does before it submits
- [docs/context.md](docs/context.md): how to write `context.md`, the file every free-text answer
  comes from
- [platforms/](platforms/): per-site notes for Greenhouse, Workday, Ashby, Lever, LinkedIn and
  others, with success rates and known failures
- [docs/failures.md](docs/failures.md): what went wrong in a 2,250-attempt overnight run
- [AGENTS.md](AGENTS.md): for coding agents working on this repo

## Commands

```bash
jh apply <url>                  # fill it, stop at Submit, ask you
jh apply <url> --submit dry     # fill only, never submit
jh apply <url> --submit auto    # submit if every required field got filled and the review passed
jh batch urls.txt               # one URL per line
jh questions && jh answer       # questions it couldn't answer; each answer is reused after
jh tracker                      # every application, newest first
jh run                          # find postings, fit-check, queue (and apply, in auto mode)
jh settings                     # every toggle
```

`jh` with no arguments prints every command. Once a day `jh` checks npm for a newer version and
prints one line if there is one. `JH_NO_UPDATE_CHECK=1` turns that off.

## Development

```bash
git clone https://github.com/Aryan-Saini/job-harness && cd job-harness
pnpm install
pnpm jh <command>  # run from source
pnpm test          # unit tests plus browser tests against local fixtures, no model calls
pnpm typecheck
```

## License

MIT
