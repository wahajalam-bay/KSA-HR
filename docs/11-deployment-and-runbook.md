# Deployment and runbook

Two processes and a database. That is the whole deployment.

| Process | What it is | How it is run |
| --- | --- | --- |
| **web** | The Next.js application — pages, server actions, the API routes | `npm run start` (port from `APP_PORT`, default 3400) |
| **worker** | The outbox, the event queue, retries, re-scans and the sweeps | `npm run worker` |
| **db** | PostgreSQL 16 | Managed, or your own |

The web process is stateless: scale it horizontally behind a load balancer, with
sticky sessions **not** required. The worker claims work with
`FOR UPDATE SKIP LOCKED`, so running more than one is safe — at this size one is
enough.

---

## Getting it running the first time

```bash
git clone <repo> && cd bayut-ta
npm ci

cp .env.example .env.local
# Fill in, at minimum:
#   DATABASE_URL
#   SESSION_SECRET        32+ random bytes, base64
#   FILE_SIGNING_SECRET   32+ random bytes, base64
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

npm run db:migrate     # apply every migration, in order, in a transaction each
npm run db:seed        # the dataset the product ships with
npm run db:verify      # asserts the invariants hold in the data that was seeded

npm run build
npm run start          # and, in another process:
npm run worker
```

On Windows, `scripts/pg-init.ps1` creates a local cluster on port 55441 with the
right database, role and settings; `scripts/pg-start.ps1` starts it.

---

## Every command

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on 3400 |
| `npm run build` / `npm run start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit`. Must be clean |
| `npm test` | Every suite, against the real database, each test rolled back |
| `npm test <filter>` | Only the suites whose name matches |
| `npm run db:migrate` | Apply outstanding migrations |
| `npm run db:status` | What has run, what has not, and whether any file has changed since it ran |
| `npm run db:reset` | Drop the public schema and re-apply. **Development only** |
| `npm run db:seed` | Load the shipped dataset |
| `npm run db:verify` | Assert the invariants hold |
| `npm run worker` | Run the worker continuously |
| `npm run worker -- --once` | One pass, then exit — and print every provider's configured state |
| `npm run recompute` | Recompute derived figures (fit scores, counters) |
| `npm run docs` | Regenerate the documents that are generated from the code |
| `npm run visual:baseline` | Photograph the prototype — the acceptance reference |
| `npm run visual:compare` | Photograph production and measure it against that baseline |

---

## Migrations

Plain SQL in `db/migrations`, applied once each, in filename order, inside a
transaction, and recorded in `schema_migrations` with the **checksum of the file
that was applied**.

Editing a migration that has already run is **refused**, not silently ignored: a
schema that does not match its ledger is a deployment nobody can reason about.
To change something that has shipped, add a new migration.

```bash
npm run db:status     # before deploying, always
npm run db:migrate    # then
```

Migrations are written to be safe to run while the previous version of the
application is still serving: add columns nullable, backfill, then tighten in a
later migration.

---

## Deploying a new version

1. `npm run typecheck && npm test` — both clean.
2. `npm run db:status` on the target — know what is outstanding.
3. `npm run build`.
4. `npm run db:migrate`.
5. Restart **web**.
6. Restart **worker**.

The worker is restarted after the web process because a worker running the new
code against the old schema is the one ordering that can misbehave.

Nothing in the product requires downtime for a normal release. A migration that
rewrites a large table is the exception, and should be split so that it does
not.

---

## Health

| Check | What it tells you |
| --- | --- |
| `GET /sign-in` returns 200 | The web process is up and can reach the database |
| `npm run worker -- --once` | The worker can reach the database, and what every provider's configured state is |
| `SELECT count(*) FROM messages WHERE status = 'queued' AND queued_at < now() - interval '15 minutes'` | The outbox is draining. A growing number means the worker is not running, or a provider is failing |
| `SELECT count(*) FROM automation_runs WHERE state = 'failed' AND at > now() - interval '1 day'` | Rules are running cleanly |
| `SELECT count(*) FROM files WHERE scan_state = 'pending'` | The scanner is keeping up |

Logs are structured. `LOG_FORMAT=json` in production; `LOG_LEVEL=info` unless
you are chasing something.

---

## Speed

`npm run dev` is for changing the product. `npm run serve` is for using it: it
builds and serves, and it is several times faster because React, the bundler
and the framework all stop doing the work that only a person editing the code
needs. A development server also recompiles on every save, and every request
during that recompile waits — so an application that is being edited while it
is being used will feel slow however fast it is.

```bash
npm run serve      # build and serve, for using the tool
npm run dev        # for changing it
```

### What it actually costs

Measured on the seeded dataset, against a production build:

| | |
| --- | --- |
| Every page's database reads, added together | **154ms** |
| Server think time, per page | 13–51ms |
| First load of a page | 52–214ms |
| A click, once the destination has been prefetched | **~130ms** |
| A click to a page nobody has hovered | 400–900ms |

