# Bayut KSA — Talent Acquisition

The hiring platform for Bayut's Saudi desk: requisitions, candidates, the
interview loop, offers, onboarding, the manpower plan and the analysis on top of
all of it. One Next.js application on PostgreSQL.

```bash
npm ci
cp .env.example .env.local        # fill in DATABASE_URL and the two secrets
npm run db:migrate && npm run db:seed && npm run db:verify
npm run dev                       # http://localhost:3400
npm run worker                    # in another process
```

## The three things worth knowing before you change anything

**1. The browser is not the system of record.** Every read applies the viewer's
scope in SQL at the root it reads from. Every write goes through one server
action, is authorized before its input is parsed, runs in a transaction, and
leaves an audit entry. Hiding a button is a courtesy, not a control.

**2. A business rule lives in one place.** The state machine is in
`lib/services/` and never asks *who* is calling; the command in `lib/commands/`
answers that, once. Which is why the same transition can be driven by a
recruiter, a webhook, the worker and a test without four copies of the rule.

**3. Nothing fakes success.** A message with no provider is `not_configured`,
with the missing settings named on the row. A file with no scanner is
`skipped`, never `clean`. A phone screen with no telephony is refused, not
scheduled. An assessment result comes from a person or a provider, never from
the product.

## The commands you will actually use

| | |
| --- | --- |
| `npm run dev` | Development server on 3400 |
| `npm test` | Every suite, against the real database, each test rolled back |
| `npm test scope` | Only the suites whose name matches |
| `npm run typecheck` | Must be clean |
| `npm run worker -- --once` | One pass, and a printout of every provider's state |
| `npm run docs` | Regenerate the documents that are generated from the code |
| `npm run visual:compare` | Measure the interface against the prototype |
| `npm run db:status` | What has migrated, and whether any migration file has changed |

## Where things are

```
app/          the pages, the one write door (actions/dispatch.ts), the API routes
components/   the shell, the server-rendered pieces of each page, the primitives
db/           the schema, the migrations, the seed
lib/          authz · commands · services · queries · domain · providers · sheets
workers/      the outbox, the event queue, the retries, the sweeps
tests/        unit · write · sheets · visual
docs/         fourteen documents; start with docs/README.md
```

## The documentation

[`docs/README.md`](docs/README.md) indexes all fourteen. Eight of them are
generated from the code, the live schema and the last test run by
`npm run docs`, so a matrix that disagrees with the product is a bug rather than
a stale file.

Start with [the architecture](docs/01-architecture.md); if you are about to
change a rule, read [the state machines](docs/04-workflows-and-state-machines.md)
first.
