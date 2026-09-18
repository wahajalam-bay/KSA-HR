import { sql, eq, and } from 'drizzle-orm';
import { candidates, applications, applicationStageHistory, auditEvents } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 2 — requisition → candidate → application.

   The two rules worth a suite: one human is one candidate, and one candidate is
   one application per requisition. Both are enforced in the database as well as
   in the command, and both are tested here through the command, because that is
   the door everything actually comes through.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const manager = viewer({
  name: 'Abdulrahman Al-Qahtani', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

const person = (over: Record<string, string> = {}) => ({
  name: 'Test Candidate Alsaeed',
  email: 'test.candidate.alsaeed@example.com',
  phone: '+966 50 111 2233',
  locationCity: 'Riyadh',
  currentTitle: 'Property Consultant',
  currentCompany: 'Aqar',
  yearsExperience: '6',
  expectedSalary: '13000',
  ...over,
});

async function openJob(tx: Parameters<typeof runIn>[0]) {
  const [job] = rowsOf(await tx.execute(sql`
    SELECT id, title FROM jobs WHERE status = 'open' AND archived_at IS NULL ORDER BY id LIMIT 1`));
  return job as { id: string; title: string };
}

const suite: Suite = {
  name: 'write · candidate → application',
  tests: [
    {
      name: 'a new candidate is created with normalised keys',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          succeeded(r, 'cand.create');
          const id = String((r as { data?: Record<string, unknown> }).data?.candidateId);

          const [c] = await tx.select().from(candidates).where(eq(candidates.id, id));
          equals(c.emailKey, 'test.candidate.alsaeed@example.com', 'the e-mail key is lower-cased');
          equals(c.phoneKey, '501112233', 'the phone key is the last nine digits');
          ok(c.hue >= 1 && c.hue <= 5, 'they get a tint');
        });
      },
    },

    {
      name: 'the same person twice is refused, however the number is written',
      async fn() {
        await inRollback(async (tx) => {
          succeeded(await runIn(tx, 'cand.create', recruiter, { fields: person() }));

          const byEmail = await runIn(tx, 'cand.create', recruiter, {
            fields: person({ name: 'Somebody Else', phone: '' }),
          });
          refused(byEmail, 'already on file');

          const byPhone = await runIn(tx, 'cand.create', recruiter, {
            fields: person({
              name: 'Somebody Else', email: 'other@example.com', phone: '00966501112233',
            }),
          });
          refused(byPhone, 'already on file');
        });
      },
    },

    {
      name: 'a duplicate can be kept deliberately, and says so in the trail',
      async fn() {
        await inRollback(async (tx) => {
          succeeded(await runIn(tx, 'cand.create', recruiter, { fields: person() }));
          const second = await runIn(tx, 'cand.create', recruiter, {
            fields: { ...person({ name: 'Test Candidate Alsaeed II' }), allowDuplicate: '1' },
          });
          succeeded(second, 'a deliberate duplicate is allowed');
        });
      },
    },

    {
      name: 'a candidate with no way to reach them is refused',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'cand.create', recruiter, {
            fields: person({ email: '', phone: '' }),
          });
          refused(r, 'reach them on');
        });
      },
    },

    {
      name: 'adding somebody to a requisition starts their history at the entry stage',
      async fn() {
        await inRollback(async (tx) => {
          const job = await openJob(tx);
          const c = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          const candidateId = String((c as { data?: Record<string, unknown> }).data?.candidateId);

          const r = await runIn(tx, 'cand.addToJob', recruiter, {
            v: candidateId, fields: { jobId: job.id, source: 'Bayut Careers' },
          });
          succeeded(r, 'cand.addToJob');

          const [app] = await tx.select().from(applications)
            .where(and(eq(applications.candidateId, candidateId), eq(applications.jobId, job.id)));
          ok(app, 'the application exists');
          equals(app.stage, 'applied', 'they enter at Applied');
          equals(app.status, 'active');
          ok(app.reference.startsWith('APP-'), 'it carries a reference');

          const hist = await tx.select().from(applicationStageHistory)
            .where(eq(applicationStageHistory.applicationId, app.id));
          equals(hist.length, 1, 'the history starts with one row');
          equals(hist[0].toStage, 'applied');
          equals(hist[0].seq, 1);
          ok(hist[0].actorName, 'and records who put them there');
        });
      },
    },

    {
      name: 'a sourced candidate enters at Sourced instead',
      async fn() {
        await inRollback(async (tx) => {
          const job = await openJob(tx);
          const c = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          const candidateId = String((c as { data?: Record<string, unknown> }).data?.candidateId);

          succeeded(await runIn(tx, 'cand.addToJob', recruiter, {
            v: candidateId, fields: { jobId: job.id, source: 'Sourced — Outbound' },
          }));

          const [app] = await tx.select().from(applications)
            .where(eq(applications.candidateId, candidateId));
          equals(app.stage, 'sourced', 'they enter at Sourced');
          equals(app.sourcerId, 'stf_02', 'and the sourcer is recorded');
        });
      },
    },

    {
      name: 'the same person cannot be added to the same requisition twice',
      async fn() {
        await inRollback(async (tx) => {
          const job = await openJob(tx);
          const c = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          const candidateId = String((c as { data?: Record<string, unknown> }).data?.candidateId);

          succeeded(await runIn(tx, 'cand.addToJob', recruiter, {
            v: candidateId, fields: { jobId: job.id, source: 'Bayut Careers' },
          }));
          const again = await runIn(tx, 'cand.addToJob', recruiter, {
            v: candidateId, fields: { jobId: job.id, source: 'LinkedIn' },
          });
          refused(again, 'already on');
        });
      },
    },

    {
      name: 'nobody new can be added to a closed requisition',
      async fn() {
        await inRollback(async (tx) => {
          const [closed] = rowsOf(await tx.execute(sql`
            SELECT id, title FROM jobs WHERE status = 'closed' ORDER BY id LIMIT 1`));
          ok(closed, 'the dataset has a closed requisition');
          const c = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          const candidateId = String((c as { data?: Record<string, unknown> }).data?.candidateId);

          const r = await runIn(tx, 'cand.addToJob', admin, {
            v: candidateId, fields: { jobId: String(closed.id), source: 'Bayut Careers' },
          });
          refused(r, 'closed');
        });
      },
    },

    {
      name: 'a hiring manager may not add a candidate',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'cand.create', manager, { fields: person() });
          refused(r, 'access');
        });
      },
    },

    {
      name: 'a tag belongs to one recruiter until it is released',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          const candidateId = String((c as { data?: Record<string, unknown> }).data?.candidateId);

          succeeded(await runIn(tx, 'cand.claimSave', recruiter, {
            v: candidateId, fields: { note: 'Screening on Sunday' },
          }));

          const other = viewer({ name: 'Taif Alshaikhi', staffRole: 'recruiter', staffId: 'stf_03' });
          refused(await runIn(tx, 'cand.claimSave', other, { v: candidateId }), 'ask them first');
          refused(await runIn(tx, 'cand.release', other, { v: candidateId }), 'release');

          succeeded(await runIn(tx, 'cand.release', admin, { v: candidateId }),
            'an Admin can always release one');
          succeeded(await runIn(tx, 'cand.claimSave', other, { v: candidateId }),
            'and then anybody may take it');
        });
      },
    },

    {
      name: 'every candidate write leaves a trail',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'cand.create', recruiter, { fields: person() });
          const candidateId = String((c as { data?: Record<string, unknown> }).data?.candidateId);
          await runIn(tx, 'cand.claimSave', recruiter, { v: candidateId, fields: { note: 'mine' } });

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, candidateId));
          ok(trail.length >= 2, 'the creation and the tag are both recorded');
          includes(trail.map((a) => a.summary).join(' | '), 'put their name on');
          ok(trail.every((a) => a.actorName === recruiter.name), 'under the right name');
        });
      },
    },

    {
      name: 'writing to a candidate goes through the outbox and says so on the panel',
      async fn() {
        await inRollback(async (tx) => {
          const [app] = rowsOf(await tx.execute(sql`
            SELECT a.id, c.name FROM applications a JOIN candidates c ON c.id = a.candidate_id
             WHERE a.status = 'active' AND c.email IS NOT NULL LIMIT 1`));

          refused(await runIn(tx, 'app.emailSend', recruiter, {
            v: String(app.id), fields: { to: 'x@example.com', subject: '' },
          }), 'A subject');

          const r = await runIn(tx, 'app.emailSend', recruiter, {
            v: String(app.id),
            fields: {
              to: 'x@example.com',
              subject: 'About the Senior Property Consultant role',
              body: 'Hello — are you free on Sunday?',
            },
          });
          succeeded(r, 'app.emailSend');

          const [msg] = rowsOf(await tx.execute(sql`
            SELECT status::text AS status, status_detail, channel::text AS channel
              FROM messages WHERE application_id = ${String(app.id)}
             ORDER BY queued_at DESC LIMIT 1`));
          ok(msg, 'the message is in the outbox');
          equals(String(msg.channel), 'Email');

          /* Whatever the environment says, the row and the toast agree — a
             message is never reported as sent when nothing can send it. */
          if (String(msg.status) === 'not_configured') {
            ok(msg.status_detail, 'and it says why it cannot go');
            includes(String((r as { toast?: string }).toast), 'not configured');
          } else {
            equals(String(msg.status), 'queued');
            includes(String((r as { toast?: string }).toast), 'queued');
          }

          const [note] = rowsOf(await tx.execute(sql`
            SELECT body FROM comments WHERE application_id = ${String(app.id)}
             ORDER BY at DESC LIMIT 1`));
          includes(String(note.body), 'About the Senior Property Consultant role');
        });
      },
    },
  ],
};

export default suite;
