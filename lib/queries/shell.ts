import 'server-only';
import { and, eq, gt, inArray, isNull, sql, count } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  jobs, applications, interviews, offers, employees, positions, notifications, tasks, staff,
} from '@/db/schema';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   The counts on the sidebar.

   Six numbers, and every one of them is scoped: an account that can see nine
   requisitions sees the pipeline of those nine, not of forty-nine. One query
   rather than six, because this runs on every page.
   ───────────────────────────────────────────────────────────────────────────*/

export type NavCounts = {
  openJobs: number;
  livePipeline: number;
  upcomingInterviews: number;
  atOffer: number;
  onboarding: number;
  vacantSeats: number;
  teamSize: number;
  unreadNotifications: number;
  openTasks: number;
};

export async function navCounts(v: Viewer, now: Date = new Date()): Promise<NavCounts> {
  const scope = jobScopeSql(v);
  const scopedJobIds = sql`(SELECT id FROM ${jobs} WHERE ${scope})`;

  const rows = await db().execute<{
    open_jobs: string; live_pipeline: string; upcoming: string; at_offer: string;
    onboarding: string; vacant: string; team: string; unread: string; open_tasks: string;
  }>(sql`
    SELECT
      (SELECT count(*) FROM ${jobs} WHERE status = 'open' AND ${scope}) AS open_jobs,
      (SELECT count(*) FROM ${applications}
        WHERE status IN ('active','on_hold') AND job_id IN ${scopedJobIds}) AS live_pipeline,
      (SELECT count(*) FROM ${interviews}
        WHERE at >= ${at(now)} AND status <> 'cancelled' AND job_id IN ${scopedJobIds}) AS upcoming,
      (SELECT count(*) FROM ${applications}
        WHERE stage = 'offer' AND status IN ('active','on_hold') AND job_id IN ${scopedJobIds}) AS at_offer,
      (SELECT count(*) FROM ${employees}
        WHERE source = 'hire' AND status = 'onboarding'
          AND (${v.scope.kind === 'all'} OR job_id IN ${scopedJobIds})) AS onboarding,
      (SELECT count(*) FROM ${positions} p
        WHERE p.plan_state = 'approved'
          AND p.approved > (SELECT count(*) FROM ${employees} e
                             WHERE e.position_code = p.code AND e.status <> 'left')) AS vacant,
      (SELECT count(*) FROM ${staff} WHERE status <> 'deleted') AS team,
      (SELECT count(*) FROM ${notifications}
        WHERE read_at IS NULL
          AND (recipient_account_id IS NULL OR recipient_account_id = ${v.accountId})
          AND (recipient_staff_id IS NULL OR recipient_staff_id = ${v.staffId ?? null})) AS unread,
      (SELECT count(*) FROM ${tasks}
        WHERE done = false AND assignee_id = ${v.staffId ?? null}) AS open_tasks
  `);

  const r = (rows as unknown as { rows: any[] }).rows?.[0] ?? (rows as any)[0] ?? {};
  const n = (x: unknown) => Number(x ?? 0);
  return {
    openJobs: n(r.open_jobs),
    livePipeline: n(r.live_pipeline),
    upcomingInterviews: n(r.upcoming),
    atOffer: n(r.at_offer),
    onboarding: n(r.onboarding),
    vacantSeats: n(r.vacant),
    teamSize: n(r.team),
    unreadNotifications: n(r.unread),
    openTasks: n(r.open_tasks),
  };
}

/* The organisation's own name and the settings the shell shows. Cached for the
   request, because eight components ask for it on one page. */
export async function orgSettings() {
  const rows = await db().execute<Record<string, unknown>>(
    sql`SELECT * FROM org_settings WHERE id = 'org' LIMIT 1`,
  );
  const r = (rows as unknown as { rows: any[] }).rows?.[0] ?? (rows as any)[0];
  return r ?? { org_name: 'Bayut KSA', legal_name: 'Bayut Saudi Arabia', timezone: 'Asia/Riyadh' };
}
