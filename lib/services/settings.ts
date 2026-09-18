import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  orgSettings, departments, functions, locations, jobs, staff, accounts,
  approvalFlows, approvalFlowSteps, pipelines, jobStages, stages,
  emailTemplates, questionBank, interviewKits, offerTemplates,
  pitchProjects, pitchConfig, automationRules,
  notifiedTeams, notifiedTeamContacts,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { ensureAccount, emailOf } from '@/lib/services/accounts';

/* ═════════════════════════════════════════════════════════════════════════════
   SETTINGS

   Twelve panels, and almost everything on them is a short list somebody
   maintains by hand: departments, approval steps, pipeline templates, e-mail
   wording, the question bank, the pitch projects, the automation rules, the
   teams a joiner is announced to.

   Two rules run through all of them:

     · a reference row is archived rather than deleted when anything points at
       it. A closed requisition that says "Mortgage and Banking" has to keep
       saying it, five years from now, after the department was reorganised;
     · every change is audited with what it was and what it became, because
       "the SLA used to be four days" is the first question asked when a report
       looks wrong.
   ═════════════════════════════════════════════════════════════════════════════*/

type Ctx2 = Ctx & { tx: Exec; now: Date };

const adminOnly = (ctx: Ctx2, what: string) => {
  if (!ctx.viewer.isAdmin) throw new CommandError(`Only an Admin can ${what}`);
};

/* ── The organisation ────────────────────────────────────────────────────── */

export type OrgInput = Partial<{
  orgName: string; legalName: string; currency: string; currencySymbol: string;
  country: string; timezone: string; fiscalYearStart: string; locale: string;
  secondLocale: string; dataRetentionMonths: number; probationMonths: number;
  brandPrimary: string; brandAccent: string; brandNote: string;
  offerApprovalThreshold: number; leaderName: string; leaderTitle: string;
  signedBy: string; atsOwner: string; hrisName: string;
  workdayStartMin: number; workdayEndMin: number; weekendDays: number[];
}>;

const HEX = /^#[0-9a-f]{6}$/i;

export async function saveOrg(
  input: OrgInput, ctx: Ctx2,
): Promise<{ changed: string[] }> {
  adminOnly(ctx, 'change the organisation');
  const [before] = await ctx.tx.select().from(orgSettings).limit(1);
  if (!before) throw new CommandError('The organisation record is missing');

  if (input.brandPrimary && !HEX.test(input.brandPrimary)) {
    throw new CommandError('A colour is a six-digit hex, like #0E9E62');
  }
  if (input.brandAccent && !HEX.test(input.brandAccent)) {
    throw new CommandError('A colour is a six-digit hex, like #C98A16');
  }
  if (input.probationMonths != null && (input.probationMonths < 1 || input.probationMonths > 12)) {
    throw new CommandError('Probation runs between one and twelve months');
  }
  if (input.offerApprovalThreshold != null && input.offerApprovalThreshold < 0) {
    throw new CommandError('The approval threshold cannot be negative');
  }
  if (input.weekendDays && (input.weekendDays.length < 1 || input.weekendDays.some((d) => d < 0 || d > 6))) {
    throw new CommandError('The weekend is one or more days of the week');
  }

  const patch = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (!Object.keys(patch).length) return { changed: [] };

  await ctx.tx.update(orgSettings)
    .set({ ...patch, updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null })
    .where(eq(orgSettings.id, before.id));

  const changed = Object.keys(patch).filter(
    (k) => String((before as Record<string, unknown>)[k]) !== String(patch[k]),
  );
  if (changed.length) {
    await audit(ctx, {
      action: 'update',
      summary: `changed the organisation settings — ${changed.join(', ')}`,
      entityType: 'org', entityId: before.id, entityLabel: before.orgName,
      before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, patch[k]])),
    }, ctx.tx);
  }
  return { changed };
}

/* ── Departments ─────────────────────────────────────────────────────────── */

export type DeptInput = {
  name: string; code?: string | null; functionId?: string | null;
  head?: string | null; headTitle?: string | null;
  headcount?: number | null; costCentre?: string | null;
};

