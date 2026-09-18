import { and, asc, eq, sql } from 'drizzle-orm';
import {
  jobs, jobHiringManagers, jobQuestions, approvalFlows, approvalFlowSteps,
  notifiedTeams, notifiedTeamContacts, pipelines, references, onboardingDocuments, integrations,
} from '@/db/schema';
import { splitAction, classify, NAV_ACTIONS } from '@/lib/nav';
import { rows as rowsOf } from '@/lib/queries/sql';
import { viewer, runIn, inRollback } from '../commands/harness';
import { ok, eq as equals, includes, refused, succeeded, type Suite } from '../run';
import '@/lib/commands';

/* ─────────────────────────────────────────────────────────────────────────────
   The writes a single row makes, and the colon that tells them what they are on.

   A button in a list has two things to say: which row was pressed, which is
   `data-v`, and what that row belongs to, which is written after a colon in the
   action — `apf.move:flow_a:up`. The prototype's dispatcher resolved the whole
   name first and split on the colon only if nothing answered to it, and so does
   this one; these tests hold that rule and the eleven commands that depend on
   it, because a silent mis-split is a button that quietly does nothing.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({ name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02' });
const onboarder = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', roleLabel: 'Onboarding', staffId: 'stf_07',
});

const suite: Suite = {
  name: 'write · the small writes a row makes',
  tests: [
    {
      name: 'an action is its whole name first, and only then a name and an argument',
      fn() {
        equals(splitAction('jq.move').name, 'jq.move');
        equals(splitAction('jq.move').arg, null);

        const moved = splitAction('jq.move:job_a:up');
        equals(moved.name, 'jq.move');
        equals(moved.arg, 'job_a:up');

        /* A panel whose name contains a colon keeps meaning itself. */
        equals(splitAction('drawer.open:tab').name, 'drawer.open:tab');
        equals(splitAction('drawer.open:tab').arg, null);
        equals(classify(splitAction('drawer.open:tab').name), 'sheet');

        /* A filter select says which filter after the colon, and the nav
           action puts it in the query string under that name. */
        const f = splitAction('onb.f:dept');
        equals(f.name, 'onb.f');
        equals(f.arg, 'dept');
        const url = NAV_ACTIONS[f.name]('dep_1', {
          view: 'onboarding', id: null, sub: null, query: {},
        }, f.arg);
        includes(url, 'dept=dep_1');
      },
    },

    /* ── The hiring team ───────────────────────────────────────────────── */
    {
      name: 'a requisition has exactly one lead, before and after the change',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT h.id, h.job_id AS "jobId", h.name
              FROM job_hiring_managers h
             WHERE NOT h.is_lead
               AND EXISTS (SELECT 1 FROM job_hiring_managers o
                            WHERE o.job_id = h.job_id AND o.is_lead)
             LIMIT 1`)) as Array<{ id: string; jobId: string; name: string }>;
          if (!row) return;

          succeeded(await runIn(tx, 'hm.lead', admin, { v: row.id, arg: row.jobId }), 'hm.lead');

          const leads = await tx.select().from(jobHiringManagers).where(and(
            eq(jobHiringManagers.jobId, row.jobId), eq(jobHiringManagers.isLead, true),
          ));
          equals(leads.length, 1, 'one lead, no more and no fewer');
          equals(leads[0].id, row.id);

          /* The requisition's own field is what the board and the letter read. */
          const [job] = await tx.select().from(jobs).where(eq(jobs.id, row.jobId));
          equals(job.hiringManager, row.name);

          refused(await runIn(tx, 'hm.lead', admin, { v: row.id, arg: row.jobId }), 'already the lead');
        });
      },
    },

    /* ── The careers form ──────────────────────────────────────────────── */
    {
      name: 'a question moves, and the run of ordinals stays a run',
      async fn() {
        await inRollback(async (tx) => {
          const [j] = rowsOf(await tx.execute(sql`
            SELECT job_id AS "jobId" FROM job_questions
             GROUP BY job_id HAVING count(*) >= 2 LIMIT 1`)) as Array<{ jobId: string }>;
          if (!j) return;

          const before = await tx.select().from(jobQuestions)
            .where(eq(jobQuestions.jobId, j.jobId)).orderBy(asc(jobQuestions.ordinal));
          const second = before[1];

          succeeded(await runIn(tx, 'jq.move', admin, { v: second.id, arg: `${j.jobId}:up` }),
            'jq.move up');

          const after = await tx.select().from(jobQuestions)
            .where(eq(jobQuestions.jobId, j.jobId)).orderBy(asc(jobQuestions.ordinal));
          equals(after[0].id, second.id, 'it is first now');
          equals(after.map((q) => q.ordinal).join(','), after.map((_q, i) => i).join(','),
            'and the ordinals are 0,1,2 with no gaps');

          refused(await runIn(tx, 'jq.move', admin, { v: second.id, arg: `${j.jobId}:up` }),
            'already first');
          refused(await runIn(tx, 'jq.move', admin, { v: second.id, arg: j.jobId }), 'Up or down');
        });
      },
    },

    /* ── The approval chain ────────────────────────────────────────────── */
    {
      name: 'a step moves without colliding with the ordinal it is swapping into',
      async fn() {
        await inRollback(async (tx) => {
          const [f] = rowsOf(await tx.execute(sql`
            SELECT flow_id AS "flowId" FROM approval_flow_steps
             GROUP BY flow_id HAVING count(*) >= 2 LIMIT 1`)) as Array<{ flowId: string }>;
          if (!f) return;

          const before = await tx.select().from(approvalFlowSteps)
            .where(eq(approvalFlowSteps.flowId, f.flowId)).orderBy(asc(approvalFlowSteps.ordinal));
          const last = before[before.length - 1];

          succeeded(await runIn(tx, 'apf.move', admin, { v: last.id, arg: `${f.flowId}:up` }),
            'apf.move');

          const after = await tx.select().from(approvalFlowSteps)
            .where(eq(approvalFlowSteps.flowId, f.flowId)).orderBy(asc(approvalFlowSteps.ordinal));
          equals(after[after.length - 2].id, last.id, 'it moved up one');
          equals(after.map((s) => s.ordinal).join(','), after.map((_s, i) => i).join(','),
            'and the ordinals are still a run');

          refused(await runIn(tx, 'apf.move', admin, { v: before[0].id, arg: `${f.flowId}:up` }),
            'already first');
        });
      },
    },

    {
      name: 'a publish channel is a toggle, and publishing to nowhere is refused',
      async fn() {
        await inRollback(async (tx) => {
          const [flow] = await tx.select().from(approvalFlows).limit(1);
          const channel = flow.publishChannels[0] ?? 'careers';

          succeeded(await runIn(tx, 'apf.channel', admin, { v: channel, arg: flow.id }), 'off');
          const [once] = await tx.select().from(approvalFlows).where(eq(approvalFlows.id, flow.id));
          equals(once.publishChannels.includes(channel), !flow.publishChannels.includes(channel));

          succeeded(await runIn(tx, 'apf.channel', admin, { v: channel, arg: flow.id }), 'on again');
          const [twice] = await tx.select().from(approvalFlows).where(eq(approvalFlows.id, flow.id));
          equals(twice.publishChannels.sort().join(','), flow.publishChannels.sort().join(','));

          /* With no channels at all, switching publishing on is refused. */
          await tx.update(approvalFlows)
            .set({ publishChannels: [], publishOnApprove: false })
            .where(eq(approvalFlows.id, flow.id));
          refused(await runIn(tx, 'apf.publish', admin, { v: flow.id }), 'at least one channel');
        });
      },
    },

    {
      name: 'only somebody who may change settings moves a chain about',
      async fn() {
        await inRollback(async (tx) => {
          const [step] = await tx.select().from(approvalFlowSteps).limit(1);
          refused(await runIn(tx, 'apf.move', recruiter, { v: step.id, arg: `${step.flowId}:up` }),
            'does not include settings edit');
        });
      },
    },

    /* ── The notified teams ────────────────────────────────────────────── */
    {
      name: 'a team has one primary contact, and never none while it has people',
      async fn() {
        await inRollback(async (tx) => {
          const [t] = rowsOf(await tx.execute(sql`
            SELECT team_id AS "teamId" FROM notified_team_contacts
             GROUP BY team_id HAVING count(*) >= 2 LIMIT 1`)) as Array<{ teamId: string }>;
          if (!t) return;

          const people = await tx.select().from(notifiedTeamContacts)
            .where(eq(notifiedTeamContacts.teamId, t.teamId))
            .orderBy(asc(notifiedTeamContacts.sortOrder));
          const notPrimary = people.find((p) => !p.isPrimary)!;

          succeeded(await runIn(tx, 'tm.primary', admin, { v: notPrimary.id, arg: t.teamId }),
            'tm.primary');
          const after = await tx.select().from(notifiedTeamContacts)
            .where(eq(notifiedTeamContacts.teamId, t.teamId));
          equals(after.filter((p) => p.isPrimary).length, 1);
          ok(after.find((p) => p.id === notPrimary.id)!.isPrimary, 'and it is the one asked for');

          /* Removing the primary hands it to somebody rather than leaving none. */
          succeeded(await runIn(tx, 'tm.remove', admin, { v: notPrimary.id, arg: t.teamId }),
            'tm.remove');
          const left = await tx.select().from(notifiedTeamContacts)
            .where(eq(notifiedTeamContacts.teamId, t.teamId));
          equals(left.filter((p) => p.isPrimary).length, 1, 'somebody is still the primary');
        });
      },
    },

    {
      name: 'removing the only contact on a team asks first',
      async fn() {
        await inRollback(async (tx) => {
          const [t] = rowsOf(await tx.execute(sql`
            SELECT team_id AS "teamId" FROM notified_team_contacts
             GROUP BY team_id HAVING count(*) = 1 LIMIT 1`)) as Array<{ teamId: string }>;
          if (!t) return;
          const [only] = await tx.select().from(notifiedTeamContacts)
            .where(eq(notifiedTeamContacts.teamId, t.teamId));

          const asked = await runIn(tx, 'tm.remove', admin, { v: only.id, arg: t.teamId });
          succeeded(asked);
          ok((asked as { confirm?: unknown }).confirm, 'it asked before doing it');
          const [still] = await tx.select().from(notifiedTeamContacts)
            .where(eq(notifiedTeamContacts.id, only.id));
          ok(still, 'and did nothing until it was answered');

          succeeded(await runIn(tx, 'tm.remove', admin, {
            v: only.id, arg: t.teamId, fields: { confirmed: '1' },
          }));
        });
      },
    },

    /* ── An SLA on a template ──────────────────────────────────────────── */
    {
      name: 'a stage SLA is stored as an override, and its own default is not',
      async fn() {
        await inRollback(async (tx) => {
          const [p] = await tx.select().from(pipelines).limit(1);
          const [stage] = rowsOf(await tx.execute(sql`
            SELECT key, default_sla AS "defaultSla" FROM stages
             WHERE NOT fixed ORDER BY ordinal LIMIT 1`)) as
            Array<{ key: string; defaultSla: number }>;

          const other = Number(stage.defaultSla) === 5 ? 6 : 5;
          succeeded(await runIn(tx, 'set.sla', admin, {
            v: String(other), arg: `${p.id}|${stage.key}`,
          }), 'set.sla');

          const [once] = await tx.select().from(pipelines).where(eq(pipelines.id, p.id));
          equals((once.slaOverrides as Record<string, number>)[stage.key], other);

          /* Putting it back to the stage's own figure removes the override
             rather than storing the same number twice. */
          succeeded(await runIn(tx, 'set.sla', admin, {
            v: String(stage.defaultSla), arg: `${p.id}|${stage.key}`,
          }), 'back to the default');
          const [twice] = await tx.select().from(pipelines).where(eq(pipelines.id, p.id));
          ok(!(stage.key in (twice.slaOverrides as Record<string, number>)),
            'the override is gone, not set to the default');

          refused(await runIn(tx, 'set.sla', admin, { v: '400', arg: `${p.id}|${stage.key}` }),
            'between 1 and 90');
        });
      },
    },

    /* ── References ────────────────────────────────────────────────────── */
    {
      name: 'a referee is marked as chased, but not recorded from the row',
      async fn() {
        await inRollback(async (tx) => {
          const [r] = await tx.select().from(references)
            .where(sql`${references.status} = 'pending'`).limit(1);
          if (!r) return;

          succeeded(await runIn(tx, 'ref.status', onboarder, {
            v: 'contacted', arg: `${r.employeeId}:${r.id}`,
          }), 'ref.status');
          const [after] = await tx.select().from(references).where(eq(references.id, r.id));
          equals(after.status, 'contacted');
          ok(after.contactedAt, 'and when');

          refused(await runIn(tx, 'ref.status', onboarder, {
            v: 'done', arg: `${r.employeeId}:${r.id}`,
          }), 'recorded through the panel');
        });
      },
    },

    {
      name: 'removing a referee whose reference is in asks first',
      async fn() {
        await inRollback(async (tx) => {
          const [r] = await tx.select().from(references)
            .where(sql`${references.status} = 'done'`).limit(1);
          if (!r) return;

          const asked = await runIn(tx, 'ref.remove', onboarder, { v: r.id, arg: r.employeeId });
          succeeded(asked);
          ok((asked as { confirm?: unknown }).confirm, 'it asked');
          const [still] = await tx.select().from(references).where(eq(references.id, r.id));
          ok(still, 'and nothing happened yet');

          succeeded(await runIn(tx, 'ref.remove', onboarder, {
            v: r.id, arg: r.employeeId, fields: { confirmed: '1' },
          }));
          const [gone] = await tx.select().from(references).where(eq(references.id, r.id));
          ok(!gone, 'then it went');
        });
      },
    },

    /* ── A joiner's paperwork ──────────────────────────────────────────── */
    {
      name: 'a document is verified from the row, and can be sent back for checking',
      async fn() {
        await inRollback(async (tx) => {
          const [doc] = await tx.select().from(onboardingDocuments)
            .where(sql`${onboardingDocuments.status} = 'uploaded'`).limit(1);
          if (!doc) return;

          succeeded(await runIn(tx, 'emp.verify', onboarder, {
            v: doc.key, arg: doc.employeeId,
          }), 'emp.verify');
          const [verified] = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.id, doc.id));
          equals(verified.status, 'verified');
          ok(verified.verifiedAt, 'and when');

          succeeded(await runIn(tx, 'emp.unverify', onboarder, {
            v: doc.key, arg: doc.employeeId,
          }), 'emp.unverify');
          const [back] = await tx.select().from(onboardingDocuments)
            .where(eq(onboardingDocuments.id, doc.id));
          equals(back.status, 'uploaded', 'back to received, with the file still on it');
          equals(back.verifiedAt, null);
          ok(back.fileId === doc.fileId, 'and the file itself was not touched');

          refused(await runIn(tx, 'emp.unverify', onboarder, {
            v: doc.key, arg: doc.employeeId,
          }), 'not verified');
        });
      },
    },

    /* ── Integrations ──────────────────────────────────────────────────── */
    {
      name: 'an integration with nothing configured cannot be switched off',
      async fn() {
        await inRollback(async (tx) => {
          const [none] = await tx.select().from(integrations)
            .where(eq(integrations.state, 'not_configured')).limit(1);
          if (none) {
            refused(await runIn(tx, 'set.conn', admin, { v: none.id }), 'nothing configured');
          }

          const [live] = await tx.select().from(integrations)
            .where(eq(integrations.state, 'connected')).limit(1);
          if (!live) return;

          const asked = await runIn(tx, 'set.conn', admin, { v: live.id });
          succeeded(asked);
          ok((asked as { confirm?: unknown }).confirm, 'switching one off asks first');

          succeeded(await runIn(tx, 'set.conn', admin, {
            v: live.id, fields: { confirmed: '1' },
          }));
          const [off] = await tx.select().from(integrations).where(eq(integrations.id, live.id));
          equals(off.state, 'disabled');
          includes(String(off.detail), 'Naif');

          /* And back on without asking, because putting it back is not risky. */
          succeeded(await runIn(tx, 'set.conn', admin, { v: live.id }));
          const [on] = await tx.select().from(integrations).where(eq(integrations.id, live.id));
          equals(on.state, 'connected');
        });
      },
    },
  ],
};

export default suite;
