# Setup

A walkthrough from nothing to your first application, then answers to the questions that come
up. If you're a coding agent helping someone set this up, read this file and `README.md`, then
use the file map at the bottom to find the code behind any answer.

## 1. Install

You need:

- **Node 24 or newer** (`node -v`). It uses the built-in `node:sqlite`, so older Node won't run it.
- **A model CLI, logged in**: [Claude Code](https://claude.com/claude-code) (`claude`) or
  [Codex](https://github.com/openai/codex) (`codex`). Every model call goes through it on your
  subscription, so there's no API key to set up.
- **Google Chrome**, or run `npx playwright install chromium` for the bundled browser. Real Chrome
  gets fewer bot checks.
- **pdftotext** (`brew install poppler` or `apt install poppler-utils`), only for the fit check.

Then pick one:

```bash
npm install -g job-harness       # the published CLI
jh init
```

```bash
git clone https://github.com/Aryan-Saini/job-harness && cd job-harness
pnpm install
pnpm jh init                     # from source; use `pnpm jh` wherever this says `jh`
```

`jh init` creates `~/.jh` and lists what's still missing (`TODO` lines). Run it again any time
to re-check. It never overwrites files you've already filled in.

## 2. Tell it about you

Everything personal lives in `~/.jh`. Nothing in the repo is about you.

| File | What goes in it |
| --- | --- |
| `~/.jh/profile.json` | Hard facts every form asks: name, email, phone, links, address, school, work authorization, salary line, EEO answers. Validated on load; a typo tells you which field is wrong |
| `~/.jh/context.md` | Everything else: experience, projects, skills, target roles, reusable answers, how you write. The models answer free-text questions from this |
| `~/.jh/resumes/*.pdf` | Your resumes. `resume.pdf` is the default; each other file becomes a resume id (`backend.pdf` is `--resume backend`) |

Tips:

- **profile.json `email`** goes on every form and every new site account. A separate inbox for
  job applications works well.
- **profile.json `eeo`**: `"decline"` picks "prefer not to say" on every demographic question.
  To answer them, give plain words instead, e.g. `{ "gender": "Man", "veteran": "Not a veteran" }`.
- **context.md**: keep the `## Target roles` heading; the fit check reads that section by name.
  Write facts, not marketing. If something isn't written down, the harness leaves the field empty
  for you instead of making it up.

## 3. Logins

```bash
jh login default     # the email + password it uses when a site makes you create an account
jh open              # opens the harness's own Chrome; log in to LinkedIn by hand, once
```

The harness uses its own Chrome profile (`~/.jh/chrome-profile`), separate from your normal
Chrome, so logins stick between runs. `jh open <url>` works for any other site (Jobright, Workday
tenants, SSO).

## 4. First runs

Start careful, then loosen up:

```bash
jh apply <job url> --submit dry     # fills everything, never submits. Look at what it did
jh apply <job url>                  # review mode: fills, stops at Submit, asks [s]ubmit / [r]escan / [q]uit
jh questions && jh answer           # answer what it couldn't; those answers are reused on every form after
```

Every run leaves screenshots, the HTML of each page and an `answers.md` in `~/.jh/runs/`.
Do a few days in review mode before trying `--submit auto`.

## 5. Leave it running (optional)

```bash
jh set searches "software engineer | backend engineer"
jh set locations "Canada | Remote"
jh run once           # one sweep: find new LinkedIn postings, fit-check, queue the good ones
jh queue              # what got queued, best fit first
jh next 5             # apply to the top 5 in review mode
jh set submit auto    # then `jh run` applies on its own, up to maxPerDay (default 40)
jh run                # loops every intervalMinutes (default 30). Ctrl-C stops it in seconds
```

`jh settings` lists every toggle with its default. `jh set submit review` stops an auto runner
before its next job.

## 6. Jev (optional, recommended)

[Jev](https://typesafe.ai) makes the fast typed calls: the fit check (APPLY / MAYBE / SKIP),
picking dropdown and radio options, and matching a reworded question to one you've already
answered. Put a key in `~/.jh/typesafe.key` or set `TYPESAFE_API_KEY`. Without one, the fit check
is skipped and the fill model handles everything else, which is slower but works.

## Questions

**Does it cost money?** Model calls run on your Claude or Codex subscription. `jh usage` shows
tokens per model and per application. Jev bills per token, and it's cheap. opencode
(OpenRouter) bills per token too if you pick it.

**Which models does it use?** `fill` (short answers) is `claude:haiku`, `write` (free text) and
`review` (the pre-submit check) are `claude:sonnet`. Defaults are in `src/config.ts`. Override per
run with `--model fill=codex:gpt-6.1-sol:low`, or with env `JH_MODEL_FILL` / `JH_MODEL_WRITE`.
Only have Codex? Pass `--model` for all three roles, or change the defaults in `src/config.ts`.

**Where's my data?** All of it is in `~/.jh` (`JH_HOME` moves it): `jh.db` (tracker, answer bank,
settings, site logins), `runs/`, `chrome-profile/`. Site passwords are stored in plain text in
`jh.db`, so keep that folder private and out of any cloud sync you share.

**How do I look at the database?** `jh sql` reads one statement from stdin and prints a table.
It's read-only unless you pass `--write`:

```bash
jh sql <<'SQL'
select date, status, company, title from applications order by date desc limit 20
SQL
```

**It got an answer wrong.** Fix it in the browser before submitting; your version goes into the
answer bank. Or `jh answer "<question>" "<answer>"` / `jh forget "<question>"`. If a fact is
wrong across many forms, fix `profile.json` or `context.md`.

**It stopped and is waiting.** Captchas, 2FA and email verification always wait for you. Do it
in the browser window, then press enter in the terminal.

**A site isn't working.** Run it with `--submit dry` and look at `~/.jh/runs/<date>-<company>/`.
`step-NN.html` has the typed values baked in, so you can see exactly what it saw and filled. Some
sites just choke; open an issue or apply by hand.

**It says it already applied.** It refuses to apply to the same posting twice without asking.
`jh tracker` lists every application, `jh show <company>` shows one in full, and
`jh status <company> rejected "note"` updates one.

**Can I run it without a window?** `--headless` works, but anything that needs a human (login,
captcha, an empty required field in review mode) fails instead of waiting.

**Is auto-submit safe?** It only submits when every required field is filled, something was
actually filled this run, and the review model found no problems. It unticks newsletter and
follow-company boxes, then checks the page after clicking Submit. A submit with no confirmation
page lands in `jh queue check` instead of counting as done. Read a site's terms before you
point auto mode at it.

**Updating:** `npm install -g job-harness@latest`, or `git pull && pnpm install` from source.
Your `~/.jh` stays put.

## File map

| File | Does |
| --- | --- |
| `src/cli.ts` | Every `jh` command, help text, `jh init` |
| `src/config.ts` | Paths under `~/.jh`, default models, Jev thresholds, resume lookup |
| `src/profile.ts` | Loads `profile.json`; the rules that answer name/email/address/school/start date with no model |
| `src/apply.ts` | One application end to end: open, get to the form, fill each page, review, submit |
| `src/planner.ts` | Picks each field's answer: rule, bank, EEO, Jev, then the model |
| `src/fields.ts`, `src/dom.ts` | Reads a page's form fields and fills them |
| `src/buttons.ts`, `src/drylock.ts` | Finds Apply / Next / Submit; dry runs can't click Submit |
| `src/linkedin.ts`, `src/login.ts` | LinkedIn Easy Apply, site sign-in and account creation |
| `src/jev.ts`, `src/jevfill.ts`, `src/fit.ts` | Jev calls, option picking, the fit verdict and its weights |
| `src/llm.ts` | Runs `claude` / `codex` / `opencode` as subprocesses |
| `src/review.ts` | The pre-submit check |
| `src/runner.ts`, `src/sources/` | `jh run`: finding postings (LinkedIn, Jobright, Tsenta), queueing, claiming |
| `src/db.ts` | The SQLite schema and queries |
| `src/answers.ts`, `src/pending.ts`, `src/sites.ts` | Answer bank, unanswered questions, per-site question catalog |
| `src/applications.ts`, `src/fitlog.ts`, `src/usage.ts` | Tracker, fit-check log, token usage |
| `templates/` | What `jh init` copies into `~/.jh` |
| `test/` | `pnpm test`: unit tests and browser tests against `test/fixtures`, no model calls |
