# Modes

Every way to run `jh`, what it does, when to use it, and what it does before anything gets
submitted. The short version: nothing is submitted unless you press `s` at the Submit prompt,
or you turned on auto mode yourself.

| Mode | Command | Submits? | Use it when |
| --- | --- | --- | --- |
| Dry run | `jh apply <url> --submit dry` | Never | Trying a new site, checking your facts, debugging |
| Review (default) | `jh apply <url>` | Only when you press `s` | Your first weeks, and any job you care about |
| Auto | `jh apply <url> --submit auto` | When every check passes | You trust your `context.md` and the site |
| Batch | `jh batch urls.txt` | Same as the `--submit` you pass | A list of postings you picked yourself |
| Runner | `jh run` / `jh run once` | Only with `submit=auto` | Finding postings for you, and applying while you're away |
| Queue | `jh next [n]` | Only when you press `s` | Working through what the runner queued |
| Fit check | `jh fit <url>` | Never, fills nothing | Asking "is this worth it?" before you spend a form on it |
| Crazy mode | `node crazy/crazy.mjs <minutes>` | Yes, after a checker model passes it | Volume: many agents working the whole queue at once |

## How a single application goes

Every mode below runs the same steps for one posting (`src/apply.ts`):

1. **Fit check** (needs a Jev key). Jev reads your resume, your facts and the posting, and
   answers APPLY / MAYBE / SKIP. A SKIP asks you first in review mode, is skipped in auto mode,
   and is only printed in a dry run. `--no-fit` turns it off.
2. **Open the posting** in the harness's own Chrome profile (`~/.jh/chrome-profile`).
3. **Get to the form.** LinkedIn: Easy Apply, or follow the external Apply to the company's
   site. Elsewhere: Apply / Apply Manually, then sign in or create an account if the site wants
   one (with `jh login default`).
4. **Fill every page.** Each field's answer comes from the cheapest source that has one:
   - `rule`: `profile.json` covers name, email, phone, links, address, school, start date
   - `bank`: questions you've answered before
   - `eeo`: demographic questions, from `profile.json` `eeo`
   - `jev`: picks options and matches reworded questions (optional)
   - `model`: everything else in one batched call with your `context.md` and the job
     description. Short answers use the `fill` model, free text uses `write`
5. **Review.** Before Submit, the `review` model reads every answer against your facts and
   blocks on a real problem: a wrong work authorization answer, an invented fact, a blank
   required field. Turn it off with `jh set reviewAnswers off` (not recommended).
6. **The submit gate.** What happens here depends on the mode.
7. **Record it.** The tracker gets a row, reusable answers go into the bank, and the run folder
   in `~/.jh/runs/<date>-<company>/` gets screenshots, the HTML of each page and `answers.md`.

Captchas, 2FA and email verification always stop and wait for you, in every mode except
`--headless`, where they fail instead.

## Dry run

```bash
jh apply <url> --submit dry
```

Fills every page and stops. Every click in a dry run goes through a lock (`src/drylock.ts`)
that refuses any button that would send a form you typed into, so a dry run can't submit even
if a page is laid out in a way the harness didn't expect. It may still create a site account
when a site requires one. Dry runs aren't counted as applications and don't file pending
questions.

Use it on every new site, and after every big change to `context.md`.

## Review mode (the default)

```bash
jh apply <url>
```

Fills everything, runs the review, prints every model answer and anything still empty, saves a
screenshot, and asks:

- `s` submit
- `r` rescan, after you fix something in the browser
- `q` quit without submitting

Anything you edit in the browser before submitting goes into the answer bank. Required questions
nothing could answer become pending questions (`jh questions`, `jh answer`).

## Auto mode

```bash
jh apply <url> --submit auto
jh set submit auto            # make it the default for apply, batch and the runner
```

Submits only when all of these hold:

- every required field is filled
- something was actually filled this run
- the review model found no problems

It unticks newsletter, follow-company and talent-community boxes first. After clicking Submit it
reads the page: errors, or the form still there, means not submitted. A submit with no
confirmation page goes to `jh queue check` instead of counting as done. It refuses to apply to
the same posting twice.

Read a site's terms before you point auto mode at it. `jh set submit review` switches back, and a
running `jh run` picks that up before its next job.

## Batch

```bash
jh batch urls.txt --submit dry
```

One URL per line, `#` comments allowed. Each URL is a normal `jh apply` with the flags you gave.
A failure on one URL is printed and the batch moves on.

## The runner (`jh run`)

```bash
jh set searches "software engineer | backend engineer"
jh set locations "Canada | Remote"
jh run once           # one sweep
jh run                # a sweep every intervalMinutes (default 30). Ctrl-C stops it in seconds
jh queue              # what got queued, best fit first (or: done, failed, skipped, check)
jh next 5             # apply to the top 5 in review mode
```

A sweep pulls new postings from the enabled `sources`:

- `linkedin`: LinkedIn's public job search for every search and location pair, newest first,
  no login. Requests are spaced out. A rate limit (429) rests the source for 3, 6, 12, then 24
  hours.
- `jobright`: your Jobright recommendations. Log in once with `jh open https://jobright.ai`.
- `tsenta`: your Tsenta matches. Log in once with `jh open https://dashboard.tsenta.com`.

Postings already checked, applied to or queued are dropped, as are titles with a word from
`skipTitleWords`, companies in `skipCompanies`, and the same role at the same company in another
city. Every survivor gets a fit check, and verdicts at or above `minFit` go into the queue.

