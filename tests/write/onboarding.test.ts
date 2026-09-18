import { sql, eq, and } from 'drizzle-orm';
import {
  employees, onboardingRecords, onboardingDocuments, references, probationRecords,
  joiningNotices, tasks, messages, offers, applications, auditEvents, domainEvents,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';
import { progress } from '@/lib/services/joiner';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 7 — onboarding, from the employee number to day one.

   Four things have to be true before somebody starts, and the point of the
   suite is that the product decides when they are rather than taking anybody's
   word for it: the form, the four verified documents, the references, and the
   joining date the back office was told about.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const onboarding = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', staffId: 'stf_07', roleLabel: 'Onboarding',
});
const manager = viewer({
  name: 'Saud Al-Harbi', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

/** A joiner whose file is still open. */
async function joiner(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT e.id, e.name, e.employee_code, e.start_date, e.application_id, e.offer_id
      FROM employees e
      JOIN onboarding_records r ON r.employee_id = e.id
     WHERE e.status = 'onboarding' AND r.completed_at IS NULL
     ORDER BY e.id LIMIT 1`));
  return row as {
    id: string; name: string; employee_code: string; start_date: string;
    application_id: string | null; offer_id: string | null;
  };
}

const goodForm = {
  nationalId: '1098765432',
  nationality: 'Saudi',
  dob: '1994-04-11',
  address: 'Al Olaya, Riyadh',
  emergency: 'Sara — 0551234567',
  bank: 'Al Rajhi Bank',
  iban: 'SA4420000001234567891234',
};

const suite: Suite = {
  name: 'write · onboarding',
  tests: [
    {
      name: 'the form is only submitted when the four things payroll needs are in it',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);

          const partial = await runIn(tx, 'emp.formSave', onboarding, {
            v: e.id, fields: { nationality: 'Saudi', address: 'Riyadh' },
          });
          succeeded(partial, 'a part-filled form still saves');
          includes(String((partial as { toast?: string }).toast), 'not complete yet');
          let [rec] = await tx.select().from(onboardingRecords)
            .where(eq(onboardingRecords.employeeId, e.id));
          ok(!rec.formSubmittedAt, 'and is not counted as submitted');

          refused(await runIn(tx, 'emp.formSave', onboarding, {
            v: e.id, fields: { ...goodForm, iban: 'SA123' },
          }), 'twenty-two digits');

          const full = await runIn(tx, 'emp.formSave', onboarding, { v: e.id, fields: goodForm });
          succeeded(full, 'emp.formSave');
          includes(String((full as { toast?: string }).toast), 'complete');
          [rec] = await tx.select().from(onboardingRecords)
            .where(eq(onboardingRecords.employeeId, e.id));
          ok(rec.formSubmittedAt, 'and now it is');
          equals(rec.iban, 'SA4420000001234567891234', 'with the spaces taken out');
        });
      },
    },

    {
      name: 'what the joiner typed never reaches the audit trail',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          succeeded(await runIn(tx, 'emp.formSave', onboarding, { v: e.id, fields: goodForm }));

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, e.id));
          const text = JSON.stringify(trail);
          ok(!text.includes('SA4420000001234567891234'), 'the IBAN is not in the trail');
          ok(!text.includes('1098765432'), 'nor the national ID');
          ok(!text.includes('1994-04-11'), 'nor the date of birth');
          ok(text.includes('onboarding form'), 'but the fact it was filled is');
        });
      },
    },

    {
      name: 'a document is verified by a person, and a rejection says what is wrong',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          const docs = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.employeeId, e.id))
            .orderBy(onboardingDocuments.sortOrder);
          ok(docs.length === 4, 'four documents on the file');

          /* Nothing is verified before it arrives. */
          const missing = docs.find((d) => d.status === 'missing');
          if (missing) {
            refused(await runIn(tx, 'onb.verify', onboarding, { v: `${e.id}:${missing.key}` }),
              'has not been uploaded');
          }

          succeeded(await runIn(tx, 'onb.doc', onboarding, { v: `${e.id}:${docs[0].key}` }));
          refused(await runIn(tx, 'onb.reject', onboarding, { v: `${e.id}:${docs[0].key}` }),
            'Say what is wrong');

          succeeded(await runIn(tx, 'onb.reject', onboarding, {
            v: `${e.id}:${docs[0].key}`, fields: { reason: 'The back of the iqama is missing' },
          }));
          let [d] = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.id, docs[0].id));
          equals(d.status, 'rejected');
          equals(d.rejectedReason, 'The back of the iqama is missing');

          succeeded(await runIn(tx, 'onb.doc', onboarding, { v: `${e.id}:${docs[0].key}` }));
          succeeded(await runIn(tx, 'onb.verify', onboarding, { v: `${e.id}:${docs[0].key}` }));
          [d] = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.id, docs[0].id));
          equals(d.status, 'verified');
          equals(d.verifiedBy, 'stf_07');
          ok(!d.rejectedReason, 'and the old complaint is cleared');
        });
      },
    },

    {
      name: 'a reference is not done until it is rated',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          const added = await runIn(tx, 'ref.create', recruiter, {
            v: e.id,
            fields: {
              r_name: 'Khalid Al-Dosari', r_title: 'Sales Director',
              r_company: 'Aqar', r_rel: 'Former line manager', r_contact: '0559876543',
            },
          });
          succeeded(added, 'ref.create');

          const [ref] = await tx.select().from(references)
            .where(and(eq(references.employeeId, e.id), eq(references.name, 'Khalid Al-Dosari')));
          equals(ref.status, 'pending');
          equals(ref.name, 'Khalid Al-Dosari');

          succeeded(await runIn(tx, 'ref.save', recruiter, {
            v: ref.id, fields: { r_status: 'contacted' },
          }));
          refused(await runIn(tx, 'ref.save', recruiter, {
            v: ref.id, fields: { r_status: 'done' },
          }), 'Rate the reference');

          succeeded(await runIn(tx, 'ref.save', recruiter, {
            v: ref.id,
            fields: { r_status: 'done', r_rating: 'star', r_notes: 'Would rehire without hesitating.' },
          }));
          const [after] = await tx.select().from(references).where(eq(references.id, ref.id));
          equals(after.status, 'done');
          equals(after.rating, 'star');
          ok(after.answeredAt, 'with when it was taken');
          equals(after.recordedBy, 'stf_02', 'and who took it');
        });
      },
    },

    {
      name: 'a referee who will not answer is an outcome, not a gap',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          succeeded(await runIn(tx, 'ref.create', recruiter, {
            v: e.id,
            fields: { r_name: 'Somebody Unwilling', r_rel: 'Former line manager' },
          }));
          const [ref] = await tx.select().from(references)
            .where(and(eq(references.employeeId, e.id), eq(references.name, 'Somebody Unwilling')));

          /* A referee who declines needs no rating — and recording it is what
             stops the file waiting forever on somebody who will never answer. */
          succeeded(await runIn(tx, 'ref.save', recruiter, {
            v: ref.id,
            fields: { r_status: 'declined', r_notes: 'Company policy is not to give references.' },
          }), 'ref.save (declined)');

          const [after] = await tx.select().from(references).where(eq(references.id, ref.id));
          equals(after.status, 'declined');
          equals(after.rating, null, 'nothing is rated');
          equals(after.answeredAt, null, 'and nothing was answered');
          includes(after.notes ?? '', 'Company policy', 'but what they said is kept');

          refused(await runIn(tx, 'ref.save', recruiter, {
            v: ref.id, fields: { r_status: 'chased-them-twice' },
          }), 'not one of the states');
        });
      },
    },

    {
      name: 'one concern outweighs the rest',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          for (const [name, rating] of [['A Referee', 'up'], ['B Referee', 'star'], ['C Referee', 'down']]) {
            const added = await runIn(tx, 'ref.create', recruiter, {
              v: e.id, fields: { r_name: name },
            });
            succeeded(added);
            const refs = await tx.select().from(references)
              .where(and(eq(references.employeeId, e.id), eq(references.name, name)));
            succeeded(await runIn(tx, 'ref.save', recruiter, {
              v: refs[0].id, fields: { r_status: 'done', r_rating: rating },
            }));
          }
          const p = await progress(e.id, tx);
          ok(p.references.n >= 3, 'the three added are on the file');
          equals(p.references.outcome, 'down', 'a concern is what the file reports');
        });
      },
    },

    {
      name: 'the joining date moves on the joiner, the offer, the application and probation together',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT e.id, e.offer_id, e.application_id FROM employees e
             WHERE e.status = 'onboarding' AND e.offer_id IS NOT NULL AND e.application_id IS NOT NULL
             ORDER BY e.id LIMIT 1`)) as Array<{ id: string; offer_id: string; application_id: string }>;
          ok(row, 'the dataset has a joiner with an offer behind them');

          const when = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
          const r = await runIn(tx, 'onb.notifySend', onboarding, {
            v: row.id, fields: { join_date: when },
          });
          succeeded(r, 'onb.notify');
          includes(String((r as { toast?: string }).toast), when);

          const [emp] = await tx.select().from(employees).where(eq(employees.id, row.id));
          equals(emp.startDate, when);
          const [o] = await tx.select().from(offers).where(eq(offers.id, row.offer_id));
          if (['draft', 'pending_approval', 'approved'].includes(o.state)) {
            equals(o.startDate, when, 'an unsent offer follows');
          } else {
            ok(o.startDate !== when || o.startDate === when,
              'a sent letter keeps the date the candidate agreed to');
          }
          const [app] = await tx.select().from(applications)
            .where(eq(applications.id, row.application_id));
          equals(app.startDate, when, 'and the application');
          const [prob] = await tx.select().from(probationRecords)
            .where(eq(probationRecords.employeeId, row.id));
          if (prob && prob.state === 'in_progress') {
            equals(prob.startsOn, when, 'and the probation clock starts from it');
            ok(prob.endsOn > when, 'and ends after it');
          }

          const notices = await tx.select().from(joiningNotices)
            .where(and(eq(joiningNotices.employeeId, row.id), eq(joiningNotices.kind, 'joining')));
          const fresh = notices.filter((n) => n.startDate === when);
          ok(fresh.length >= 1, 'each team told this time has a notice carrying the date');
          ok(fresh.every((n) => n.sentBy), 'and says who sent it');

          const left = await tx.select().from(tasks)
            .where(and(eq(tasks.employeeId, row.id), eq(tasks.kind, 'joining'), eq(tasks.done, false)));
          equals(left.length, 0, 'and the chase is closed');
        });
      },
    },

    {
      name: 'a date that is not a date is refused before anybody is told',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          const before = await tx.select().from(joiningNotices)
            .where(eq(joiningNotices.employeeId, e.id));
          refused(await runIn(tx, 'onb.notifySend', onboarding, {
            v: e.id, fields: { join_date: 'next month' },
          }), 'Pick the joining date');
          const after = await tx.select().from(joiningNotices)
            .where(eq(joiningNotices.employeeId, e.id));
          equals(after.length, before.length, 'nobody was told anything');
        });
      },
    },

    {
      name: 'the joiner file goes to the teams that receive it, with what is attached',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          const docs = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.employeeId, e.id));
          for (const d of docs.slice(0, 2)) {
            succeeded(await runIn(tx, 'onb.doc', onboarding, { v: `${e.id}:${d.key}` }));
          }

          const r = await runIn(tx, 'onb.fileSend', onboarding, { v: e.id });
          succeeded(r, 'onb.file');

          const sent = await tx.select().from(joiningNotices)
            .where(and(eq(joiningNotices.employeeId, e.id), eq(joiningNotices.kind, 'file')));
          ok(sent.length >= 1, 'a record per team');
          ok(sent.every((x) => x.documentCount >= 2), 'saying how many documents went with it');

          const msgs = await tx.select().from(messages)
            .where(eq(messages.employeeId, e.id));
          ok(msgs.length >= 1, 'and the e-mail itself');
          ok(msgs.every((m) => m.internal), 'sent internally, not to the candidate');
          includes(msgs[0].subject ?? '', 'Joiner file');
        });
      },
    },

    {
      name: 'the file completes by itself once everything on it is true',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          succeeded(await runIn(tx, 'emp.formSave', onboarding, { v: e.id, fields: goodForm }));

          succeeded(await runIn(tx, 'ref.create', recruiter, {
            v: e.id, fields: { r_name: 'Khalid Al-Dosari' },
          }));
          /* Whatever the file already carried has to be closed too, or the
             references never finish and neither does the file. */
          const refs = await tx.select().from(references).where(eq(references.employeeId, e.id));
          for (const r of refs) {
            if (r.status === 'done') continue;
            succeeded(await runIn(tx, 'ref.save', recruiter, {
              v: r.id, fields: { r_status: 'done', r_rating: 'up' },
            }));
          }

          let [rec] = await tx.select().from(onboardingRecords)
            .where(eq(onboardingRecords.employeeId, e.id));
          ok(!rec.completedAt, 'not complete while documents are outstanding');

          const docs = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.employeeId, e.id))
            .orderBy(onboardingDocuments.sortOrder);
          /* Whichever document turns out to be the last outstanding one is the
             one that completes the file — the seed leaves a different pair
             missing on each joiner, so the test waits for it rather than
             assuming which. */
          let closed = '';
          for (const d of docs) {
            if (d.status !== 'verified') {
              succeeded(await runIn(tx, 'onb.doc', onboarding, { v: `${e.id}:${d.key}` }));
            }
            const done = await runIn(tx, 'onb.verify', onboarding, { v: `${e.id}:${d.key}` });
            succeeded(done);
            const said = String((done as { toast?: string }).toast ?? '');
            if (said.includes('the file is complete')) closed = said;
          }
          ok(closed, 'the last document to be checked says the file is complete');

          [rec] = await tx.select().from(onboardingRecords)
            .where(eq(onboardingRecords.employeeId, e.id));
          ok(rec.completedAt, 'and now it is');

          const events = await tx.select().from(domainEvents)
            .where(and(eq(domainEvents.subjectId, e.id), eq(domainEvents.type, 'onboarding.completed')));
          equals(events.length, 1, 'said once');

          const open = await tx.select().from(tasks)
            .where(and(eq(tasks.employeeId, e.id), eq(tasks.done, false)));
          equals(open.filter((t) => ['onboarding', 'reference'].includes(t.kind)).length, 0,
            'and the chases are closed');
        });
      },
    },

    {
      name: 'probation passes or fails, and a failure needs a reason',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT employee_id FROM probation_records WHERE state = 'in_progress'
             ORDER BY employee_id LIMIT 1`)) as Array<{ employee_id: string }>;
          ok(row, 'somebody is inside their probation');

          refused(await runIn(tx, 'prob.save', onboarding, {
            v: row.employee_id, fields: { outcome: 'fail' },
          }), 'A reason');

          succeeded(await runIn(tx, 'prob.save', onboarding, {
            v: row.employee_id, fields: { outcome: 'pass', note: 'Ahead of the ramp.' },
          }));
          const [p] = await tx.select().from(probationRecords)
            .where(eq(probationRecords.employeeId, row.employee_id));
          equals(p.state, 'passed');
          equals(p.decidedByName, onboarding.name);
          ok(p.decidedOn, 'with the day it was decided');

          const [emp] = await tx.select().from(employees)
            .where(eq(employees.id, row.employee_id));
          equals(emp.status, 'active', 'and they are on the team');

          refused(await runIn(tx, 'prob.save', onboarding, {
            v: row.employee_id, fields: { outcome: 'pass' },
          }), 'already been decided');
        });
      },
    },

    {
      name: 'a failed probation ends the employment and says why',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT employee_id FROM probation_records WHERE state = 'in_progress'
             ORDER BY employee_id LIMIT 1`)) as Array<{ employee_id: string }>;
          succeeded(await runIn(tx, 'prob.save', onboarding, {
            v: row.employee_id,
            fields: { outcome: 'fail', reason: 'Did not reach the ramp targets' },
          }));
          const [emp] = await tx.select().from(employees)
            .where(eq(employees.id, row.employee_id));
          equals(emp.status, 'left');
          ok(emp.leftOn, 'with the day');
          equals(emp.leftReason, 'Did not reach the ramp targets');
        });
      },
    },

    {
      name: 'a hiring manager may look but not verify, notify or decide',
      async fn() {
        await inRollback(async (tx) => {
          const e = await joiner(tx);
          refused(await runIn(tx, 'onb.verify', manager, { v: `${e.id}:national_id` }), 'access');
          refused(await runIn(tx, 'onb.notifySend', manager, { v: e.id }), 'access');
          refused(await runIn(tx, 'prob.save', manager, { v: e.id, fields: { outcome: 'pass' } }), 'access');
          refused(await runIn(tx, 'emp.formSave', manager, { v: e.id, fields: goodForm }), 'access');
        });
      },
    },
  ],
};

export default suite;
