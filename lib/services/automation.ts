import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  automationRules, automationRuns, domainEvents, tasks, notifications,
  applications, candidates, jobs, staff, offers, employees, emailTemplates,
  talentPools, talentPoolMembers,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, type Ctx } from '@/lib/audit';
import { queueMessage } from '@/lib/services/messaging';
import { notify } from '@/lib/services/notify';
import { ensureEmployee } from '@/lib/services/onboarding';
import { jobBoardAdapter } from '@/lib/providers';
import { env } from '@/lib/env';

/* ═════════════════════════════════════════════════════════════════════════════
   THE AUTOMATION ENGINE

   A rule is a trigger, some conditions and a list of actions. The engine reads
   the events the product writes when something happens, finds the rules that
   want them, checks the conditions against the event's payload, and runs the
   actions in order.

   Four things make it trustworthy rather than magical:

     · a run is recorded before it acts and updated after, so "why did this
       candidate get that e-mail" has an answer with a timestamp on it;
     · rule + event is unique, so a replay after a crash cannot double-fire;
     · an action that fails leaves the run failed with the error on it. The
       worker retries the run, not the whole event;
     · a disabled rule is never evaluated. A Settings toggle is the switch, not
       a label next to one.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Rule = typeof automationRules.$inferSelect;
export type Action = Record<string, unknown>;

const str = (a: Action, k: string): string | null =>
  (typeof a[k] === 'string' ? (a[k] as string) : null);
const int = (a: Action, k: string): number | null => {
  const n = Number(a[k]);
  return Number.isFinite(n) ? n : null;
};

/* ── Conditions ──────────────────────────────────────────────────────────── */

const OPS: Record<string, (a: unknown, b: unknown) => boolean> = {
  eq: (a, b) => String(a) === String(b),
  ne: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  in: (a, b) => Array.isArray(b) && b.map(String).includes(String(a)),
  contains: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
  is_true: (a) => a === true || a === 'true',
  is_false: (a) => a === false || a === 'false',
};

export function conditionsHold(
  rule: Rule, payload: Record<string, unknown>,
): { ok: true } | { ok: false; why: string } {
  for (const c of rule.conditions ?? []) {
    const op = OPS[c.op];
    if (!op) return { ok: false, why: `unknown condition "${c.op}"` };
    const value = payload[c.field];
    if (value === undefined && !['is_false', 'ne'].includes(c.op)) {
      return { ok: false, why: `the event carries no ${c.field}` };
    }
    if (!op(value, c.value)) {
      return { ok: false, why: `${c.field} is ${String(value)}, not ${String(c.value)}` };
    }
  }
  return { ok: true };
}

/* ── Who an action means ─────────────────────────────────────────────────── */

type Subject = {
  applicationId: string | null;
  candidateId: string | null;
  jobId: string | null;
  offerId: string | null;
  employeeId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  jobTitle: string | null;
  recruiterId: string | null;
  recruiterName: string | null;
  interviewerName: string | null;
};

const EMPTY: Subject = {
  applicationId: null, candidateId: null, jobId: null, offerId: null, employeeId: null,
  candidateName: null, candidateEmail: null, candidatePhone: null, jobTitle: null,
  recruiterId: null, recruiterName: null, interviewerName: null,
};

