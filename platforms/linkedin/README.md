# LinkedIn Easy Apply

`linkedin.com/jobs/view/<id>`. Easy Apply opens a dialog with several short steps. Postings
without Easy Apply link out to the company's own site.

Overnight run: **554 attempts, 22% submitted, 77 captchas.** The daily Easy Apply limit
accounted for 59 failures.

## How the form behaves

- A modal with steps: contact info, resume, a few screening questions, review.
- LinkedIn keeps your uploaded resumes and pre-selects the last one used.
- Radio options often have an empty `<label>`, with the text in a paragraph beside it.
- There's a daily cap on Easy Apply submissions. When you hit it, LinkedIn says you reached
  today's limit and to continue tomorrow.

## What works in jh

- Easy Apply when there is one. Otherwise it follows the external Apply to the company's ATS.
- The resume is uploaded once, remembered, and selected on later applications. It's uploaded
  again when the PDF changes.
- Radio options with empty labels are read from the text beside them.
- In auto mode it refuses to submit when the resume step failed.
- `jh run` finds postings through LinkedIn's public job search, no login. A rate limit rests the
  source for 3, 6, 12, then 24 hours.
- Log in once in the harness's browser with `jh open`.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| "You reached today's Easy Apply limit" | LinkedIn's daily cap | Stop for the day. No workaround is worth your account. Keep `maxPerDay` under it |
| "We couldn't submit your application" | A radio set by a script or group selector never registered | Click each option's label with the mouse |
| A retry applies twice | The first attempt went in | Before retrying, check the job page for "Applied" or "Application submitted" |
| Wrong resume attached | LinkedIn pre-selected the last one used | Check the resume step. `jh resumes` and `--resume` pick which one jh selects |
