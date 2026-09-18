# Security notes

This product holds candidate personal data, salaries, national ID and iqama
numbers, bank details and the hiring decisions made about people. This is what
protects them, and where the sharp edges are.

---

## Identity

**Sessions.** A session is a row in the database with an opaque id in a cookie
that is `httpOnly`, `sameSite=lax` and `secure` in production. Revoking a
session is a delete — there is no self-contained token that keeps working after
somebody is removed. Sessions expire on an absolute TTL (`SESSION_TTL_HOURS`)
and on idleness (`SESSION_IDLE_MINUTES`).

**Passwords.** scrypt, with a per-password salt and parameters stored beside the
hash, so the cost can be raised later without invalidating anybody. Comparison
is constant-time. `PASSWORD_MIN_LENGTH` is a floor, not a policy — length beats
composition rules, and the product does not impose the rules that push people
towards `Password1!`.

**Brute force.** `LOGIN_MAX_ATTEMPTS` failures locks the account for
`LOGIN_LOCKOUT_MINUTES`. The lockout is per account and is recorded.

**Single sign-on.** `AUTH_MODE=oidc` or `both`. With no OIDC settings the SSO
button reports **not configured** rather than failing at the point somebody
presses it.

**Candidates and joiners never get an account.** They reach what they need
through a signed access link (see below), which is scoped to one thing and
expires.

---

## Authorization

Two questions, both answered on the server, in `lib/authz.ts`, and nowhere else.

1. **The capability** — may this person perform this kind of action at all?
   Checked by `require_` inside the dispatcher, **before the input is parsed**.
2. **The scope** — may they see this requisition? Applied *in SQL, at the root
   the data is read from*, by `jobScopeSql`, `requireJob` and
   `requireApplication`.

The full table is in [the permissions matrix](03-permissions-matrix.md).

**Hiding a button is not a control.** Nothing in this product depends on the
interface not offering something. Every panel is rendered on the server under
the viewer's scope, so an account that may not open a requisition cannot reach
its editor by firing the action by hand either — and the sheet-render suite
asserts exactly that.

Scope is applied at the root rather than filtered afterwards, because a count
computed over everything and then filtered in JavaScript is a count that leaks.

---

## The write path

Every mutation goes through one server action. There is no other door.

```
dispatch → requireViewer → require_(capability) → Zod parse → transaction → handler
```

- **CSRF** — Next.js server actions are POST-only with an origin check, and the
  session cookie is `sameSite=lax`. There is no GET that mutates anything.
- **Mass assignment** — impossible: every command declares a Zod schema and
  reads named fields. A field nobody asked for is ignored.
- **SQL injection** — every query is parameterised, including the hand-written
  ones; Drizzle's `sql` template binds its interpolations. `sql.raw` appears in
  exactly one place, in a script, over a list this code produced.
- **Optimistic locking** — `jobs.version` and `offers.version_lock` mean two
  people editing the same record cannot silently overwrite one another.

---

## Files

An upload is treated as hostile until proved otherwise.

1. **Type** — the **magic bytes are sniffed**; the declared content type is not
   trusted. There is a per-kind allow-list, so a CV can be a PDF or a Word
   document and nothing else.
2. **Size** — a per-kind limit, enforced while streaming rather than after.
3. **Scanning** — the file is stored but **is not readable** until it has been
   scanned. With no scanner configured its state is `skipped`, **never
   `clean`**. The product does not pretend a file was scanned.