/** Everything an action might need, gathered from whatever the event points at. */
export async function subjectOf(
  event: typeof domainEvents.$inferSelect, exec: Exec,
): Promise<Subject> {
  const p = event.payload ?? {};
  const out: Subject = { ...EMPTY };
  out.interviewerName = typeof p.who === 'string' ? p.who : null;

  let applicationId: string | null = typeof p.applicationId === 'string' ? p.applicationId : null;
  if (!applicationId && event.subjectType === 'application') applicationId = event.subjectId;

  if (event.subjectType === 'offer') out.offerId = event.subjectId;
  if (event.subjectType === 'employee') out.employeeId = event.subjectId;

  if (!applicationId && out.offerId) {
    const [o] = await exec.select({ applicationId: offers.applicationId }).from(offers)
      .where(eq(offers.id, out.offerId)).limit(1);
    applicationId = o?.applicationId ?? null;
  }
  if (!applicationId && out.employeeId) {
    const [e] = await exec.select({ applicationId: employees.applicationId }).from(employees)
      .where(eq(employees.id, out.employeeId)).limit(1);
    applicationId = e?.applicationId ?? null;
  }

  if (applicationId) {
    const [row] = rowsOf(await exec.execute(sql`
      SELECT a.id, a.candidate_id, a.job_id, a.recruiter_id,
             c.name AS candidate_name, c.email AS candidate_email, c.phone AS candidate_phone,
             j.title AS job_title, r.name AS recruiter_name
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
        LEFT JOIN ${staff} r ON r.id = a.recruiter_id
       WHERE a.id = ${applicationId}`));
    if (row) {
      out.applicationId = row.id as string;
      out.candidateId = row.candidate_id as string;
      out.jobId = row.job_id as string;
      out.recruiterId = (row.recruiter_id ?? null) as string | null;
      out.candidateName = row.candidate_name as string;
      out.candidateEmail = (row.candidate_email ?? null) as string | null;
      out.candidatePhone = (row.candidate_phone ?? null) as string | null;
      out.jobTitle = row.job_title as string;
      out.recruiterName = (row.recruiter_name ?? null) as string | null;
    }
  }

  if (!out.jobId && event.subjectType === 'requisition') out.jobId = event.subjectId;
  if (!out.jobId && typeof p.jobId === 'string') out.jobId = p.jobId;
  if (!out.jobTitle && out.jobId) {
    const [j] = await exec.select({ title: jobs.title }).from(jobs)
      .where(eq(jobs.id, out.jobId)).limit(1);
    out.jobTitle = j?.title ?? null;
  }
  return out;
}

/* ── Running one ─────────────────────────────────────────────────────────── */

export type RunOutcome = {
  ruleId: string;
  ruleName: string;
  state: 'succeeded' | 'skipped' | 'failed';
  ran: Array<{ type: string; detail?: string }>;
  error: string | null;
  skippedReason: string | null;
};

/** Everything an action needs to do its work, in one object. */
export type EngineCtx = Ctx & { tx: Exec; now: Date };

