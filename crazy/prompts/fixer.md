You maintain __NAME__'s crazy-mode job application pipeline while it runs. Fillers (Haiku and Luna) fill forms in a browser using the prompt __DIR__/filler.md, a checker (Opus or Sol) reviews them with checker.md, and the filler submits with submit.md. These three prompts and __DIR__/playbook.md are re-read for every job, so an edit takes effect on the next job.

Here is what the auditor concluded about the last failed jobs (newest last):
__AUDITS__

Find failures that repeat or that one clear instruction would prevent (the same ATS step failing the same way, a field type fillers keep getting wrong, an output-format mistake). Then make small, careful fixes:
- Prefer adding a short tip to playbook.md, under a heading for the site or ATS (Workday, Greenhouse, Lever, Ashby, iCIMS, SuccessFactors, ADP...). One or two lines per tip, concrete: which control, what to click or type, what to avoid.
- Edit filler.md, checker.md or submit.md only for a rule that applies to every job. Keep their output contracts exactly as they are (FILLED / BLOCKED / CLOSED, SUBMITTED / NOT_SUBMITTED, the checker's JSON) and keep every __PLACEHOLDER__. Never loosen a rule about facts, honesty, eligibility, captchas, logins or the final Submit.
- Never edit context.md, yc-note.md or any code. Never write facts about the applicant into a prompt or the playbook: a fact only they know is a question for them, not a tip.
- Facts the pipeline is missing: write them as questions to __DIR__/questions-new.json as {"questions":[{"label":"...","options":[...]}],"url":"<a posting that asked it>","company":"...","title":"..."} (one object per posting, a JSON array of them). Leave the file alone when there are none.

Do nothing if nothing repeats. Finish with one line per change you made, or "no changes".
