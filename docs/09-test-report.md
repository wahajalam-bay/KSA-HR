# Test report

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

Run on **2026-09-18 04:00 UTC**,
in **5.9s**.

## 323 passed · 0 failed

Every suite below runs against the **real PostgreSQL database**, with the real
constraints and the real triggers, inside a transaction that is rolled back at
the end. There is no mocking framework and no in-memory double, because an
in-memory double would not have the append-only trigger on `audit_events`, the
unique index that stops two people being hired into one seat, or the foreign key
that refuses an orphan — and those are exactly the things worth testing.

A write test drives the **real command through the real dispatcher**: the
capability is checked, the Zod schema is parsed, the transaction is opened. A
test that skipped any of those would be testing something the product does not
do.

| Suite | Passed | Failed | Skipped |
| --- | --: | --: | --: |
| [`sheets · reachable without a mouse`](../tests/sheets/accessibility.test.ts) | 8 | — | — |
| [`sheets · every panel draws`](../tests/sheets/render.test.ts) | 10 | — | — |
| [`sheets · every button is wired to something`](../tests/sheets/wiring.test.ts) | 7 | — | — |
| [`unit · reading a document nobody here wrote`](../tests/unit/documents.test.ts) | 16 | — | — |
| [`unit · the arithmetic`](../tests/unit/domain.test.ts) | 24 | — | — |
| [`unit · the manpower plan, as a spreadsheet`](../tests/unit/plan.test.ts) | 13 | — | — |
| [`write · automations and sweeps`](../tests/write/automation.test.ts) | 11 | — | — |
| [`write · candidate → application`](../tests/write/candidates.test.ts) | 12 | — | — |
| [`write · reading a CV`](../tests/write/cv.test.ts) | 10 | — | — |
| [`write · the rest of the buttons`](../tests/write/extras.test.ts) | 19 | — | — |
| [`write · files`](../tests/write/files.test.ts) | 10 | — | — |
| [`write · integrations, present and absent`](../tests/write/integrations.test.ts) | 8 | — | — |
| [`write · interviews`](../tests/write/interviews.test.ts) | 16 | — | — |
| [`write · one hire, end to end`](../tests/write/lifecycle.test.ts) | 1 | — | — |
| [`write · assessment and sales pitch`](../tests/write/loop.test.ts) | 10 | — | — |
| [`write · the manpower plan`](../tests/write/manpower.test.ts) | 11 | — | — |
| [`write · offers`](../tests/write/offers.test.ts) | 19 | — | — |
| [`write · onboarding`](../tests/write/onboarding.test.ts) | 13 | — | — |
| [`write · every page query, under every scope`](../tests/write/queries.test.ts) | 5 | — | — |
| [`write · manpower → requisition → approval`](../tests/write/requisitions.test.ts) | 18 | — | — |
| [`write · the small writes a row makes`](../tests/write/rows.test.ts) | 13 | — | — |
| [`write · My Hiring, and the scope underneath it`](../tests/write/scope.test.ts) | 10 | — | — |
| [`write · screening`](../tests/write/screening.test.ts) | 13 | — | — |
| [`write · settings`](../tests/write/settings.test.ts) | 17 | — | — |
| [`write · the TA team`](../tests/write/team.test.ts) | 12 | — | — |
| [`write · taking a file in`](../tests/write/uploads.test.ts) | 17 | — | — |


## Visual parity

The prototype is the acceptance reference, photographed at 390, 900 and 1440
pixels in both themes and compared pixel for pixel.
Run on 2026-09-18 03:59 UTC.

**49 of 49 routes within 2% of the
prototype**, measured on each route's worst capture.

The routes whose remaining difference is recorded and expected — each shows something real that the prototype faked:

| Route | Worst capture | Where | Recorded reason |
| --- | --: | --- | --- |
| `settings-data` | 67.48% | 390 dark | Production prints the real collection sizes from the database. |
| `settings-audit` | 61.58% | 390 dark | Production shows real audit entries, including the ones this test run just wrote. |
| `settings-integrations` | 35.04% | 390 dark | Production reports each provider as configured or not; the prototype showed a fixed list as connected. |
| `settings-automations` | 14.10% | 390 dark | Each rule prints the event the engine actually raises — requisition.approved rather than the prototype’s job.opened — and the longer name wraps one line further at 900 and below. |
| `sign-in` | 13.63% | 390 light | The production screen adds the single sign-on option and drops the prototype-account list. |
| `job-activity` | 11.20% | 390 dark | Production moves a close stamped before the last stage hop onto that hop, so closes the prototype dated months earlier fall inside the 200-day feed. |
| `settings-templates` | 3.94% | 390 dark | Production carries the acknowledgement template the shipped automation rule refers to; the prototype’s rule pointed at a template that did not exist, so its list is one row shorter. |

