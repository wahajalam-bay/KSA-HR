import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  applications, applicationStageHistory, candidates, jobs, departments, functions, locations,
  staff, offers, offerMessages, evaluations, interviews, employees, probationRecords, goals,
  orgSettings, positions,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_KEYS, STAGE_INDEX, DEFAULT_NAMES, DEFAULT_SLA, type StageKey } from '@/lib/domain/stages';
import { inWindow, previous, type Window } from '@/lib/domain/window';

/* ═════════════════════════════════════════════════════════════════════════════
   THE REPORTING LAYER

   Every figure in Insights is derived here, from the records, and nowhere else.
   Nothing is stored as a dashboard number: a stored number is a number that can
   be wrong, and the whole point of the reporting surface is that it agrees with
   the boards it is reporting on.

   One scoped read per request, then the arithmetic in one place. At this size —
   a few thousand applications — that is both faster and far easier to keep
   honest than forty separate aggregates that have to agree with each other. The
   shape below is deliberately the shape a materialised reporting table would
   take, so the step to one is a change of source rather than of meaning.

   Access is applied at the root: `jobScopeSql` narrows the requisitions before
   anything is counted, so an account scoped to nine requisitions gets Insights
   about those nine and cannot infer anything about the rest from a total.
   ═════════════════════════════════════════════════════════════════════════════*/

export type AppRow = {
  id: string;
  jobId: string;
  candidateId: string;
  deptId: string;
  deptName: string;
  functionName: string | null;
  jobTitle: string;
  jobFamily: string | null;
  recruiterId: string | null;
  recruiterName: string | null;
  sourcerId: string | null;
  source: string;
  stage: StageKey;
  status: string;
  appliedAt: string;
  closedAt: string | null;
  stageEnteredAt: string;
  /* What this requisition calls the stage the application is on — a board
     reads the local name, a cross-requisition report reads the spine's. */
  stageName: string;
  sla: number;
  rating: number | null;
  /* Every stage this application has entered, with when — the dwell times, the
     funnel and the first-response time are all read off this. */
  history: Array<{ stage: StageKey; at: string }>;
  /* The submitted scorecards, for quality of hire. */
  scores: number[];
};

export type OfferRow = {
  id: string;
  applicationId: string;
  jobId: string;
  candidateId: string;
  deptName: string;
  jobTitle: string;
  candidateName: string;
  state: string;
  baseMonthly: number;
  sentAt: string | null;
  responseAt: string | null;
  responseReason: string | null;
  responseNote: string | null;
  questions: number;
  /* Who said what, rather than a count halved: the thread is open when the
     last word in it is the candidate's. */
  asked: number;
  answered: number;
  lastMessageAt: string | null;
  openQuestion: boolean;
};

export type JobRow = {
  id: string;
  title: string;
  status: string;
  deptId: string;
  deptName: string;
  city: string | null;
  openings: number;
  filled: number;
  salaryMin: number;
  salaryMax: number;
  budgeted: boolean;
  budgetNote: string | null;
  openedOn: string | null;
  hiringManager: string | null;
  recruiterId: string | null;
  /* The two support roles named on the requisition. Neither owns applications;
     both appear on their own profile as requisitions they support. */
  sourcerId: string | null;
  coordinatorId: string | null;
  priority: string;
  archived: boolean;
};

export type HireRow = {
  employeeId: string;
  candidateId: string | null;
  name: string;
  jobId: string | null;
  deptId: string;
  deptName: string;
  title: string;
  startDate: string;
  applicationId: string | null;
  source: string | null;
  recruiterName: string | null;
  probation: { state: string; endsOn: string; reason: string | null; decidedOn: string | null };
};

export type Dataset = {
  apps: AppRow[];
  offers: OfferRow[];
  jobs: JobRow[];
  hires: HireRow[];
  staff: Array<{ id: string; name: string; role: string; roleLabel: string; photo: string | null; hue: number; monthlyTarget: number }>;
  departments: Array<{ id: string; name: string; head: string | null }>;
  goals: Array<{ month: string; hires: number; timeToHireDays: number | null; qualityOfHire: number | null; costPerHireSar: number | null }>;
  candidates: Map<string, { name: string; gender: string | null; sector: string | null; yearsExperience: number | null; currentSalary: number | null; currentSalarySource: string | null; currentCompany: string | null; photo: string | null; hue: number }>;
};

