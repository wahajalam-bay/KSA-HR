import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  jobs, jobStages, jobHiringManagers, jobChannels, approvals, approvalSteps, approvalFlows,
  stages, departments, staff, positions, applications,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { buildSteps } from '@/lib/queries/approvals';
import { CommandError } from '@/lib/commands/registry';
import type { StageKey } from '@/lib/domain/stages';

/* ═════════════════════════════════════════════════════════════════════════════
   THE REQUISITION STATE MACHINE

   A requisition is born a draft. Submitting it builds the approval chain from
   the flow that is live at that moment and freezes it onto the record, so a
   change to the flow next week cannot rewrite what somebody already approved.
   Each step is decided in order. When the last one closes, the requisition
   opens — and, if the flow says so, is posted to its channels.

     draft ──submit──▶ pending_approval ──approve──▶ open ──▶ on_hold ⇄ open
                            │                                   │
                            └──reject──▶ draft                  └──close──▶ closed

   Three things are refused rather than allowed and cleaned up later: opening a
   requisition whose seat is not approved, approving a step that is not this
   person's, and approving the same step twice.
   ═════════════════════════════════════════════════════════════════════════════*/

export const LIVE_STATUSES = ['draft', 'pending_approval', 'open', 'on_hold'] as const;

export type SubmitResult = {
  jobId: string;
  title: string;
  approvalId: string;
  steps: number;
  /** True when every step was automatic and the chain closed immediately. */
  openedImmediately: boolean;
};

/** The context a flow's conditions are evaluated against. */
async function flowContext(jobId: string, exec: Exec) {
  const [row] = rowsOf(await exec.execute(sql`
    SELECT j.openings, j.salary_min, j.salary_max, j.hiring_manager,
           d.head AS dept_head, d.head_title AS dept_head_title
      FROM ${jobs} j JOIN ${departments} d ON d.id = j.dept_id
     WHERE j.id = ${jobId} LIMIT 1`));
  if (!row) throw new CommandError('That requisition no longer exists');
  return {
    openings: Number(row.openings ?? 0),
    salaryMin: Number(row.salary_min ?? 0),
    salaryMax: Number(row.salary_max ?? 0),
    hiringManager: (row.hiring_manager ?? null) as string | null,
    deptHead: (row.dept_head ?? null) as string | null,
    deptHeadTitle: (row.dept_head_title ?? null) as string | null,
  };
}

