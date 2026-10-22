# Crazy-mode playbook

Site and ATS tips learned from failed applications. The fixer adds to this file overnight; fillers
read it before filling. Facts about the applicant live in context.md, never here.

## Output
- Your final message's last line must be the result line alone (FILLED ... / BLOCKED(...) / CLOSED). Put notes before it, never after.
- Never click the final Submit while filling. If a page submits by itself, say so in the result line.
- While filling, the tab API refuses a final-submit click, Enter outside a textarea, and eval that clicks or dispatches events ("refused: ..."). Reaching that refusal on Submit means the form is done: report FILLED. For other refusals, click the option or button instead.
- On multi-step forms (Avature, Greenhouse, Oracle), a "Submit" button on the last step (e.g. a Compliance page) is the final submit. Never click it to advance or to test validation; stop and report FILLED.

## Browser API limits
- To see a form's fields, use the `fields` action on your tab instead of a hand-written querySelectorAll eval. It returns JSON, one entry per input/select/textarea (iframes too, tagged with `frame`): label, name, id, type, required, value, checked and group (radios/checkboxes), options (selects), invalid, and a `selector` you can pass straight to click/fill/type/select/check as {"selector": ...}. `tab <your tab> <action> [json]` is the same API without hand-escaping JSON.
- The tab API has no x/y mouse click and cannot switch tabs or popups. Ignore hints asking for coordinate clicks; use click {selector|label|role} only.
- If Apply (or a sign-in button) opens a new tab, your tab never sees it. Read the target with eval (the link's href, or a[target=_blank] hrefs) and open that URL in your own tab. A Google/Microsoft OAuth popup can't be followed this way: try the email/password route, else report BLOCKED(popup-login).

## Greenhouse
- Phone Country: open the flag dropdown, search the applicant's country, and click the exact option before typing the phone. A visible flag or dial code alone does not prove selection.
- Location, School, Degree and Discipline: type a search, wait for the list, and click the exact matching option. Cities share names across countries (Vancouver, British Columbia vs Vancouver, Washington): pick the one in context.md. Typed search text is not a selected value.
- If a populated field still shows a required error, clear it with its own X and select the exact option again, then blur. If errors persist, reload once and refill with browser actions; do not keep reselecting in the stuck form or click Submit to test it.
- Before reporting FILLED, check the full form for required errors with text or a screenshot. Do not assume errors are stale just because the intended value is visible.
- Custom react-select dropdowns (privacy notice, AI consent, office questions, sponsorship): click the field's arrow, wait for the menu, and click the option with the mouse; then click blank page space. Typing text and pressing Enter often shows the value without registering it (hidden input stays empty, aria-invalid=true).
- The phone area can have two country widgets: the required react-select input id "country" (label "Country*") and an intl-tel-input flag picker (search box "iti-0__search-input"). Set Country* through #country itself; changing the flag picker does not fill it.
- Never press Enter anywhere in a Greenhouse form, including dropdowns and demographic questions. Enter has submitted applications early. Always click the option with the mouse.
- Greenhouse dropdowns are react-selects, not <select>, so the select action and eval/JS clicks show a value without registering it. On a retry, always open the posting URL fresh. Never continue in a tab an earlier attempt left behind. If errors remain after one reload, report BLOCKED(stuck-validation: <fields>).

## Ashby
- Wait for resume autofill to finish before answering custom questions. Autofill can reset custom answers it touched: re-check every custom question afterward, and if a choice was rejected despite showing selected, click another option and then the right one once.
- Re-enter rejected text answers with fill/type, then press Tab. Click the exact option for required choice fields; selected button styling alone does not prove the answer registered.
- Phone: click it, clear it, type the number with the type action (keystrokes), then press Tab. A filled value can show while Ashby still reports "Missing entry for required field: Phone".
- Radio questions: click the option's label text, then check with eval that the group has an input[type=radio]:checked. If not, click the radio itself and check again.

## Lever
- "Current location": type the city from context.md, wait for the list, and click the exact city, region and country. Then check with eval that input[name=selectedLocation] is not empty; typed text alone leaves it blank and blocks submit.
- Lever keeps a hidden "File exceeds the maximum upload size of 100MB" error template on every page. Count only visible errors (offsetParent not null); the resume is fine when it shows "Success!".
- Submit: Lever often opens an hCaptcha challenge after Submit that the text action doesn't show. If still on /apply, check with eval for a visible iframe whose src contains "hcaptcha" (getBoundingClientRect().height > 100); if there is one, wait the 90 seconds per submit.md and report NOT_SUBMITTED(captcha), not "no confirmation".

## iCIMS
- The form is in iframe #icims_content_iframe. Open its exact src from eval, keeping the full query string (in_iframe=1). Never guess variants (/job, /apply, /login, .i.icims.com); they redirect or 404.
- If the exact src also redirects to the wrapper, try once to reach into the frame with selectors like {"selector":"iframe#icims_content_iframe >> internal:control=enter-frame >> text=Apply for this job online"}. If that errors too, report BLOCKED(icims-iframe) right away.
- The enter-frame prefix works for every control, not just Apply: e.g. fill {"selector":"iframe#icims_content_iframe >> internal:control=enter-frame >> input#email"} on the email login (then click #enterEmailSubmitButton the same way). Use exactly this `>>` form; `>>>`, `iframe=` and plain selectors time out. Never report BLOCKED(icims-iframe) without having tried it.

## LinkedIn
- "You reached today's Easy Apply limit" / "continue applying tomorrow": report BLOCKED(easy-apply-limit) at once; never look for workarounds.
- Easy Apply radios: click each option's label with the mouse (click {label}); radios set through group selectors or JS show a value LinkedIn never registers, and Submit then fails with "We couldn't submit your application".
- On a retry, first check the job page for "Applied" / "Application submitted"; if shown, stop and report it.

## Oracle HCM / SuccessFactors
- Resume upload runs a profile import that adds broken work/education rows (no employer, "Unnamed Major", wrong dates, tech names as locations). Upload the resume first, then go through every work and education row, fix or remove the bad ones, and confirm no row shows a red ! before reporting FILLED.

## Workday
- Date fields (MM/YYYY): click into the field, clear it, type the month then the year as keystrokes, press Tab, and confirm the red error is gone; if not, use the calendar icon.
- "How Did You Hear About Us?" and other nested multiselects: click the list icon at the right end of the field, open a category (">"), and click the sub-option's radio/checkbox. A chip with an X must appear; typed text or Enter does not commit a value.
- In that source picker, "Job Board(s)" and similar names are categories: clicking one only opens its sub-list. Wait for the sub-list, then click a leaf such as "LinkedIn" (or any listed board). Once a chip registers, never remove it. Don't type in its search box, because that has picked wrong values like "Liepin".
- Work Experience has no entry limit. If entries vanish on save, one of them was invalid (a JS-set checkbox or date). Redo it with real clicks and keystrokes.
- Websites: never leave an empty Websites entry (its URL is required). Fill it or delete it.
- Search prompts (School or University, Field of Study) only search on Enter: type e.g. the school's name, press Enter, wait, then click the exact option until a chip with an X shows. "No Items." before Enter means nothing was searched yet, not a dead end. The lists only show the first 100 options, so always search.
- Skills is free text: type one skill, press Enter, wait for its chip, clear the box, then type the next. Skipping the clear step merges skills ("SQLBusiness Analysis").
- Every Workday tenant (company.wd5.myworkdayjobs.com) is its own account. Before Create Account, check `select site,password from logins where site like '%<company>%' and email='<the email in your prompt>'` (only ever sign in with that email; never use any other login). If one exists, click Sign In instead, and if a draft exists for this job, continue it.

## Y Combinator / Work at a Startup
- ycombinator.com/companies/<co>/jobs/<id> postings apply through workatastartup.com, which needs a YC account with a filled profile, signed in in this Chrome (login in the `logins` table under account.ycombinator.com). If it asks to log in, use that email and password; never sign up again.
- Work at a Startup allows about 5 applications per account per week. After that Send silently does nothing; apply through the company's own Ashby, Greenhouse or Lever page instead.
- On the posting click Apply. The application is a note to the founder plus the saved profile. Read yc-note.md, next to this playbook (a read-only guide: never write to it, or to any file there except your card and screenshot) and write the note to it: about their product first, one real connection to the applicant's work from context.md, no stats, no cover-letter voice.
- Put the company's one-liner and the posting's key lines (what they build, the role) in the card's "notes", so the checker can rewrite the note if needed.
- On a YC posting, Apply opens a box like "Reach out to <founder> at <company>". That message box IS the application on Work at a Startup: sending it is submitting. Do not treat it as messaging a recruiter.
- The note is the whole application: no Submit page to stop at. Fill the note, then stop and report FILLED; the submit step clicks Send.
- Enter the note with the type action (real keystrokes), not fill; a filled note can look present while the app's state stays empty, so Send does nothing.