export async function runRule(
  rule: Rule, event: typeof domainEvents.$inferSelect, ctx: EngineCtx,
): Promise<RunOutcome> {
  const idempotencyKey = `${rule.id}:${event.id}`;
  const runId = `aur_${crypto.randomUUID().slice(0, 12)}`;

  const inserted = await ctx.tx.insert(automationRuns).values({
    id: runId,
    ruleId: rule.id,
    eventId: event.id,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    state: 'running',
    startedAt: ctx.now,
    attempts: 1,
    at: ctx.now,
    idempotencyKey,
  }).onConflictDoNothing({ target: automationRuns.idempotencyKey })
    .returning({ id: automationRuns.id });

  /* Somebody — another worker, or this one before it crashed — already has it. */
  if (!inserted.length) {
    return {
      ruleId: rule.id, ruleName: rule.name, state: 'skipped', ran: [],
      error: null, skippedReason: 'already run for this event',
    };
  }

  const held = conditionsHold(rule, event.payload ?? {});
  if (!held.ok) {
    await ctx.tx.update(automationRuns).set({
      state: 'skipped', conditionsMet: false, skippedReason: held.why, finishedAt: ctx.now,
    }).where(eq(automationRuns.id, runId));
    return {
      ruleId: rule.id, ruleName: rule.name, state: 'skipped', ran: [],
      error: null, skippedReason: held.why,
    };
  }

  /* A rule with a dedupe window does not fire twice on the same subject
     inside it — a candidate who is moved back and forth is told once. */
  if (rule.dedupeWindowMinutes) {
    const since = new Date(ctx.now.getTime() - rule.dedupeWindowMinutes * 60_000);
    const [recent] = rowsOf(await ctx.tx.execute(sql`
      SELECT id FROM ${automationRuns}
       WHERE rule_id = ${rule.id} AND subject_id = ${event.subjectId}
         AND state = 'succeeded' AND finished_at > ${since}
       LIMIT 1`));
    if (recent) {
      const why = `already run on this subject in the last ${rule.dedupeWindowMinutes} minutes`;
      await ctx.tx.update(automationRuns).set({
        state: 'skipped', conditionsMet: true, skippedReason: why, finishedAt: ctx.now,
      }).where(eq(automationRuns.id, runId));
      return {
        ruleId: rule.id, ruleName: rule.name, state: 'skipped', ran: [], error: null,
        skippedReason: why,
      };
    }
  }

  const subject = await subjectOf(event, ctx.tx);
  const ran: Array<{ type: string; detail?: string }> = [];
  try {
    for (const action of rule.actions ?? []) {
      const detail = await runAction(action, { rule, event, subject }, ctx);
      ran.push({ type: String(action.type ?? 'unknown'), detail });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await ctx.tx.update(automationRuns).set({
      state: 'failed', conditionsMet: true, actionsRun: ran, error: message, finishedAt: ctx.now,
    }).where(eq(automationRuns.id, runId));
    return {
      ruleId: rule.id, ruleName: rule.name, state: 'failed', ran,
      error: message, skippedReason: null,
    };
  }

  await ctx.tx.update(automationRuns).set({
    state: 'succeeded', conditionsMet: true, actionsRun: ran, finishedAt: ctx.now,
  }).where(eq(automationRuns.id, runId));
  await ctx.tx.update(automationRules).set({
    lastRunAt: ctx.now,
    runs30d: sql`${automationRules.runs30d} + 1`,
  }).where(eq(automationRules.id, rule.id));

  return {
    ruleId: rule.id, ruleName: rule.name, state: 'succeeded', ran, error: null, skippedReason: null,
  };
}

/* ── The actions ─────────────────────────────────────────────────────────── */

type ActionCtx = {
  rule: Rule;
  event: typeof domainEvents.$inferSelect;
  subject: Subject;
};

async function runAction(
  action: Action, a: ActionCtx, ctx: EngineCtx,
): Promise<string | undefined> {
  switch (action.type) {
    case 'send_message': return sendMessage(action, a, ctx);
    case 'notify': return sendNotification(action, a, ctx);
    case 'create_task': return createTask(action, a, ctx);
    case 'publish_job': return publishJob(action, a, ctx);
    case 'issue_employee_id': return issueEmployeeId(action, a, ctx);
    case 'add_to_pool': return addToPool(action, a, ctx);
    case 'digest': return 'the weekly digest is assembled by the reporting worker';
    case 'sweep': return `sweep "${str(action, 'what') ?? 'unnamed'}" is run on its own schedule`;
    default:
      throw new Error(`unknown action "${String(action.type)}"`);
  }
}

async function sendMessage(action: Action, a: ActionCtx, ctx: EngineCtx): Promise<string> {
  const channel = (str(action, 'channel') ?? 'Email') as 'Email' | 'WhatsApp' | 'SMS';
  const templateKey = str(action, 'template');
  if (!a.subject.candidateId) return 'no candidate on this event — nothing sent';

  let subject: string | null = null;
  let body: string | null = null;
  let templateId: string | null = null;

  if (templateKey) {
    const [t] = await ctx.tx.select().from(emailTemplates)
      .where(sql`${emailTemplates.id} = ${templateKey} OR ${emailTemplates.stage} = ${templateKey}`)
      .limit(1);
    if (!t) throw new Error(`the template "${templateKey}" does not exist`);
    templateId = t.id;
    subject = fill(t.subject, a.subject);
    body = fill(t.body, a.subject);
  } else {
    subject = str(action, 'subject');
    body = str(action, 'body');
  }
  if (!body) throw new Error('that rule has no message to send');

  const q = await queueMessage({
    channel,
    applicationId: a.subject.applicationId,
    candidateId: a.subject.candidateId,
    jobId: a.subject.jobId,
    toName: a.subject.candidateName,
    toAddress: channel === 'Email' ? a.subject.candidateEmail : a.subject.candidatePhone,
    subject,
    body,
    templateId,
    idempotencyKey: `rule:${a.rule.id}:${a.event.id}:${channel}`,
    thread: a.subject.applicationId
      ? { subjectType: 'application', subjectId: a.subject.applicationId, title: a.subject.jobTitle }
      : undefined,
    authorId: null,
  }, ctx);

  return q.status === 'queued'
    ? `${channel} queued`
    : `${channel} not sent — ${q.reason}`;
}

const fill = (text: string, s: Subject): string => String(text ?? '')
  .replace(/\{\{first_name\}\}/g, (s.candidateName ?? '').split(/\s+/)[0] ?? '')
  .replace(/\{\{full_name\}\}/g, s.candidateName ?? '')
  .replace(/\{\{job_title\}\}/g, s.jobTitle ?? '')
  .replace(/\{\{recruiter_name\}\}/g, s.recruiterName ?? 'the Talent Acquisition team');

async function sendNotification(action: Action, a: ActionCtx, ctx: EngineCtx): Promise<string> {
  const to = str(action, 'to') ?? 'recruiter';
  const staffId = to === 'recruiter' ? a.subject.recruiterId : null;
  const text = str(action, 'text')
    ?? defaultNotice(a.event.type, a.subject, a.event.payload ?? {});

  await notify({
    kind: kindFor(a.event.type),
    staffId,
    text,
    applicationId: a.subject.applicationId,
    jobId: a.subject.jobId,
    candidateId: a.subject.candidateId,
    employeeId: a.subject.employeeId,
    offerId: a.subject.offerId,
    dedupeKey: `rule:${a.rule.id}:${a.event.id}`,
  }, ctx);
  return staffId ? `told ${to}` : 'told the team';
}

const kindFor = (type: string): string => {
  if (type.startsWith('offer')) return 'offer';
  if (type.startsWith('interview')) return 'interview';
  if (type.startsWith('scorecard')) return 'feedback';
  if (type.startsWith('sla')) return 'sla';
  if (type.startsWith('assessment')) return 'assessment';
  if (type.startsWith('probation')) return 'probation';
  if (type.startsWith('employee') || type.startsWith('joining')) return 'joiner';
  return 'automation';
};

const defaultNotice = (
  type: string, s: Subject, payload: Record<string, unknown>,
): string => {
  const who = s.candidateName ?? 'a candidate';
  const role = s.jobTitle ? ` — ${s.jobTitle}` : '';
  switch (type) {
    case 'scorecard.overdue':
      return `${s.interviewerName ?? 'Somebody'} still owes a scorecard for ${who}${role}`;
    case 'sla.breached':
      return `${who} has been sitting past the stage SLA${role}`;
    case 'offer.drafted':
      return `An offer for ${who} is above the approval threshold and needs Finance${role}`;
    default:
      return `${type.replace(/\./g, ' ')} — ${who}${role}`;
  }
};

async function createTask(action: Action, a: ActionCtx, ctx: EngineCtx): Promise<string> {
  const kind = str(action, 'kind') ?? 'chase_feedback';
  const dueInDays = int(action, 'dueInDays') ?? 1;
  const assignee = str(action, 'assignee') ?? 'recruiter';
  const assigneeId = assignee === 'recruiter' ? a.subject.recruiterId : null;

  const title = str(action, 'title')
    ?? `${kind.replace(/_/g, ' ')} — ${a.subject.candidateName ?? a.subject.jobTitle ?? 'follow up'}`;

  await ctx.tx.insert(tasks).values({
    kind: kind as never,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    applicationId: a.subject.applicationId,
    jobId: a.subject.jobId,
    candidateId: a.subject.candidateId,
    employeeId: a.subject.employeeId,
    offerId: a.subject.offerId,
    assigneeId,
    dueOn: new Date(ctx.now.getTime() + dueInDays * 86_400_000),
    priority: (str(action, 'priority') ?? 'normal') as never,
    done: false,
    createdBy: null,
    createdAt: ctx.now,
    dedupeKey: `rule:${a.rule.id}:${a.event.subjectId}:${kind}`,
  }).onConflictDoNothing();

  return `task "${kind}" raised`;
}

async function publishJob(action: Action, a: ActionCtx, ctx: EngineCtx): Promise<string> {
  if (!a.subject.jobId) return 'no requisition on this event';
  const channels = Array.isArray(action.channels) ? (action.channels as string[]) : [];
  if (!channels.some((c) => /linkedin/i.test(c))) {
    return `posting to ${channels.join(', ') || 'no channel'} is handled by the careers site`;
  }

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, a.subject.jobId)).limit(1);
  if (!job) return 'that requisition no longer exists';

  const board = jobBoardAdapter();
  const r = await board.publish({
    title: job.title,
    description: [
      job.descSummary ?? '',
      ...(job.descResponsibilities ?? []).map((x) => `• ${x}`),
      ...(job.descRequirements ?? []).map((x) => `• ${x}`),
    ].filter(Boolean).join('\n'),
    city: null,
    employmentType: job.employmentType ?? null,
    applyUrl: `${env().APP_URL}/apply/${job.slug ?? job.id}`,
    idempotencyKey: `job:${job.id}`,
  });
  if (!r.ok) {
    if (r.reason === 'not_configured') return `LinkedIn not posted — ${r.message}`;
    throw new Error(r.message);
  }
  return `posted to LinkedIn (${r.detail?.postingId})`;
}

