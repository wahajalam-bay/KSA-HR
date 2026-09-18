import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  positions, employees, departments, functions, locations, jobs, staff,
  candidates, applications, orgSettings,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   THE MANPOWER PLAN

   Every coded seat in the company: who is in it, whether it is funded, and what
   is being done about it if it is empty.

   The rule that holds the whole plan together is that a seat only becomes
   approved headcount once a requisition has been through the chain for it. One
   raised and still waiting counts as *requested*: it appears on the plan so
   nobody raises it twice, but it is not headcount yet, and it disappears again
   if the requisition is withdrawn before the chain closes.
   ═════════════════════════════════════════════════════════════════════════════*/

/** The statuses that mean a requisition is still live on a seat. */
export const LIVE_REQ = ['open', 'pending_approval', 'on_hold', 'draft'];

export type Seat = {
  filled: number;
  approved: number;
  pending: boolean;
  requested: number;
  vacant: number;
  recruiting: number;
  inPipeline: number;
  job: { id: string; title: string; status: string; openings: number; hiringManager: string | null } | null;
  liveJob: boolean;
};

export type Position = {
  id: string;
  code: string;
  title: string;
  deptId: string;
  deptName: string;
  functionId: string | null;
  reportsTo: string | null;
  grade: string | null;
  kind: string | null;
  city: string | null;
  holderGender: string | null;
  holders: Array<{ id: string; name: string; candidateId: string | null; photo: string | null; hue: number; gender: string | null; status: string }>;
  seat: Seat;
};

export async function plan(v: Viewer, exec: Exec = db()) {
  const [posRows, empRows, deptRows, fnRows, orgRow, countRow, onbRow] = await Promise.all([
    exec.execute(sql`
      SELECT p.id, p.code, p.title, p.dept_id, p.function_id, p.reports_to_id, p.grade, p.kind,
             p.plan_state::text AS plan_state, p.approved, p.requested, p.job_id, p.holder_gender,
             d.name AS dept_name, l.city,
             j.title AS job_title, j.status::text AS job_status, j.openings,
             j.hiring_manager,
             (SELECT count(*) FROM ${applications} a
               WHERE a.job_id = p.job_id AND a.status IN ('active','on_hold'))::int AS in_pipeline
        FROM ${positions} p
        JOIN ${departments} d ON d.id = p.dept_id
        LEFT JOIN ${locations} l ON l.id = p.location_id
        LEFT JOIN ${jobs} j ON j.id = p.job_id
       ORDER BY p.code`),
    exec.execute(sql`
      SELECT e.id, e.name, e.candidate_id, e.position_code, e.gender, e.status::text AS status,
             c.photo, c.hue
        FROM ${employees} e
        LEFT JOIN ${candidates} c ON c.id = e.candidate_id
       WHERE e.status <> 'left'
       ORDER BY e.id`),
    exec.select().from(departments).where(sql`archived_at IS NULL`)
      .orderBy(departments.sortOrder, departments.name),
    exec.select().from(functions).orderBy(functions.sortOrder),
    exec.select().from(orgSettings).limit(1),
    /* The tab counts everybody on the books, leavers included — it is the
       employee register, not the list of people currently here. */
    exec.execute(sql`SELECT count(*)::int AS n FROM ${employees}`),
    exec.execute(sql`
      SELECT name FROM ${staff} WHERE role = 'onboarding' AND status <> 'deleted' LIMIT 1`),
  ]);

  const byCode = new Map<string, Position['holders']>();
  for (const e of rowsOf(empRows)) {
    if (!e.position_code) continue;
    byCode.set(e.position_code, [...(byCode.get(e.position_code) ?? []), {
      id: e.id, name: e.name, candidateId: e.candidate_id, photo: e.photo,
      hue: Number(e.hue ?? 3), gender: e.gender, status: e.status,
    }]);
  }

  const list = rowsOf(posRows).map((p): Position => {
    const holders = byCode.get(p.code) ?? [];
    const filled = holders.length;
    const pending = p.plan_state === 'pending';
    const approved = pending ? filled : Math.max(Number(p.approved ?? 0), filled);
    const live = !!p.job_status && LIVE_REQ.includes(p.job_status);
    const openings = Number(p.openings ?? 0);
    return {
      id: p.id, code: p.code, title: p.title, deptId: p.dept_id, deptName: p.dept_name,
      functionId: p.function_id, reportsTo: p.reports_to_id, grade: p.grade, kind: p.kind,
      city: p.city, holderGender: p.holder_gender,
      holders,
      seat: {
        filled,
        approved,
        pending,
        requested: pending ? Number(p.requested ?? p.approved ?? 1) : 0,
        vacant: Math.max(0, approved - filled),
        recruiting: p.job_status === 'open' ? Math.min(openings, Math.max(0, approved - filled)) : 0,
        inPipeline: Number(p.in_pipeline ?? 0),
        job: p.job_id ? {
          id: p.job_id, title: p.job_title, status: p.job_status,
          openings, hiringManager: p.hiring_manager,
        } : null,
        liveJob: live,
      },
    };
  });

  return {
    positions: list,
    departments: deptRows,
    functions: fnRows,
    org: orgRow[0],
    employeesOnboarding: rowsOf(empRows).filter((e) => e.status === 'onboarding').length,
    employeeCount: Number(rowsOf(countRow)[0]?.n ?? 0),
    onboardingSpecialist: rowsOf(onbRow)[0]?.name ?? null,
  };
}

