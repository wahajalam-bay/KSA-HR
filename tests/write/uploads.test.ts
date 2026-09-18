import { and, eq, sql } from 'drizzle-orm';
import {
  files, candidates, candidateResumes, offerTemplates, staff, employees, onboardingDocuments,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { viewer, runIn, inRollback } from '../commands/harness';
import { ok, eq as equals, includes, refused, succeeded, type Suite } from '../run';
import '@/lib/commands';

/* ─────────────────────────────────────────────────────────────────────────────
   The four wells the product takes files through.

   A dropzone posts to the command dispatcher like any button, which means an
   upload is a command: checked, transacted, audited. What these tests are
   really about is the promise around it — that nothing is created on the way
   in, that a file belongs to exactly one record, that an unscanned file is
   reported as unscanned rather than as safe, and that a format whose text
   cannot be read is refused with the reason instead of stored and found to be
   useless at the moment somebody tries to send it.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({ name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02' });
const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const onboarder = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', roleLabel: 'Onboarding', staffId: 'stf_07',
});

const file = (name: string, text: string, type: string) =>
  new File([new TextEncoder().encode(text)], name, { type });

const CV = [
  'Hessa Al-Rasheed',
  'hessa.alrasheed@example.com · +966 55 214 9930 · Riyadh',
  '',
  'EXPERIENCE',
  'Senior Account Manager — Aqar  Jan 2021 – Present',
  '  Grew the Riyadh developer book by 40%.',
  '',
  'SKILLS',
  'Negotiation, CRM, Salesforce, Arabic, English',
].join('\n');

const PLAN = [
  'Position title,Reports to,Holder,Grade,Approved headcount,Location,Department',
  'Head of Compliance,,Sami Al-Rashid,D1,1,Riyadh,Compliance Import Test',
  'Compliance Analyst,Head of Compliance,,P2,2,Riyadh,Compliance Import Test',
].join('\n');

async function aJobId(tx: Parameters<typeof runIn>[0]): Promise<string> {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT id FROM jobs WHERE status = 'open' ORDER BY created_at LIMIT 1`)) as Array<{ id: string }>;
  return row.id;
}

const suite: Suite = {
  name: 'write · taking a file in',
  tests: [
    /* ── CV intake ─────────────────────────────────────────────────────── */
    {
      name: 'a dropped CV is stored, read, and creates nobody',
      async fn() {
        await inRollback(async (tx) => {
          const before = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM candidates`)) as
            Array<{ n: number }>;

          const r = await runIn(tx, 'cv.intake', recruiter, {
            files: [file('hessa.txt', CV, 'text/plain')],
          });
          succeeded(r, 'cv.intake');

          const after = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM candidates`)) as
            Array<{ n: number }>;
          equals(after[0].n, before[0].n, 'nobody was created by the upload alone');

          const ids = (r as { data?: { fileIds?: string[] } }).data?.fileIds ?? [];
          equals(ids.length, 1);
          const [stored] = await tx.select().from(files).where(eq(files.id, ids[0]));
          equals(stored.kind, 'cv');
          equals(stored.ownerType, 'org');
          equals(stored.ownerId, 'intake');

          /* The reading is kept on the file, so the panel that shows it reads
             rather than parses again. */
          const meta = stored.metadata as { parsed?: { name?: string; skills?: string[] } };
          equals(meta.parsed?.name, 'Hessa Al-Rasheed');
          ok((meta.parsed?.skills ?? []).length > 0, 'and the skills it found');

          /* And the panel it hands the interface is the review, not the drawer. */
          equals((r as { openSheet?: { act: string } }).openSheet?.act, 'cv.review');
        });
      },
    },

    {
      name: 'an unscanned file says it is unscanned rather than saying nothing',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'cv.intake', recruiter, {
            files: [file('hessa.txt', CV, 'text/plain')],
          });
          succeeded(r);
          const ids = (r as { data?: { fileIds?: string[] } }).data?.fileIds ?? [];
          const [stored] = await tx.select().from(files).where(eq(files.id, ids[0]));

          /* Whatever the environment has, the file's state and the sentence the
             product shows have to agree — a `skipped` scan that reports as
             clean is the failure this is here to prevent. */
          if (stored.scanState === 'clean') {
            ok(!/not scanned/.test(String((r as { toast?: string }).toast)),
              'a scanned file does not claim to be unscanned');
          } else {
            equals(stored.scanState, 'skipped');
            includes(String((r as { toast?: string }).toast), 'not scanned');
            ok(stored.scannedAt === null, 'and nothing pretends it was scanned');
          }
        });
      },
    },

    {
      name: 'several CVs at once are all read, and the panel opens on the first',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'cv.intake', recruiter, {
            files: [
              file('one.txt', CV, 'text/plain'),
              file('two.txt', CV.replace('Hessa Al-Rasheed', 'Lama Al-Otaibi'), 'text/plain'),
            ],
          });
          succeeded(r);
          const ids = (r as { data?: { fileIds?: string[] } }).data?.fileIds ?? [];
          equals(ids.length, 2);
          includes(String((r as { openSheet?: { v: string } }).openSheet?.v), ids[0]);
        });
      },
    },

    {
      name: 'a well with nothing in it refuses rather than reporting success',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'cv.intake', recruiter, { files: [] }), 'No CV');
        });
      },
    },

    {
      name: 'a hiring manager cannot drop a CV on the product',
      async fn() {
        await inRollback(async (tx) => {
          const hm = viewer({ name: 'Faisal', role: 'hiring_manager', isPortal: true, staffId: null });
          refused(await runIn(tx, 'cv.intake', hm, {
            files: [file('hessa.txt', CV, 'text/plain')],
          }), 'the TA team handles this step');
        });
      },
    },

    {
      name: 'discarding a staged CV removes it, and refuses one that is somebody’s',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'cv.intake', recruiter, {
            files: [file('hessa.txt', CV, 'text/plain')],
          });
          const [fileId] = (r as { data?: { fileIds?: string[] } }).data?.fileIds ?? [];

          succeeded(await runIn(tx, 'cv.drop', recruiter, { v: fileId }), 'cv.drop');
          const [gone] = await tx.select().from(files).where(eq(files.id, fileId));
          ok(gone.deletedAt, 'the file is gone');

          /* One that belongs to a candidate is not the intake queue's to drop. */
          const [owned] = rowsOf(await tx.execute(sql`
            SELECT id FROM files WHERE kind = 'cv' AND owner_type = 'candidate' LIMIT 1`)) as
            Array<{ id: string }>;
          if (owned) {
            refused(await runIn(tx, 'cv.drop', recruiter, { v: owned.id }), 'belongs to somebody');
          }
        });
      },
    },

    /* ── A résumé attached to the form being filled in ──────────────────── */
    {
      name: 'a staged résumé re-opens the form carrying its id',
      async fn() {
        await inRollback(async (tx) => {
          const jobId = await aJobId(tx);
          const r = await runIn(tx, 'cand.stageFile', recruiter, {
            v: jobId,
            files: [file('hessa.txt', CV, 'text/plain')],
          });
          succeeded(r, 'cand.stageFile');
          const sheet = (r as { openSheet?: { act: string; v: string; replace?: boolean } }).openSheet;
          equals(sheet?.act, 'cand.new');
          equals(sheet?.replace, true);
          includes(String(sheet?.v), jobId);

          const fileId = (r as { data?: { fileId?: string } }).data?.fileId ?? '';
          includes(String(sheet?.v), fileId);
          const [stored] = await tx.select().from(files).where(eq(files.id, fileId));
          equals((stored.metadata as { forForm?: boolean }).forForm, true);
        });
      },
    },

    {
      name: 'creating the candidate makes the staged file theirs and keeps the reading',
      async fn() {
        await inRollback(async (tx) => {
          const jobId = await aJobId(tx);
          const staged = await runIn(tx, 'cand.stageFile', recruiter, {
            v: jobId, files: [file('hessa.txt', CV, 'text/plain')],
          });
          const fileId = (staged as { data?: { fileId?: string } }).data?.fileId ?? '';

          const made = await runIn(tx, 'cand.create', recruiter, {
            v: jobId,
            fields: {
              name: 'Hessa Al-Rasheed',
              email: `hessa.${Math.random().toString(36).slice(2, 8)}@example.com`,
              jobId,
              resumeFileId: fileId,
            },
          });
          succeeded(made, 'cand.create');

          const candidateId = (made as { data?: { candidateId?: string } }).data?.candidateId ?? '';
          const [stored] = await tx.select().from(files).where(eq(files.id, fileId));
          equals(stored.ownerType, 'candidate');
          equals(stored.ownerId, candidateId);

          const [resume] = await tx.select().from(candidateResumes).where(and(
            eq(candidateResumes.candidateId, candidateId),
            eq(candidateResumes.isCurrent, true),
          ));
          ok(resume, 'and the reading is kept against them');
          equals(resume.fileId, fileId);
        });
      },
    },

    /* ── The offer letter template ─────────────────────────────────────── */
    {
      name: 'a template is stored with the merge fields found in it',
      async fn() {
        await inRollback(async (tx) => {
          const body = 'Dear {{candidate_name}}, we are pleased to offer you {{job_title}} at '
            + '{{base_monthly}} SAR. Signed, {{signatory}}.';
          const r = await runIn(tx, 'otpl.upload', admin, {
            files: [file('standard-offer.txt', body, 'text/plain')],
            fields: { name: 'Standard offer — test' },
          });
          succeeded(r, 'otpl.upload');

          const id = (r as { data?: { templateId?: string } }).data?.templateId ?? '';
          const [t] = await tx.select().from(offerTemplates).where(eq(offerTemplates.id, id));
          equals(t.name, 'Standard offer — test');
          equals(t.version, 1);
          equals(t.detectedFields.sort().join(','),
            ['base_monthly', 'candidate_name', 'job_title', 'signatory'].join(','));
          ok(t.body.includes('{{candidate_name}}'), 'and the body it will fill');
        });
      },
    },

    {
      name: 'a PDF is refused as a template, because its fields cannot be filled',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'otpl.upload', admin, {
            files: [file('offer.pdf', '%PDF-1.4\n% a letter', 'application/pdf')],
          });
          refused(r, 'PDF is a finished rendering');
        });
      },
    },

    {
      name: 'uploading again supersedes rather than replaces, and the version moves',
      async fn() {
        await inRollback(async (tx) => {
          const first = await runIn(tx, 'otpl.upload', admin, {
            files: [file('offer.txt', 'Dear {{candidate_name}}', 'text/plain')],
            fields: { name: 'Versioned offer — test' },
          });
          const id = (first as { data?: { templateId?: string } }).data?.templateId ?? '';

          const second = await runIn(tx, 'otpl.upload', admin, {
            v: id,
            files: [file('offer-v2.txt', 'Dear {{first_name}}, from {{start_date}}', 'text/plain')],
          });
          succeeded(second, 'the second upload');

          const [t] = await tx.select().from(offerTemplates).where(eq(offerTemplates.id, id));
          equals(t.version, 2);
          equals(t.fileName, 'offer-v2.txt');
          equals(t.detectedFields.sort().join(','), 'first_name,start_date');

          /* The earlier file is still there — a letter somebody signed against
             is not something to overwrite. */
          const both = await tx.select().from(files)
            .where(eq(files.kind, 'offer_template'));
          ok(both.length >= 2, 'the earlier template is still stored');
        });
      },
    },

    {
      name: 'only somebody who manages templates may upload one',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'otpl.upload', recruiter, {
            files: [file('offer.txt', 'Dear {{candidate_name}}', 'text/plain')],
          }), 'does not include offer template manage');
        });
      },
    },

    /* ── The manpower plan ─────────────────────────────────────────────── */
    {
      name: 'a plan is read and previewed, and creates no seats',
      async fn() {
        await inRollback(async (tx) => {
          const before = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM positions`)) as
            Array<{ n: number }>;

          const r = await runIn(tx, 'mp.importFile', admin, {
            files: [file('plan.csv', PLAN, 'text/csv')],
          });
          succeeded(r, 'mp.importFile');
          includes(String((r as { toast?: string }).toast), '2 seats');
          equals((r as { openSheet?: { act: string } }).openSheet?.act, 'mp.importPreview');

          const after = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM positions`)) as
            Array<{ n: number }>;
          equals(after[0].n, before[0].n, 'the preview writes nothing');
        });
      },
    },

    {
      name: 'importing the same block twice is refused by the file itself',
      async fn() {
        await inRollback(async (tx) => {
          const up = await runIn(tx, 'mp.importFile', admin, {
            files: [file('plan.csv', PLAN, 'text/csv')],
          });
          const fileId = (up as { data?: { fileId?: string } }).data?.fileId ?? '';

          const rows = JSON.stringify([
            { title: 'Head of Compliance', reportsTo: null, grade: 'D1', approved: 1 },
            { title: 'Compliance Analyst', reportsTo: 'Head of Compliance', grade: 'P2', approved: 2 },
          ]);
          const fields = { deptName_0: 'Compliance Import Test', rows_0: rows };

          succeeded(await runIn(tx, 'mp.importCreate', admin, { v: `${fileId}|0`, fields }),
            'the first import');
          refused(await runIn(tx, 'mp.importCreate', admin, { v: `${fileId}|0`, fields }),
            'already been imported');
        });
      },
    },

    {
      name: 'a file that is not a plan is refused before it is stored',
      async fn() {
        await inRollback(async (tx) => {
          const before = rowsOf(await tx.execute(sql`
            SELECT count(*)::int AS n FROM files WHERE kind = 'import'`)) as Array<{ n: number }>;

          refused(await runIn(tx, 'mp.importFile', admin, {
            files: [file('notes.csv', 'Employee,Band\nNoura,D1\n', 'text/csv')],
          }), 'Position title');

          const after = rowsOf(await tx.execute(sql`
            SELECT count(*)::int AS n FROM files WHERE kind = 'import'`)) as Array<{ n: number }>;
          equals(after[0].n, before[0].n, 'and nothing was kept');
        });
      },
    },

    /* ── The two that hang off a record ────────────────────────────────── */
    {
      name: 'a photograph is your own to change, and somebody else’s is not',
      async fn() {
        await inRollback(async (tx) => {
          const [them] = await tx.select().from(staff)
            .where(sql`${staff.id} <> ${recruiter.staffId} AND ${staff.status} = 'active'`).limit(1);

          /* A one-pixel PNG, so the sniffer sees a real image. */
          const png = new File([Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
            0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
            0, 0, 0, 10, 73, 68, 65, 84, 0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1,
            0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82,
          ])], 'me.png', { type: 'image/png' });

          succeeded(await runIn(tx, 'staff.photo', recruiter, {
            v: recruiter.staffId!, files: [png],
          }), 'their own');

          const [me] = await tx.select().from(staff).where(eq(staff.id, recruiter.staffId!));
          equals(me.photo, 'upload');
          ok(me.photoFileId, 'and the file is on the profile');

          refused(await runIn(tx, 'staff.photo', recruiter, {
            v: them.id, files: [png],
          }), 'Only you or the team manager');
        });
      },
    },

    {
      name: 'a joiner’s document arrives as received, never as verified',
      async fn() {
        await inRollback(async (tx) => {
          const [doc] = rowsOf(await tx.execute(sql`
            SELECT d.id, d.employee_id AS "employeeId", d.key
              FROM onboarding_documents d
             WHERE d.status <> 'verified' LIMIT 1`)) as
            Array<{ id: string; employeeId: string; key: string }>;
          if (!doc) return;

          const r = await runIn(tx, 'emp.doc', onboarder, {
            v: `${doc.employeeId}:${doc.key}`,
            arg: `${doc.employeeId}:${doc.key}`,
            files: [file('iqama.pdf', '%PDF-1.4\n% a scan', 'application/pdf')],
          });
          succeeded(r, 'emp.doc');

          const [after] = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.id, doc.id));
          equals(after.status, 'uploaded');
          ok(after.fileId, 'the file is on the row');
          equals(after.verifiedAt, null, 'and nothing verified it on the way in');

          const [stored] = await tx.select().from(files).where(eq(files.id, after.fileId!));
          equals(stored.ownerType, 'employee');
          equals(stored.ownerId, doc.employeeId);
        });
      },
    },
  ],
};

export default suite;
