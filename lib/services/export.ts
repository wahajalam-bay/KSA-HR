import 'server-only';
import { sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { jobs } from '@/db/schema';
import { CommandError } from '@/lib/commands/registry';
import { audit, type Ctx } from '@/lib/audit';
import { jobScopeSql } from '@/lib/authz';
import { rows as rowsOf } from '@/lib/queries/sql';

/* ═════════════════════════════════════════════════════════════════════════════
   TAKING DATA OUT

   A recruiter with a spreadsheet open is a recruiter doing their job, and a
   product that will not export is a product people work around by copying rows
   out of the screen. So the exports are here, and three things hold for each:

     1. **The viewer's scope applies.** An export is a read, and the widest one
        in the product — it is the last place that should be able to hand
        somebody rows they cannot see on the page.
     2. **Every export is audited**, with what was taken and how many rows. A
        CV, a salary and a national ID are personal data; who took a copy of
        them is a thing an organisation has to be able to answer.
     3. **Nothing is invented.** A blank cell is blank. A figure the record does
        not have is empty rather than nought, because a zero in a spreadsheet is
        read as a measurement.
   ═════════════════════════════════════════════════════════════════════════════*/

export type ExportKind =
  | 'candidates' | 'applications' | 'requisitions' | 'sla_breaches'
  | 'positions' | 'employees' | 'audit';

export type Exported = { name: string; csv: string; rows: number };

/** One field, escaped the way a spreadsheet expects it. */
function cell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvOf(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  /* A BOM, because Excel on Windows reads a CSV without one as Latin-1 and
     every Arabic name in it comes out as mojibake. */
  return `﻿${[
    cols.join(','),
    ...rows.map((r) => cols.map((c) => cell(r[c])).join(',')),
  ].join('\r\n')}\r\n`;
}

const stamp = (now: Date) => now.toISOString().slice(0, 10);

export async function exportData(
  kind: ExportKind, ctx: Ctx & { tx: Exec; now: Date },
  opts: { deptId?: string | null; q?: string | null } = {},
): Promise<Exported> {
  /* The scope, as a subquery, so it constrains the rows at the root rather
     than filtering them afterwards. */
  const scope = sql`(SELECT id FROM ${jobs} WHERE ${jobScopeSql(ctx.viewer)})`;
  const dept = opts.deptId && opts.deptId !== 'all' ? opts.deptId : null;

  let rows: Array<Record<string, unknown>> = [];
  let name = '';

  switch (kind) {
    case 'candidates': {
      name = `candidates-${stamp(ctx.now)}.csv`;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT DISTINCT c.name AS "Name", c.email AS "Email", c.phone AS "Phone",
               c.location_city AS "City", c.nationality AS "Nationality",
               c.current_title AS "Current title", c.current_company AS "Current company",
               c.years_experience AS "Years", c.sector AS "Sector",
               c.expected_salary AS "Expecting", c.notice_days AS "Notice (days)",
               c.claim_by_name AS "Tagged to",
               array_to_string(c.hashtags, ' ') AS "Tags",
               c.created_at::date AS "Added"
          FROM candidates c
          JOIN applications a ON a.candidate_id = c.id
         WHERE a.job_id IN ${scope}
         ORDER BY c.name`)) as Array<Record<string, unknown>>;
      break;
    }

    case 'applications': {
      name = `applications-${stamp(ctx.now)}.csv`;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT a.reference AS "Reference", c.name AS "Candidate", j.title AS "Requisition",
               d.name AS "Department", a.stage::text AS "Stage", a.status::text AS "Status",
               a.source AS "Source", s.name AS "Recruiter",
               a.applied_at::date AS "Applied", a.stage_entered_at::date AS "Entered stage",
               a.rating AS "Rating", a.fit_score AS "Fit",
               a.disqualify_reason AS "Disqualified because", a.closed_at::date AS "Closed"
          FROM applications a
          JOIN candidates c ON c.id = a.candidate_id
          JOIN jobs j ON j.id = a.job_id
          LEFT JOIN departments d ON d.id = j.dept_id
          LEFT JOIN staff s ON s.id = a.recruiter_id
         WHERE a.job_id IN ${scope}
           ${dept ? sql`AND j.dept_id = ${dept}` : sql``}
         ORDER BY a.applied_at DESC`)) as Array<Record<string, unknown>>;
      break;
    }

    case 'requisitions': {
      name = `requisitions-${stamp(ctx.now)}.csv`;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT j.reference AS "Reference", j.title AS "Title", d.name AS "Department",
               l.city AS "City", j.status::text AS "Status", j.priority::text AS "Priority",
               j.openings AS "Openings", j.filled AS "Filled",
               j.salary_min AS "Band from", j.salary_max AS "Band to",
               j.hiring_manager AS "Hiring manager", s.name AS "Recruiter",
               j.position_code AS "Seat", j.budgeted AS "Budgeted",
               j.opened_on AS "Opened", j.target_start_on AS "Target start",
               j.closed_on AS "Closed",
               (SELECT count(*) FROM applications a
                 WHERE a.job_id = j.id AND a.status IN ('active','on_hold')) AS "In pipeline"
          FROM jobs j
          LEFT JOIN departments d ON d.id = j.dept_id
          LEFT JOIN locations l ON l.id = j.location_id
          LEFT JOIN staff s ON s.id = j.recruiter_id
         WHERE j.id IN ${scope}
           ${dept ? sql`AND j.dept_id = ${dept}` : sql``}
         ORDER BY j.opened_on DESC NULLS LAST`)) as Array<Record<string, unknown>>;
      break;
    }

    case 'sla_breaches': {
      name = `past-sla-${stamp(ctx.now)}.csv`;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT c.name AS "Candidate", j.title AS "Requisition", d.name AS "Department",
               js.name AS "Stage", js.sla AS "SLA (days)",
               (${ctx.now}::date - a.stage_entered_at::date) AS "Days in stage",
               (${ctx.now}::date - a.stage_entered_at::date) - js.sla AS "Days over",
               s.name AS "Recruiter", j.hiring_manager AS "Hiring manager"
          FROM applications a
          JOIN candidates c ON c.id = a.candidate_id
          JOIN jobs j ON j.id = a.job_id
          LEFT JOIN departments d ON d.id = j.dept_id
          LEFT JOIN staff s ON s.id = a.recruiter_id
          JOIN job_stages js ON js.job_id = a.job_id AND js.stage_key = a.stage
         WHERE a.job_id IN ${scope}
           AND a.status IN ('active','on_hold')
           AND (${ctx.now}::date - a.stage_entered_at::date) >= js.sla
         ORDER BY (${ctx.now}::date - a.stage_entered_at::date) - js.sla DESC`)) as
        Array<Record<string, unknown>>;
      break;
    }

    case 'positions': {
      name = `manpower-plan-${stamp(ctx.now)}.csv`;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT p.code AS "Code", p.title AS "Position", d.name AS "Department",
               p.grade AS "Grade", up.code AS "Reports to", l.city AS "Location",
               p.plan_state::text AS "Plan state",
               p.approved AS "Approved", p.requested AS "Requested",
               (SELECT count(*) FROM employees e
                 WHERE e.position_code = p.code AND e.status <> 'left') AS "Filled",
               (SELECT string_agg(e.name, '; ') FROM employees e
                 WHERE e.position_code = p.code AND e.status <> 'left') AS "Holders",
               j.title AS "Hiring for"
          FROM positions p
          LEFT JOIN departments d ON d.id = p.dept_id
          LEFT JOIN positions up ON up.id = p.reports_to_id
          LEFT JOIN locations l ON l.id = p.location_id
          LEFT JOIN jobs j ON j.id = p.job_id
         WHERE p.retired_at IS NULL
           ${dept ? sql`AND p.dept_id = ${dept}` : sql``}
         ORDER BY d.sort_order, p.code`)) as Array<Record<string, unknown>>;
      break;
    }

    case 'employees': {
      name = `employees-${stamp(ctx.now)}.csv`;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT e.employee_code AS "Employee number", e.name AS "Name", e.title AS "Title",
               d.name AS "Department", e.position_code AS "Seat", l.city AS "Location",
               e.start_date AS "Started", e.status::text AS "Status",
               e.source::text AS "How they came", j.title AS "Hired against",
               pr.state::text AS "Probation", pr.ends_on AS "Probation ends"
          FROM employees e
          LEFT JOIN departments d ON d.id = e.dept_id
          LEFT JOIN locations l ON l.id = e.location_id
          LEFT JOIN jobs j ON j.id = e.job_id
          LEFT JOIN probation_records pr ON pr.employee_id = e.id
         WHERE e.status <> 'left'
           ${dept ? sql`AND e.dept_id = ${dept}` : sql``}
         ORDER BY e.start_date DESC`)) as Array<Record<string, unknown>>;
      break;
    }

    case 'audit': {
      /* The trail is an Admin's, and the export is the trail. */
      if (!ctx.viewer.isAdmin) throw new CommandError('The audit trail is an Admin’s to export');
      name = `audit-${stamp(ctx.now)}.csv`;
      const like = opts.q ? `%${opts.q.toLowerCase()}%` : null;
      rows = rowsOf(await ctx.tx.execute(sql`
        SELECT at AS "When", actor_name AS "Who", action::text AS "Action",
               summary AS "What", entity_type AS "Record type", entity_id AS "Record",
               entity_label AS "Record name", reason AS "Reason", request_id AS "Request",
               ip AS "From"
          FROM audit_events
         WHERE ${like ? sql`(lower(summary) LIKE ${like} OR lower(coalesce(actor_name,'')) LIKE ${like}
                             OR lower(coalesce(entity_id,'')) LIKE ${like})` : sql`true`}
         ORDER BY at DESC
         LIMIT 20000`)) as Array<Record<string, unknown>>;
      break;
    }

    default:
      throw new CommandError('There is nothing of that kind to export');
  }

  if (!rows.length) {
    throw new CommandError('There is nothing to export — the filters match no rows', { tone: 'warn' });
  }

  /* An export of personal data is a thing an organisation has to be able to
     answer for, so it goes on the trail with what was taken and how much. */
  await audit(ctx, {
    action: 'read',
    summary: `exported ${rows.length} ${kind.replace('_', ' ')} row${rows.length === 1 ? '' : 's'}`,
    entityType: 'export', entityId: kind,
    after: { kind, rows: rows.length, dept: dept ?? 'all' },
  }, ctx.tx);

  return { name, csv: csvOf(rows), rows: rows.length };
}
