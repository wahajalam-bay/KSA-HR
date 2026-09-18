import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  jobs, applications, applicationStageHistory, candidates, departments, locations, staff,
  evaluations, interviews, offers, tasks, goals, screenings,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_KEYS, STAGE_INDEX, DEFAULT_NAMES, stageBand, type StageKey } from '@/lib/domain/stages';
import {
  buckets, bucketTarget, previous, startOf, endOf, monthKeys,
  type Bucket, type Window,
} from '@/lib/domain/window';

/* ═════════════════════════════════════════════════════════════════════════════
   THE OVERVIEW

   The morning screen: are we hiring fast enough, what is stuck, and what do I
   do next — in that order. Every number on it is scoped to what the account may
   see and derived from the records; nothing here is stored as a dashboard
   figure, because a stored figure is a figure that can be wrong.

   The period control at the top moves almost all of it. The exception is the
   "needs you today" panel, which is deliberately the state of play now: a
   thing that is stuck does not become unstuck because you changed the dates.
   ═════════════════════════════════════════════════════════════════════════════*/

const med = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number): number => (b ? a / b : 0);

/* ── The pipeline of a period ───────────────────────────────────────────────
   Everyone who was in play at any point between the two dates: they had applied
   by the end of it and had not been closed before it started. Each is counted at
   the stage they had reached by the end of the period — or the stage they left
   from, if they dropped out inside it. This is what moves when the dates at the
   top of the Overview change, and it is why the card can say "still live today"
   as a separate number from the period's total. */
export type InPlayRow = { stage: StageKey; live: boolean; left: boolean };

async function inPlay(v: Viewer, from: string, to: string, exec: Exec): Promise<InPlayRow[]> {
  return rowsOf(await exec.execute(sql`
    SELECT
      coalesce(
        (SELECT h.to_stage::text FROM ${applicationStageHistory} h
          WHERE h.application_id = a.id
            AND h.at::date <= (CASE WHEN a.closed_at IS NOT NULL AND a.closed_at::date < ${to}::date
                                    THEN a.closed_at::date ELSE ${to}::date END)
          ORDER BY h.at::date DESC, h.seq DESC LIMIT 1),
        a.stage::text) AS stage,
      (a.status IN ('active','on_hold')
        AND (a.closed_at IS NULL OR a.closed_at::date > ${to}::date)) AS live,
      (a.closed_at IS NOT NULL AND a.closed_at::date <= ${to}::date) AS left
      FROM ${applications} a
     WHERE a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})
       AND a.applied_at::date <= ${to}::date
       AND (a.closed_at IS NULL OR a.closed_at::date >= ${from}::date)`))
    .map((r) => ({ stage: r.stage as StageKey, live: !!r.live, left: !!r.left }));
}

/* ── What is stuck, right now ───────────────────────────────────────────── */
export type Health = {
  over: Array<{ id: string; name: string; jobId: string; jobTitle: string; stageName: string; days: number; sla: number }>;
  overCount: number;
  noFeedback: Array<{ applicationId: string; candidateName: string; evaluatorName: string; stageName: string; interviewedAt: string | null }>;
  noFeedbackCount: number;
  stale: Array<{ id: string; name: string; jobTitle: string; stageName: string; since: string; days: number }>;
  staleCount: number;
  offersOut: Array<{ applicationId: string; name: string; jobTitle: string; sentAt: string; baseMonthly: number; state: string }>;
  offersOutCount: number;
  old90: Array<{ id: string; title: string; deptName: string; days: number; filled: number; openings: number; live: number; recruiter: Person | null }>;
  old90Count: number;
  atRisk: Array<{ id: string; title: string; deptName: string; city: string; days: number; live: number; filled: number; openings: number; recruiter: Person | null }>;
  unfilled: number;
};

export type Person = { id: string; name: string; photo: string | null; hue: number };