A route with a recorded reason shows something real that the prototype faked and
does not fail the run; see [known limitations](10-known-limitations.md).



## The route walk

Every route loaded for real, as each kind of person who uses it, and failed on
anything that should never reach somebody: an error boundary, a stack trace,
`[object Object]`, `NaN`, the word "undefined", an unreplaced merge field, a
console error, or a status that is not 200. `npm run walk`.

Run on 2026-09-18 05:57 UTC
against http://127.0.0.1:3400.

**284 page loads** — 48 routes as 6 roles
(admin, recruiter, picked, coordinator, onboarding, hiringManager) — **nothing on any of them that should not be**.


This is the check that catches what a unit suite structurally cannot: a
predicate that composes wrongly only for an account whose access is not
everything, and therefore works for everybody who writes the queries. It found
two — six page queries that qualified a column with a table name the query had
aliased away, and an `IN ()` for a scope that reached nothing.

## Failures

None.

## Every test

### sheets · reachable without a mouse

`tests/sheets/accessibility.test.ts`

- ✓ every panel announces what it is
- ✓ every control says what it does
- ✓ every field is labelled, and the label points at it
- ✓ nobody has forced the tab order
- ✓ anything decorative is hidden from a screen reader
- ✓ an image carries alternative text
- ✓ a control that is not a button behaves like one
- ✓ the panels that ask a question mark what is required

### sheets · every panel draws

`tests/sheets/render.test.ts`

- ✓ every action the interface fires as a sheet has one
- ✓ every sheet draws for an Admin
- ✓ every sheet draws for a recruiter and for Onboarding
- ✓ the requisition editor reads the requisition it was opened on
- ✓ the new-requisition sheet offers the pipelines and the departments
- ✓ a panel an account may not reach refuses rather than drawing
- ✓ the phone screen says so when no telephony provider is configured
- ✓ the offer editor refuses to open on a letter that has gone out
- ✓ the scope sheet lists the requisitions and the four scopes
- ✓ the plan refuses to add a seat without a requisition

### sheets · every button is wired to something

`tests/sheets/wiring.test.ts`

- ✓ every action on every panel resolves
- ✓ every command the panels fire is reachable and guarded
- ✓ every sheet the panels open exists
- ✓ every action written into a page resolves as well
- ✓ an upload well posts to a command that reads its files
- ✓ the classifier and the registries agree
- ✓ a destructive command asks before it acts

### unit · reading a document nobody here wrote

`tests/unit/documents.test.ts`

- ✓ a zip built byte by byte reads back as what went in
- ✓ something that is not a zip is refused in words, not a stack trace
- ✓ the five XML entities and a numeric reference come back as characters
- ✓ a Word document reads as its text, in reading order
- ✓ a table in a letter keeps its rows and columns apart
- ✓ a file that is not a Word document reads as nothing rather than as noise
- ✓ a CSV keeps a quoted comma, a doubled quote and a blank cell in place
- ✓ an Excel that writes semicolons is read as an Excel that writes semicolons
- ✓ a trailing newline is not a row of nothing
- ✓ a column reference is a column number
- ✓ a serial day is the day Excel means by it, either side of the 1900 bug
- ✓ a worksheet reads as the grid that was typed, blanks and all
- ✓ a date is a date and a headcount is a number, decided by the style
- ✓ the old .xls is refused by name rather than read as gibberish
- ✓ either format arrives as the same grid
- ✓ a header is matched however somebody has capitalised or spaced it

### unit · the arithmetic

`tests/unit/domain.test.ts`