export async function saveDepartment(
  id: string | 'new', input: DeptInput, ctx: Ctx2,
): Promise<{ id: string; name: string; created: boolean; headChanged: number }> {
  adminOnly(ctx, id === 'new' ? 'add a department' : 'change a department');
  const name = input.name?.trim();
  if (!name) throw new CommandError('The department needs a name');
  const code = (input.code?.trim() || name.slice(0, 3)).toUpperCase();

  if (id === 'new') {
    const [clash] = await ctx.tx.select({ id: departments.id }).from(departments)
      .where(sql`lower(${departments.name}) = ${name.toLowerCase()}
                 AND ${departments.archivedAt} IS NULL`).limit(1);
    if (clash) throw new CommandError(`${name} is already a department`);

    const [{ order }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS order FROM ${departments}`)) as Array<{ order: number }>;
    const newId = `dep_${crypto.randomUUID().slice(0, 12)}`;
    await ctx.tx.insert(departments).values({
      id: newId,
      name,
      code,
      functionId: input.functionId ?? null,
      head: input.head?.trim() || null,
      headTitle: input.headTitle?.trim() || null,
      headcount: input.headcount ?? null,
      costCentre: input.costCentre?.trim() || null,
      sortOrder: Number(order),
      createdAt: ctx.now,
    });

    /* The head is a hiring manager, and needs a way in. */
    if (input.head?.trim()) {
      await ensureAccount({
        name: input.head.trim(),
        title: input.headTitle ?? null,
        role: 'hiring_manager',
        source: `Department head — ${name}`,
      }, ctx);
    }

    await audit(ctx, {
      action: 'create',
      summary: `added the ${name} department`,
      entityType: 'department', entityId: newId, entityLabel: name,
      after: { name, code, head: input.head ?? null },
    }, ctx.tx);
    return { id: newId, name, created: true, headChanged: 0 };
  }

  const [before] = await ctx.tx.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!before) throw new CommandError('That department no longer exists');

  await ctx.tx.update(departments).set({
    name,
    code,
    functionId: input.functionId ?? before.functionId,
    head: input.head?.trim() || before.head,
    headTitle: input.headTitle?.trim() || before.headTitle,
    headcount: input.headcount ?? before.headcount,
    costCentre: input.costCentre?.trim() ?? before.costCentre,
  }).where(eq(departments.id, id));

  /* Live requisitions that named the old head follow the new one. A closed one
     keeps whoever actually ran it. */
  let headChanged = 0;
  if (input.head?.trim() && before.head && input.head.trim() !== before.head) {
    const moved = await ctx.tx.update(jobs)
      .set({ hiringManager: input.head.trim(), updatedAt: ctx.now })
      .where(and(
        eq(jobs.deptId, id),
        eq(jobs.hiringManager, before.head),
        sql`${jobs.status} IN ('draft','pending_approval','open','on_hold')`,
      ))
      .returning({ id: jobs.id });
    headChanged = moved.length;
    await ensureAccount({
      name: input.head.trim(),
      title: input.headTitle ?? null,
      role: 'hiring_manager',
      source: `Department head — ${name}`,
    }, ctx);
  }

  await audit(ctx, {
    action: 'update',
    summary: `edited the ${name} department`,
    entityType: 'department', entityId: id, entityLabel: name,
    before: { name: before.name, head: before.head, code: before.code },
    after: { name, head: input.head ?? before.head, code },
  }, ctx.tx);

  return { id, name, created: false, headChanged };
}

export async function archiveDepartment(
  id: string, ctx: Ctx2,
): Promise<{ name: string; closed: number }> {
  adminOnly(ctx, 'remove a department');
  const [d] = await ctx.tx.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!d) throw new CommandError('That department no longer exists');
  if (d.archivedAt) throw new CommandError(`${d.name} is already removed`, { tone: 'warn' });

  const live = await ctx.tx.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.deptId, id), sql`${jobs.status} IN ('draft','pending_approval','open','on_hold')`));
  if (live.length) {
    throw new CommandError(
      `${d.name} still has ${live.length} live requisition${live.length === 1 ? '' : 's'} — `
      + 'close or move them first',
    );
  }
  const closed = (await ctx.tx.select({ id: jobs.id }).from(jobs)
    .where(eq(jobs.deptId, id))).length;

  await ctx.tx.update(departments)
    .set({ archivedAt: ctx.now })
    .where(eq(departments.id, id));

  await audit(ctx, {
    action: 'delete',
    summary: `removed the ${d.name} department`
      + (closed ? ` — ${closed} closed requisition${closed === 1 ? '' : 's'} keep its name` : ''),
    entityType: 'department', entityId: id, entityLabel: d.name,
    before: { archived: false }, after: { archived: true, closedRequisitions: closed },
  }, ctx.tx);

  return { name: d.name, closed };
}

/* ── The approval chains ─────────────────────────────────────────────────── */

export type StepInput = {
  label: string;
  approverType: 'role' | 'hiring_manager' | 'dept_head' | 'staff' | 'named';
  approverRole?: string | null;
  approverStaffId?: string | null;
  approverName?: string | null;
  approverTitle?: string | null;
  approverEmail?: string | null;
  condField?: string | null;
  condOp?: string | null;
  condValue?: number | null;
  auto?: boolean;
  ordinal?: number | null;
};

export async function saveStep(
  flowId: string, stepId: string | 'new', input: StepInput, ctx: Ctx2,
): Promise<{ label: string; created: boolean }> {
  adminOnly(ctx, 'change the approval workflow');
  const [flow] = await ctx.tx.select().from(approvalFlows)
    .where(eq(approvalFlows.id, flowId)).limit(1);
  if (!flow) throw new CommandError('That approval chain no longer exists');

  const label = input.label?.trim();
  if (!label) throw new CommandError('The step needs a label');
  if (input.approverType === 'named' && !input.approverName?.trim()) {
    throw new CommandError('A named approver needs a name');
  }
  if (input.approverType === 'staff' && !input.approverStaffId) {
    throw new CommandError('Pick who approves it');
  }
  if (input.condField && input.condValue == null) {
    throw new CommandError('A condition needs a figure to compare against');
  }

  const values = {
    label,
    approverType: input.approverType,
    approverRole: input.approverRole ?? null,
    approverStaffId: input.approverStaffId ?? null,
    approverName: input.approverName?.trim() ?? null,
    approverTitle: input.approverTitle?.trim() ?? null,
    approverEmail: input.approverEmail?.trim() ?? null,
    condField: input.condField ?? null,
    condOp: (input.condOp ?? null) as never,
    condValue: input.condValue ?? null,
    auto: input.auto ?? false,
  };

  if (stepId === 'new') {
    const [{ next }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(ordinal), -1) + 1 AS next FROM ${approvalFlowSteps}
       WHERE flow_id = ${flowId}`)) as Array<{ next: number }>;
    await ctx.tx.insert(approvalFlowSteps).values({
      id: `afs_${crypto.randomUUID().slice(0, 12)}`,
      flowId,
      ...values,
      ordinal: input.ordinal ?? Number(next),
    });
    await audit(ctx, {
      action: 'create',
      summary: `added "${label}" to the ${flow.name.toLowerCase()}`,
      entityType: 'approval_flow', entityId: flowId, entityLabel: flow.name,
      after: values,
    }, ctx.tx);
    return { label, created: true };
  }

  const [before] = await ctx.tx.select().from(approvalFlowSteps)
    .where(eq(approvalFlowSteps.id, stepId)).limit(1);
  if (!before) throw new CommandError('That step is no longer on the chain');

  await ctx.tx.update(approvalFlowSteps)
    .set(values)
    .where(eq(approvalFlowSteps.id, stepId));
  await audit(ctx, {
    action: 'update',
    summary: `edited "${label}" on the ${flow.name.toLowerCase()}`,
    entityType: 'approval_flow', entityId: flowId, entityLabel: flow.name,
    before: { label: before.label, approverName: before.approverName, auto: before.auto },
    after: values,
  }, ctx.tx);
  return { label, created: false };
}

