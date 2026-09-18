import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { assessments, applications, jobs, candidates, tasks } from '@/db/schema';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { queueMessage } from '@/lib/services/messaging';
import { mintLink } from '@/lib/services/links';
import { notify } from '@/lib/services/notify';
import { env, providers } from '@/lib/env';

/* ═════════════════════════════════════════════════════════════════════════════
   THE BEHAVIOURAL TEST

   Every manager-and-above candidate answers a twenty-minute questionnaire
   before the final interview, and the final does not open until it is back —
   that gate lives in lib/services/transitions.ts and this is what satisfies it.

   The questionnaire belongs to a provider. Production does two honest things
   the prototype did not:

     · it names the provider that is actually configured, rather than picking
       one of four at random;
     · it never invents a result. A score arrives either from the provider's
       webhook or from a person typing in what the provider's report says, and
       the record keeps which of the two it was.
   ═════════════════════════════════════════════════════════════════════════════*/

/* The six the leadership norm is expressed in. Fixed, because a report that
   measured different things each time could not be compared with the last one. */
export const TRAITS: Array<[string, string]> = [
  ['Drive', 'pace and appetite for targets'],
  ['Judgement', 'decisions with incomplete information'],
  ['Resilience', 'setbacks and pressure'],
  ['Collaboration', 'working across teams'],
  ['Structure', 'planning and follow-through'],
  ['Candour', 'straight talk with people and peers'],
];

export const PROVIDER_NAMES: Record<string, string> = {
  thomas: 'Thomas PPA',
  shl: 'SHL OPQ32',
  hogan: 'Hogan HPI',
  predictive_index: 'Predictive Index',
};

/** Five working days from the invitation. */
const WINDOW_DAYS = 5;

export type InviteResult = {
  assessmentId: string;
  candidateName: string;
  provider: string;
  sent: boolean;
  note: string | null;
};

