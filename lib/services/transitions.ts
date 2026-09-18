import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  applications, applicationStageHistory, jobs, jobStages, candidates, evaluations,
  interviews, assessments, pitches, pitchConfig, offers, positions,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { CommandError, ConflictError } from '@/lib/commands/registry';
import { STAGE_INDEX, isEntry, FINAL_STAGE, type StageKey, type JobStage } from '@/lib/domain/stages';
import { emit, audit, type Ctx } from '@/lib/audit';

/* ═════════════════════════════════════════════════════════════════════════════
   THE TRANSITION STATE MACHINE

   Every stage change in the product goes through here: the drawer's Advance
   button, the Move to… sheet, a drag on the board, an offer being accepted, an
   automation. The board has no authority of its own — it asks, and is told yes
   or no with a reason.

   What it enforces:

     · the stage exists on this requisition's own loop;
     · the application is still live, unless the move is what closes it;
     · the final interview waits for what it is supposed to wait for — the
       behaviour test on a manager-and-above role, every earlier scorecard, and
       the sales pitch where the requisition runs one;
     · moving somebody backwards is never blocked, because a correction should
       not need a workaround;
     · the history is appended, never overwritten, with who moved them, from
       where, to where, why, and by what means.
   ═════════════════════════════════════════════════════════════════════════════*/

export type MoveSource = 'advance' | 'move' | 'drag' | 'offer' | 'automation' | 'import' | 'api';

export type MoveInput = {
  applicationId: string;
  toStage: StageKey;
  source: MoveSource;
  reason?: string | null;
  note?: string | null;
  /** Skip the gate — only the offer flow, which has its own gates. */
  bypassGate?: boolean;
  /** The version the caller read, for optimistic locking. */
  expectedVersion?: number;
  idempotencyKey?: string;
};

export type MoveResult = {
  applicationId: string;
  candidateName: string;
  fromStage: StageKey;
  toStage: StageKey;
  stageName: string;
  backwards: boolean;
  closed: boolean;
};

/* ── The gate on the final interview ─────────────────────────────────────────
   Two different reasons a final can be locked, and a requisition can have both:

     · the role is manager-and-above, so the behaviour test has to be back and
       every earlier interview has to have a submitted scorecard;
     · the requisition runs a sales pitch, and the pitch is the evidence the
       final interview builds on.

   The same function answers for the booking calendar, the scheduling sheet, the
   stage pickers and the board, so all four refuse for the same reason in the
   same words. */
export type GateCheck = { key: string; ok: boolean; text: string };
export type Gate = { ok: boolean; senior: boolean; pitch: boolean; checks: GateCheck[] };

const SENIOR_TITLE = /(^|\s|—\s)(manager|head|director|chief|vp|general manager)\b/i;

