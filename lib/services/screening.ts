import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  screenings, screeningTurns, screeningScores, applications, jobs, candidates,
  locations, candidateResumes,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { queueMessage } from '@/lib/services/messaging';
import { mintLink, revokeLinks } from '@/lib/services/links';
import { providers } from '@/lib/env';
import {
  screenQuestions, scoreAnswer, verdictOf, summaryOf, moneyIn, noticeIn,
  ARABIC_FAMILIES, type ScreenKey, type ScreenQuestion, type ScoreContext,
} from '@/lib/domain/screening';

/* ═════════════════════════════════════════════════════════════════════════════
   SCREENING

   Six knockout questions, asked one of three ways: over WhatsApp, on the
   careers site, or by an assistant that telephones the candidate. The answers
   are scored as they arrive, and the screen finishes with a verdict a recruiter
   can act on without reading the whole conversation.

   What this module will not do is pretend. A WhatsApp screen whose provider is
   not configured is written with the link unsent and says so; a phone screen
   with no telephony provider is refused outright rather than booked into a
   queue nothing will ever drain. The prototype simulated all of it, because a
   prototype has nobody to disappoint.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Channel = 'WhatsApp' | 'Careers site' | 'AI phone';

type Loaded = {
  application: typeof applications.$inferSelect;
  job: typeof jobs.$inferSelect;
  candidate: typeof candidates.$inferSelect;
};

async function load(applicationId: string, exec: Exec): Promise<Loaded> {
  const [application] = await exec.select().from(applications)
    .where(eq(applications.id, applicationId)).limit(1);
  if (!application) throw new CommandError('That application no longer exists');
  if (!['active', 'on_hold'].includes(application.status)) {
    throw new CommandError('That application is closed — there is nobody left to screen');
  }
  const [job] = await exec.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1);
  const [candidate] = await exec.select().from(candidates)
    .where(eq(candidates.id, application.candidateId)).limit(1);
  if (!job || !candidate) throw new CommandError('That requisition or candidate no longer exists');
  return { application, job, candidate };
}

/** The questions this requisition asks, and how an answer to each is scored. */
export async function questionContext(
  job: typeof jobs.$inferSelect, exec: Exec,
): Promise<ScoreContext> {
  const [loc] = job.locationId
    ? await exec.select().from(locations).where(eq(locations.id, job.locationId)).limit(1)
    : [];
  return {
    jobTitle: job.title,
    family: job.family,
    city: loc?.city ?? 'Riyadh',
    remoteOk: job.remoteOk,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    arabicMatters: ARABIC_FAMILIES.includes(job.family),
    /* A senior band wants five years; below it, two is enough to be useful. */
    wantsYears: (job.salaryMin ?? 0) > 20_000 ? 5 : 2,
  };
}

export async function questionsFor(
  jobId: string, exec: Exec,
): Promise<{ questions: ScreenQuestion[]; ctx: ScoreContext }> {
  const [job] = await exec.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');
  const ctx = await questionContext(job, exec);
  return { questions: screenQuestions(ctx), ctx };
}

/** The screen in play on this application, if there is one. */
export async function screeningOf(
  applicationId: string, exec: Exec,
): Promise<typeof screenings.$inferSelect | null> {
  const [row] = await exec.select().from(screenings)
    .where(eq(screenings.applicationId, applicationId))
    .orderBy(sql`${screenings.invitedAt} DESC`)
    .limit(1);
  return row ?? null;
}

/* A screen that has finished is a record; a new invitation starts a new one.
   Anything still in flight is reused, so inviting twice does not leave two
   half-finished conversations on the same person. */
