import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  interviews, interviewPanel, applications, jobs, candidates, jobStages, jobHiringManagers,
  evaluations, evaluationCriteria, interviewKits, orgSettings,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { finalGate } from '@/lib/services/transitions';
import { ensureAccount } from '@/lib/services/accounts';
import { queueMessage } from '@/lib/services/messaging';
import type { StageKey } from '@/lib/domain/stages';

/* ═════════════════════════════════════════════════════════════════════════════
   INTERVIEWS

   Booking one is not a row with a date on it. It is the panel, the account
   each of them needs in order to sign in, the scorecard each of them owes
   afterwards, and the two checks that stop a diary from becoming useless:

     · a clash — the same person in two rooms at once;
     · the weekend — Friday and Saturday in the Kingdom.

   Neither is a hard refusal. A recruiter who knows the panel member is free
   can book over a clash, and a candidate who asks for a Saturday can have one;
   what the product must not do is let either happen silently.

   The one hard refusal is the final interview on a requisition that gates it:
   manager-and-above waits for the behaviour test, a requisition running the
   sales pitch waits for the pitch to be scored. That gate lives in
   lib/services/transitions.ts and is the same one the board applies, so a
   stage that cannot be moved to cannot be booked into either.
   ═════════════════════════════════════════════════════════════════════════════*/

/* The stages an interview can hang off. The prototype's IVW_STAGES. */
export const IVW_STAGES = ['screen', 'iv1', 'iv2', 'ivf'] as const;

/* A text[] the driver will bind. `= ANY($1)` with a JavaScript array reaches
   Postgres as a record, not an array, so the list is spelled out. */
const textArray = (xs: string[]) =>
  sql`ARRAY[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]`;

export type Clash = {
  interviewId: string;
  who: string;
  at: string;
  title: string;
  candidateName: string;
};

/** Anybody on this panel who is already in a room at that time. */
export async function clashes(
  input: { at: Date; durationMin: number; panel: string[]; exceptId?: string },
  exec: Exec,
): Promise<Clash[]> {
  if (!input.panel.length) return [];
  const endsAt = new Date(input.at.getTime() + input.durationMin * 60_000);
  const names = textArray(input.panel.map((n) => n.toLowerCase()));
  const rows = rowsOf(await exec.execute(sql`
    SELECT i.id, i.at, i.title, p.name AS who, c.name AS candidate_name
      FROM ${interviews} i
      JOIN ${interviewPanel} p ON p.interview_id = i.id
      JOIN ${candidates} c ON c.id = i.candidate_id
     WHERE i.status <> 'cancelled'
       AND lower(p.name) = ANY(${names})
       AND i.at < ${endsAt}
       AND (i.at + make_interval(mins => i.duration_min)) > ${input.at}
       ${input.exceptId ? sql`AND i.id <> ${input.exceptId}` : sql``}
     ORDER BY i.at`));
  return rows.map((r) => ({
    interviewId: r.id as string,
    who: r.who as string,
    at: new Date(r.at as string).toISOString(),
    title: r.title as string,
    candidateName: r.candidate_name as string,
  }));
}

/** Friday and Saturday in the Kingdom, read from the organisation record. */
export async function isWeekend(at: Date, exec: Exec): Promise<boolean> {
  const [org] = await exec.select({ days: orgSettings.weekendDays }).from(orgSettings).limit(1);
  const days = org?.days ?? [5, 6];
  /* The working week is a Riyadh week, so the day is read in Riyadh. */
  const riyadh = new Date(at.getTime() + 3 * 3600_000);
  return days.includes(riyadh.getUTCDay());
}

/** The panel, in the prototype's order: the hiring manager first, then the rest. */
function buildPanel(interviewer: string | null, rest: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [interviewer ?? '', ...rest]) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/* Everyone on the panel can sign in to see the interview and file a scorecard.
   A hiring manager named on the requisition keeps their real title and e-mail;
   anybody else is an interview participant, which is a narrower role. */