- In review mode the runner only queues. You work through the queue with `jh next`.
- In auto mode it also applies, best fit first, up to `maxPerDay` (default 40).

Jobs are claimed atomically, so two runners never take the same one. A claim older than two
hours (a process that died mid-apply) goes back in the queue.

`jh settings` lists every toggle. `jh set <key> <value>` changes one, `jh reset <key>` restores
the default.

## Fit check

```bash
jh fit <url> [url...]          # APPLY / MAYBE / SKIP with reasons, fills nothing
jh fits                        # every verdict so far, with accuracy once you've labeled some
jh judge <#id> right|wrong "why"
```

Needs a Jev key. The weights that turn Jev's answers into a verdict are in `src/fit.ts`. Because
raw answers are stored, changing the weights shows which past verdicts would flip, with no new
calls.

## Answers and questions

```bash
jh questions                   # pending questions from runs you didn't submit
jh questions greenhouse        # every question Greenhouse forms asked that the bank can't answer
jh answer                      # answer pending questions one at a time
jh answer "<question>" "<answer>"
jh answers sponsorship         # search the bank
jh forget "<question>"
jh sites                       # sites seen, applications sent, questions catalogued
```

Answers that would be right for any company (work authorization, years with a tool) go into the
bank on submit. Company-specific ones ("Why Acme?") don't. See
[context.md](context.md#how-answers-are-reused).

## Tracker, usage and the database

```bash
jh tracker [status|words]
jh show <company>
jh status <company> interviewing "recruiter call Thursday"
jh usage [days]
jh sql <<'SQL'
select status, count(*) from applications group by status
SQL
```

Statuses: draft, unfinished, skipped, applied, responded, interviewing, offer, rejected,
withdrawn. `jh sql` is read-only unless you pass `--write`.

## Browser options

- `--headless`: no window. Anything that needs a person fails instead of waiting.
- `--cdp http://127.0.0.1:9222`: drive a Chrome that's already running with
  `--remote-debugging-port`. The harness opens its own tab and closes only that tab.
- `jh open [url]`: open the harness's browser to log in somewhere by hand.

## Crazy mode

Many AI agents applying in parallel, for when you want volume and accept less control. It works
in lanes: each lane has one strong checker model and a few cheap filler models.

1. A filler opens a job in its own tab of one shared Chrome, fills the form, and stops before
   Submit. It writes a card (every question and answer) and a screenshot.
2. The lane's checker reads the card and the screenshot against your `context.md` and passes
   it, sends back one round of fixes, or drops it.
3. On a pass, the filler clicks Submit and reports what the confirmation page said.

Around that loop:

- Every model call has a cost or time cap, so one bad job can't burn your subscription.
- Before every job it checks how much of your subscription's usage window is left, and stops
  claiming jobs near the limit.
- An auditor reviews every failed job: it records ones that actually went in, retries once with
  specific instructions, and files questions only you can answer as pending questions.
- An hourly fixer turns repeated failures into short per-site tips in a playbook the fillers
  read before each job. The tips in [platforms/](../platforms/) came from it.
- Failures caused by the machinery (an agent that crashed in seconds, a usage limit, the
  browser down) are retried, not recorded as the job failing. A site saying "not today" (the
  LinkedIn daily Easy Apply limit) pauses that source until it resets.

Crazy mode submits on its own. There is no review step by you, only the checker. Before you run
it, make sure review mode (`jh next`) fills forms the way you want, read
[failures.md](failures.md), and start small with a submission target
(`node crazy/crazy.mjs 60 5`). Setup, settings and how to stop it are in
[crazy/README.md](../crazy/README.md).

### Tab API

`crazy/tabapi.cjs`, the small HTTP server crazy mode drives Chrome with: each agent gets its own named tab in one
shared Chrome, and calls actions like `open`, `fields` (every form control with its label,
value and a selector), `fill`, `type`, `click`, `select`, `check`, `upload`, `eval`, `shot` and
`close`. It listens on localhost only by default, and refuses a final-submit click, Enter outside a
textarea and scripted clicks until crazy mode's submit step arms the tab.

## Coming soon

These run in the author's own setup and aren't in this repo yet. They'll land here as they're
cleaned up. Nothing below exists in the npm package today.

### Swipe deck

Review mode without sitting at the terminal. The runner dry-runs queued jobs into cards: each
card is a filled form with its screenshots and every answer. You swipe:

- **approve**: the runner submits it with the card's answers. If the live form changed since
  the card was made, it goes back to the queue for a fresh card instead.
- **revise**: you say what's wrong, and it's filled again with your note.
- **skip**: never apply.
- **later**: move it to the back of the deck.

Facts you give in revise notes are kept and folded into `context.md`, so the same mistake
doesn't come back.

### Website (dashboard)

A Next.js app over the same SQLite file: applications over time, the pipeline, fit score
accuracy, token spend, the queue with bulk actions, the tracker with each run's screenshots,
pending questions you can answer inline, settings, and the swipe deck. It has no login of its
own, so it's meant to run on your machine or a private network only. There is no hosted
version.

### Mobile app

An Expo app for the same things on your phone: the swipe deck, the queue, applications, usage
and settings, plus push notifications when cards are waiting. It talks to the dashboard's API,
so it needs the dashboard running somewhere your phone can reach privately. It isn't in an app
store.

### Mail

Watches your job inbox, matches each email to a tracker entry, and updates it: confirmations
are noted, rejections mark the application rejected, and next steps (interviews, assessments)
set it to responded and remind you.