async function reuseOrCreate(
  input: { app: Loaded; channel: Channel },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ id: string; fresh: boolean }> {
  const existing = await screeningOf(input.app.application.id, ctx.tx);
  if (existing && !['completed', 'cancelled'].includes(existing.status)) {
    await ctx.tx.update(screenings).set({
      channel: input.channel, updatedAt: ctx.now,
    }).where(eq(screenings.id, existing.id));
    return { id: existing.id, fresh: false };
  }
  const id = `scr_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(screenings).values({
    id,
    applicationId: input.app.application.id,
    candidateId: input.app.application.candidateId,
    jobId: input.app.application.jobId,
    channel: input.channel,
    status: 'invited',
    invitedAt: ctx.now,
    createdBy: ctx.viewer.staffId ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  return { id, fresh: true };
}

/* ── The chat screen ─────────────────────────────────────────────────────── */

export type InviteResult = {
  screeningId: string;
  candidateName: string;
  channel: Channel;
  /** Null when the channel has no provider configured. */
  sent: boolean;
  note: string | null;
};

/** Send the candidate a link to the six questions. */
export async function inviteChat(
  input: { applicationId: string; channel: 'WhatsApp' | 'Careers site' },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<InviteResult> {
  const app = await load(input.applicationId, ctx.tx);
  const { id: screeningId } = await reuseOrCreate({ app, channel: input.channel }, ctx);

  const link = await mintLink({
    purpose: 'screening',
    subjectType: 'screening',
    subjectId: screeningId,
    candidateId: app.candidate.id,
    applicationId: app.application.id,
    replace: true,
  }, ctx);

  const first = app.candidate.name.split(/\s+/)[0];
  const queued = await queueMessage({
    channel: input.channel === 'WhatsApp' ? 'WhatsApp' : 'Email',
    applicationId: app.application.id,
    candidateId: app.candidate.id,
    jobId: app.job.id,
    toName: app.candidate.name,
    toAddress: input.channel === 'WhatsApp' ? app.candidate.phone : app.candidate.email,
    subject: input.channel === 'WhatsApp' ? null : `A few quick questions — ${app.job.title}`,
    body: `Hi ${first}, Bayut here. Six quick questions about the ${app.job.title} role: ${link.url}`,
    thread: { subjectType: 'application', subjectId: app.application.id, title: app.job.title },
  }, ctx);

  await ctx.tx.update(screenings).set({ status: 'invited', updatedAt: ctx.now })
    .where(eq(screenings.id, screeningId));

  await audit(ctx, {
    action: 'create',
    summary: `sent ${app.candidate.name} a screening link over ${input.channel}`,
    entityType: 'screening', entityId: screeningId, entityLabel: app.candidate.name,
    after: { channel: input.channel, delivery: queued.status },
  }, ctx.tx);
  await emit(ctx, {
    type: 'screening.invited', subjectType: 'screening', subjectId: screeningId,
    payload: { applicationId: app.application.id, channel: input.channel },
  }, ctx.tx);

  return {
    screeningId,
    candidateName: app.candidate.name,
    channel: input.channel,
    sent: queued.status === 'queued',
    note: queued.reason,
  };
}

/** The candidate opened the link: the assistant says hello and asks the first. */
export async function beginChat(
  screeningId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ question: ScreenQuestion | null; asked: number; of: number }> {
  const [s] = await ctx.tx.select().from(screenings)
    .where(eq(screenings.id, screeningId)).limit(1);
  if (!s) throw new CommandError('That screening no longer exists');
  if (s.status === 'completed') throw new CommandError('That screening is already finished', { tone: 'warn' });

  const { questions } = await questionsFor(s.jobId, ctx.tx);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, s.candidateId)).limit(1);
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, s.jobId)).limit(1);

  if (s.status !== 'running') {
    await ctx.tx.update(screenings).set({
      status: 'running', startedAt: s.startedAt ?? ctx.now, updatedAt: ctx.now,
    }).where(eq(screenings.id, screeningId));
    const first = (cand?.name ?? '').split(/\s+/)[0];
    await addTurn(screeningId, 'bot',
      `Hi ${first}, I'm the Bayut hiring assistant. Six quick questions about the `
      + `${job?.title ?? 'role'} — it takes about two minutes.`, ctx);
  }

  return nextQuestion(screeningId, questions, ctx.tx);
}

async function addTurn(
  screeningId: string, who: 'bot' | 'candidate', text: string,
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  const [{ n }] = rowsOf(await ctx.tx.execute(sql`
    SELECT coalesce(max(seq), 0)::int AS n FROM ${screeningTurns}
     WHERE screening_id = ${screeningId}`)) as Array<{ n: number }>;
  await ctx.tx.insert(screeningTurns).values({
    screeningId, who, text, at: ctx.now, seq: Number(n) + 1,
  });
}

