import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  pitches, pitchProjects, pitchConfig, pitchScores, pitchTurns,
  applications, jobs, candidates, jobStages, staff, interviews,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { queueMessage } from '@/lib/services/messaging';
import { DEFAULT_SLA } from '@/lib/domain/stages';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SALES PITCH

   An optional stage on a requisition that sells. The candidate is given a real
   Bayut project a day ahead, comes to a twenty-minute call, and pitches it to
   somebody playing the client. They are scored on the project's own criteria —
   discovery, product, value and pricing, objections, the close — and the final
   interview waits for that score when the requisition says it should.

   Three things happen here, and they are three different things:

     · the brief goes out — a message, with a date on it;
     · the pitch is run — a real conversation, by a person or by the assistant;
     · the pitch is scored — numbers, from whoever heard it.

   The prototype did all three in one click and invented the transcript. This
   does not: a pitch nobody has run has no score, and a score always has a name
   against it.
   ═════════════════════════════════════════════════════════════════════════════*/

export const PITCH_STAGE = 'pitch';

export type Project = typeof pitchProjects.$inferSelect;

export async function config(exec: Exec): Promise<typeof pitchConfig.$inferSelect> {
  const [row] = await exec.select().from(pitchConfig).limit(1);
  if (!row) throw new CommandError('The sales pitch has not been set up — Settings → Sales pitch');
  return row;
}

/** The project this requisition pitches: the one it names, else the first live one. */
export async function projectFor(
  job: typeof jobs.$inferSelect, exec: Exec,
): Promise<Project | null> {
  if (job.pitchProjectId) {
    const [named] = await exec.select().from(pitchProjects)
      .where(eq(pitchProjects.id, job.pitchProjectId)).limit(1);
    if (named) return named;
  }
  const [first] = await exec.select().from(pitchProjects)
    .where(eq(pitchProjects.active, true))
    .orderBy(asc(pitchProjects.sortOrder), asc(pitchProjects.id))
    .limit(1);
  return first ?? null;
}

export async function pitchOf(
  applicationId: string, exec: Exec,
): Promise<typeof pitches.$inferSelect | null> {
  const [row] = await exec.select().from(pitches)
    .where(eq(pitches.applicationId, applicationId)).limit(1);
  return row ?? null;
}

/* When the pitch is due: the interview booked for the stage if there is one,
   else the stage's own SLA counted from the day they reached it. */
async function dueAt(
  app: typeof applications.$inferSelect, jobId: string, exec: Exec, now: Date,
): Promise<Date> {
  const [iv] = await exec.select({ at: interviews.at }).from(interviews)
    .where(and(
      eq(interviews.applicationId, app.id),
      eq(interviews.stage, PITCH_STAGE),
      sql`${interviews.status} <> 'cancelled'`,
    ))
    .orderBy(asc(interviews.at))
    .limit(1);
  if (iv) return iv.at;

  const [stage] = await exec.select({ sla: jobStages.sla }).from(jobStages)
    .where(and(eq(jobStages.jobId, jobId), eq(jobStages.stageKey, PITCH_STAGE))).limit(1);
  const days = stage?.sla ?? DEFAULT_SLA.pitch ?? 4;
  const from = app.stageEnteredAt ?? now;
  return new Date(from.getTime() + days * 86_400_000);
}

const riyadh = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
}).format(d);

function fill(
  text: string,
  v: {
    candidate: typeof candidates.$inferSelect;
    job: typeof jobs.$inferSelect;
    project: Project;
    stageName: string;
    when: Date;
    recruiter: string;
    leadHours: number;
  },
): string {
  return String(text ?? '')
    .replace(/\{\{first_name\}\}/g, v.candidate.name.split(/\s+/)[0])
    .replace(/\{\{full_name\}\}/g, v.candidate.name)
    .replace(/\{\{job_title\}\}/g, v.job.title)
    .replace(/\{\{stage_name\}\}/g, v.stageName)
    .replace(/\{\{project_name\}\}/g, v.project.name)
    .replace(/\{\{client\}\}/g, v.project.client ?? '—')
    .replace(/\{\{brief\}\}/g, v.project.brief)
    .replace(/\{\{task\}\}/g, v.project.task)
    .replace(/\{\{duration\}\}/g, String(v.project.durationMin))
    .replace(/\{\{when\}\}/g, riyadh(v.when))
    .replace(/\{\{recruiter_name\}\}/g, v.recruiter)
    .replace(/\{\{lead_hours\}\}/g, String(v.leadHours));
}

