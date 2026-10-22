# What failed in a 2,250-attempt overnight run

In October 2026 crazy mode (see [modes.md](modes.md#crazy-mode), coming soon) ran overnight:
many AI agents filling and submitting real applications in parallel, each checked by a stronger
model before Submit. It made 2,250 attempts. This page is what that run taught, with the
numbers. Per-site details are in [platforms/](../platforms/).

The run used agents driving a shared Chrome, not `jh apply`'s own form filler, but the forms
are the same, and most lessons apply to both.

## Submitted rate by platform

| Platform | Attempts | Submitted | Captchas |
| --- | ---: | ---: | ---: |
| [Greenhouse](../platforms/greenhouse/README.md) | 342 | 46% | 16 |
| [Oracle / Taleo](../platforms/oracle-taleo/README.md) | 33 | 45% | |
| [SmartRecruiters](../platforms/smartrecruiters/README.md) | 27 | 41% | |
| [iCIMS](../platforms/icims/README.md) | 16 | 38% | |
| [Workday](../platforms/workday/README.md) | 270 | 36% | 0 |
| [Ashby](../platforms/ashby/README.md) | 220 | 36% | 27 |
| [LinkedIn Easy Apply](../platforms/linkedin/README.md) | 554 | 22% | 77 |
| [Lever](../platforms/lever/README.md) | 127 | 16% | 42 |
| [YC Work at a Startup](../platforms/yc-work-at-a-startup/README.md) | 73 | 10% | |

Captchas across the whole run: 260. Blank cells weren't counted per platform.

## Why the 1,188 failures failed

| Reason | Count | What it really was |
| --- | ---: | --- |
| Agent gave no result | 337 | 272 of these were one two-minute crash burst. Infrastructure, not the form |
| Checker still wanted fixes, or other | 223 | The fix round didn't land, or a mix of one-off causes |
| Stuck form validation | 99 | A field shows a value but the form still says it's required |
| Student, co-op or graduation-window ineligible | 80 | Correct skips. The posting needed current enrollment or other dates |
| US-only, no sponsorship | 71 | Correct skips for someone who needs sponsorship in the US |
| Usage-limit cutoffs | 69 | The subscription's usage window ran out mid-job. Infrastructure |
| Years-of-experience blocks | 65 | Many were wrong. Experience requirements should not block |
| LinkedIn daily Easy Apply limit | 59 | LinkedIn's own cap. Stop for the day |
| Checker dropped | 59 | The checker judged it couldn't or shouldn't be sent |
| Login, account or verification | 39 | Account walls, email codes, SSO |
| Needs the applicant's answer | 28 | A fact only the person knows. Became pending questions |
| Language (French) | 21 | Bilingual roles the applicant couldn't take |
| Upload | 19 | Resume upload didn't register |
| Iframe or popup | 14 | Forms in another frame, or sign-in in a popup |
| Posting closed | 5 | |

At least 341 of the failures (the 272-job crash burst plus 69 usage-limit cutoffs), more than a
quarter, had nothing to do with the job.

## Lessons

**Infra failures are retried, not recorded.** An agent that crashed within seconds, a usage
limit, a browser that went away: none of these say anything about the job. The first version
recorded them as failed jobs, and a two-minute crash burst marked 272 good jobs as failures.
Now a failure is sorted first: the machinery's failures go back in the queue and pause the run
if they repeat, and only real job failures are recorded.

**An Enter key can submit a form early.** Pressing Enter inside a Greenhouse form, even in a
dropdown, submitted four applications before the check. Agents now click options with the mouse
and never press Enter in a Greenhouse form. If you fill forms by hand during a review, do the
same.

**Values set by JavaScript don't register in React forms.** Greenhouse, Ashby, Workday and
LinkedIn keep their own state. Setting `input.value` or dispatching events from a script shows a
value on screen, and the form still says the field is required (99 stuck-validation failures).
Real clicks and real keystrokes work. `jh` uses real clicks, types into searchable dropdowns key
by key, and when a site drops a value it clears the box and types it again.

**Experience requirements should not block.** "5+ years of Java" made agents give up on 65
jobs. Many were wrongly blocked and had to be redone. The rule now: open the form, answer years
questions honestly, and let the hiring team decide.

**Real eligibility rules should block, fast.** Current enrollment, graduation windows,
"US work authorization required", a language you don't speak: these are real, and spotting them
from the posting before filling saves a whole form.

**Daily limits are pauses, not failures.** LinkedIn's daily Easy Apply limit and Work at a
Startup's weekly limit mean "not today". Pause that source until it resets.

**Self-editing prompt fixers need guardrails.** An hourly fixer read the failures and edited the
agents' prompts and site playbook, effective on the next job. It helped (most tips in
[platforms/](../platforms/) came from it), but it needs hard limits: it may never loosen a rule
about facts, honesty, eligibility, captchas or the final Submit, never edit the person's facts,
and never invent one. A fact only you know becomes a question for you, not a tip.

**Close every tab you open.** Agents that opened tabs and never closed them pushed the shared
Chrome to 24 GB of memory. Each agent now owns named tabs and closes them when the job ends, and
a sweep closes tabs left idle.

**Check before retrying.** A job recorded as failed sometimes went in anyway (the confirmation
loaded late, or a captcha solved itself after Submit). On a retry, look for "Applied" on the
posting first.