export async function finalGate(
  applicationId: string, toStage: string, exec: Exec,
): Promise<Gate> {
  if (toStage !== FINAL_STAGE) return { ok: true, senior: false, pitch: false, checks: [] };

  const r = rowsOf(await exec.execute(sql`
    SELECT a.id, j.id AS job_id, j.title, j.pitch_on, p.grade,
           (SELECT gate_final FROM ${pitchConfig} LIMIT 1) AS gate_final
      FROM ${applications} a
      JOIN ${jobs} j ON j.id = a.job_id
      LEFT JOIN ${positions} p ON p.code = j.position_code
     WHERE a.id = ${applicationId}`))[0];
  if (!r) throw new CommandError('That application no longer exists');

  const senior = /^[DM]/.test(String(r.grade ?? '')) || SENIOR_TITLE.test(String(r.title ?? ''));
  const pitchOn = !!r.pitch_on && r.gate_final !== false;
  if (!senior && !pitchOn) return { ok: true, senior, pitch: pitchOn, checks: [] };

  const checks: GateCheck[] = [];

  if (pitchOn) {
    const [p] = await exec.select({ status: pitches.status, score: pitches.score })
      .from(pitches).where(eq(pitches.applicationId, applicationId)).limit(1);
    checks.push({
      key: 'pitch',
      ok: p?.status === 'completed',
      text: p?.status === 'completed'
        ? `Sales pitch scored — ${p.score ?? '—'} of 100`
        : p && p.status !== 'not_sent'
          ? 'Sales pitch brief sent, the pitch has not been run yet'
          : 'Sales pitch brief not sent yet',
    });
  }

  if (senior) {
    const [asm] = await exec.select({ status: assessments.status, score: assessments.score, verdict: assessments.verdict })
      .from(assessments).where(eq(assessments.applicationId, applicationId)).limit(1);
    checks.unshift({
      key: 'behaviour',
      ok: asm?.status === 'completed',
      text: asm
        ? (asm.status === 'completed'
          ? `Behaviour test back — ${asm.score} of 100, ${asm.verdict}`
          : `Behaviour test ${asm.status === 'in_progress' ? 'started, not finished' : 'sent, not started'}`)
        : 'Behaviour test not sent yet',
    });

    const missing = rowsOf(await exec.execute(sql`
      SELECT DISTINCT js.name
        FROM ${interviews} i
        LEFT JOIN ${jobStages} js ON js.job_id = i.job_id AND js.stage_key = i.stage
       WHERE i.application_id = ${applicationId}
         AND i.status <> 'cancelled' AND i.at < now() AND i.stage <> ${FINAL_STAGE}
         AND NOT EXISTS (SELECT 1 FROM ${evaluations} e
                          WHERE e.application_id = i.application_id
                            AND e.stage = i.stage AND e.submitted)`));
    const past = Number(rowsOf(await exec.execute(sql`
      SELECT count(*)::int AS n FROM ${interviews}
       WHERE application_id = ${applicationId} AND status <> 'cancelled'
         AND at < now() AND stage <> ${FINAL_STAGE}`))[0]?.n ?? 0);
    checks.splice(1, 0, {
      key: 'scorecards',
      ok: missing.length === 0,
      text: missing.length
        ? `${missing.length} scorecard${missing.length === 1 ? '' : 's'} outstanding — ${list(missing.map((m) => m.name))}`
        : `Every earlier scorecard is in (${past})`,
    });
  }

  return { ok: checks.every((c) => c.ok), senior, pitch: pitchOn, checks };
}

