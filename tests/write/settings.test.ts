import { sql, eq, and } from 'drizzle-orm';
import {
  orgSettings, departments, jobs, approvalFlows, approvalFlowSteps, pipelines,
  emailTemplates, questionBank, pitchProjects, pitchConfig, automationRules,
  notifiedTeams, notifiedTeamContacts, accounts, auditEvents,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 12 — settings.

   Almost everything here is a short list somebody maintains by hand, so the
   suite is about the two things that keep those lists safe: a reference row is
   archived rather than deleted when anything points at it, and a change that
   would strand somebody — a department with live requisitions, a stage with
   people standing on it — is refused with what is in the way.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true,
  staffId: 'stf_01', accountId: 'acc_01',
});
const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const onboarding = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', staffId: 'stf_07', roleLabel: 'Onboarding',
});

const suite: Suite = {
  name: 'write · settings',
  tests: [
    {
      name: 'the organisation record is validated before it is saved',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'set.org', admin, {
            fields: { brandPrimary: 'forest green' },
          }), 'six-digit hex');
          refused(await runIn(tx, 'set.org', admin, {
            fields: { probationMonths: '18' },
          }), 'one and twelve');

          succeeded(await runIn(tx, 'set.org', admin, {
            fields: { brandPrimary: '#0E9E62', probationMonths: '6', signedBy: 'Naif Allehaidan' },
          }));
          const [org] = await tx.select().from(orgSettings);
          equals(org.probationMonths, 6);
          equals(org.signedBy, 'Naif Allehaidan');

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityType, 'org'));
          ok(trail.length >= 1, 'the change is on the record');
          includes(trail[trail.length - 1].summary, 'probationMonths');
        });
      },
    },

    {
      name: 'only an Admin changes the organisation',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'set.org', recruiter, { fields: { orgName: 'Nope' } }),
            'does not include');
        });
      },
    },

    {
      name: 'a department cannot be removed while it has live requisitions',
      async fn() {
        await inRollback(async (tx) => {
          const [busy] = rowsOf(await tx.execute(sql`
            SELECT d.id, d.name FROM departments d
             WHERE EXISTS (SELECT 1 FROM jobs j
                            WHERE j.dept_id = d.id
                              AND j.status IN ('draft','pending_approval','open','on_hold'))
             ORDER BY d.sort_order LIMIT 1`)) as Array<{ id: string; name: string }>;
          const asked = await runIn(tx, 'dept.remove', admin, { v: busy.id });
          ok((asked as { confirm?: unknown }).confirm, 'it asks first');
          refused(await runIn(tx, 'dept.remove', admin, {
            v: busy.id, fields: { confirmed: '1' },
          }), 'close or move them first');

          const [quiet] = rowsOf(await tx.execute(sql`
            SELECT d.id, d.name FROM departments d
             WHERE d.archived_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM jobs j
                                WHERE j.dept_id = d.id
                                  AND j.status IN ('draft','pending_approval','open','on_hold'))
             ORDER BY d.sort_order LIMIT 1`)) as Array<{ id: string; name: string }>;
          if (quiet) {
            succeeded(await runIn(tx, 'dept.remove', admin, {
              v: quiet.id, fields: { confirmed: '1' },
            }));
            const [d] = await tx.select().from(departments).where(eq(departments.id, quiet.id));
            ok(d, 'the row is kept');
            ok(d.archivedAt, 'and archived rather than deleted');
          }
        });
      },
    },

    {
      name: 'changing a department head moves the live requisitions and leaves the closed ones',
      async fn() {
        await inRollback(async (tx) => {
          const [d] = rowsOf(await tx.execute(sql`
            SELECT d.id, d.name, d.head FROM departments d
             WHERE d.head IS NOT NULL
               AND EXISTS (SELECT 1 FROM jobs j
                            WHERE j.dept_id = d.id AND j.hiring_manager = d.head
                              AND j.status IN ('open','on_hold'))
             ORDER BY d.sort_order LIMIT 1`)) as Array<{ id: string; name: string; head: string }>;
          ok(d, 'a department whose head runs live requisitions');

          const closedBefore = rowsOf(await tx.execute(sql`
            SELECT id FROM jobs WHERE dept_id = ${d.id} AND hiring_manager = ${d.head}
               AND status = 'closed'`)).map((x) => x.id as string);

          const r = await runIn(tx, 'dept.save', admin, {
            v: d.id,
            fields: { name: d.name, head: 'Mariam Al-Qassim Test', headTitle: 'Head of Test' },
          });
          succeeded(r, 'dept.save');

          const live = await tx.select().from(jobs)
            .where(and(eq(jobs.deptId, d.id), eq(jobs.hiringManager, d.head),
              sql`${jobs.status} IN ('open','on_hold')`));
          equals(live.length, 0, 'no live requisition still names the old head');

          if (closedBefore.length) {
            const kept = rowsOf(await tx.execute(sql`
              SELECT count(*)::int AS n FROM jobs
               WHERE id IN (${sql.join(closedBefore.map((i) => sql`${i}`), sql`, `)})
                 AND hiring_manager = ${d.head}`))[0] as { n: number };
            equals(Number(kept.n), closedBefore.length,
              'and every closed one keeps whoever actually ran it');
          }

          const [acct] = await tx.select().from(accounts)
            .where(sql`lower(${accounts.name}) = 'mariam al-qassim test'`);
          ok(acct, 'the new head can sign in');
          equals(acct.role, 'hiring_manager');
        });
      },
    },

    {
      name: 'an approval chain always keeps at least one step',
      async fn() {
        await inRollback(async (tx) => {
          const [flow] = await tx.select().from(approvalFlows)
            .where(eq(approvalFlows.subject, 'requisition')).limit(1);
          const steps = await tx.select().from(approvalFlowSteps)
            .where(eq(approvalFlowSteps.flowId, flow.id))
            .orderBy(approvalFlowSteps.ordinal);

          for (const s of steps.slice(0, -1)) {
            succeeded(await runIn(tx, 'apf.stepRemove', admin, { v: s.id }));
          }
          const last = await tx.select().from(approvalFlowSteps)
            .where(eq(approvalFlowSteps.flowId, flow.id));
          equals(last.length, 1);
          refused(await runIn(tx, 'apf.stepRemove', admin, { v: last[0].id }),
            'at least one step');
        });
      },
    },

    {
      name: 'a step is added at the end, and its order stays 0,1,2 after a removal',
      async fn() {
        await inRollback(async (tx) => {
          const [flow] = await tx.select().from(approvalFlows)
            .where(eq(approvalFlows.subject, 'requisition')).limit(1);

          succeeded(await runIn(tx, 'apf.stepSave', admin, {
            v: `${flow.id}:new`,
            fields: { label: 'Legal review', approverType: 'named', approverName: 'Dana Legal Test' },
          }));
          let steps = await tx.select().from(approvalFlowSteps)
            .where(eq(approvalFlowSteps.flowId, flow.id))
            .orderBy(approvalFlowSteps.ordinal);
          equals(steps[steps.length - 1].label, 'Legal review', 'added at the end');

          succeeded(await runIn(tx, 'apf.stepRemove', admin, { v: steps[0].id }));
          steps = await tx.select().from(approvalFlowSteps)
            .where(eq(approvalFlowSteps.flowId, flow.id))
            .orderBy(approvalFlowSteps.ordinal);
          equals(steps.map((s) => s.ordinal).join(','),
            steps.map((_, i) => i).join(','), 'and the gap is closed');
        });
      },
    },

    {
      name: 'a named approver needs a name, and a condition needs a figure',
      async fn() {
        await inRollback(async (tx) => {
          const [flow] = await tx.select().from(approvalFlows)
            .where(eq(approvalFlows.subject, 'offer')).limit(1);
          refused(await runIn(tx, 'apf.stepSave', admin, {
            v: `${flow.id}:new`, fields: { label: 'Somebody', approverType: 'named' },
          }), 'needs a name');
          refused(await runIn(tx, 'apf.stepSave', admin, {
            v: `${flow.id}:new`,
            fields: {
              label: 'Finance', approverType: 'named', approverName: 'Nadia Kassem',
              condField: 'baseMonthly',
            },
          }), 'needs a figure');
        });
      },
    },

    {
      name: 'a stage cannot be switched off under people standing on it',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT j.pipeline_id, a.stage::text AS stage, count(*)::int AS n
              FROM applications a JOIN jobs j ON j.id = a.job_id
             WHERE a.status IN ('active','on_hold') AND j.pipeline_id IS NOT NULL
             GROUP BY 1, 2 ORDER BY n DESC LIMIT 1`)) as
            Array<{ pipeline_id: string; stage: string; n: number }>;

          refused(await runIn(tx, 'pl.save', admin, {
            v: row.pipeline_id, fields: { offStages: [row.stage] },
          }), 'standing on a stage you are switching off');

          /* One nobody is on goes off without argument. */
          const [empty] = rowsOf(await tx.execute(sql`
            SELECT s.key FROM stages s
             WHERE NOT EXISTS (
               SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
                WHERE j.pipeline_id = ${row.pipeline_id} AND a.status IN ('active','on_hold')
                  AND a.stage::text = s.key::text)
             ORDER BY s.ordinal LIMIT 1`)) as Array<{ key: string }>;
          if (empty) {
            succeeded(await runIn(tx, 'pl.save', admin, {
              v: row.pipeline_id, fields: { offStages: [empty.key] },
            }));
          }
        });
      },
    },

    {
      name: 'an SLA outside a working range is refused',
      async fn() {
        await inRollback(async (tx) => {
          const [p] = await tx.select().from(pipelines).limit(1);
          refused(await runIn(tx, 'pl.save', admin, {
            v: p.id, fields: { sla: JSON.stringify({ screen: 0 }) },
          }), 'between one and sixty');
          succeeded(await runIn(tx, 'pl.save', admin, {
            v: p.id, fields: { sla: JSON.stringify({ screen: 5 }) },
          }));
          const [after] = await tx.select().from(pipelines).where(eq(pipelines.id, p.id));
          equals(after.slaOverrides.screen, 5);
        });
      },
    },

    {
      name: 'the candidate-facing wording is an Admin’s to change',
      async fn() {
        await inRollback(async (tx) => {
          const [t] = await tx.select().from(emailTemplates).limit(1);
          refused(await runIn(tx, 'etpl.save', recruiter, {
            v: t.id, fields: { name: t.name, subject: 'x', body: 'y' },
          }), 'does not include');
          refused(await runIn(tx, 'etpl.save', onboarding, {
            v: t.id, fields: { name: t.name, subject: 'x', body: 'y' },
          }), 'does not include');

          succeeded(await runIn(tx, 'etpl.save', admin, {
            v: t.id,
            fields: { name: t.name, stage: t.stage ?? 'any', subject: 'A new subject', body: 'A new body.' },
          }));
          const [after] = await tx.select().from(emailTemplates).where(eq(emailTemplates.id, t.id));
          equals(after.subject, 'A new subject');
        });
      },
    },

    {
      name: 'a choice question needs some choices, and retiring one keeps it',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'qb.save', admin, {
            fields: { text: 'Pick one', type: 'choice' },
          }), 'needs some choices');

          const added = await runIn(tx, 'qb.save', admin, {
            fields: {
              text: 'Do you hold a valid driving licence?', type: 'yesno',
              required: '1', knockout: 'Yes',
            },
          });
          succeeded(added, 'qb.save');

          const [q] = await tx.select().from(questionBank)
            .where(sql`${questionBank.text} = 'Do you hold a valid driving licence?'`);
          equals(q.knockout, 'Yes');
          ok(q.required, 'and is required');

          succeeded(await runIn(tx, 'qb.remove', admin, {
            v: q.id, fields: { confirmed: '1' },
          }));
          const [after] = await tx.select().from(questionBank).where(eq(questionBank.id, q.id));
          ok(after, 'the row is kept');
          ok(after.archivedAt, 'and archived');
        });
      },
    },

    {
      name: 'a pitch project needs criteria, and retiring one leaves it on the record',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'pp.save', admin, {
            fields: { pp_name: 'A project', pp_brief: 'The situation', pp_task: 'Pitch it' },
          }), 'needs the criteria');

          const added = await runIn(tx, 'pp.save', admin, {
            fields: {
              pp_name: 'Renewal — Jeddah agency test',
              pp_who: 'The owner',
              pp_client: 'Test Real Estate',
              pp_brief: 'They left last year and the leads did not convert.',
              pp_task: 'Win them back on a twelve-month renewal.',
              pp_dur: '20',
              pp_c0: 'Discovery', pp_h0: 'asked before pitching',
              pp_c1: 'Product', pp_c2: 'Value and pricing',
            },
          });
          succeeded(added, 'pp.save');

          const [p] = await tx.select().from(pitchProjects)
            .where(sql`${pitchProjects.name} = 'Renewal — Jeddah agency test'`);
          equals(p.criteria.length, 3);
          equals(p.criteria[0].key, 'discovery');
          ok(p.active, 'and is live');

          succeeded(await runIn(tx, 'pp.toggle', admin, { v: p.id }));
          const [after] = await tx.select().from(pitchProjects).where(eq(pitchProjects.id, p.id));
          equals(after.active, false, 'retired, not deleted');
        });
      },
    },

    {
      name: 'the brief needs somewhere to go',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'pp.cfgSave', admin, { fields: { channels: [] as string[] } }),
            'at least one channel');
          refused(await runIn(tx, 'pp.cfgSave', admin, { fields: { leadHours: '400' } }),
            'an hour and a week');
          succeeded(await runIn(tx, 'pp.cfgSave', admin, {
            fields: { leadHours: '48', channels: ['whatsapp'], gateFinal: '1' },
          }));
          const [cfg] = await tx.select().from(pitchConfig);
          equals(cfg.leadHours, 48);
          equals(cfg.channels.join(','), 'whatsapp');
        });
      },
    },

    {
      name: 'an automation toggle is the switch, and it is on the record',
      async fn() {
        await inRollback(async (tx) => {
          const [rule] = await tx.select().from(automationRules)
            .where(eq(automationRules.enabled, true)).limit(1);
          const r = await runIn(tx, 'aut.toggle', admin, { v: rule.id });
          succeeded(r, 'aut.toggle');
          includes(String((r as { toast?: string }).toast), 'off');

          const [after] = await tx.select().from(automationRules)
            .where(eq(automationRules.id, rule.id));
          equals(after.enabled, false);

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, rule.id));
          equals(trail.length, 1);
          equals((trail[0].before as Record<string, unknown>).enabled, true);
          equals((trail[0].after as Record<string, unknown>).enabled, false);

          refused(await runIn(tx, 'aut.toggle', recruiter, { v: rule.id }), 'does not include');
        });
      },
    },

    {
      name: 'a notification team keeps its contacts, primary first',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'tm.teamSave', admin, {
            fields: {
              short: 'Legal',
              name: 'Legal & Compliance Test',
              ask: 'Please open the contract file.',
              onJoining: '1',
              onFile: '1',
              contacts: JSON.stringify([
                { name: 'Dana Al-Harthy', email: 'dana@bayut.sa', isPrimary: true },
                { name: 'Omar Legal', email: 'omar@bayut.sa' },
              ]),
            },
          });
          succeeded(r, 'tm.teamSave');

          const [team] = await tx.select().from(notifiedTeams)
            .where(sql`${notifiedTeams.name} = 'Legal & Compliance Test'`);
          equals(team.key, 'legal');
          ok(team.onJoining && team.onFile, 'and receives both packs');

          const contacts = await tx.select().from(notifiedTeamContacts)
            .where(eq(notifiedTeamContacts.teamId, team.id))
            .orderBy(notifiedTeamContacts.sortOrder);
          equals(contacts.length, 2);
          ok(contacts[0].isPrimary, 'the first is the one written to');
          equals(contacts[1].email, 'omar@bayut.sa');
        });
      },
    },

    {
      name: 'access is an Admin’s, and nobody locks themselves out',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'acc.inviteSave', recruiter, {
            fields: { name: 'Somebody New' },
          }), 'does not include');

          const invited = await runIn(tx, 'acc.inviteSave', admin, {
            fields: { name: 'Rania Al-Harbi Test', title: 'Head of Ops', role: 'hiring_manager' },
          });
          succeeded(invited, 'acc.invite');
          includes(String((invited as { toast?: string }).toast), 'rania.alharbi.test@bayut.sa');

          const [acct] = await tx.select().from(accounts)
            .where(sql`lower(${accounts.email}) = 'rania.alharbi.test@bayut.sa'`);
          equals(acct.status, 'invited');

          succeeded(await runIn(tx, 'acc.scopeSave', admin, {
            v: acct.id, fields: { kind: 'own' },
          }));
          const [scoped] = await tx.select().from(accounts).where(eq(accounts.id, acct.id));
          equals(scoped.scopeKind, 'own');

          refused(await runIn(tx, 'acc.scopeSave', admin, {
            v: acct.id, fields: { kind: 'jobs', jobIds: [] },
          }), 'Pick at least one requisition');

          const [own] = await tx.select().from(accounts)
            .where(eq(accounts.id, admin.accountId)).limit(1);
          if (own) {
            refused(await runIn(tx, 'acc.toggle', admin, { v: own.id }), 'your own account');
            refused(await runIn(tx, 'acc.remove', admin, { v: own.id }), 'your own account');
          }
        });
      },
    },

    {
      name: 'a reset sends somebody back to the start of the password flow',
      async fn() {
        await inRollback(async (tx) => {
          const [acct] = await tx.select().from(accounts)
            .where(sql`${accounts.passwordHash} IS NOT NULL`)
            .limit(1);
          ok(acct, 'somebody has a password set');

          succeeded(await runIn(tx, 'acc.reset', admin, { v: acct.id }));
          const [after] = await tx.select().from(accounts).where(eq(accounts.id, acct.id));
          ok(!after.passwordHash, 'the hash is gone');
          equals(after.status, 'invited');
          ok(after.mustChangePassword, 'and is told to set one');
          equals(after.failedAttempts, 0, 'and the lockout is cleared');
        });
      },
    },
  ],
};

export default suite;
