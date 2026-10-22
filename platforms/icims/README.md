# iCIMS

`careers-<company>.icims.com`. The job page wraps the real form in an iframe
(`#icims_content_iframe`).

Overnight run: **16 attempts, 38% submitted.** Too few to say much, but the iframe was the
main problem.

## How the form behaves

- The outer page is a wrapper. The posting, the login and the form are inside the iframe.
- Login is usually email first, then a password or an account creation page.

## What works in jh

- Fields are read from every frame on the page, so a same-page iframe form can be filled.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| No fields found, or clicks don't reach the form | The form is in `#icims_content_iframe` | Open the iframe's exact `src` in the tab, keeping its whole query string (including `in_iframe=1`). With `jh`: `jh apply "<that src>"` |
| The `src` redirects back to the wrapper | iCIMS wants the frame context | Reach into the frame instead (in Playwright, a frame locator on `iframe#icims_content_iframe`) |
| Guessed URLs 404 | `/job`, `/apply`, `/login` variants aren't stable | Don't guess. Use the exact iframe `src` |
