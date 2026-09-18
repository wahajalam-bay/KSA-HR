import { sql, eq } from 'drizzle-orm';
import { jobs, positions, approvals, approvalSteps, auditEvents, domainEvents, jobStages } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 1 — manpower → requisition → approval.

   The rule this suite exists for: a new unplanned seat must not become
   approved headcount the moment somebody types it. It is requested; it becomes
   headcount when the requisition that raised it clears its chain, and not
   before. Everything else here is the machinery that has to hold for that rule
   to mean anything — who may submit, who may approve, what a rejection does,
   and whether the trail says what happened.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin',
  isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const manager = viewer({
  name: 'Abdulrahman Al-Qahtani', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true,
  scope: { kind: 'own', jobIds: [], own: true },
});

/** A complete, valid requisition form, with anything a test wants to change. */
async function form(tx: Parameters<typeof runIn>[0], over: Record<string, string> = {}) {
  const [dept] = rowsOf(await tx.execute(sql`
    SELECT id, name FROM departments WHERE archived_at IS NULL ORDER BY sort_order LIMIT 1`));
  const [loc] = rowsOf(await tx.execute(sql`SELECT id FROM locations ORDER BY id LIMIT 1`));
  const [pipe] = rowsOf(await tx.execute(sql`SELECT id FROM pipelines ORDER BY id LIMIT 1`));
  const [fn] = rowsOf(await tx.execute(sql`SELECT name FROM functions ORDER BY sort_order LIMIT 1`));
  return {
    title: 'Test Requisition — Property Consultant',
    deptId: String(dept.id),
    locationId: String(loc.id),
    family: String(fn.name),
    pipelineId: String(pipe.id),
    openings: '2',
    salaryMin: '9000',
    salaryMax: '14000',
    employmentType: 'full_time',
    priority: 'normal',
    hiringManager: 'Abdulrahman Al-Qahtani',
    ...over,
  };
}

