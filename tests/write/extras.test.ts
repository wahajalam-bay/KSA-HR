import { and, eq, sql } from 'drizzle-orm';
import {
  jobs, jobChannels, candidates, candidateResumes, pitchProjects, pipelines, questionBank,
  jobQuestions, interviews,
} from '@/db/schema';
import { providers } from '@/lib/env';
import { rows as rowsOf } from '@/lib/queries/sql';
import { viewer, runIn, inRollback } from '../commands/harness';
import { ok, eq as equals, includes, refused, succeeded, type Suite } from '../run';
import '@/lib/commands';

/* ─────────────────────────────────────────────────────────────────────────────
   The buttons that had nothing behind them until the wiring suite found them.

   Publishing to LinkedIn, exporting rows, reviewing a recording, chasing a
   joiner, copying a pitch project, re-reading a sector, taking a photograph
   off, downloading a CV, resetting the SLAs, adding a question from the bank.
   Different corners of the product, one thing in common: each was a control in
   the interface with no command at the other end, and each is now a command
   that either does the thing or says why it cannot.

   Which makes the interesting assertion in most of these the refusal. A
   product that reports a LinkedIn post with no LinkedIn, or a reminder with no
   WhatsApp, is worse than one that has neither.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({ name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02' });
const onboarder = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', roleLabel: 'Onboarding', staffId: 'stf_07',
});

type Tx = Parameters<typeof runIn>[0];

const oneId = async (tx: Tx, q: ReturnType<typeof sql>): Promise<string> => {
  const [row] = rowsOf(await tx.execute(q)) as Array<{ id: string }>;
  return row?.id ?? '';
};

const suite: Suite = {
  name: 'write · the rest of the buttons',
  tests: [
    /* ── Advertising ───────────────────────────────────────────────────── */
    {
      name: 'a requisition posts to LinkedIn, or records why it did not',
      async fn() {
        await inRollback(async (tx) => {
          const jobId = await oneId(tx, sql`
            SELECT id FROM jobs WHERE status = 'open' AND sourcing_linkedin LIMIT 1`);
          if (!jobId) return;
          const r = await runIn(tx, 'job.post', admin, { v: jobId });
          succeeded(r, 'job.post');

          const [ch] = await tx.select().from(jobChannels).where(and(
            eq(jobChannels.jobId, jobId), eq(jobChannels.channel, 'LinkedIn'),
          ));
          ok(ch, 'the channel is on the record either way');

          if (providers().linkedin.configured) {
            equals(ch.state, 'live');
            ok(ch.externalId, 'with the id LinkedIn gave back');
          } else {
            /* The part that matters: no provider means not posted, with the
               reason, rather than a green tick nobody can act on. */
            equals(ch.state, 'not_posted');
            ok(ch.lastError, 'and the reason is on the record');
            includes(String((r as { toast?: string }).toast).toLowerCase(), 'not');
          }
        });
      },
    },

    {
      name: 'a requisition nobody set to be published is not published',
      async fn() {
        await inRollback(async (tx) => {
          const jobId = await oneId(tx, sql`SELECT id FROM jobs WHERE status = 'open' LIMIT 1`);
          await tx.update(jobs)
            .set({ sourcingLinkedin: false, sourcingInternal: false, sourcingHunt: true })
            .where(eq(jobs.id, jobId));
          refused(await runIn(tx, 'job.post', admin, { v: jobId }), 'not advertised anywhere');
        });
      },
    },

    {
      name: 'a requisition that is not open is not advertised either',
      async fn() {
        await inRollback(async (tx) => {
          const jobId = await oneId(tx, sql`
            SELECT id FROM jobs WHERE status <> 'open' LIMIT 1`);
          if (!jobId) return;
          refused(await runIn(tx, 'job.post', admin, { v: jobId }), 'only an open requisition');
        });
      },
    },

    /* ── Taking data out ───────────────────────────────────────────────── */
    {
      name: 'an export is rows, with a header, in a file Excel opens as UTF-8',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'data.export', admin, { v: 'requisitions' });
          succeeded(r, 'data.export');
          const dl = (r as { download?: { text?: string; name?: string } }).download;
          ok(dl?.text, 'it handed back a file');
          ok(dl!.text!.startsWith('﻿'), 'with a BOM, so Arabic names survive Excel');
          includes(dl!.text!, 'Reference,Title,Department');
          includes(String(dl!.name), '.csv');
          ok(dl!.text!.split('\r\n').length > 1, 'and rows under the header');
        });
      },
    },

    {
      name: 'the audit trail is an Admin’s to export, and nobody else’s',
      async fn() {
        await inRollback(async (tx) => {
          succeeded(await runIn(tx, 'data.export', admin, { v: 'audit' }), 'the Admin');
          refused(await runIn(tx, 'data.export', recruiter, { v: 'audit' }), 'Admin');
        });
      },
    },

    {
      name: 'an export of nothing says so rather than handing back an empty file',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'data.export', admin, {
            v: 'requisitions', fields: { dept: 'dep_does_not_exist' },
          }), 'nothing to export');
        });
      },
    },

    {
      name: 'an export the product has no rows for is refused by name',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'data.export', admin, { v: 'unicorns' }), 'nothing of that kind');
        });
      },
    },

    /* ── The answer behind a number ────────────────────────────────────── */
    {
      name: 'a question with a figure in it exports the rows behind it',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'ask.csv', admin, { v: 'how many hires this year' });
          if (!r.ok) {
            /* A dataset with no hires in the window is a legitimate answer. */
            includes(String(r.error), 'no records');
            return;
          }
          const dl = (r as { download?: { text?: string } }).download;
          ok(dl?.text?.startsWith('﻿'), 'a spreadsheet Excel reads');
          includes(dl!.text!, 'department,function,recruiter');
        });
      },
    },

    {
      name: 'a question with no figure in it has nothing to export',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'ask.csv', admin, { v: 'hello' }), 'no figure');
        });
      },
    },

    /* ── The interview recording ───────────────────────────────────────── */
    {
      name: 'an interview nobody recorded cannot be reviewed',
      async fn() {
        await inRollback(async (tx) => {
          const id = await oneId(tx, sql`
            SELECT id FROM interviews WHERE NOT recorded AND status <> 'cancelled' LIMIT 1`);
          if (!id) return;
          refused(await runIn(tx, 'ivr.analyse', admin, { v: id }), 'not recorded');
        });
      },
    },

    {
      name: 'a recorded interview is reviewed, or says what is missing',
      async fn() {
        await inRollback(async (tx) => {
          const id = await oneId(tx, sql`
            SELECT id FROM interviews
             WHERE recorded AND (recording_file_id IS NOT NULL OR recording_ref IS NOT NULL)
             LIMIT 1`);
          if (!id) return;

          const r = await runIn(tx, 'ivr.analyse', admin, { v: id });
          if (providers().ai.configured) {
            succeeded(r, 'ivr.analyse');
            const [iv] = await tx.select().from(interviews).where(eq(interviews.id, id));
            ok(iv.reviewedAt, 'the review is on the record');
          } else {
            /* Rather than the prototype's behaviour, which produced six
               ratings out of a hash of the interview id. */
            refused(r, 'no model is configured');
          }
        });
      },
    },

    /* ── Chasing a joiner ──────────────────────────────────────────────── */
    {
      name: 'a joiner with nothing outstanding is not chased',
      async fn() {
        await inRollback(async (tx) => {
          const id = await oneId(tx, sql`
            SELECT e.id FROM employees e
             WHERE NOT EXISTS (
               SELECT 1 FROM onboarding_documents d
                WHERE d.employee_id = e.id AND d.status IN ('missing', 'rejected'))
               AND EXISTS (SELECT 1 FROM onboarding_records r
                            WHERE r.employee_id = e.id AND r.form_submitted_at IS NOT NULL)
             LIMIT 1`);
          if (!id) return;
          refused(await runIn(tx, 'emp.remind', onboarder, { v: id }), 'nothing to chase');
        });
      },
    },

    {
      name: 'a joiner who owes something is chased, and the message is honest about how',
      async fn() {
        await inRollback(async (tx) => {
          /* Outstanding means the joiner still owes us something: a document
             they have not sent, one that was sent back, or the form itself.
             A document they have sent and nobody has verified yet is the
             desk's to do, not theirs — chasing them for it would be wrong. */
          const id = await oneId(tx, sql`
            SELECT DISTINCT e.id FROM employees e
              JOIN onboarding_documents d ON d.employee_id = e.id
             WHERE d.status IN ('missing', 'rejected') LIMIT 1`);
          if (!id) return;

          const r = await runIn(tx, 'emp.remind', onboarder, { v: id });
          succeeded(r, 'emp.remind');
          const toast = String((r as { toast?: string }).toast);
          const sent = providers().whatsapp.configured || providers().email.configured;
          if (sent) includes(toast, 'Reminder sent');
          else includes(toast, 'Written to the thread');
        });
      },
    },

    /* ── Settings ──────────────────────────────────────────────────────── */
    {
      name: 'a copied pitch project arrives switched off, so nobody sends a draft',
      async fn() {
        await inRollback(async (tx) => {
          const [p] = await tx.select().from(pitchProjects).limit(1);
          if (!p) return;

          succeeded(await runIn(tx, 'pp.copy', admin, { v: p.id }), 'pp.copy');
          const [copy] = await tx.select().from(pitchProjects)
            .where(eq(pitchProjects.name, `${p.name} (copy)`));
          ok(copy, 'the copy exists');
          equals(copy.active, false);
          equals(copy.uses, 0);
          equals(copy.brief, p.brief, 'and it is the same brief');
        });
      },
    },

    {
      name: 'restoring every SLA asks first, and then there are no overrides left',
      async fn() {
        await inRollback(async (tx) => {
          const [p] = await tx.select().from(pipelines).limit(1);
          await tx.update(pipelines).set({ slaOverrides: { iv1: 9 } }).where(eq(pipelines.id, p.id));

          const asked = await runIn(tx, 'set.slaReset', admin, {});
          succeeded(asked);
          ok((asked as { confirm?: unknown }).confirm, 'it asked before doing it');

          succeeded(await runIn(tx, 'set.slaReset', admin, { fields: { confirmed: '1' } }));
          const after = await tx.select().from(pipelines);
          equals(after.filter((x) => Object.keys(x.slaOverrides ?? {}).length).length, 0);

          refused(await runIn(tx, 'set.slaReset', admin, { fields: { confirmed: '1' } }),
            'already at their defaults');
        });
      },
    },

    /* ── The candidate record ──────────────────────────────────────────── */
    {
      name: 'taking a photograph off leaves the monogram, and refuses when there is none',
      async fn() {
        await inRollback(async (tx) => {
          const withPhoto = await oneId(tx, sql`
            SELECT id FROM candidates WHERE photo IS NOT NULL LIMIT 1`);
          if (withPhoto) {
            succeeded(await runIn(tx, 'photo.remove', recruiter, { v: withPhoto }), 'photo.remove');
            const [c] = await tx.select().from(candidates).where(eq(candidates.id, withPhoto));
            equals(c.photo, null);
            equals(c.photoFileId, null);
            refused(await runIn(tx, 'photo.remove', recruiter, { v: withPhoto }), 'no photograph');
          }

          const none = await oneId(tx, sql`
            SELECT id FROM candidates WHERE photo IS NULL AND photo_file_id IS NULL LIMIT 1`);
          if (none) refused(await runIn(tx, 'photo.remove', recruiter, { v: none }), 'no photograph');
        });
      },
    },

    {
      name: 'a CV comes back as a link or as the reading, and the access is recorded',
      async fn() {
        await inRollback(async (tx) => {
          const id = await oneId(tx, sql`
            SELECT candidate_id AS id FROM candidate_resumes LIMIT 1`);
          if (!id) return;

          const r = await runIn(tx, 'resume.download', recruiter, { v: id });
          succeeded(r, 'resume.download');
          const dl = (r as { download?: { url?: string; text?: string; name?: string } }).download;
          ok(dl, 'something came back');
          ok(dl!.url || dl!.text, 'either the file or the reading of it');

          const [seen] = rowsOf(await tx.execute(sql`
            SELECT count(*)::int AS n FROM audit_events
             WHERE entity_type = 'candidate' AND entity_id = ${id} AND action = 'read'`)) as
            Array<{ n: number }>;
          ok(seen.n > 0, 'and who read it is on the trail');
        });
      },
    },

    {
      name: 'the sector is read from the record, and a recruiter may say otherwise',
      async fn() {
        await inRollback(async (tx) => {
          const id = await oneId(tx, sql`
            SELECT id FROM candidates WHERE current_company IS NOT NULL LIMIT 1`);
          if (!id) return;

          const read = await runIn(tx, 'cv.sector', recruiter, { v: id });
          succeeded(read, 'cv.sector');

          succeeded(await runIn(tx, 'cv.sector', recruiter, {
            v: id, fields: { sector: 'Real estate' },
          }), 'set by hand');
          const [c] = await tx.select().from(candidates).where(eq(candidates.id, id));
          equals(c.sector, 'Real estate');
          equals(c.sectorSource, 'recruiter', 'recorded as theirs, not as the CV’s');
        });
      },
    },

    /* ── The careers form ──────────────────────────────────────────────── */
    {
      name: 'a bank question is added once, and refused the second time',
      async fn() {
        await inRollback(async (tx) => {
          const jobId = await oneId(tx, sql`SELECT id FROM jobs WHERE status = 'open' LIMIT 1`);
          const [q] = rowsOf(await tx.execute(sql`
            SELECT b.id FROM question_bank b
             WHERE b.archived_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM job_questions j
                                WHERE j.job_id = ${jobId} AND j.bank_id = b.id)
             LIMIT 1`)) as Array<{ id: string }>;
          if (!q) return;

          succeeded(await runIn(tx, 'jq.add', admin, { v: `${jobId}|${q.id}` }), 'jq.add');
          const [on] = await tx.select().from(jobQuestions).where(and(
            eq(jobQuestions.jobId, jobId), eq(jobQuestions.bankId, q.id),
          ));
          ok(on, 'it is on the form');

          refused(await runIn(tx, 'jq.add', admin, { v: `${jobId}|${q.id}` }), 'already on this form');
        });
      },
    },
  ],
};

export default suite;
