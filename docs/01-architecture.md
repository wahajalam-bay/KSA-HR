# Architecture

The Bayut KSA Talent Acquisition platform is one Next.js application on
PostgreSQL. There is no separate API service, no client-side store, and no
second place where a business rule lives. This document explains the shape and,
more usefully, *why* it is that shape — because the shape is what stops the
product drifting back into a prototype.

## The one rule everything else follows

**The browser is not the system of record.**

The prototype this replaces kept everything in `localStorage` and decided
permissions by hiding buttons. Both are fine for a demonstration and neither can
run a hiring desk. So:

- every read goes through a query that applies the viewer's scope at the root it
  reads from, so a list, a board, a count and a chart cannot disagree about what
  an account may see;
- every write goes through one door, is authorized on the server before its
  input is parsed, runs inside a transaction, and leaves an audit entry;
- anything that would corrupt the record if it happened twice is stopped by the
  database as well as by the application.

## The stack

| | |
| --- | --- |
| Runtime | Node 20+, Next.js 15 App Router, React 19 |
| Language | TypeScript, `strict` |
| Database | PostgreSQL 16 |
| Access | Drizzle ORM for the schema and simple reads; hand-written SQL where the query is the interesting part |
| Validation | Zod, at the edge of every command |
| Background | One worker process (`npm run worker`) |
| Tests | A small runner over the real database, plus Playwright for the visual comparison |

Server components and server actions, throughout. The only client components
are the ones that genuinely need a browser: the shell that owns the sheet stack
and the toast queue, the charts, and the few controls that need to feel
immediate.

## The directory

```
app/
  (app)/…              eleven views, two with a detail route under them
  actions/
    dispatch.ts        THE write door — every mutation in the product
    sheets.tsx         renders a panel on the server and hands back a tree
  api/
    upload/            multipart upload, scanned before it is readable
    files/[key]/       signed, authorized file reads
    webhooks/[p]/      provider callbacks: store, verify, act once
    search/            the command palette
components/
  app/                 the shell: sheet stack, toasts, confirmations
  <feature>/           the server-rendered pieces of each page
  ui/                  primitives — Field, Btn, Li, Card, Chip, Icon…
db/
  schema/              the tables, in five files by subject area
  migrations/          plain SQL, applied in order, never edited after release
  seed/                the dataset the product ships with
lib/
  authz.ts             capabilities and scope. The only place either is decided
  auth/session.ts      who is asking
  commands/            one file per subject: the thin write doors
  services/            the state machines. Where the business rules live
  queries/             the reads, scope applied at the root
  domain/              pure functions: the arithmetic, with no database in sight
  providers/           the adapters for everything outside the building
  sheets/              the panels, as server components
workers/main.ts        the outbox, the queue, the retries, the sweeps
tests/                 the suites, the harnesses and the visual comparison
docs/                  this
```

## Reading: pages and queries

A page is a server component. It calls one or more functions in `lib/queries/`,
each of which takes the `Viewer` and applies that viewer's scope in SQL —
usually by way of `jobScopeSql(viewer)`, which emits the predicate that decides
which requisitions this account may see.

Scope is applied **at the root**, not filtered afterwards. A count that is
computed over everything and then filtered in JavaScript is a count that leaks;
the same subquery that limits the rows limits the total.

## Writing: one door, three pieces

Every mutation in the product is a **command**, and the only way to invoke one
is the `dispatch` server action. It does five things, in this order:

1. **Establishes who is asking** — `requireViewer()`, from the session cookie.
2. **Refuses them if they may not** — `require_(viewer, command.capability)`.
   Before the input is even parsed, because an account that may not do a thing
   should not have its input validated for it.
3. **Validates the input** — the command's Zod schema.
4. **Opens a transaction** — everything the command does either happens or
   does not.
5. **Turns a refusal into a sentence** — a `CommandError` becomes a message a
   person can act on, not a stack trace.

Behind that door, each flow is three files:

```
lib/services/<flow>.ts     the state machine. Owns the rules, raises
                           CommandError, writes the audit entry, emits the
                           domain event. Never checks a capability.
lib/commands/<flow>.ts     thin. Capability, field parsing, requireJob or
                           requireApplication for scope, and the toast.
tests/write/<flow>.test.ts the real command, the real database, inside a
                           transaction that is rolled back at the end.
```

The split matters. A service never asks *who* — it asks *is this legal* — so
the same transition can be driven by a recruiter, by a webhook, by the worker
and by a test without four copies of the rule. The command is where "who" is
answered, once.

A command that is not imported in `lib/commands/index.ts` is unreachable. That
is deliberate: the registry is the inventory.

## Panels

A sheet — the right-hand panel on a desktop, the bottom sheet on a phone — is
also a server component. `renderSheet` looks it up, calls it with the viewer,
and hands the React tree back to the shell. That means a panel reads the
database exactly as a page does and is subject to the same authorization: an
account that may not open a requisition cannot reach its editor by firing the
action by hand either.

