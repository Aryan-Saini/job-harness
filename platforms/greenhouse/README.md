# Greenhouse

`boards.greenhouse.io`, `job-boards.greenhouse.io`, and Greenhouse forms embedded in company
career pages (often in an iframe, with a `gh_jid` in the URL).

Overnight run: **342 attempts, 46% submitted, 16 captchas.** The best rate of any big platform.

## How the form behaves

- One long page: contact details, resume, custom questions, then voluntary demographics.
- Most dropdowns are react-select widgets, not `<select>`. They have a visible box and a hidden
  input that holds the real value.
- Location, school, degree and discipline are searchable lists. What you type is a search, not
  a value.
- The phone field can have two country widgets: a required "Country" react-select and a flag
  picker on the phone input.
- Some forms email a security code after Submit, split into one box per character.
- Education has start and end month/year fields under an Education heading.

## What works in jh

- Embedded forms on company sites: fields are read from every frame, and the thank-you page is
  checked inside the iframe too.
- Greenhouse labels both upload slots "Attach". The first gets your resume and the second (the
  cover letter's) stays empty.
- Education dates are answered from `profile.json` only under the Education heading, so a past
  job's dates aren't mistaken for school dates.
- The same posting reached through the company site or through Greenhouse counts as one, by its
  `gh_jid`.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Dropdown shows the answer, but Submit says it's required | Typed text plus Enter shows a value but leaves the hidden input empty | Click the field's arrow, wait for the menu, click the option with the mouse, then click blank page space |
| Application submitted before the review | Enter was pressed inside the form. This submitted four applications early in the run | Never press Enter anywhere in a Greenhouse form, dropdowns included. Click options |
| "Country" still required after picking a phone flag | The flag picker doesn't fill the separate required Country field | Set the Country dropdown itself |
| Wrong city picked | Search lists match on name ("Portland" is in Oregon and Maine) | Type the search, wait for the list, click the exact option with region and country |
| Errors remain on a field that looks filled | The form's state is stuck | Clear the field with its X and pick again. Still stuck: reload the page once and refill. Don't keep reselecting in a stuck form |
| A security code is asked for after Submit | Greenhouse emailed one | Read the email, type the whole code starting in the first box |

On a retry, open the posting URL fresh. Don't continue in a tab an earlier attempt left behind.