/**
 * What the candidate would receive, filled in exactly as `sendBrief` fills it.
 * The sheet that shows the brief renders this rather than merging the template
 * itself, so what is previewed and what is sent cannot drift apart.
 */
export async function briefPreview(
  applicationId: string, exec: Exec, now: Date,
): Promise<{
  project: Project | null;
  channels: string[];
  leadHours: number;
  due: Date | null;
  whatsapp: string;
  emailSubject: string;
  emailBody: string;
  phone: string | null;
  email: string | null;
  reason: string | null;
} | null> {
  const [app] = await exec.select().from(applications)
    .where(eq(applications.id, applicationId)).limit(1);
  if (!app) return null;
  const [job] = await exec.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [cand] = await exec.select().from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  if (!job || !cand) return null;

  const cfg = await config(exec);
  const project = await projectFor(job, exec);
  if (!project) {
    return {
      project: null, channels: cfg.channels, leadHours: cfg.leadHours, due: null,
      whatsapp: '', emailSubject: '', emailBody: '',
      phone: cand.phone, email: cand.email,
      reason: job.pitchOn
        ? 'No pitch project is set up — add one in Settings → Sales pitch'
        : `${job.title} does not run a sales pitch — switch it on from the requisition`,
    };
  }

  const [stage] = await exec.select({ name: jobStages.name }).from(jobStages)
    .where(and(eq(jobStages.jobId, job.id), eq(jobStages.stageKey, PITCH_STAGE))).limit(1);
  const when = await dueAt(app, job.id, exec, now);
  const [rec] = job.recruiterId
    ? await exec.select({ name: staff.name }).from(staff).where(eq(staff.id, job.recruiterId)).limit(1)
    : [];
  const merge = {
    candidate: cand, job, project,
    stageName: stage?.name ?? 'Sales Pitch',
    when,
    recruiter: rec?.name ?? 'the recruiter',
    leadHours: cfg.leadHours,
  };

  return {
    project,
    channels: cfg.channels,
    leadHours: cfg.leadHours,
    due: when,
    whatsapp: fill(cfg.waTemplate, merge),
    emailSubject: fill(cfg.emailSubject, merge),
    emailBody: fill(cfg.emailBody, merge),
    phone: cand.phone,
    email: cand.email,
    reason: job.pitchOn ? null
      : `${job.title} does not run a sales pitch — switch it on from the requisition`,
  };
}

export type SendResult = {
  pitchId: string;
  candidateName: string;
  projectName: string;
  channels: string[];
  delivered: string[];
  notes: string[];
  dueAt: string;
};