- ✓ the spine is ten stages in one order, and four of them are fixed
- ✓ a loop out of order is put back into spine order
- ✓ applied and sourced are alternatives, so advancing skips the other
- ✓ advancing runs out at the end, and back at the beginning
- ✓ an SLA is ok, then due at seven tenths, then over past it
- ✓ a score is a percentage of its own maximum, and bands consistently
- ✓ money is read however a person writes it
- ✓ a notice period is read in whatever unit it was given
- ✓ Arabic is read as a level, not a yes or no
- ✓ an unanswered knockout scores nothing, not the middle
- ✓ a salary inside the band scores full, just over scores half, well over scores nothing
- ✓ Arabic costs more where the job is customer-facing
- ✓ the six questions are asked of everybody, worded for the requisition
- ✓ fit rewards the skills the requisition asked for
- ✓ a fit score is banded, and the bands are ordered
- ✓ a known employer answers the sector outright
- ✓ failing that, the words on the page answer it — and say what they read
- ✓ every sector rule is reachable and none of them shadows another entirely
- ✓ three months from the end of a long month lands inside the short one
- ✓ probation is in progress, then due, then decided
- ✓ a tag lapses on its own, on the day it was set for
- ✓ a tag length the product does not offer falls back to the default
- ✓ the interviewer review is six criteria meaned onto a hundred
- ✓ a review is flagged on compliance, or on a flag somebody raised

### unit · the manpower plan, as a spreadsheet

`tests/unit/plan.test.ts`

- ✓ the worked example in the template reads back as itself
- ✓ the columns are matched however somebody has written them
- ✓ a column nobody recognises is reported rather than ignored
- ✓ a sheet with no title column is refused, and says what it does have
- ✓ the header is found under a title row somebody typed above it
- ✓ several departments in one file are several decisions
- ✓ a reporting line pointing at a seat the file does not have is named
- ✓ a line that points at a seat by its code resolves, and is not an orphan
- ✓ a row with no title is left out, with its row number
- ✓ a headcount that is not a number is refused rather than rounded to nothing
- ✓ the three ways a date is written here are all read, and a fourth is refused
- ✓ a file with a header and nothing under it is refused in words
- ✓ every column the template documents is a column the reader accepts

### write · automations and sweeps

`tests/write/automation.test.ts`

- ✓ an event fires the rules that want it, and nothing else
- ✓ the same event never fires the same rule twice
- ✓ a disabled rule is never evaluated
- ✓ a condition is read off the event, and a miss is recorded with its reason
- ✓ a message action writes to the outbox and says so on the run
- ✓ an action that cannot work leaves the run failed with the reason on it
- ✓ the subject of an event is found however the event points at it
- ✓ the SLA sweep raises one event per application per day
- ✓ the probation sweep separates what is due from what is late
- ✓ the daily run raises its own tick, once
- ✓ a scorecard nobody wrote is chased after two days, not before

### write · candidate → application

`tests/write/candidates.test.ts`

- ✓ a new candidate is created with normalised keys
- ✓ the same person twice is refused, however the number is written
- ✓ a duplicate can be kept deliberately, and says so in the trail
- ✓ a candidate with no way to reach them is refused
- ✓ adding somebody to a requisition starts their history at the entry stage
- ✓ a sourced candidate enters at Sourced instead
- ✓ the same person cannot be added to the same requisition twice
- ✓ nobody new can be added to a closed requisition
- ✓ a hiring manager may not add a candidate
- ✓ a tag belongs to one recruiter until it is released
- ✓ every candidate write leaves a trail
- ✓ writing to a candidate goes through the outbox and says so on the panel

### write · reading a CV

`tests/write/cv.test.ts`

- ✓ the reader finds what is there and says where each field came from
- ✓ a field that is not in the document is not invented
- ✓ a scan with no text in it says so rather than returning nothing
- ✓ two experience entries are read in order, with the current one first
- ✓ the fit against a requisition is the skills it asks for, with the reasoning
- ✓ a CV that matches somebody already on file says so before anything is created
- ✓ a reading is only kept once there is somebody to keep it against
- ✓ attaching a reading makes it the current one and keeps the last
- ✓ reading and creating are two commands, and a hiring manager may do neither
- ✓ confirming the reading creates the candidate and puts them on the requisition

### write · the rest of the buttons

`tests/write/extras.test.ts`

