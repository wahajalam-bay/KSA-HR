import { and, asc, eq, sql } from 'drizzle-orm';
import {
  jobs, jobStages, positions, applications, candidates, offers, offerDocuments,
  employees, onboardingDocuments, probationRecords, approvals, auditEvents, domainEvents,
  interviews, evaluations, tasks,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, includes, succeeded, type Suite } from '../run';
import '@/lib/commands';

/* ═════════════════════════════════════════════════════════════════════════════
   ONE HIRE, END TO END

   Every other write suite tests one flow in isolation, which is where the rules
   live. This one runs the whole journey once, in order, through the same
   commands the buttons fire:

     a seat is requested  →  the requisition is raised and approved  →  the
     seat becomes headcount  →  a candidate is added and applies  →  the loop
     runs, with a scorecard  →  an offer is drafted, approved, verified, sent
     and signed  →  they accept  →  an employee record exists with an employee
     number  →  the joiner's documents are received and verified  →  probation
     opens and is confirmed  →  the seat is filled.

   What this catches that the others cannot is the seams: a stage the loop does
   not run, an employee number nobody minted, a seat that stayed `requested`
   after the hire, a trail with a hole in it. It asserts the invariants at each
   handover rather than re-testing the rules either side of it.

   It runs inside one transaction and rolls back, so it can be run against a
   live desk without leaving a person, a seat or an offer behind.
   ═════════════════════════════════════════════════════════════════════════════*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({ name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02' });
const onboarding = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', roleLabel: 'Onboarding', staffId: 'stf_07',
});

type Tx = Parameters<typeof runIn>[0];
const idOf = (r: unknown, key: string): string =>
  String(((r as { data?: Record<string, unknown> }).data ?? {})[key] ?? '');

const suite: Suite = {
  name: 'write · one hire, end to end',
  tests: [
    {
      name: 'a requisition becomes a person on the payroll, and every handover holds',
      async fn() {
        await inRollback(async (tx: Tx) => {
          /* ── 1. The requisition, and the seat it raises ──────────────── */
          const [dept] = rowsOf(await tx.execute(sql`
            SELECT id FROM departments WHERE archived_at IS NULL ORDER BY sort_order LIMIT 1`)) as
            Array<{ id: string }>;
          const [loc] = rowsOf(await tx.execute(sql`
            SELECT id FROM locations ORDER BY id LIMIT 1`)) as Array<{ id: string }>;
          const [pipe] = rowsOf(await tx.execute(sql`
            SELECT id FROM pipelines ORDER BY id LIMIT 1`)) as Array<{ id: string }>;
          const [fn] = rowsOf(await tx.execute(sql`
            SELECT name FROM functions ORDER BY sort_order LIMIT 1`)) as Array<{ name: string }>;

          const raised = await runIn(tx, 'job.create', recruiter, {
            fields: {
              title: 'Lifecycle — Property Consultant',
              deptId: dept.id,
              locationId: loc.id,
              family: fn.name,
              pipelineId: pipe.id,
              openings: '1',
              salaryMin: '9000',
              salaryMax: '14000',
              employmentType: 'full_time',
              priority: 'normal',
              hiringManager: 'Abdulrahman Al-Qahtani',
            },
          });
          succeeded(raised, 'job.create');
          const jobId = idOf(raised, 'jobId');

          const [draft] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(draft.status, 'draft', 'a requisition starts as a draft');
          ok(draft.positionCode, 'and raises a seat');

          const [requested] = await tx.select().from(positions)
            .where(eq(positions.code, draft.positionCode!));
          equals(requested.planState, 'pending', 'the seat is requested, not headcount');
          equals(requested.approved, 0, 'and nothing is approved yet');

          /* ── 2. The chain ───────────────────────────────────────────── */
          succeeded(await runIn(tx, 'job.submit', recruiter, { v: jobId }), 'job.submit');
          const [inChain] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(inChain.status, 'pending_approval');

          const [chain] = await tx.select().from(approvals)
            .where(and(eq(approvals.subject, 'requisition'), eq(approvals.subjectId, jobId)));
          ok(chain, 'a chain was opened');

          /* An Admin may decide on each named approver's behalf; the chain is
             walked until it closes rather than assumed to be one step. */
          for (let i = 0; i < 8; i++) {
            const [state] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
            if (state.status !== 'pending_approval') break;
            succeeded(await runIn(tx, 'job.approve', admin, { v: jobId }), `job.approve #${i + 1}`);
          }

          const [open] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(open.status, 'open', 'the requisition opens when the chain closes');
          ok(open.openedOn, 'with the day it opened');

          const [headcount] = await tx.select().from(positions)
            .where(eq(positions.code, draft.positionCode!));
          equals(headcount.planState, 'approved', 'and only now is the seat headcount');
          equals(headcount.approved, 1);

          /* ── 3. Somebody to hire ────────────────────────────────────── */
          const email = `lifecycle.${Math.random().toString(36).slice(2, 10)}@example.com`;
          const added = await runIn(tx, 'cand.create', recruiter, {
            v: jobId,
            fields: {
              name: 'Hessa Al-Rasheed',
              email,
              phone: '+966552149930',
              locationCity: 'Riyadh',
              currentTitle: 'Senior Account Manager',
              currentCompany: 'Aqar',
              yearsExperience: '7',
              expectedSalary: '13000',
              jobId,
              source: 'Added by the recruiter',
            },
          });
          succeeded(added, 'cand.create');
          const candidateId = idOf(added, 'candidateId');
          const applicationId = idOf(added, 'applicationId');
          ok(candidateId && applicationId, 'a candidate and an application');

          const stages = await tx.select().from(jobStages)
            .where(eq(jobStages.jobId, jobId)).orderBy(asc(jobStages.ordinal));
          const [applied] = await tx.select().from(applications)
            .where(eq(applications.id, applicationId));
          equals(applied.stage, stages[0].stageKey, 'they start at the first stage of this loop');
          equals(applied.status, 'active');

          /* ── 4. The loop, stage by stage, only where the loop runs ──── */
          const upToOffer = stages
            .filter((s) => !['offer', 'joined'].includes(s.stageKey))
            .map((s) => s.stageKey);
          for (const stage of upToOffer.slice(1)) {
            succeeded(await runIn(tx, 'app.moveTo', recruiter, {
              v: `${applicationId}|${stage}`,
            }), `app.moveTo ${stage}`);
          }
          const [atLast] = await tx.select().from(applications)
            .where(eq(applications.id, applicationId));
          equals(atLast.stage, upToOffer[upToOffer.length - 1]);

          /* A scorecard, which is what a rating is made of. */
          succeeded(await runIn(tx, 'eval.save', admin, {
            v: applicationId,
            fields: {
              stage: atLast.stage,
              verdict: 'strong_yes',
              comment: 'Ran the Riyadh developer book; walked through two live negotiations.',
              'crit:Commercial judgement': '5',
              'crit:Communication': '4',
            },
          }), 'eval.save');

          const [rated] = await tx.select().from(applications)
            .where(eq(applications.id, applicationId));
          ok(rated.rating !== null, 'the rating is the mean of the scorecards');

          /* ── 5. The offer ───────────────────────────────────────────── */
          const drafted = await runIn(tx, 'offer.draft', recruiter, {
            v: applicationId,
            fields: { baseMonthly: '12000' },
          });
          succeeded(drafted, 'offer.draft');
          const offerId = idOf(drafted, 'offerId') || String(
            ((drafted as { data?: Record<string, unknown> }).data ?? {}).id ?? '',
          );
          ok(offerId, 'the offer has an id');

          const [asDraft] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(asDraft.state, 'draft');
          ok(asDraft.reference.startsWith('OFF-'), 'and a reference');

          succeeded(await runIn(tx, 'offer.submit', recruiter, { v: offerId }), 'offer.submit');
          for (let i = 0; i < 8; i++) {
            const [state] = await tx.select().from(offers).where(eq(offers.id, offerId));
            if (state.state !== 'pending_approval') break;
            succeeded(await runIn(tx, 'offer.approve', admin, { v: offerId }), `offer.approve #${i + 1}`);
          }
          const [approvedOffer] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(approvedOffer.state, 'approved', 'the offer clears its own chain');

          /* The letter is checked by somebody before it can be sent. */
          succeeded(await runIn(tx, 'offer.verifyConfirm', onboarding, { v: offerId }),
            'offer.verifyConfirm');
          succeeded(await runIn(tx, 'offer.send', recruiter, { v: offerId }), 'offer.send');

          const [sent] = await tx.select().from(offers).where(eq(offers.id, offerId));
          equals(sent.state, 'sent');
          ok(sent.sentAt && sent.expiresAt, 'with a date and an expiry');

          /* Every document on the envelope, then the signature. */
          const envelope = await tx.select().from(offerDocuments)
            .where(eq(offerDocuments.offerId, offerId));
          ok(envelope.length > 0, 'the envelope asks for documents');
          for (const d of envelope) {
            succeeded(await runIn(tx, 'offer.doc', recruiter, { v: `${offerId}:${d.key}` }),
              `offer.doc ${d.key}`);
          }
          succeeded(await runIn(tx, 'offer.recordSigned', recruiter, { v: offerId }),
            'offer.recordSigned');

          /* ── 6. They accept, and a person exists ────────────────────── */
          const accepted = await runIn(tx, 'offer.accept', recruiter, { v: offerId });
          succeeded(accepted, 'offer.accept');
          includes(String((accepted as { toast?: string }).toast), 'BYT-');

          const [hired] = await tx.select().from(applications)
            .where(eq(applications.id, applicationId));
          equals(hired.status, 'hired');
          equals(hired.stage, 'joined');
          ok(hired.closedAt, 'and the application is closed');

          const staff_ = await tx.select().from(employees)
            .where(eq(employees.applicationId, applicationId));
          equals(staff_.length, 1, 'exactly one employee record, not two');
          const employee = staff_[0];
          ok(employee.employeeCode?.startsWith('BYT-'), 'with an employee number');
          equals(employee.positionCode, draft.positionCode, 'sitting in the seat that was raised');
          equals(employee.jobId, jobId);

          const [filled] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(filled.filled, 1, 'the requisition counts the hire');

          /* ── 7. The joiner's file ───────────────────────────────────── */
          const checklist = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.employeeId, employee.id))
            .orderBy(asc(onboardingDocuments.sortOrder));
          ok(checklist.length > 0, 'a checklist was raised for them');

          for (const d of checklist) {
            if (d.status === 'missing' || d.status === 'rejected') {
              succeeded(await runIn(tx, 'onb.doc', onboarding, { v: `${employee.id}:${d.key}` }),
                `onb.doc ${d.key}`);
            }
            succeeded(await runIn(tx, 'onb.verify', onboarding, { v: `${employee.id}:${d.key}` }),
              `onb.verify ${d.key}`);
          }
          const verified = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.employeeId, employee.id));
          ok(verified.every((d) => d.status === 'verified'), 'and the file is complete');

          /* ── 8. Probation ───────────────────────────────────────────── */
          const [probation] = await tx.select().from(probationRecords)
            .where(eq(probationRecords.employeeId, employee.id));
          ok(probation, 'probation opened with the employment');
          ok(probation.endsOn, 'and knows when it ends');

          succeeded(await runIn(tx, 'prob.save', admin, {
            v: employee.id,
            fields: { outcome: 'pass', note: 'Beat the ramp on the Riyadh book.' },
          }), 'prob.save');

          const [confirmed] = await tx.select().from(probationRecords)
            .where(eq(probationRecords.employeeId, employee.id));
          equals(confirmed.state, 'passed');

          const [onPayroll] = await tx.select().from(employees)
            .where(eq(employees.id, employee.id));
          equals(onPayroll.status, 'active', 'and they are on the payroll');

          /* ── 9. The trail, with no holes in it ──────────────────────── */
          const trail = rowsOf(await tx.execute(sql`
            SELECT action::text AS action, entity_type AS "entityType", summary
              FROM ${auditEvents}
             WHERE entity_id IN (${jobId}, ${applicationId}, ${candidateId}, ${offerId}, ${employee.id})
             ORDER BY at`)) as Array<{ action: string; entityType: string; summary: string }>;
          ok(trail.length >= 12, `${trail.length} audit events across the journey`);
          ok(trail.every((e) => !!e.summary), 'every one of them says what happened');

          const kinds = new Set(trail.map((e) => e.entityType));
          for (const want of ['requisition', 'offer', 'employee']) {
            ok(kinds.has(want), `the trail covers the ${want}`);
          }

          const events = rowsOf(await tx.execute(sql`
            SELECT type FROM ${domainEvents}
             WHERE subject_id IN (${jobId}, ${applicationId}, ${offerId}, ${employee.id})`)) as
            Array<{ type: string }>;
          const raisedTypes = new Set(events.map((e) => e.type));
          ok(raisedTypes.has('requisition.approved'), 'the engine was told the requisition opened');
          ok([...raisedTypes].some((t) => t.startsWith('offer.')), 'and that the offer moved');

          /* And nothing was left half-done: no interview, scorecard or task on
             this application points at a stage the loop does not run. */
          const loose = rowsOf(await tx.execute(sql`
            SELECT e.id FROM ${evaluations} e
             WHERE e.application_id = ${applicationId}
               AND NOT EXISTS (SELECT 1 FROM ${jobStages} js
                                WHERE js.job_id = e.job_id AND js.stage_key = e.stage)`)) as
            Array<{ id: string }>;
          equals(loose.length, 0, 'no scorecard on a stage this requisition does not run');

          const ivs = await tx.select().from(interviews)
            .where(eq(interviews.applicationId, applicationId));
          ok(ivs.every((i) => i.jobId === jobId), 'every interview belongs to this requisition');

          const chores = await tx.select().from(tasks)
            .where(eq(tasks.applicationId, applicationId));
          ok(chores.every((t) => !t.jobId || t.jobId === jobId),
            'and every task raised along the way belongs to it too');

          /* The candidate record itself survived all of it intact. */
          const [person] = await tx.select().from(candidates)
            .where(eq(candidates.id, candidateId));
          equals(person.email, email);
          equals(person.name, 'Hessa Al-Rasheed');
        });
      },
    },
  ],
};

export default suite;