export async function removeStep(
  stepId: string, ctx: Ctx2,
): Promise<{ label: string; left: number }> {
  adminOnly(ctx, 'change the approval workflow');
  const [step] = await ctx.tx.select().from(approvalFlowSteps)
    .where(eq(approvalFlowSteps.id, stepId)).limit(1);
  if (!step) throw new CommandError('That step is no longer on the chain');

  const left = (await ctx.tx.select({ id: approvalFlowSteps.id }).from(approvalFlowSteps)
    .where(eq(approvalFlowSteps.flowId, step.flowId))).length - 1;
  if (left < 1) throw new CommandError('A chain needs at least one step');

  await ctx.tx.delete(approvalFlowSteps).where(eq(approvalFlowSteps.id, stepId));
  /* Close the gap, so the order stays 0,1,2 and the unique index holds. */
  const rest = await ctx.tx.select().from(approvalFlowSteps)
    .where(eq(approvalFlowSteps.flowId, step.flowId))
    .orderBy(asc(approvalFlowSteps.ordinal));
  for (const [n, s] of rest.entries()) {
    if (s.ordinal !== n) {
      await ctx.tx.update(approvalFlowSteps)
        .set({ ordinal: 1000 + n })
        .where(eq(approvalFlowSteps.id, s.id));
    }
  }
  for (const [n, s] of rest.entries()) {
    await ctx.tx.update(approvalFlowSteps).set({ ordinal: n }).where(eq(approvalFlowSteps.id, s.id));
  }

  await audit(ctx, {
    action: 'delete',
    summary: `removed "${step.label}" from an approval chain`,
    entityType: 'approval_flow', entityId: step.flowId, entityLabel: step.label,
    before: { label: step.label },
  }, ctx.tx);
  return { label: step.label, left };
}