4. **Reading** — through `/api/files/[key]`, which authorizes by the file's
   owner type (a candidate's CV is reachable by whoever may see that candidate)
   and records the access in `file_access_log`.
5. **Signed URLs** — short-lived, signed with `FILE_SIGNING_SECRET`. Rotating
   that secret invalidates every outstanding URL immediately, which is the point
   of it being separate from the session secret.
6. **Retention** — every file carries `retain_until`; the sweep deletes past it
   and records that it did.

The S3 bucket must **not** be public. The product signs its own URLs and
authorizes every read; a public bucket makes all of that decorative.

---

## Access links

A candidate booking an interview, completing a screen, reading an offer,
signing it, sitting an assessment, or a joiner filling in their form — each gets
a link rather than an account.

- The token is **returned once and never stored**. Only its SHA-256 is kept, so
  a database leak does not hand over working links.
- Each link is scoped to one purpose and one subject, expires, and records every
  use.
- A link that has done its job is spent.

---

## Webhooks

`/api/webhooks/[provider]`, handled in this order and no other:

1. **Store.** The raw body and headers, before anything is parsed. A delivery
   that cannot be understood is still on the record.
2. **Verify.** Where the provider signs its callbacks, the signature is checked
   **over the raw bytes**, which is why the body is read raw and not as JSON.
   An unsigned or mis-signed delivery is stored with `signature_valid = false`,
   marked *refused — the signature did not check out*, audited, answered with
   401, and **never acted on**.
3. **Act once.** Idempotent on the provider's own event id, so a provider that
   retries does not move an application twice.

---

## The audit trail

Every meaningful write records who, what, which entity, what it looked like
before, what it looks like now, when, the reason where there is one, and the
request id that ties one action's entries together.

`audit_events` is **append-only, enforced by a database trigger** that raises on
`UPDATE` and `DELETE`. Nothing in the product can edit a line of it, and an
attempt from a SQL console fails too. It is readable only by an Admin.

Retention defaults to seven years (`AUDIT_RETENTION_MONTHS=84`).

---

## Personal data

| | |
| --- | --- |
| **What is held** | Name, contact details, CV and its parsed contents, salary, nationality, national ID or iqama number, date of birth, bank details, photographs, interview recordings and transcripts, and the decisions made |
| **Where** | PostgreSQL, and the file store. Nowhere else — no analytics service, no third-party logger, no client-side persistence |
| **Consent** | Candidate records carry a consent window; the retention sweep flags records past it |
| **Retention** | `CANDIDATE_RETENTION_MONTHS` for candidates, `RECORDING_RETENTION_DAYS` for call recordings, `retain_until` per file |
| **Field-level encryption** | `lib/crypto/field.ts` for the joiner's national ID, IBAN and date of birth in deployments that enable it |
| **Export** | `data.export` is a capability, and an export is an audited action |

Interview recordings need consent, and the screen asks for it out loud: the call
opens with the recorded-line notice, a refusal is logged, and the chat screen is
sent instead.

---

## Secrets

- Read once at start-up through `lib/env.ts`, which validates them. A malformed
  secret stops the process rather than producing a subtly wrong system later.
- Never logged. The log helper does not serialise the environment.
- `SESSION_SECRET` and `FILE_SIGNING_SECRET` are separate on purpose: rotating
  file URLs should not sign everybody out, and signing everybody out should not
  invalidate every document link.
- Rotating either is a restart. Sessions survive a file-secret rotation and not
  a session-secret one.

---

## Transport

Terminate TLS in front of the application. Set `DATABASE_SSL=true` against a
managed database. `APP_URL` must be the real external origin — signed links and
the OIDC redirect are built from it.

---

## What has deliberately *not* been done

| | Why |
| --- | --- |
| **No rate limiting beyond login** | The product sits behind a corporate perimeter. If it is exposed publicly, put a rate limiter in front of `/api/*` and the sign-in page |
| **No Content-Security-Policy header** | Next.js inlines what it needs; a CSP wants a nonce strategy chosen with the deployment. Add one — it is worth doing |
| **No 2FA** | SSO is the answer where it matters; `AUTH_MODE=oidc` puts the factor policy where it belongs |
| **No penetration test** | The product has not had one. It should before it holds real candidate data |
| **No formal accessibility audit** | See [known limitations](10-known-limitations.md) |

---

## If something goes wrong

1. **Revoke sessions.** `DELETE FROM sessions` signs everybody out immediately.
2. **Rotate `FILE_SIGNING_SECRET`.** Every outstanding document URL dies.
3. **Read the trail.** `audit_events` cannot have been edited. It is the one
   source you can rely on.
4. **Check the access links.** `access_links` records every use, with when and
   from where.
5. **Check the file access log.** `file_access_log` records who read what.

## Scope, and the shape of the bugs it hides

Access by requisition is one predicate, `jobScopeSql(viewer)` in
`lib/authz.ts`, applied at the root of every query rather than as a filter over
rows already fetched. It has a property worth writing down, because it caused
two live defects:

**For an account whose access is everything it expands to `true`.** That is
every account on the TA desk — Admin, recruiter, coordinator, Onboarding — and
therefore every account anybody develops or demonstrates with. A query that
composes the predicate wrongly works perfectly for all of them and fails only
for a hiring manager, an interview participant, or a recruiter whose access is a
hand-picked list.

Two things follow, and both are now enforced:

- **The predicate names columns, so it has to agree with the query around it.**
  It emits `"jobs"."recruiter_id"`; a query that writes `FROM jobs j` has
  aliased that name away, and PostgreSQL refuses with *invalid reference to
  FROM-clause entry*. Pass the alias: `jobScopeSql(v, 'j')`. Six page queries
  did not, and each was a 500 for every hiring manager in the company.
- **An empty scope is an empty list, and `IN ()` is a syntax error** rather than
  an empty set. `inList(column, ids)` in `lib/queries/sql.ts` returns `false`
  for an empty list; nothing builds an `IN` list by interpolating a mapped
  array any more.

And a refusal is a refusal, not a failure: a record outside somebody's scope
renders `OutOfScope` from `components/app/no-access.tsx` — the product, with a
sentence in it and their navigation intact — rather than throwing
`ForbiddenError` out of the page, which Next serves as a 500 with a stack
trace.

**What holds this now.** `tests/write/queries.test.ts` runs every page query
under all five scopes (everything, their own, a picked list, a picked list plus
their own, an empty picked list) and asserts the SQL parses; `npm run walk`
loads every route as each of the six kinds of account and fails on a status that
is not 200. Neither can be satisfied by an account that sees everything.
