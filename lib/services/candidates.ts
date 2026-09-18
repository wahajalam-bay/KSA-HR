import 'server-only';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  candidates, applications, jobs, jobStages, applicationStageHistory, candidateSkills,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import type { StageKey } from '@/lib/domain/stages';
import { CLAIM_DEFAULT_DAYS, claimEndsAt, claimIsLive } from '@/lib/domain/claim';
import { notify } from '@/lib/services/notify';

/* ═════════════════════════════════════════════════════════════════════════════
   CANDIDATES, and how they enter a pipeline.

   Two rules run through everything here.

   A person is one record. The same human arriving twice — once from the
   careers form, once from a recruiter typing them in — has to end up as one
   candidate, or the pipeline counts them twice and two recruiters call them on
   the same afternoon. So e-mail and phone are normalised into keys, and a
   match on either is a duplicate.

   A person applies to a requisition once. A second application to the same
   requisition is refused and the existing one is opened instead, because "we
   already have them, here" is the useful answer and a second row is not.
   ═════════════════════════════════════════════════════════════════════════════*/

/** Lower-cased and trimmed; an empty address is no key at all. */
export const emailKey = (s: string | null | undefined): string | null => {
  const t = String(s ?? '').trim().toLowerCase();
  return t.includes('@') ? t : null;
};

/* Saudi numbers are written half a dozen ways — +966 5…, 00966 5…, 05…, with
   spaces and dashes. The key is the last nine digits, which is the part that
   identifies the line. */
export const phoneKey = (s: string | null | undefined): string | null => {
  const digits = String(s ?? '').replace(/\D+/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
};

export type Duplicate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  matchedOn: 'email' | 'phone';
};

/** The candidate this person already is, if they are already somebody. */
export async function findDuplicate(
  input: { email?: string | null; phone?: string | null; exceptId?: string },
  exec: Exec,
): Promise<Duplicate | null> {
  const ek = emailKey(input.email);
  const pk = phoneKey(input.phone);
  if (!ek && !pk) return null;

  const [row] = rowsOf(await exec.execute(sql`
    SELECT id, name, email, phone,
           CASE WHEN ${ek}::text IS NOT NULL AND email_key = ${ek} THEN 'email' ELSE 'phone' END AS matched_on
      FROM ${candidates}
     WHERE (${ek}::text IS NOT NULL AND email_key = ${ek})
        OR (${pk}::text IS NOT NULL AND phone_key = ${pk})
       ${input.exceptId ? sql`AND id <> ${input.exceptId}` : sql``}
     ORDER BY (CASE WHEN ${ek}::text IS NOT NULL AND email_key = ${ek} THEN 0 ELSE 1 END), id
     LIMIT 1`));
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    email: (row.email ?? null) as string | null,
    phone: (row.phone ?? null) as string | null,
    matchedOn: row.matched_on as 'email' | 'phone',
  };
}

export type CreateCandidate = {
  name: string;
  email?: string | null;
  phone?: string | null;
  locationCity?: string | null;
  nationality?: string | null;
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  sector?: string | null;
  sectorSource?: 'cv' | 'ai' | 'recruiter' | null;
  yearsExperience?: number | null;
  noticeDays?: number | null;
  expectedSalary?: number | null;
  currentSalary?: number | null;
  currentSalarySource?: 'cv' | 'ai' | 'recruiter' | null;
  linkedin?: string | null;
  portfolio?: string | null;
  skills?: string[];
  hashtags?: string[];
};