export async function saveFlow(
  flowId: string,
  input: { publishOnApprove?: boolean; publishChannels?: string[]; requireVerification?: boolean },
  ctx: Ctx2,
): Promise<{ name: string }> {
  adminOnly(ctx, 'change the approval workflow');
  const [flow] = await ctx.tx.select().from(approvalFlows)
    .where(eq(approvalFlows.id, flowId)).limit(1);
  if (!flow) throw new CommandError('That approval chain no longer exists');

  await ctx.tx.update(approvalFlows).set({
    publishOnApprove: input.publishOnApprove ?? flow.publishOnApprove,
    publishChannels: input.publishChannels ?? flow.publishChannels,
    requireVerification: input.requireVerification ?? flow.requireVerification,
    updatedAt: ctx.now,
    updatedBy: ctx.viewer.staffId ?? null,
  }).where(eq(approvalFlows.id, flowId));

  await audit(ctx, {
    action: 'update',
    summary: `changed what happens when the ${flow.name.toLowerCase()} closes`,
    entityType: 'approval_flow', entityId: flowId, entityLabel: flow.name,
    before: {
      publishOnApprove: flow.publishOnApprove,
      channels: flow.publishChannels,
      requireVerification: flow.requireVerification,
    },
    after: input,
  }, ctx.tx);
  return { name: flow.name };
}

/* ── Pipeline templates ──────────────────────────────────────────────────── */

export async function savePipeline(
  id: string,
  input: { name?: string; labels?: Record<string, string>; offStages?: string[]; slaOverrides?: Record<string, number> },
  ctx: Ctx2,
): Promise<{ name: string; live: number }> {
  adminOnly(ctx, 'change a pipeline template');
  const [p] = await ctx.tx.select().from(pipelines).where(eq(pipelines.id, id)).limit(1);
  if (!p) throw new CommandError('That template no longer exists');

  /* Switching a stage off under people who are standing on it would leave them
     at a stage the pipeline does not run. */
  const turningOff = (input.offStages ?? []).filter((s) => !p.offStages.includes(s));
  if (turningOff.length) {
    const standing = rowsOf(await ctx.tx.execute(sql`
      SELECT count(*)::int AS n FROM ${jobs} j
        JOIN applications a ON a.job_id = j.id
       WHERE j.pipeline_id = ${id} AND a.status IN ('active','on_hold')
         AND a.stage::text = ANY(ARRAY[${sql.join(turningOff.map((s) => sql`${s}`), sql`, `)}]::text[])`))[0] as { n: number };
    const n = Number(standing.n);
    if (n > 0) {
      throw new CommandError(
        `${n} ${Number(n) === 1 ? 'person is' : 'people are'} standing on a stage you are switching off — `
        + 'move them first',
      );
    }
  }

  for (const [key, days] of Object.entries(input.slaOverrides ?? {})) {
    if (!Number.isFinite(days) || days < 1 || days > 60) {
      throw new CommandError('An SLA is between one and sixty days');
    }
  }

  await ctx.tx.update(pipelines).set({
    name: input.name?.trim() || p.name,
    labels: input.labels ?? p.labels,
    offStages: input.offStages ?? p.offStages,
    slaOverrides: input.slaOverrides ?? p.slaOverrides,
  }).where(eq(pipelines.id, id));

  const live = (await ctx.tx.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.pipelineId, id), sql`${jobs.status} IN ('open','on_hold')`))).length;

  await audit(ctx, {
    action: 'update',
    summary: `edited the ${p.name} pipeline template`,
    entityType: 'pipeline', entityId: id, entityLabel: p.name,
    before: { name: p.name, off: p.offStages, sla: p.slaOverrides },
    after: { name: input.name ?? p.name, off: input.offStages, sla: input.slaOverrides },
  }, ctx.tx);

  return { name: input.name?.trim() || p.name, live };
}

/* ── Templates, questions and kits ───────────────────────────────────────── */