async function nextQuestion(
  screeningId: string, questions: ScreenQuestion[], exec: Exec,
): Promise<{ question: ScreenQuestion | null; asked: number; of: number }> {
  const done = (await exec.select({ key: screeningScores.key }).from(screeningScores)
    .where(eq(screeningScores.screeningId, screeningId))).map((r) => r.key);
  const left = questions.filter((q) => !done.includes(q.key));
  return { question: left[0] ?? null, asked: done.length, of: questions.length };
}

export type AnswerResult = {
  scored: number;
  max: number;
  next: ScreenQuestion | null;
  finished: boolean;
};

/** Record one answer, score it, and ask the next. */
export async function recordAnswer(
  input: { screeningId: string; key: ScreenKey; answer: string },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<AnswerResult> {
  const [s] = await ctx.tx.select().from(screenings)
    .where(eq(screenings.id, input.screeningId)).limit(1);
  if (!s) throw new CommandError('That screening no longer exists');
  if (s.status === 'completed') throw new CommandError('That screening is already finished', { tone: 'warn' });

  const { questions, ctx: scoreCtx } = await questionsFor(s.jobId, ctx.tx);
  const q = questions.find((x) => x.key === input.key);
  if (!q) throw new CommandError('That is not one of the questions');

  const answer = input.answer.trim();
  if (!answer) throw new CommandError('An answer, please');

  const score = scoreAnswer(input.key, answer, scoreCtx);
  await addTurn(input.screeningId, 'candidate', answer, ctx);
  await ctx.tx.insert(screeningScores).values({
    screeningId: input.screeningId,
    key: input.key,
    question: q.question,
    answer,
    score,
    max: q.max,
    sortOrder: questions.findIndex((x) => x.key === input.key),
  }).onConflictDoUpdate({
    target: [screeningScores.screeningId, screeningScores.key],
    set: { answer, score },
  });

  if (s.status !== 'running') {
    await ctx.tx.update(screenings).set({
      status: 'running', startedAt: s.startedAt ?? ctx.now, updatedAt: ctx.now,
    }).where(eq(screenings.id, input.screeningId));
  }

  const { question: next } = await nextQuestion(input.screeningId, questions, ctx.tx);
  if (next) {
    await addTurn(input.screeningId, 'bot', next.question, ctx);
    return { scored: score, max: q.max, next, finished: false };
  }

  await complete(input.screeningId, ctx);
  return { scored: score, max: q.max, next: null, finished: true };
}

export type CompleteResult = {
  total: number; max: number; pct: number;
  verdict: 'pass' | 'review' | 'fail';
  summary: string;
  candidateName: string;
};

/** Total the answers, write the verdict, and close the screen. */
export async function complete(
  screeningId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<CompleteResult> {
  const [s] = await ctx.tx.select().from(screenings)
    .where(eq(screenings.id, screeningId)).limit(1);
  if (!s) throw new CommandError('That screening no longer exists');

  const scored = await ctx.tx.select().from(screeningScores)
    .where(eq(screeningScores.screeningId, screeningId))
    .orderBy(screeningScores.sortOrder);
  if (!scored.length) throw new CommandError('Nothing has been answered yet');

  const total = scored.reduce((n, r) => n + r.score, 0);
  const max = scored.reduce((n, r) => n + r.max, 0);
  const verdict = verdictOf(total, max);
  const weak = scored.filter((r) => r.score === 0).map((r) => r.key);
  const summary = summaryOf(verdict, weak);
  const pct = max ? Math.round((total / max) * 100) : 0;

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, s.candidateId)).limit(1);

  await addTurn(screeningId, 'bot',
    `Thank you — that's everything. ${verdict === 'pass'
      ? 'A recruiter will be in touch within two working days.'
      : 'The team will review your answers and come back to you.'}`, ctx);

  await ctx.tx.update(screenings).set({
    status: 'completed',
    completedAt: ctx.now,
    total, max, score: pct, verdict, summary,
    updatedAt: ctx.now,
  }).where(eq(screenings.id, screeningId));

  /* The link has done its work. */
  await revokeLinks({ purpose: 'screening', subjectType: 'screening', subjectId: screeningId }, ctx);

  await audit(ctx, {
    action: 'update',
    summary: `${cand?.name ?? 'the candidate'} finished the screening — ${pct} of 100, ${verdict}`,
    entityType: 'screening', entityId: screeningId, entityLabel: cand?.name ?? null,
    after: { total, max, score: pct, verdict },
  }, ctx.tx);
  await emit(ctx, {
    type: 'screening.completed', subjectType: 'screening', subjectId: screeningId,
    payload: { applicationId: s.applicationId, score: pct, verdict },
  }, ctx.tx);

  return { total, max, pct, verdict, summary, candidateName: cand?.name ?? 'the candidate' };
}

