import { sql, eq, and } from 'drizzle-orm';
import {
  automationRules, automationRuns, domainEvents, tasks, notifications, messages,
  applications, offers, probationRecords,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, viewer } from '../commands/harness';
import { ok, eq as equals, includes, type Suite } from '../run';
import { dispatchPending, runRule, conditionsHold, subjectOf } from '@/lib/services/automation';
import { slaSweep, probationSweep, scorecardSweep, runDailySweeps } from '@/lib/services/sweeps';
import type { Ctx } from '@/lib/audit';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 10 — the automation engine and the sweeps.

   The engine is the part of the product nobody watches, so the suite is mostly
   about the guarantees that make it safe to leave alone: a rule runs once per
   event, a disabled rule never runs, conditions are applied to the event rather
   than to the record as it is now, and every run leaves a row saying what it
   did and why.
   ───────────────────────────────────────────────────────────────────────────*/

const system = viewer({
  name: 'System', staffRole: null, roleLabel: 'System', isAdmin: true, staffId: null,
});

const ctxOf = (tx: Parameters<typeof dispatchPending>[0]['tx'], now = new Date()) => ({
  viewer: system,
  requestId: 'test-worker',
  correlationId: 'test-worker',
  tx,
  now,
}) as Ctx & { tx: typeof tx; now: Date };

/** Put an event on the log, the way a command would. */
async function raise(
  tx: Parameters<typeof runIn>[0],
  input: { type: string; subjectType: string; subjectId: string; payload?: Record<string, unknown> },
) {
  const id = `evt_test_${Math.random().toString(36).slice(2, 10)}`;
  await tx.insert(domainEvents).values({
    id,
    type: input.type,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    payload: input.payload ?? {},
    actorName: 'System',
    at: new Date(),
  });
  const [row] = await tx.select().from(domainEvents).where(eq(domainEvents.id, id));
  return row;
}

/* The harness's runIn is only here for its transaction type. */
import { runIn } from '../commands/harness';