export async function saveEmailTemplate(
  id: string | 'new',
  input: { name: string; stage?: string | null; lang?: string; subject: string; body: string },
  ctx: Ctx2,
): Promise<{ id: string; name: string; created: boolean }> {
  /* The candidate-facing wording is an Admin's. The offer letter is a separate
     thing, owned by Onboarding through `offer.template.manage`, because that is
     the document somebody signs. */
  adminOnly(ctx, 'change the wording that goes to candidates');
  const name = input.name?.trim();
  if (!name) throw new CommandError('The template needs a name');
  if (!input.body?.trim()) throw new CommandError('The template needs a body');

  const values = {
    name,
    stage: input.stage?.trim() || 'any',
    lang: input.lang?.trim() || 'en',
    subject: input.subject?.trim() || '',
    body: input.body,
  };

  if (id === 'new') {
    const newId = `tpl_${crypto.randomUUID().slice(0, 8)}`;
    const [{ order }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS order FROM ${emailTemplates}`)) as Array<{ order: number }>;
    await ctx.tx.insert(emailTemplates).values({ id: newId, ...values, sortOrder: Number(order) });
    await audit(ctx, {
      action: 'create',
      summary: `added the "${name}" e-mail template`,
      entityType: 'template', entityId: newId, entityLabel: name,
      after: values,
    }, ctx.tx);
    return { id: newId, name, created: true };
  }

  const [before] = await ctx.tx.select().from(emailTemplates)
    .where(eq(emailTemplates.id, id)).limit(1);
  if (!before) throw new CommandError('That template no longer exists');
  await ctx.tx.update(emailTemplates).set(values).where(eq(emailTemplates.id, id));
  await audit(ctx, {
    action: 'update',
    summary: `edited the "${name}" e-mail template`,
    entityType: 'template', entityId: id, entityLabel: name,
    before: { subject: before.subject, body: before.body.slice(0, 200) },
    after: { subject: values.subject, body: values.body.slice(0, 200) },
  }, ctx.tx);
  return { id, name, created: false };
}

export async function saveQuestion(
  id: string | 'new',
  input: {
    text: string; type: string; options?: string[] | null; required?: boolean;
    knockout?: string | null; families?: string[]; isStandard?: boolean;
  },
  ctx: Ctx2,
): Promise<{ id: string; created: boolean }> {
  adminOnly(ctx, 'change the question bank');
  const text = input.text?.trim();
  if (!text) throw new CommandError('The question needs asking');
  if (['choice', 'multi'].includes(input.type) && !(input.options ?? []).length) {
    throw new CommandError('A choice question needs some choices');
  }

  const values = {
    text,
    type: input.type as never,
    options: input.options ?? null,
    required: input.required ?? false,
    knockout: input.knockout?.trim() || null,
    families: input.families ?? [],
    isStandard: input.isStandard ?? false,
  };

  if (id === 'new') {
    const newId = `qb_${crypto.randomUUID().slice(0, 8)}`;
    const [{ order }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS order FROM ${questionBank}`)) as Array<{ order: number }>;
    await ctx.tx.insert(questionBank).values({
      id: newId, ...values, sortOrder: Number(order), createdAt: ctx.now,
    });
    await audit(ctx, {
      action: 'create',
      summary: `added a question to the bank — "${text.slice(0, 60)}"`,
      entityType: 'question', entityId: newId, entityLabel: text.slice(0, 60),
      after: values,
    }, ctx.tx);
    return { id: newId, created: true };
  }

  const [before] = await ctx.tx.select().from(questionBank)
    .where(eq(questionBank.id, id)).limit(1);
  if (!before) throw new CommandError('That question is no longer in the bank');
  await ctx.tx.update(questionBank).set(values).where(eq(questionBank.id, id));
  await audit(ctx, {
    action: 'update',
    summary: `edited a question in the bank — "${text.slice(0, 60)}"`,
    entityType: 'question', entityId: id, entityLabel: text.slice(0, 60),
    before: { text: before.text, knockout: before.knockout },
    after: { text, knockout: values.knockout },
  }, ctx.tx);
  return { id, created: false };
}

export async function archiveQuestion(id: string, ctx: Ctx2): Promise<{ text: string }> {
  adminOnly(ctx, 'change the question bank');
  const [q] = await ctx.tx.select().from(questionBank).where(eq(questionBank.id, id)).limit(1);
  if (!q) throw new CommandError('That question is no longer in the bank');
  await ctx.tx.update(questionBank)
    .set({ archivedAt: ctx.now })
    .where(eq(questionBank.id, id));
  await audit(ctx, {
    action: 'delete',
    summary: `retired a question from the bank — "${q.text.slice(0, 60)}"`,
    entityType: 'question', entityId: id, entityLabel: q.text.slice(0, 60),
  }, ctx.tx);
  return { text: q.text };
}

/* ── The sales pitch ─────────────────────────────────────────────────────── */