/* ── The AI phone screen ─────────────────────────────────────────────────── */

export const VOICES: Array<[string, string]> = [
  ['Noor', 'Noor — Arabic-first, female'],
  ['Faris', 'Faris — Arabic-first, male'],
  ['Sara', 'Sara — English-first, female'],
];

/** The language and voice a candidate's CV suggests. */
export async function callDefaults(
  candidateId: string, exec: Exec,
): Promise<{ language: 'ar' | 'en'; voice: string }> {
  const [resume] = await exec.select({ languages: candidateResumes.languages })
    .from(candidateResumes).where(eq(candidateResumes.candidateId, candidateId)).limit(1);
  const [cand] = await exec.select({ gender: candidates.gender }).from(candidates)
    .where(eq(candidates.id, candidateId)).limit(1);
  const arabic = (resume?.languages ?? []).find((l) => l.name === 'Arabic')?.level;
  const language: 'ar' | 'en' = arabic === 'Native' || arabic === 'Fluent' ? 'ar' : 'en';
  return {
    language,
    voice: language === 'ar' ? (cand?.gender === 'f' ? 'Noor' : 'Faris') : 'Sara',
  };
}

export type CallInput = {
  applicationId: string;
  /** now — call as soon as the worker picks it up; candidate — send a booking
      link and let them choose; schedule — a time the recruiter picked. */
  when: 'now' | 'candidate' | 'schedule';
  at?: Date | null;
  language?: 'ar' | 'en';
  voice?: string;
};

export type CallResult = {
  screeningId: string;
  candidateName: string;
  when: 'now' | 'candidate' | 'schedule';
  scheduledFor: string | null;
  smsSent: boolean;
  note: string | null;
};

/**
 * Set up the phone screen. Refused outright when there is no telephony
 * provider: a call nobody can place is not a call that is "queued", and a
 * recruiter who thinks it is will stop chasing the candidate.
 */
