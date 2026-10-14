# jh

A CLI that fills out job applications for you. It works on LinkedIn Easy Apply, Greenhouse,
Lever, Ashby, Workday and plain company forms. Model calls run through the Claude Code or Codex
CLI you're already logged into, so you don't need an API key. By default it stops at the Submit
button so you can check every answer before anything goes out.

Heads up: this is kind of janky. I pulled it out of my own job hunt setup, so expect rough
edges and sites it chokes on. It's an okay starting spot, though. Issues and PRs are welcome.

## Setup

You need Node 24+ and either [Claude Code](https://claude.com/claude-code) (`claude`) or
[Codex](https://github.com/openai/codex) (`codex`), logged in. `pdftotext` (poppler) is only
needed for the fit check.

```bash
npm install -g job-harness
jh init
```

`jh init` creates `~/.jh` and tells you what's still missing. Then:

1. Fill in `~/.jh/profile.json`. Name, contact info, address, education, which countries you
   can work in, salary, and EEO answers (or `"decline"`). Every form reads this file.
2. Write `~/.jh/context.md`. This is everything else: your experience, projects, target roles,
   answers you reuse, how you write. Anything you leave out of it won't be made up. The field
   stays empty for you to fill.
3. Put your resume in `~/.jh/resumes/resume.pdf`. You can add more PDFs and pick one per run
   with `--resume <name>`.
4. Run `jh login default` to set the email and password it uses when a site makes you create
   an account.
5. Run `jh open` and log in to LinkedIn once. The harness keeps its own Chrome profile, so the
   login sticks.

If you don't have Chrome installed, run `npx playwright install chromium`.

## Use

```bash
jh apply <url>                  # fill it, stop at Submit, ask you
jh apply <url> --submit dry     # fill only, never submit
jh apply <url> --submit auto    # submit if every required field got filled
jh batch urls.txt               # one URL per line
```

Each field gets its answer from the cheapest source that has one:

- **rule**: `profile.json` covers name, email, phone, links, address, school and start date
- **bank**: questions you've answered before
- **jev**: picks options and matches reworded questions (optional, see below)
- **model**: anything else goes out in one batched call that includes your `context.md` and the
  job description. Short answers use the `fill` model and free text ("Why us?") uses `write`

Before it submits, a `review` model checks every answer against your facts and blocks the
submit if something's wrong. Every run saves screenshots, the HTML of each page and an
`answers.md` to `~/.jh/runs/`.

### Questions it couldn't answer

```bash
jh questions        # what's waiting on you
jh answer           # answer them one at a time; each answer gets reused on every later form
jh answers react    # search the answer bank
```

When you edit an answer in the browser before submitting, your version goes into the bank.

### Tracker

```bash
jh tracker                     # every application, newest first
jh show acme                   # one application with every question and answer
jh status acme interviewing    # update it
```

### Leave it running

```bash
jh set searches "software engineer | backend engineer"
jh set locations "Canada | Remote"
jh run once        # find new LinkedIn postings, fit-check them, queue the good ones
jh queue           # what got queued, best fit first
jh next 5          # apply to the top 5, stopping at Submit on each one
jh set submit auto # then `jh run` applies on its own, up to maxPerDay
```

`jh settings` lists every toggle.

## Models

The defaults are in `src/config.ts`: `fill` is `claude:haiku`, and `write` and `review` are
`claude:sonnet`. You can override them per run:

```bash
jh apply <url> --model fill=codex:gpt-6.1-sol:low --model write=claude:opus
```

A spec looks like `<claude|codex|opencode>:<model>[:<effort>]`. `jh usage` shows tokens per
model and per application.

## Jev (optional)

[Jev](https://typesafe.ai) answers typed questions in about a second. With a key, the harness
uses it for the fit check (`jh fit <url>` gives APPLY / MAYBE / SKIP), for option picking and
for bank matching. Without one, the fit check is skipped and the fill model does everything
else. To add a key, put it in `~/.jh/typesafe.key` or set `TYPESAFE_API_KEY`.

## Notes

- Everything lives in `~/.jh` (`JH_HOME` moves it). Site passwords sit in the database in plain
  text, so keep that folder private.
- Captchas, 2FA and email verification stop and wait for you.
- Read a site's terms before running `--submit auto` against it.

## Development

```bash
git clone https://github.com/Aryan-Saini/job-harness && cd job-harness
pnpm install
pnpm jh <command>  # run from source
```

## Tests

```bash
pnpm test         # unit tests plus browser tests against local fixtures, no model calls
pnpm typecheck
```

## License

MIT