/** Submit a draft for approval, freezing the chain onto the record. */
export async function submitRequisition(
  jobId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<SubmitResult> {
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');
  if (job.status !== 'draft') {
    throw new CommandError(
      job.status === 'pending_approval'
        ? 'That requisition is already in the approval chain'
        : 'Only a draft can be submitted for approval',
      { tone: 'warn' },
    );
  }

  /* One pending approval per requisition. A second submit finds the first. */
  const [existing] = await ctx.tx.select().from(approvals)
    .where(and(eq(approvals.subject, 'requisition'), eq(approvals.subjectId, jobId),
      eq(approvals.state, 'pending'))).limit(1);
  if (existing) throw new CommandError('That requisition is already waiting on an approval');

  const built = await buildSteps('requisition', await flowContext(jobId, ctx.tx), ctx.tx);
  if (!built.length) throw new CommandError('No approval chain is configured for requisitions');

  const [flow] = await ctx.tx.select().from(approvalFlows)
    .where(and(eq(approvalFlows.subject, 'requisition'), eq(approvalFlows.isActive, true))).limit(1);

  const approvalId = `apr_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(approvals).values({
    id: approvalId,
    subject: 'requisition',
    subjectId: jobId,
    flowId: flow?.id ?? null,
    state: 'pending',
    requestedBy: ctx.viewer.staffId ?? null,
    requestedByName: ctx.viewer.name,
    requestedAt: ctx.now,
  });

  for (const s of built) {
    await ctx.tx.insert(approvalSteps).values({
      id: `aps_${crypto.randomUUID().slice(0, 12)}`,
      approvalId,
      stepKey: s.stepKey,
      ordinal: s.ordinal,
      label: s.label,
      approverType: s.approverType as 'role',
      approverRole: s.approverRole,
      approverStaffId: s.approverStaffId,
      approverName: s.approverName,
      approverTitle: s.approverTitle,
      approverEmail: s.approverEmail,
      conditionText: s.conditionText,
      auto: s.auto,
      state: 'pending',
    });
  }

  await ctx.tx.update(jobs)
    .set({ status: 'pending_approval', updatedAt: ctx.now })
    .where(eq(jobs.id, jobId));

  await audit(ctx, {
    action: 'action',
    summary: `submitted ${job.title} for approval — ${built.length} step${built.length === 1 ? '' : 's'}`,
    entityType: 'requisition',
    entityId: jobId,
    entityLabel: job.title,
    before: { status: job.status },
    after: { status: 'pending_approval' },
  }, ctx.tx);
  await emit(ctx, {
    type: 'requisition.submitted',
    subjectType: 'requisition',
    subjectId: jobId,
    payload: { steps: built.length },
  }, ctx.tx);

  /* Steps recorded automatically are decided on the way through, which can
     close the whole chain before anybody sees it. */
  const auto = built.filter((s) => s.auto);
  for (const s of auto) {
    await ctx.tx.update(approvalSteps)
      .set({ state: 'approved', decidedAt: ctx.now, decidedByName: 'Recorded automatically' })
      .where(and(eq(approvalSteps.approvalId, approvalId), eq(approvalSteps.ordinal, s.ordinal)));
  }
  const closed = auto.length === built.length;
  if (closed) await closeChain(approvalId, jobId, ctx);

  return {
    jobId, title: job.title, approvalId, steps: built.length, openedImmediately: closed,
  };
}

/** The step this approval is waiting on, if any. */
export async function currentStep(approvalId: string, exec: Exec) {
  const [step] = await exec.select().from(approvalSteps)
    .where(and(eq(approvalSteps.approvalId, approvalId), eq(approvalSteps.state, 'pending')))
    .orderBy(asc(approvalSteps.ordinal))
    .limit(1);
  return step ?? null;
}

/** Everything that happens when the last step closes. */
async function closeChain(
  approvalId: string, jobId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return;

  await ctx.tx.update(approvals)
    .set({ state: 'approved', decidedAt: ctx.now })
    .where(eq(approvals.id, approvalId));

  const [flow] = await ctx.tx.select().from(approvalFlows)
    .where(and(eq(approvalFlows.subject, 'requisition'), eq(approvalFlows.isActive, true))).limit(1);

  await ctx.tx.update(jobs).set({
    status: 'open',
    openedOn: job.openedOn ?? ctx.now.toISOString().slice(0, 10),
    approvedBy: ctx.viewer.staffId ?? null,
    updatedAt: ctx.now,
    updatedBy: ctx.viewer.staffId ?? null,
  }).where(eq(jobs.id, jobId));

  /* The seat the requisition was raised against becomes approved headcount at
     the same moment, and not before — an unplanned seat is not budget until
     somebody with the standing says so. */
  await ctx.tx.execute(sql`
    UPDATE ${positions}
       SET plan_state = 'approved',
           approved = greatest(approved, requested),
           approved_at = ${ctx.now},
           approved_by = ${ctx.viewer.staffId ?? null}
     WHERE code = (SELECT position_code FROM ${jobs} WHERE id = ${jobId})
       AND plan_state = 'pending'`);

  await audit(ctx, {
    action: 'action',
    summary: `approved and opened ${job.title}`,
    entityType: 'requisition',
    entityId: jobId,
    entityLabel: job.title,
    before: { status: job.status },
    after: { status: 'open' },
  }, ctx.tx);
  await emit(ctx, {
    type: 'requisition.approved', subjectType: 'requisition', subjectId: jobId,
    payload: { openings: job.openings },
  }, ctx.tx);

  if (flow?.publishOnApprove) {
    const channels = flow.publishChannels ?? [];
    for (const channel of channels) {
      await ctx.tx.insert(jobChannels)
        .values({ jobId, channel, state: 'live', postedAt: ctx.now })
        .onConflictDoNothing();
    }
    await emit(ctx, {
      type: 'requisition.published', subjectType: 'requisition', subjectId: jobId,
      payload: { channels },
    }, ctx.tx);
  }
}

export type DecideResult = {
  jobId: string;
  title: string;
  label: string;
  /** True when this decision closed the chain. */
  finished: boolean;
  rejected: boolean;
};

/** Approve or send back the step this requisition is waiting on. */
export async function decideRequisition(
  jobId: string,
  decision: 'approve' | 'reject',
  reason: string | null,
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<DecideResult> {
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');
  if (job.status !== 'pending_approval') {
    throw new CommandError('That requisition is not waiting on an approval', { tone: 'warn' });
  }

  /* Lock the approval row: two approvers clicking at once must not both
     record the same step. */
  const [approval] = rowsOf(await ctx.tx.execute(sql`
    SELECT id FROM ${approvals}
     WHERE subject = 'requisition' AND subject_id = ${jobId} AND state = 'pending'
     FOR UPDATE`));
  if (!approval) throw new CommandError('That approval has already been decided', { tone: 'warn' });
  const approvalId = approval.id as string;

  const step = await currentStep(approvalId, ctx.tx);
  if (!step) throw new CommandError('Every step on that requisition is already decided', { tone: 'warn' });

  /* Who may decide: the person named, or an Admin acting on their behalf. */
  const named = (step.approverName ?? '').toLowerCase() === ctx.viewer.name.toLowerCase();
  if (!named && !ctx.viewer.isAdmin) {
    throw new CommandError(`That step is ${step.approverName}'s to decide`);
  }

  await ctx.tx.update(approvalSteps).set({
    state: decision === 'approve' ? 'approved' : 'rejected',
    decidedAt: ctx.now,
    decidedBy: ctx.viewer.staffId ?? null,
    decidedByName: ctx.viewer.name,
    onBehalfOf: named ? null : step.approverName,
    note: reason,
  }).where(eq(approvalSteps.id, step.id));

  if (decision === 'reject') {
    await ctx.tx.update(approvals)
      .set({ state: 'rejected', decidedAt: ctx.now })
      .where(eq(approvals.id, approvalId));
    await ctx.tx.update(jobs)
      .set({ status: 'draft', updatedAt: ctx.now })
      .where(eq(jobs.id, jobId));
    await audit(ctx, {
      action: 'action',
      summary: `sent ${job.title} back at ${step.label}${reason ? ` — ${reason}` : ''}`,
      entityType: 'requisition', entityId: jobId, entityLabel: job.title,
      before: { status: 'pending_approval' }, after: { status: 'draft' }, reason,
    }, ctx.tx);
    await emit(ctx, {
      type: 'requisition.rejected', subjectType: 'requisition', subjectId: jobId,
      payload: { step: step.label, reason },
    }, ctx.tx);
    return { jobId, title: job.title, label: step.label, finished: true, rejected: true };
  }

  await audit(ctx, {
    action: 'action',
    summary: `approved ${step.label} on ${job.title}`,
    entityType: 'requisition', entityId: jobId, entityLabel: job.title,
    reason,
  }, ctx.tx);

  const next = await currentStep(approvalId, ctx.tx);
  if (!next) {
    await closeChain(approvalId, jobId, ctx);
    return { jobId, title: job.title, label: step.label, finished: true, rejected: false };
  }
  return { jobId, title: job.title, label: step.label, finished: false, rejected: false };
}