export type Summary = {
  positions: number; approved: number; filled: number; vacant: number;
  recruiting: number; requested: number; onboarding: number;
};

export function summarise(list: Position[], onboardingByCode: Map<string, number>): Summary {
  return {
    positions: list.length,
    approved: list.reduce((n, p) => n + p.seat.approved, 0),
    filled: list.reduce((n, p) => n + p.seat.filled, 0),
    vacant: list.reduce((n, p) => n + p.seat.vacant, 0),
    recruiting: list.reduce((n, p) => n + p.seat.recruiting, 0),
    requested: list.reduce((n, p) => n + p.seat.requested, 0),
    onboarding: list.reduce((n, p) => n + (onboardingByCode.get(p.code) ?? 0), 0),
  };
}

/* ── What a seat offers to do next ──────────────────────────────────────────
   A seat with a live requisition shows it rather than letting anybody raise a
   second one; a seat whose last requisition is closed offers to look at it, and
   to raise another if it is short; a vacant seat with none offers to raise one;
   a full seat says there is nothing to hire into. The rule lives here so the
   plan, the position sheet and the org chart cannot disagree about it. */
export type SeatAction =
  | { kind: 'none'; label: null; why: string }
  | { kind: 'raise'; label: string; act: string; v: string; tone: string }
  | { kind: 'view' | 'past'; label: string; act: 'go'; v: string; tone: string;
      job: NonNullable<Seat['job']>; also?: { label: string; act: string; v: string } | null };

export function seatAction(p: Position): SeatAction {
  const s = p.seat;
  if (s.job && s.liveJob) {
    return {
      kind: 'view', label: 'View the requisition', job: s.job,
      act: 'go', v: `/jobs/${s.job.id}`, tone: 'out',
    };
  }
  if (s.job) {
    return {
      kind: 'past', label: 'View the last requisition', job: s.job,
      act: 'go', v: `/jobs/${s.job.id}`, tone: 'ghost',
      also: s.vacant ? { label: 'Raise a requisition', act: 'pos.openReq', v: p.id } : null,
    };
  }
  if (s.vacant) {
    return { kind: 'raise', label: 'Raise a requisition', act: 'pos.openReq', v: p.id, tone: 'out' };
  }
  return {
    kind: 'none', label: null,
    why: s.pending
      ? 'Waiting on the approval of the requisition that raised it'
      : 'Every seat here is filled — no vacancy to hire into',
  };
}
