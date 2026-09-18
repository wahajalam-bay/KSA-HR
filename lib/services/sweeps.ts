import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { applications, jobStages, probationRecords, employees, files, candidates } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { storageAdapter } from '@/lib/providers';
import { env } from '@/lib/env';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SWEEPS

   Four things that nobody does and everybody assumes somebody is doing: telling
   the desk when an application has sat past its stage SLA, telling it when a
   probation is due, deleting what the retention policy says to delete, and
   re-scanning files that arrived while there was no scanner.

   Each one emits an event rather than acting directly. The automation rules
   decide what happens next, which is what makes the Settings toggles mean
   something: switch off "Flag applications sitting past stage SLA" and the
   sweep still runs, it simply stops raising anything.

   Each sweep is idempotent within its period. The SLA sweep will not tell the
   same recruiter about the same application twice on the same day, because the
   event carries a key that says which day it is.
   ═════════════════════════════════════════════════════════════════════════════*/

export type SweepCtx = Ctx & { tx: Exec; now: Date };

const day = (d: Date) => d.toISOString().slice(0, 10);

/* ── Applications past their stage SLA ───────────────────────────────────── */

export type SlaHit = {
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  stage: string;
  days: number;
  sla: number;
};

export async function slaSweep(ctx: SweepCtx, limit = 500): Promise<SlaHit[]> {
  const over = rowsOf(await ctx.tx.execute(sql`
    SELECT a.id, a.stage::text AS stage, a.job_id, a.recruiter_id,
           c.name AS candidate_name, j.title AS job_title,
           js.sla,
           floor(extract(epoch from (${ctx.now}::timestamptz - a.stage_entered_at)) / 86400)::int AS days
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
      JOIN jobs j ON j.id = a.job_id
     WHERE a.status IN ('active','on_hold')
       AND js.sla IS NOT NULL
       AND a.stage_entered_at < ${ctx.now}::timestamptz - make_interval(days => js.sla)
     ORDER BY days DESC
     LIMIT ${limit}`)) as Array<{
       id: string; stage: string; job_id: string; candidate_name: string;
       job_title: string; sla: number; days: number;
     }>;

  const hits: SlaHit[] = [];
  for (const r of over) {
    const days = Number(r.days);
    const sla = Number(r.sla);
    /* One a day per application, whatever the worker's cadence. */
    await emit(ctx, {
      type: days >= sla * 2 ? 'sla.breached' : 'sla.warning',
      subjectType: 'application',
      subjectId: r.id,
      payload: {
        applicationId: r.id, jobId: r.job_id, stage: r.stage,
        days, sla, over: days - sla,
      },
      idempotencyKey: `sla:${r.id}:${r.stage}:${day(ctx.now)}`,
    }, ctx.tx);
    hits.push({
      applicationId: r.id,
      candidateName: r.candidate_name,
      jobTitle: r.job_title,
      stage: r.stage,
      days,
      sla,
    });
  }
  return hits;
}

/* ── Probations coming up, and overdue ───────────────────────────────────── */

export type ProbationHit = {
  employeeId: string;
  name: string;
  endsOn: string;
  overdue: boolean;
};

export async function probationSweep(ctx: SweepCtx, warnDays = 14): Promise<ProbationHit[]> {
  const soon = day(new Date(ctx.now.getTime() + warnDays * 86_400_000));
  const rows = rowsOf(await ctx.tx.execute(sql`
    SELECT p.employee_id, p.ends_on::text AS ends_on, e.name
      FROM ${probationRecords} p
      JOIN ${employees} e ON e.id = p.employee_id
     WHERE p.state = 'in_progress' AND e.status <> 'left'
       AND p.ends_on <= ${soon}
     ORDER BY p.ends_on`)) as Array<{ employee_id: string; ends_on: string; name: string }>;

  const hits: ProbationHit[] = [];
  for (const r of rows) {
    const overdue = r.ends_on < day(ctx.now);
    await emit(ctx, {
      type: overdue ? 'probation.overdue' : 'probation.due',
      subjectType: 'employee',
      subjectId: r.employee_id,
      payload: { endsOn: r.ends_on, name: r.name },
      idempotencyKey: `probation:${r.employee_id}:${overdue ? 'overdue' : 'due'}:${day(ctx.now)}`,
    }, ctx.tx);
    hits.push({ employeeId: r.employee_id, name: r.name, endsOn: r.ends_on, overdue });
  }
  return hits;
}

/* ── Scorecards nobody has written ───────────────────────────────────────── */

export async function scorecardSweep(ctx: SweepCtx, afterHours = 48): Promise<number> {
  const cutoff = new Date(ctx.now.getTime() - afterHours * 3600_000);
  const rows = rowsOf(await ctx.tx.execute(sql`
    SELECT e.id, e.application_id, e.evaluator_name, i.at
      FROM evaluations e
      JOIN interviews i ON i.id = e.interview_id
     WHERE e.submitted = false
       AND i.status = 'completed'
       AND i.at < ${cutoff}
     ORDER BY i.at
     LIMIT 200`)) as Array<{
       id: string; application_id: string; evaluator_name: string; at: string;
     }>;

  for (const r of rows) {
    await emit(ctx, {
      type: 'scorecard.overdue',
      subjectType: 'evaluation',
      subjectId: r.id,
      payload: {
        applicationId: r.application_id,
        who: r.evaluator_name,
        interviewedAt: String(r.at),
      },
      idempotencyKey: `scorecard.overdue:${r.id}:${day(ctx.now)}`,
    }, ctx.tx);
  }
  return rows.length;
}

