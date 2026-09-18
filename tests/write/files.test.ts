import { sql, eq, and } from 'drizzle-orm';
import { files, fileAccessLog, auditEvents, applications } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, includes, type Suite } from '../run';
import { upload, readable, remove, sniff, logAccess } from '@/lib/services/files';
import { storageAdapter } from '@/lib/providers';
import type { Ctx } from '@/lib/audit';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 11 — files.

   The rules that matter are the ones that decide whether a file is safe to hand
   over: what it actually is, whether anything scanned it, and whose it is. The
   last one is the one a test can prove and a code review cannot.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const outsider = viewer({
  name: 'Lama Alghamdi', staffRole: 'recruiter', staffId: 'stf_09',
  scope: { kind: 'jobs', jobIds: ['job_nothing_here'], own: false },
});
const manager = viewer({
  name: 'Saud Al-Harbi', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

const ctxOf = (tx: Parameters<typeof runIn>[0], who = recruiter) => ({
  viewer: who,
  requestId: 'test',
  correlationId: 'test',
  tx,
  now: new Date(),
}) as Ctx & { tx: typeof tx; now: Date };

const PDF = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
  ...Array.from('Bayut KSA — a short document.').map((c) => c.charCodeAt(0)),
]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function anApplication(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.candidate_id FROM applications a
      JOIN jobs j ON j.id = a.job_id
     WHERE a.status = 'active' AND j.status = 'open'
     ORDER BY a.id LIMIT 1`));
  return row as { id: string; candidate_id: string };
}

const suite: Suite = {
  name: 'write · files',
  tests: [
    {
      name: 'what a file actually is decides whether it is taken',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const ctx = ctxOf(tx);

          const good = await upload({
            kind: 'cv',
            ownerType: 'candidate',
            ownerId: a.candidate_id,
            originalName: 'cv.pdf',
            contentType: 'application/pdf',
            bytes: PDF,
          }, ctx);
          ok(good.fileId, 'a PDF is taken');

          /* A PNG renamed .pdf is still a PNG. */
          let refused = '';
          try {
            await upload({
              kind: 'cv',
              ownerType: 'candidate',
              ownerId: a.candidate_id,
              originalName: 'cv.pdf',
              contentType: 'application/pdf',
              bytes: PNG,
            }, ctx);
          } catch (e) { refused = (e as Error).message; }
          includes(refused, 'its contents are image/png');

          /* And an audio file is not a CV whatever it says. */
          refused = '';
          try {
            await upload({
              kind: 'cv',
              ownerType: 'candidate',
              ownerId: a.candidate_id,
              originalName: 'call.mp3',
              contentType: 'audio/mpeg',
              bytes: PDF,
            }, ctx);
          } catch (e) { refused = (e as Error).message; }
          includes(refused, 'has to be');
        });
      },
    },

    {
      name: 'the sniffer reads the bytes, not the name',
      fn() {
        equals(sniff(PDF), 'application/pdf');
        equals(sniff(PNG), 'image/png');
        equals(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'application/zip');
        equals(sniff(new Uint8Array([1, 2, 3])), null, 'and says nothing when it cannot tell');
      },
    },

    {
      name: 'an unscanned file is recorded as unscanned, never as clean',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const r = await upload({
            kind: 'cv',
            ownerType: 'candidate',
            ownerId: a.candidate_id,
            originalName: 'cv.pdf',
            contentType: 'application/pdf',
            bytes: PDF,
          }, ctxOf(tx));

          /* No scanner is configured in a test environment. */
          equals(r.scanState, 'skipped');
          includes(r.scanNote ?? '', 'not configured');

          const [f] = await tx.select().from(files).where(eq(files.id, r.fileId));
          equals(f.scanState, 'skipped');
          ok(!f.scannedAt, 'and nothing claims it was scanned');
          ok(f.retainUntil, 'with a date it is deleted on');
        });
      },
    },

    {
      name: 'a file is readable by whoever can reach the record it hangs off',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const r = await upload({
            kind: 'cv',
            ownerType: 'application',
            ownerId: a.id,
            originalName: 'cv.pdf',
            contentType: 'application/pdf',
            bytes: PDF,
          }, ctxOf(tx));

          const mine = await readable(r.fileId, recruiter, tx);
          equals(mine.ok, true, 'the recruiter on it may read it');

          const theirs = await readable(r.fileId, outsider, tx);
          equals(theirs.ok, false);
          if (!theirs.ok) equals(theirs.why, 'forbidden');
        });
      },
    },

    {
      name: 'a deleted file is gone from the store and marked in the record',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const ctx = ctxOf(tx);
          const r = await upload({
            kind: 'cv',
            ownerType: 'application',
            ownerId: a.id,
            originalName: 'cv.pdf',
            contentType: 'application/pdf',
            bytes: PDF,
          }, ctx);

          const [before] = await tx.select().from(files).where(eq(files.id, r.fileId));
          const got = await storageAdapter().get(before.storageKey);
          equals(got.ok, true, 'the bytes are in the store');

          await remove({ fileId: r.fileId, reason: 'uploaded to the wrong person' }, ctx);

          const [after] = await tx.select().from(files).where(eq(files.id, r.fileId));
          ok(after.deletedAt, 'the row is marked');
          const gone = await storageAdapter().get(before.storageKey);
          equals(gone.ok, false, 'and the bytes are not');

          const check = await readable(r.fileId, recruiter, tx);
          equals(check.ok, false);
          if (!check.ok) equals(check.why, 'deleted');

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, r.fileId));
          ok(trail.length >= 2, 'the upload and the deletion are both on the record');
          includes(trail.map((t) => t.reason ?? '').join(' '), 'wrong person');
        });
      },
    },

    {
      name: 'a version supersedes rather than overwrites',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const ctx = ctxOf(tx);
          const first = await upload({
            kind: 'cv', ownerType: 'candidate', ownerId: a.candidate_id,
            originalName: 'cv.pdf', contentType: 'application/pdf', bytes: PDF,
          }, ctx);
          const second = await upload({
            kind: 'cv', ownerType: 'candidate', ownerId: a.candidate_id,
            originalName: 'cv-updated.pdf', contentType: 'application/pdf', bytes: PDF,
            supersedesId: first.fileId,
          }, ctx);

          equals(first.version, 1);
          equals(second.version, 2);
          const [old] = await tx.select().from(files).where(eq(files.id, first.fileId));
          ok(!old.deletedAt, 'the first one is still there');
          const [now] = await tx.select().from(files).where(eq(files.id, second.fileId));
          equals(now.supersedesId, first.fileId, 'and the second says what it replaced');
        });
      },
    },

    {
      name: 'every download is recorded against the file',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const ctx = ctxOf(tx);
          const r = await upload({
            kind: 'cv', ownerType: 'application', ownerId: a.id,
            originalName: 'cv.pdf', contentType: 'application/pdf', bytes: PDF,
          }, ctx);

          await logAccess({ fileId: r.fileId, action: 'download' }, ctx);
          await logAccess({ fileId: r.fileId, action: 'signed_url' }, ctx);

          const log = await tx.select().from(fileAccessLog)
            .where(eq(fileAccessLog.fileId, r.fileId));
          equals(log.length, 2);
          equals(new Set(log.map((l) => l.action)).size, 2, 'and says which was which');
          ok(log.every((l) => l.actorName === recruiter.name), 'under the right name');
        });
      },
    },

    {
      name: 'an oversized file is refused before it is stored',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          const big = new Uint8Array(6 * 1024 * 1024);
          big.set(PNG, 0);
          let refused = '';
          try {
            await upload({
              kind: 'photo', ownerType: 'candidate', ownerId: a.candidate_id,
              originalName: 'photo.png', contentType: 'image/png', bytes: big,
            }, ctxOf(tx));
          } catch (e) { refused = (e as Error).message; }
          includes(refused, 'under 5 MB');

          const kept = await tx.select().from(files)
            .where(and(eq(files.ownerId, a.candidate_id), eq(files.kind, 'photo')));
          equals(kept.length, 0, 'and nothing was written');
        });
      },
    },

    {
      name: 'an empty file is refused',
      async fn() {
        await inRollback(async (tx) => {
          const a = await anApplication(tx);
          let refused = '';
          try {
            await upload({
              kind: 'cv', ownerType: 'candidate', ownerId: a.candidate_id,
              originalName: 'nothing.pdf', contentType: 'application/pdf',
              bytes: new Uint8Array(0),
            }, ctxOf(tx));
          } catch (e) { refused = (e as Error).message; }
          includes(refused, 'empty');
        });
      },
    },

    {
      name: 'an employee file belongs to the onboarding desk, not the pipeline',
      async fn() {
        await inRollback(async (tx) => {
          const [emp] = rowsOf(await tx.execute(sql`
            SELECT id FROM employees ORDER BY id LIMIT 1`)) as Array<{ id: string }>;
          const r = await upload({
            kind: 'onboarding_document', ownerType: 'employee', ownerId: emp.id,
            originalName: 'iqama.pdf', contentType: 'application/pdf', bytes: PDF,
          }, ctxOf(tx));

          const onboarding = viewer({
            name: 'Hatoon Al-Faraj', staffRole: 'onboarding', staffId: 'stf_07',
          });
          equals((await readable(r.fileId, onboarding, tx)).ok, true);
          equals((await readable(r.fileId, recruiter, tx)).ok, true,
            'a recruiter sees onboarding too');
          equals((await readable(r.fileId, manager, tx)).ok, false,
            'a hiring manager does not');
        });
      },
    },
  ],
};

export default suite;
