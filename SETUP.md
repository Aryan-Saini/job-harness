# Setup

A guided walkthrough from nothing to your first submitted application, then troubleshooting
and answers to common questions. Do the steps in order. Each one ends with a check so you know
it worked.

If you're a coding agent helping someone set this up, read this file, [AGENTS.md](AGENTS.md)
and [docs/context.md](docs/context.md), then use the file map at the bottom to find the code
behind any answer.

## 1. Install

You need:

- **Node 24 or newer** (`node -v`). It uses the built-in `node:sqlite`, so older Node won't run it.
- **Google Chrome**, or run `npx playwright install chromium` for the bundled browser. Real Chrome
  gets fewer bot checks.
- **pdftotext** (`brew install poppler` or `apt install poppler-utils`), only for the fit check.

Then pick one:

```bash
npm install -g job-harness       # the published CLI
```

```bash
git clone https://github.com/Aryan-Saini/job-harness && cd job-harness
pnpm install
pnpm jh --help                   # from source; use `pnpm jh` wherever this file says `jh`
```

Check: `jh` with no arguments prints the list of commands.

## 2. Log in a model CLI

Every model call goes through a CLI you're logged into, on your own subscription. There's no
API key to set up. Install one and log in:

- [Claude Code](https://claude.com/claude-code): run `claude` once and follow the login.
- [Codex](https://github.com/openai/codex): run `codex` once and follow the login.

Check: `claude -p "say ok"` (or `codex exec "say ok"`) prints a reply without asking you to log in.

The defaults use Claude: `fill` (short answers) is `claude:haiku`, `write` (free text) and
`review` (the check before Submit) are `claude:sonnet`. If you only have Codex, pass all three
roles on each run, or change the defaults in `src/config.ts`:

```bash
jh apply <url> --model fill=codex:gpt-6.1-sol:low --model write=codex:gpt-6.1-sol --model review=codex:gpt-6.1-sol
```

`JH_MODEL_FILL` and `JH_MODEL_WRITE` set the first two from the environment. `jh models` shows
what's in use.

## 3. Run `jh init`

```bash
jh init
```

It creates `~/.jh` with a `profile.json`, a `context.md` and an empty `resumes/` folder, then
lists what's still missing as `TODO` lines. Run it again any time to re-check. It never
overwrites files you've already filled in. `JH_HOME` moves the folder somewhere else.

Check: `ls ~/.jh` shows `profile.json`, `context.md` and `resumes/`.

## 4. Fill in profile.json

`~/.jh/profile.json` holds the hard facts every form asks. These are answered by plain rules,
no model involved, so they come out the same every time:

| Field | Notes |
| --- | --- |
| `firstName`, `lastName`, `pronouns` | As you want them on forms |
| `email` | Goes on every form and every new site account. A separate inbox for job applications works well |
| `phone` | One format, e.g. `555-123-4567` |
| `linkedin`, `github`, `website` | Full URLs. `website` falls back to `github` |
| `address` | `region` is the province or state written out ("Ontario", "California") |
| `education` | Your main degree. `end` is your graduation or expected graduation |
| `workAuthorization.authorizedIn` | Countries you can work in **without** sponsorship. Everywhere else is answered as "needs sponsorship" |
| `workAuthorization.summary` | One line, e.g. "Canadian citizen. Would need sponsorship for the US." |
| `yearsExperience` | A number. Forms that ask for total years get this |
| `salary` | What to say when a posting gives no range. When it gives one, the midpoint is used |
| `eeo` | `"decline"` picks "prefer not to say" on every demographic question. Or answer in plain words: `{ "gender": "Woman", "veteran": "Not a veteran" }` |

Check: `jh login default` in step 7 reads the profile and offers your `email` as the default.
A typo in profile.json fails with the exact field that's wrong.

## 5. Write context.md

`~/.jh/context.md` is everything else: your experience, projects, skills, target roles, the
answers you want reused, and how you write. The models answer every free-text question ("Why
us?", "Tell us about a project", "How many years with React?") from this file and nothing else.

Read **[docs/context.md](docs/context.md)** before you write it. It lists every section, why
forms need it, and placeholder examples. Two rules matter most:

- Keep the `## Target roles` heading. The fit check reads that section by name.
- Write facts. If something isn't written down, the field stays empty for you. It is never
  made up.

Check: the file has a `## Target roles` section and at least one job or project with dates.

## 6. Add your resume

Copy your resume PDF to `~/.jh/resumes/resume.pdf`. That's the default. Every other PDF in the
folder becomes a resume id: `backend.pdf` is `--resume backend`. `jh set resume backend` makes
it the default.

Check: `jh resumes` lists it with a `*` next to the default.

## 7. Logins

```bash
jh login default     # the email + password it uses when a site makes you create an account
jh open              # opens the harness's own Chrome; log in to LinkedIn by hand, once
```

The harness uses its own Chrome profile (`~/.jh/chrome-profile`), separate from your normal
Chrome, so logins stick between runs. `jh open <url>` works for any other site (Workday
tenants, SSO, job boards). `jh login set <host>` saves a different login for one site.

Check: `jh login list` shows your default login. `jh open` shows you logged in to LinkedIn.

## 8. First dry run

Pick a real posting you'd apply to anyway. Greenhouse and Workday forms are the most reliable
place to start (see [platforms/](platforms/)).

```bash
jh apply <job url> --submit dry
```

A dry run fills every page and never clicks Submit. It can't: every click in a dry run goes
through a lock that refuses any button that would send the form. It will still create a site
account when a site needs one (Workday does), since an account isn't an application. When it
finishes, look at what it did:

```bash
ls ~/.jh/runs/                     # one folder per run: <date>-<company>
```

- `answers.md`: every question, the answer that went in, and where it came from
  (`rule`, `bank`, `jev` or `model`)
- `step-01.png`, `step-01.html`, ...: each page after filling. The HTML has the typed values
  baked in, so you can see exactly what it saw and filled
- `00-posting.png`: the posting as it was

Read `answers.md` closely. A wrong answer here almost always means a missing or vague fact in
`context.md` or `profile.json`. Fix the file, then run the dry run again.

## 9. First real application

```bash
jh apply <job url>
```

This is review mode, the default. It fills everything, runs the review model over every
answer, prints the model's answers and anything still empty, and stops at Submit:

- `s` submits.
- `r` rescans the page. Use it after you fix something in the browser window.
- `q` quits without submitting.

If you change an answer in the browser before submitting, your version goes into the answer
bank and is reused on every later form.

Check: `jh tracker` shows the application. `jh show <company>` shows every answer that went in.

## 10. Answer what it couldn't

A required question that nothing could answer is saved as a pending question when you don't
submit.

```bash
jh questions        # what's waiting on you
jh answer           # answer them one at a time; each answer is reused on every later form
jh answer "Are you willing to work weekends?" "Yes"     # or pre-answer one
```

`jh answer` prints the `jh apply` lines to re-run the jobs that were waiting.

Do a few days in review mode before you try `--submit auto`.

## 11. Optional extras

**Jev (recommended).** [Jev](https://typesafe.ai) makes the fast typed calls: the fit check
(APPLY / MAYBE / SKIP), picking dropdown and radio options, and matching a reworded question to
one you've already answered. Put a key in `~/.jh/typesafe.key` or set `TYPESAFE_API_KEY`.
Without one, the fit check is skipped and the fill model handles everything else, which is
slower but works.

**Leave it running.** `jh run` finds new postings, fit-checks them and queues the good ones.
See [docs/modes.md](docs/modes.md#the-runner-jh-run).

**Mobile app and website (coming soon).** The author's own setup has a Next.js dashboard and an
Expo phone app on top of the same database: charts, the queue, the tracker, answering pending
questions, and a swipe deck to approve filled applications from your phone. Neither is in this
repo yet and there is no hosted version, since both read your local database. See
[docs/modes.md](docs/modes.md#coming-soon).

## Updating

```bash
npm install -g job-harness@latest     # npm
git pull && pnpm install              # from source
```

Your `~/.jh` stays put. Once a day `jh` checks npm in the background and prints one line on
stderr when a newer version is out. It never slows down or fails a command, and offline it says
nothing. `JH_NO_UPDATE_CHECK=1` turns it off.

## Troubleshooting

These come from real failures, most of them from a 2,250-attempt overnight run. The full
numbers are in [docs/failures.md](docs/failures.md).

**The model call fails or returns nothing.** Run `claude -p "say ok"` (or `codex exec "say ok"`)
yourself. If that asks you to log in, log in. If it says you hit a usage limit, wait for your
window to reset or switch providers with `--model`. Several failures in a row within seconds
are almost always this, not the form. Re-run the job, don't give up on it.

**A field shows a value but the form still says it's required.** React forms (Greenhouse,
Ashby, LinkedIn) keep their own state. A value set the wrong way shows on screen but never
registers. In review mode, fix the field by hand in the browser (open the dropdown and click
the option), then press `r`. If errors stay after that, reload the page and fill it again.
Site-specific fixes are in [platforms/](platforms/).

**A form submitted before the review.** Pressing Enter inside some forms (Greenhouse) submits
them. When you fix fields by hand, click options with the mouse.

**It says I'm ineligible, or skips student / co-op / new grad roles.** The fit check and the
review read `profile.json` and `context.md`. Check your graduation date, enrollment status and
`workAuthorization`. Titles in `skipTitleWords` (intern, co-op, staff, manager...) are skipped
by the runner: `jh settings` shows them, `jh set skipTitleWords "..."` changes them.

**It asked about sponsorship and answered wrong.** `workAuthorization.authorizedIn` lists the
countries you can work in without sponsorship. Every other country is answered as "needs
sponsorship". Check that list first.

**Years of experience came out wrong.** Total years come from `yearsExperience`. Years with one
tool are estimated from `context.md`, and a tool that isn't mentioned gets 0. Write dates on
every job and project. A "5+ years" line in a posting is not a reason to skip a job you want.

**LinkedIn says you reached today's Easy Apply limit.** Stop for the day. Retrying doesn't
help. `jh set maxPerDay <n>` keeps the runner under it.

**It got stuck on a login, account or email verification.** Captchas, 2FA and email
verification always stop and wait for you. Do it in the browser window, then press enter in the
terminal. Set `jh login default` before the first run so account creation has a password.
Google or Microsoft sign-in popups need you: log in once with `jh open <url>`.

**A captcha appeared after Submit.** Lever and others show hCaptcha after you click Submit. Solve
it in the browser. It usually submits by itself. Real Chrome gets fewer of these than the
bundled Chromium.

**The form is in another language.** Free text is answered in the question's language. If you
can't work in that language, skip the job: an answer you can't back up in an interview doesn't
help you.

**The resume didn't upload.** Only PDFs in `~/.jh/resumes` are used. Check `jh resumes`.

**The form is in an iframe or a popup.** It reads every frame on the page. iCIMS and some company
sites embed the form from another host. If it finds no fields, open the iframe's own URL with
`jh apply <that url>`. See [platforms/icims](platforms/icims/README.md).

**The browser won't start.** Only one process can use `~/.jh/chrome-profile` at a time. Close
the other `jh` (or the window `jh open` left open). No Chrome installed: `npx playwright install
chromium`.

**It says it already applied.** It refuses to apply to the same posting twice without asking.
`jh tracker` lists every application, `jh show <company>` shows one in full.

**A site just doesn't work.** Run it with `--submit dry` and look at
`~/.jh/runs/<date>-<company>/`. Open an issue with the site name and what you saw (leave your
personal data out), or apply by hand.

## Questions

**Does it cost money?** Model calls run on your Claude or Codex subscription. `jh usage` shows
tokens per model and per application. Jev bills per token, and it's cheap. opencode
(OpenRouter) bills per token too if you pick it.

**Which models does it use?** See step 2. A model spec looks like
`<claude|codex|opencode>:<model>[:<effort>]`.

**Where's my data?** All of it is in `~/.jh` (`JH_HOME` moves it): `jh.db` (tracker, answer bank,
settings, site logins), `runs/`, `chrome-profile/`. Site passwords are stored in plain text in
`jh.db`, so keep that folder private and out of any cloud sync you share.

**How do I look at the database?** `jh sql` reads one statement from stdin and prints a table.
It's read-only unless you pass `--write` (`--json` for raw rows):

```bash
jh sql <<'SQL'
select date, status, company, title from applications order by date desc limit 20
SQL
```

**It got an answer wrong.** Fix it in the browser before submitting; your version goes into the
answer bank. Or `jh answer "<question>" "<answer>"` / `jh forget "<question>"`. If a fact is
wrong across many forms, fix `profile.json` or `context.md`.

**Can I run it without a window?** `--headless` works, but anything that needs a human (login,
captcha, an empty required field in review mode) fails instead of waiting.

**Is auto-submit safe?** It only submits when every required field is filled, something was
actually filled this run, and the review model found no problems. It unticks newsletter and
follow-company boxes, then checks the page after clicking Submit. A submit with no confirmation
page lands in `jh queue check` instead of counting as done. Read a site's terms before you
point auto mode at it.

## File map

| File | Does |
| --- | --- |
| `src/cli.ts` | Every `jh` command, help text, `jh init` |
| `src/config.ts` | Paths under `~/.jh`, default models, Jev thresholds, resume lookup |
| `src/settings.ts` | The toggles (`jh settings`) and their defaults |
| `src/profile.ts` | Loads `profile.json`; the rules that answer name/email/address/school/start date with no model |
| `src/apply.ts` | One application end to end: open, get to the form, fill each page, review, submit |
| `src/planner.ts` | Picks each field's answer: rule, bank, EEO, Jev, then the model. The model prompts live here |
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
| `src/update.ts` | The once-a-day "newer version on npm" line |
| `templates/` | What `jh init` copies into `~/.jh` |
| `test/` | `pnpm test`: unit tests and browser tests against `test/fixtures`, no model calls |