/* ── Retention ───────────────────────────────────────────────────────────── */

export type RetentionResult = { files: number; bytes: number; failed: number };

/**
 * Delete what the retention policy says to delete. The bytes go first and the
 * row is marked afterwards: a file that is gone from the store but still marked
 * present is a reporting error, while the other way round is a data-protection
 * one.
 */
export async function retentionSweep(ctx: SweepCtx, limit = 200): Promise<RetentionResult> {
  const due = rowsOf(await ctx.tx.execute(sql`
    SELECT id, storage_key, size_bytes, original_name, kind
      FROM ${files}
     WHERE deleted_at IS NULL AND retain_until IS NOT NULL AND retain_until < ${ctx.now}
     ORDER BY retain_until
     LIMIT ${limit}`)) as Array<{
       id: string; storage_key: string; size_bytes: number; original_name: string; kind: string;
     }>;

  const store = storageAdapter();
  let deleted = 0;
  let bytes = 0;
  let failed = 0;

  for (const f of due) {
    const gone = await store.delete(f.storage_key);
    if (!gone.ok && gone.reason === 'failed') { failed += 1; continue; }
    await ctx.tx.update(files)
      .set({ deletedAt: ctx.now, deletedBy: 'retention' })
      .where(eq(files.id, f.id));
    deleted += 1;
    bytes += Number(f.size_bytes);
  }

  if (deleted) {
    await audit(ctx, {
      action: 'delete',
      summary: `deleted ${deleted} file${deleted === 1 ? '' : 's'} that reached the end of their retention`,
      entityType: 'file', entityId: null,
      after: { deleted, bytes, failed },
      source: 'worker',
    }, ctx.tx);
  }
  return { files: deleted, bytes, failed };
}

/** Candidates nobody has touched since the consent window closed. */
export async function candidateRetentionSweep(
  ctx: SweepCtx, limit = 200,
): Promise<{ candidates: number }> {
  const months = env().CANDIDATE_RETENTION_MONTHS;
  const cutoff = new Date(ctx.now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  /* Only somebody with nothing live and nothing hired: a record attached to an
     employee is an employment record, not a candidate record. */
  const rows = rowsOf(await ctx.tx.execute(sql`
    SELECT c.id, c.name FROM ${candidates} c
     WHERE c.updated_at < ${cutoff}
       AND NOT EXISTS (SELECT 1 FROM ${applications} a
                        WHERE a.candidate_id = c.id
                          AND (a.status IN ('active','on_hold') OR a.status = 'hired'))
       AND NOT EXISTS (SELECT 1 FROM ${employees} e WHERE e.candidate_id = c.id)
     ORDER BY c.updated_at
     LIMIT ${limit}`)) as Array<{ id: string; name: string }>;

  for (const c of rows) {
    await emit(ctx, {
      type: 'candidate.retention_due',
      subjectType: 'candidate',
      subjectId: c.id,
      payload: { name: c.name, months },
      idempotencyKey: `retention:${c.id}:${day(ctx.now)}`,
    }, ctx.tx);
  }
  return { candidates: rows.length };
}

/* ── Everything, once ────────────────────────────────────────────────────── */

export type SweepSummary = {
  sla: number;
  probation: number;
  scorecards: number;
  filesDeleted: number;
  candidatesDue: number;
};

export async function runDailySweeps(ctx: SweepCtx): Promise<SweepSummary> {
  const sla = await slaSweep(ctx);
  const probation = await probationSweep(ctx);
  const scorecards = await scorecardSweep(ctx);
  const files = await retentionSweep(ctx);
  const cands = await candidateRetentionSweep(ctx);

  /* The daily tick itself, for rules that hang off a schedule rather than an
     event — the digest, the purge. */
  await emit(ctx, {
    type: 'schedule.daily',
    subjectType: 'schedule',
    subjectId: day(ctx.now),
    payload: { sla: sla.length, probation: probation.length, scorecards },
    idempotencyKey: `schedule.daily:${day(ctx.now)}`,
  }, ctx.tx);

  return {
    sla: sla.length,
    probation: probation.length,
    scorecards,
    filesDeleted: files.files,
    candidatesDue: cands.candidates,
  };
}

/** Monday morning: the weekly tick the digest rule listens for. */
export async function runWeeklySweeps(ctx: SweepCtx): Promise<void> {
  const monday = new Date(ctx.now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  await emit(ctx, {
    type: 'schedule.weekly',
    subjectType: 'schedule',
    subjectId: day(monday),
    payload: {},
    idempotencyKey: `schedule.weekly:${day(monday)}`,
  }, ctx.tx);
}