/** Close a requisition, with everything still in play accounted for. */
export async function archiveRequisition(
  jobId: string, reason: string | null, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ title: string; live: number }> {
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');
  if (job.archivedAt) throw new CommandError('That requisition is already archived', { tone: 'warn' });

  const [{ n }] = rowsOf(await ctx.tx.execute(sql`
    SELECT count(*)::int AS n FROM ${applications}
     WHERE job_id = ${jobId} AND status IN ('active', 'on_hold')`)) as Array<{ n: number }>;

  await ctx.tx.update(jobs).set({
    status: 'closed',
    archivedAt: ctx.now,
    closedOn: ctx.now.toISOString().slice(0, 10),
    closedBy: ctx.viewer.staffId ?? null,
    updatedAt: ctx.now,
    updatedBy: ctx.viewer.staffId ?? null,
  }).where(eq(jobs.id, jobId));

  await audit(ctx, {
    action: 'update',
    summary: `archived ${job.title}${reason ? ` — ${reason}` : ''}`,
    entityType: 'requisition', entityId: jobId, entityLabel: job.title,
    before: { status: job.status, archivedAt: null },
    after: { status: 'closed', archivedAt: ctx.now.toISOString() },
    reason,
  }, ctx.tx);
  await emit(ctx, {
    type: 'requisition.archived', subjectType: 'requisition', subjectId: jobId,
    payload: { live: Number(n) },
  }, ctx.tx);

  return { title: job.title, live: Number(n) };
}

/** Bring an archived requisition back, as a draft. */
export async function reopenRequisition(
  jobId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ title: string }> {
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');
  if (!job.archivedAt) throw new CommandError('That requisition is not archived', { tone: 'warn' });

  await ctx.tx.update(jobs).set({
    status: 'draft',
    archivedAt: null,
    closedOn: null,
    closedBy: null,
    updatedAt: ctx.now,
    updatedBy: ctx.viewer.staffId ?? null,
  }).where(eq(jobs.id, jobId));

  await audit(ctx, {
    action: 'update',
    summary: `reopened ${job.title} as a draft`,
    entityType: 'requisition', entityId: jobId, entityLabel: job.title,
    before: { status: job.status, archivedAt: job.archivedAt?.toISOString() ?? null },
    after: { status: 'draft', archivedAt: null },
  }, ctx.tx);
  await emit(ctx, {
    type: 'requisition.reopened', subjectType: 'requisition', subjectId: jobId, payload: {},
  }, ctx.tx);

  return { title: job.title };
}

/** The ten-stage spine, copied onto a new requisition from its template. */
export async function applyPipeline(
  jobId: string, pipelineId: string, ctx: { tx: Exec; now: Date },
): Promise<void> {
  const spine = await ctx.tx.select().from(stages).orderBy(asc(stages.ordinal));
  const [pipe] = rowsOf(await ctx.tx.execute(sql`
    SELECT labels, off_stages, sla_overrides FROM pipelines WHERE id = ${pipelineId} LIMIT 1`));
  const labels = ((pipe?.labels ?? {}) as Record<string, string>);
  const off = new Set(((pipe?.off_stages ?? []) as string[]));
  const slaOver = ((pipe?.sla_overrides ?? {}) as Record<string, number>);

  await ctx.tx.delete(jobStages).where(eq(jobStages.jobId, jobId));
  /* A stage the template switches off is not written onto the requisition at
     all: the loop a requisition runs is the rows it has, so a report can read
     the loop without also having to know which rows to ignore. */
  for (const st of spine) {
    if (off.has(st.key)) continue;
    await ctx.tx.insert(jobStages).values({
      jobId,
      stageKey: st.key,
      name: labels[st.key] || st.name,
      ordinal: st.ordinal,
      sla: Number(slaOver[st.key] ?? st.defaultSla),
    });
  }
}