async function issueEmployeeId(action: Action, a: ActionCtx, ctx: EngineCtx): Promise<string> {
  const offerId = a.subject.offerId ?? (a.event.subjectType === 'offer' ? a.event.subjectId : null);
  if (!offerId) return 'no offer on this event';
  const { employee, created } = await ensureEmployee(offerId, ctx);
  return created
    ? `employee ${employee.employeeCode} created`
    : `employee ${employee.employeeCode} already existed`;
}

async function addToPool(action: Action, a: ActionCtx, ctx: EngineCtx): Promise<string> {
  if (!a.subject.candidateId) return 'no candidate on this event';
  const name = str(action, 'pool') ?? 'Silver medallists';
  const [pool] = await ctx.tx.select().from(talentPools)
    .where(sql`lower(${talentPools.name}) = ${name.toLowerCase()}`).limit(1);
  if (!pool) throw new Error(`there is no pool called "${name}"`);

  await ctx.tx.insert(talentPoolMembers).values({
    poolId: pool.id,
    candidateId: a.subject.candidateId,
    addedBy: null,
    addedAt: ctx.now,
  }).onConflictDoNothing();
  return `added to ${pool.name}`;
}

/* ── Dispatching a batch ─────────────────────────────────────────────────── */

export type Dispatched = {
  events: number;
  runs: RunOutcome[];
};

