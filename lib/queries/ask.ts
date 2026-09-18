import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  applications, jobs, departments, functions, locations, staff, interviews, offers,
  screenings, employees, candidates, sources as sourceTable,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { DEFAULT_NAMES, type StageKey } from '@/lib/domain/stages';
import { fmt } from '@/lib/format';
import {
  METRICS, DIMS, type Spec, type Vocabulary, type MetricKey, type DimKey,
} from '@/lib/services/ask';

/* ═════════════════════════════════════════════════════════════════════════════
   RESOLVING A REPORT SPECIFICATION

   The specification arrives already constrained to a closed vocabulary. This
   turns it into rows, and every read starts from `jobScopeSql(viewer)` — the
   same predicate the boards use — so the answer an account gets is an answer
   about the requisitions it may see, whatever the question was.

   One row shape comes back for each metric, carrying just what the grouping and
   the aggregate need. Nothing here interpolates anything from the question into
   SQL: the only values that reach the database are ids the vocabulary contained.
   ═════════════════════════════════════════════════════════════════════════════*/

export async function vocabulary(v: Viewer, exec: Exec = db()): Promise<Vocabulary> {
  const [depts, fns, people, locs, srcs] = await Promise.all([
    exec.select({ id: departments.id, name: departments.name }).from(departments)
      .where(sql`archived_at IS NULL`).orderBy(departments.sortOrder, departments.name),
    exec.select({ id: functions.id, name: functions.name }).from(functions).orderBy(functions.name),
    exec.select({ id: staff.id, name: staff.name }).from(staff)
      .where(sql`status <> 'deleted'`).orderBy(staff.name),
    exec.select({ id: locations.id, city: locations.city }).from(locations),
    exec.execute(sql`SELECT DISTINCT source FROM ${applications} ORDER BY 1`),
  ]);
  return {
    departments: depts,
    functions: fns,
    staff: people,
    locations: locs,
    sources: rowsOf(srcs).map((r) => r.source as string),
  };
}

export type Row = {
  /* The dimension values this record can be grouped by. */
  department: string;
  function: string;
  recruiter: string;
  source: string;
  month: string;
  stage: string;
  location: string;
  job: string;
  family: string;
  hiring_manager: string;
  nationality: string;
  channel: string;
  /* What the aggregate reads. */
  n: number;
  accepted?: boolean;
  passed?: boolean;
  hired?: boolean;
  days?: number | null;
  openings?: number;
};

export type Result = {
  rows: Row[];
  series: Array<{ label: string; key?: string; value: number; n: number }> | null;
  total: number | null;
  unit: string;
  kind: Metric['kind'];
  note: string;
  agg: boolean;
  prev: number | null;
};