const list = (a: string[]): string =>
  (a.length < 2 ? (a[0] ?? '—') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/* ── The move itself ─────────────────────────────────────────────────────── */
export async function moveStage(input: MoveInput, ctx: Ctx & { tx: Exec; now: Date }): Promise<MoveResult> {
  const { tx, now } = ctx;

  /* Lock the row. Two people dragging the same card at the same moment is not
     hypothetical on a board six people are looking at. */
  const [app] = await tx.select().from(applications)
    .where(eq(applications.id, input.applicationId)).for('update').limit(1);
  if (!app) throw new CommandError('That application no longer exists');

  if (input.expectedVersion != null && app.version !== input.expectedVersion) {
    throw new ConflictError();
  }

  const loop = (await tx.select().from(jobStages)
    .where(eq(jobStages.jobId, app.jobId)).orderBy(asc(jobStages.ordinal))) as unknown as JobStage[];

  const target = loop.find((s) => s.stageKey === input.toStage);
  if (!target) {
    throw new CommandError(
      `${input.toStage} is not a stage on this requisition — its loop runs ${loop.map((s) => s.name).join(' → ')}`,
    );
  }

  if (app.stage === input.toStage) {
    const [c] = await tx.select({ name: candidates.name }).from(candidates)
      .where(eq(candidates.id, app.candidateId)).limit(1);
    return {
      applicationId: app.id, candidateName: c?.name ?? '', fromStage: app.stage as StageKey,
      toStage: input.toStage, stageName: target.name, backwards: false, closed: false,
    };
  }

  if (!['active', 'on_hold'].includes(app.status) && input.source !== 'import') {
    throw new CommandError(
      app.status === 'hired'
        ? 'That candidate has already joined'
        : 'That application is closed — reopen it before moving anybody',
    );
  }

  const fromIdx = STAGE_INDEX[app.stage as StageKey] ?? -1;
  const toIdx = STAGE_INDEX[input.toStage] ?? -1;
  const backwards = toIdx < fromIdx;

  /* The gate only ever applies going forward. Moving somebody back is a
     correction, and a correction should never need a workaround. */
  if (!backwards && !input.bypassGate) {
    const gate = await finalGate(app.id, input.toStage, tx);
    if (!gate.ok) {
      const why = gate.checks.find((c) => !c.ok)!;
      throw new CommandError(
        `${target.name} is locked — ${why.text.charAt(0).toLowerCase()}${why.text.slice(1)}`,
      );
    }
  }

  const closing = input.toStage === 'joined';
  const patch: Record<string, unknown> = {
    stage: input.toStage,
    stageEnteredAt: now,
  };
  if (closing) {
    patch.status = 'hired';
    patch.closedAt = now;
    patch.startDate = app.startDate ?? new Date(now.getTime() + 45 * 86_400_000).toISOString().slice(0, 10);
  }

  await tx.update(applications).set(patch).where(eq(applications.id, app.id));

  await tx.insert(applicationStageHistory).values({
    applicationId: app.id,
    fromStage: app.stage,
    toStage: input.toStage,
    fromStatus: app.status,
    toStatus: closing ? 'hired' : app.status,
    at: now,
    actorId: ctx.viewer.staffId ?? ctx.viewer.accountId,
    actorName: ctx.viewer.name,
    source: input.source,
    reason: input.reason ?? null,
    note: input.note ?? null,
    metadata: { backwards },
    idempotencyKey: input.idempotencyKey ?? null,
    seq: 0,   // the database assigns it
  });

  if (closing) {
    /* `filled` is what every list shows, so it moves with the hire rather than
       being recomputed by a nightly job. */
    await tx.update(jobs)
      .set({ filled: sql`${jobs.filled} + 1` })
      .where(eq(jobs.id, app.jobId));
  }

  const [c] = await tx.select({ name: candidates.name }).from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  const name = c?.name ?? 'The candidate';

  await audit(ctx, {
    action: 'update',
    summary: closing ? `marked ${name} as joined` : `moved ${name} to ${target.name}`,
    entityType: 'application', entityId: app.id, entityLabel: name,
    before: { stage: app.stage, status: app.status },
    after: { stage: input.toStage, status: closing ? 'hired' : app.status },
    reason: input.reason ?? null,
  }, tx);

  await emit(ctx, {
    type: closing ? 'application.hired' : 'application.stage_changed',
    subjectType: 'application', subjectId: app.id,
    payload: {
      jobId: app.jobId, candidateId: app.candidateId,
      fromStage: app.stage, toStage: input.toStage, backwards, source: input.source,
    },
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:event` : undefined,
  }, tx);

  return {
    applicationId: app.id, candidateName: name, fromStage: app.stage as StageKey,
    toStage: input.toStage, stageName: target.name, backwards, closed: closing,
  };
}

/* ── Closing an application without a hire ─────────────────────────────────
   Rejection is a status, not a tenth column: the application keeps the stage it
   reached, so the conversion maths stays honest about where people actually
   fall out. */
export const DISQUALIFY_REASONS = [
  'Salary expectation above band',
  'Failed technical assessment',
  'Better candidate progressed',
  'Insufficient KSA market experience',
  'Communication not at required level',
  'No Arabic — required for the role',
  'Unresponsive after 3 attempts',
  'Notice period too long',
  'Withdrew — accepted another offer',
  'Position closed',
];

export async function closeApplication(
  applicationId: string, reason: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; status: 'rejected' | 'withdrawn' }> {
  const { tx, now } = ctx;
  const [app] = await tx.select().from(applications)
    .where(eq(applications.id, applicationId)).for('update').limit(1);
  if (!app) throw new CommandError('That application no longer exists');
  if (!['active', 'on_hold'].includes(app.status)) {
    throw new CommandError('That application is already closed');
  }

  const status = reason.startsWith('Withdrew') ? 'withdrawn' as const : 'rejected' as const;
  await tx.update(applications)
    .set({ status, disqualifyReason: reason, closedAt: now })
    .where(eq(applications.id, applicationId));

  await tx.insert(applicationStageHistory).values({
    applicationId, fromStage: app.stage, toStage: app.stage,
    fromStatus: app.status, toStatus: status, at: now,
    actorId: ctx.viewer.staffId ?? ctx.viewer.accountId, actorName: ctx.viewer.name,
    source: 'action', reason, metadata: { close: true }, seq: 0,
  });

  const [c] = await tx.select({ name: candidates.name }).from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  const name = c?.name ?? 'The candidate';

  await audit(ctx, {
    action: 'update', summary: `disqualified ${name} — ${reason.toLowerCase()}`,
    entityType: 'application', entityId: applicationId, entityLabel: name,
    before: { status: app.status }, after: { status }, reason,
  }, tx);
  await emit(ctx, {
    type: status === 'withdrawn' ? 'application.withdrawn' : 'application.rejected',
    subjectType: 'application', subjectId: applicationId,
    payload: { jobId: app.jobId, candidateId: app.candidateId, stage: app.stage, reason },
  }, tx);

  return { name, status };
}
