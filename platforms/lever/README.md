# Lever

`jobs.lever.co/<company>/<id>/apply`.

Overnight run: **127 attempts, 16% submitted, 42 captchas.** The captchas are most of the gap:
Lever often shows hCaptcha after you click Submit.

## How the form behaves

- One page. "Current location" is an autocomplete backed by a hidden `selectedLocation` input.
- Every page carries a hidden "File exceeds the maximum upload size of 100MB" error template.
- Submit is scored by hCaptcha. Often a challenge appears only after the click.

## What works in jh

- After clicking Submit, a captcha challenge is detected and it waits for you to solve it in the
  browser. It usually submits by itself once solved. In auto mode the job is marked as needing
  you.
- The same posting is recognized by its id.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Submit blocked on location | Typed text alone leaves `selectedLocation` empty | Type the city, wait for the list, click the exact option (city, region, country), then check `selectedLocation` isn't empty |
| "File exceeds the maximum upload size of 100MB" | That's the hidden template, not a real error | Count only visible errors. The resume is fine when it shows "Success!" |
| Still on `/apply` after Submit, no error | An hCaptcha challenge opened that you can't see in a text view | Look for a visible hCaptcha frame. Solve it, or wait for a solver. Don't record it as "no confirmation" |

Real Chrome with a history gets fewer challenges than a fresh bundled Chromium.
