import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { interviews, evaluations, applications, jobs } from '@/db/schema';
import { CommandError } from '@/lib/commands/registry';
import { audit, emit, type Ctx } from '@/lib/audit';
import { aiAdapter } from '@/lib/providers';
import { providers } from '@/lib/env';
import { CRIT, CRIT_KEYS, scoreFrom } from '@/lib/domain/ivreview';

/* ═════════════════════════════════════════════════════════════════════════════
   HOW AN INTERVIEW WAS RUN

   The second question a recording answers. The first — what the conversation
   says about the candidate — is the scorecard, and a person writes that. This
   is whether whoever ran it did the job: opened it properly, asked what the
   description actually needs, listened more than they talked, stayed inside the
   law, closed with a next step, and wrote the scorecard up afterwards.

   It is coaching, and it is the interviewer's own. Nothing here reads back onto
   the candidate.

   **It is refused rather than invented.** The prototype produced these six
   ratings from a hash of the interview's id, which is fine for a demonstration
   and indefensible in a system somebody's appraisal might be read from. Here:

     · no recording → refused, because there is nothing to analyse;
     · no model configured → refused, naming the setting;
     · a model that answers with something other than six ratings → refused,
       because a partial review with five of six invented is worse than none.

   One of the six can be measured without a model at all — whether the scorecard
   was written, and how long it took — and that is computed from the record and
   given to the model as fact rather than asked about.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Analysis = {
  interviewId: string;
  score: number;
  ratings: Record<string, number>;
  strengths: string[];
  improve: string[];
  flags: string[];
  model: string;
};

/** What the record already knows: whether the scorecard came, and how late. */
export async function scorecardTiming(
  iv: typeof interviews.$inferSelect, exec: Exec,
): Promise<{ written: boolean; days: number | null }> {
  const mine = await exec.select().from(evaluations)
    .where(and(
      eq(evaluations.applicationId, iv.applicationId),
      eq(evaluations.submitted, true),
      iv.interviewer
        ? sql`lower(${evaluations.evaluatorName}) = lower(${iv.interviewer})`
        : sql`true`,
    ))
    .orderBy(asc(evaluations.at))
    .limit(1);
  if (!mine.length) return { written: false, days: null };
  const at = mine[0].at ?? mine[0].createdAt;
  return {
    written: true,
    days: Math.max(0, Math.round((new Date(at).getTime() - iv.at.getTime()) / 86_400_000)),
  };
}

/** The rating the timing earns, which needs no model. */
export const scorecardRating = (t: { written: boolean; days: number | null }): number => {
  if (!t.written) return 1;
  const d = t.days ?? 0;
  return d <= 1 ? 5 : d <= 3 ? 4 : d <= 7 ? 3 : 2;
};

const SHAPE = `{"ratings":{${CRIT_KEYS.map((k) => `"${k}":1-5`).join(',')}},`
  + '"strengths":["…"],"improve":["…"],"flags":["…"],"talkRatio":0-100}';