async function invitePanel(
  jobId: string, jobTitle: string, panel: string[], ctx: Ctx & { tx: Exec; now: Date },
): Promise<number> {
  const hms = await ctx.tx.select().from(jobHiringManagers)
    .where(eq(jobHiringManagers.jobId, jobId));
  let invited = 0;
  for (const name of panel) {
    const hm = hms.find((h) => h.name.toLowerCase() === name.toLowerCase());
    const r = await ensureAccount({
      name,
      email: hm?.email ?? null,
      title: hm?.title ?? 'Interview panel',
      role: hm ? 'hiring_manager' : 'participant',
      source: hm ? `Hiring manager — ${jobTitle}` : 'Interview participant',
    }, ctx);
    if (r?.invited) invited += 1;
  }
  return invited;
}

/* Each panel member owes a scorecard. Creating it at booking is what makes
   "outstanding feedback" a real number rather than an inference. */
async function raiseScorecards(
  input: {
    interviewId: string; applicationId: string; jobId: string; candidateId: string;
    stage: StageKey; pipelineId: string | null; panel: string[];
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<number> {
  const [kit] = input.pipelineId
    ? await ctx.tx.select().from(interviewKits)
      .where(and(
        eq(interviewKits.pipelineId, input.pipelineId),
        sql`${interviewKits.archivedAt} IS NULL`,
      )).limit(1)
    : [];

  let made = 0;
  for (const name of input.panel) {
    const evaluationId = `evl_${crypto.randomUUID().slice(0, 12)}`;
    await ctx.tx.insert(evaluations).values({
      id: evaluationId,
      applicationId: input.applicationId,
      jobId: input.jobId,
      candidateId: input.candidateId,
      interviewId: input.interviewId,
      stage: input.stage,
      evaluatorName: name,
      submitted: false,
      requestedAt: ctx.now,
      createdAt: ctx.now,
    });
    for (const [n, crit] of (kit?.criteria ?? []).entries()) {
      await ctx.tx.insert(evaluationCriteria).values({
        evaluationId, name: crit.name, weight: String(crit.weight ?? 1), sortOrder: n,
      });
    }
    made += 1;
    await emit(ctx, {
      type: 'scorecard.requested', subjectType: 'evaluation', subjectId: evaluationId,
      payload: { applicationId: input.applicationId, interviewId: input.interviewId, who: name },
    }, ctx.tx);
  }
  return made;
}

export type ScheduleInput = {
  applicationId: string;
  at: Date;
  durationMin: number;
  mode: string;
  stage?: StageKey;
  interviewer?: string | null;
  panel: string[];
  organiserId?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  /** Send the candidate the confirmation the booking sheet promises. */
  confirmCandidate?: boolean;
  /** The recruiter has seen the clash and wants the slot anyway. */
  force?: boolean;
};

export type ScheduleResult = {
  interviewId: string;
  candidateName: string;
  jobTitle: string;
  title: string;
  at: string;
  panel: string[];
  weekend: boolean;
  scorecards: number;
  invited: number;
};

/** Book an interview, invite the panel, and raise the scorecards it owes. */
export async function schedule(
  input: ScheduleInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<ScheduleResult> {
  const [app] = await ctx.tx.select().from(applications)
    .where(eq(applications.id, input.applicationId)).limit(1);
  if (!app) throw new CommandError('That application no longer exists');
  if (!['active', 'on_hold'].includes(app.status)) {
    throw new CommandError('That application is closed — nothing more can be booked on it');
  }

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  if (!job || !cand) throw new CommandError('That requisition or candidate no longer exists');

  if (input.at.getTime() < ctx.now.getTime() - 60_000) {
    throw new CommandError('That is in the past — pick a time ahead');
  }
  if (input.durationMin < 5 || input.durationMin > 480) {
    throw new CommandError('An interview runs between five minutes and eight hours');
  }

  const stage = (input.stage ?? app.stage) as StageKey;
  if (!(IVW_STAGES as readonly string[]).includes(stage)) {
    throw new CommandError('Interviews hang off a screening or interview stage — pick one of those');
  }
  const [stageRow] = await ctx.tx.select().from(jobStages)
    .where(and(eq(jobStages.jobId, app.jobId), eq(jobStages.stageKey, stage))).limit(1);
  if (!stageRow) {
    throw new CommandError(`${job.title} does not run that stage`);
  }

  /* The same gate the board applies. A final that cannot be moved to cannot be
     booked into through the back door either. */
  const gate = await finalGate(app.id, stage, ctx.tx);
  if (!gate.ok) {
    const why = gate.checks.find((c) => !c.ok);
    throw new CommandError(
      `Final interview locked on ${job.title} — ${why ? why.text.charAt(0).toLowerCase() + why.text.slice(1) : 'a check is outstanding'}`,
      { code: 'gate' },
    );
  }

  const panel = buildPanel(input.interviewer ?? null, input.panel);
  if (!panel.length) throw new CommandError('Who is taking it? Pick a hiring manager or name the panel');

  const found = await clashes({
    at: input.at, durationMin: input.durationMin, panel,
  }, ctx.tx);
  if (found.length && !input.force) {
    const first = found[0];
    throw new CommandError(
      `${first.who} is already with ${first.candidateName} then — book it anyway, or pick another time`,
      { code: 'clash', tone: 'warn' },
    );
  }

  const title = `${stageRow.name} — ${cand.name}`;
  const interviewId = `ivw_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(interviews).values({
    id: interviewId,
    applicationId: app.id,
    jobId: app.jobId,
    candidateId: app.candidateId,
    stage,
    title,
    at: input.at,
    durationMin: input.durationMin,
    mode: input.mode,
    interviewer: input.interviewer?.trim() || null,
    organiserId: input.organiserId ?? ctx.viewer.staffId ?? null,
    status: 'scheduled',
    location: input.location ?? null,
    meetingUrl: input.meetingUrl ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  for (const [n, name] of panel.entries()) {
    await ctx.tx.insert(interviewPanel).values({
      interviewId,
      name,
      isHiringManager: name.toLowerCase() === (input.interviewer ?? '').trim().toLowerCase(),
      sortOrder: n,
    });
  }

  const invited = await invitePanel(job.id, job.title, panel, ctx);
  const scorecards = await raiseScorecards({
    interviewId,
    applicationId: app.id,
    jobId: app.jobId,
    candidateId: app.candidateId,
    stage,
    pipelineId: job.pipelineId,
    panel,
  }, ctx);

  if (input.confirmCandidate) {
    await confirmationEmail({
      applicationId: app.id, candidateId: app.candidateId, jobId: app.jobId,
      jobTitle: job.title, candidateName: cand.name, at: input.at, mode: input.mode, panel,
    }, ctx);
  }

  const weekend = await isWeekend(input.at, ctx.tx);

  await audit(ctx, {
    action: 'create',
    summary: `booked ${stageRow.name} with ${cand.name} on ${job.title}`,
    entityType: 'interview', entityId: interviewId, entityLabel: cand.name,
    after: {
      at: input.at.toISOString(), stage, panel, mode: input.mode,
      durationMin: input.durationMin,
    },
  }, ctx.tx);
  await emit(ctx, {
    type: 'interview.scheduled', subjectType: 'interview', subjectId: interviewId,
    payload: {
      applicationId: app.id, jobId: app.jobId, candidateId: app.candidateId,
      at: input.at.toISOString(), stage, panel, weekend,
    },
  }, ctx.tx);

  return {
    interviewId,
    candidateName: cand.name,
    jobTitle: job.title,
    title,
    at: input.at.toISOString(),
    panel,
    weekend,
    scorecards,
    invited,
  };
}

/** The confirmation the booking sheet promises the candidate. */
async function confirmationEmail(
  input: {
    applicationId: string; candidateId: string; jobId: string; jobTitle: string;
    candidateName: string; at: Date; mode: string; panel: string[];
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  const when = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh',
  }).format(input.at);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
  }).format(input.at);
  const first = input.candidateName.split(/\s+/)[0];
  const list = input.panel.length > 1
    ? `${input.panel.slice(0, -1).join(', ')} and ${input.panel[input.panel.length - 1]}`
    : (input.panel[0] ?? 'the panel');

  await queueMessage({
    channel: 'Email',
    applicationId: input.applicationId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    toName: input.candidateName,
    subject: `Confirmed: ${input.jobTitle} interview on ${when}`,
    body: `Hi ${first}, your interview is confirmed for ${when} at ${time} (${input.mode}). `
      + `You will be meeting ${list}.`,
    thread: { subjectType: 'application', subjectId: input.applicationId, title: input.jobTitle },
  }, ctx);
}

/** Move one, keeping the scorecards and re-inviting whoever is now on it. */
export async function reschedule(
  input: {
    interviewId: string; at: Date; durationMin?: number; mode?: string;
    interviewer?: string | null; panel?: string[];
    reason?: string | null; force?: boolean;
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; title: string; from: string; to: string; weekend: boolean; panel: string[] }> {
  const [iv] = await ctx.tx.select().from(interviews)
    .where(eq(interviews.id, input.interviewId)).limit(1);
  if (!iv) throw new CommandError('That interview no longer exists');
  if (iv.status === 'cancelled') throw new CommandError('That interview was cancelled', { tone: 'warn' });
  if (iv.status === 'completed') throw new CommandError('That interview has already been held', { tone: 'warn' });

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, iv.candidateId)).limit(1);
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, iv.jobId)).limit(1);
  const existing = (await ctx.tx.select().from(interviewPanel)
    .where(eq(interviewPanel.interviewId, iv.id))
    .orderBy(interviewPanel.sortOrder)).map((p) => p.name);

  const interviewer = input.interviewer !== undefined
    ? (input.interviewer?.trim() || null)
    : iv.interviewer;
  const panel = input.panel !== undefined || input.interviewer !== undefined
    ? buildPanel(interviewer, input.panel ?? existing)
    : existing;
  if (!panel.length) throw new CommandError('Who is taking it? Pick a hiring manager or name the panel');

  const duration = input.durationMin ?? iv.durationMin;
  if (duration < 5 || duration > 480) {
    throw new CommandError('An interview runs between five minutes and eight hours');
  }
  const found = await clashes({
    at: input.at, durationMin: duration, panel, exceptId: iv.id,
  }, ctx.tx);
  if (found.length && !input.force) {
    const first = found[0];
    throw new CommandError(
      `${first.who} is already with ${first.candidateName} then — move it anyway, or pick another time`,
      { code: 'clash', tone: 'warn' },
    );
  }

  const from = iv.at.toISOString();
  await ctx.tx.update(interviews).set({
    at: input.at,
    durationMin: duration,
    mode: input.mode ?? iv.mode,
    interviewer,
    status: 'scheduled',
    updatedAt: ctx.now,
  }).where(eq(interviews.id, iv.id));

  /* The panel can change on the way. Rebuild it, and move each outstanding
     scorecard with it: somebody taken off owes nothing, somebody added does. */
  const same = panel.length === existing.length
    && panel.every((n, i) => n.toLowerCase() === existing[i]?.toLowerCase());
  if (!same) {
    await ctx.tx.delete(interviewPanel).where(eq(interviewPanel.interviewId, iv.id));
    for (const [n, name] of panel.entries()) {
      await ctx.tx.insert(interviewPanel).values({
        interviewId: iv.id,
        name,
        isHiringManager: name.toLowerCase() === (interviewer ?? '').toLowerCase(),
        sortOrder: n,
      });
    }
    const keep = panel.map((n) => n.toLowerCase());
    await ctx.tx.delete(evaluations).where(and(
      eq(evaluations.interviewId, iv.id),
      eq(evaluations.submitted, false),
      sql`lower(${evaluations.evaluatorName}) <> ALL(${textArray(keep)})`,
    ));
    const held = (await ctx.tx.select({ name: evaluations.evaluatorName }).from(evaluations)
      .where(eq(evaluations.interviewId, iv.id))).map((e) => e.name.toLowerCase());
    const added = panel.filter((n) => !held.includes(n.toLowerCase()));
    if (added.length) {
      await raiseScorecards({
        interviewId: iv.id,
        applicationId: iv.applicationId,
        jobId: iv.jobId,
        candidateId: iv.candidateId,
        stage: iv.stage as StageKey,
        pipelineId: job?.pipelineId ?? null,
        panel: added,
      }, ctx);
    }
  }

  if (job) await invitePanel(job.id, job.title, panel, ctx);

  await audit(ctx, {
    action: 'update',
    summary: `moved ${iv.title} to ${input.at.toISOString().slice(0, 16).replace('T', ' ')}`,
    entityType: 'interview', entityId: iv.id, entityLabel: cand?.name ?? null,
    before: { at: from, durationMin: iv.durationMin, mode: iv.mode, panel: existing },
    after: { at: input.at.toISOString(), durationMin: duration, mode: input.mode ?? iv.mode, panel },
    reason: input.reason ?? null,
  }, ctx.tx);
  await emit(ctx, {
    type: 'interview.rescheduled', subjectType: 'interview', subjectId: iv.id,
    payload: {
      applicationId: iv.applicationId, from, to: input.at.toISOString(),
      panel, reason: input.reason ?? null,
    },
  }, ctx.tx);

  return {
    candidateName: cand?.name ?? 'the candidate',
    title: iv.title,
    from,
    to: input.at.toISOString(),
    weekend: await isWeekend(input.at, ctx.tx),
    panel,
  };
}

/**
 * Cancel one. The slot is released and the panel loses the invitation. The
 * application stays exactly where it is — cancelling an interview is not a
 * rejection.
 */
export async function cancel(
  input: { interviewId: string; reason?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; title: string }> {
  const [iv] = await ctx.tx.select().from(interviews)
    .where(eq(interviews.id, input.interviewId)).limit(1);
  if (!iv) throw new CommandError('That interview no longer exists');
  if (iv.status === 'cancelled') throw new CommandError('That interview is already cancelled', { tone: 'warn' });
  if (iv.status === 'completed') {
    throw new CommandError('That interview has already been held — it cannot be cancelled after the fact', { tone: 'warn' });
  }

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, iv.candidateId)).limit(1);

  await ctx.tx.update(interviews).set({
    status: 'cancelled',
    cancelledAt: ctx.now,
    cancelledBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
    cancelReason: input.reason ?? null,
    updatedAt: ctx.now,
  }).where(eq(interviews.id, iv.id));

  /* A scorecard nobody wrote is withdrawn; one already submitted is kept,
     because it is somebody's opinion of a real conversation. */
  await ctx.tx.delete(evaluations).where(and(
    eq(evaluations.interviewId, iv.id),
    eq(evaluations.submitted, false),
  ));

  await audit(ctx, {
    action: 'update',
    summary: `cancelled ${iv.title}${input.reason ? ` — ${input.reason}` : ''}`,
    entityType: 'interview', entityId: iv.id, entityLabel: cand?.name ?? null,
    before: { status: iv.status, at: iv.at.toISOString() },
    after: { status: 'cancelled' },
    reason: input.reason ?? null,
  }, ctx.tx);
  await emit(ctx, {
    type: 'interview.cancelled', subjectType: 'interview', subjectId: iv.id,
    payload: { applicationId: iv.applicationId, reason: input.reason ?? null, at: iv.at.toISOString() },
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate', title: iv.title };
}