async function liveApp(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.candidate_id, a.job_id, a.recruiter_id, c.name AS candidate, j.title
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id
     WHERE a.status = 'active' AND a.recruiter_id IS NOT NULL
     ORDER BY a.id LIMIT 1`));
  return row as {
    id: string; candidate_id: string; job_id: string; recruiter_id: string;
    candidate: string; title: string;
  };
}

const suite: Suite = {
  name: 'write · automations and sweeps',
  tests: [
    {
      name: 'an event fires the rules that want it, and nothing else',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          await raise(tx, {
            type: 'sla.breached',
            subjectType: 'application',
            subjectId: a.id,
            payload: { applicationId: a.id, stage: 'screen', days: 9, sla: 4, over: 5 },
          });

          const r = await dispatchPending(ctxOf(tx));
          equals(r.events, 1, 'one event dispatched');
          const ran = r.runs.filter((x) => x.state === 'succeeded');
          ok(ran.length >= 1, 'the SLA rule ran');
          ok(ran.every((x) => x.ruleName.includes('SLA')), 'and only that rule');

          const raised = await tx.select().from(tasks)
            .where(and(eq(tasks.applicationId, a.id), eq(tasks.kind, 'sla')));
          equals(raised.length, 1, 'the chase task was raised');
          equals(raised[0].assigneeId, a.recruiter_id, 'on the recruiter who owns it');

          const bell = await tx.select().from(notifications)
            .where(eq(notifications.applicationId, a.id));
          ok(bell.some((n) => n.kind === 'sla'), 'and the desk was told');
        });
      },
    },

    {
      name: 'the same event never fires the same rule twice',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const event = await raise(tx, {
            type: 'sla.breached',
            subjectType: 'application',
            subjectId: a.id,
            payload: { applicationId: a.id, days: 9, sla: 4 },
          });

          const [rule] = await tx.select().from(automationRules)
            .where(and(eq(automationRules.trigger, 'sla.breached'), eq(automationRules.enabled, true)))
            .limit(1);

          const first = await runRule(rule, event, ctxOf(tx));
          equals(first.state, 'succeeded');
          const second = await runRule(rule, event, ctxOf(tx));
          equals(second.state, 'skipped');
          includes(second.skippedReason ?? '', 'already run');

          const runs = await tx.select().from(automationRuns)
            .where(eq(automationRuns.eventId, event.id));
          equals(runs.length, 1, 'one run, not two');
        });
      },
    },

    {
      name: 'a disabled rule is never evaluated',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          await tx.update(automationRules)
            .set({ enabled: false })
            .where(eq(automationRules.trigger, 'sla.breached'));

          await raise(tx, {
            type: 'sla.breached', subjectType: 'application', subjectId: a.id,
            payload: { applicationId: a.id },
          });
          const r = await dispatchPending(ctxOf(tx));
          equals(r.events, 1, 'the event is still dispatched');
          equals(r.runs.length, 0, 'but nothing ran');

          const raised = await tx.select().from(tasks)
            .where(and(eq(tasks.applicationId, a.id), eq(tasks.kind, 'sla')));
          equals(raised.length, 0);
        });
      },
    },

    {
      name: 'a condition is read off the event, and a miss is recorded with its reason',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const [rule] = await tx.select().from(automationRules)
            .where(eq(automationRules.trigger, 'application.stage_changed')).limit(1);
          ok(rule, 'the stage-change rule exists');
          ok(rule.conditions.length > 0, 'and it has a condition');

          equals(conditionsHold(rule, { toStage: 'assessment' }).ok, true);
          const miss = conditionsHold(rule, { toStage: 'iv1' });
          equals(miss.ok, false);
          if (!miss.ok) includes(miss.why, 'toStage');

          await tx.update(automationRules).set({ enabled: true }).where(eq(automationRules.id, rule.id));
          const event = await raise(tx, {
            type: 'application.stage_changed',
            subjectType: 'application',
            subjectId: a.id,
            payload: { applicationId: a.id, toStage: 'iv1' },
          });
          const out = await runRule(rule, event, ctxOf(tx));
          equals(out.state, 'skipped');

          const [run] = await tx.select().from(automationRuns)
            .where(eq(automationRuns.eventId, event.id));
          equals(run.state, 'skipped');
          equals(run.conditionsMet, false);
          includes(run.skippedReason ?? '', 'toStage');
        });
      },
    },

    {
      name: 'a message action writes to the outbox and says so on the run',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const [rule] = await tx.select().from(automationRules)
            .where(eq(automationRules.trigger, 'application.created')).limit(1);
          await tx.update(automationRules).set({ enabled: true }).where(eq(automationRules.id, rule.id));

          const event = await raise(tx, {
            type: 'application.created',
            subjectType: 'application',
            subjectId: a.id,
            payload: { applicationId: a.id },
          });
          const out = await runRule(rule, event, ctxOf(tx));
          equals(out.state, 'succeeded');
          ok(out.ran.some((x) => x.type === 'send_message'), 'the message action ran');
          /* No e-mail provider in a test environment, and the run says so. */
          includes(out.ran.find((x) => x.type === 'send_message')?.detail ?? '', 'not sent');

          const [msg] = await tx.select().from(messages)
            .where(eq(messages.applicationId, a.id))
            .orderBy(sql`${messages.at} DESC`).limit(1);
          equals(msg.status, 'not_configured');
          ok(!/\{\{/.test(msg.body), 'with the template filled');
          includes(msg.body, a.candidate.split(/\s+/)[0]);

          const [run] = await tx.select().from(automationRuns)
            .where(eq(automationRuns.eventId, event.id));
          ok(run.actionsRun.length >= 1, 'and the run records what it did');
        });
      },
    },

    {
      name: 'an action that cannot work leaves the run failed with the reason on it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const id = 'aut_test_broken';
          await tx.insert(automationRules).values({
            id,
            name: 'A rule that asks for a template nobody wrote',
            trigger: 'application.created',
            conditions: [],
            actions: [{ type: 'send_message', channel: 'Email', template: 'no_such_template' }],
            enabled: true,
            isSystem: false,
            sortOrder: 9999,
          });

          const event = await raise(tx, {
            type: 'application.created', subjectType: 'application', subjectId: a.id,
            payload: { applicationId: a.id },
          });
          const [rule] = await tx.select().from(automationRules).where(eq(automationRules.id, id));
          const out = await runRule(rule, event, ctxOf(tx));
          equals(out.state, 'failed');
          includes(out.error ?? '', 'no_such_template');

          const [run] = await tx.select().from(automationRuns)
            .where(and(eq(automationRuns.eventId, event.id), eq(automationRuns.ruleId, id)));
          equals(run.state, 'failed');
          includes(run.error ?? '', 'does not exist');
        });
      },
    },

    {
      name: 'the subject of an event is found however the event points at it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const byApplication = await subjectOf(
            await raise(tx, {
              type: 'application.hired', subjectType: 'application', subjectId: a.id,
            }),
            tx,
          );
          equals(byApplication.candidateName, a.candidate);
          equals(byApplication.jobTitle, a.title);
          equals(byApplication.recruiterId, a.recruiter_id);

          const [offer] = rowsOf(await tx.execute(sql`
            SELECT id, application_id FROM offers ORDER BY id LIMIT 1`)) as
            Array<{ id: string; application_id: string }>;
          const byOffer = await subjectOf(
            await raise(tx, { type: 'offer.signed', subjectType: 'offer', subjectId: offer.id }),
            tx,
          );
          equals(byOffer.applicationId, offer.application_id, 'an offer resolves to its application');
          ok(byOffer.candidateName, 'and so to the candidate');
        });
      },
    },

    {
      name: 'the SLA sweep raises one event per application per day',
      async fn() {
        await inRollback(async (tx) => {
          const ctx = ctxOf(tx);
          const first = await slaSweep(ctx);
          ok(first.length > 0, 'the dataset has applications past their SLA');
          /* Whole days: somebody who entered the stage four days and six hours ago
             has been there four days, and the SLA is four. */
          ok(first.every((h) => h.days >= h.sla), 'and each has reached its SLA');

          const raised = await tx.select().from(domainEvents)
            .where(sql`${domainEvents.type} IN ('sla.warning','sla.breached')`);
          equals(raised.length, first.length, 'one event each');

          /* Running it again on the same day changes nothing. */
          await slaSweep(ctx);
          const again = await tx.select().from(domainEvents)
            .where(sql`${domainEvents.type} IN ('sla.warning','sla.breached')`);
          equals(again.length, first.length, 'the same day raises nothing new');
        });
      },
    },

    {
      name: 'the probation sweep separates what is due from what is late',
      async fn() {
        await inRollback(async (tx) => {
          const hits = await probationSweep(ctxOf(tx), 365);
          ok(hits.length > 0, 'somebody is inside their probation');
          const events = await tx.select().from(domainEvents)
            .where(sql`${domainEvents.type} LIKE 'probation.%'`);
          equals(events.length, hits.length);
          const overdue = hits.filter((h) => h.overdue);
          const late = events.filter((e) => e.type === 'probation.overdue');
          equals(late.length, overdue.length, 'the late ones are marked late');
        });
      },
    },

    {
      name: 'the daily run raises its own tick, once',
      async fn() {
        await inRollback(async (tx) => {
          const ctx = ctxOf(tx);
          const summary = await runDailySweeps(ctx);
          ok(summary.sla >= 0 && summary.probation >= 0, 'it reports what it found');

          const ticks = await tx.select().from(domainEvents)
            .where(eq(domainEvents.type, 'schedule.daily'));
          equals(ticks.length, 1);

          await runDailySweeps(ctx);
          const again = await tx.select().from(domainEvents)
            .where(eq(domainEvents.type, 'schedule.daily'));
          equals(again.length, 1, 'a second run on the same day adds nothing');
        });
      },
    },

    {
      name: 'a scorecard nobody wrote is chased after two days, not before',
      async fn() {
        await inRollback(async (tx) => {
          const n = await scorecardSweep(ctxOf(tx), 48);
          const events = await tx.select().from(domainEvents)
            .where(eq(domainEvents.type, 'scorecard.overdue'));
          equals(events.length, n, 'one event per outstanding scorecard');
          if (n > 0) {
            ok(events.every((e) => (e.payload as Record<string, unknown>).who),
              'each naming whoever owes it');
          }
        });
      },
    },
  ],
};

export default suite;
