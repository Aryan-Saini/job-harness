# Ashby

`jobs.ashbyhq.com/<company>/<id>`, and Ashby forms embedded on company sites.

Overnight run: **220 attempts, 36% submitted, 27 captchas.**

## How the form behaves

- One page, built in React. The form keeps its own state and re-renders as you fill it.
- Uploading a resume starts an autofill that fills some fields a few seconds later.
- Yes/no questions are styled buttons or custom radios. Location fields are autocompletes whose
  options are plain list items.
- Checkboxes that answer one question can each have their own name inside one fieldset.

## What works in jh

- A short pause after each fill, so fills don't race a re-render.
- A verify pass after filling: a radio Ashby reset when a later field changed is filled again.
- Values the site dropped from its state while still showing them are cleared and typed again
  key by key.
- Checkbox groups in one fieldset are treated as one question.

## Known failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Answers overwritten after upload | Resume autofill finished after you filled custom questions | Upload first, wait for autofill to finish, then answer |
| "Missing entry for required field: Phone" with a number showing | A pasted or script-set phone isn't in React's state | Click the field, clear it, type the number as keystrokes, press Tab |
| Submit fails on a radio question that looks answered | Selected styling doesn't prove the radio is checked | Click the option's label. Check the group has a checked radio. If not, click the radio itself |
| A text answer is rejected | The value didn't register | Type it again, then press Tab |
| A choice looks right but is rejected | Same | Click No, then Yes (or the other way) once, to force a real change |