/** Send the brief. The pitch itself happens later. */
export async function sendBrief(
  input: { applicationId: string; channels?: string[] },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<SendResult> {
  const [app] = await ctx.tx.select().from(applications)
    .where(eq(applications.id, input.applicationId)).limit(1);
  if (!app) throw new CommandError('That application no longer exists');
  if (!['active', 'on_hold'].includes(app.status)) throw new CommandError('That application is closed');

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  if (!job || !cand) throw new CommandError('That requisition or candidate no longer exists');
  if (!job.pitchOn) {
    throw new CommandError(`${job.title} does not run a sales pitch — switch it on from the requisition`);
  }

  const project = await projectFor(job, ctx.tx);
  if (!project) {
    throw new CommandError('No pitch project is set up — add one in Settings → Sales pitch');
  }

  const cfg = await config(ctx.tx);
  const channels = (input.channels?.length ? input.channels : cfg.channels)
    .map((c) => c.toLowerCase())
    .filter((c) => c === 'whatsapp' || c === 'email');
  if (!channels.length) throw new CommandError('Pick at least one channel for the brief');

  const [stage] = await ctx.tx.select({ name: jobStages.name }).from(jobStages)
    .where(and(eq(jobStages.jobId, job.id), eq(jobStages.stageKey, PITCH_STAGE))).limit(1);
  const when = await dueAt(app, job.id, ctx.tx, ctx.now);

  const existing = await pitchOf(app.id, ctx.tx);
  if (existing?.status === 'completed') {
    throw new CommandError('That pitch has already been run and scored', { tone: 'warn' });
  }

  const criteria = project.criteria ?? [];
  const pitchId = existing?.id ?? `pit_${crypto.randomUUID().slice(0, 12)}`;
  const values = {
    applicationId: app.id,
    candidateId: app.candidateId,
    jobId: app.jobId,
    projectId: project.id,
    status: 'sent' as const,
    sentAt: ctx.now,
    sentWhatsapp: channels.includes('whatsapp') ? cand.phone : null,
    sentEmail: channels.includes('email') ? cand.email : null,
    channels,
    dueAt: when,
    durationMin: project.durationMin,
    max: criteria.reduce((n, c) => n + (c.max ?? 5), 0),
  };
  if (existing) {
    await ctx.tx.update(pitches).set(values).where(eq(pitches.id, existing.id));
  } else {
    await ctx.tx.insert(pitches).values({ id: pitchId, ...values, createdAt: ctx.now });
  }

  const [rec] = job.recruiterId
    ? await ctx.tx.select({ name: staff.name }).from(staff).where(eq(staff.id, job.recruiterId)).limit(1)
    : [];
  const merge = {
    candidate: cand, job, project,
    stageName: stage?.name ?? 'Sales Pitch',
    when,
    recruiter: rec?.name ?? ctx.viewer.name,
    leadHours: cfg.leadHours,
  };

  const delivered: string[] = [];
  const notes: string[] = [];
  if (channels.includes('whatsapp')) {
    const q = await queueMessage({
      channel: 'WhatsApp',
      applicationId: app.id, candidateId: cand.id, jobId: job.id,
      toName: cand.name, toAddress: cand.phone,
      body: fill(cfg.waTemplate, merge),
      thread: { subjectType: 'application', subjectId: app.id, title: job.title },
    }, ctx);
    if (q.status === 'queued') delivered.push('WhatsApp'); else if (q.reason) notes.push(q.reason);
  }
  if (channels.includes('email')) {
    const q = await queueMessage({
      channel: 'Email',
      applicationId: app.id, candidateId: cand.id, jobId: job.id,
      toName: cand.name, toAddress: cand.email,
      subject: fill(cfg.emailSubject, merge),
      body: fill(cfg.emailBody, merge),
      thread: { subjectType: 'application', subjectId: app.id, title: job.title },
    }, ctx);
    if (q.status === 'queued') delivered.push('e-mail'); else if (q.reason) notes.push(q.reason);
  }

  await audit(ctx, {
    action: 'update',
    summary: `sent ${cand.name} the sales pitch brief (${project.name})`,
    entityType: 'pitch', entityId: pitchId, entityLabel: cand.name,
    after: { project: project.name, channels, dueAt: when.toISOString() },
  }, ctx.tx);
  await emit(ctx, {
    type: 'pitch.sent', subjectType: 'pitch', subjectId: pitchId,
    payload: { applicationId: app.id, projectId: project.id, dueAt: when.toISOString() },
  }, ctx.tx);

  return {
    pitchId,
    candidateName: cand.name,
    projectName: project.name,
    channels,
    delivered,
    notes,
    dueAt: when.toISOString(),
  };
}

/** The call has started. */
export async function begin(
  applicationId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ pitchId: string; candidateName: string; projectName: string }> {
  const p = await pitchOf(applicationId, ctx.tx);
  if (!p) throw new CommandError('The brief has not gone out yet — send it first');
  if (p.status === 'completed') throw new CommandError('That pitch has already been scored', { tone: 'warn' });

  await ctx.tx.update(pitches).set({
    status: 'running', startedAt: p.startedAt ?? ctx.now,
  }).where(eq(pitches.id, p.id));

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, p.candidateId)).limit(1);
  const [project] = p.projectId
    ? await ctx.tx.select().from(pitchProjects).where(eq(pitchProjects.id, p.projectId)).limit(1)
    : [];

  await audit(ctx, {
    action: 'update',
    summary: `started the sales pitch with ${cand?.name ?? 'the candidate'}`,
    entityType: 'pitch', entityId: p.id, entityLabel: cand?.name ?? null,
    before: { status: p.status }, after: { status: 'running' },
  }, ctx.tx);

  return {
    pitchId: p.id,
    candidateName: cand?.name ?? 'the candidate',
    projectName: project?.name ?? 'the project',
  };
}