export async function setUpCall(
  input: CallInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<CallResult> {
  const voice = providers().voice;
  if (!voice.configured) {
    throw new CommandError(
      'The phone assistant is not configured — set a telephony provider in '
      + 'Settings → Integrations, or send the chat screening instead',
      { code: 'not_configured' },
    );
  }

  const app = await load(input.applicationId, ctx.tx);
  if (!app.candidate.phone) {
    throw new CommandError(`There is no number on file for ${app.candidate.name}`);
  }

  const defaults = await callDefaults(app.candidate.id, ctx.tx);
  const { id: screeningId } = await reuseOrCreate({ app, channel: 'AI phone' }, ctx);

  let scheduledFor: Date | null = null;
  if (input.when === 'schedule') {
    scheduledFor = input.at ?? new Date(ctx.now.getTime() + 86_400_000);
    if (scheduledFor.getTime() < ctx.now.getTime() - 60_000) {
      throw new CommandError('That is in the past — pick a time ahead');
    }
  }

  await ctx.tx.update(screenings).set({
    status: input.when === 'candidate' ? 'invited' : 'scheduled',
    callDirection: 'outbound',
    callPhone: app.candidate.phone,
    callLanguage: input.language ?? defaults.language,
    callVoice: input.voice ?? defaults.voice,
    callScheduledFor: scheduledFor,
    callNextAttemptAt: input.when === 'now' ? ctx.now : scheduledFor,
    callOutcome: 'scheduled',
    callProvider: voice.provider,
    callAttempts: 0,
    updatedAt: ctx.now,
  }).where(eq(screenings.id, screeningId));

  const first = app.candidate.name.split(/\s+/)[0];
  let smsSent = false;
  let note: string | null = null;

  if (input.when === 'candidate') {
    const link = await mintLink({
      purpose: 'booking', subjectType: 'screening', subjectId: screeningId,
      candidateId: app.candidate.id, applicationId: app.application.id, replace: true,
    }, ctx);
    const q = await queueMessage({
      channel: 'SMS',
      applicationId: app.application.id, candidateId: app.candidate.id, jobId: app.job.id,
      toName: app.candidate.name, toAddress: app.candidate.phone,
      body: `Hi ${first}, Bayut here. Pick a time for a six-minute screening call about `
        + `${app.job.title}: ${link.url}`,
      thread: { subjectType: 'application', subjectId: app.application.id, title: app.job.title },
    }, ctx);
    smsSent = q.status === 'queued';
    note = q.reason;
  } else if (input.when === 'schedule' && scheduledFor) {
    const q = await queueMessage({
      channel: 'SMS',
      applicationId: app.application.id, candidateId: app.candidate.id, jobId: app.job.id,
      toName: app.candidate.name, toAddress: app.candidate.phone,
      body: `Hi ${first}, Bayut here. Our assistant will call you about the ${app.job.title} role `
        + `on ${riyadh(scheduledFor)}. Reply R to reschedule.`,
      thread: { subjectType: 'application', subjectId: app.application.id, title: app.job.title },
    }, ctx);
    smsSent = q.status === 'queued';
    note = q.reason;
  }

  await audit(ctx, {
    action: 'update',
    summary: input.when === 'now'
      ? `set up a phone screen with ${app.candidate.name}`
      : input.when === 'candidate'
        ? `sent ${app.candidate.name} a booking link for a phone screen`
        : `booked a phone screen with ${app.candidate.name} for ${riyadh(scheduledFor!)}`,
    entityType: 'screening', entityId: screeningId, entityLabel: app.candidate.name,
    after: {
      channel: 'AI phone', when: input.when,
      scheduledFor: scheduledFor?.toISOString() ?? null,
      language: input.language ?? defaults.language,
    },
  }, ctx.tx);
  await emit(ctx, {
    type: 'screening.invited', subjectType: 'screening', subjectId: screeningId,
    payload: {
      applicationId: app.application.id, channel: 'AI phone', when: input.when,
      scheduledFor: scheduledFor?.toISOString() ?? null,
    },
  }, ctx.tx);

  return {
    screeningId,
    candidateName: app.candidate.name,
    when: input.when,
    scheduledFor: scheduledFor?.toISOString() ?? null,
    smsSent,
    note,
  };
}

const riyadh = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
}).format(d);

