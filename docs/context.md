# Writing context.md

`~/.jh/context.md` is the file the harness answers from. Every free-text box, every question
`profile.json` doesn't cover, and the check before Submit all read it. A good `context.md` is
the difference between answers you'd send and answers you have to rewrite.

This guide covers what the file is for, the honesty rules, every section worth having (with
placeholder examples), how answers get reused, and what happens when a form asks something the
file doesn't cover. A full skeleton you can copy is at the [end](#a-skeleton-to-copy).

## How it's used

- **Every model call gets all of it.** The `fill` model (short answers), the `write` model
  (free text) and the `review` model (the check before Submit) each get `profile.json` plus the
  whole of `context.md`, along with the job description. See `facts()` in `src/profile.ts`.
- **One section is read by name.** The fit check pulls `## Target roles` out of the file. Keep
  that heading exactly.
- **Rules come first.** Name, email, phone, links, address, school and start date are answered
  from `profile.json` by plain rules, before any model sees the form. `context.md` is for
  everything else, and for the nuance a rule can't carry.
- **It's markdown for a reader, not a schema.** Headings and short bullets work best. The
  model reads it like a person would, so write it like notes to a friend filling the form for
  you.

Length: there's no limit, but the whole file goes into every call, so it costs tokens on every
form. Cut anything no application would ever ask about.

Privacy: the file stays on your machine in `~/.jh`, and is sent to the model provider behind the
CLI you logged into (Anthropic for `claude`, OpenAI for `codex`). Never put passwords, ID
numbers or bank details in it. Site logins belong in `jh login`, not here.

## profile.json or context.md?

| Put it in `profile.json` | Put it in `context.md` |
| --- | --- |
| Name, pronouns, email, phone | Which links to use where, a preferred first name |
| Street address | Where you'd work, relocation, commute, travel |
| Main degree and graduation date | GPA policy, enrollment status, coursework, other schools |
| Countries you can work in without sponsorship, one-line summary | Visa types, clearances, anything a yes/no can't say |
| Total years of experience (a number) | What counts as experience, years per tool |
| Default salary line | Salary by market, currency, hourly vs yearly |
| EEO answers or `"decline"` | Nothing. Leave demographics to `profile.json` |

When the two disagree, fix one. The review model blocks a submit when an answer contradicts
your facts, and two facts that contradict each other make that check useless.

## Honesty rules

These are built into the prompts. Write the file so they can work:

1. **Nothing is invented.** If a fact isn't in `profile.json` or `context.md`, the field is left
   empty with a note, and becomes a pending question for you. The models are told never to
   invent employers, numbers, dates, addresses, contacts or credentials.
2. **Only numbers you'd repeat in an interview.** Every number in the file can end up on a form.
   If you wouldn't defend it on a call, leave it out.
3. **Say what's not true, too.** "Never worked at a bank." "No security clearance." "Not a
   student since May 2025." A clear no beats a model's guess.
4. **Dates on everything.** Years of experience, graduation windows and "currently enrolled"
   questions are all worked out from dates. Undated work can't be counted.
5. **The review is your backstop, not your editor.** It blocks answers that contradict the
   facts. It can't catch a fact that's wrong in the file.

## Sections

Every section below maps to questions real forms ask. You don't need all of them on day one.
Start with the ones marked **start here**, then add the rest as dry runs show gaps.

### Identity notes

Forms ask: preferred name, which email or phone to use, LinkedIn, GitHub, portfolio, "where
are you based?".

`profile.json` already has the hard facts. Use this section for nuance: a preferred first name,
an old LinkedIn URL that still shows up, a city you live in now versus where you're from.

```markdown
## Identity notes

- Goes by Jay (legal first name Jayden, which goes on forms that ask for a legal name).
- Portfolio: https://example.com. Use it for "Website" fields, and GitHub for "Code samples".
- Lives in Toronto now. Grew up in Halifax, so "Atlantic Canada" questions are a yes.
```

### Work authorization and sponsorship (start here)

Forms ask: "Are you legally authorized to work in X?", "Will you now or in the future require
sponsorship?", "Do you hold a security clearance?", "Are you a citizen of X?".