- ✓ a requisition posts to LinkedIn, or records why it did not
- ✓ a requisition nobody set to be published is not published
- ✓ a requisition that is not open is not advertised either
- ✓ an export is rows, with a header, in a file Excel opens as UTF-8
- ✓ the audit trail is an Admin’s to export, and nobody else’s
- ✓ an export of nothing says so rather than handing back an empty file
- ✓ an export the product has no rows for is refused by name
- ✓ a question with a figure in it exports the rows behind it
- ✓ a question with no figure in it has nothing to export
- ✓ an interview nobody recorded cannot be reviewed
- ✓ a recorded interview is reviewed, or says what is missing
- ✓ a joiner with nothing outstanding is not chased
- ✓ a joiner who owes something is chased, and the message is honest about how
- ✓ a copied pitch project arrives switched off, so nobody sends a draft
- ✓ restoring every SLA asks first, and then there are no overrides left
- ✓ taking a photograph off leaves the monogram, and refuses when there is none
- ✓ a CV comes back as a link or as the reading, and the access is recorded
- ✓ the sector is read from the record, and a recruiter may say otherwise
- ✓ a bank question is added once, and refused the second time

### write · files

`tests/write/files.test.ts`

- ✓ what a file actually is decides whether it is taken
- ✓ the sniffer reads the bytes, not the name
- ✓ an unscanned file is recorded as unscanned, never as clean
- ✓ a file is readable by whoever can reach the record it hangs off
- ✓ a deleted file is gone from the store and marked in the record
- ✓ a version supersedes rather than overwrites
- ✓ every download is recorded against the file
- ✓ an oversized file is refused before it is stored
- ✓ an empty file is refused
- ✓ an employee file belongs to the onboarding desk, not the pipeline

### write · integrations, present and absent

`tests/write/integrations.test.ts`

- ✓ every provider reports a state, and names what it is missing
- ✓ a message is queued when it can go, and marked not_configured when it cannot
- ✓ a message is never recorded as sent by the act of queueing it
- ✓ the phone screen is refused outright without telephony — not scheduled
- ✓ an assessment invitation says plainly when nothing was sent
- ✓ an uploaded file is never called clean by a scanner that is not there
- ✓ what the interface is told matches what the outbox holds
- ✓ the state of an integration is on the record when it changes something

### write · interviews

`tests/write/interviews.test.ts`

- ✓ booking writes the interview, the panel and one scorecard each
- ✓ the panel can sign in afterwards — the accounts are made for them
- ✓ a named hiring manager gets the hiring-manager role, not the narrower one
- ✓ the same person cannot be in two rooms at once — unless somebody insists
- ✓ a Friday says so in the toast rather than being refused
- ✓ a time in the past is refused
- ✓ a stage you do not interview at is refused
- ✓ the final interview stays locked behind the sales-pitch gate
- ✓ a hiring manager may not book, a coordinator may
- ✓ a recruiter outside the requisition cannot book on it
- ✓ moving one keeps the scorecards and records where it came from
- ✓ changing the panel on the way moves the scorecards with it
- ✓ cancelling withdraws the outstanding scorecards and leaves the application alone
- ✓ a cancelled interview cannot be cancelled or moved again
- ✓ the slot picker queues the candidate confirmation rather than pretending to send it
- ✓ every booking leaves a trail and an event the automations can react to

### write · one hire, end to end

`tests/write/lifecycle.test.ts`

- ✓ a requisition becomes a person on the payroll, and every handover holds

### write · assessment and sales pitch

`tests/write/loop.test.ts`

- ✓ the behavioural test is refused while there is no provider to send it with
- ✓ a result is recorded from the report, never invented
- ✓ a partial report is refused rather than averaged
- ✓ the brief goes out with the project the requisition names
- ✓ a requisition that does not sell has no pitch to send
- ✓ a pitch is scored against the project’s own criteria, one score each
- ✓ scoring the pitch opens the final interview on a selling requisition
- ✓ a pitch cannot be scored before it has been run
- ✓ a hiring manager may not send a brief or score a pitch
- ✓ the pitch leaves a trail, an event and a use on the project

### write · the manpower plan

`tests/write/manpower.test.ts`

- ✓ a new seat takes the next code in its department
- ✓ a code belongs to one seat for ever
- ✓ approved headcount cannot fall below the people already in the seat
- ✓ a reporting line never runs in a circle
- ✓ retiring a seat keeps its code and moves what reported to it up a line
- ✓ a seat with somebody in it, or a live requisition on it, is not removed
- ✓ only an Admin changes the plan
- ✓ an imported department arrives as a chart, heads first
- ✓ a row whose manager is not in the sheet is reported, not guessed at
- ✓ importing into a department that exists adds to it rather than duplicating it
- ✓ only an Admin imports a department

