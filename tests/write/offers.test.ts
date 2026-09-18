import { sql, eq, and } from 'drizzle-orm';
import {
  offers, offerDocuments, offerSignatures, offerLetterEdits, applications, employees,
  probationRecords, onboardingDocuments, tasks, messages, accessLinks, jobs,
  auditEvents, domainEvents, approvalSteps, approvals,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 6 — the offer, from the draft to the employee number.

   The longest flow in the product and the one with the most ways to get it
   wrong, so the suite walks the whole road once and then tests each guard on
   its own: the chain, the verification, the four documents, the immutability of
   a sent letter, and the single hire.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const onboarding = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', staffId: 'stf_07', roleLabel: 'Onboarding',
});
const manager = viewer({
  name: 'Saud Al-Harbi', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

/** A live application with no offer on it yet. */
async function offerless(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.candidate_id, a.job_id, c.name AS candidate, j.title, j.salary_min, j.salary_max
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN candidates c ON c.id = a.candidate_id
     WHERE a.status = 'active' AND j.status = 'open' AND c.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.application_id = a.id)
     ORDER BY a.id LIMIT 1`));
  return row as {
    id: string; candidate_id: string; job_id: string; candidate: string;
    title: string; salary_min: number; salary_max: number;
  };
}

const idOf = (r: unknown) => String((r as { data?: Record<string, unknown> }).data?.offerId);

/** Draft, approve and verify, so a test can start from "ready to send". */
async function readyToSend(tx: Parameters<typeof runIn>[0], base = 12000) {
  const a = await offerless(tx);
  const drafted = await runIn(tx, 'offer.draft', recruiter, {
    v: a.id, fields: { baseMonthly: String(base) },
  });
  succeeded(drafted, 'offer.draft');
  const offerId = idOf(drafted);
  succeeded(await runIn(tx, 'offer.submit', recruiter, { v: offerId }), 'offer.submit');
  /* The hiring-manager step is recorded automatically; the Head of TA is not. */
  succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }), 'offer.approve');
  succeeded(await runIn(tx, 'offer.verifyConfirm', onboarding, { v: offerId }), 'offer.verifyConfirm');
  return { application: a, offerId };
}

/** Everything the envelope asks for, so the candidate can sign. */
async function uploadAll(tx: Parameters<typeof runIn>[0], offerId: string) {
  const docs = await tx.select().from(offerDocuments).where(eq(offerDocuments.offerId, offerId));
  for (const d of docs) {
    succeeded(await runIn(tx, 'offer.doc', recruiter, { v: `${offerId}:${d.key}` }));
  }
}

const suite: Suite = {
  name: 'write · offers',
  tests: [
    {
      name: 'drafting fills the letter, moves the application and asks Onboarding to check it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await offerless(tx);
          const r = await runIn(tx, 'offer.draft', recruiter, { v: a.id });
          succeeded(r, 'offer.draft');
          const offerId = idOf(r);

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.state, 'draft');
          equals(o.version, 1);
          ok(o.reference.startsWith('OFF-'), 'it carries a reference');
          ok(o.baseMonthly > 0, 'with a basic salary');
          ok(o.housing > 0 && o.transport > 0, 'and the allowances');
          ok(o.startDate >= new Date().toISOString().slice(0, 10), 'and a start date ahead');

          const [app] = await tx.select().from(applications).where(eq(applications.id, a.id));
          equals(app.stage, 'offer', 'the application follows the offer onto the stage');

          const sigs = await tx.select().from(offerSignatures)
            .where(eq(offerSignatures.offerId, offerId));
          equals(sigs.length, 1, 'only the candidate signs');
          equals(sigs[0].state, 'not_sent');

          const todo = await tx.select().from(tasks).where(eq(tasks.offerId, offerId));
          equals(todo.length, 1, 'somebody is asked to verify the letter');
          equals(todo[0].kind, 'verify_offer');
        });
      },
    },

    {
      name: 'a second offer on the same application is refused — revise the first',
      async fn() {
        await inRollback(async (tx) => {
          const a = await offerless(tx);
          succeeded(await runIn(tx, 'offer.draft', recruiter, { v: a.id }));
          refused(await runIn(tx, 'offer.draft', recruiter, { v: a.id }), 'revise it rather than');
        });
      },
    },

    {
      name: 'the chain runs in order, and only the named approver may decide',
      async fn() {
        await inRollback(async (tx) => {
          const a = await offerless(tx);
          const drafted = await runIn(tx, 'offer.draft', recruiter, {
            v: a.id, fields: { baseMonthly: '12000' },
          });
          const offerId = idOf(drafted);

          const r = await runIn(tx, 'offer.submit', recruiter, { v: offerId });
          succeeded(r, 'offer.submit');
          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.state, 'pending_approval');

          const [approval] = await tx.select().from(approvals)
            .where(and(eq(approvals.subject, 'offer'), eq(approvals.subjectId, offerId)));
          const steps = await tx.select().from(approvalSteps)
            .where(eq(approvalSteps.approvalId, approval.id))
            .orderBy(approvalSteps.ordinal);
          equals(steps.length, 2, 'two steps under the finance threshold');
          equals(steps[0].state, 'approved', 'the hiring manager step is recorded automatically');
          equals(steps[1].label, 'Head of TA');

          /* A recruiter does not approve offers at all — the capability is not
             in their set, so the dispatcher refuses before the chain is read. */
          refused(await runIn(tx, 'offer.approve', recruiter, { v: offerId }), 'does not include');

          succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }));
          const [after] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(after.state, 'approved');
        });
      },
    },

    {
      name: 'a big package brings Finance into the chain',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND j.status = 'open'
               AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.application_id = a.id)
             ORDER BY a.id LIMIT 1`)) as Array<{ id: string }>;
          const drafted = await runIn(tx, 'offer.draft', admin, {
            v: row.id, fields: { baseMonthly: '45000' },
          });
          const offerId = idOf(drafted);
          succeeded(await runIn(tx, 'offer.submit', admin, { v: offerId }));

          const [approval] = await tx.select().from(approvals)
            .where(and(eq(approvals.subject, 'offer'), eq(approvals.subjectId, offerId)));
          const steps = await tx.select().from(approvalSteps)
            .where(eq(approvalSteps.approvalId, approval.id))
            .orderBy(approvalSteps.ordinal);
          equals(steps.length, 3, 'the finance step applies above thirty thousand');
          equals(steps[2].label, 'Finance');
          equals(steps[2].approverName, 'Nadia Kassem');
          ok(steps[2].conditionText, 'and the condition is on the record');

          /* An Admin may decide a step that belongs to somebody else, and the
             record says on whose behalf. */
          succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }),
            'the Head of TA step is theirs');
          succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }),
            'and Finance can be recorded for them');
          const [finance] = await tx.select().from(approvalSteps)
            .where(eq(approvalSteps.id, steps[2].id));
          equals(finance.state, 'approved');
          equals(finance.onBehalfOf, 'Nadia Kassem');
          equals(finance.decidedByName, admin.name);
        });
      },
    },

    {
      name: 'sending is refused until the chain closes and the letter is verified',
      async fn() {
        await inRollback(async (tx) => {
          const a = await offerless(tx);
          const drafted = await runIn(tx, 'offer.draft', recruiter, {
            v: a.id, fields: { baseMonthly: '12000' },
          });
          const offerId = idOf(drafted);

          refused(await runIn(tx, 'offer.send', recruiter, { v: offerId }), 'not yet submitted');
          succeeded(await runIn(tx, 'offer.submit', recruiter, { v: offerId }));
          refused(await runIn(tx, 'offer.send', recruiter, { v: offerId }), 'chain still open');
          succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }));
          refused(await runIn(tx, 'offer.send', recruiter, { v: offerId }), 'not yet verified');
          succeeded(await runIn(tx, 'offer.verifyConfirm', onboarding, { v: offerId }));
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));
        });
      },
    },

    {
      name: 'only Onboarding or an Admin verifies a letter',
      async fn() {
        await inRollback(async (tx) => {
          const a = await offerless(tx);
          const drafted = await runIn(tx, 'offer.draft', recruiter, {
            v: a.id, fields: { baseMonthly: '12000' },
          });
          const offerId = idOf(drafted);
          succeeded(await runIn(tx, 'offer.submit', recruiter, { v: offerId }));
          succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }));

          refused(await runIn(tx, 'offer.verifyConfirm', recruiter, { v: offerId }), 'does not include');
          refused(await runIn(tx, 'offer.verifyConfirm', manager, { v: offerId }), 'access');
          succeeded(await runIn(tx, 'offer.verifyConfirm', onboarding, { v: offerId }));

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          ok(o.verifiedAt, 'and it records when');
          equals(o.verifiedBy, 'stf_07', 'and by whom');
        });
      },
    },

    {
      name: 'a correction re-opens the letter and is kept with what it changed from',
      async fn() {
        await inRollback(async (tx) => {
          const { offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.editSave', onboarding, {
            v: offerId, fields: { f_start_date: '1 March 2027' },
          }));

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          ok(!o.verifiedAt, 'correcting it un-verifies it');
          equals(o.fieldOverrides.start_date, '1 March 2027');

          const edits = await tx.select().from(offerLetterEdits)
            .where(eq(offerLetterEdits.offerId, offerId));
          equals(edits.length, 1);
          equals(edits[0].field, 'start_date');
          equals(edits[0].byName, onboarding.name);

          refused(await runIn(tx, 'offer.send', recruiter, { v: offerId }), 'not yet verified');
        });
      },
    },

    {
      name: 'sending opens the envelope, mints the candidate’s link and asks for four documents',
      async fn() {
        await inRollback(async (tx) => {
          const { application, offerId } = await readyToSend(tx);
          const r = await runIn(tx, 'offer.send', recruiter, { v: offerId });
          succeeded(r, 'offer.send');

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.state, 'sent');
          ok(o.sentAt, 'with a date');
          ok(o.expiresAt, 'and an expiry');
          /* No e-signature provider is configured in a test environment. */
          ok(o.esignProvider === null, 'and no envelope is claimed');
          includes(String((r as { toast?: string }).toast), 'No e-signature provider is configured');

          const docs = await tx.select().from(offerDocuments)
            .where(eq(offerDocuments.offerId, offerId));
          equals(docs.length, 4, 'the four documents');
          ok(docs.every((d) => d.status === 'missing'), 'none of them in yet');

          const [link] = await tx.select().from(accessLinks)
            .where(and(eq(accessLinks.subjectId, offerId), eq(accessLinks.purpose, 'offer')));
          ok(link, 'the candidate has a way in');
          equals(link.tokenHash.length, 64, 'stored as a hash');

          const [msg] = await tx.select().from(messages)
            .where(eq(messages.applicationId, application.id))
            .orderBy(sql`${messages.at} DESC`).limit(1);
          includes(msg.subject ?? '', 'Your offer from Bayut KSA');
        });
      },
    },

    {
      name: 'nobody signs until all four documents are in',
      async fn() {
        await inRollback(async (tx) => {
          const { offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));

          refused(await runIn(tx, 'offer.recordSigned', recruiter, { v: offerId }),
            'still missing on the envelope');

          const docs = await tx.select().from(offerDocuments)
            .where(eq(offerDocuments.offerId, offerId)).orderBy(offerDocuments.sortOrder);
          const first = await runIn(tx, 'offer.doc', recruiter, { v: `${offerId}:${docs[0].key}` });
          succeeded(first);
          includes(String((first as { toast?: string }).toast), '3 more to go');

          for (const d of docs.slice(1, 3)) {
            succeeded(await runIn(tx, 'offer.doc', recruiter, { v: `${offerId}:${d.key}` }));
          }
          refused(await runIn(tx, 'offer.recordSigned', recruiter, { v: offerId }),
            'is still missing');

          const last = await runIn(tx, 'offer.doc', recruiter, { v: `${offerId}:${docs[3].key}` });
          includes(String((last as { toast?: string }).toast), 'all four in');
          succeeded(await runIn(tx, 'offer.recordSigned', recruiter, { v: offerId }));

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.state, 'signed');
          ok(o.signedAt, 'with the moment it was signed');
        });
      },
    },

    {
      name: 'acceptance hires once and issues an employee number',
      async fn() {
        await inRollback(async (tx) => {
          const { application, offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));
          await uploadAll(tx, offerId);
          succeeded(await runIn(tx, 'offer.recordSigned', recruiter, { v: offerId }));

          const [jobBefore] = await tx.select().from(jobs)
            .where(eq(jobs.id, application.job_id));

          const r = await runIn(tx, 'offer.accept', recruiter, { v: offerId });
          succeeded(r, 'offer.accept');
          includes(String((r as { toast?: string }).toast), 'BYT-');

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.state, 'accepted');
          equals(o.responseState, 'accepted');

          const [app] = await tx.select().from(applications)
            .where(eq(applications.id, application.id));
          equals(app.status, 'hired');
          equals(app.stage, 'joined');
          ok(app.closedAt, 'and closed');
          equals(app.startDate, o.startDate, 'the start date comes off the offer');

          const [jobAfter] = await tx.select().from(jobs).where(eq(jobs.id, application.job_id));
          equals(jobAfter.filled, jobBefore.filled + 1, 'the seat is filled');

          const [emp] = await tx.select().from(employees)
            .where(eq(employees.applicationId, application.id));
          ok(emp, 'the employee record exists');
          ok(emp.employeeCode.startsWith('BYT-'), 'with a number');
          equals(emp.status, 'onboarding');
          equals(emp.startDate, o.startDate);

          const [prob] = await tx.select().from(probationRecords)
            .where(eq(probationRecords.employeeId, emp.id));
          ok(prob, 'and a probation clock');
          equals(prob.state, 'in_progress');
          ok(prob.endsOn > prob.startsOn, 'running forward from the start date');

          const files = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.employeeId, emp.id));
          equals(files.length, 4, 'the four documents follow them onto their file');
          ok(files.every((f) => f.status === 'uploaded'), 'as uploaded, still to be verified');

          /* A second press changes nothing and says so. */
          refused(await runIn(tx, 'offer.accept', recruiter, { v: offerId }), 'already accepted');
          const all = await tx.select().from(employees)
            .where(eq(employees.applicationId, application.id));
          equals(all.length, 1, 'one employee, not two');
        });
      },
    },

    {
      name: 'a decline needs one of the reasons Insights counts',
      async fn() {
        await inRollback(async (tx) => {
          const { offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));

          refused(await runIn(tx, 'offer.declineSave', recruiter, {
            v: offerId, fields: { why: 'They just said no' },
          }), 'Pick one of the reasons');

          const r = await runIn(tx, 'offer.declineSave', recruiter, {
            v: offerId,
            fields: {
              why: 'Counter-offer from their employer',
              note: 'Their employer matched the basic and added a retention bonus.',
              source: 'call',
            },
          });
          succeeded(r, 'offer.declineSave');

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.state, 'declined');
          equals(o.responseState, 'declined');
          equals(o.responseReason, 'Counter-offer from their employer');
          ok(o.responseNote, 'with what they said');
          equals(o.responseSource, 'call');
        });
      },
    },

    {
      name: 'a sent letter is never edited — version two supersedes it',
      async fn() {
        await inRollback(async (tx) => {
          const { application, offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));

          refused(await runIn(tx, 'offer.editSave', onboarding, {
            v: offerId, fields: { f_start_date: '1 March 2027' },
          }), 'make version two');

          const r = await runIn(tx, 'offer.reviseConfirm', recruiter, {
            v: offerId, fields: { baseMonthly: '13500' },
          });
          succeeded(r, 'offer.revise');
          const v2 = idOf(r);

          const [one] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(one.state, 'withdrawn', 'the sent one is withdrawn, not rewritten');
          equals(one.baseMonthly, 12000, 'and keeps its figures');

          const [two] = await tx.select().from(offers).where(eq(offers.id, v2));
          equals(two.version, 2);
          equals(two.supersedesId, offerId);
          equals(two.state, 'draft');
          equals(two.baseMonthly, 13500);
          ok(!two.verifiedAt, 'and has to be verified again');

          const [link] = await tx.select().from(accessLinks)
            .where(and(eq(accessLinks.subjectId, offerId), eq(accessLinks.purpose, 'offer')));
          ok(link.revokedAt, 'the first letter’s link stops working');

          const both = await tx.select().from(offers)
            .where(eq(offers.applicationId, application.id));
          equals(both.length, 2, 'both versions are kept');
        });
      },
    },

    {
      name: 'an accepted offer cannot be revised',
      async fn() {
        await inRollback(async (tx) => {
          const { offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));
          await uploadAll(tx, offerId);
          succeeded(await runIn(tx, 'offer.recordSigned', recruiter, { v: offerId }));
          succeeded(await runIn(tx, 'offer.accept', recruiter, { v: offerId }));
          refused(await runIn(tx, 'offer.reviseConfirm', recruiter, { v: offerId }), 'cannot be revised');
        });
      },
    },

    {
      name: 'a hiring manager may not draft, send or record an answer',
      async fn() {
        await inRollback(async (tx) => {
          const a = await offerless(tx);
          refused(await runIn(tx, 'offer.draft', manager, { v: a.id }), 'access');
          const { offerId } = await readyToSend(tx);
          refused(await runIn(tx, 'offer.send', manager, { v: offerId }), 'access');
          refused(await runIn(tx, 'offer.accept', manager, { v: offerId }), 'access');
        });
      },
    },

    {
      name: 'every step of the offer is on the record',
      async fn() {
        await inRollback(async (tx) => {
          const { offerId } = await readyToSend(tx);
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }));

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, offerId));
          const summaries = trail.map((t) => t.summary).join(' | ');
          includes(summaries, 'drafted');
          includes(summaries, 'for approval');
          includes(summaries, 'verified the offer letter');
          includes(summaries, 'sent');
          ok(trail.every((t) => t.entityType === 'offer'), 'all against the offer');

          const events = await tx.select().from(domainEvents)
            .where(eq(domainEvents.subjectId, offerId));
          const types = events.map((e) => e.type).sort();
          equals(
            types.join(','),
            'offer.approved,offer.drafted,offer.sent,offer.submitted,offer.verified',
          );
        });
      },
    },

    /* ── The editor ───────────────────────────────────────────────────── */
    {
      name: 'changing the terms clears the verification and is on the record',
      async fn() {
        await inRollback(async (tx) => {
          const app = await offerless(tx);
          const d = await runIn(tx, 'offer.draft', recruiter, { v: app.id });
          succeeded(d, 'offer.draft');
          const offerId = String((d as { data?: { offerId?: string } }).data?.offerId);

          succeeded(await runIn(tx, 'offer.verifyConfirm', onboarding, { v: offerId }));
          const [verified] = await tx.select().from(offers).where(eq(offers.id, offerId));
          ok(verified.verifiedAt, 'it starts verified');

          const inBand = Math.round((Number(app.salary_min) + Number(app.salary_max)) / 2);
          const r = await runIn(tx, 'offer.editSave', onboarding, {
            v: offerId, fields: { baseMonthly: String(inBand) },
          });
          succeeded(r, 'offer.editSave');
          includes(String((r as { toast?: string }).toast), 'verify the letter again');

          const [after] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(after.baseMonthly, inBand, 'the basic moved');
          equals(after.verifiedAt, null, 'and the verification went with it');

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, offerId));
          includes(trail.map((t) => t.summary).join(' | '), 'changed the basic');
        });
      },
    },
    {
      name: 'a basic outside the band is refused, and only Onboarding may change it',
      async fn() {
        await inRollback(async (tx) => {
          const app = await offerless(tx);
          const d = await runIn(tx, 'offer.draft', recruiter, { v: app.id });
          const offerId = String((d as { data?: { offerId?: string } }).data?.offerId);

          refused(await runIn(tx, 'offer.editSave', onboarding, {
            v: offerId, fields: { baseMonthly: String(Number(app.salary_max) + 5000) },
          }), 'outside the band');

          /* The capability gate answers first — a recruiter never reaches the
             service's own check, which is the point of having both. */
          refused(await runIn(tx, 'offer.editSave', recruiter, {
            v: offerId, fields: { baseMonthly: String(Number(app.salary_min)) },
          }), 'does not include offer edit');
        });
      },
    },
    {
      name: 'a correction to a merge field is recorded against the person who made it',
      async fn() {
        await inRollback(async (tx) => {
          const app = await offerless(tx);
          const d = await runIn(tx, 'offer.draft', recruiter, { v: app.id });
          const offerId = String((d as { data?: { offerId?: string } }).data?.offerId);

          succeeded(await runIn(tx, 'offer.editSave', onboarding, {
            v: offerId, fields: { f_hiring_manager: 'Saud Al-Harbi' },
          }), 'offer.editSave (merge field)');

          const edits = await tx.select().from(offerLetterEdits)
            .where(eq(offerLetterEdits.offerId, offerId));
          equals(edits.length, 1, 'one correction');
          equals(edits[0].field, 'hiring_manager');
          equals(edits[0].toValue, 'Saud Al-Harbi');
          equals(edits[0].byName, onboarding.name);

          const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(o.fieldOverrides.hiring_manager, 'Saud Al-Harbi',
            'and it wins over the computed value');
        });
      },
    },
    {
      name: 'one letter template is the fallback at a time',
      async fn() {
        await inRollback(async (tx) => {
          const tpls = rowsOf(await tx.execute(sql`
            SELECT id, name FROM offer_templates WHERE archived_at IS NULL ORDER BY sort_order`));
          if (tpls.length < 2) return;   // nothing to contend for

          succeeded(await runIn(tx, 'otpl.scope', onboarding, {
            v: String(tpls[0].id), fields: { family: '*' },
          }), 'otpl.scope');
          succeeded(await runIn(tx, 'otpl.scope', onboarding, {
            v: String(tpls[1].id), fields: { family: '*' },
          }));

          const defaults = rowsOf(await tx.execute(sql`
            SELECT id FROM offer_templates WHERE is_default`));
          equals(defaults.length, 1, 'exactly one fallback');
          equals(String(defaults[0].id), String(tpls[1].id), 'and it is the newer choice');

          succeeded(await runIn(tx, 'otpl.scope', onboarding, {
            v: String(tpls[1].id), fields: { family: 'Sales' },
          }));
          const [scoped] = rowsOf(await tx.execute(sql`
            SELECT family, is_default FROM offer_templates WHERE id = ${String(tpls[1].id)}`));
          equals(String(scoped.family), 'Sales');
          ok(!scoped.is_default, 'a family-scoped letter is not the fallback');

          refused(await runIn(tx, 'otpl.scope', recruiter, {
            v: String(tpls[0].id), fields: { family: '*' },
          }), 'does not include offer edit');
        });
      },
    },
  ],
};

export default suite;
