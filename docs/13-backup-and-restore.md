# Backup and restore

## What has to be backed up

Two things, and they are **one unit**:

| | What is in it | Backing one up without the other |
| --- | --- | --- |
| **The database** | Everything: candidates, applications, offers, the audit trail, the outbox | Leaves you with rows pointing at files that are not there |
| **The file store** | Résumés, offer letters, signed documents, onboarding documents, recordings | Leaves you with files nobody can find or authorize |

A restore that mixes a database from Tuesday with a file store from Monday
produces a system where an offer letter exists in the record and not on disk.
Take them together, and restore them together.

Nothing else is state. The application is stateless, sessions are in the
database, and a redeploy loses nothing.

---

## Taking a backup

### The database

```bash
pg_dump \
  --format=custom \
  --no-owner --no-privileges \
  --file="bayut-ta-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$DATABASE_URL"
```

Custom format, so a restore can be parallel and selective. `--no-owner` so it
restores into a database with a different role name without argument.

**Do not use `--data-only`.** The schema and the data go together; a data-only
dump restored onto a schema from a different release is how a subtly broken
system is made.

### The file store

**Local (`STORAGE_DRIVER=local`)** — the whole of `STORAGE_LOCAL_ROOT`:

```bash
tar --create --gzip \
  --file="bayut-ta-files-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  -C "$STORAGE_LOCAL_ROOT" .
```

**S3 (`STORAGE_DRIVER=s3`)** — turn on **versioning** on the bucket and set a
lifecycle rule that keeps non-current versions for at least as long as the
database backups are kept. That gives point-in-time recovery for the files for
free. Take a cross-region replica if the business needs one.

### Ordering

Take the **file store first**, then the database. Files are written before the
row that points at them, so a file store that is slightly newer than the
database is harmless — there are orphan files, which the retention sweep tidies.
The other way round leaves rows pointing at nothing.

---

## How often, and how long to keep it

| | |
| --- | --- |
| **Frequency** | Nightly full dump. Continuous WAL archiving on top if the business needs a recovery point inside a day |
| **Retention** | 30 daily, 12 monthly, 7 yearly — the audit trail defaults to seven years (`AUDIT_RETENTION_MONTHS=84`), and a backup that does not reach back that far cannot answer a question about that period |
| **Off-site** | At least one copy in a different region or account from production |
| **Encryption** | At rest, always. The dump contains candidate personal data, salaries, national ID numbers and bank details |

---

## Restoring

### Into a fresh database

```bash
createdb bayut_ta_restored
pg_restore \
  --dbname="postgresql://…/bayut_ta_restored" \
  --no-owner --no-privileges \
  --jobs=4 \
  bayut-ta-20260917T010000Z.dump
```

Then the files: restore the tarball into `STORAGE_LOCAL_ROOT`, or point
`S3_BUCKET` at the restored bucket.

Then, before letting anybody in:

```bash
npm run db:status     # is the schema at the release you are running?
npm run db:verify     # do the invariants hold in the restored data?
```

`db:verify` is the one that matters. It asserts the things the product depends
on — one candidate per human, one application per candidate per requisition, one
employee per accepted offer, no application on a stage its requisition does not
run — against the data as restored.

### Over production

1. **Stop both processes.** A worker running against a database that is being
   restored will send messages twice.
2. Rename the existing database rather than dropping it. It is the only copy of
   whatever happened since the backup.
3. Restore as above.
4. `npm run db:status`, `npm run db:verify`.
5. Start **web**, confirm sign-in, then start **worker**.

Starting the worker last is deliberate: it gives you a chance to look at the
outbox before anything in it is sent. A restore can bring back messages that
were already delivered, and the fastest way to check is
`SELECT status, count(*) FROM messages WHERE queued_at > '<backup time>' GROUP BY 1`.

---

## Testing the restore

A backup nobody has restored is a hope, not a backup. Once a quarter:

1. Restore last night's dump into a scratch database.
2. `npm run db:verify`.
3. Point a development web process at it and open a candidate, an offer and the
   audit trail.
4. Write down how long the whole thing took. That number is your real recovery
   time, and it is the only honest one.

---

## What a restore does *not* bring back

| | |
| --- | --- |
| **Sessions** | Everybody signs in again. This is correct |
| **Anything since the backup** | Obviously — but note that the **audit trail is append-only**, so a restore loses entries rather than corrupting them. What was in the backup is exactly what was true |
| **Provider-side state** | An e-signature envelope, a calendar event or a sent message exists at the provider whether or not the row exists here. After a restore, reconcile: the webhook log in `webhook_deliveries` is the record of what arrived, and processing is idempotent, so replaying a delivery is safe |

---

## Retention and deletion

Backups hold personal data, so they are in scope for a deletion request. The
product's own retention sweeps (`CANDIDATE_RETENTION_MONTHS`,
`RECORDING_RETENTION_DAYS`, file `retain_until`) remove data from the live
system on a clock. A deletion request that has to reach the backups as well is a
policy decision with a cost: either the backups are rewritten, or the retention
window is short enough that the data ages out of them. Decide which before the
first request arrives, and write it down.
