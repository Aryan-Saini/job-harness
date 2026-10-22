# Workday

`<company>.wd<N>.myworkdayjobs.com`. Every company is its own Workday tenant.

Overnight run: **270 attempts, 36% submitted, 0 captchas.**

## How the form behaves

- You need an account per tenant: an account at one company's Workday doesn't work at
  another's. Sign-in pages offer Google or LinkedIn SSO and plain email.
- "Autofill with Resume" competes with "Apply Manually".
- Several pages: My Information, My Experience, Application Questions, Voluntary Disclosures,
  Review.
- Dates (MM/YYYY) are segmented inputs. Searchable fields (School, Field of Study) only search
  when you press Enter. Nested multiselects ("How did you hear about us?") open categories
  inside categories.
- Buttons sit under a transparent click catcher.

## What works in jh

- "Apply Manually" is preferred over resume autofill.
- Account creation uses `jh login default`. Logins are saved per host, so the same tenant is
  signed into again next time instead of making a second account.
- On sign-in choosers it picks plain email over SSO.
- Clicks fall back to a forced click when the click catcher is in the way.
- The same posting is recognized by its req id (`..._R-12345`), with or without `/apply`.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Date field stays red | Pasted or script-set dates don't register | Click into it, clear it, type the month then the year as keystrokes, press Tab. Still red: use the calendar icon |
| "How did you hear about us?" won't take a value | Names like "Job Board(s)" are categories that open a sub-list | Open the category, wait, click a leaf (e.g. LinkedIn) until a chip with an X appears. Don't type in its search box, it picks odd values |
| School or Field of Study says "No Items." | Nothing was searched yet. These only search on Enter | Type, press Enter, wait, click the exact option until a chip appears. Lists show only the first 100 options, so always search |
| Skills merge into one ("SQLBusiness Analysis") | The box wasn't cleared between skills | One skill at a time: type, Enter, wait for the chip, clear, next |
| Work experience entries vanish on save | One entry had an invalid value (a script-set checkbox or date) | Redo that entry with real clicks and keystrokes |
| Websites section blocks the page | An empty Websites entry still requires a URL | Fill it or delete the entry |
| "Account already exists" | You applied at this company before | Sign in instead. If a draft exists for this job, continue it |
