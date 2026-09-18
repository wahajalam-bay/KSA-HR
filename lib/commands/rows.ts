import 'server-only';
import { z } from 'zod';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  jobHiringManagers, jobQuestions, jobs, references, employees, onboardingDocuments,
  approvalFlows, approvalFlowSteps, notifiedTeams, notifiedTeamContacts, pipelines,
  integrations,
} from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { yes } from './fields';
import { requireJob } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { verifyDocument } from '@/lib/services/joiner';
import { rows as rowsOf } from '@/lib/queries/sql';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SMALL WRITES A ROW MAKES

   Moving a step up, making somebody the lead, ticking a channel, removing a
   referee, putting an SLA back. None of them opens a panel, all of them are
   one button on one row, and every one is the sort of write that gets built
   into whichever screen needed it first and then exists in four places.

   They are together here because they share a shape: the row's own id is the
   value, and what the row belongs to is written after the colon in the action
   — `apf.move:flow_a:up` is this step, in that flow, upwards. See
   `splitAction` in lib/nav.ts for how the two halves arrive.

   Being small does not make them exempt: each checks the capability, each
   checks the record is one the viewer may touch, and each leaves an audit
   event saying what moved.
   ═════════════════════════════════════════════════════════════════════════════*/

const base = z.object({
  v: z.string().default(''),
  fields: z.record(z.any()).default({}),
  arg: z.string().nullable().default(null),
});

/** The part of the action after the colon, split again on its own colons. */
const argParts = (arg: string | null): string[] => (arg ?? '').split(':').filter(Boolean);