export type ScoreInput = {
  applicationId: string;
  /** One per criterion on the project, keyed by its key. */
  scores: Record<string, number>;
  summary?: string | null;
  strengths?: string[];
  gaps?: string[];
  /** Who judged it: a person here, the assistant when the worker scores it. */
  model?: 'human' | 'ai';
};

export type ScoreResult = {
  pitchId: string;
  candidateName: string;
  total: number;
  max: number;
  pct: number;
  verdict: 'strong' | 'fair' | 'weak';
};

/** Score the pitch against the project's own criteria. */
export async function score(
  input: ScoreInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<ScoreResult> {
  const p = await pitchOf(input.applicationId, ctx.tx);
  if (!p) throw new CommandError('There is no pitch on this application');
  if (p.status === 'not_sent') throw new CommandError('The brief has not gone out yet');
  if (p.status === 'completed') throw new CommandError('That pitch is already scored', { tone: 'warn' });

  const [project] = p.projectId
    ? await ctx.tx.select().from(pitchProjects).where(eq(pitchProjects.id, p.projectId)).limit(1)
    : [];
  const criteria = project?.criteria ?? [];
  if (!criteria.length) throw new CommandError('That project has no criteria to score against');

  const rows = criteria.map((c, i) => {
    const raw = input.scores[c.key];
    const max = c.max ?? 5;
    if (raw == null) throw new CommandError(`${c.name} has no score — every criterion is scored`);
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > max) {
      throw new CommandError(`${c.name} must be between one and ${max}`);
    }
    return { key: c.key, name: c.name, score: n, max, sortOrder: i };
  });

  const total = rows.reduce((n, r) => n + r.score, 0);
  const max = rows.reduce((n, r) => n + r.max, 0);
  const pct = max ? Math.round((total / max) * 100) : 0;
  const verdict = pct >= 80 ? 'strong' : pct >= 60 ? 'fair' : 'weak';

  await ctx.tx.delete(pitchScores).where(eq(pitchScores.pitchId, p.id));
  for (const r of rows) await ctx.tx.insert(pitchScores).values({ pitchId: p.id, ...r });

  const ordered = [...rows].sort((a, b) => a.score - b.score);
  const summary = input.summary?.trim()
    || (verdict === 'weak'
      ? `Weakest on ${ordered[0].name.toLowerCase()}.`
      : `Strongest on ${ordered[ordered.length - 1].name.toLowerCase()}.`);

  await ctx.tx.update(pitches).set({
    status: 'completed',
    completedAt: ctx.now,
    total, max, score: pct, verdict, summary,
    strengths: input.strengths ?? [],
    gaps: input.gaps ?? [],
    model: input.model ?? 'human',
  }).where(eq(pitches.id, p.id));

  if (project) {
    await ctx.tx.update(pitchProjects)
      .set({ uses: (project.uses ?? 0) + 1, updatedAt: ctx.now })
      .where(eq(pitchProjects.id, project.id));
  }

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, p.candidateId)).limit(1);

  await audit(ctx, {
    action: 'update',
    summary: `scored ${cand?.name ?? 'the candidate'}'s sales pitch — ${pct} of 100, ${verdict}`,
    entityType: 'pitch', entityId: p.id, entityLabel: cand?.name ?? null,
    after: { total, max, score: pct, verdict, model: input.model ?? 'human' },
  }, ctx.tx);
  await emit(ctx, {
    type: 'pitch.completed', subjectType: 'pitch', subjectId: p.id,
    payload: { applicationId: p.applicationId, score: pct, verdict },
  }, ctx.tx);

  return {
    pitchId: p.id,
    candidateName: cand?.name ?? 'the candidate',
    total, max, pct, verdict,
  };
}

/** A line of the conversation, kept as it happens. */
export async function addTurn(
  input: { pitchId: string; who: 'ai' | 'cand'; text: string },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  const [{ n }] = rowsOf(await ctx.tx.execute(sql`
    SELECT coalesce(max(seq), 0)::int AS n
      FROM ${pitchTurns} WHERE pitch_id = ${input.pitchId}`)) as Array<{ n: number }>;
  await ctx.tx.insert(pitchTurns).values({
    pitchId: input.pitchId, who: input.who, text: input.text, at: ctx.now, seq: Number(n) + 1,
  });
}