### write · offers

`tests/write/offers.test.ts`

- ✓ drafting fills the letter, moves the application and asks Onboarding to check it
- ✓ a second offer on the same application is refused — revise the first
- ✓ the chain runs in order, and only the named approver may decide
- ✓ a big package brings Finance into the chain
- ✓ sending is refused until the chain closes and the letter is verified
- ✓ only Onboarding or an Admin verifies a letter
- ✓ a correction re-opens the letter and is kept with what it changed from
- ✓ sending opens the envelope, mints the candidate’s link and asks for four documents
- ✓ nobody signs until all four documents are in
- ✓ acceptance hires once and issues an employee number
- ✓ a decline needs one of the reasons Insights counts
- ✓ a sent letter is never edited — version two supersedes it
- ✓ an accepted offer cannot be revised
- ✓ a hiring manager may not draft, send or record an answer
- ✓ every step of the offer is on the record
- ✓ changing the terms clears the verification and is on the record
- ✓ a basic outside the band is refused, and only Onboarding may change it
- ✓ a correction to a merge field is recorded against the person who made it
- ✓ one letter template is the fallback at a time

### write · onboarding

`tests/write/onboarding.test.ts`

- ✓ the form is only submitted when the four things payroll needs are in it
- ✓ what the joiner typed never reaches the audit trail
- ✓ a document is verified by a person, and a rejection says what is wrong
- ✓ a reference is not done until it is rated
- ✓ a referee who will not answer is an outcome, not a gap
- ✓ one concern outweighs the rest
- ✓ the joining date moves on the joiner, the offer, the application and probation together
- ✓ a date that is not a date is refused before anybody is told
- ✓ the joiner file goes to the teams that receive it, with what is attached
- ✓ the file completes by itself once everything on it is true
- ✓ probation passes or fails, and a failure needs a reason
- ✓ a failed probation ends the employment and says why
- ✓ a hiring manager may look but not verify, notify or decide

### write · every page query, under every scope

`tests/write/queries.test.ts`

- ✓ the queries behind every page run for somebody whose access is everything
- ✓ the queries behind every page run for somebody whose access is their own
- ✓ the queries behind every page run for somebody whose access is a picked list
- ✓ the queries behind every page run for somebody whose access is a picked list and their own
- ✓ the queries behind every page run for somebody whose access is an empty picked list

### write · manpower → requisition → approval

`tests/write/requisitions.test.ts`

- ✓ a new requisition is a draft, and its seat is requested — not headcount
- ✓ an unbudgeted requisition is refused without a justification
- ✓ a band whose top is under its bottom is refused
- ✓ a hiring manager may not open a requisition
- ✓ submitting freezes the chain onto the record
- ✓ a draft cannot be submitted twice
- ✓ only the named approver — or an Admin on their behalf — may decide
- ✓ approving the last step opens the requisition and approves its seat
- ✓ sending it back needs a reason, and returns it to draft
- ✓ every step of the chain leaves an audit entry and a domain event
- ✓ the pipeline cannot change under people who are standing on it
- ✓ archiving says how many applications were still open on it
- ✓ the form’s blocks are written with it — routes, loop, bar, questions
- ✓ a ticked box reaches the command in the shape the browser sends it
- ✓ a requisition nobody is filling, with no loop, or with no bar, is refused
- ✓ the sales pitch stage needs a project, and switching it off clears it
- ✓ a stage somebody is standing on cannot be switched off underneath them
- ✓ a question written for one requisition is added, edited and removed

### write · the small writes a row makes

`tests/write/rows.test.ts`

- ✓ an action is its whole name first, and only then a name and an argument
- ✓ a requisition has exactly one lead, before and after the change
- ✓ a question moves, and the run of ordinals stays a run
- ✓ a step moves without colliding with the ordinal it is swapping into
- ✓ a publish channel is a toggle, and publishing to nowhere is refused
- ✓ only somebody who may change settings moves a chain about
- ✓ a team has one primary contact, and never none while it has people
- ✓ removing the only contact on a team asks first
- ✓ a stage SLA is stored as an override, and its own default is not
- ✓ a referee is marked as chased, but not recorded from the row
- ✓ removing a referee whose reference is in asks first
- ✓ a document is verified from the row, and can be sent back for checking
- ✓ an integration with nothing configured cannot be switched off