export async function savePitchProject(
  id: string | 'new',
  input: {
    name: string; who?: string | null; client?: string | null; brief: string; task: string;
    durationMin?: number | null; prepHours?: number | null;
    criteria?: Array<{ key: string; name: string; hint?: string; max: number }>;
  },
  ctx: Ctx2,
): Promise<{ id: string; name: string; created: boolean }> {
  adminOnly(ctx, 'change the sales pitch projects');
  const name = input.name?.trim();
  if (!name) throw new CommandError('The project needs a name');
  if (!input.brief?.trim()) throw new CommandError('The project needs a brief');
  if (!input.task?.trim()) throw new CommandError('The project needs to say what to do');

  const values = {
    name,
    who: input.who?.trim() || null,
    client: input.client?.trim() || null,
    brief: input.brief,
    task: input.task,
    durationMin: input.durationMin ?? 20,
    prepHours: input.prepHours ?? 24,
    updatedAt: ctx.now,
    updatedBy: ctx.viewer.staffId ?? null,
  };

  if (id === 'new') {
    if (!(input.criteria ?? []).length) {
      throw new CommandError('A project needs the criteria the pitch is scored on');
    }
    const newId = `pp_${crypto.randomUUID().slice(0, 8)}`;
    const [{ order }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS order FROM ${pitchProjects}`)) as Array<{ order: number }>;
    await ctx.tx.insert(pitchProjects).values({
      id: newId, ...values, criteria: input.criteria ?? [],
      active: true, uses: 0, sortOrder: Number(order), createdAt: ctx.now,
    });
    await audit(ctx, {
      action: 'create',
      summary: `added the "${name}" sales pitch project`,
      entityType: 'pitch_project', entityId: newId, entityLabel: name,
      after: { name, criteria: (input.criteria ?? []).length },
    }, ctx.tx);
    return { id: newId, name, created: true };
  }

  const [before] = await ctx.tx.select().from(pitchProjects)
    .where(eq(pitchProjects.id, id)).limit(1);
  if (!before) throw new CommandError('That project no longer exists');
  await ctx.tx.update(pitchProjects)
    .set({ ...values, criteria: input.criteria?.length ? input.criteria : before.criteria })
    .where(eq(pitchProjects.id, id));
  await audit(ctx, {
    action: 'update',
    summary: `edited the "${name}" sales pitch project`,
    entityType: 'pitch_project', entityId: id, entityLabel: name,
    before: { name: before.name, criteria: before.criteria.length },
    after: { name, criteria: (input.criteria ?? before.criteria).length },
  }, ctx.tx);
  return { id, name, created: false };
}

export async function togglePitchProject(
  id: string, ctx: Ctx2,
): Promise<{ name: string; active: boolean }> {
  adminOnly(ctx, 'change the sales pitch projects');
  const [p] = await ctx.tx.select().from(pitchProjects).where(eq(pitchProjects.id, id)).limit(1);
  if (!p) throw new CommandError('That project no longer exists');
  const active = !p.active;
  await ctx.tx.update(pitchProjects)
    .set({ active, updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null })
    .where(eq(pitchProjects.id, id));
  await audit(ctx, {
    action: 'update',
    summary: `${active ? 'brought back' : 'retired'} the "${p.name}" sales pitch project`,
    entityType: 'pitch_project', entityId: id, entityLabel: p.name,
    before: { active: p.active }, after: { active },
  }, ctx.tx);
  return { name: p.name, active };
}

export async function savePitchConfig(
  input: {
    leadHours?: number | null; channels?: string[]; gateFinal?: boolean;
    waTemplate?: string; emailSubject?: string; emailBody?: string;
  },
  ctx: Ctx2,
): Promise<void> {
  adminOnly(ctx, 'change how the pitch brief goes out');
  const [before] = await ctx.tx.select().from(pitchConfig).limit(1);
  if (!before) throw new CommandError('The sales pitch has not been set up');
  if (input.leadHours != null && (input.leadHours < 1 || input.leadHours > 168)) {
    throw new CommandError('The brief goes out between an hour and a week ahead');
  }
  if (input.channels && !input.channels.length) {
    throw new CommandError('The brief needs at least one channel');
  }

  await ctx.tx.update(pitchConfig).set({
    leadHours: input.leadHours ?? before.leadHours,
    channels: input.channels ?? before.channels,
    gateFinal: input.gateFinal ?? before.gateFinal,
    waTemplate: input.waTemplate ?? before.waTemplate,
    emailSubject: input.emailSubject ?? before.emailSubject,
    emailBody: input.emailBody ?? before.emailBody,
    updatedAt: ctx.now,
    updatedBy: ctx.viewer.staffId ?? null,
  }).where(eq(pitchConfig.id, before.id));

  await audit(ctx, {
    action: 'update',
    summary: 'changed how the sales pitch brief goes out',
    entityType: 'pitch_config', entityId: before.id, entityLabel: 'Sales pitch',
    before: { leadHours: before.leadHours, channels: before.channels, gateFinal: before.gateFinal },
    after: input,
  }, ctx.tx);
}

/* ── Automations ─────────────────────────────────────────────────────────── */

export async function toggleRule(
  id: string, ctx: Ctx2,
): Promise<{ name: string; enabled: boolean }> {
  if (!ctx.viewer.isAdmin && ctx.viewer.staffRole !== 'tal_lead') {
    throw new CommandError('Only an Admin can switch an automation on or off');
  }
  const [r] = await ctx.tx.select().from(automationRules)
    .where(eq(automationRules.id, id)).limit(1);
  if (!r) throw new CommandError('That rule no longer exists');

  const enabled = !r.enabled;
  await ctx.tx.update(automationRules)
    .set({ enabled, updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null })
    .where(eq(automationRules.id, id));

  await audit(ctx, {
    action: 'update',
    summary: `switched "${r.name}" ${enabled ? 'on' : 'off'}`,
    entityType: 'automation', entityId: id, entityLabel: r.name,
    before: { enabled: r.enabled }, after: { enabled },
  }, ctx.tx);
  return { name: r.name, enabled };
}

/* ── The teams a joiner is announced to ──────────────────────────────────── */

export async function saveTeam(
  id: string | 'new',
  input: {
    key?: string; short: string; name: string; deptId?: string | null;
    purpose?: string | null; ask?: string | null;
    onJoining?: boolean; onFile?: boolean;
    contacts?: Array<{ name: string; email: string; isPrimary?: boolean }>;
  },
  ctx: Ctx2,
): Promise<{ id: string; name: string; created: boolean }> {
  adminOnly(ctx, 'change who a joiner is announced to');
  const name = input.name?.trim();
  const short = input.short?.trim();
  if (!name || !short) throw new CommandError('The team needs a name and a short name');
  for (const c of input.contacts ?? []) {
    if (!c.email?.includes('@')) throw new CommandError(`${c.name || 'That contact'} needs an address`);
  }

  const values = {
    short,
    name,
    deptId: input.deptId ?? null,
    purpose: input.purpose?.trim() || null,
    ask: input.ask?.trim() || null,
    onJoining: input.onJoining ?? true,
    onFile: input.onFile ?? true,
  };

  let teamId = id;
  let created = false;
  if (id === 'new') {
    const key = (input.key?.trim() || short).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const [clash] = await ctx.tx.select({ id: notifiedTeams.id }).from(notifiedTeams)
      .where(eq(notifiedTeams.key, key)).limit(1);
    if (clash) throw new CommandError(`There is already a team called ${short}`);
    teamId = `nt_${crypto.randomUUID().slice(0, 8)}`;
    const [{ order }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS order FROM ${notifiedTeams}`)) as Array<{ order: number }>;
    await ctx.tx.insert(notifiedTeams).values({
      id: teamId, key, ...values, sortOrder: Number(order),
    });
    created = true;
  } else {
    const [before] = await ctx.tx.select().from(notifiedTeams)
      .where(eq(notifiedTeams.id, id)).limit(1);
    if (!before) throw new CommandError('That team no longer exists');
    await ctx.tx.update(notifiedTeams).set(values).where(eq(notifiedTeams.id, id));
  }

  if (input.contacts) {
    await ctx.tx.delete(notifiedTeamContacts).where(eq(notifiedTeamContacts.teamId, teamId));
    for (const [n, c] of input.contacts.entries()) {
      await ctx.tx.insert(notifiedTeamContacts).values({
        teamId,
        name: c.name.trim(),
        email: c.email.trim().toLowerCase(),
        isPrimary: c.isPrimary ?? n === 0,
        sortOrder: n,
      });
    }
  }

  await audit(ctx, {
    action: created ? 'create' : 'update',
    summary: `${created ? 'added' : 'edited'} the ${name} notification team`,
    entityType: 'notified_team', entityId: teamId, entityLabel: name,
    after: { ...values, contacts: (input.contacts ?? []).length },
  }, ctx.tx);

  return { id: teamId, name, created };
}

