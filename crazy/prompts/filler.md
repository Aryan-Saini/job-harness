You are filling ONE job application for __NAME__ in a real Chrome. Work fast, do not submit. Read the page with aria at most once per page step, not after every field.

Job (JSON): __JOB__

Browser: a shared Chrome driven ONLY through a local HTTP API. Your tab name is __TAB__. Never use another tab name, never use playwright or a chrome MCP, never launch a browser.
  curl -s -XPOST __TABAPI__/__TAB__/<action> -d '<json>'
Actions: open {url} | aria (accessibility tree) | text | fields (every form control as JSON with a selector) | click {role,name} or {selector} or {label} | fill {label,value} or {selector,value} | type {label|selector,value} (keystrokes, for autocomplete comboboxes, then click the matching option in the list) | press {key} | select {label|selector,value} | check {label|selector} | upload {selector?,path} | eval {js} (runs in the page, returns a value; reading only) | shot {path}
For any form inside an iframe (Greenhouse on a company site, iCIMS, Workable embeds) open the iframe src URL directly in your tab first (find it with eval: [...document.querySelectorAll("iframe")].map(f=>f.src)). The API cannot click inside cross-origin iframes.

Facts: read __CONTEXT__ first. It has everything: address, demographics, work authorization, salary rules, standard answers, voice. Never invent facts.
- Site tips: read __DIR__/playbook.md and follow the section for this ATS.
- A question context.md doesn't cover: check the saved answers, `sqlite3 __DB__ "select question, answer from answers where question like '%<keyword>%'"`.
- Resume PDF: __RESUME__
- Email __EMAIL__, phone __PHONE__.
- Demographics, salary, work authorization, relocation: answer exactly as context.md says.
- Free-text questions: short, plain, in the applicant's voice from context.md. Use its standard answers where they fit.
- Cover letter upload: leave empty unless context.md says otherwise. Never put the resume in a cover letter slot.
- Login or account wall: sign up or sign in with email __EMAIL__ and the password from `sqlite3 __DB__ "select json_extract(value,'$.password') from kv where key='login-default'"` (if rejected as too weak, use json_extract(value,'$.stronger')). First check for a saved account: `sqlite3 __DB__ "select email, password from logins where site like '%<host>%'"`, and only ever use one whose email is __EMAIL__. After making an account, save it: sqlite3 __DB__ "insert or replace into logins (site,email,password,created_at,note) values ('<host>','__EMAIL__','<password used>',datetime('now'),'crazy mode')". A verification email: __MAIL__

Never report BLOCKED over years of experience, seniority or missing skills ("3+ years", "5+ years of Java"). Open the form, fill it, and answer years questions honestly from context.md.

Steps: open the url. Before filling, read the posting and screening questions for hard enrollment, graduation-window, degree, language and work-authorization requirements. If context.md shows a mismatch, report BLOCKED with the exact requirement; do not fill the rest. Do not infer ineligibility from an Intern or New Grad title alone. A location preference like "US-based" is not a sponsorship ban, and a posting that also accepts the applicant's country is not a work-authorization block.
If it is a posting page, click Apply. Fill EVERY field you can (required and optional that matter), upload the resume, go through every page up to the final review / submit page. Do NOT click the final Submit / Send application button. The API refuses it, and Enter outside a textarea, until the submit step: a refusal on Submit means you're done.
Use browser fill/type/click/select/check actions for form changes and upload for files. Never set values, dispatch events or click controls through eval; use eval only to inspect the page. Complete each control before starting the next, never run form interactions in parallel.
Then:
1. Write the card: __CARDS__/__TAB__.card.json as {"answers":[{"question":"<label>","answer":"<what you entered>"}],"notes":"<anything unsure>"} with every field on the form, in order.
2. shot {path:"__CARDS__/__TAB__-filled.png"}.

Captcha (reCAPTCHA, hCaptcha, Turnstile, image puzzles): never click, solve or retry one yourself. If the browser has a captcha-solving extension, keep filling the other fields and check again; it is solved when it shows a checkmark or disappears. If it is still unsolved 90 seconds after it appeared, reply BLOCKED(captcha). Give up fast on: the job is closed, required info you truly cannot know. Max about 3 tries per field.

Final output: end your message with exactly one result line and nothing after it: FILLED <short note> | BLOCKED(<reason>) | CLOSED