Yes/no questions are answered by rule from `workAuthorization.authorizedIn` in `profile.json`:
any country in that list is "authorized, no sponsorship", anywhere else is "needs sponsorship".
Write the details here, because the free-text versions and the odd ones ("What visa would you
need?") come from this section.

```markdown
## Work authorization

- Canadian citizen. Authorized to work in Canada for any employer, no sponsorship.
- United States: not authorized. Would need sponsorship. Eligible for a TN visa for roles that
  match a TN category (software engineer roles usually do).
- Everywhere else: would need sponsorship.
- No security clearance. Never held one.
```

Getting this wrong is the fastest way to waste an application: a US-only role that rules out
sponsorship can't be won by answering "yes" to sponsorship questions you'd fail later.

### Location, remote and relocation (start here)

Forms ask: "Are you willing to relocate?", "Can you work in our office three days a week?",
"Which locations are you open to?", "What percentage of travel is OK?".

If the file says nothing about relocation, remote or office questions, the model is told to
answer **yes**. Write your real limits down.

```markdown
## Location

- Lives in Toronto, ON.
- Open to remote, hybrid or in office in the Greater Toronto Area.
- Willing to relocate within Canada for the right role. Not willing to relocate to the US
  without sponsorship sorted first.
- Travel: up to 25% is fine.
```

### Salary (start here)

Forms ask: "Expected salary", "Desired compensation", "Hourly rate", sometimes as a number field.

What the fill model does:

- If the posting gives a range, it answers the **midpoint**, in the posting's currency and
  unit (hourly if hourly). Never below the posted range.
- With no range, it uses `salary` from `profile.json`, adjusted for the title, level and market
  when this section says how.
- Salary answers are never saved to the answer bank, since they depend on the job.

```markdown
## Salary

- Canada, intermediate roles: $85,000 to $95,000 CAD. Junior roles: $70,000 to $80,000 CAD.
- US roles: quote in USD at that market's rate for the level.
- Contract or hourly roles: $45 to $55 CAD an hour.
- Flexible on salary for equity at an early-stage startup.
```

### Start date and notice period

Forms ask: "When can you start?", "Notice period", "Earliest start date".

The start date is answered by rule: "Immediately" when the posting names its own start date,
otherwise two weeks from today, in whatever date format the field wants. Use this section for
anything that changes that, and for notice-period questions.

```markdown
## Availability

- Notice period: two weeks at the current job.
- Not available for in-person starts before January 2027 (finishing a contract).
```

### Education and enrollment

Forms ask: GPA, graduation date, "Are you currently enrolled?", "Is this your final work term?",
relevant coursework, other degrees.

These decide eligibility for student, co-op, internship and new grad roles. The fit check and
the review both read your dates against what the posting requires (current enrollment, a final
work term, a graduation window), so be exact.

```markdown
## Education

- BSc Computer Science, Example University, Sep 2021 to May 2025. Graduated.
- Not currently enrolled. Not eligible for co-op or internship terms.
- GPA: 3.4/4.0. Only give it when a form requires it.
- Relevant courses: databases, distributed systems, compilers.
```

### Languages

Forms ask: "Do you speak French?", "Language proficiency", and some postings require a language.

List each language with an honest level. The fit check counts a required language you don't
speak as a hard blocker.

```markdown
## Languages

- English: native.
- French: basic reading, not professional. Do not claim French for bilingual roles.
- Spanish: conversational.
```

### Demographics (EEO)

Forms ask: gender, race or ethnicity, veteran status, disability, sexual orientation. These
are voluntary.

Answer them in `profile.json` (`eeo`), not here. `"decline"` picks "prefer not to say" on every
one of them. To answer, give plain words per question and the fill model picks the matching
option:

```json
"eeo": { "gender": "Woman", "race": "East Asian", "veteran": "Not a veteran", "disability": "No" }
```

Any demographic question your `eeo` doesn't cover gets the decline option. Nothing about it
needs to be in `context.md`.

### Years of experience (start here)

Forms ask: "Total years of professional experience", "Years with Python", "Years managing
people", often as a number field or a dropdown of ranges.

- Total years come from `yearsExperience` in `profile.json`.
- Years with one tool are estimated from the dates in this file. A tool the file never
  mentions gets 0. Number fields get a whole number, rounded down.

Say what counts. Do internships count? Freelance? A product you built and ran on your own?

```markdown
## Experience in numbers

- Professional software experience: 3 years (full-time since Jun 2023, plus two internships).
- TypeScript and React: 4 years, including internships.
- Python: 2 years.
- Postgres: 3 years. Kubernetes: about 1 year, in production at Acme.
- Has not managed people. Has mentored two interns.
```

A "5+ years" line in a posting is not a reason to skip it. Answer honestly and let the hiring
team decide.

### Timeline at a glance

A dated list of everything, newest first. It lets the models work out overlaps, gaps and
"current employer" without reading every section.

```markdown
## Timeline

- Jun 2023 to now: Software Engineer, Acme Corp (full-time, hybrid, Toronto)
- Jan 2025 to now: side project, Taskline (a scheduling app with about 300 users)
- May 2022 to Aug 2022: Software Engineering Intern, Example Bank
- Sep 2021 to May 2025: BSc Computer Science, Example University
```

### Experience (start here)

Forms ask: "Describe your current role", "Tell us about a project you led", "Why are you
leaving?", plus every per-tool years question.

One heading per role. Title, company, dates, location or remote, then what you built: for whom,
with what, and what changed because of it. One line per thing.

```markdown
## Experience

### Software Engineer, Acme Corp (Jun 2023 to present, hybrid, Toronto)

- Built the billing service that replaced a manual invoicing process (TypeScript, Postgres).
- Cut the nightly report job from 40 minutes to 6 by moving it off the main database.
- Owns the on-call rotation for payments. Wrote the runbooks.
- Stack: TypeScript, React, Node, Postgres, AWS (ECS, SQS).
- Leaving because: wants a smaller team and more product work. Nothing negative about Acme.
```

### Projects

Forms ask: "Tell us about something you built", "Link to a project you're proud of", and
anything a free-text box can hang an example on.

```markdown
## Projects

### Taskline (Jan 2025 to present)

- A scheduling app for small clinics. Built it alone: Next.js, Postgres, Stripe.
- About 300 weekly users. Two clinics pay for it.
- Link: https://example.com/taskline. Code is private.
```

### Skills

A plain list, grouped, with a level or years where it matters. This is where "Do you have
experience with X?" answers come from.

```markdown
## Skills

- Strong: TypeScript, React, Node, Postgres
- Working: Python, Go, AWS, Docker
- Some: Kubernetes, Terraform
- None: Java, .NET. Say no if asked.
```

### Target roles (required heading)

The fit check reads this section by name. Say what you want and what you don't.

```markdown
## Target roles

Full-stack and backend engineering roles, junior to intermediate. Product companies and
startups. Open to remote, hybrid or in office in Canada.
Not interested in: QA, support engineering, sales engineering, roles that are mostly on-call.
```

### Standard answers (start here)

Forms ask the same handful of open questions over and over: "Why do you want to work here?",
"What are you looking for in your next role?", "Describe your ideal team", "Tell us about a
challenge you overcame".

Write your base answer once. The write model starts from it and rewords it lightly per company.
You can keep variants by company type.

```markdown
## Standard answers

**What are you looking for in your next role?**
A small team that ships every week, where I talk to the people using what I build. I do my best
work when I can see the problem first-hand.

**Describe your ideal team.**
- Startups: people who move fast and argue about the product, not about process.
- Large companies: a team with clear owners and someone senior I can learn from.

**Why are you leaving your current role?**
I've learned a lot at Acme and I'm proud of the billing work. I want a smaller team and more of
the product side.
```

"Why us?" questions always open with something specific about that company from the posting,
then tie it to one piece of your real work. Your standard answer is the second half.

### Likely screening questions

Questions that need a careful, honest answer: an employment gap, a short stint, why you left a
job, a missing degree. Write the answer you'd give on a call.

```markdown
## Hard questions

- Gap from Sep 2022 to Jun 2023: finished my degree full-time. No work during that term.
- Left Example Bank after the internship: it was a fixed-term internship, no return offer
  that year because of a hiring freeze.
```

### References

Forms ask: reference names, emails, phone numbers, relationship.

Contact details are never invented. If you haven't written them down, the fields stay empty and
become pending questions. Either list them (with each person's OK) or say how to answer.

```markdown
## References

Available on request. Leave reference fields empty unless the form requires them.
- Manager at Acme (name and contact on request)
- Project lead at Example Bank
```

### Cover letter notes

The harness never uploads a cover letter: upload slots for one are left empty for you to attach
by hand. Cover letter **text boxes** are answered by the write model, short, from this file.

```markdown
## Cover letters

- Keep it under 150 words. One specific thing about the company, one thing I built that fits.
- Never mention salary or visa status in a cover letter.
```

### Links

Which link goes where. The URLs themselves live in `profile.json`.

```markdown
## Links

- "Portfolio" or "Website": the portfolio site.
- "Code sample" or "GitHub": GitHub profile. Pinned repos are the ones worth reading.
- Never link the personal blog.
```

### Voice (start here)

How free text should sound. The write prompt already bans the usual AI tells (em dashes, "I'm
excited", "leverage", a closing summary line). Add how you write.

```markdown
## Voice

Direct and a bit casual. Short sentences. Talks about what was built, not about passion.
No exclamation marks.
```

### Things to never say

A short list of claims the models must not make, even when a form seems to want them.

```markdown
## Never

- Never claim a degree in anything but Computer Science.
- Never say I've led a team. I've mentored, not managed.
- Never mention the startup I co-founded on bank or government applications.
```

## How answers are reused

Every answer that goes into a form comes from one source, shown in `answers.md` for each run:

| Source | Where it comes from |
| --- | --- |
| `rule` | `profile.json`, by plain rules |
| `bank` | A question you or an earlier run already answered |
| `eeo` | `profile.json` `eeo` |
| `jev` | Jev picked an option or matched a reworded question (needs a key) |
| `model` | The fill or write model, from `context.md` and the job |

The answer bank is the memory:

- On submit, model answers that are right for any company (work authorization, years with a
  tool) are saved. Company-specific ones ("Why Acme?") and salary are not.
- If you change an answer in the browser before submitting, your version is saved and wins
  over the model next time.
- Questions match after normalizing ("Are you legally authorized to work in Canada? \*" and
  "are you legally authorized to work in canada (Required)" are the same). With Jev, reworded
  questions match too ("Pronouns" and "What pronouns do you use?").

```bash
jh answers                         # the whole bank
jh answers sponsorship             # search it
jh answer "<question>" "<answer>"  # add or fix one
jh forget "<question>"             # remove one
```

When the same answer is wrong everywhere, the fix belongs in `context.md`. When it's wrong for
one question only, fix the bank.

## When a form asks something the file doesn't cover

1. The model leaves the field empty and says why in a note.
2. In review mode you see it in the list of empty fields. Fill it in the browser if you like.
3. If you don't submit, every required question that stayed empty is saved as a pending
   question.
4. `jh questions` lists them. `jh answer` walks through them one at a time and saves each
   answer to the bank.
5. `jh answer` prints the `jh apply` lines to re-run the jobs that were waiting.

If the same kind of question keeps coming up, it's a missing fact. Add it to `context.md`.

## Checking your file

1. Pick three postings on different sites (Greenhouse, Workday, LinkedIn).
2. Run `jh apply <url> --submit dry` on each.
3. Read `~/.jh/runs/<date>-<company>/answers.md`. Look at every `model` answer: is it true, is
   it how you'd say it?
4. For each wrong answer, find the missing or vague fact and fix it here.
5. Repeat until a dry run has nothing you'd change.

## A skeleton to copy

```markdown
# About me

## Target roles

<What roles, what level, where. What you don't want.>

## Work authorization

- <Country>: authorized, no sponsorship.
- <Country>: needs sponsorship. <Visa type if you know it.>
- <Clearance: none / which>

## Location

- Lives in <city>.
- Open to <remote / hybrid / in office> in <places>.
- Relocation: <yes / no / only to ...>.
- Travel: <percentage>.

## Salary

- <Market, level>: <range and currency>.
- <Hourly or contract rate, if any>.

## Availability

- Notice period: <weeks>.

## Education

- <Degree, school, dates>. <Graduated / enrolled until ...>.
- GPA: <value, or "don't share unless required">.

## Languages

- <Language>: <level>.

## Experience in numbers

- Professional experience: <years, and what counts>.
- <Tool>: <years>.

## Timeline

- <Dates>: <role, company>

## Experience

### <Title>, <Company> (<start> to <end>, <remote / city>)

- <What you built, for whom, with what.>
- <A number you'd repeat in an interview.>
- Leaving because: <one honest line>.

## Projects

### <Name> (<dates>)

- <What it is, who uses it, what you built.>

## Skills

- Strong: <...>
- Working: <...>
- None: <...>

## Standard answers

**What are you looking for in your next role?**
<Your answer.>

**Describe your ideal team.**
<Your answer.>

## Hard questions

- <Gap or question>: <honest answer>.

## References

<Available on request, or who and how.>

## Cover letters

<Length, what to include, what to leave out.>

## Links

- <Which link for which field.>

## Voice

<How you write.>

## Never

- <Claims to never make.>
```