/** Call it off before it happens. */
export async function cancelCall(
  screeningId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string }> {
  const [s] = await ctx.tx.select().from(screenings)
    .where(eq(screenings.id, screeningId)).limit(1);
  if (!s) throw new CommandError('That screening no longer exists');
  if (!['scheduled', 'invited'].includes(s.status)) {
    throw new CommandError('That call is already under way or finished', { tone: 'warn' });
  }
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, s.candidateId)).limit(1);

  await ctx.tx.update(screenings).set({
    status: 'cancelled',
    callOutcome: 'failed',
    callNextAttemptAt: null,
    updatedAt: ctx.now,
  }).where(eq(screenings.id, screeningId));
  await revokeLinks({ purpose: 'booking', subjectType: 'screening', subjectId: screeningId }, ctx);

  await audit(ctx, {
    action: 'update',
    summary: `cancelled the phone screen with ${cand?.name ?? 'the candidate'}`,
    entityType: 'screening', entityId: screeningId, entityLabel: cand?.name ?? null,
    before: { status: s.status }, after: { status: 'cancelled' },
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate' };
}

/* ── Salary and notice ───────────────────────────────────────────────────── */

export type Captured = {
  currentSalary: number;
  expectedSalary: number | null;
  noticeDays: number | null;
  quote: string | null;
};

/**
 * Read the pay and the notice off what the candidate actually said. Nothing is
 * invented: if the transcript has no number in it, the recruiter is told to
 * type one in rather than given a guess.
 */
export async function captureFromTranscript(
  screeningId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<Captured & { candidateName: string }> {
  const [s] = await ctx.tx.select().from(screenings)
    .where(eq(screenings.id, screeningId)).limit(1);
  if (!s) throw new CommandError('That screening no longer exists');

  const turns = await ctx.tx.select().from(screeningTurns)
    .where(and(eq(screeningTurns.screeningId, screeningId), eq(screeningTurns.who, 'candidate')))
    .orderBy(screeningTurns.seq);
  const said = turns.map((t) => t.text).join(' ');
  const nums = moneyIn(said);
  if (!nums.length) {
    throw new CommandError('The transcript does not give a number — type it in instead', { tone: 'warn' });
  }

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, s.candidateId)).limit(1);

  const currentSalary = Math.min(...nums);
  const expectedSalary = nums.length > 1 ? Math.max(...nums) : (cand?.expectedSalary ?? null);
  const noticeDays = noticeIn(said) ?? cand?.noticeDays ?? null;
  const quote = turns.find((t) => /sar|riyal/i.test(t.text))?.text ?? null;

  await ctx.tx.update(screenings).set({
    capturedCurrentSalary: currentSalary,
    capturedExpectedSalary: expectedSalary,
    capturedNoticeDays: noticeDays,
    capturedSource: 'ai',
    capturedBy: 'assistant',
    capturedAt: ctx.now,
    capturedQuote: quote,
    updatedAt: ctx.now,
  }).where(eq(screenings.id, screeningId));

  await ctx.tx.update(candidates).set({
    currentSalary,
    expectedSalary: expectedSalary ?? cand?.expectedSalary ?? null,
    noticeDays,
    currentSalarySource: 'ai',
    currentSalaryAt: ctx.now,
    updatedAt: ctx.now,
  }).where(eq(candidates.id, s.candidateId));

  await audit(ctx, {
    action: 'update',
    summary: `read ${cand?.name ?? 'the candidate'}'s pay off the screening transcript`,
    entityType: 'candidate', entityId: s.candidateId, entityLabel: cand?.name ?? null,
    before: { currentSalary: cand?.currentSalary ?? null },
    after: { currentSalary, expectedSalary, noticeDays, source: 'ai' },
  }, ctx.tx);

  return {
    currentSalary, expectedSalary, noticeDays, quote,
    candidateName: cand?.name ?? 'the candidate',
  };
}

/** The recruiter types the numbers in after the call. */
export async function recordSalary(
  input: {
    applicationId: string; currentSalary: number;
    expectedSalary: number | null; noticeDays: number | null;
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; currentSalary: number; expectedSalary: number | null }> {
  const app = await load(input.applicationId, ctx.tx);
  if (!input.currentSalary || input.currentSalary <= 0) {
    throw new CommandError('The current salary is the number that matters here');
  }
  if (input.currentSalary > 500_000) {
    throw new CommandError('That is a monthly figure in riyals — it looks like an annual one');
  }

  const notice = input.noticeDays == null ? null : Math.max(0, Math.round(input.noticeDays));
  await ctx.tx.update(candidates).set({
    currentSalary: input.currentSalary,
    expectedSalary: input.expectedSalary,
    noticeDays: notice,
    currentSalarySource: 'recruiter',
    currentSalaryAt: ctx.now,
    updatedAt: ctx.now,
  }).where(eq(candidates.id, app.candidate.id));

  const s = await screeningOf(input.applicationId, ctx.tx);
  if (s) {
    await ctx.tx.update(screenings).set({
      capturedCurrentSalary: input.currentSalary,
      capturedExpectedSalary: input.expectedSalary,
      capturedNoticeDays: notice,
      capturedSource: 'recruiter',
      capturedBy: ctx.viewer.staffId ?? null,
      capturedAt: ctx.now,
      capturedQuote: null,
      updatedAt: ctx.now,
    }).where(eq(screenings.id, s.id));
  }

  await audit(ctx, {
    action: 'update',
    summary: `recorded ${app.candidate.name}'s current salary from the screen`,
    entityType: 'candidate', entityId: app.candidate.id, entityLabel: app.candidate.name,
    before: { currentSalary: app.candidate.currentSalary },
    after: {
      currentSalary: input.currentSalary,
      expectedSalary: input.expectedSalary,
      noticeDays: notice,
      source: 'recruiter',
    },
  }, ctx.tx);

  return {
    candidateName: app.candidate.name,
    currentSalary: input.currentSalary,
    expectedSalary: input.expectedSalary,
  };
}