export async function analyse(
  interviewId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<Analysis> {
  const [iv] = await ctx.tx.select().from(interviews)
    .where(eq(interviews.id, interviewId)).limit(1);
  if (!iv) throw new CommandError('That interview no longer exists');
  if (iv.status === 'cancelled') throw new CommandError('That interview was cancelled');
  if (iv.at.getTime() > ctx.now.getTime()) {
    throw new CommandError('That interview has not happened yet');
  }
  if (!iv.recorded || (!iv.recordingFileId && !iv.recordingRef)) {
    throw new CommandError(
      'That interview was not recorded, so there is nothing to review. Recording is asked for '
      + 'at the start of the call and the candidate can say no.',
    );
  }

  const p = providers().ai;
  if (!p.configured) {
    throw new CommandError(
      `No model is configured — Settings → Integrations (${p.missing.join(', ')}). The review reads `
      + 'the recording, so it cannot be produced without one; nothing is invented in its place.',
      { code: 'not_configured' },
    );
  }

  const timing = await scorecardTiming(iv, ctx.tx);
  const [job] = iv.jobId
    ? await ctx.tx.select({ title: jobs.title }).from(jobs).where(eq(jobs.id, iv.jobId)).limit(1)
    : [];

  const r = await aiAdapter().json<{
    ratings?: Record<string, unknown>;
    strengths?: unknown; improve?: unknown; flags?: unknown; talkRatio?: unknown;
  }>({
    system: 'You review how an interview was conducted, for the interviewer\'s own coaching. '
      + 'You never comment on the candidate. Answer with JSON only.',
    prompt: [
      `Interview: ${iv.title}${job ? ` for ${job.title}` : ''}.`,
      `Run by ${iv.interviewer ?? 'the panel'}, ${iv.durationMin} minutes, ${iv.mode}.`,
      `Recording: ${iv.recordingRef ?? iv.recordingFileId}.`,
      '',
      'Rate each of these one to five:',
      ...CRIT.map(([k, label, hint]) => `  ${k} — ${label}: ${hint}`),
      '',
      `The scorecard criterion is already known and is ${scorecardRating(timing)}: `
        + `${timing.written ? `written after ${timing.days} day(s)` : 'never written'}. `
        + 'Use that figure exactly.',
      '',
      `Answer with ${SHAPE}`,
    ].join('\n'),
    maxTokens: 900,
  });

  if (!r.ok) {
    throw new CommandError(
      r.reason === 'not_configured'
        ? `No model is configured — ${r.message}`
        : `The review could not be produced: ${r.message}`,
    );
  }

  /* Nothing a model says is written unchecked. Six ratings, each one to five,
     or the whole thing is refused. */
  const raw = r.detail!.value.ratings ?? {};
  const ratings: Record<string, number> = {};
  for (const k of CRIT_KEYS) {
    const n = Math.round(Number((raw as Record<string, unknown>)[k]));
    if (!Number.isFinite(n) || n < 1 || n > 5) {
      throw new CommandError(
        `The model did not rate "${k}" — a review with a criterion missing is not a review, `
        + 'so nothing was saved',
      );
    }
    ratings[k] = n;
  }
  /* The one criterion the record already answers is the record's, not the
     model's, however the model chose to answer it. */
  ratings.scorecard = scorecardRating(timing);

  const strings = (x: unknown): string[] =>
    (Array.isArray(x) ? x.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6) : []);
  const strengths = strings(r.detail!.value.strengths);
  const improve = strings(r.detail!.value.improve);
  const flags = strings(r.detail!.value.flags);
  const score = scoreFrom(ratings);

  const talk = Math.round(Number(r.detail!.value.talkRatio));
  const analysisBlob: Record<string, unknown> = {
    talkRatio: Number.isFinite(talk) && talk >= 0 && talk <= 100 ? talk : null,
    scorecardWritten: timing.written,
    scorecardDays: timing.days,
    at: ctx.now.toISOString(),
  };

  await ctx.tx.update(interviews).set({
    reviewerScore: score,
    reviewerRatings: ratings,
    reviewerStrengths: strengths,
    reviewerImprove: improve,
    reviewerModel: r.detail!.value && r.detail!.model ? r.detail!.model : 'model',
    reviewedAt: ctx.now,
    flags,
    analysis: analysisBlob,
    updatedAt: ctx.now,
  }).where(eq(interviews.id, interviewId));

  await audit(ctx, {
    action: 'action',
    summary: `analysed how ${iv.interviewer ?? 'the panel'} ran ${iv.title} — ${score} of 100`,
    entityType: 'interview', entityId: interviewId, entityLabel: iv.title,
    after: { score, ratings, flags, model: r.detail!.model },
  }, ctx.tx);
  await emit(ctx, {
    type: 'interview.reviewed', subjectType: 'interview', subjectId: interviewId,
    payload: { score, flagged: flags.length > 0, interviewer: iv.interviewer },
  }, ctx.tx);

  return {
    interviewId, score, ratings, strengths, improve, flags,
    model: r.detail!.model,
  };
}

/**
 * Every recorded interview of one interviewer that has not been reviewed. The
 * button on their card; one refusal is reported rather than stopping the rest.
 */
export async function analyseAll(
  interviewer: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ done: number; skipped: Array<{ title: string; why: string }> }> {
  const todo = await ctx.tx.select().from(interviews)
    .where(and(
      sql`lower(${interviews.interviewer}) = lower(${interviewer})`,
      eq(interviews.recorded, true),
      sql`${interviews.reviewedAt} IS NULL`,
      sql`${interviews.status} <> 'cancelled'`,
      sql`${interviews.at} <= ${ctx.now}::timestamptz`,
    ))
    .orderBy(asc(interviews.at))
    .limit(25);

  if (!todo.length) {
    throw new CommandError(
      `Every recorded interview ${interviewer} has run is already reviewed`,
      { tone: 'warn' },
    );
  }

  let done = 0;
  const skipped: Array<{ title: string; why: string }> = [];
  for (const iv of todo) {
    try {
      await analyse(iv.id, ctx);
      done += 1;
    } catch (e) {
      skipped.push({ title: iv.title, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { done, skipped };
}