/** One scoped read of everything the reports are derived from. */
export async function dataset(v: Viewer, now: Date, exec: Exec = db()): Promise<Dataset> {
  const scope = sql`j.id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;

  const [appRows, histRows, evalRows, offerRows, jobRows, hireRows, staffRows, deptRows, goalRows, candRows] =
    await Promise.all([
      exec.execute(sql`
        SELECT a.id, a.job_id, a.candidate_id, a.source, a.stage::text AS stage,
               a.status::text AS status, a.applied_at, a.closed_at, a.stage_entered_at, a.rating,
               j.dept_id, j.title AS job_title, j.family, j.recruiter_id, a.sourcer_id,
               d.name AS dept_name, f.name AS function_name, s.name AS recruiter_name,
               coalesce(js.sla, 5) AS sla, js.name AS stage_name
          FROM ${applications} a
          JOIN ${jobs} j ON j.id = a.job_id
          JOIN ${departments} d ON d.id = j.dept_id
          LEFT JOIN ${functions} f ON f.id = d.function_id
          LEFT JOIN ${staff} s ON s.id = j.recruiter_id
          LEFT JOIN job_stages js ON js.job_id = a.job_id AND js.stage_key = a.stage
         WHERE ${scope}
         ORDER BY a.id`),
      /* A close is recorded as its own history row — it is a status transition,
         and the history is append-only. It is not a stage hop, though: counting
         it would give every closed application a second spell in its last stage
         with a dwell of zero, which pulls every median down. */
      exec.execute(sql`
        SELECT h.application_id, h.to_stage::text AS stage, h.at
          FROM ${applicationStageHistory} h
          JOIN ${applications} a ON a.id = h.application_id
          JOIN ${jobs} j ON j.id = a.job_id
         WHERE ${scope} AND coalesce((h.metadata->>'close')::boolean, false) = false
         ORDER BY h.application_id, h.seq`),
      exec.execute(sql`
        SELECT e.application_id, e.overall FROM ${evaluations} e
          JOIN ${jobs} j ON j.id = e.job_id
         WHERE e.submitted AND e.overall IS NOT NULL AND ${scope}`),
      exec.execute(sql`
        SELECT o.id, o.application_id, o.job_id, o.candidate_id, o.state::text AS state,
               o.base_monthly, o.sent_at, o.response_at, o.response_reason, o.response_note,
               d.name AS dept_name, j.title AS job_title, c.name AS candidate_name,
               (SELECT count(*) FROM ${offerMessages} m WHERE m.offer_id = o.id)::int AS questions,
               (SELECT count(*) FROM ${offerMessages} m
                 WHERE m.offer_id = o.id AND m.from_party = 'candidate')::int AS asked,
               (SELECT count(*) FROM ${offerMessages} m
                 WHERE m.offer_id = o.id AND m.from_party = 'staff')::int AS answered,
               (SELECT m.at FROM ${offerMessages} m
                 WHERE m.offer_id = o.id ORDER BY m.at DESC LIMIT 1) AS last_message_at,
               (SELECT m.from_party::text FROM ${offerMessages} m
                 WHERE m.offer_id = o.id ORDER BY m.at DESC LIMIT 1) AS last_from
          FROM ${offers} o
          JOIN ${jobs} j ON j.id = o.job_id
          JOIN ${departments} d ON d.id = j.dept_id
          JOIN ${candidates} c ON c.id = o.candidate_id
         WHERE ${scope}
         ORDER BY o.id`),
      exec.execute(sql`
        SELECT j.id, j.title, j.status::text AS status, j.dept_id, j.openings, j.filled,
               j.salary_min, j.salary_max, j.budgeted, j.budget_note, j.opened_on::text AS opened_on,
               j.hiring_manager, j.recruiter_id, j.sourcer_id, j.coordinator_id,
               j.priority::text AS priority, j.archived_at, d.name AS dept_name, l.city
          FROM ${jobs} j JOIN ${departments} d ON d.id = j.dept_id
          LEFT JOIN ${locations} l ON l.id = j.location_id
         WHERE ${scope}
         ORDER BY j.id`),
      exec.execute(sql`
        SELECT e.id, e.name, e.job_id, e.dept_id, e.title, e.start_date::text AS start_date,
               e.application_id, e.candidate_id,
               d.name AS dept_name, a.source, s.name AS recruiter_name,
               p.state::text AS p_state, p.ends_on::text AS p_ends, p.reason AS p_reason,
               p.decided_on::text AS p_decided
          FROM ${employees} e
          JOIN ${departments} d ON d.id = e.dept_id
          LEFT JOIN ${applications} a ON a.id = e.application_id
          LEFT JOIN ${jobs} j ON j.id = e.job_id
          LEFT JOIN ${staff} s ON s.id = j.recruiter_id
          LEFT JOIN ${probationRecords} p ON p.employee_id = e.id
         WHERE e.source = 'hire'
           AND (e.job_id IS NULL OR e.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)}))
         /* In the order they were hired. Every report that groups these rows
            falls back on this order when two groups tie, so it has to be the
            one the business would give: the day the hire was closed, then the
            id, so the answer is the same on every run. */
         ORDER BY a.closed_at, e.id`),
      exec.execute(sql`
        SELECT s.id, s.name, s.role::text AS role, s.photo, s.hue, s.monthly_target
          FROM ${staff} s WHERE s.status <> 'deleted' ORDER BY s.id`),
      exec.select({ id: departments.id, name: departments.name, head: departments.head })
        .from(departments).where(sql`archived_at IS NULL`)
        .orderBy(departments.sortOrder, departments.name),
      exec.select().from(goals).orderBy(goals.month),
      exec.execute(sql`
        SELECT c.id, c.name, c.gender, c.sector, c.years_experience, c.current_salary,
               c.current_salary_source, c.current_company, c.photo, c.hue
          FROM ${candidates} c
         WHERE EXISTS (SELECT 1 FROM ${applications} a JOIN ${jobs} j ON j.id = a.job_id
                        WHERE a.candidate_id = c.id AND ${scope})`),
    ]);

  const hist = new Map<string, Array<{ stage: StageKey; at: string }>>();
  for (const h of rowsOf(histRows)) {
    hist.set(h.application_id, [...(hist.get(h.application_id) ?? []),
      { stage: h.stage as StageKey, at: String(h.at) }]);
  }
  const scores = new Map<string, number[]>();
  for (const e of rowsOf(evalRows)) {
    scores.set(e.application_id, [...(scores.get(e.application_id) ?? []), Number(e.overall)]);
  }

  const apps: AppRow[] = rowsOf(appRows).map((r) => ({
    id: r.id, jobId: r.job_id, candidateId: r.candidate_id, deptId: r.dept_id,
    deptName: r.dept_name, functionName: r.function_name, jobTitle: r.job_title,
    jobFamily: r.family, recruiterId: r.recruiter_id, recruiterName: r.recruiter_name,
    sourcerId: r.sourcer_id, source: r.source, stage: r.stage as StageKey, status: r.status,
    appliedAt: String(r.applied_at), closedAt: r.closed_at ? String(r.closed_at) : null,
    stageEnteredAt: String(r.stage_entered_at),
    stageName: r.stage_name ?? DEFAULT_NAMES[r.stage as StageKey] ?? r.stage,
    sla: Number(r.sla),
    rating: r.rating == null ? null : Number(r.rating),
    history: hist.get(r.id) ?? [],
    scores: scores.get(r.id) ?? [],
  }));

  return {
    apps,
    offers: rowsOf(offerRows).map((r) => ({
      id: r.id, applicationId: r.application_id, jobId: r.job_id, candidateId: r.candidate_id,
      deptName: r.dept_name, jobTitle: r.job_title, candidateName: r.candidate_name,
      state: r.state, baseMonthly: Number(r.base_monthly),
      sentAt: r.sent_at ? String(r.sent_at) : null,
      responseAt: r.response_at ? String(r.response_at) : null,
      responseReason: r.response_reason, responseNote: r.response_note,
      questions: Number(r.questions),
      asked: Number(r.asked), answered: Number(r.answered),
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at as string).toISOString() : null,
      openQuestion: r.last_from === 'candidate',
    })),
    jobs: rowsOf(jobRows).map((r) => ({
      id: r.id, title: r.title, status: r.status, deptId: r.dept_id, deptName: r.dept_name,
      city: r.city ?? null,
      openings: Number(r.openings), filled: Number(r.filled),
      salaryMin: Number(r.salary_min), salaryMax: Number(r.salary_max),
      budgeted: r.budgeted, budgetNote: r.budget_note, openedOn: r.opened_on,
      sourcerId: r.sourcer_id ?? null, coordinatorId: r.coordinator_id ?? null,
      priority: r.priority ?? 'normal',
      hiringManager: r.hiring_manager, recruiterId: r.recruiter_id, archived: !!r.archived_at,
    })),
    /* An employee is not a candidate. The portrait on the CV was given for an
       application, so it stays on the candidate record; a joiner is drawn from
       their own row, which is initials and the tint their name resolves to. */
    hires: rowsOf(hireRows).map((r) => ({
      employeeId: r.id, candidateId: r.candidate_id,
      name: r.name, jobId: r.job_id, deptId: r.dept_id, deptName: r.dept_name,
      title: r.title, startDate: r.start_date, applicationId: r.application_id,
      source: r.source, recruiterName: r.recruiter_name,
      probation: {
        state: r.p_state ?? 'in_progress', endsOn: r.p_ends ?? r.start_date,
        reason: r.p_reason, decidedOn: r.p_decided,
      },
    })),
    staff: rowsOf(staffRows).map((r) => ({
      id: r.id, name: r.name, role: r.role, roleLabel: ROLE_LABEL[r.role] ?? r.role,
      photo: r.photo, hue: Number(r.hue ?? 3), monthlyTarget: Number(r.monthly_target ?? 0),
    })),
    departments: deptRows,
    goals: goalRows.map((g) => ({
      month: g.month, hires: g.hires,
      timeToHireDays: g.timeToHireDays,
      qualityOfHire: g.qualityOfHire == null ? null : Number(g.qualityOfHire),
      costPerHireSar: g.costPerHireSar ?? null,
    })),
    candidates: new Map(rowsOf(candRows).map((c) => [c.id, {
      name: c.name, gender: c.gender, sector: c.sector,
      yearsExperience: c.years_experience == null ? null : Number(c.years_experience),
      currentSalary: c.current_salary == null ? null : Number(c.current_salary),
      currentSalarySource: c.current_salary_source, currentCompany: c.current_company,
      photo: c.photo, hue: Number(c.hue ?? 3),
    }])),
  };
}

export const ROLE_LABEL: Record<string, string> = {
  tal_lead: 'Head of TA', recruiter: 'Recruiter', sourcer: 'Sourcer',
  coordinator: 'Coordinator', analyst: 'Analyst', onboarding: 'Onboarding',
};

/* ── The arithmetic ─────────────────────────────────────────────────────── */
export const med = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
export const pct = (a: number, b: number): number => (b ? a / b : 0);
export const p90 = (xs: number[]): number =>
  (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] ?? 0 : 0);
export const days = (a: string, b: string): number =>
  (Date.parse(b) - Date.parse(a)) / 86_400_000;

export const isLive = (a: AppRow): boolean => a.status === 'active' || a.status === 'on_hold';

/** What the period is allowed to talk about: anything that arrived or closed
    inside it, plus everything still open — an application that has sat in one
    stage since spring is still this morning's problem. */
export const scopeOf = (apps: AppRow[], w: Window, now: Date): AppRow[] =>
  apps.filter((a) => inWindow(a.appliedAt, w, now)
    || (a.closedAt && inWindow(a.closedAt, w, now))
    || isLive(a));

export const hiresIn = (apps: AppRow[], w: Window, now: Date): AppRow[] =>
  apps.filter((a) => a.status === 'hired' && inWindow(a.closedAt, w, now));

/* ── Dwell times ────────────────────────────────────────────────────────────
   A spell is one application's stay in one stage, taken from its own history:
   the step into the stage to the step out of it, and for a stage nobody has
   left yet, the step in to now. Still-open spells are therefore truncated and
   pull the medians down rather than up, which the report says out loud. */
export type Spell = { stage: StageKey; d: number; open: boolean };

export function spells(apps: AppRow[], now: Date): Spell[] {
  const out: Spell[] = [];
  for (const a of apps) {
    const h = a.history;
    const live = isLive(a);
    for (let i = 0; i < h.length; i++) {
      const next = h[i + 1]?.at ?? a.closedAt ?? null;
      /* The last stage of an application that is neither live nor closed has no
         end: it is not still running and it did not finish, so there is no
         dwell to measure and it is left out rather than measured to now. */
      const d = next != null ? days(h[i].at, next) : (live ? days(h[i].at, now.toISOString()) : null);
      if (d == null || d < 0) continue;
      out.push({ stage: h[i].stage, d, open: !h[i + 1] && live });
    }
  }
  return out;
}

export type TatRow = {
  key: StageKey; name: string; sla: number; n: number;
  median: number; mean: number; p90: number;
  breaches: number; breachRate: number; openNow: number; closedN: number;
};

export function tat(apps: AppRow[], now: Date): TatRow[] {
  const all = spells(apps, now);
  return STAGE_KEYS.map((k): TatRow => {
    const mine = all.filter((s) => s.stage === k);
    const sla = DEFAULT_SLA[k];
    const ds = mine.map((s) => s.d);
    const breaches = mine.filter((s) => s.d > sla).length;
    return {
      key: k, name: DEFAULT_NAMES[k], sla, n: mine.length,
      median: med(ds), mean: mean(ds), p90: p90(ds),
      breaches, breachRate: pct(breaches, mine.length),
      openNow: mine.filter((s) => s.open).length,
      closedN: mine.filter((s) => !s.open).length,
    };
  }).filter((r) => r.n > 0);
}

/* ── The funnel ─────────────────────────────────────────────────────────────
   Applied and Sourced are alternative entries, so they collapse into one top
   row. Each row reports the share of the people who ENTERED that stage who then
   went further — always at most 100%, and it means the same thing on every
   pipeline, which "conversion from the row above" does not when a template
   skips a stage. */
export type FunnelRow = { key: string; name: string; n: number; convFromPrev: number | null; convFromTop: number };

export function funnel(list: AppRow[], keys: StageKey[] = [...STAGE_KEYS]): FunnelRow[] {
  const ks = keys.filter((k) => k !== 'sourced');
  const entered: Record<string, number> = {};
  const passed: Record<string, number> = {};
  for (const k of ks) { entered[k] = 0; passed[k] = 0; }

  for (const a of list) {
    const idxs = a.history.map((h) => STAGE_INDEX[h.stage] ?? -1);
    const maxIdx = Math.max(...idxs, a.status === 'hired' ? STAGE_INDEX.joined : -1);
    const seen = new Set(a.history.map((h) => (h.stage === 'sourced' ? 'applied' : h.stage)));
    for (const k of ks) {
      if (!seen.has(k)) continue;
      entered[k] += 1;
      if (maxIdx > STAGE_INDEX[k]) passed[k] += 1;
    }
  }

  return ks.map((k) => ({
    key: k,
    name: k === 'applied' ? 'Applied or sourced' : DEFAULT_NAMES[k],
    n: entered[k],
    convFromPrev: k === 'joined' ? null : pct(passed[k], entered[k]),
    convFromTop: pct(entered[k], entered[ks[0]] || 1),
  }));
}

export const timeToHire = (list: AppRow[]) => {
  const h = list.filter((a) => a.status === 'hired' && a.closedAt);
  const ds = h.map((a) => days(a.appliedAt, a.closedAt!));
  return { median: med(ds), mean: mean(ds), n: h.length };
};

export const timeToFill = (list: AppRow[], jobsById: Map<string, JobRow>) => {
  const ds = list.filter((a) => a.status === 'hired' && a.closedAt)
    .map((a) => {
      const j = jobsById.get(a.jobId);
      return j?.openedOn ? days(j.openedOn, a.closedAt!) : null;
    })
    .filter((x): x is number => x != null && x > 0);
  return { median: med(ds), mean: mean(ds), n: ds.length };
};

export const timeToFirstResponse = (list: AppRow[]) => {
  const ds = list.filter((a) => a.history.length > 1)
    .map((a) => days(a.history[0].at, a.history[1].at));
  return { median: med(ds), mean: mean(ds), n: ds.length };
};

export type SourceRow = { source: string; applications: number; hires: number; conv: number; interviewed: number };

export function sourceMix(list: AppRow[]): SourceRow[] {
  const g = new Map<string, AppRow[]>();
  for (const a of list) g.set(a.source, [...(g.get(a.source) ?? []), a]);
  return [...g.entries()].map(([source, v]) => ({
    source,
    applications: v.length,
    hires: v.filter((a) => a.status === 'hired').length,
    conv: pct(v.filter((a) => a.status === 'hired').length, v.length),
    interviewed: v.filter((a) => a.history.some((h) => ['iv1', 'iv2', 'ivf'].includes(h.stage))).length,
  })).sort((a, b) => b.applications - a.applications);
}

export type DeptStat = {
  id: string; name: string; head: string | null; openReqs: number; openings: number;
  live: number; hires: number; timeToHire: number;
};

export function deptStats(d: Dataset, w: Window, now: Date): DeptStat[] {
  return d.departments.map((dep) => {
    const js = d.jobs.filter((j) => j.deptId === dep.id);
    const as = d.apps.filter((a) => a.deptId === dep.id);
    const h = as.filter((a) => a.status === 'hired' && inWindow(a.closedAt, w, now));
    const open = js.filter((j) => j.status === 'open');
    return {
      id: dep.id, name: dep.name, head: dep.head,
      openReqs: open.length,
      openings: sum(open.map((j) => j.openings)),
      live: as.filter(isLive).length,
      hires: h.length,
      timeToHire: med(h.map((a) => days(a.appliedAt, a.closedAt!))),
    };
  }).sort((a, b) => b.openReqs - a.openReqs);
}

/* ── Recruiter performance ──────────────────────────────────────────────── */
export type RecruiterStat = {
  id: string; person: Dataset['staff'][number]; hires: number; target: number;
  attainment: number | null; openReqs: number; reqs: number; livePipeline: number;
  advanced: number; interviews: number; offersSent: number; offerAccept: number | null;
  timeToHire: number; responseDays: number; scorecards: number;
  slaBreaches: number; slaRate: number | null; quality: number | null;
  own: AppRow[];
};

export function leaderboard(
  d: Dataset, w: Window, now: Date,
  extra: { interviewsBy: Map<string, number>; scorecardsBy: Map<string, number> },
  deptId?: string,
): RecruiterStat[] {
  const months = Math.max(1, w.days / 30.4);
  const recruiters = d.staff.filter((s) => s.role === 'recruiter' || s.role === 'tal_lead');
  /* Ranked by hires, which is the order every screen that shows this table
     expects to find it in. */
  return recruiters.map((p): RecruiterStat => {
    const own = d.apps.filter((a) => a.recruiterId === p.id && (!deptId || a.deptId === deptId));
    const win = own.filter((a) => inWindow(a.appliedAt, w, now)
      || (a.closedAt && inWindow(a.closedAt, w, now)) || isLive(a));
    const h = own.filter((a) => a.status === 'hired' && inWindow(a.closedAt, w, now));
    const liveOwn = own.filter(isLive);
    const reqs = d.jobs.filter((j) => j.recruiterId === p.id && (!deptId || j.deptId === deptId));
    const offs = d.offers.filter((o) => o.sentAt && inWindow(o.sentAt, w, now)
      && own.some((a) => a.id === o.applicationId));
    const acc = offs.filter((o) => o.state === 'accepted').length;
    const dec = offs.filter((o) => o.state === 'declined').length;
    const target = Math.round(p.monthlyTarget * months);
    const breach = liveOwn.filter((a) => days(a.stageEnteredAt, now.toISOString()) > a.sla).length;
    const q = h.map((a) => (a.scores.length ? mean(a.scores) : null)).filter((x): x is number => x != null);
    return {
      id: p.id, person: p,
      hires: h.length, target,
      attainment: target ? h.length / target : null,
      openReqs: reqs.filter((j) => j.status === 'open').length,
      reqs: reqs.length,
      livePipeline: liveOwn.length,
      advanced: win.filter((a) => a.history.length > 1).length,
      interviews: extra.interviewsBy.get(p.id) ?? 0,
      offersSent: offs.length,
      offerAccept: acc + dec ? acc / (acc + dec) : null,
      timeToHire: med(h.map((a) => days(a.appliedAt, a.closedAt!))),
      responseDays: med(win.filter((a) => a.history.length > 1).map((a) => days(a.history[0].at, a.history[1].at))),
      scorecards: extra.scorecardsBy.get(p.id) ?? 0,
      slaBreaches: breach,
      slaRate: liveOwn.length ? 1 - breach / liveOwn.length : null,
      quality: q.length ? mean(q) : null,
      /* The applications this person's own dwell times are read from: what they
         are carrying now, plus what they closed inside the period. An
         application that arrived in the period and was closed outside it belongs
         to neither. */
      own: [...liveOwn, ...own.filter((a) => a.closedAt && inWindow(a.closedAt, w, now))],
    };
  }).sort((a, b) => b.hires - a.hires);
}

/** The two counts the leaderboard needs that do not hang off an application. */
export async function recruiterExtras(v: Viewer, w: Window, now: Date, exec: Exec = db()) {
  const prev = previous(w, now);
  const from = w.kind === 'range' ? w.from : null;
  const scope = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const [ivRows, scRows] = await Promise.all([
    exec.execute(sql`
      SELECT a.recruiter_id, count(*)::int AS n
        FROM ${interviews} i JOIN ${applications} a ON a.id = i.application_id
       WHERE ${scope} AND i.at >= ${at(now)} - (${Math.round(w.days)} || ' days')::interval
         AND i.at <= ${at(now)}
       GROUP BY 1`),
    exec.execute(sql`
      SELECT e.evaluator_id, count(*)::int AS n FROM ${evaluations} e
       WHERE e.submitted AND e.evaluator_id IS NOT NULL GROUP BY 1`),
  ]);
  return {
    interviewsBy: new Map(rowsOf(ivRows).filter((r) => r.recruiter_id).map((r) => [r.recruiter_id, Number(r.n)])),
    scorecardsBy: new Map(rowsOf(scRows).map((r) => [r.evaluator_id, Number(r.n)])),
  };
}

/* ── Monthly rollup ─────────────────────────────────────────────────────── */
export type MonthRow = {
  month: string; label: string; applications: number; hires: number;
  interviews: number; offersSent: number; offerAccept: number;
  target: number; attainment: number; timeToHire: number;
};

export function monthly(
  d: Dataset, keys: string[], interviewsByMonth: Map<string, number>, deptId?: string,
): MonthRow[] {
  const goal = new Map(d.goals.map((g) => [g.month, g.hires]));
  const apps = deptId ? d.apps.filter((a) => a.deptId === deptId) : d.apps;
  const offs = deptId
    ? d.offers.filter((o) => apps.some((a) => a.id === o.applicationId))
    : d.offers;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return keys.map((k) => {
    const hs = apps.filter((a) => a.status === 'hired' && String(a.closedAt).slice(0, 7) === k);
    const os = offs.filter((o) => String(o.sentAt).slice(0, 7) === k);
    const acc = os.filter((o) => o.state === 'accepted').length;
    const dec = os.filter((o) => o.state === 'declined').length;
    const [y, m] = k.split('-');
    return {
      month: k,
      label: `${MONTHS[Number(m) - 1]} ${y.slice(2)}`,
      applications: apps.filter((a) => a.appliedAt.slice(0, 7) === k).length,
      hires: hs.length,
      interviews: interviewsByMonth.get(k) ?? 0,
      offersSent: os.length,
      offerAccept: pct(acc, acc + dec || 1),
      target: goal.get(k) ?? 0,
      attainment: pct(hs.length, goal.get(k) ?? 1),
      timeToHire: med(hs.map((a) => days(a.appliedAt, a.closedAt!))),
    };
  });
}

/** Interviews per calendar month, which no application row carries. */
export async function interviewsByMonth(v: Viewer, exec: Exec = db()): Promise<Map<string, number>> {
  const rows = rowsOf(await exec.execute(sql`
    SELECT to_char(i.at, 'YYYY-MM') AS m, count(*)::int AS n FROM ${interviews} i
     WHERE i.status <> 'cancelled'
       AND i.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})
     GROUP BY 1`));
  return new Map(rows.map((r) => [r.m, Number(r.n)]));
}

/* ── Who a name belongs to ──────────────────────────────────────────────────
   Interviewers are recorded by name on the interview, because a panel member is
   often somebody who does not use the platform. This resolves those names to a
   title for display: a TA staff member's, else the account's, else the fallback
   the product uses for a hiring manager who was never given a login. */
export async function titlesByName(
  names: string[], exec: Exec = db(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!names.length) return out;
  const list = sql.join(names.map((n) => sql`${n}`), sql`, `);
  const rows = rowsOf(await exec.execute(sql`
    SELECT s.name, s.title FROM ${staff} s WHERE s.name IN (${list})
    UNION ALL
    SELECT a.name, a.title FROM accounts a WHERE a.name IN (${list}) AND a.title IS NOT NULL`));
  for (const r of rows) if (r.title && !out.has(r.name)) out.set(r.name, r.title);
  for (const n of names) if (!out.has(n)) out.set(n, 'Hiring manager');
  return out;
}