/* ── Access ──────────────────────────────────────────────────────────────── */

export async function inviteAccount(
  input: { name: string; email?: string | null; title?: string | null; role: 'hiring_manager' | 'participant' },
  ctx: Ctx2,
): Promise<{ email: string; invited: boolean }> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can invite somebody');
  const r = await ensureAccount({
    name: input.name,
    email: input.email ?? null,
    title: input.title ?? null,
    role: input.role,
    source: 'Invited from Settings → Access',
  }, ctx);
  if (!r) throw new CommandError(`${input.name} already signs in as a member of the TA team`);
  return { email: r.email, invited: r.invited };
}

export async function setScope(
  input: { accountId: string; kind: 'all' | 'own' | 'jobs'; jobIds?: string[]; own?: boolean },
  ctx: Ctx2,
): Promise<{ name: string; kind: string; jobs: number }> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can change what somebody can see');
  const [a] = await ctx.tx.select().from(accounts)
    .where(eq(accounts.id, input.accountId)).limit(1);
  if (!a) throw new CommandError('That account no longer exists');

  const jobIds = input.kind === 'jobs' ? (input.jobIds ?? []) : [];
  if (input.kind === 'jobs' && !jobIds.length) {
    throw new CommandError('Pick at least one requisition, or give them their own');
  }

  await ctx.tx.update(accounts).set({
    scopeKind: input.kind,
    scopeJobIds: jobIds,
    scopeOwn: input.own ?? true,
    updatedAt: ctx.now,
  }).where(eq(accounts.id, input.accountId));

  await audit(ctx, {
    action: 'update',
    summary: `changed what ${a.name} can see — ${
      input.kind === 'all' ? 'every requisition'
        : input.kind === 'own' ? 'the ones they are named on'
          : `${jobIds.length} chosen requisition${jobIds.length === 1 ? '' : 's'}`}`,
    entityType: 'account', entityId: a.id, entityLabel: a.name,
    before: { kind: a.scopeKind, jobs: a.scopeJobIds.length },
    after: { kind: input.kind, jobs: jobIds.length },
  }, ctx.tx);

  return { name: a.name, kind: input.kind, jobs: jobIds.length };
}

