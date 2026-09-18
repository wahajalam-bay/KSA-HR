# Workflows and state machines

Every transition in this product is a state machine with a single owner. The
owner validates, authorizes (through its command), persists, appends history,
audits, updates whatever depends on it, and emits a domain event — all in one
transaction. Nothing half-happens.

This document is the list of them, and the rules each one refuses to break.

---

## 1 · The application pipeline

**Owner:** `lib/services/transitions.ts` · **Commands:** `app.advance`,
`app.moveTo`, `app.hold`, `app.rejectWith`

### The spine

Ten stages, in a fixed order. Nothing reorders them.

```
applied ┐
        ├─→ screen → assessment → iv1 → iv2 → pitch → ivf → offer → joined
sourced ┘
```

- **`applied` and `sourced` are alternative entries.** Somebody who applied did
  not come through sourcing and vice versa, so advancing out of either lands on
  the first real stage rather than on the other entry.
- **`applied`, `sourced`, `offer` and `joined` are fixed** — on every
  requisition there is.
- **`screen`, `assessment`, `iv1`, `iv2`, `pitch` and `ivf` are the
  recruiter's** to switch on, rename and give an SLA to when the requisition is
  opened. A stage a requisition does not run has **no row** in `job_stages` —
  that is what "off" means, and it is why a board can read the loop without also
  knowing which rows to ignore.
- Interview rounds are numbered by **where they fall in this loop**. Drop the
  middle one and what was the third becomes the second. A name somebody typed
  themselves is left exactly as typed.

### What a move does

1. Refuses if the application is closed, or if the target is not a stage this
   requisition runs.
2. Checks the **gate** if the target is the final interview (below).
3. Writes the new stage and resets the stage clock.
4. Appends a row to `application_stage_history` with the actor, the source
   (`advance`, `drag`, `sheet`, `automation`) and a sequence number.
5. Audits it, and emits `application.moved`.
6. Reaching `offer` and `joined` has consequences of its own — see below.

### The gate on the final interview

The final interview cannot be booked or moved to until:

- **On a manager-and-above requisition** — the behavioural questionnaire is back
  **and** every earlier scorecard is in.
- **On a requisition that runs a sales pitch** — the pitch has been scored.

`finalGate()` returns the individual checks, so the interface can say *which*
one is outstanding rather than just refusing. It is checked again in the command
regardless of what the form showed.

### Disqualification

Rejection is a **status, not a tenth column**. A disqualified application keeps
the stage it reached, which is what makes conversion arithmetic honest: the
denominator at each stage is everybody who ever reached it.

Reasons come from a fixed list so Insights can count them. `Withdrew — accepted
another offer` sets `withdrawn` rather than `rejected`, because the two mean
different things to a hiring manager reading a report.

---

## 2 · The requisition

**Owner:** `lib/services/requisitions.ts` · **Commands:** `job.create`,
`job.save`, `job.submit`, `job.approve`, `job.reject`, `job.archive`,
`job.reopen`

```
draft ──submit──→ pending_approval ──approve──→ open ──archive──→ closed
  ↑                      │                       │                  │
  └──────reject──────────┘                       └───on_hold────────┘
                                                        reopen ↑
```

**The rule this flow exists for:** *a new unplanned seat must not become
approved headcount the moment somebody types it.*

- Opening a requisition for a seat that does not exist creates that seat with
  `plan_state = 'pending'` and `approved = 0`. It shows on the plan as
  **requested**, so nobody raises it twice.
- It becomes approved headcount when the requisition clears its chain — and if
  the requisition is sent back, the seat goes with it.

Other rules:

- An unbudgeted requisition is refused without a written justification, because
  that line is what Finance and the GM read on the approval.
- The pipeline template cannot change under people standing in the loop.
- A stage somebody is standing on cannot be switched off underneath them.
- Closing a requisition says how many applications were still open on it.
- A closed requisition stays visible to whoever could already see it.

---

## 3 · Approval chains

**Owner:** `lib/services/approvals.ts` · **Subjects:** requisition, offer

A chain is **frozen onto the record when it is submitted**. Editing the flow in
Settings afterwards does not change a chain that is already running — the
approval somebody gave was for the chain that existed when they gave it.

- Steps run in order; only the named approver, or an Admin acting on their
  behalf, may decide one.
- A **conditional** step only appears when its condition holds. This is how
  Finance joins the chain on a large package and stays off a small one.
- A step marked **auto** is recorded automatically — the hiring manager's own
  step on their own requisition is the usual case, because they raised it.
- A rejection needs a reason and returns the subject to `draft`.
- Approving the last step is what opens the requisition or approves the offer.

---

## 4 · The screen

**Owner:** `lib/services/screening.ts` · **Domain:** `lib/domain/screening.ts`