### write · My Hiring, and the scope underneath it

`tests/write/scope.test.ts`

- ✓ a hiring manager sees the requisitions they are named on, and no others
- ✓ My Hiring shows those requisitions and nothing from outside them
- ✓ the board, the candidate list and search all apply the same scope
- ✓ a count on the page is the same number as the rows behind it
- ✓ a requisition outside the scope cannot be reached by knowing its id
- ✓ an application on somebody else’s requisition is out of reach too
- ✓ the work a hiring manager actually does, they can do
- ✓ a participant sees only what they have been asked to do
- ✓ a picked list is exactly the list, unless their own is added to it
- ✓ an empty picked list shows nothing, rather than everything

### write · screening

`tests/write/screening.test.ts`

- ✓ the six questions are built from the requisition, not from thin air
- ✓ the link is a credential — the token is never stored
- ✓ a channel with no provider says so rather than claiming it sent
- ✓ answering walks the six and finishes with a verdict
- ✓ a weak answer costs the score and shows up in the summary
- ✓ the scoring rules are rules, not opinions
- ✓ the phone screen is refused while there is nothing to call with
- ✓ the recruiter can type the numbers in, and they reach the candidate record
- ✓ a salary that is obviously annual is refused
- ✓ the pay is read off the transcript, and refused when there is no number in it
- ✓ inviting twice reuses the screen in flight rather than starting a second
- ✓ a hiring manager may not screen; a coordinator may
- ✓ finishing the screen revokes the link and leaves a trail

### write · settings

`tests/write/settings.test.ts`

- ✓ the organisation record is validated before it is saved
- ✓ only an Admin changes the organisation
- ✓ a department cannot be removed while it has live requisitions
- ✓ changing a department head moves the live requisitions and leaves the closed ones
- ✓ an approval chain always keeps at least one step
- ✓ a step is added at the end, and its order stays 0,1,2 after a removal
- ✓ a named approver needs a name, and a condition needs a figure
- ✓ a stage cannot be switched off under people standing on it
- ✓ an SLA outside a working range is refused
- ✓ the candidate-facing wording is an Admin’s to change
- ✓ a choice question needs some choices, and retiring one keeps it
- ✓ a pitch project needs criteria, and retiring one leaves it on the record
- ✓ the brief needs somewhere to go
- ✓ an automation toggle is the switch, and it is on the record
- ✓ a notification team keeps its contacts, primary first
- ✓ access is an Admin’s, and nobody locks themselves out
- ✓ a reset sends somebody back to the start of the password flow

### write · the TA team

`tests/write/team.test.ts`

- ✓ a new recruiter gets a title, an address and their tint
- ✓ only the roles that own requisitions carry a target
- ✓ the sixth role the form offers is a role the database accepts
- ✓ two people cannot share an address
- ✓ a title with Senior in it is recorded as senior
- ✓ deactivating keeps the desk and closes the way in
- ✓ nobody deactivates themselves
- ✓ deleting a busy desk without an heir is refused
- ✓ deleting hands the live work over and leaves the closed work alone
- ✓ only an Admin deletes, and never themselves
- ✓ a restored profile comes back without taking the desk back
- ✓ editing a profile records what changed

### write · taking a file in

`tests/write/uploads.test.ts`

- ✓ a dropped CV is stored, read, and creates nobody
- ✓ an unscanned file says it is unscanned rather than saying nothing
- ✓ several CVs at once are all read, and the panel opens on the first
- ✓ a well with nothing in it refuses rather than reporting success
- ✓ a hiring manager cannot drop a CV on the product
- ✓ discarding a staged CV removes it, and refuses one that is somebody’s
- ✓ a staged résumé re-opens the form carrying its id
- ✓ creating the candidate makes the staged file theirs and keeps the reading
- ✓ a template is stored with the merge fields found in it
- ✓ a PDF is refused as a template, because its fields cannot be filled
- ✓ uploading again supersedes rather than replaces, and the version moves
- ✓ only somebody who manages templates may upload one
- ✓ a plan is read and previewed, and creates no seats
- ✓ importing the same block twice is refused by the file itself
- ✓ a file that is not a plan is refused before it is stored
- ✓ a photograph is your own to change, and somebody else’s is not
- ✓ a joiner’s document arrives as received, never as verified