Shared form blocks live in `lib/sheets/blocks.tsx`. The new-requisition sheet
and the requisition editor are the same questions in the same order because they
are literally the same components, so the two cannot drift.

## Delegated events

The interface is one delegated listener over `data-act` attributes. A click on
anything carrying one is resolved by `classify()` in `lib/nav.ts` into one of
four kinds:

| Kind | What happens |
| --- | --- |
| `nav` | A route: the client navigates |
| `local` | The client handles it itself: close a sheet, answer a confirmation |
| `sheet` | `renderSheet` on the server, pushed onto the sheet stack |
| `command` | `dispatch` on the server, then the toast, the refresh, the navigation |

This is why the product has almost no bespoke event wiring, and why adding a
button is adding a `data-act`.

It is also why a typo is silent — a button whose action nobody registered does
nothing at all, and says nothing. `tests/sheets/wiring.test.ts` is the compiler
for that string: it draws every panel, collects every action on every control,
and fails if one does not resolve. A name that is both a command and a panel is
failed as well, because the classifier would open the panel where the author
meant to run the command.

## Charts

Every chart in the product comes from one module, `components/charts/index.tsx`,
and every mark on one — a bar, a slice, a cell, a funnel row, a legend entry —
is interactive through the same delegated listener as everything else. A chart
does not carry handlers, because it could not: it is a client component and the
page that draws it is a server one, and a function cannot cross that boundary.

So the contract is **data**, in `lib/charts/interaction.ts`. A caller passes
`picks`, one per mark, and a mark becomes:

| It carries | And so |
| --- | --- |
| `data-tip` | the product's own tooltip draws it — on hover *and* on keyboard focus |
| `data-act` / `data-v` | the same dispatcher that runs every button follows it |
| `tabindex`, `role`, `aria-label` | it is a button, whatever element it happens to be |
| `.cmk`, `.pickable`, `.on` | the stylesheet gives it hover, focus and selected states |

Three consequences are worth saying out loud.

**A drill-down cannot bypass access control**, because analytics is not doing
the fetching. A mark navigates to an ordinary page, and that page applies the
viewer's scope exactly as it always did. A hiring manager clicking a bar gets
their own requisitions because the requisitions page gives them their own
requisitions — not because the chart remembered to ask.

**Every drill has its URL**, so Back works, a filtered view can be sent to a
colleague, and the page it lands on says what filtered it (`DrillChips`).

**A mark that cannot land anywhere honest does not pretend to.** A band of
interview scores, a hire's previous salary, a probation outcome — the product
keeps no list of those, so those marks explain themselves in a tooltip and stay
out of the tab order. Inventing a nearby destination would be worse than none.

### The number on the chart and the number on the list are the same number

They come from different queries by necessity: one aggregates, the other lists,
and they are written months apart in different files. `tests/charts/` takes each
card, reads the marks it actually drew, follows each mark's URL, runs the query
that URL asks for, and insists the count comes back identical — under an admin
account and under a scoped one, because `jobScopeSql` collapses to `true` for
every desk account and a leak is therefore invisible to everyone who builds the
product.

Where a mark is not itself a count — a median, a rate — the pick states how
many records its drill will find, so the suite can hold it to the same standard
instead of skipping it.

This is also why the filter vocabulary in `lib/queries/candidates.ts` is as
precise as it is. A period is carried as dates where the report compares by day
and as instants where it compares by the clock; `win` says whether the period is
about the application arriving, closing, being open, or being anything the
period may talk about. Off by one boundary is a list that disagrees with the bar
it came from, quietly, and only sometimes.

### Ask AI draws, it does not hand out records

A report on the Ask AI tab is assembled from whatever was typed — any metric
against any dimension — so there is no query-and-destination pair to check. Its
marks explain themselves and link to nothing. The figures are already inside the
account's access, because the resolver reads the same scoped dataset every other
report does; this stops a second, unchecked way in being opened on top of it.
`tests/charts/ask.test.ts` holds that line.

## Confirmations

A command that is about to do something hard to undo returns
`confirm: { title, body, yes, no, danger }` and **does nothing**. The client
shows the question and, on yes, fires the same action again with
`confirmed = '1'`. The check is in the command, so a confirmation cannot be
skipped by firing the action directly.

## The shape of an action

`data-act` carries a name and, after a colon, whatever context the row cannot
put in `data-v` — `apf.move:flow_a:up` is this step, in that chain, upwards.
`splitAction` in `lib/nav.ts` resolves the whole string first and splits only if
nothing answers to it, so `drawer.open:tab` keeps meaning one thing. The client
sends both halves; `dispatch` and `renderSheet` each try the whole name and then
the base, and the remainder reaches a command as `input.arg` and a panel as
`ctx.arg`. Thirty-seven controls in the product use the colon form.

## Files