The database has never been the constraint. Almost all of the time a click
takes is the page coming back and the browser rebuilding the tree, which is why
the work went into fetching before the click rather than into the queries.

Three things carry that:

- **Resting the pointer on something starts fetching it.** Ninety milliseconds
  of sustained hover — or a keyboard focus — is treated as intent, and the page
  is on its way before the press lands. It is capped and de-duplicated so that
  sweeping a pointer across a chart full of marks does not fire forty requests.
- **The loading screen waits a quarter of a second before appearing.** Most
  pages arrive before that, so it is never seen; a genuinely slow one still
  says it is working. A spinner that flashes for a tenth of a second makes a
  fast product feel slow.
- **Charts measure their width before the browser paints, not after.** They
  cannot know how wide they are until they are in the page, so each is drawn
  once at a guess and again at the truth; doing the second draw in a layout
  effect means the page paints once instead of twitching a frame later.

### Measuring it again

```bash
npm run perf           # every route: server time, paint, payload, DOM nodes
npm run perf:cold      # the first visit to each route, compile included
npm run perf:queries   # the data layer alone, with a statement count
npx tsx tests/perf/clicks.ts            # press-to-content, with hover
npx tsx tests/perf/clicks.ts --nohover  # and without, which is the worst case
```

`perf:queries` needs no server. The rest drive whatever is on port 3400, so
say which build you are measuring — the two are not comparable.

> Turbopack was tried and is **not** used: `npm run dev:turbo` measured 1743ms
> per first route visit against webpack's 124ms, because it compiles each route
> on demand where webpack warms them at boot. It is left in place so the next
> person does not have to find that out again.

### If the port is stuck

`next dev` and `next start` both spawn a child that holds the socket, so
killing the npm wrapper can leave a server listening. A second one then fails
to bind and the old one keeps answering — which means anything measured
afterwards is measuring the wrong build.

```bash
powershell -File scripts/port.ps1
```

## When something is wrong

### Nothing is being sent

1. `npm run worker -- --once` — it prints every provider's state.
2. If a provider says **not configured**, that is the answer: the outbox rows
   will say the same thing, with the exact settings named.
3. If it says configured, look at `messages.status_detail` and
   `messages.failure_reason` on the stuck rows.

### An automation is not firing

1. Is the rule enabled? Settings → Automations.
2. Did the event happen? `SELECT * FROM domain_events ORDER BY at DESC LIMIT 20`.
3. Did the rule run and skip? `automation_runs.skipped_reason` says why —
   usually a condition that did not hold.
4. Did it fail? `automation_runs.error`, and it will be retried.

### A candidate panel will not open

`npx tsx --conditions=react-server tests/run.ts sheets` draws every panel in the
product against the real database. If a query has drifted from the schema, that
suite names it.

### The audit trail looks wrong

It cannot have been edited — a trigger refuses `UPDATE` and `DELETE` on
`audit_events`. If an entry is missing, the write that should have made one did
not, which is a bug in the service rather than in the trail.

### Somebody cannot see something they should

`lib/authz.ts`, in this order:

1. Do they hold the capability? (`docs/03-permissions-matrix.md`)
2. Does their scope include that requisition? (`accounts.scope_kind`,
   `scope_job_ids`, `scope_own`)

Hiding a button is never the answer, and changing one will not help.

---

## Configuration in production

- `NODE_ENV=production`, which also refuses the test clock outright.
- `DATABASE_SSL=true` against a managed database.
- `STORAGE_DRIVER=s3` with a bucket that is **not** public; the product signs
  its own URLs and authorizes every read.
- `MALWARE_SCANNER=clamav` with a scanner reachable from the worker. Without
  one, every upload is `skipped` and the product says so.
- `LOG_FORMAT=json`.
- `ALLOW_TEST_CLOCK` unset.

See [the environment reference](12-environment-variables.md).

---

## Backups

See [backup and restore](13-backup-and-restore.md). The short version: the
database and the file store are one unit, and a backup of either without the
other is not a backup.

## After a deployment

Four checks, in this order, and none of them alone is enough:

| Command | What it proves | Needs |
| --- | --- | --- |
| `npm run typecheck` | the code compiles | — |
| `npm test` | every rule, against the real database in rolled-back transactions | the database |
| `npm run e2e` | one hire end to end, from requested seat to confirmed probation | the database |
| `npm run walk` | every route loads for every kind of account, with nothing on it that should not be | the app up |
| `npm run visual:compare` | every route still matches the prototype at three widths in both themes | `npm run dev` up (not `npm start` — see [known limitations](10-known-limitations.md)), ~40 min |
| `npm run db:verify` | every database invariant holds over the live data | the database |
| `npm run worker -- --once` | each provider reports its real configured state | — |

`npm run accounts` prints the sign-in addresses the harnesses use. Never run
`npm run build` while a dev server is up: they share `.next`, and the build
reports success and then fails to find a chunk at runtime.