const suite: Suite = {
  name: 'write · manpower → requisition → approval',
  tests: [
    {
      name: 'a new requisition is a draft, and its seat is requested — not headcount',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          succeeded(r, 'job.create');
          const jobId = String((r as { data?: Record<string, unknown> }).data?.jobId);
          ok(jobId, 'the command returns the id it made');

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(job.status, 'draft', 'a new requisition starts as a draft');
          ok(job.positionCode, 'it raises a seat');

          const [seat] = rowsOf(await tx.execute(sql`
            SELECT plan_state::text AS plan_state, approved, requested
              FROM positions WHERE code = ${job.positionCode}`));
          equals(seat.plan_state, 'pending', 'the seat is pending, not approved');
          equals(Number(seat.approved), 0, 'it adds nothing to approved headcount');
          equals(Number(seat.requested), 2, 'it records what was asked for');

          const stages = await tx.select().from(jobStages).where(eq(jobStages.jobId, jobId));
          ok(stages.length >= 5, 'the pipeline template is copied onto it');
        });
      },
    },

    {
      name: 'an unbudgeted requisition is refused without a justification',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'job.create', recruiter, {
            fields: await form(tx, { budgeted: '0' }),
          });
          refused(r, 'justification');
        });
      },
    },

    {
      name: 'a band whose top is under its bottom is refused',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'job.create', recruiter, {
            fields: await form(tx, { salaryMin: '20000', salaryMax: '9000' }),
          });
          refused(r, 'band');
        });
      },
    },

    {
      name: 'a hiring manager may not open a requisition',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'job.create', manager, { fields: await form(tx) });
          refused(r, 'access');
        });
      },
    },

    {
      name: 'submitting freezes the chain onto the record',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          succeeded(c);
          const jobId = String((c as { data?: Record<string, unknown> }).data?.jobId);

          const s = await runIn(tx, 'job.submit', recruiter, { v: jobId });
          succeeded(s, 'job.submit');

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(job.status, 'pending_approval', 'the requisition is in the chain');

          const [ap] = await tx.select().from(approvals)
            .where(eq(approvals.subjectId, jobId));
          ok(ap, 'an approval was opened');
          const steps = await tx.select().from(approvalSteps)
            .where(eq(approvalSteps.approvalId, ap.id));
          ok(steps.length >= 1, 'with at least one step');
          ok(steps.every((x) => x.approverName), 'every step names who decides');
        });
      },
    },

    {
      name: 'a draft cannot be submitted twice',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          const jobId = String((c as { data?: Record<string, unknown> }).data?.jobId);
          succeeded(await runIn(tx, 'job.submit', recruiter, { v: jobId }));
          const again = await runIn(tx, 'job.submit', recruiter, { v: jobId });
          refused(again, 'already');
        });
      },
    },

    {
      name: 'only the named approver — or an Admin on their behalf — may decide',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          const jobId = String((c as { data?: Record<string, unknown> }).data?.jobId);
          await runIn(tx, 'job.submit', recruiter, { v: jobId });

          const [ap] = await tx.select().from(approvals).where(eq(approvals.subjectId, jobId));
          const [step] = await tx.select().from(approvalSteps)
            .where(eq(approvalSteps.approvalId, ap.id));

          /* Somebody who holds approval.act but is not the person named on the
             step, and is not an Admin who could act on their behalf. */
          const other = viewer({
            name: 'Somebody Else Entirely', role: 'hiring_manager', staffRole: null,
            roleLabel: 'Hiring manager', isPortal: true,
            scope: { kind: 'all', jobIds: [], own: true },
          });
          ok((step.approverName ?? '') !== other.name, 'the test picked a different person');
          const r = await runIn(tx, 'job.approve', other, { v: jobId });
          refused(r, 'decide');

          const byAdmin = await runIn(tx, 'job.approve', admin, { v: jobId });
          succeeded(byAdmin, 'an Admin may act on their behalf');
        });
      },
    },

    {
      name: 'approving the last step opens the requisition and approves its seat',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          const jobId = String((c as { data?: Record<string, unknown> }).data?.jobId);
          await runIn(tx, 'job.submit', recruiter, { v: jobId });

          /* Walk the chain to the end, as an Admin. */
          for (let i = 0; i < 6; i++) {
            const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
            if (job.status !== 'pending_approval') break;
            succeeded(await runIn(tx, 'job.approve', admin, { v: jobId }), `step ${i + 1}`);
          }

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(job.status, 'open', 'the requisition is open');
          ok(job.openedOn, 'and carries the day it opened');

          const [seat] = rowsOf(await tx.execute(sql`
            SELECT plan_state::text AS plan_state FROM positions WHERE code = ${job.positionCode}`));
          equals(seat.plan_state, 'approved', 'the seat is now approved headcount');
        });
      },
    },

    {
      name: 'sending it back needs a reason, and returns it to draft',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          const jobId = String((c as { data?: Record<string, unknown> }).data?.jobId);
          await runIn(tx, 'job.submit', recruiter, { v: jobId });

          refused(await runIn(tx, 'job.reject', admin, { v: jobId }), 'why');

          const r = await runIn(tx, 'job.reject', admin, {
            v: jobId, fields: { reason: 'The band is above the grade' },
          });
          succeeded(r, 'job.reject');

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          equals(job.status, 'draft', 'it goes back to the requester as a draft');

          const [ap] = await tx.select().from(approvals).where(eq(approvals.subjectId, jobId));
          equals(ap.state, 'rejected', 'and the approval is closed as rejected');
        });
      },
    },

    {
      name: 'every step of the chain leaves an audit entry and a domain event',
      async fn() {
        await inRollback(async (tx) => {
          const c = await runIn(tx, 'job.create', recruiter, { fields: await form(tx) });
          const jobId = String((c as { data?: Record<string, unknown> }).data?.jobId);
          await runIn(tx, 'job.submit', recruiter, { v: jobId });

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, jobId));
          ok(trail.length >= 2, 'the trail records the creation and the submission');
          ok(trail.every((a) => a.actorName), 'every entry names who did it');
          includes(trail.map((a) => a.summary).join(' | '), 'submitted');

          const events = await tx.select().from(domainEvents)
            .where(eq(domainEvents.subjectId, jobId));
          const types = events.map((e) => e.type);
          ok(types.includes('requisition.created'), 'the engine hears about the creation');
          ok(types.includes('requisition.submitted'), 'and about the submission');
        });
      },
    },

    {
      name: 'the pipeline cannot change under people who are standing on it',
      async fn() {
        await inRollback(async (tx) => {
          const [live] = rowsOf(await tx.execute(sql`
            SELECT j.id, j.pipeline_id FROM jobs j
             WHERE EXISTS (SELECT 1 FROM applications a
                            WHERE a.job_id = j.id AND a.status IN ('active','on_hold'))
             LIMIT 1`));
          ok(live, 'the dataset has a requisition with people in play');
          const [other] = rowsOf(await tx.execute(sql`
            SELECT id FROM pipelines WHERE id <> ${live.pipeline_id} LIMIT 1`));

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, String(live.id)));
          const r = await runIn(tx, 'job.save', admin, {
            v: String(live.id),
            fields: {
              title: job.title, deptId: job.deptId, locationId: job.locationId,
              family: job.family, pipelineId: String(other.id),
              openings: String(job.openings), salaryMin: String(job.salaryMin),
              salaryMax: String(job.salaryMax),
            },
          });
          refused(r, 'pipeline');
        });
      },
    },

    {
      name: 'archiving says how many applications were still open on it',
      async fn() {
        await inRollback(async (tx) => {
          const [live] = rowsOf(await tx.execute(sql`
            SELECT j.id FROM jobs j
             WHERE j.archived_at IS NULL
               AND EXISTS (SELECT 1 FROM applications a
                            WHERE a.job_id = j.id AND a.status IN ('active','on_hold'))
             LIMIT 1`));
          const r = await runIn(tx, 'job.archive', admin, {
            v: String(live.id), fields: { reason: 'Headcount pulled' },
          });
          succeeded(r, 'job.archive');
          includes(String((r as { toast?: string }).toast), 'still open on it');

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, String(live.id)));
          ok(job.archivedAt, 'the requisition carries the day it was archived');
          equals(job.status, 'closed');

          const again = await runIn(tx, 'job.archive', admin, { v: String(live.id) });
          refused(again, 'already archived');
        });
      },
    },

    /* ── The blocks on the requisition form ───────────────────────────── */
    {
      name: 'the form’s blocks are written with it — routes, loop, bar, questions',
      async fn() {
        await inRollback(async (tx) => {
          const [q] = rowsOf(await tx.execute(sql`
            SELECT id FROM question_bank WHERE archived_at IS NULL ORDER BY sort_order LIMIT 1`));

          const r = await runIn(tx, 'job.create', admin, {
            fields: {
              ...await form(tx, { title: 'Blocks — Property Consultant' }),
              /* how it gets filled */
              src_internal: '1', src_linkedin: '1', srcNote: 'Internal first for a fortnight',
              /* the loop: a screen, one interview and the final */
              wf_on_screen: '1', wf_name_screen: 'Recruiter Screen', wf_sla_screen: '2',
              wf_on_iv1: '1', wf_name_iv1: '1st Interview', wf_sla_iv1: '4',
              wf_on_ivf: '1', wf_name_ivf: '2nd Interview', wf_sla_ivf: '5',
              /* the bar */
              sk_name_0: 'Negotiation', sk_lvl_0: '4', sk_must_0: '1',
              sk_name_1: 'CRM', sk_lvl_1: '3',
              /* the description */
              desc_summary: 'Sells off-plan in Riyadh.',
              desc_responsibilities: 'Close deals\nKeep the CRM honest',
              /* the careers form */
              qids: [String(q.id)],
              /* the rest of the hiring team */
              hiringManagersExtra: 'Saud Al-Harbi — Regional Sales Manager',
            },
          });
          succeeded(r, 'job.create with blocks');
          const jobId = String((r as { data?: { jobId?: string } }).data?.jobId);

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          ok(job.sourcingInternal && job.sourcingLinkedin, 'both routes are on');
          ok(!job.sourcingHunt, 'and the one that was not ticked is off');
          equals(job.sourcingNote, 'Internal first for a fortnight');
          equals(job.descSummary, 'Sells off-plan in Riyadh.');
          equals(job.descResponsibilities.length, 2, 'two responsibilities');

          const loop = await tx.select().from(jobStages).where(eq(jobStages.jobId, jobId));
          const keys = loop.map((s) => s.stageKey).sort();
          ok(keys.includes('applied') && keys.includes('offer') && keys.includes('joined'),
            'the spine is always there');
          ok(keys.includes('screen') && keys.includes('iv1') && keys.includes('ivf'),
            'and the picked stages with it');
          ok(!keys.includes('iv2') && !keys.includes('pitch') && !keys.includes('assessment'),
            'the ones left unticked are not written at all');
          equals(loop.find((s) => s.stageKey === 'screen')!.sla, 2, 'the SLA typed into the row');

          /* Two interview rounds are running, so the final one is the 2nd —
             a name that is still a plain ordinal is renumbered to where it
             actually falls. */
          equals(loop.find((s) => s.stageKey === 'ivf')!.name, '2nd Interview');

          const bar = rowsOf(await tx.execute(sql`
            SELECT skill, level, must FROM job_skills WHERE job_id = ${jobId} ORDER BY sort_order`));
          equals(bar.length, 2, 'two skills on the bar');
          equals(String(bar[0].skill), 'Negotiation');
          equals(Number(bar[0].level), 4);
          ok(bar[0].must, 'the first is essential');
          ok(!bar[1].must, 'the second is not');

          const qs = rowsOf(await tx.execute(sql`
            SELECT bank_id FROM job_questions WHERE job_id = ${jobId}`));
          equals(qs.length, 1, 'exactly the question that was ticked');
          equals(String(qs[0].bank_id), String(q.id));

          const hms = rowsOf(await tx.execute(sql`
            SELECT name, is_lead, email FROM ${sql.raw('job_hiring_managers')}
             WHERE job_id = ${jobId} ORDER BY sort_order`));
          equals(hms.length, 2, 'the lead and the co-manager');
          ok(hms[0].is_lead, 'the lead comes first');
          equals(String(hms[1].name), 'Saud Al-Harbi');
          equals(String(hms[1].email), 'saud.alharbi@bayut.sa');
        });
      },
    },
    {
      name: 'a ticked box reaches the command in the shape the browser sends it',
      async fn() {
        await inRollback(async (tx) => {
          /* The interface collects a ticked checkbox as `['true']` and an
             unticked one as `[]` — not as 'on' and not as absent. A helper that
             only understood strings read every ticked box as false, which every
             test written with literal strings would have missed. */
          const r = await runIn(tx, 'job.create', admin, {
            fields: {
              ...await form(tx, { title: 'Checkbox shapes — Consultant' }),
              src_internal: [] as unknown as string,
              src_hunt: ['true'] as unknown as string,
              src_linkedin: [] as unknown as string,
              wf_on_screen: ['true'] as unknown as string,
              wf_on_ivf: ['true'] as unknown as string,
              wf_on_iv1: [] as unknown as string,
              sk_name_0: 'Negotiation',
              sk_must_0: ['true'] as unknown as string,
              sk_name_1: 'CRM',
              sk_must_1: [] as unknown as string,
            },
          });
          succeeded(r, 'job.create with browser-shaped checkboxes');
          const jobId = String((r as { data?: { jobId?: string } }).data?.jobId);

          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          ok(job.sourcingHunt, 'the ticked route is on');
          ok(!job.sourcingInternal && !job.sourcingLinkedin, 'the unticked ones are off');

          const loop = await tx.select().from(jobStages).where(eq(jobStages.jobId, jobId));
          const keys = loop.map((s) => s.stageKey);
          ok(keys.includes('screen') && keys.includes('ivf'), 'the ticked stages are on');
          ok(!keys.includes('iv1'), 'and the unticked one is not');

          const bar = rowsOf(await tx.execute(sql`
            SELECT skill, must FROM job_skills WHERE job_id = ${jobId} ORDER BY sort_order`));
          ok(bar[0].must, 'the ticked essential is essential');
          ok(!bar[1].must, 'and the unticked one is not');
        });
      },
    },
    {
      name: 'a requisition nobody is filling, with no loop, or with no bar, is refused',
      async fn() {
        await inRollback(async (tx) => {
          const good = {
            wf_on_screen: '1', wf_on_ivf: '1',
            sk_name_0: 'Negotiation', sk_lvl_0: '4',
            src_linkedin: '1',
          };

          refused(await runIn(tx, 'job.create', admin, {
            fields: { ...await form(tx), ...good, src_linkedin: '0' },
          }), 'how this position gets filled');

          refused(await runIn(tx, 'job.create', admin, {
            fields: { ...await form(tx), ...good, wf_on_screen: '0', wf_on_ivf: '0' },
          }), 'at least one stage');

          refused(await runIn(tx, 'job.create', admin, {
            fields: { ...await form(tx), ...good, sk_name_0: '' },
          }), 'at least one skill');
        });
      },
    },
    {
      name: 'the sales pitch stage needs a project, and switching it off clears it',
      async fn() {
        await inRollback(async (tx) => {
          const [p] = rowsOf(await tx.execute(sql`
            SELECT id FROM pitch_projects WHERE active ORDER BY name LIMIT 1`));
          const base = {
            wf_on_screen: '1', wf_on_ivf: '1', wf_on_pitch: '1',
            sk_name_0: 'Negotiation', src_linkedin: '1',
          };

          refused(await runIn(tx, 'job.create', admin, {
            fields: { ...await form(tx), ...base },
          }), 'Pick the project');

          const r = await runIn(tx, 'job.create', admin, {
            fields: { ...await form(tx), ...base, pitchProjectId: String(p.id) },
          });
          succeeded(r, 'job.create with a pitch');
          const jobId = String((r as { data?: { jobId?: string } }).data?.jobId);
          const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          ok(job.pitchOn, 'the stage is on');
          equals(job.pitchProjectId, String(p.id));

          const off = await runIn(tx, 'job.save', admin, {
            v: jobId,
            fields: {
              ...await form(tx), ...base, wf_on_pitch: '0', pitchProjectId: String(p.id),
            },
          });
          succeeded(off, 'job.save with the pitch off');
          const [after] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
          ok(!after.pitchOn, 'the stage is off');
          equals(after.pitchProjectId, null, 'and the project no longer hangs off it');
        });
      },
    },
    {
      name: 'a stage somebody is standing on cannot be switched off underneath them',
      async fn() {
        await inRollback(async (tx) => {
          const [app] = rowsOf(await tx.execute(sql`
            SELECT a.id, a.job_id, a.stage::text AS stage
              FROM applications a JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND a.stage::text IN ('screen','iv1','iv2')
             LIMIT 1`));
          const [job] = await tx.select().from(jobs).where(eq(jobs.id, String(app.job_id)));

          const loop = await tx.select().from(jobStages).where(eq(jobStages.jobId, job.id));
          const fields: Record<string, string> = {
            title: job.title, deptId: job.deptId, locationId: job.locationId,
            family: job.family, pipelineId: job.pipelineId ?? '',
            openings: String(job.openings), salaryMin: String(job.salaryMin),
            salaryMax: String(job.salaryMax), src_linkedin: '1', sk_name_0: 'Negotiation',
          };
          for (const s of loop) {
            if (s.stageKey === app.stage) continue;   // the one being switched off
            if (['applied', 'sourced', 'offer', 'joined'].includes(s.stageKey)) continue;
            fields[`wf_on_${s.stageKey}`] = '1';
            fields[`wf_name_${s.stageKey}`] = s.name;
            fields[`wf_sla_${s.stageKey}`] = String(s.sla);
          }
          if (!Object.keys(fields).some((k) => k.startsWith('wf_on_'))) {
            fields.wf_on_ivf = '1';
          }

          refused(await runIn(tx, 'job.save', admin, { v: job.id, fields }),
            'move them on before switching that stage off');
        });
      },
    },
    {
      name: 'a question written for one requisition is added, edited and removed',
      async fn() {
        await inRollback(async (tx) => {
          const [job] = rowsOf(await tx.execute(sql`
            SELECT id FROM jobs WHERE status = 'open' ORDER BY created_at LIMIT 1`));
          const jobId = String(job.id);

          refused(await runIn(tx, 'jq.save', admin, {
            v: `${jobId}|new`, fields: { text: '', type: 'yesno' },
          }), 'Write the question');

          refused(await runIn(tx, 'jq.save', admin, {
            v: `${jobId}|new`,
            fields: { text: 'Which city?', type: 'choice', options: 'Riyadh' },
          }), 'at least two options');

          succeeded(await runIn(tx, 'jq.save', admin, {
            v: `${jobId}|new`,
            fields: { text: 'Do you hold a REGA broker licence?', type: 'yesno', knockout: 'Yes' },
          }), 'jq.save');

          const [added] = rowsOf(await tx.execute(sql`
            SELECT id, ordinal, required, knockout FROM job_questions
             WHERE job_id = ${jobId} AND bank_id IS NULL ORDER BY ordinal DESC LIMIT 1`));
          ok(added, 'it is on the careers form');
          equals(String(added.knockout), 'Yes', 'with its knockout');
          ok(added.required, 'and required by default');

          succeeded(await runIn(tx, 'jq.req', admin, { v: String(added.id) }));
          const [flipped] = rowsOf(await tx.execute(sql`
            SELECT required FROM job_questions WHERE id = ${String(added.id)}`));
          ok(!flipped.required, 'ticking required flips it');

          succeeded(await runIn(tx, 'jq.save', admin, {
            v: `${jobId}|${String(added.id)}`,
            fields: { text: 'Do you hold a valid REGA licence?', type: 'yesno', required: '1' },
          }), 'jq.save (edit)');
          const [edited] = rowsOf(await tx.execute(sql`
            SELECT text FROM job_questions WHERE id = ${String(added.id)}`));
          equals(String(edited.text), 'Do you hold a valid REGA licence?');

          succeeded(await runIn(tx, 'jq.remove', admin, { v: String(added.id) }));
          const left = rowsOf(await tx.execute(sql`
            SELECT ordinal FROM job_questions WHERE job_id = ${jobId} ORDER BY ordinal`));
          equals(left.map((x) => Number(x.ordinal)).join(','),
            left.map((_, i) => i).join(','), 'and the ordinals close up behind it');

          refused(await runIn(tx, 'jq.remove', admin, { v: String(added.id) }), 'already off the form');
        });
      },
    },
  ],
};

export default suite;