const hueOf = (name: string): number =>
  ([...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5) + 1;

/** Create a candidate, refusing a duplicate rather than making a second one. */
export async function createCandidate(
  input: CreateCandidate,
  ctx: Ctx & { tx: Exec; now: Date },
  opts: { allowDuplicate?: boolean } = {},
): Promise<{ id: string; duplicate: Duplicate | null }> {
  const dup = await findDuplicate({ email: input.email, phone: input.phone }, ctx.tx);
  if (dup && !opts.allowDuplicate) {
    throw new CommandError(
      `${dup.name} is already on file with that ${dup.matchedOn} — open their record instead`,
      { code: 'duplicate', tone: 'warn' },
    );
  }

  const id = `cnd_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(candidates).values({
    id,
    name: input.name,
    email: input.email ?? null,
    emailKey: emailKey(input.email),
    phone: input.phone ?? null,
    phoneKey: phoneKey(input.phone),
    locationCity: input.locationCity ?? null,
    nationality: input.nationality ?? null,
    headline: input.headline ?? null,
    currentTitle: input.currentTitle ?? null,
    currentCompany: input.currentCompany ?? null,
    sector: input.sector ?? null,
    sectorSource: input.sectorSource ?? null,
    yearsExperience: input.yearsExperience ?? null,
    noticeDays: input.noticeDays ?? null,
    expectedSalary: input.expectedSalary ?? null,
    currentSalary: input.currentSalary ?? null,
    currentSalarySource: input.currentSalarySource ?? null,
    currentSalaryAt: input.currentSalary != null ? ctx.now : null,
    linkedin: input.linkedin ?? null,
    portfolio: input.portfolio ?? null,
    hue: hueOf(input.name),
    hashtags: input.hashtags ?? [],
    createdAt: ctx.now,
    createdBy: ctx.viewer.staffId ?? null,
    updatedAt: ctx.now,
  });

  let i = 0;
  for (const skill of input.skills ?? []) {
    await ctx.tx.insert(candidateSkills)
      .values({ candidateId: id, skill, sortOrder: i++ })
      .onConflictDoNothing();
  }

  await audit(ctx, {
    action: 'create',
    summary: `added ${input.name} to the candidate list`,
    entityType: 'candidate', entityId: id, entityLabel: input.name,
    after: { email: input.email ?? null, phone: input.phone ?? null },
  }, ctx.tx);
  await emit(ctx, {
    type: 'candidate.created', subjectType: 'candidate', subjectId: id,
    payload: { name: input.name },
  }, ctx.tx);

  return { id, duplicate: dup };
}

export type ApplyInput = {
  candidateId: string;
  jobId: string;
  /** How they arrived: the careers form, a recruiter, an agency, a referral. */
  source: string;
  sourcerId?: string | null;
  /** Sourced candidates enter at Sourced; everybody else at Applied. */
  entry?: Extract<StageKey, 'applied' | 'sourced'>;
  appliedAt?: Date;
};

export type ApplyResult = {
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  stage: StageKey;
  stageName: string;
};

/** Put a candidate into a requisition's pipeline, once. */
export async function apply(
  input: ApplyInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<ApplyResult> {
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, input.candidateId)).limit(1);
  if (!cand) throw new CommandError('That candidate no longer exists');

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');
  if (!['open', 'on_hold', 'draft', 'pending_approval'].includes(job.status)) {
    throw new CommandError(`${job.title} is closed — nobody new can be added to it`);
  }

  /* One application per person per requisition. The unique index enforces it;
     this check is here so the person gets a sentence rather than a constraint
     violation, and so the existing application can be opened. */
  const [existing] = await ctx.tx.select().from(applications).where(and(
    eq(applications.candidateId, input.candidateId),
    eq(applications.jobId, input.jobId),
  )).limit(1);
  if (existing) {
    throw new CommandError(
      `${cand.name} is already on ${job.title}`,
      { code: 'duplicate', tone: 'warn' },
    );
  }

  const entry: StageKey = input.entry ?? (input.sourcerId ? 'sourced' : 'applied');
  const [stage] = await ctx.tx.select().from(jobStages)
    .where(and(eq(jobStages.jobId, input.jobId), eq(jobStages.stageKey, entry))).limit(1);
  if (!stage) {
    throw new CommandError(`${job.title} does not run a ${entry} stage`);
  }

  const applicationId = `app_${crypto.randomUUID().slice(0, 12)}`;
  const appliedAt = input.appliedAt ?? ctx.now;
  const [{ n }] = rowsOf(await ctx.tx.execute(sql`
    SELECT count(*)::int AS n FROM ${applications}`)) as Array<{ n: number }>;

  await ctx.tx.insert(applications).values({
    id: applicationId,
    reference: `APP-${appliedAt.getUTCFullYear()}-${String(Number(n) + 1).padStart(5, '0')}`,
    jobId: input.jobId,
    candidateId: input.candidateId,
    stage: entry,
    status: 'active',
    source: input.source,
    recruiterId: job.recruiterId ?? null,
    sourcerId: input.sourcerId ?? null,
    appliedAt,
    stageEnteredAt: appliedAt,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  /* The history is append-only and starts at the entry stage, so the first
     dwell time is measured from the day they arrived. */
  await ctx.tx.insert(applicationStageHistory).values({
    applicationId,
    seq: 1,
    fromStage: null,
    toStage: entry,
    toStatus: 'active',
    at: appliedAt,
    actorId: ctx.viewer.staffId ?? null,
    actorName: ctx.viewer.name,
    source: 'apply',
  });

  await audit(ctx, {
    action: 'create',
    summary: `added ${cand.name} to ${job.title} at ${stage.name}`,
    entityType: 'application', entityId: applicationId, entityLabel: cand.name,
    after: { jobId: input.jobId, stage: entry, source: input.source },
  }, ctx.tx);
  await emit(ctx, {
    type: 'application.created', subjectType: 'application', subjectId: applicationId,
    payload: { jobId: input.jobId, candidateId: input.candidateId, stage: entry, source: input.source },
  }, ctx.tx);

  return {
    applicationId,
    candidateName: cand.name,
    jobTitle: job.title,
    stage: entry,
    stageName: stage.name,
  };
}

/* ── The recruiter tag ───────────────────────────────────────────────────── */

/** Put a name on a candidate, so the rest of the desk knows before they call. */
export async function claim(
  candidateId: string, note: string | null, ctx: Ctx & { tx: Exec; now: Date },
  days: number = CLAIM_DEFAULT_DAYS,
  takeover = false,
): Promise<{ name: string; until: Date; days: number; tookOverFrom: string | null }> {
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, candidateId)).limit(1);
  if (!cand) throw new CommandError('That candidate no longer exists');

  const live = claimIsLive(cand.claimAt, cand.claimDays, ctx.now);
  const held = live && cand.claimBy && cand.claimBy !== ctx.viewer.staffId ? cand : null;
  /* Going over somebody's tag is allowed, but never by accident: the recruiter
     has to say so, it is written to the trail, and the holder is told. */
  if (held && !takeover) {
    throw new CommandError(
      `${cand.claimByName ?? 'Somebody else'} has their name on ${cand.name} — ask them first`,
      { code: 'claimed', tone: 'warn' },
    );
  }

  await ctx.tx.update(candidates).set({
    claimBy: ctx.viewer.staffId ?? null,
    claimByName: ctx.viewer.name,
    claimAt: ctx.now,
    claimDays: days,
    claimNote: note,
    updatedAt: ctx.now,
  }).where(eq(candidates.id, candidateId));

  await audit(ctx, {
    action: 'update',
    summary: held
      ? `took over ${held.claimByName ?? 'a colleague'}'s tag on ${cand.name}`
      : `put their name on ${cand.name} for ${days} days`,
    entityType: 'candidate', entityId: candidateId, entityLabel: cand.name,
    before: { claimBy: cand.claimByName },
    after: { claimBy: ctx.viewer.name },
    reason: note,
  }, ctx.tx);
  await emit(ctx, {
    type: 'candidate.claimed', subjectType: 'candidate', subjectId: candidateId,
    payload: { by: ctx.viewer.name, days, tookOverFrom: held?.claimByName ?? null },
  }, ctx.tx);

  if (held) {
    await notify({
      kind: 'claim',
      staffId: held.claimBy,
      text: `${ctx.viewer.name.split(/\s+/)[0]} took over your tag on ${cand.name}`,
      candidateId,
      link: `/candidates/${candidateId}`,
    }, ctx);
  }

  return {
    name: cand.name,
    until: claimEndsAt(ctx.now, days),
    days,
    tookOverFrom: held?.claimByName ?? null,
  };
}

/** Take the name off, which anybody may do to their own and an Admin to any. */
export async function release(
  candidateId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string }> {
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, candidateId)).limit(1);
  if (!cand) throw new CommandError('That candidate no longer exists');
  if (!cand.claimAt) throw new CommandError('Nobody has their name on that candidate', { tone: 'warn' });
  if (cand.claimBy !== ctx.viewer.staffId && !ctx.viewer.isAdmin) {
    throw new CommandError(`That tag is ${cand.claimByName}'s to release`);
  }

  await ctx.tx.update(candidates).set({
    claimBy: null, claimByName: null, claimAt: null, claimDays: null, claimNote: null,
    updatedAt: ctx.now,
  }).where(eq(candidates.id, candidateId));

  await audit(ctx, {
    action: 'update',
    summary: `released the tag on ${cand.name}`,
    entityType: 'candidate', entityId: candidateId, entityLabel: cand.name,
    before: { claimBy: cand.claimByName }, after: { claimBy: null },
  }, ctx.tx);

  return { name: cand.name };
}