export async function setAccountStatus(
  input: { accountId: string; status: 'active' | 'disabled' }, ctx: Ctx2,
): Promise<{ name: string; status: string }> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can suspend an account');
  const [a] = await ctx.tx.select().from(accounts)
    .where(eq(accounts.id, input.accountId)).limit(1);
  if (!a) throw new CommandError('That account no longer exists');
  if (a.id === ctx.viewer.accountId) throw new CommandError('You cannot suspend your own account');

  await ctx.tx.update(accounts)
    .set({ status: input.status, updatedAt: ctx.now })
    .where(eq(accounts.id, input.accountId));
  await audit(ctx, {
    action: 'update',
    summary: `${input.status === 'active' ? 'restored' : 'suspended'} ${a.name}'s access`,
    entityType: 'account', entityId: a.id, entityLabel: a.name,
    before: { status: a.status }, after: { status: input.status },
  }, ctx.tx);
  return { name: a.name, status: input.status };
}

export async function removeAccount(
  accountId: string, ctx: Ctx2,
): Promise<{ name: string }> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can remove an account');
  const [a] = await ctx.tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!a) throw new CommandError('That account no longer exists');
  if (a.id === ctx.viewer.accountId) throw new CommandError('You cannot remove your own account');
  if (a.staffId) {
    throw new CommandError(
      `${a.name} signs in as a member of the TA team — remove them from the team instead`,
    );
  }

  await ctx.tx.update(accounts).set({
    status: 'disabled', removedAt: ctx.now, updatedAt: ctx.now,
  }).where(eq(accounts.id, accountId));

  await audit(ctx, {
    action: 'delete',
    summary: `removed ${a.name}'s access`,
    entityType: 'account', entityId: a.id, entityLabel: `${a.name} <${a.email}>`,
    before: { status: a.status }, after: { removed: true },
  }, ctx.tx);
  return { name: a.name };
}

/** Send somebody back to the start of the password flow. */
export async function resetPassword(
  accountId: string, ctx: Ctx2,
): Promise<{ name: string; email: string }> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can reset a password');
  const [a] = await ctx.tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!a) throw new CommandError('That account no longer exists');

  await ctx.tx.update(accounts).set({
    passwordHash: null,
    passwordSetAt: null,
    mustChangePassword: true,
    status: 'invited',
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: ctx.now,
  }).where(eq(accounts.id, accountId));

  await audit(ctx, {
    action: 'action',
    summary: `reset ${a.name}'s password — they set a new one at the next sign-in`,
    entityType: 'account', entityId: a.id, entityLabel: a.name,
  }, ctx.tx);
  return { name: a.name, email: a.email };
}
