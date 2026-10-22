# Platforms

Notes per applicant tracking system: how its form behaves, what works, and what breaks. The
numbers come from a 2,250-attempt overnight run in October 2026 (see
[docs/failures.md](../docs/failures.md)). That run used AI agents driving Chrome
([crazy mode](../docs/modes.md#crazy-mode), coming soon), so the "submitted" rates are for
fully unattended runs. In review mode you fix what's left by hand, and far more go in.

| Platform | Attempts | Submitted | Captchas | Biggest problem |
| --- | ---: | ---: | ---: | --- |
| [Greenhouse](greenhouse/README.md) | 342 | 46% | 16 | Dropdowns that show a value but don't register it |
| [Oracle / Taleo](oracle-taleo/README.md) | 33 | 45% | | Resume import creates broken rows |
| [SmartRecruiters](smartrecruiters/README.md) | 27 | 41% | | Few attempts, no pattern yet |
| [iCIMS](icims/README.md) | 16 | 38% | | The form lives in an iframe |
| [Workday](workday/README.md) | 270 | 36% | 0 | Nested pickers, dates, an account per company |
| [Ashby](ashby/README.md) | 220 | 36% | 27 | React state drops values (phone, radios) |
| [LinkedIn Easy Apply](linkedin/README.md) | 554 | 22% | 77 | The daily Easy Apply limit |
| [Lever](lever/README.md) | 127 | 16% | 42 | hCaptcha after Submit, location picker |
| [SuccessFactors](successfactors/README.md) | | | | Resume import creates broken rows |
| [YC Work at a Startup](yc-work-at-a-startup/README.md) | 73 | 10% | | 5 applications per account per week |

A rule that holds on every one of them: modern forms keep their own state. Set values with real
clicks and real keystrokes. A value set by a script shows on screen and is still missing when
you submit.

Found a fix for a site? A PR to the matching README is welcome. Leave your personal data out of
examples.
