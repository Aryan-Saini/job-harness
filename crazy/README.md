# Crazy mode

Crazy mode works through your job queue with many AI agents at once. Each agent gets its own tab in
one shared Chrome, fills a whole application, and stops before Submit. A stronger model checks the
filled form against your context.md and a screenshot, sends back fixes or drops it, and only a form
that passes gets submitted. Overnight on one machine it has sent a few hundred applications.

**It submits for real.** Run it only once `jh` fills forms the way you want in review mode
(`jh next`), and your context.md answers every question you care about. It spends your Claude and
Codex subscriptions, not API credits, and keeps each under a cap you set.

## How it works

```
job_queue ──claim──> filler (Haiku or Luna) ──fills tab──> checker (Opus or Sol)
                         ^                                   │ pass │ fix │ drop
                         └────────── one round of fixes ─────┘      │
                                                             submit step (tab armed)
failed jobs ──> auditor: submitted? retry with a hint? question for you? final?
audit findings, hourly ──> fixer: tips in playbook.md, rules in the prompts
```

- **Lanes and slots.** 3 checker lanes (CRAZY_LANES), each with 2 Luna and 2 Haiku fillers: 12
  forms in flight. When Claude is off, Luna fills every slot and Sol checks.
- **Claim order.** Audit requeues first, then new grad and early career titles, internships,
  founding roles, jobs you added by hand (source `target`), the harness's own failures, then the
  rest. Companies you're already interviewing with are skipped.
- **The tab API** (`tabapi.cjs`) is the only way agents touch the browser. Until the submit step
  arms a tab, it refuses final-submit clicks, Enter outside a textarea, and scripted clicks, so a
  form can't go in early.
- **The usage gate** (`gate.mjs`) closes a provider at 82% of its 5-hour window (CRAZY_CAP_5H), so
  a window never hits 100% with jobs cut off halfway.
- **Failures that aren't the form's fault** (an agent that crashed, a usage limit, a dead browser)
  put the job back in the queue. Five of those in two minutes pause claims for five minutes and
  notify you. LinkedIn's daily Easy Apply limit pauses LinkedIn until midnight, and Work at a
  Startup's weekly cap pauses YC for a week (`pauses.json`).
- **The auditor** reviews each failed job every 10 minutes: it went in after all, retry it once with
  a hint, a question only you can answer (`jh questions`, `jh answer`), or final.
- **The fixer** runs hourly on the audit findings and adds site tips to `playbook.md` or rules to the
  prompts. It snapshots every prompt first (`prompt-history/`) and rolls back an edit that breaks a
  prompt's output contract. Review its changes in `fixes.log`.

## What you need

- `jh` set up and working: `jh init`, `~/.jh/profile.json`, `~/.jh/context.md`, a resume in
  `~/.jh/resumes/`. See [SETUP.md](../SETUP.md) and the [context.md guide](../docs/context.md).
- Jobs in the queue: `jh run` finds and fit-checks postings and queues them (`jh queue`).
- Node 24+, `sqlite3` and `curl` on your PATH, Google Chrome.
- `claude` (Claude Code) and/or `codex` (Codex CLI), logged in. Haiku and Opus run on Claude, Luna
  and Sol on Codex. Several Codex accounts can share the load (CRAZY_CODEX_HOMES).
- Optional: a separate email inbox to apply from (CRAZY_EMAIL), so confirmation mail and account
  sign-ups don't flood your own.

## Run it

Four processes, each in its own terminal (or tmux window, or systemd unit):

```bash
# 1. A Chrome just for crazy mode, with remote debugging. Log in to LinkedIn (and Work at a
#    Startup, if you use it) in this window once; agents reuse the session.
google-chrome --user-data-dir="$HOME/.jh/crazy-chrome" --remote-debugging-port=9230 --no-first-run

# 2. The tab API the agents drive Chrome through (loopback only).
node crazy/tabapi.cjs

# 3. The usage gate.
node crazy/gate.mjs

# 4. The run: minutes to run, and optionally stop after that many submissions.
node crazy/crazy.mjs 480        # 8 hours
node crazy/crazy.mjs 120 25     # 2 hours or 25 submitted, whichever comes first
```

From an npm install, the same files are in `$(npm root -g)/job-harness/crazy/`.

Watch it with `tail -f ~/.jh/crazy/crazy.log`, see the open tabs with `crazy/tab list`, and answer
what it couldn't with `jh answer`. Every attempt's card, transcripts and screenshots are in
`~/.jh/runs/crazy-<slug>/`, and submitted ones are in `jh tracker`.

To stop: Ctrl-C (it closes its tabs on the way out), or `touch ~/.jh/crazy/drain.<pid>` to let
the jobs in flight finish first. The pid is in the run's first log line.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `JH_HOME` | `~/.jh` | Where your profile, context.md, resumes and jh.db live |
| `CRAZY_DIR` | `~/.jh/crazy` | Crazy mode's state: logs, cards, gate.json, pauses.json, its editable prompts |
| `CRAZY_EMAIL` | profile email | The email agents apply and sign up with |
| `CRAZY_RESUME` | first PDF in `~/.jh/resumes` | The resume agents upload |
| `CRAZY_LANES` | `abc` | One letter per checker lane, 4 fillers each |
| `CRAZY_CODEX` | off | `1`: Codex only (Luna fills, Sol checks) |
| `CRAZY_CODEX_HOMES` | `CODEX_HOME` or `~/.codex` | Comma-separated Codex homes, one per account |
| `CRAZY_CAP_5H` | `82` | Percent of each 5-hour window the gate stops at |
| `CRAZY_TIERS` | on | `0`: don't put new grad, intern and founding titles first |
| `CRAZY_NOTIFY` | none | A command run as `<cmd> <title> <body>` when something needs you |
| `CRAZY_MAIL_HINT` | none | How agents read emailed verification codes (a sentence with the command to run) |
| `CRAZY_CDP` | `http://127.0.0.1:9230` | The Chrome tabapi drives |
| `TABAPI_PORT` | `9777` | The tab API's port |
| `TABAPI_TAILNET` | off | `1`: also listen on Tailscale, for machines in `TABAPI_ALLOW` |

`CRAZY_NOTIFY` example, with [ntfy](https://ntfy.sh):

```bash
#!/bin/sh
curl -s -H "Title: $1" -d "$2" https://ntfy.sh/your-private-topic >/dev/null
```

## Prompts

The prompts ship in `crazy/prompts/` and are copied into `CRAZY_DIR` on the first run. The run
reads those copies, so the fixer's edits and yours survive updates. To pick up a newer shipped
prompt, delete your copy and it comes back on the next run. `__NAME__`, `__EMAIL__`,
`__CONTEXT__` and the like are filled from your profile and the settings above.

- `filler.md`: fill one form, stop before Submit, write a card and a screenshot.
- `checker.md`: pass, fix, drop, or "it already went in".
- `submit.md`: click Submit once, handle a code or captcha, confirm.
- `audit.md`, `fixer.md`: the learning loop.
- `playbook.md`: site tips by ATS. See [platforms/](../platforms/) for the longer notes.
- `yc-note.md`: how to write the note to a YC founder, which is the whole application there.

## What a big run looks like

The first long run (about 2,250 attempts in one night) submitted 28%. Greenhouse did best (46%),
Workday and Ashby 36%, LinkedIn Easy Apply 22%, Lever 16% (hCaptcha after Submit), and Work at a
Startup 10% once its weekly cap ran out. Most failures were not the form: a crash burst, usage
limits and site caps, which crazy mode now retries instead of recording. See
[docs/failures.md](../docs/failures.md).