/**
 * Take the events nobody has dispatched yet, run whatever wants them, and mark
 * them dispatched. The mark is what makes a restart safe.
 */
export async function dispatchPending(
  ctx: EngineCtx, limit = 50,
): Promise<Dispatched> {
  const pending = await ctx.tx.select().from(domainEvents)
    .where(sql`${domainEvents.dispatchedAt} IS NULL`)
    .orderBy(asc(domainEvents.at))
    .limit(limit);
  if (!pending.length) return { events: 0, runs: [] };

  const enabled = await ctx.tx.select().from(automationRules)
    .where(eq(automationRules.enabled, true))
    .orderBy(asc(automationRules.sortOrder));

  const runs: RunOutcome[] = [];
  for (const event of pending) {
    for (const rule of enabled.filter((r) => r.trigger === event.type)) {
      runs.push(await runRule(rule, event, ctx));
    }
    await ctx.tx.update(domainEvents)
      .set({ dispatchedAt: ctx.now })
      .where(eq(domainEvents.id, event.id));
  }
  return { events: pending.length, runs };
}

/** Runs that failed and have not been given up on. */
export async function retryable(ctx: EngineCtx, limit = 20) {
  const max = env().WORKER_MAX_ATTEMPTS;
  return ctx.tx.select().from(automationRuns)
    .where(and(eq(automationRuns.state, 'failed'), sql`${automationRuns.attempts} < ${max}`))
    .orderBy(asc(automationRuns.at))
    .limit(limit);
}

/** Try a failed run again, from the event it came from. */
export async function retryRun(
  runId: string, ctx: EngineCtx,
): Promise<RunOutcome | null> {
  const [run] = await ctx.tx.select().from(automationRuns)
    .where(eq(automationRuns.id, runId)).limit(1);
  if (!run || run.state !== 'failed') return null;
  const [rule] = await ctx.tx.select().from(automationRules)
    .where(eq(automationRules.id, run.ruleId)).limit(1);
  const [event] = run.eventId
    ? await ctx.tx.select().from(domainEvents).where(eq(domainEvents.id, run.eventId)).limit(1)
    : [];
  if (!rule || !event) return null;

  await ctx.tx.update(automationRuns).set({
    state: 'running', attempts: run.attempts + 1, error: null, startedAt: ctx.now,
  }).where(eq(automationRuns.id, runId));

  const subject = await subjectOf(event, ctx.tx);
  const ran: Array<{ type: string; detail?: string }> = [];
  try {
    for (const action of rule.actions ?? []) {
      const detail = await runAction(action, { rule, event, subject }, ctx);
      ran.push({ type: String(action.type ?? 'unknown'), detail });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await ctx.tx.update(automationRuns).set({
      state: 'failed', actionsRun: ran, error: message, finishedAt: ctx.now,
    }).where(eq(automationRuns.id, runId));
    return {
      ruleId: rule.id, ruleName: rule.name, state: 'failed', ran, error: message,
      skippedReason: null,
    };
  }

  await ctx.tx.update(automationRuns).set({
    state: 'succeeded', actionsRun: ran, finishedAt: ctx.now,
  }).where(eq(automationRuns.id, runId));
  return {
    ruleId: rule.id, ruleName: rule.name, state: 'succeeded', ran, error: null, skippedReason: null,
  };
}