Six knockout questions, scored by rules in the domain module. **Nothing is
generated by a model.**

```
                ┌─ chat ──→ invited → in_progress → completed
not started ────┤
                └─ phone ─→ scheduled → calling → completed
                                    ↘ no_answer → (retry, then SMS)
```

- **With no telephony provider, the phone screen is refused outright** — not
  scheduled. A call nobody can place is not a call that is queued, and a
  recruiter who believes it is stops chasing the candidate.
- The call opens with the recorded-line notice and asks for consent. A refusal
  is logged and the chat link is sent instead.
- No answer: one retry after two hours, and an SMS with a call-back link.
- Salary and notice captured on the screen are written to the candidate with
  their provenance (`recruiter`), because Insights' market analysis is built
  from them and a guess would poison it.

---

## 5 · The behavioural questionnaire

**Owner:** `lib/services/assessments.ts`

```
invited → in_progress → completed
```

- `invite()` refuses when no assessment provider is configured — or, when asked
  to, records the invitation and says plainly that nothing was sent.
- `recordResult()` requires **all six traits**. A missing trait is refused
  rather than guessed, because the final interview turns on this.
- The result can arrive by webhook or be typed from the provider's report; both
  go through the same service, and the row records which.

---

## 6 · The sales pitch

**Owner:** `lib/services/pitch.ts`

```
not_sent → sent → in_progress → completed
```

- The brief is filled from the project and the requisition and sent by WhatsApp
  and e-mail, a configurable number of hours ahead.
- What the sheet previews and what the service sends are **the same function**,
  so they cannot drift.
- Due date: the interview booked for the stage, or the stage's own SLA counted
  from the day they reached it.
- Scored by a person or by the configured model, and the row says which.

---

## 7 · Interviews

**Owner:** `lib/services/interviews.ts` · **Commands:** `ivw.create`,
`ivw.moveSave`, `ivw.cancel`, `book.confirm`

```
scheduled ──→ completed
    │  ↘ rescheduled (a new row, pointing back)
    └──→ cancelled
```

- Clash detection across the panel, aware of the Riyadh working week.
- Booking raises a scorecard for everybody on the panel, and invites anybody who
  cannot already sign in.
- Rescheduling moves the slot and the invitation; anybody taken off the panel
  stops owing a scorecard.
- **Cancelling asks first**, and says what it will do: the slot is released and
  the panel loses the invitation. *The application stays exactly where it is —
  cancelling an interview is not a rejection.*

---

## 8 · The offer

**Owner:** `lib/services/offers.ts` — the longest machine in the product.

```
draft → pending_approval → approved → sent → viewed → signed → accepted
   ↑          │                │                              ↘ declined
   └──reject──┘                └── verify / unverify              expired
   
  revise: a new version supersedes the old one; the old one never changes
```

The rules, in the order they bite:

1. **One live offer per application.** A second is refused — revise the first.
2. **The chain.** Frozen on submission; a large package brings Finance in.
3. **Verification.** Onboarding, or an Admin, confirms that every figure, date
   and name in the filled letter matches the approved offer. Changing a term or
   correcting a merge field **clears the verification**.
4. **Sending is refused** until the chain has closed *and* the letter is
   verified. Both, not either.
5. **A sent letter never changes.** The editor refuses to open on one and points
   at version two; the database refuses as well (`0001_integrity.sql`).
6. **Four documents** are collected on the envelope before the candidate can
   sign.
7. **Acceptance hires once.** It writes the start date onto the application,
   moves it to `joined`, and calls `ensureEmployee` — which is idempotent and
   issues the employee number `BYT-YYYY-NNNN` exactly once.
8. **A decline needs one of the reasons Insights counts**, plus what they said.

Every correction to a letter is kept with what it changed from, who changed it
and when.

---

## 9 · Onboarding and the joiner

**Owner:** `lib/services/onboarding.ts`, `lib/services/joiner.ts`

On acceptance: the employee record, the employee number, the offer documents
copied across, the probation clock started, three tasks raised (reference,
joining date, onboarding documents), the joiner form link minted, the welcome
e-mail queued, and the desk notified.

Then:

- **The joiner form** — details the new starter fills in. The Saudi IBAN is
  validated before it is saved.
- **Documents** — uploaded, then verified or sent back with a reason.
- **References** — referees named, then contacted, then recorded with a rating
  (thumbs up, thumbs down or a star) and what they said.
- **The joining notice** — fixing the date moves the joiner, the application and
  the probation clock together, in one transaction, and tells the back-office
  teams. **The signed offer is deliberately not among them:** the letter says
  what it says, and a date agreed afterwards is an operational fact about the
  joiner, not a correction to a document they already hold.
- **The joiner file** — sent to IT, HR and whoever else is configured, with
  what is on file today and a list of what is not.

---

