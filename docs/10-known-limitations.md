# Known limitations

Everything here is deliberate, and each entry says what the product does
*instead*. There is no category of "not built yet" on this list — a feature the
prototype had that is missing here would be a bug, and the
[parity matrix](08-migration-parity-matrix.md) is the inventory that proves it
is not.

---

## 1 · Things an external provider has to do

These are the only genuine functional limits in the product. In each case the
adapter, the contract, the storage and the state machine are all present and
tested; what is absent is a supplier account. Configure one and the behaviour
turns on with no code change.

| Capability | What it needs | Without it |
| --- | --- | --- |
| **Placing a phone screen** | A telephony provider that can dial, play speech and return a transcript | **Refused outright**, with the missing setting named, and the chat screen offered instead. It is not scheduled, because a call nobody can place is not a call that is queued |
| **Sending any message** | Email, WhatsApp or SMS credentials | Written to the outbox as `not_configured`, with the exact settings missing recorded on the row. The desk sees this on the thread and knows to chase another way |
| **An e-signature envelope** | DocuSign or Dropbox Sign | The letter is generated and can be sent as a document; the signature is recorded by hand through `offer.recordSigned`, which is the same state machine the webhook drives |
| **Calendar invitations** | Google or Microsoft Graph | The interview is booked, the panel is told through the outbox, and no calendar event is created. Free/busy is not consulted; clash detection still runs against interviews this product knows about |
| **A behavioural questionnaire** | An assessment provider | The invitation is recorded and says plainly that nothing was sent. The result is typed from the provider's report through the same service the webhook uses |
| **Publishing to LinkedIn** | A Talent Solutions integration | The channel row stays `not_posted` and says why |
| **Pushing a joiner to the HRIS** | The HRIS API | The joiner file goes to the back-office teams as a message instead, which is what the business process actually depends on |
| **Malware scanning** | ClamAV, or another scanner | Every uploaded file is stored with `scan_state = 'skipped'`. **Never `clean`.** The product does not pretend a file was scanned |
| **Anything a model reads** | An AI provider | CV parsing falls back to the deterministic parser in `lib/services/cv.ts`, which is rules-based, reports per-field provenance and says what it could not read. Transcript analysis and the interviewer review are simply not produced — no summary is invented |

**The rule behind all of these:** the product never reports success it did not
have. That is worth more than a green tick, because a recruiter who believes a
message went out stops chasing the candidate.

---

## 2 · Things the prototype did that a system of record must not

These are not missing. They are refused on purpose, and the product does the
honest thing instead.

| The prototype | Here | Why |
| --- | --- | --- |
| Generated an assessment result | Typed from a report, or arrives by webhook | The product has no opinion about a person it has never met |
| Scored a sales pitch by itself | A person, or the configured model, and the row says which | Same |
| Marked a file "clean" | `skipped` until a scanner exists | Pretending a file was scanned is worse than saying it was not |
| Added a seat to the plan directly | A seat arrives with the requisition that raised it | Headcount nobody approved is not headcount |
| Edited an offer letter after sending | Refused; version two supersedes it | The candidate holds a document |
| Kept business data in `localStorage` | PostgreSQL | The browser is not the system of record |
| Decided permissions by hiding buttons | Capability, then scope, on the server | Hiding a button is a courtesy, not a control |

---

## 3 · Data the prototype could hold and a database cannot

The seed data comes from the prototype. Three shapes in it are impossible to
store faithfully, and the seeder corrects them and says how many it corrected.

| | |
| --- | --- |
| **Closes stamped before the last stage hop** | 89 of the prototype's 959 closed applications carry a `closedAt` earlier than their last stage change — one by seven months. The prototype dropped the resulting negative dwell and drew the close wherever its date fell. Production cannot store a record that closed before it last moved, so the seeder moves the close onto the last hop. Two screens show the difference, and both are recorded in `KNOWN_DIFFERENCES` |
| **Candidates with neither e-mail nor phone** | Refused. A candidate nobody can reach cannot be de-duplicated, which is the whole point of the identity key |
| **Two people with the same normalised e-mail** | The second is refused unless somebody deliberately says it is a different person — and that decision goes on the trail |

---

## 4 · Visual parity

The prototype is the visual acceptance reference, photographed at three widths
in two themes. Almost every route is inside two per cent of it. Where a route is
not, it is because production shows something real that the prototype faked, and
the reason is recorded in `tests/visual/config.ts`:

