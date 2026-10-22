# Oracle HCM and Taleo

Oracle Recruiting Cloud (`<company>.fa.<region>.oraclecloud.com`) and the older Taleo
(`<company>.taleo.net`).

Overnight run: **33 attempts, 45% submitted.**

## How the form behaves

- Multi-step. Often an email-first sign-in with a one-time code.
- Uploading a resume runs a profile import that fills work and education sections from it.
- The last step can be a Compliance or Review page whose button is the real Submit.

## What works in jh

- Sign-in and account creation through `jh login default`. Email codes wait for you.
- Questions are catalogued per site (`jh questions taleo`), so you can pre-answer the ones that
  repeat.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Work or education rows with no employer, "Unnamed Major", wrong dates, or a skill as a location | The resume import parsed your PDF badly | Upload first, then go through every row. Fix or delete the broken ones until no row shows a red "!" |
| Application sent from a middle step | The "Submit" on a Compliance step is the final submit | Never click it to move on or to test validation. Stop there and review |
