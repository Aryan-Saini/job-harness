# SAP SuccessFactors

`career<N>.successfactors.com` and `*.successfactors.eu`, often behind a company's own careers
domain.

Overnight run: not counted separately (too few attempts).

## How the form behaves

- Needs an account per company. Multi-step, with a profile built from your resume.
- Like Oracle, uploading a resume runs an import that fills work and education rows.

## What works in jh

- Sign-in and account creation through `jh login default`. Logins are saved per host.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Broken work or education rows after upload | The resume import guessed wrong | Upload first, then fix or delete every bad row before you continue |