| Route | Why it differs |
| --- | --- |
| `sign-in` | Production adds single sign-on and drops the prototype's list of demo accounts |
| `settings-integrations` | Production reports each provider as configured or not; the prototype showed a fixed list as connected |
| `settings-data` | Production prints the real collection sizes |
| `settings-audit` | Production shows real audit entries — including the ones the test run just wrote |
| `settings-automations` | Each rule prints the event the engine actually raises (`requisition.approved`, not the prototype's `job.opened`), and the longer name wraps a line further at 900 and below |
| `job-activity`, `team-profile` | The close-date correction above |

The prototype has **no doctype**, so it renders in quirks mode, where a line box
containing no direct text of the block ignores the strut. That behaviour is
reproduced deliberately in `app/styles/04-parity.css`; it is not a bug, and
removing it moves every activity feed in the product.

---

## 5 · Scale

The product is built for one company's talent-acquisition desk — tens of
recruiters, hundreds of live requisitions, hundreds of thousands of candidates.
Within that:

- Reads are indexed for the access patterns the pages actually use.
- The board and the candidate list page rather than loading everything.
- The worker is single-process and claims work with `FOR UPDATE SKIP LOCKED`,
  so a second worker is safe but is not needed at this size.

Beyond that shape — millions of candidates, or several companies in one
database — the things to revisit are the full-text search (currently prefix and
trigram matching, not a dedicated index), the audit table's retention, and
partitioning `messages`.

---

## 6 · Browser support

Modern evergreen browsers. The interface uses container queries, `:has()`,
CSS nesting and view transitions where they help. There is no polyfill layer
and no support for Internet Explorer.

---

## 7 · Accessibility

Every control reachable by keyboard, every sheet with an accessible name, focus
trapped in an open panel and returned when it closes, the live region for
toasts, and the tables with proper headers. What has **not** been done is a
formal audit against WCAG 2.2 AA by somebody who does that for a living, and the
product should have one before it is used by anybody who depends on it.

---

## 8 · Localisation

The interface is English. Arabic appears in the data — names, the offer letter
template, the WhatsApp templates — and the letter templates support an Arabic
variant. What is not built is a right-to-left interface, and doing it properly
is more than translating strings: it is mirroring the layout, the charts, the
board and the timeline. The CSS is written with logical properties throughout,
so the groundwork is there.

## Documents the product cannot read or write

These are the edges of reading `.docx` and `.xlsx` without a document library.
Each is refused by name, with the reason, rather than read wrongly.

| What | What happens | Why |
| --- | --- | --- |
| An offer letter template as a PDF | Refused on upload: "a PDF is a finished rendering and its fields cannot be filled" | A template is filled in. Filling a PDF needs a PDF writer; the product has none, and storing one would mean discovering at send time that `{{candidate_name}}` is still `{{candidate_name}}`. DOCX, HTML, Markdown and plain text are accepted. |
| A plan in the old binary `.xls` | Refused: "save it as .xlsx or .csv" | The 1997 BIFF format is a different thing entirely from the zip-of-XML that `.xlsx` is. Excel saves either on request. |
| A zip using ZIP64 | Refused: "uses ZIP64, which cannot be read here" | ZIP64 exists for archives over 4 GB or with more than 65,535 entries. A résumé or a department plan is neither, and the upload limit refuses the file long before. |
| A password-protected document | Refused: "that file is password-protected" | There is no password to open it with. |
| A PDF with no text layer | Read as no text, and the intake panel says "this file has no text in it — type the name and email below" | The file is a photograph of a page. Reading it needs a vision model; with one configured the CV reader asks it, and with none the panel says so rather than showing an empty reading as a reading. |
| A `.doc` (the pre-2007 Word format) | Accepted and read as best it can be | The binary format holds its text in readable runs, so the parser finds most of a CV in one. Anything it misses shows as "not found" rather than as blank. |

## What a spreadsheet import will not decide for you

The import reads the file and shows a preview; a person confirms one department
at a time. Three things it reports rather than guesses:

- a column it does not recognise is listed, not ignored;
- a row it cannot use — no title, a headcount that is not a number, a date in a
  form it does not read — is listed with its row number and left out;
- a reporting line naming a seat the file does not contain is listed. The
  importer plants that row at the top of the chart and says so, rather than
  hanging it off an arbitrary manager.

A file already imported cannot be imported again: the file row remembers which
blocks have been written, so a double-click creates one department, not two.

## The visual comparison runs against a development server, on purpose

The prototype's captures are frozen at its dataset's "as of" instant. Production
has to be held to the same instant while it is photographed, or every window
boundary on every dashboard drifts by however long the run took — "last 90 days"
means a different 90 days in each of the two applications, and Scheduling,
Overview, Jobs, My hiring and four Insights tabs all report as regressions that
are nothing of the kind. Measured: a sweep against `npm start` scores 38 of 49;
the same code against `npm run dev` scores 49 of 49.

The instant is held by a cookie, and that override **refuses to work in
production** (`lib/clock.ts`): it needs `NODE_ENV !== 'production'` and
`ALLOW_TEST_CLOCK=1`. That fence is deliberate and is not going to be removed —
a clock a request can set is a clock an attacker can set, and every report in
the product is measured against it.

So: `npm run visual:compare` runs against `npm run dev`. The shell puts
`data-clock="held"` on the page when the override is in force, and the harness
refuses to photograph anything without it rather than producing a misleading
number.

What this means for what the sweep does and does not prove:

| | |
| --- | --- |
| It proves | the production **code** renders the interface to within 2% of the reference, at three widths in both themes |
| It does not prove | the production **build** does — different bundling, no development overlay |
| What covers that | `npm run build` (type-checked, no errors) and `npm run walk`, which loads every route as every role and can be pointed at either server with `WALK_BASE` |