## 10 · Probation

**Owner:** `lib/services/joiner.ts` · **Domain:** `lib/domain/probation.ts`

```
in_progress ──→ passed
            └─→ failed (with a reason from the list)
```

Three months by default, set in Settings. A sweep reminds the hiring manager a
fortnight before it is up. Confirming is what makes the hire count towards
quality of hire; not confirming records why, and that is what the analysis reads
back.

---

## 11 · The recruiter's tag

**Owner:** `lib/services/candidates.ts` · **Domain:** `lib/domain/claim.ts`

A recruiter puts their name on a candidate for a chosen length — a week for
somebody they are ringing this afternoon, a quarter for a passive candidate they
are nurturing. It rides along on every row, card and profile.

- It **lapses on its own**, so nobody sits on a name forever. The length is
  stored with the tag, so changing the default never silently expires one.
- Going over somebody else's tag is allowed but **never by accident**: the
  recruiter has to say so, it goes on the trail, and the holder is told.

---

## 12 · Taking a file in

**Owner:** `lib/services/files.ts`, with the commands in
`lib/commands/uploads.ts`

Every upload well in the interface is a command, so a file arriving is a write
like any other: checked, transacted, audited. Two rules run through all of them.

**Nothing is created on the way in.** A CV is stored and read, and the reading
is kept on the file row; a person looks at it and decides, and only then does a
candidate exist. A spreadsheet is read and previewed; a person confirms one
department at a time, and the file remembers which blocks it has already written
so a second press cannot create the seats twice. An upload that reached storage
and no further leaves a file row, an audit event, and nothing anybody has to
undo.

**A file belongs to exactly one record.** A CV dropped on Candidates is owned by
the organisation while it is staged, and becomes the candidate’s at the moment
they are confirmed — which is when the access rules that govern a CV start
applying to it. Attaching one that already belongs to somebody else is refused
rather than re-pointed, because a CV cannot be two people’s.

| Well | Kind | What it does, and does not do |
| --- | --- | --- |
| `cv.intake` | `cv` | Stores and reads each file, opens the review panel on the first; the rest wait in the files table, so closing the tab loses nothing |
| `cand.stageFile` | `cv` | Stores and scans it, then redraws the form carrying its id — the prototype held it in a browser variable, so a refresh lost it |
| `resume.upload` | `cv` | Supersedes the current résumé rather than replacing it: "what did their CV say when we hired them" is asked a year later |
| `emp.doc` | `onboarding_document` | Moves the checklist row to **received**. Verifying it is a second decision by a second person |
| `staff.photo` | `photo` | Your own, or the team manager’s — checked in the command, not by hiding the control |
| `otpl.upload` | `offer_template` | Finds the merge fields and keeps them on the row. A PDF is refused with the reason |
| `mp.importFile` | `import` | Reads the grid, refuses a file that is not a plan **before** storing it, and writes no seats |

An unscanned file is reported as unscanned. With no scanner configured the scan
state is `skipped`, never `clean`, `scanned_at` stays null, and every one of
these commands says so in the line it hands back.

---

## 13 · The manpower plan

**Owner:** `lib/services/manpower.ts`

- **Nothing is added to the plan directly.** A seat arrives with the requisition
  that raised it.
- A seat with a holder or a live requisition cannot be retired.
- Retiring a seat moves everything reporting to it up to its manager.
- The import plants a department's chart in two passes — the heads first, then
  everybody else, whose manager is by then a seat with an id. A row whose manager
  is a name nobody in the sheet has is **reported**, not silently hung off the
  top.
- A reporting line that would make a loop is refused.

---

## 14 · The desk

**Owner:** `lib/services/team.ts`

- Deactivating keeps the desk and closes the way in.
- **Deleting hands the live work over in the same transaction** — and leaves the
  closed work alone, because a closed application should still say who ran it.
- Deleting a busy desk without naming an heir is refused.
- Nobody deactivates or deletes themselves.

---

## 15 · Automations

**Owner:** `lib/services/automation.ts` — see
[the automation catalogue](06-automation-and-events.md).

Insert-then-act, on an idempotency key, so a worker that dies half-way does not
repeat the half it finished. Conditions are evaluated against the subject; the
eight actions are `send_message`, `notify`, `create_task`, `publish_job`,
`issue_employee_id`, `add_to_pool`, `digest` and `sweep`.

---

## What every one of these has in common

| | |
| --- | --- |
| **Validates** | and raises a `CommandError` with a sentence somebody can act on |
| **Authorizes** | in its command, before the input is parsed |
| **Persists** | in one transaction |
| **Appends history** | where the sequence matters |
| **Audits** | who, what, the entity, before, after, when, the reason, the request id |
| **Emits** | a domain event where something else should react |
| **Is idempotent** | wherever it can be driven twice |