Every upload well in the interface posts to the command dispatcher like a
button does — `cv.intake`, `cand.stageFile`, `mp.importFile`, `otpl.upload`,
`emp.doc`, `staff.photo` and `resume.upload`, all in `lib/commands/uploads.ts`.
An upload that creates or changes a record is a write, and there is one door for
writes. `/api/upload` is the second entry point, for a body too large to want in
a server action (a call recording, a bulk load from a script); it creates
nothing on its own.

Both go through `lib/services/files.ts`, which sniffs the magic bytes rather
than trusting the declared type, enforces a per-kind MIME allow-list and size
limit, stores through the storage adapter (local or S3), and records the file.
A file is not readable until it has been scanned; with no scanner configured its
state is `skipped`, **never** `clean`, and every command that takes a file says
so in the line it hands back. Reads go through `/api/files/[key]`, which
authorizes by the file's owner type and records the access.

A file belongs to exactly one record. A CV dropped on Candidates is stored under
the organisation while a person looks at the reading, and becomes the
candidate's the moment they confirm it — attaching one that already belongs to
somebody else is refused rather than re-pointed.

## Reading a document without a library

A `.docx` and an `.xlsx` are zips of XML, and both are read in `lib/domain/`
(`zip.ts`, `docx.ts`, `sheet.ts`) rather than through a document library the
product would otherwise carry for two screens: a CV somebody exported from Word,
and the manpower plan a department head keeps. The spreadsheet reader reads the
styles, because a cell holding `45352` is either a headcount or a date and only
its number format says which. ZIP64, encryption and the old binary `.xls` are
refused by name — see [known limitations](10-known-limitations.md).

## Outside systems

Everything external is an adapter behind a contract, and an adapter returns
exactly one of `notConfigured`, `failed` or `sent`. Messages are written to an
outbox: `queued` when there is a provider, `not_configured` when there is not,
with the missing settings named in the row. The worker drains the outbox with
`FOR UPDATE SKIP LOCKED`, so two workers never send the same message twice.

See [the integration matrix](05-integration-matrix.md).

## Background work

One worker process. It drains the outbox, places scheduled calls, dispatches
pending domain events to the automation rules, retries failed runs, re-scans
files whose scan was skipped, and runs the daily and weekly sweeps. Every piece
is idempotent, so running two workers, or running one twice, changes nothing.

## Time

Riyadh is UTC+3 and does not observe daylight saving, which removes a whole
class of bug. The working week is Sunday to Thursday, and the scheduling
surfaces know it.

A request can take its "now" from a cookie when `ALLOW_TEST_CLOCK` is set —
this is what lets the visual comparison hold the product still while it
photographs it. It is refused outright in production and is never used for
session expiry.

## What is deliberately *not* here

- **No client-side store.** The server renders what is true.
- **No ORM-generated API.** A query is written where it is read.
- **No feature flags.** A capability is the switch.
- **No soft "admin" boolean.** Capabilities and scope, both server-side.
- **No mocking framework in the tests.** An in-memory double would not have the
  append-only trigger or the unique index — which are exactly the things worth
  testing.

## Where to look when something is wrong

| Symptom | Look at |
| --- | --- |
| An action is refused | `lib/authz.ts` — capability, then scope |
| A number disagrees with another number | `lib/queries/` — one of them is not applying scope at the root |
| A write did half of what it should | The service. Everything should be in one transaction |
| A message says it was sent and was not | It cannot: check the outbox row's `status` and `status_detail` |
| A panel will not draw | `tests/sheets/render.test.ts` draws every one of them |
| A button does nothing | `tests/sheets/wiring.test.ts` — its action resolves to nothing |
| A figure on a chart looks wrong | `lib/domain/`, and `tests/unit/domain.test.ts` beside it |
| A control cannot be reached by keyboard | `tests/sheets/accessibility.test.ts` |
| Something happened twice | The idempotency key on the run, or the unique index |

## The test suites, and what each is for

| Suite | What it would catch |
| --- | --- |
| `tests/unit/domain.test.ts` | An SLA that bands wrong, a salary written as "18k" read as no answer, a probation clock that lands in the wrong month |
| `tests/write/*.test.ts` | A state machine that skips a rule, a write that does half of itself, a refusal that does not refuse |
| `tests/write/scope.test.ts` | A query that shows an account a requisition it may not see |
| `tests/write/integrations.test.ts` | A message reported as sent when nothing can send it |
| `tests/sheets/render.test.ts` | A panel whose query has drifted from the schema |
| `tests/sheets/wiring.test.ts` | A button wired to nothing, or to the panel it lives in |
| `tests/sheets/accessibility.test.ts` | A control nothing announces, or nothing can tab to |
| `tests/charts/*.test.ts` | A chart whose drill-down finds a different number from the one it drew, or leaks past a scope, or claims a destination it has no honest answer for |
| `tests/visual/interact.ts` | A mark that cannot be reached by keyboard, a tooltip that falls off the screen, a chart that spills sideways on a phone |
| `tests/visual/compare.ts` | A pixel that moved