export async function invite(
  applicationId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<InviteResult> {
  const p = providers().assessment;
  if (!p.configured) {
    throw new CommandError(
      'No assessment provider is configured — set one in Settings → Integrations before '
      + 'sending the behavioural questionnaire',
      { code: 'not_configured' },
    );
  }

  const [app] = await ctx.tx.select().from(applications)
    .where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new CommandError('That application no longer exists');
  if (!['active', 'on_hold'].includes(app.status)) {
    throw new CommandError('That application is closed');
  }
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  if (!job || !cand) throw new CommandError('That requisition or candidate no longer exists');

  const [existing] = await ctx.tx.select().from(assessments)
    .where(eq(assessments.applicationId, applicationId)).limit(1);
  if (existing) throw new CommandError('The test has already gone out', { tone: 'warn' });

  const providerName = PROVIDER_NAMES[env().ASSESSMENT_PROVIDER] ?? p.provider;
  const assessmentId = `asm_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(assessments).values({
    id: assessmentId,
    applicationId,
    candidateId: app.candidateId,
    jobId: app.jobId,
    kind: 'behavioural',
    provider: providerName,
    status: 'invited',
    invitedAt: ctx.now,
    invitedBy: ctx.viewer.staffId ?? null,
  });

  const link = await mintLink({
    purpose: 'assessment',
    subjectType: 'assessment',
    subjectId: assessmentId,
    candidateId: app.candidateId,
    applicationId,
    days: WINDOW_DAYS,
    replace: true,
  }, ctx);

  const first = cand.name.split(/\s+/)[0];
  const queued = await queueMessage({
    channel: 'Email',
    applicationId,
    candidateId: app.candidateId,
    jobId: app.jobId,
    toName: cand.name,
    toAddress: cand.email,
    subject: `${job.title} — behavioural questionnaire (20 minutes)`,
    body: `Hi ${first}, before the final interview we ask every manager-level candidate to `
      + `complete a short behavioural questionnaire (${providerName}, about 20 minutes, no right `
      + `answers). Your link: ${link.url} — it stays open for ${WINDOW_DAYS} days.`,
    thread: { subjectType: 'application', subjectId: applicationId, title: job.title },
  }, ctx);

  /* Somebody has to chase it, or the final never opens. */
  await ctx.tx.insert(tasks).values({
    kind: 'assessment',
    title: `Behaviour test — ${cand.name} (${job.title})`,
    applicationId,
    jobId: app.jobId,
    candidateId: app.candidateId,
    assigneeId: job.recruiterId ?? ctx.viewer.staffId ?? null,
    dueOn: new Date(ctx.now.getTime() + WINDOW_DAYS * 86_400_000),
    priority: 'high',
    done: false,
    createdAt: ctx.now,
  });

  await audit(ctx, {
    action: 'create',
    summary: `sent ${cand.name} the ${providerName} behavioural questionnaire`,
    entityType: 'assessment', entityId: assessmentId, entityLabel: cand.name,
    after: { provider: providerName, delivery: queued.status },
  }, ctx.tx);
  await emit(ctx, {
    type: 'assessment.invited', subjectType: 'assessment', subjectId: assessmentId,
    payload: { applicationId, provider: providerName },
  }, ctx.tx);

  return {
    assessmentId,
    candidateName: cand.name,
    provider: providerName,
    sent: queued.status === 'queued',
    note: queued.reason,
  };
}

export async function remind(
  assessmentId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; sent: boolean; note: string | null }> {
  const [a] = await ctx.tx.select().from(assessments)
    .where(eq(assessments.id, assessmentId)).limit(1);
  if (!a) throw new CommandError('That questionnaire no longer exists');
  if (a.status === 'completed') throw new CommandError('It is already back', { tone: 'warn' });

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, a.candidateId)).limit(1);
  const first = (cand?.name ?? '').split(/\s+/)[0];

  const queued = await queueMessage({
    channel: 'Email',
    applicationId: a.applicationId,
    candidateId: a.candidateId,
    jobId: a.jobId,
    toName: cand?.name ?? null,
    toAddress: cand?.email ?? null,
    subject: 'A quick reminder — your behavioural questionnaire',
    body: `Hi ${first}, a reminder that your ${a.provider} questionnaire is still open. `
      + 'It takes about twenty minutes.',
    thread: { subjectType: 'application', subjectId: a.applicationId },
  }, ctx);

  await audit(ctx, {
    action: 'update',
    summary: `reminded ${cand?.name ?? 'the candidate'} about the behavioural questionnaire`,
    entityType: 'assessment', entityId: assessmentId, entityLabel: cand?.name ?? null,
  }, ctx.tx);

  return {
    candidateName: cand?.name ?? 'the candidate',
    sent: queued.status === 'queued',
    note: queued.reason,
  };
}

export type TraitScore = { name: string; score: number };

export type RecordResult = {
  candidateName: string;
  score: number;
  verdict: 'strong' | 'mixed' | 'concern';
  summary: string;
};

/**
 * The result, as it actually arrives: either the provider's webhook hands it
 * over, or somebody reads the provider's report and types the six numbers in.
 * Either way the numbers come from outside this system — nothing here makes
 * them up.
 */
export async function recordResult(
  input: {
    assessmentId: string;
    traits: TraitScore[];
    source: 'provider' | 'manual';
    providerRef?: string | null;
    reportRef?: string | null;
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<RecordResult> {
  const [a] = await ctx.tx.select().from(assessments)
    .where(eq(assessments.id, input.assessmentId)).limit(1);
  if (!a) throw new CommandError('That questionnaire no longer exists');
  if (a.status === 'completed') throw new CommandError('The result is already in', { tone: 'warn' });

  const given = new Map(input.traits.map((t) => [t.name.toLowerCase(), t.score]));
  const traits = TRAITS.map(([name, note]) => {
    const score = given.get(name.toLowerCase());
    if (score == null) throw new CommandError(`${name} has no score — all six are needed`);
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      throw new CommandError(`${name} must be between one and ten`);
    }
    return { name, note, score: Math.round(score) };
  });

  const score = Math.round((traits.reduce((n, t) => n + t.score, 0) / (traits.length * 10)) * 100);
  const verdict = score >= 75 ? 'strong' : score >= 60 ? 'mixed' : 'concern';
  const ordered = [...traits].sort((x, y) => x.score - y.score);
  const lowest = ordered[0].name.toLowerCase();
  const highest = ordered[ordered.length - 1].name.toLowerCase();
  const summary = verdict === 'strong'
    ? `Fits the leadership norm; strongest on ${highest}. Probe ${lowest} at the final.`
    : verdict === 'mixed'
      ? `Inside the norm overall, with ${lowest} below it — worth a structured question at the final.`
      : `Two traits sit under the leadership norm, ${lowest} most clearly. Read the report before the final.`;

  await ctx.tx.update(assessments).set({
    status: 'completed',
    completedAt: ctx.now,
    traits,
    score,
    verdict,
    summary,
    providerRef: input.providerRef ?? a.providerRef,
    reportRef: input.reportRef ?? a.reportRef,
  }).where(eq(assessments.id, input.assessmentId));

  /* Whoever was chasing it can stop. */
  await ctx.tx.update(tasks).set({ done: true, doneAt: ctx.now, doneBy: ctx.viewer.staffId ?? null })
    .where(and(
      eq(tasks.applicationId, a.applicationId),
      eq(tasks.kind, 'assessment'),
      eq(tasks.done, false),
    ));

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, a.candidateId)).limit(1);

  await notify({
    kind: 'assessment',
    text: `Behaviour test back for ${cand?.name ?? 'a candidate'} — ${score} of 100, ${verdict}. `
      + 'The final interview can be booked.',
    applicationId: a.applicationId,
    jobId: a.jobId,
    candidateId: a.candidateId,
    dedupeKey: `assessment.result:${input.assessmentId}`,
  }, ctx);

  await audit(ctx, {
    action: 'update',
    summary: `recorded the behavioural result for ${cand?.name ?? 'the candidate'} — ${score} of 100, ${verdict}`,
    entityType: 'assessment', entityId: input.assessmentId, entityLabel: cand?.name ?? null,
    after: { score, verdict, source: input.source },
    source: input.source === 'provider' ? 'webhook' : 'ui',
  }, ctx.tx);
  await emit(ctx, {
    type: 'assessment.completed', subjectType: 'assessment', subjectId: input.assessmentId,
    payload: { applicationId: a.applicationId, score, verdict },
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate', score, verdict, summary };
}