async function health(v: Viewer, now: Date, exec: Exec): Promise<Health> {
  const scoped = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;

  const [overRows, feedbackRows, staleRows, offerRows, jobRows] = await Promise.all([
    exec.execute(sql`
      SELECT a.id, c.name, a.job_id, j.title AS job_title, js.name AS stage_name, js.sla,
             EXTRACT(EPOCH FROM (${at(now)} - a.stage_entered_at)) / 86400 AS days
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
        LEFT JOIN LATERAL (
          SELECT name, sla FROM job_stages s
           WHERE s.job_id = a.job_id AND s.stage_key = a.stage) js ON true
       WHERE a.status IN ('active','on_hold') AND ${scoped}
         AND ${at(now)} - a.stage_entered_at > (coalesce(js.sla, 5) || ' days')::interval
       ORDER BY (EXTRACT(EPOCH FROM (${at(now)} - a.stage_entered_at)) / 86400) - coalesce(js.sla, 5) DESC`),

    exec.execute(sql`
      SELECT e.application_id, c.name AS candidate_name, e.evaluator_name, js.name AS stage_name,
             (SELECT max(i.at) FROM ${interviews} i
               WHERE i.application_id = e.application_id AND i.stage = e.stage) AS interviewed_at
        FROM ${evaluations} e
        JOIN ${applications} a ON a.id = e.application_id
        JOIN ${candidates} c ON c.id = a.candidate_id
        LEFT JOIN LATERAL (
          SELECT name FROM job_stages s WHERE s.job_id = a.job_id AND s.stage_key = e.stage) js ON true
       WHERE NOT e.submitted AND ${scoped}
       ORDER BY interviewed_at ASC NULLS LAST`),

    exec.execute(sql`
      SELECT a.id, c.name, j.title AS job_title, js.name AS stage_name,
             a.stage_entered_at AS since,
             EXTRACT(EPOCH FROM (${at(now)} - a.stage_entered_at)) / 86400 AS days
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
        LEFT JOIN LATERAL (
          SELECT name FROM job_stages s WHERE s.job_id = a.job_id AND s.stage_key = a.stage) js ON true
       WHERE a.status IN ('active','on_hold') AND ${scoped}
         AND ${at(now)} - a.stage_entered_at > interval '14 days'
       ORDER BY a.stage_entered_at ASC`),

    exec.execute(sql`
      SELECT o.application_id, c.name, j.title AS job_title, o.sent_at, o.base_monthly, o.state::text AS state
        FROM ${offers} o
        JOIN ${applications} a ON a.id = o.application_id
        JOIN ${candidates} c ON c.id = o.candidate_id
        JOIN ${jobs} j ON j.id = o.job_id
       WHERE o.state IN ('sent','viewed') AND ${scoped}
       ORDER BY o.sent_at ASC`),

    exec.execute(sql`
      SELECT j.id, j.title, j.openings, j.filled, j.opened_on, d.name AS dept_name, l.city,
             EXTRACT(EPOCH FROM (${at(now)} - j.opened_on::timestamptz)) / 86400 AS days,
             s.id AS rec_id, s.name AS rec_name, s.photo AS rec_photo, s.hue AS rec_hue,
             (SELECT count(*) FROM ${applications} a
               WHERE a.job_id = j.id AND a.status IN ('active','on_hold'))::int AS live
        FROM ${jobs} j
        JOIN ${departments} d ON d.id = j.dept_id
        JOIN ${locations} l ON l.id = j.location_id
        LEFT JOIN ${staff} s ON s.id = j.recruiter_id
       WHERE j.status = 'open' AND ${jobScopeSql(v, 'j')}`),
  ]);

  const over = rowsOf(overRows).map((r) => ({
    id: r.id, name: r.name, jobId: r.job_id, jobTitle: r.job_title,
    stageName: r.stage_name ?? r.stage, days: Number(r.days), sla: Number(r.sla ?? 5),
  }));
  const noFeedback = rowsOf(feedbackRows).map((r) => ({
    applicationId: r.application_id, candidateName: r.candidate_name,
    evaluatorName: r.evaluator_name, stageName: r.stage_name ?? '',
    interviewedAt: r.interviewed_at ? String(r.interviewed_at) : null,
  }));
  const stale = rowsOf(staleRows).map((r) => ({
    id: r.id, name: r.name, jobTitle: r.job_title, stageName: r.stage_name ?? '',
    since: String(r.since), days: Number(r.days),
  }));
  const offersOut = rowsOf(offerRows).map((r) => ({
    applicationId: r.application_id, name: r.name, jobTitle: r.job_title,
    sentAt: String(r.sent_at), baseMonthly: Number(r.base_monthly), state: r.state,
  }));

  const open = rowsOf(jobRows).map((r) => ({
    id: r.id, title: r.title, deptName: r.dept_name, city: r.city,
    days: Number(r.days), live: Number(r.live), filled: Number(r.filled), openings: Number(r.openings),
    recruiter: r.rec_id
      ? { id: r.rec_id, name: r.rec_name, photo: r.rec_photo, hue: Number(r.rec_hue ?? 3) }
      : null,
  }));

  /* At risk: open more than ninety days, or holding fewer than two live
     candidates for every opening. Both are about the same thing — a seat that
     is not going to be filled unless somebody does something. */
  const atRisk = open.filter((j) => j.live < j.openings * 2 || j.days > 90);
  const old90 = [...open.filter((j) => j.days > 90)].sort((a, b) => b.days - a.days);

  return {
    over: over.slice(0, 3), overCount: over.length,
    noFeedback: noFeedback.slice(0, 3), noFeedbackCount: noFeedback.length,
    stale: stale.filter((s) => !over.slice(0, 3).some((o) => o.id === s.id)).slice(0, 3),
    staleCount: stale.length,
    offersOut: offersOut.slice(0, 3), offersOutCount: offersOut.length,
    old90: old90.slice(0, 3), old90Count: old90.length,
    atRisk: [...atRisk].sort((a, b) => b.days - a.days),
    unfilled: open.filter((j) => j.filled < j.openings).length,
  };
}