defineMany({
  /* ── The hiring team ───────────────────────────────────────────────────── */
  /* Exactly one lead, always. Making somebody lead is therefore two writes in
     one transaction rather than a toggle that can leave a requisition with two
     or none. */
  'hm.lead': {
    capability: 'job.edit',
    schema: base,
    async run({ v }, ctx) {
      const [row] = await ctx.tx.select().from(jobHiringManagers)
        .where(eq(jobHiringManagers.id, v)).limit(1);
      if (!row) throw new CommandError('That person is not on the hiring team');
      await requireJob(ctx.viewer, row.jobId, ctx.tx);
      if (row.isLead) throw new CommandError(`${row.name} is already the lead`, { tone: 'warn' });

      const [was] = await ctx.tx.select().from(jobHiringManagers).where(and(
        eq(jobHiringManagers.jobId, row.jobId), eq(jobHiringManagers.isLead, true),
      )).limit(1);

      await ctx.tx.update(jobHiringManagers).set({ isLead: false })
        .where(and(eq(jobHiringManagers.jobId, row.jobId), eq(jobHiringManagers.isLead, true)));
      await ctx.tx.update(jobHiringManagers).set({ isLead: true })
        .where(eq(jobHiringManagers.id, v));
      /* The requisition carries the lead's name: it is what the board, the
         offer letter and every report say, so it moves with the lead. */
      await ctx.tx.update(jobs).set({ hiringManager: row.name, updatedAt: ctx.now })
        .where(eq(jobs.id, row.jobId));

      await audit(ctx, {
        action: 'update',
        summary: `made ${row.name} the lead hiring manager`,
        entityType: 'requisition', entityId: row.jobId,
        before: { lead: was?.name ?? null }, after: { lead: row.name },
      }, ctx.tx);
      return { toast: `${row.name} is now the lead`, icon: 'check' };
    },
  },

  /* ── The order of the careers form ─────────────────────────────────────── */
  'jq.move': {
    capability: 'job.edit',
    schema: base,
    async run({ v, arg }, ctx) {
      const dir = argParts(arg).pop();
      if (dir !== 'up' && dir !== 'down') throw new CommandError('Up or down?');

      const [q] = await ctx.tx.select().from(jobQuestions).where(eq(jobQuestions.id, v)).limit(1);
      if (!q) throw new CommandError('That question is no longer on this requisition');
      await requireJob(ctx.viewer, q.jobId, ctx.tx);

      const all = await ctx.tx.select().from(jobQuestions)
        .where(eq(jobQuestions.jobId, q.jobId)).orderBy(asc(jobQuestions.ordinal));
      const at = all.findIndex((x) => x.id === v);
      const to = dir === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= all.length) {
        throw new CommandError(`That question is already ${dir === 'up' ? 'first' : 'last'}`, { tone: 'warn' });
      }

      /* Rewrite the whole run rather than swapping two: the ordinals in the
         table may have gaps, and a swap would keep them. */
      const order = [...all];
      const [moved] = order.splice(at, 1);
      order.splice(to, 0, moved);
      for (let i = 0; i < order.length; i++) {
        if (order[i].ordinal !== i) {
          await ctx.tx.update(jobQuestions).set({ ordinal: i }).where(eq(jobQuestions.id, order[i].id));
        }
      }

      await audit(ctx, {
        action: 'update',
        summary: `moved an application question ${dir}`,
        entityType: 'requisition', entityId: q.jobId,
        before: { position: at + 1 }, after: { position: to + 1, question: q.text },
      }, ctx.tx);
      return { toast: 'Moved', icon: dir === 'up' ? 'arrU' : 'arrD', ms: 1600 };
    },
  },

  /* ── References ────────────────────────────────────────────────────────── */
  /* Marking one as chased. The answer itself goes through `ref.save`, which is
     the panel — this is the row's "I rang them" and nothing more, so it will
     not move a reference past `contacted`. */
  'ref.status': {
    capability: 'reference.record',
    schema: base,
    async run({ v, arg }, ctx) {
      /* `ref.status:<employee>:<referee>` with the new status as the value. */
      const refId = argParts(arg)[1];
      const want = v;
      if (!refId) throw new CommandError('Which referee?');
      const [r] = await ctx.tx.select().from(references).where(eq(references.id, refId)).limit(1);
      if (!r) throw new CommandError('That referee is no longer on the file');
      if (r.status === 'done') {
        throw new CommandError(`${r.name}’s reference is already recorded`, { tone: 'warn' });
      }
      if (want !== 'contacted' && want !== 'pending') {
        throw new CommandError('A reference is recorded through the panel, not from the row');
      }

      await ctx.tx.update(references).set({
        status: want as never,
        contactedAt: want === 'contacted' ? ctx.now : null,
      }).where(eq(references.id, refId));

      await audit(ctx, {
        action: 'update',
        summary: want === 'contacted'
          ? `marked ${r.name} as contacted for a reference`
          : `put ${r.name}’s reference back to pending`,
        entityType: 'employee', entityId: r.employeeId, entityLabel: r.name,
        before: { status: r.status }, after: { status: want },
      }, ctx.tx);
      return { toast: want === 'contacted' ? `${r.name} marked as contacted` : 'Back to pending', icon: 'phone' };
    },
  },

  'ref.remove': {
    capability: 'reference.record',
    schema: base,
    async run({ v, fields }, ctx) {
      const [r] = await ctx.tx.select().from(references).where(eq(references.id, v)).limit(1);
      if (!r) throw new CommandError('That referee is already off the file', { tone: 'warn' });

      if (r.status === 'done' && !yes(fields, 'confirmed')) {
        return {
          confirm: {
            title: `Remove ${r.name}?`,
            body: 'Their reference has already been recorded. Removing the referee removes what '
              + 'they said with them, and that cannot be undone from here.',
            yes: 'Remove the referee',
            no: 'Keep them',
            danger: true,
          },
        };
      }

      await ctx.tx.delete(references).where(eq(references.id, v));
      await audit(ctx, {
        action: 'delete',
        summary: `removed ${r.name} as a referee`,
        entityType: 'employee', entityId: r.employeeId, entityLabel: r.name,
        before: { name: r.name, company: r.company, status: r.status, rating: r.rating },
      }, ctx.tx);
      return { toast: `${r.name} removed`, icon: 'trash' };
    },
  },

  /* ── A joiner's documents, from the row ────────────────────────────────── */
  /* The same two writes as `onb.verify` and `onb.reject`, reached from the
     checklist instead of the panel: the action carries the employee and the
     value is which document. */
  'emp.verify': {
    capability: 'onboarding.verify',
    schema: base,
    async run({ v, arg }, ctx) {
      const employeeId = argParts(arg)[0];
      if (!employeeId || !v) throw new CommandError('That document was not understood');
      const r = await verifyDocument({ employeeId, key: v, accept: true }, ctx);
      return {
        toast: r.completed
          ? `${r.label} verified — the file is complete`
          : `${r.label} verified${r.left ? ` — ${r.left} to go` : ''}`,
        icon: r.completed ? 'trophy' : 'check',
        ms: r.completed ? 4600 : undefined,
      };
    },
  },

  /* Putting a verified document back to "received" — somebody verified the
     wrong one, or a better copy has arrived. It is not a rejection: the file
     stays, and the trail says who un-verified it. */
  'emp.unverify': {
    capability: 'onboarding.verify',
    schema: base,
    async run({ v, arg }, ctx) {
      const employeeId = argParts(arg)[0];
      if (!employeeId || !v) throw new CommandError('That document was not understood');

      const [doc] = await ctx.tx.select().from(onboardingDocuments).where(and(
        eq(onboardingDocuments.employeeId, employeeId), eq(onboardingDocuments.key, v),
      )).limit(1);
      if (!doc) throw new CommandError('That document is not on this file');
      if (doc.status !== 'verified') {
        throw new CommandError(`${doc.label} is not verified`, { tone: 'warn' });
      }

      await ctx.tx.update(onboardingDocuments).set({
        status: doc.fileId ? 'uploaded' : 'missing',
        verifiedAt: null,
        verifiedBy: null,
      }).where(eq(onboardingDocuments.id, doc.id));

      const [emp] = await ctx.tx.select({ name: employees.name })
        .from(employees).where(eq(employees.id, employeeId)).limit(1);
      await audit(ctx, {
        action: 'update',
        summary: `un-verified ${doc.label} on ${emp?.name ?? 'a joiner'}’s file`,
        entityType: 'employee', entityId: employeeId, entityLabel: emp?.name,
        before: { [doc.key]: 'verified' }, after: { [doc.key]: doc.fileId ? 'uploaded' : 'missing' },
      }, ctx.tx);
      return { toast: `${doc.label} needs checking again`, icon: 'refresh' };
    },
  },

  /* ── The approval chain ────────────────────────────────────────────────── */
  'apf.move': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, arg }, ctx) {
      const parts = argParts(arg);
      const dir = parts[parts.length - 1];
      if (dir !== 'up' && dir !== 'down') throw new CommandError('Up or down?');

      const [step] = await ctx.tx.select().from(approvalFlowSteps)
        .where(eq(approvalFlowSteps.id, v)).limit(1);
      if (!step) throw new CommandError('That step is no longer in the chain');

      const all = await ctx.tx.select().from(approvalFlowSteps)
        .where(eq(approvalFlowSteps.flowId, step.flowId)).orderBy(asc(approvalFlowSteps.ordinal));
      const at = all.findIndex((x) => x.id === v);
      const to = dir === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= all.length) {
        throw new CommandError(`That step is already ${dir === 'up' ? 'first' : 'last'}`, { tone: 'warn' });
      }

      const order = [...all];
      const [moved] = order.splice(at, 1);
      order.splice(to, 0, moved);

      /* The ordinal is unique per flow, so the run is rewritten out of the way
         first — otherwise the second update collides with the first. */
      for (const s of order) {
        await ctx.tx.update(approvalFlowSteps).set({ ordinal: -(s.ordinal + 1) })
          .where(eq(approvalFlowSteps.id, s.id));
      }
      for (let i = 0; i < order.length; i++) {
        await ctx.tx.update(approvalFlowSteps).set({ ordinal: i })
          .where(eq(approvalFlowSteps.id, order[i].id));
      }
      await ctx.tx.update(approvalFlows)
        .set({ updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null })
        .where(eq(approvalFlows.id, step.flowId));

      await audit(ctx, {
        action: 'update',
        summary: `moved "${step.label}" ${dir} the approval chain`,
        entityType: 'approval_flow', entityId: step.flowId, entityLabel: step.label,
        before: { position: at + 1 }, after: { position: to + 1 },
        reason: 'Records already in flight keep the steps they were submitted with',
      }, ctx.tx);
      return { toast: `"${step.label}" moved ${dir}`, icon: dir === 'up' ? 'arrU' : 'arrD', ms: 1800 };
    },
  },

  /* Where a requisition is posted when its chain closes. The tick is a toggle:
     a checkbox click says "the other way from now", which is the one thing the
     interface can be sure of. */
  'apf.channel': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, arg }, ctx) {
      const flowId = argParts(arg)[0];
      const channel = v;
      if (!flowId || !channel) throw new CommandError('Which channel, on which chain?');

      const [flow] = await ctx.tx.select().from(approvalFlows)
        .where(eq(approvalFlows.id, flowId)).limit(1);
      if (!flow) throw new CommandError('That approval chain no longer exists');

      const on = flow.publishChannels.includes(channel);
      const next = on
        ? flow.publishChannels.filter((c) => c !== channel)
        : [...flow.publishChannels, channel];

      await ctx.tx.update(approvalFlows).set({
        publishChannels: next, updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null,
      }).where(eq(approvalFlows.id, flowId));

      await audit(ctx, {
        action: 'update',
        summary: `${on ? 'stopped' : 'started'} publishing approved requisitions to ${channel}`,
        entityType: 'approval_flow', entityId: flowId, entityLabel: flow.name,
        before: { channels: flow.publishChannels }, after: { channels: next },
      }, ctx.tx);
      return {
        toast: on ? `${channel} off` : `${channel} on`,
        icon: on ? 'x' : 'check',
        ms: 1800,
      };
    },
  },

  /* ── The teams that are told about a joiner ────────────────────────────── */
  'tm.primary': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, arg }, ctx) {
      const teamId = argParts(arg)[0];
      const [c] = await ctx.tx.select().from(notifiedTeamContacts)
        .where(eq(notifiedTeamContacts.id, v)).limit(1);
      if (!c) throw new CommandError('That contact is no longer on the team');
      if (teamId && c.teamId !== teamId) throw new CommandError('That contact is on another team');
      if (c.isPrimary) throw new CommandError(`${c.name} is already the primary`, { tone: 'warn' });

      await ctx.tx.update(notifiedTeamContacts).set({ isPrimary: false })
        .where(eq(notifiedTeamContacts.teamId, c.teamId));
      await ctx.tx.update(notifiedTeamContacts).set({ isPrimary: true })
        .where(eq(notifiedTeamContacts.id, v));

      const [team] = await ctx.tx.select({ name: notifiedTeams.name })
        .from(notifiedTeams).where(eq(notifiedTeams.id, c.teamId)).limit(1);
      await audit(ctx, {
        action: 'update',
        summary: `made ${c.name} the primary contact for ${team?.name ?? 'a notified team'}`,
        entityType: 'settings', entityId: c.teamId, entityLabel: team?.name,
        after: { primary: c.name, email: c.email },
      }, ctx.tx);
      return { toast: `${c.name} is the primary contact`, icon: 'check' };
    },
  },

  'tm.remove': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const [c] = await ctx.tx.select().from(notifiedTeamContacts)
        .where(eq(notifiedTeamContacts.id, v)).limit(1);
      if (!c) throw new CommandError('That contact is already off the team', { tone: 'warn' });

      const rest = await ctx.tx.select({ id: notifiedTeamContacts.id })
        .from(notifiedTeamContacts)
        .where(and(eq(notifiedTeamContacts.teamId, c.teamId), ne(notifiedTeamContacts.id, v)));
      if (!rest.length && !yes(fields, 'confirmed')) {
        return {
          confirm: {
            title: `Remove ${c.name}?`,
            body: 'They are the only contact on this team, so nobody will be told when a joiner '
              + 'reaches it. The team stays; it just has nowhere to write to.',
            yes: 'Remove them anyway',
            no: 'Keep them',
            danger: true,
          },
        };
      }

      await ctx.tx.delete(notifiedTeamContacts).where(eq(notifiedTeamContacts.id, v));
      /* A team is never left with nobody marked primary while it still has
         people on it. */
      if (c.isPrimary && rest.length) {
        await ctx.tx.update(notifiedTeamContacts).set({ isPrimary: true })
          .where(eq(notifiedTeamContacts.id, rest[0].id));
      }

      const [team] = await ctx.tx.select({ name: notifiedTeams.name })
        .from(notifiedTeams).where(eq(notifiedTeams.id, c.teamId)).limit(1);
      await audit(ctx, {
        action: 'delete',
        summary: `removed ${c.name} from ${team?.name ?? 'a notified team'}`,
        entityType: 'settings', entityId: c.teamId, entityLabel: team?.name,
        before: { name: c.name, email: c.email, primary: c.isPrimary },
      }, ctx.tx);
      return { toast: `${c.name} removed`, icon: 'trash' };
    },
  },

  /* ── What happens when a chain closes ─────────────────────────── */
  'apf.publish': {
    capability: 'settings.edit',
    schema: base,
    async run({ v }, ctx) {
      const [flow] = await ctx.tx.select().from(approvalFlows)
        .where(eq(approvalFlows.id, v)).limit(1);
      if (!flow) throw new CommandError('That approval chain no longer exists');
      const on = !flow.publishOnApprove;
      if (on && !flow.publishChannels.length) {
        throw new CommandError(
          'Tick at least one channel first — publishing to nowhere is not publishing',
          { tone: 'warn' },
        );
      }

      await ctx.tx.update(approvalFlows).set({
        publishOnApprove: on, updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null,
      }).where(eq(approvalFlows.id, v));

      await audit(ctx, {
        action: 'update',
        summary: on
          ? `approved requisitions now post to ${flow.publishChannels.join(', ')} automatically`
          : 'approved requisitions no longer post automatically',
        entityType: 'approval_flow', entityId: v, entityLabel: flow.name,
        before: { publishOnApprove: flow.publishOnApprove },
        after: { publishOnApprove: on, channels: flow.publishChannels },
      }, ctx.tx);
      return { toast: on ? 'Publishing on approval' : 'Publishing is now manual', icon: on ? 'check' : 'pause' };
    },
  },

  /* ── Turning an integration off ─────────────────────────────── */
  /* Credentials live in the environment and are never typed into the product,
     so this is not "disconnect" — it is "stop using what is connected". The
     adapter is still configured; the platform is told not to call it, and the
     things that would have gone out through it queue as not sent rather than
     disappearing. Putting it back on needs nothing but this button. */
  'set.conn': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const [row] = await ctx.tx.select().from(integrations)
        .where(eq(integrations.id, v)).limit(1);
      if (!row) throw new CommandError('That integration is not in the list');
      if (row.state === 'not_configured') {
        throw new CommandError(
          `${row.name} has nothing configured to turn off — `
          + `${row.missingConfig.join(', ') || 'its credentials'} are not set in the environment`,
          { tone: 'warn' },
        );
      }

      const off = row.state !== 'disabled';
      if (off && !yes(fields, 'confirmed')) {
        return {
          confirm: {
            title: `Stop using ${row.name}?`,
            body: 'Everything that would have gone out through it is queued and marked as not '
              + 'sent, with the reason. Nothing is lost and nothing is silently dropped — but '
              + 'nothing goes out either until it is switched back on.',
            yes: `Stop using ${row.name}`,
            no: 'Leave it on',
            danger: true,
          },
        };
      }

      await ctx.tx.update(integrations).set({
        state: off ? 'disabled' : 'connected',
        detail: off ? `Switched off by ${ctx.viewer.name}` : null,
        updatedAt: ctx.now,
      }).where(eq(integrations.id, v));

      await audit(ctx, {
        action: 'update',
        summary: `${off ? 'stopped' : 'resumed'} using ${row.name}`,
        entityType: 'integration', entityId: v, entityLabel: row.name,
        before: { state: row.state }, after: { state: off ? 'disabled' : 'connected' },
      }, ctx.tx);
      return {
        toast: off ? `${row.name} is off — messages will queue` : `${row.name} is back on`,
        tone: off ? 'warn' : undefined,
        icon: off ? 'pause' : 'check',
        ms: 4200,
      };
    },
  },

  /* ── One stage's SLA on one template ───────────────────────────────────── */
  /* The value is the number of days the select was moved to; the action says
     which template and which stage. Setting it back to the stage's own default
     removes the override rather than storing the same number twice, which is
     what keeps "was 5 d" meaning something. */
  'set.sla': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, arg }, ctx) {
      const [pipelineId, stageKey] = (arg ?? '').split('|');
      if (!pipelineId || !stageKey) throw new CommandError('Which stage, on which template?');
      const days = Number(v);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        throw new CommandError('An SLA is between 1 and 90 days');
      }

      const [p] = await ctx.tx.select().from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);
      if (!p) throw new CommandError('That pipeline template no longer exists');

      const [row] = rowsOf(await ctx.tx.execute(sql`
        SELECT default_sla AS "defaultSla", name FROM stages WHERE key = ${stageKey}`)) as
        Array<{ defaultSla: number; name: string }>;
      if (!row) throw new CommandError('That stage is not on the spine');

      const before = { ...(p.slaOverrides ?? {}) } as Record<string, number>;
      const next = { ...before };
      if (Math.round(days) === Number(row.defaultSla)) delete next[stageKey];
      else next[stageKey] = Math.round(days);

      if (JSON.stringify(before) === JSON.stringify(next)) {
        return { refresh: false, toast: 'Unchanged', ms: 1200 };
      }

      await ctx.tx.update(pipelines).set({ slaOverrides: next }).where(eq(pipelines.id, pipelineId));
      await audit(ctx, {
        action: 'update',
        summary: `set the ${row.name} SLA on ${p.name} to ${Math.round(days)} day`
          + `${Math.round(days) === 1 ? '' : 's'}`,
        entityType: 'settings', entityId: pipelineId, entityLabel: p.name,
        before: { [stageKey]: before[stageKey] ?? Number(row.defaultSla) },
        after: { [stageKey]: Math.round(days) },
        reason: 'Requisitions already open keep the SLAs they were opened with',
      }, ctx.tx);

      return {
        toast: `${row.name}: ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
          + ' — new requisitions only',
        icon: 'clock',
        ms: 3200,
      };
    },
  },
});