type Metric = (typeof METRICS)[MetricKey];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (k: string) => {
  const [y, m] = k.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

const med = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The window, in days — 'ytd' resolved against the request's clock. */
function windowDays(spec: Spec, now: Date): number | null {
  if (spec.window == null) return null;
  if (spec.window === 'ytd') {
    return Math.ceil((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000);
  }
  return spec.window;
}

/* The common projection: every dimension a row can be grouped by, resolved in
   SQL so the grouping never has to reach back for a name. */
const DIMENSIONS = (dateCol: string) => sql`
  d.name AS department,
  coalesce(f.name, 'Other') AS function,
  coalesce(rs.name, '—') AS recruiter,
  coalesce(a.source, '—') AS source,
  to_char(${sql.raw(dateCol)}, 'YYYY-MM') AS month,
  coalesce(js.name, a.stage::text) AS stage,
  coalesce(l.city, '—') AS location,
  j.title AS job,
  coalesce(j.family, '—') AS family,
  coalesce(j.hiring_manager, '—') AS hiring_manager,
  coalesce(c.nationality, '—') AS nationality`;

const JOINS = sql`
  JOIN ${jobs} j ON j.id = a.job_id
  JOIN ${departments} d ON d.id = j.dept_id
  LEFT JOIN ${functions} f ON f.id = d.function_id
  LEFT JOIN ${locations} l ON l.id = j.location_id
  LEFT JOIN ${staff} rs ON rs.id = a.recruiter_id
  LEFT JOIN ${candidates} c ON c.id = a.candidate_id
  LEFT JOIN job_stages js ON js.job_id = a.job_id AND js.stage_key = a.stage`;

function filterSql(spec: Spec) {
  const w: ReturnType<typeof sql>[] = [];
  if (spec.filters.deptId) w.push(sql`j.dept_id = ${spec.filters.deptId}`);
  if (spec.filters.fnId) w.push(sql`d.function_id = ${spec.filters.fnId}`);
  if (spec.filters.recruiterId) w.push(sql`a.recruiter_id = ${spec.filters.recruiterId}`);
  if (spec.filters.locationId) w.push(sql`j.location_id = ${spec.filters.locationId}`);
  if (spec.filters.source) w.push(sql`a.source = ${spec.filters.source}`);
  return w.length ? sql`AND ${sql.join(w, sql` AND `)}` : sql``;
}

/** Run a specification against the reporting layer, inside the viewer's scope. */
export async function resolve(
  v: Viewer, spec: Spec, now: Date, exec: Exec = db(),
): Promise<Result> {
  if (!spec.metric) {
    return { rows: [], series: null, total: null, unit: '', kind: 'count', note: '', agg: false, prev: null };
  }
  const m = METRICS[spec.metric];
  const days = windowDays(spec, now);
  const scope = sql`j.id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const f = filterSql(spec);

  const since = (col: string, d: number) =>
    sql`${sql.raw(col)} >= ${at(now)} - (${d} || ' days')::interval AND ${sql.raw(col)} <= ${at(now)}`;
  const between = (col: string, from: number, to: number) =>
    sql`${sql.raw(col)} < ${at(now)} - (${from} || ' days')::interval
        AND ${sql.raw(col)} >= ${at(now)} - (${to} || ' days')::interval`;

  let rows: Row[] = [];
  let agg: ((list: Row[]) => number) | null = null;
  let unit = m.unit;
  let note = '';

  const fromApplications = async (
    where: ReturnType<typeof sql>, dateCol: string, extra = sql``,
  ) => rowsOf(await exec.execute(sql`
    SELECT ${DIMENSIONS(dateCol)}, '—' AS channel, 1 AS n ${extra}
      FROM ${applications} a ${JOINS}
     WHERE ${scope} ${f} AND ${where}`)) as Row[];

  switch (spec.metric) {
    case 'hires':
      rows = await fromApplications(
        sql`a.status = 'hired' ${days ? sql`AND ${since('a.closed_at', days)}` : sql``}`,
        'a.closed_at');
      break;
    case 'applications':
      rows = await fromApplications(
        days ? since('a.applied_at', days) : sql`true`, 'a.applied_at');
      break;
    case 'rejections':
      rows = await fromApplications(
        sql`a.status = 'rejected' ${days ? sql`AND ${since('a.closed_at', days)}` : sql``}`,
        'a.closed_at');
      break;
    case 'pipeline':
      rows = await fromApplications(sql`a.status IN ('active','on_hold')`, 'a.stage_entered_at');
      break;
    case 'sla':
      rows = await fromApplications(
        sql`a.status IN ('active','on_hold')
            AND ${at(now)} - a.stage_entered_at > (coalesce(js.sla, 5) || ' days')::interval`,
        'a.stage_entered_at');
      break;
    case 'conversion':
      rows = await fromApplications(
        days ? since('a.applied_at', days) : sql`true`, 'a.applied_at',
        sql`, (a.status = 'hired') AS hired`);
      agg = (l) => Math.round(1000 * l.filter((x) => x.hired).length / (l.length || 1)) / 10;
      note = 'hires ÷ applications received in the period';
      break;
    case 'time_to_hire':
      rows = await fromApplications(
        sql`a.status = 'hired' AND a.closed_at IS NOT NULL
            ${days ? sql`AND ${since('a.closed_at', days)}` : sql``}`,
        'a.closed_at',
        sql`, EXTRACT(EPOCH FROM (a.closed_at - a.applied_at)) / 86400 AS days`);
      agg = (l) => Math.round(med(l.map((x) => Number(x.days ?? 0))));
      note = 'median days from application to acceptance';
      break;
    case 'time_to_fill':
      rows = await fromApplications(
        sql`a.status = 'hired' AND a.closed_at IS NOT NULL AND j.opened_on IS NOT NULL
            ${days ? sql`AND ${since('a.closed_at', days)}` : sql``}`,
        'a.closed_at',
        sql`, EXTRACT(EPOCH FROM (a.closed_at - j.opened_on::timestamptz)) / 86400 AS days`);
      agg = (l) => Math.round(med(l.map((x) => Number(x.days ?? 0)).filter((x) => x > 0)));
      note = 'median days from the requisition opening to the hire';
      break;
    case 'joiners': {
      const ahead = spec.future ? (typeof spec.window === 'number' ? spec.window : 30) : null;
      rows = await fromApplications(
        ahead
          ? sql`a.status = 'hired' AND a.start_date IS NOT NULL
                AND a.start_date >= ${at(now)}::date
                AND a.start_date <= (${at(now)}::date + ${ahead})`
          : sql`a.status = 'hired' AND a.start_date IS NOT NULL
                ${days ? sql`AND a.start_date >= (${at(now)}::date - ${days})` : sql``}`,
        'a.start_date::timestamptz');
      break;
    }
    case 'interviews':
      rows = rowsOf(await exec.execute(sql`
        SELECT ${DIMENSIONS('i.at')}, '—' AS channel, 1 AS n,
               coalesce(i.interviewer, j.hiring_manager, '—') AS hiring_manager
          FROM ${interviews} i
          JOIN ${applications} a ON a.id = i.application_id ${JOINS}
         WHERE i.status <> 'cancelled' AND ${scope} ${f}
           ${days ? sql`AND ${since('i.at', days)}` : sql``}`)) as Row[];
      break;
    case 'offers':
      rows = rowsOf(await exec.execute(sql`
        SELECT ${DIMENSIONS('o.sent_at')}, '—' AS channel, 1 AS n
          FROM ${offers} o
          JOIN ${applications} a ON a.id = o.application_id ${JOINS}
         WHERE o.sent_at IS NOT NULL AND ${scope} ${f}
           ${days ? sql`AND ${since('o.sent_at', days)}` : sql``}`)) as Row[];
      break;
    case 'acceptance':
      rows = rowsOf(await exec.execute(sql`
        SELECT ${DIMENSIONS("coalesce(o.response_at, o.sent_at, o.created_at)")}, '—' AS channel, 1 AS n,
               (o.state = 'accepted') AS accepted
          FROM ${offers} o
          JOIN ${applications} a ON a.id = o.application_id ${JOINS}
         WHERE o.state IN ('accepted','declined') AND ${scope} ${f}
           ${days ? sql`AND ${since("coalesce(o.response_at, o.sent_at, o.created_at)", days)}` : sql``}`)) as Row[];
      agg = (l) => Math.round(100 * l.filter((x) => x.accepted).length / (l.length || 1));
      note = 'accepted ÷ (accepted + declined)';
      break;
    case 'screenings':
    case 'pass_rate':
      rows = rowsOf(await exec.execute(sql`
        SELECT ${DIMENSIONS('s.completed_at')}, s.channel::text AS channel, 1 AS n,
               (s.verdict = 'pass') AS passed
          FROM ${screenings} s
          JOIN ${applications} a ON a.id = s.application_id ${JOINS}
         WHERE s.status = 'completed' AND ${scope} ${f}
           ${days ? sql`AND ${since('s.completed_at', days)}` : sql``}`)) as Row[];
      if (spec.metric === 'pass_rate') {
        agg = (l) => Math.round(100 * l.filter((x) => x.passed).length / (l.length || 1));
        note = 'pass ÷ completed screenings';
      }
      break;
    case 'open_reqs':
      rows = rowsOf(await exec.execute(sql`
        SELECT d.name AS department, coalesce(f2.name, 'Other') AS function,
               coalesce(rs.name, '—') AS recruiter, '—' AS source,
               to_char(j.opened_on::timestamptz, 'YYYY-MM') AS month, '—' AS stage,
               coalesce(l.city, '—') AS location, j.title AS job,
               coalesce(j.family, '—') AS family, coalesce(j.hiring_manager, '—') AS hiring_manager,
               '—' AS nationality, '—' AS channel, 1 AS n, j.openings
          FROM ${jobs} j
          JOIN ${departments} d ON d.id = j.dept_id
          LEFT JOIN ${functions} f2 ON f2.id = d.function_id
          LEFT JOIN ${locations} l ON l.id = j.location_id
          LEFT JOIN ${staff} rs ON rs.id = j.recruiter_id
         WHERE j.status = 'open' AND ${jobScopeSql(v, 'j')}
           ${spec.filters.deptId ? sql`AND j.dept_id = ${spec.filters.deptId}` : sql``}
           ${spec.filters.fnId ? sql`AND d.function_id = ${spec.filters.fnId}` : sql``}
           ${spec.filters.recruiterId ? sql`AND j.recruiter_id = ${spec.filters.recruiterId}` : sql``}
           ${spec.filters.locationId ? sql`AND j.location_id = ${spec.filters.locationId}` : sql``}`)) as Row[];
      if (/\bopenings\b/i.test(spec.q)) {
        agg = (l) => l.reduce((n, x) => n + Number(x.openings ?? 0), 0);
        unit = 'openings';
      }
      break;
    case 'headcount':
      rows = rowsOf(await exec.execute(sql`
        SELECT d.name AS department, coalesce(f2.name, 'Other') AS function,
               '—' AS recruiter, '—' AS source,
               to_char(e.start_date::timestamptz, 'YYYY-MM') AS month, '—' AS stage,
               coalesce(l.city, '—') AS location, e.title AS job,
               coalesce(j.family, d.name) AS family, coalesce(j.hiring_manager, '—') AS hiring_manager,
               '—' AS nationality, '—' AS channel, 1 AS n
          FROM ${employees} e
          JOIN ${departments} d ON d.id = e.dept_id
          LEFT JOIN ${functions} f2 ON f2.id = d.function_id
          LEFT JOIN ${locations} l ON l.id = e.location_id
          LEFT JOIN ${jobs} j ON j.id = e.job_id
         WHERE e.status <> 'left'
           AND (e.job_id IS NULL OR e.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)}))
           ${spec.filters.deptId ? sql`AND e.dept_id = ${spec.filters.deptId}` : sql``}
           ${spec.filters.fnId ? sql`AND d.function_id = ${spec.filters.fnId}` : sql``}
           ${spec.filters.locationId ? sql`AND e.location_id = ${spec.filters.locationId}` : sql``}`)) as Row[];
      break;
    default:
      rows = [];
  }

  /* Grouping. A month dimension keeps every month in the period, including the
     empty ones, so a gap in the data reads as a gap rather than as absence. */
  let series: Result['series'] = null;
  if (spec.dim) {
    const key = (r: Row) => String((r as unknown as Record<string, unknown>)[spec.dim!] ?? '—');
    const g = new Map<string, Row[]>();
    for (const r of rows) { const k = key(r); g.set(k, [...(g.get(k) ?? []), r]); }

    if (spec.dim === 'month') {
      const n = Math.max(1, Math.min(24, Math.round((days ?? 365) / 30.4)));
      const keys: string[] = [];
      for (let i = n - 1; i >= 0; i--) {
        keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
      }
      series = keys.map((k) => {
        const list = g.get(k) ?? [];
        return { label: monthLabel(k), key: k, value: agg ? (list.length ? agg(list) : 0) : list.length, n: list.length };
      });
    } else {
      series = [...g.entries()]
        .map(([label, list]) => ({ label, value: agg ? agg(list) : list.length, n: list.length }))
        .sort((a, b) => b.value - a.value);
    }
  }

  /* The comparison against the period before, for a plain count with no
     dimension — the one case where a single number means more with a second. */
  let prev: number | null = null;
  if (!spec.dim && m.kind === 'count' && days && spec.metric !== 'joiners') {
    const col = {
      hires: 'a.closed_at', applications: 'a.applied_at', rejections: 'a.closed_at',
      interviews: 'i.at', offers: 'o.sent_at', screenings: 's.completed_at',
    }[spec.metric as string];
    if (col) {
      const table = {
        interviews: sql`${interviews} i JOIN ${applications} a ON a.id = i.application_id`,
        offers: sql`${offers} o JOIN ${applications} a ON a.id = o.application_id`,
        screenings: sql`${screenings} s JOIN ${applications} a ON a.id = s.application_id`,
      }[spec.metric as string] ?? sql`${applications} a`;
      const extra = {
        hires: sql`AND a.status = 'hired'`,
        rejections: sql`AND a.status = 'rejected'`,
        interviews: sql`AND i.status <> 'cancelled'`,
        offers: sql`AND o.sent_at IS NOT NULL`,
        screenings: sql`AND s.status = 'completed'`,
      }[spec.metric as string] ?? sql``;
      const r = rowsOf(await exec.execute(sql`
        SELECT count(*)::int AS n FROM ${table} ${JOINS}
         WHERE ${scope} ${f} ${extra} AND ${between(col, days, 2 * days)}`));
      prev = Number(r[0]?.n ?? 0);
    }
  }

  return {
    rows,
    series,
    total: agg ? (rows.length ? agg(rows) : null) : rows.length,
    unit,
    kind: m.kind,
    note,
    agg: !!agg,
    prev,
  };
}

/* ── The narrative ──────────────────────────────────────────────────────── */
export function narrative(spec: Spec, res: Result): string[] {
  if (!spec.metric) return [];
  const m = METRICS[spec.metric];
  const lines: string[] = [];
  const val = (v: number) => (res.unit === '%'
    ? fmt.pct(v / 100, spec.metric === 'conversion' ? 1 : 0)
    : res.unit === 'days' ? `${fmt.int(v)} days` : fmt.int(v));

  if (res.series && res.series.length) {
    const nz = res.series.filter((x) => x.value != null && !Number.isNaN(x.value));
    const top = spec.dim === 'month' ? [...nz].sort((a, b) => b.value - a.value)[0] : nz[0];
    const bottom = spec.dim === 'month' ? [...nz].sort((a, b) => a.value - b.value)[0] : nz[nz.length - 1];
    const tot = res.agg ? null : nz.reduce((n, x) => n + x.value, 0);
    if (top) {
      lines.push(`${top.label} ${res.kind === 'median' || res.kind === 'rate' ? 'is highest' : 'leads'} at ${val(top.value)}`
        + `${tot && !res.agg ? ` (${fmt.pct(top.value / (tot || 1))} of ${fmt.int(tot)} ${res.unit})` : ''}`
        + `${bottom && bottom !== top ? `; ${bottom.label} is lowest at ${val(bottom.value)}` : ''}.`);
    }
    if (spec.dim === 'month' && nz.length >= 2) {
      const a = nz[nz.length - 1].value, b = nz[nz.length - 2].value;
      lines.push(`The latest month is ${val(a)}, ${a === b ? 'level with' : a > b ? `up from ${val(b)} in` : `down from ${val(b)} in`} the month before.`);
    }
    if (res.agg && res.total != null) {
      lines.push(`Across everything in scope: ${val(res.total)}${res.note ? ` (${res.note})` : ''}.`);
    }
    if (!res.agg && nz.length > 3 && spec.dim) {
      const three = nz.slice(0, 3).reduce((n, x) => n + x.value, 0);
      lines.push(`${nz.length} ${DIMS[spec.dim].label}s in scope; the top three account for ${fmt.pct(three / (tot || 1))}.`);
    }
  } else {
    lines.push(`${res.total == null ? '—' : val(res.total)} ${res.unit === '%' ? m.label.toLowerCase() : res.unit}`
      + `${spec.window ? ` in the ${spec.windowLabel.toLowerCase()}` : ''}${res.note ? ` — ${res.note}` : ''}.`);
    if (res.prev != null && res.kind === 'count' && res.total != null) {
      lines.push(res.prev === res.total ? 'Level with the previous period.'
        : `${res.total > res.prev ? 'Up' : 'Down'} ${fmt.pct(Math.abs(res.total - res.prev) / (res.prev || 1))} on the previous period (${fmt.int(res.prev)}).`);
    }
  }
  return lines;
}

/** The report as a CSV, for the download the panel offers. */
export function toCsv(spec: Spec, res: Result): string {
  if (!spec.metric) return '';
  const head = res.series && spec.dim
    ? [DIMS[spec.dim].label, METRICS[spec.metric].label, res.agg ? 'records' : 'share']
    : ['metric', 'value', 'period'];
  const total = res.series ? res.series.reduce((n, x) => n + x.value, 0) : 0;
  const body = res.series
    ? res.series.map((r) => [r.label, r.value, res.agg ? r.n : (r.value / (total || 1)).toFixed(3)])
    : [[METRICS[spec.metric].label, res.total ?? '', spec.windowLabel]];
  return [head, ...body]
    .map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