/* ── Everything the Overview draws ──────────────────────────────────────── */
export type OverviewData = Awaited<ReturnType<typeof overview>>;

export async function overview(v: Viewer, w: Window, now: Date, exec: Exec = db()) {
  const scope = jobScopeSql(v);
  /* The same predicate for the subqueries that alias the table `j`. It names
     columns, so the name it qualifies them with has to be the one in scope. */
  const scopeJ = jobScopeSql(v, 'j');
  const scopedApps = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${scope})`;
  const from = startOf(w, now);
  const to = endOf(w, now);
  const prev = previous(w, now);
  const bks = buckets(w, now);

  const [
    headRow, goalRows, bucketRows, playRows, h,
    funnelRows, liveStage, deptRows, sourceRows, teamRows,
    agendaRows, taskRows, joinerRows, extraRows,
  ] = await Promise.all([
    /* One row of headline numbers for the period and the one before it. */
    exec.execute(sql`
      WITH win AS (SELECT ${from}::date AS f, ${to}::date AS t),
           pre AS (SELECT ${prev.kind === 'range' ? prev.from : from}::date AS f,
                          ${prev.kind === 'range' ? prev.to : to}::date AS t)
      SELECT
        (SELECT count(*) FROM ${jobs} WHERE status = 'open' AND ${scope})::int AS open_jobs,
        (SELECT coalesce(sum(openings), 0) FROM ${jobs} WHERE status = 'open' AND ${scope})::int AS openings,
        (SELECT coalesce(sum(greatest(0, openings - filled)), 0) FROM ${jobs}
          WHERE status = 'open' AND ${scope})::int AS seats,
        (SELECT count(*) FROM ${applications} a, win
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN win.f AND win.t)::int AS hires,
        (SELECT count(*) FROM ${applications} a, pre
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN pre.f AND pre.t)::int AS hires_prev,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (a.closed_at - a.applied_at)) / 86400)
           FROM ${applications} a, win
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN win.f AND win.t) AS tth,
        (SELECT count(*) FROM ${applications} a, win
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN win.f AND win.t
            AND a.closed_at IS NOT NULL)::int AS tth_n,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (a.closed_at - a.applied_at)) / 86400)
           FROM ${applications} a, pre
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN pre.f AND pre.t) AS tth_prev,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (a.closed_at - j.opened_on::timestamptz)) / 86400)
           FROM ${applications} a JOIN ${jobs} j ON j.id = a.job_id, win
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN win.f AND win.t
            AND a.closed_at > j.opened_on::timestamptz) AS ttf,
        (SELECT count(*) FROM ${applications} a JOIN ${jobs} j ON j.id = a.job_id, win
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN win.f AND win.t
            AND a.closed_at > j.opened_on::timestamptz)::int AS ttf_n,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (a.closed_at - j.opened_on::timestamptz)) / 86400)
           FROM ${applications} a JOIN ${jobs} j ON j.id = a.job_id, pre
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at::date BETWEEN pre.f AND pre.t
            AND a.closed_at > j.opened_on::timestamptz) AS ttf_prev,
        (SELECT count(*) FROM ${applications} a, win
          WHERE ${scopedApps} AND a.applied_at::date BETWEEN win.f AND win.t)::int AS apps,
        (SELECT count(*) FROM ${applications} a, pre
          WHERE ${scopedApps} AND a.applied_at::date BETWEEN pre.f AND pre.t)::int AS apps_prev,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id, win
          WHERE ${scopedApps} AND o.sent_at::date BETWEEN win.f AND win.t
            AND o.state IN ('accepted','signed'))::int AS off_yes,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id, win
          WHERE ${scopedApps} AND o.sent_at::date BETWEEN win.f AND win.t
            AND o.state = 'declined')::int AS off_no,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id, pre
          WHERE ${scopedApps} AND o.sent_at::date BETWEEN pre.f AND pre.t
            AND o.state IN ('accepted','signed'))::int AS off_yes_prev,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id, pre
          WHERE ${scopedApps} AND o.sent_at::date BETWEEN pre.f AND pre.t
            AND o.state = 'declined')::int AS off_no_prev,
        (SELECT count(*) FROM ${jobs} WHERE status = 'open' AND ${scope}
           AND opened_on::date BETWEEN ${from}::date AND ${to}::date)::int AS opened,
        (SELECT avg(x.q) FROM (
           SELECT (SELECT avg(e.overall) FROM ${evaluations} e
                    WHERE e.application_id = a.id AND e.overall IS NOT NULL) AS q
             FROM ${applications} a, win
            WHERE ${scopedApps} AND a.status = 'hired'
              AND a.closed_at::date BETWEEN win.f AND win.t) x WHERE x.q IS NOT NULL) AS quality,
        (SELECT avg(x.q) FROM (
           SELECT (SELECT avg(e.overall) FROM ${evaluations} e
                    WHERE e.application_id = a.id AND e.overall IS NOT NULL) AS q
             FROM ${applications} a, pre
            WHERE ${scopedApps} AND a.status = 'hired'
              AND a.closed_at::date BETWEEN pre.f AND pre.t) x WHERE x.q IS NOT NULL) AS quality_prev`),

    exec.select().from(goals),

    /* Each bucket of the period: what arrived, what closed, what was offered. */
    exec.execute(sql`
      WITH b(key, s, e) AS (VALUES ${sql.join(
        bks.map((x) => sql`(${x.key}::text, ${x.start}::timestamptz, ${x.end}::timestamptz)`), sql`, `)})
      SELECT b.key,
        (SELECT count(*) FROM ${applications} a
          WHERE ${scopedApps} AND a.applied_at >= b.s AND a.applied_at < b.e)::int AS applications,
        (SELECT count(*) FROM ${applications} a
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at >= b.s AND a.closed_at < b.e)::int AS hires,
        (SELECT count(*) FROM ${interviews} i
          WHERE i.status <> 'cancelled' AND i.at >= b.s AND i.at < b.e
            AND i.job_id IN (SELECT id FROM ${jobs} WHERE ${scope}))::int AS interviews,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id
          WHERE ${scopedApps} AND o.sent_at >= b.s AND o.sent_at < b.e)::int AS offers_sent,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id
          WHERE ${scopedApps} AND o.sent_at >= b.s AND o.sent_at < b.e
            AND o.state IN ('accepted','signed'))::int AS off_yes,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id
          WHERE ${scopedApps} AND o.sent_at >= b.s AND o.sent_at < b.e
            AND o.state = 'declined')::int AS off_no,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (a.closed_at - a.applied_at)) / 86400)
           FROM ${applications} a
          WHERE ${scopedApps} AND a.status = 'hired'
            AND a.closed_at >= b.s AND a.closed_at < b.e) AS time_to_hire
      FROM b`),

    inPlay(v, from, to, exec),
    health(v, now, exec),

    /* The funnel of the cohort that arrived inside the period. */
    exec.execute(sql`
      SELECT a.id, a.status::text AS status,
             array_agg(DISTINCT h.to_stage::text) AS reached
        FROM ${applications} a
        LEFT JOIN ${applicationStageHistory} h ON h.application_id = a.id
       WHERE ${scopedApps} AND a.applied_at::date BETWEEN ${from}::date AND ${to}::date
       GROUP BY a.id, a.status`),

    exec.execute(sql`
      SELECT a.stage::text AS stage, count(*)::int AS n
        FROM ${applications} a
       WHERE ${scopedApps} AND a.status IN ('active','on_hold')
       GROUP BY 1`),

    exec.execute(sql`
      SELECT d.id, d.name, d.head,
        (SELECT count(*) FROM ${jobs} j
          WHERE j.dept_id = d.id AND j.status = 'open' AND ${scopeJ})::int AS open_reqs,
        (SELECT coalesce(sum(j.openings), 0) FROM ${jobs} j
          WHERE j.dept_id = d.id AND j.status = 'open' AND ${scopeJ})::int AS openings,
        (SELECT count(*) FROM ${applications} a JOIN ${jobs} j ON j.id = a.job_id
          WHERE j.dept_id = d.id AND a.status IN ('active','on_hold') AND ${scopedApps})::int AS live,
        (SELECT count(*) FROM ${applications} a JOIN ${jobs} j ON j.id = a.job_id
          WHERE j.dept_id = d.id AND a.status = 'hired' AND ${scopedApps}
            AND a.closed_at::date BETWEEN ${from}::date AND ${to}::date)::int AS hires
      FROM ${departments} d
     WHERE d.archived_at IS NULL`),

    exec.execute(sql`
      SELECT a.source, count(*)::int AS applications,
             count(*) FILTER (WHERE a.status = 'hired')::int AS hires
        FROM ${applications} a
       WHERE ${scopedApps} AND a.applied_at::date BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1 ORDER BY 2 DESC`),

    exec.execute(sql`
      SELECT s.id, s.name, s.photo, s.hue, s.role::text AS role, s.monthly_target,
             (SELECT count(*) FROM ${applications} a
               WHERE a.recruiter_id = s.id AND a.status = 'hired'
                 AND a.closed_at::date BETWEEN ${from}::date AND ${to}::date
                 AND ${scopedApps})::int AS hires
        FROM ${staff} s WHERE s.status <> 'deleted' ORDER BY s.name`),

    exec.execute(sql`
      SELECT i.id, i.title, i.at, i.mode, i.duration_min, i.status::text AS status,
             i.interviewer, j.title AS job_title, i.application_id,
             (SELECT array_agg(p.name ORDER BY p.sort_order)
                FROM interview_panel p WHERE p.interview_id = i.id) AS panel
        FROM ${interviews} i
        JOIN ${jobs} j ON j.id = i.job_id
       WHERE i.at >= ${at(now)} AND i.job_id IN (SELECT id FROM ${jobs} WHERE ${scope})
       ORDER BY i.at ASC LIMIT 8`),

    exec.execute(sql`
      SELECT t.id, t.title, t.kind::text AS kind, t.due_on::date::text AS due_on, t.done,
             t.priority::text AS priority, t.application_id, j.title AS job_title
        FROM ${tasks} t LEFT JOIN ${jobs} j ON j.id = t.job_id
       WHERE t.assignee_id = ${v.staffId ?? null}
       ORDER BY t.due_on ASC`),

    exec.execute(sql`
      SELECT a.id, a.start_date::text AS start_date, c.name, c.photo, c.hue,
             j.title AS job_title, d.name AS dept_name
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
        JOIN ${departments} d ON d.id = j.dept_id
       WHERE a.status = 'hired' AND a.start_date IS NOT NULL
         AND a.start_date >= ${at(now)}::date AND ${scopedApps}
       ORDER BY a.start_date ASC LIMIT 5`),

    exec.execute(sql`
      SELECT
        (SELECT count(*) FROM ${offers} o WHERE o.state IN ('sent','viewed','signed'))::int AS offers_in_flight,
        (SELECT count(*) FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id
          WHERE o.state = 'approved' AND o.verified_at IS NULL
            AND a.status NOT IN ('rejected','withdrawn'))::int AS letter_queue,
        (SELECT count(*) FROM ${jobs} WHERE status = 'pending_approval' AND ${scope})::int AS awaiting_approval,
        (SELECT count(*) FROM ${screenings} s JOIN ${applications} a ON a.id = s.application_id
          WHERE s.status = 'completed' AND s.verdict <> 'fail'
            AND a.status IN ('active','on_hold') AND a.stage IN ('applied','sourced')
            AND ${scopedApps})::int AS screened_waiting,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.d) FROM (
           SELECT EXTRACT(EPOCH FROM (h2.at - h1.at)) / 86400 AS d
             FROM ${applications} a
             JOIN ${applicationStageHistory} h1 ON h1.application_id = a.id AND h1.seq = 1
             JOIN ${applicationStageHistory} h2 ON h2.application_id = a.id AND h2.seq = 2
            WHERE ${scopedApps} AND a.applied_at::date BETWEEN ${from}::date AND ${to}::date) x) AS tfr,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.d) FROM (
           SELECT EXTRACT(EPOCH FROM (h2.at - h1.at)) / 86400 AS d
             FROM ${applications} a
             JOIN ${applicationStageHistory} h1 ON h1.application_id = a.id AND h1.seq = 1
             JOIN ${applicationStageHistory} h2 ON h2.application_id = a.id AND h2.seq = 2
            WHERE ${scopedApps}
              AND a.applied_at::date BETWEEN ${prev.kind === 'range' ? prev.from : from}::date
                                         AND ${prev.kind === 'range' ? prev.to : to}::date) x) AS tfr_prev`),
  ]);

  const head = rowsOf(headRow)[0] ?? {};
  const n = (x: unknown) => (x == null ? null : Number(x));

  const goalBy: Record<string, number> = {};
  for (const g of goalRows) goalBy[g.month] = g.hires;

  const bucketList = bks.map((b: Bucket) => {
    const r = rowsOf(bucketRows).find((x) => x.key === b.key) ?? {};
    const yes = Number(r.off_yes ?? 0), no = Number(r.off_no ?? 0);
    return {
      ...b,
      applications: Number(r.applications ?? 0),
      hires: Number(r.hires ?? 0),
      interviews: Number(r.interviews ?? 0),
      offersSent: Number(r.offers_sent ?? 0),
      offerAccept: pct(yes, yes + no || 1),
      timeToHire: Number(r.time_to_hire ?? 0),
      target: bucketTarget(b, goalBy),
    };
  });

  /* The plan the "Hires" tile compares against: the monthly goals for as many
     months as the period spans, which is how the product has always read it. */
  const months = Math.max(1, Math.round(w.days / 30.4));
  const plan = sum(monthKeys(months, now).map((k) => goalBy[k] ?? 0));

  /* The funnel: who entered each stage, and the share who went further. */
  const FKEYS: StageKey[] = ['applied', 'screen', 'iv1', 'iv2', 'ivf', 'offer', 'joined'];
  const entered: Record<string, number> = {};
  const passed: Record<string, number> = {};
  for (const k of FKEYS) { entered[k] = 0; passed[k] = 0; }
  const cohort = rowsOf(funnelRows);
  for (const r of cohort) {
    const reached = new Set<string>((r.reached ?? []).filter(Boolean)
      .map((s: string) => (s === 'sourced' ? 'applied' : s)));
    const maxIdx = Math.max(
      ...[...reached].map((k) => STAGE_INDEX[k as StageKey] ?? -1),
      r.status === 'hired' ? STAGE_INDEX.joined : -1,
    );
    for (const k of FKEYS) {
      if (!reached.has(k)) continue;
      entered[k] += 1;
      if (maxIdx > STAGE_INDEX[k]) passed[k] += 1;
    }
  }
  const funnel = FKEYS.map((k) => ({
    key: k,
    name: k === 'applied' ? 'Applied or sourced' : DEFAULT_NAMES[k],
    n: entered[k],
    convFromPrev: k === 'joined' ? null : pct(passed[k], entered[k] || 1),
    convFromTop: pct(entered[k], entered[FKEYS[0]] || 1),
  }));

  const liveByStage = Object.fromEntries(rowsOf(liveStage).map((r) => [r.stage, Number(r.n)]));
  const distribution = STAGE_KEYS.map((k) => ({
    key: k, name: DEFAULT_NAMES[k], short: SHORT[k], n: liveByStage[k] ?? 0, band: stageBand(STAGE_INDEX[k]),
  }));

  const depts = rowsOf(deptRows)
    .map((r) => ({
      id: r.id, name: r.name, head: r.head,
      openReqs: Number(r.open_reqs), openings: Number(r.openings),
      live: Number(r.live), hires: Number(r.hires),
    }))
    .sort((a, b) => b.openReqs - a.openReqs);

  const sources = rowsOf(sourceRows).map((r) => ({
    source: r.source, applications: Number(r.applications), hires: Number(r.hires),
    conv: pct(Number(r.hires), Number(r.applications) || 1),
  }));

  const team = rowsOf(teamRows).map((r) => ({
    id: r.id, name: r.name, photo: r.photo, hue: Number(r.hue ?? 3), role: r.role,
    monthlyTarget: Number(r.monthly_target ?? 0), hires: Number(r.hires),
  }));

  const play = playRows;
  const extra = rowsOf(extraRows)[0] ?? {};

  return {
    window: w,
    now,
    from, to,
    open: { count: Number(head.open_jobs ?? 0), openings: Number(head.openings ?? 0), seats: Number(head.seats ?? 0), opened: Number(head.opened ?? 0) },
    hires: { n: Number(head.hires ?? 0), prev: Number(head.hires_prev ?? 0), plan, months },
    timeToHire: { median: n(head.tth) ?? 0, n: Number(head.tth_n ?? 0), prev: n(head.tth_prev) ?? 0 },
    timeToFill: { median: n(head.ttf) ?? 0, n: Number(head.ttf_n ?? 0), prev: n(head.ttf_prev) ?? 0 },
    applications: { n: Number(head.apps ?? 0), prev: Number(head.apps_prev ?? 0) },
    offers: {
      yes: Number(head.off_yes ?? 0), no: Number(head.off_no ?? 0),
      rate: Number(head.off_yes ?? 0) + Number(head.off_no ?? 0)
        ? Number(head.off_yes) / (Number(head.off_yes) + Number(head.off_no)) : null,
      prevRate: Number(head.off_yes_prev ?? 0) + Number(head.off_no_prev ?? 0)
        ? Number(head.off_yes_prev) / (Number(head.off_yes_prev) + Number(head.off_no_prev)) : null,
      inFlight: Number(extra.offers_in_flight ?? 0),
      letterQueue: Number(extra.letter_queue ?? 0),
    },
    quality: { mean: n(head.quality), prev: n(head.quality_prev) },
    firstResponse: { median: n(extra.tfr) ?? 0, prev: n(extra.tfr_prev) ?? 0 },
    inPlay: {
      rows: play,
      total: play.length,
      live: play.filter((r) => r.live).length,
    },
    buckets: bucketList,
    health: h,
    funnel,
    distribution,
    depts,
    sources,
    team,
    awaitingApproval: Number(extra.awaiting_approval ?? 0),
    screenedWaiting: Number(extra.screened_waiting ?? 0),
    agenda: rowsOf(agendaRows).map((r) => ({
      id: r.id, title: r.title, at: String(r.at), mode: r.mode,
      durationMin: Number(r.duration_min), status: r.status,
      jobTitle: r.job_title, applicationId: r.application_id,
      panel: (r.panel ?? []).filter(Boolean) as string[],
    })),
    tasks: rowsOf(taskRows).map((r) => ({
      id: r.id, title: r.title, kind: r.kind, dueOn: r.due_on, done: r.done,
      priority: r.priority, applicationId: r.application_id, jobTitle: r.job_title,
    })),
    joiners: rowsOf(joinerRows).map((r) => ({
      applicationId: r.id, startDate: r.start_date, name: r.name,
      photo: r.photo, hue: Number(r.hue ?? 3), jobTitle: r.job_title, deptName: r.dept_name,
    })),
  };
}

const SHORT: Record<StageKey, string> = {
  applied: 'App', sourced: 'Src', screen: 'Screen', assessment: 'Assess', iv1: 'IV 1',
  iv2: 'IV 2', pitch: 'Pitch', ivf: 'IV 3', offer: 'Offer', joined: 'Joined',
};

export { med, sum, pct };
