import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  staff, jobs, applications, interviews, offers, offerLetterEdits, evaluations, tasks, candidates,
  locations, departments,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import * as A from './analytics';
import * as W from '@/lib/domain/window';
import { claimDaysLeft } from '@/lib/domain/claim';
import { carriesTarget, type RoleKey } from '@/lib/domain/team';
import { isDecided, type ProbationRow } from '@/lib/domain/probation';

/* ═════════════════════════════════════════════════════════════════════════════
   TEAM

   The desk itself: who is on it, what each person is carrying and how the
   period treated them.

   Everything here is read through the same scoped dataset the reports use, so
   a recruiter's hires on their own profile and their row on the Insights
   leaderboard are the same number by construction. The four roles that own no
   applications are measured separately — see lib/domain/team.ts — because
   reading a sourcer against hires would say they did nothing.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Person = {
  id: string;
  name: string;
  title: string;
  role: string;
  roleLabel: string;
  email: string;
  phone: string | null;
  photo: string | null;
  hue: number;
  seniority: string | null;
  locationCity: string | null;
  locationOffice: string | null;
  deptIds: string[];
  deptNames: string[];
  monthlyTarget: number;
  lifetimeHires: number;
  joinedOn: string | null;
  status: string;
  placeholderName: boolean;
  deletedAt: string | null;
  deletedByName: string | null;
  handedOverToName: string | null;
};

const PERSON_SQL = sql`
  SELECT s.id, s.name, s.title, s.role::text AS role, s.role_label, s.email, s.phone,
         s.photo, s.hue, s.seniority, s.dept_ids, s.monthly_target, s.lifetime_hires,
         s.joined_on::text AS joined_on, s.status::text AS status, s.placeholder_name,
         s.deleted_at, s.handed_over_to,
         l.city, l.office,
         (SELECT name FROM ${staff} h WHERE h.id = s.handed_over_to) AS handed_name
    FROM ${staff} s
    LEFT JOIN ${locations} l ON l.id = s.location_id`;

function toPerson(r: Record<string, any>, deptNames: Map<string, string>): Person {
  const ids: string[] = (r.dept_ids ?? []) as string[];
  return {
    id: r.id, name: r.name, title: r.title, role: r.role, roleLabel: r.role_label,
    email: r.email, phone: r.phone ?? null, photo: r.photo ?? null, hue: Number(r.hue ?? 1),
    seniority: r.seniority ?? null,
    locationCity: r.city ?? null, locationOffice: r.office ?? null,
    deptIds: ids,
    deptNames: ids.map((id) => deptNames.get(id)).filter((x): x is string => !!x),
    monthlyTarget: Number(r.monthly_target ?? 0),
    lifetimeHires: Number(r.lifetime_hires ?? 0),
    joinedOn: r.joined_on ?? null,
    status: r.status,
    placeholderName: !!r.placeholder_name,
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    deletedByName: null,
    handedOverToName: r.handed_name ?? null,
  };
}

async function deptNameMap(exec: Exec): Promise<Map<string, string>> {
  const rows = await exec.select({ id: departments.id, name: departments.name }).from(departments);
  return new Map(rows.map((d) => [d.id, d.name]));
}

/* ── The contribution of the roles that own nothing ──────────────────────────
   A sourcer is named on the application, a coordinator on the interview, an
   onboarding specialist on the offer letter they checked. None of that hangs
   off an application they own, so it is read here rather than inferred from a
   leaderboard row that would be zero for all of them. */
export type Support = {
  sourced: number;
  sourcedAllTime: number;
  interviews: number;
  interviewsHeld: number;
  interviewsAllTime: number;
  verified: number;
  verifiedAllTime: number;
  corrections: number;
  joinersAhead: number;
  openTasks: number;
  coordinatorReqs: number;
  /** Applications they sourced, for the funnel and the dwell times. */
  sourcedApps: A.AppRow[];
  /** Twelve months of whatever this role is measured on. */
  monthly: Array<{ label: string; value: number }>;
  monthlyTitle: string;
  monthlySub: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

export async function support(
  v: Viewer, person: Person, w: W.Window, now: Date, data: A.Dataset, exec: Exec = db(),
): Promise<Support> {
  const role = person.role as RoleKey;
  const scope = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const since = sql`${at(now)} - (${Math.round(w.days)} || ' days')::interval`;

  const [ivRows, verifiedRows, editRows, taskRows, coordRows] = await Promise.all([
    /* An interview belongs to a coordinator when they organised it, and to a
       sourcer when it sits on an application they brought in. */
    exec.execute(sql`
      SELECT i.id, i.at, i.status::text AS status
        FROM ${interviews} i JOIN ${applications} a ON a.id = i.application_id
       WHERE ${scope} AND ${role === 'coordinator'
          ? sql`i.organiser_id = ${person.id}`
          : sql`a.sourcer_id = ${person.id}`}`),
    exec.execute(sql`
      SELECT o.id, o.verified_at, o.state::text AS state, o.start_date::text AS start_date
        FROM ${offers} o JOIN ${applications} a ON a.id = o.application_id
       WHERE ${scope} AND o.verified_by = ${person.id}`),
    exec.execute(sql`
      SELECT e.id FROM ${offerLetterEdits} e
        JOIN ${offers} o ON o.id = e.offer_id
        JOIN ${applications} a ON a.id = o.application_id
       WHERE ${scope} AND e.by_id = ${person.id} AND e.at >= ${since} AND e.at <= ${at(now)}`),
    exec.execute(sql`
      SELECT count(*)::int AS n FROM ${tasks} t
       WHERE t.assignee_id = ${person.id} AND t.done_at IS NULL`),
    exec.execute(sql`
      SELECT count(*)::int AS n FROM ${jobs} j
       WHERE j.coordinator_id = ${person.id} AND j.status = 'open'
         AND j.id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`),
  ]);

  const iv = rowsOf(ivRows).map((r) => ({
    at: String(r.at), status: r.status as string,
  })).filter((i) => i.status !== 'cancelled');
  const ivWin = iv.filter((i) => W.inWindow(i.at, w, now));

  const verified = rowsOf(verifiedRows).map((r) => ({
    at: r.verified_at ? new Date(r.verified_at).toISOString() : null,
    state: r.state as string,
    startDate: r.start_date as string | null,
  }));
  const verifiedWin = verified.filter((o) => o.at && W.inWindow(o.at, w, now));

  const sourcedApps = data.apps.filter((a) => a.sourcerId === person.id);
  const sourcedWin = sourcedApps.filter((a) => W.inWindow(a.appliedAt, w, now));

  /* Twelve months of the one series this role is judged on. */
  const keys = W.monthKeys(12, now);
  const count = (pick: (k: string) => number) =>
    keys.map((k) => ({ label: monthLabel(k), value: pick(k) }));
  const monthly = role === 'sourcer'
    ? count((k) => sourcedApps.filter((a) => a.appliedAt.slice(0, 7) === k).length)
    : role === 'onboarding'
      ? count((k) => verified.filter((o) => o.at?.slice(0, 7) === k).length)
      : role === 'coordinator'
        ? count((k) => iv.filter((i) => i.at.slice(0, 7) === k).length)
        : [];
  const last = monthly[monthly.length - 1]?.label ?? '';

  return {
    sourced: sourcedWin.length,
    sourcedAllTime: sourcedApps.length,
    interviews: ivWin.length,
    interviewsHeld: ivWin.filter((i) => i.status === 'completed').length,
    interviewsAllTime: iv.length,
    verified: verifiedWin.length,
    verifiedAllTime: verified.length,
    corrections: rowsOf(editRows).length,
    joinersAhead: verified.filter((o) => o.state === 'accepted'
      && o.startDate && o.startDate >= now.toISOString().slice(0, 10)).length,
    openTasks: Number(rowsOf(taskRows)[0]?.n ?? 0),
    coordinatorReqs: Number(rowsOf(coordRows)[0]?.n ?? 0),
    sourcedApps,
    monthly,
    monthlyTitle: role === 'sourcer' ? 'Applications sourced, by month'
      : role === 'onboarding' ? 'Offer letters verified, by month'
        : role === 'coordinator' ? 'Interviews scheduled, by month' : 'Monthly record',
    monthlySub: role === 'sourcer'
      ? `Twelve months to ${last}, counted on the application date.`
      : role === 'onboarding'
        ? `Twelve months to ${last}, on the day the letter was checked.`
        : role === 'coordinator'
          ? `Twelve months to ${last}, on the interview date.`
          : '',
  };
}

/* ── One person's numbers ──────────────────────────────────────────────────── */
export type Stat = A.RecruiterStat & {
  sourced: number;
  hiresPerMonth: number;
  funnelOwn: A.FunnelRow[];
  tatOwn: A.TatRow[];
};

/** The leaderboard row for one person, whatever their role. */
export function statOf(
  d: A.Dataset, w: W.Window, now: Date,
  extra: { interviewsBy: Map<string, number>; scorecardsBy: Map<string, number> },
  personId: string,
): Stat | null {
  const person = d.staff.find((s) => s.id === personId);
  if (!person) return null;
  const months = Math.max(1, w.days / 30.4);
  const own = d.apps.filter((a) => a.recruiterId === personId);
  const win = own.filter((a) => W.inWindow(a.appliedAt, w, now)
    || (a.closedAt && W.inWindow(a.closedAt, w, now)) || A.isLive(a));
  const h = own.filter((a) => a.status === 'hired' && W.inWindow(a.closedAt, w, now));
  const liveOwn = own.filter(A.isLive);
  const reqs = d.jobs.filter((j) => j.recruiterId === personId);
  const offs = d.offers.filter((o) => o.sentAt && W.inWindow(o.sentAt, w, now)
    && own.some((a) => a.id === o.applicationId));
  const acc = offs.filter((o) => o.state === 'accepted').length;
  const dec = offs.filter((o) => o.state === 'declined').length;
  const target = Math.round(person.monthlyTarget * months);
  const breach = liveOwn.filter((a) => A.days(a.stageEnteredAt, now.toISOString()) > a.sla).length;
  const q = h.map((a) => (a.scores.length ? A.mean(a.scores) : null))
    .filter((x): x is number => x != null);
  const scoped = [...liveOwn, ...own.filter((a) => a.closedAt && W.inWindow(a.closedAt, w, now))];

  return {
    id: person.id, person,
    hires: h.length, target,
    attainment: target ? h.length / target : null,
    openReqs: reqs.filter((j) => j.status === 'open').length,
    reqs: reqs.length,
    livePipeline: liveOwn.length,
    advanced: win.filter((a) => a.history.length > 1).length,
    interviews: extra.interviewsBy.get(personId) ?? 0,
    offersSent: offs.length,
    offerAccept: acc + dec ? acc / (acc + dec) : null,
    timeToHire: A.med(h.map((a) => A.days(a.appliedAt, a.closedAt!))),
    responseDays: A.med(win.filter((a) => a.history.length > 1)
      .map((a) => A.days(a.history[0].at, a.history[1].at))),
    scorecards: extra.scorecardsBy.get(personId) ?? 0,
    slaBreaches: breach,
    slaRate: liveOwn.length ? 1 - breach / liveOwn.length : null,
    quality: q.length ? A.mean(q) : null,
    own: scoped,
    sourced: own.filter((a) => a.source === 'Sourced — Outbound'
      && W.inWindow(a.appliedAt, w, now)).length,
    hiresPerMonth: h.length / months,
    funnelOwn: A.funnel(win),
    tatOwn: A.tat(scoped, now),
  };
}

/* ── The list ────────────────────────────────────────────────────────────── */
export type TeamList = {
  people: Person[];
  stats: Map<string, Stat>;
  support: Map<string, { sourced: number; interviews: number; verified: number; corrections: number; openTasks: number }>;
  hires: number;
  target: number;
  timeToHire: { median: number; n: number };
  livePipeline: number;
  openReqs: number;
  openings: number;
  roleCounts: Map<string, number>;
};

export async function teamList(
  v: Viewer, w: W.Window, now: Date, exec: Exec = db(),
): Promise<TeamList> {
  const [data, extras, deptNames, personRows, supportRows] = await Promise.all([
    A.dataset(v, now, exec),
    A.recruiterExtras(v, w, now, exec),
    deptNameMap(exec),
    exec.execute(sql`${PERSON_SQL} WHERE s.status <> 'deleted' ORDER BY s.id`),
    /* The three support counts every card needs, in one pass rather than one
       query per person. */
    exec.execute(sql`
      SELECT s.id,
             (SELECT count(*)::int FROM ${applications} a
               WHERE a.sourcer_id = s.id
                 AND a.applied_at >= ${at(now)} - (${Math.round(w.days)} || ' days')::interval
                 AND a.applied_at <= ${at(now)}
                 AND a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})) AS sourced,
             (SELECT count(*)::int FROM ${interviews} i
                JOIN ${applications} a ON a.id = i.application_id
               WHERE i.status <> 'cancelled'
                 AND i.at >= ${at(now)} - (${Math.round(w.days)} || ' days')::interval
                 AND i.at <= ${at(now)}
                 AND (CASE WHEN s.role = 'coordinator' THEN i.organiser_id = s.id
                           ELSE a.sourcer_id = s.id END)
                 AND a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})) AS interviews,
             (SELECT count(*)::int FROM ${offers} o
                JOIN ${applications} a ON a.id = o.application_id
               WHERE o.verified_by = s.id
                 AND o.verified_at >= ${at(now)} - (${Math.round(w.days)} || ' days')::interval
                 AND o.verified_at <= ${at(now)}
                 AND a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})) AS verified,
             (SELECT count(*)::int FROM ${offerLetterEdits} e
                JOIN ${offers} o ON o.id = e.offer_id
                JOIN ${applications} a ON a.id = o.application_id
               WHERE e.by_id = s.id
                 AND e.at >= ${at(now)} - (${Math.round(w.days)} || ' days')::interval
                 AND e.at <= ${at(now)}
                 AND a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})) AS corrections,
             (SELECT count(*)::int FROM ${tasks} t
               WHERE t.assignee_id = s.id AND t.done_at IS NULL) AS open_tasks
        FROM ${staff} s WHERE s.status <> 'deleted' ORDER BY s.id`),
  ]);

  const people = rowsOf(personRows).map((r) => toPerson(r, deptNames));
  const stats = new Map<string, Stat>();
  for (const p of people) {
    const s = statOf(data, w, now, extras, p.id);
    if (s) stats.set(p.id, s);
  }

  const supportBy = new Map(rowsOf(supportRows).map((r) => [r.id as string, {
    sourced: Number(r.sourced ?? 0),
    interviews: Number(r.interviews ?? 0),
    verified: Number(r.verified ?? 0),
    corrections: Number(r.corrections ?? 0),
    openTasks: Number(r.open_tasks ?? 0),
  }]));

  const ids = new Set(people.map((p) => p.id));
  const openJobs = data.jobs.filter((j) => j.status === 'open' && j.recruiterId && ids.has(j.recruiterId));
  const roleCounts = new Map<string, number>();
  for (const p of people) roleCounts.set(p.role, (roleCounts.get(p.role) ?? 0) + 1);

  return {
    people,
    stats,
    support: supportBy,
    hires: A.sum(people.map((p) => stats.get(p.id)?.hires ?? 0)),
    target: A.sum(people.map((p) => stats.get(p.id)?.target ?? 0)),
    timeToHire: A.timeToHire(A.hiresIn(data.apps, w, now)),
    livePipeline: A.sum(people.map((p) => stats.get(p.id)?.livePipeline ?? 0)),
    openReqs: openJobs.length,
    openings: A.sum(openJobs.map((j) => Math.max(0, j.openings - j.filled))),
    roleCounts,
  };
}

/* ── One profile ─────────────────────────────────────────────────────────── */
export type ProfileReq = {
  id: string; title: string; deptName: string; city: string | null;
  status: string; priority: string; live: number; filled: number; openings: number;
  openedOn: string | null;
};

export type ProfileClaim = {
  candidateId: string; name: string; photo: string | null; hue: number;
  where: string; stage: string | null; stageName: string | null; jobId: string | null;
  at: string; daysLeft: number; note: string | null;
};

export type ProfileChase = {
  applicationId: string; name: string; photo: string | null; hue: number;
  jobTitle: string; stage: string; stageName: string; inStage: number; overBy: number;
};

export type Profile = {
  person: Person;
  stat: Stat;
  support: Support;
  hiring: boolean;
  /* Twelve months of their own hires, for the chart that sets them against
     their own monthly target rather than the team's. */
  monthly: Array<{ month: string; label: string; hires: number }>;
  /* The funnel and the dwell times of the applications they sourced — read
     only when they own none of their own. */
  sourcedFunnel: A.FunnelRow[] | null;
  sourcedTat: A.TatRow[] | null;
  requisitions: ProfileReq[];
  claims: ProfileClaim[];
  claimsLapsed: number;
  chase: ProfileChase[];
  liveOwned: number;
  pipelineGroups: Array<{ label: string; value: number }>;
  pipelineOverSla: number;
  quality: {
    hired: number; decided: number; passed: number; failed: number; inside: number;
    rate: number | null; reasons: Array<{ reason: string; n: number }>;
  };
};


export async function profile(
  v: Viewer, id: string, w: W.Window, now: Date, exec: Exec = db(),
): Promise<Profile | { missing: true; person: Person | null }> {
  const [data, extras, deptNames, personRows] = await Promise.all([
    A.dataset(v, now, exec),
    A.recruiterExtras(v, w, now, exec),
    deptNameMap(exec),
    exec.execute(sql`${PERSON_SQL} WHERE s.id = ${id}`),
  ]);
  const row = rowsOf(personRows)[0];
  if (!row) return { missing: true, person: null };
  const person = toPerson(row, deptNames);
  if (person.status === 'deleted') return { missing: true, person };

  const stat = statOf(data, w, now, extras, id)!;
  const sup = await support(v, person, w, now, data, exec);
  const hiring = carriesTarget(person);

  /* The requisitions on their name: owned when they recruit, supported when
     they source or coordinate. */
  const reqJobs = data.jobs.filter((j) => (hiring
    ? j.recruiterId === id
    : j.sourcerId === id || j.coordinatorId === id));
  const liveByJob = new Map<string, number>();
  for (const a of data.apps) {
    if (!A.isLive(a)) continue;
    liveByJob.set(a.jobId, (liveByJob.get(a.jobId) ?? 0) + 1);
  }
  const requisitions: ProfileReq[] = reqJobs.map((j) => ({
    id: j.id, title: j.title, deptName: j.deptName, city: j.city,
    status: j.status, priority: j.priority,
    live: liveByJob.get(j.id) ?? 0,
    filled: j.filled, openings: j.openings, openedOn: j.openedOn,
  })).sort((a, b) => {
    /* Open first, then oldest first inside each group — the order the desk
       works them in. */
    const rank = (x: ProfileReq) => (x.status === 'open' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.openedOn ?? '').localeCompare(b.openedOn ?? '');
  });

  /* Candidates tagged to them, closest to lapsing first. */
  const claimRows = rowsOf(await exec.execute(sql`
    SELECT c.id, c.name, c.photo, c.hue, c.claim_at, c.claim_days, c.claim_note
      FROM ${candidates} c
     WHERE c.claim_by = ${id} AND c.claim_at IS NOT NULL
     ORDER BY c.claim_at ASC`));
  const appsByCand = new Map<string, A.AppRow[]>();
  for (const a of data.apps) {
    appsByCand.set(a.candidateId, [...(appsByCand.get(a.candidateId) ?? []), a]);
  }
  const claimAll = claimRows.map((r) => {
    const list = appsByCand.get(r.id as string) ?? [];
    const liveApp = list.find(A.isLive) ?? null;
    const anyApp = liveApp ?? list[0] ?? null;
    const claimedAt = new Date(r.claim_at as string).toISOString();
    return {
      candidateId: r.id as string,
      name: r.name as string,
      photo: (r.photo ?? null) as string | null,
      hue: Number(r.hue ?? 1),
      where: anyApp ? anyApp.jobTitle : 'Talent pool',
      stage: liveApp?.stage ?? null,
      stageName: liveApp?.stageName ?? null,
      jobId: liveApp?.jobId ?? null,
      at: claimedAt,
      daysLeft: claimDaysLeft(claimedAt, r.claim_days as number | null, now),
      note: (r.claim_note ?? null) as string | null,
    };
  });
  /* Closest to lapsing first — that is the order somebody works down the list,
     and the twenty shown are the twenty that need a decision soonest. */
  const claims = claimAll.filter((c) => c.daysLeft > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const claimsLapsed = claimAll.length - claims.length;

  /* What needs chasing: their live applications past the stage SLA. */
  const mineLive = data.apps.filter((a) => A.isLive(a)
    && (a.recruiterId === id || a.sourcerId === id));
  const chase: ProfileChase[] = mineLive
    .map((a) => {
      const inStage = A.days(a.stageEnteredAt, now.toISOString());
      const c = data.candidates.get(a.candidateId);
      return {
        applicationId: a.id,
        name: c?.name ?? '—', photo: c?.photo ?? null, hue: c?.hue ?? 1,
        jobTitle: a.jobTitle, stage: a.stage, stageName: a.stageName,
        inStage, overBy: inStage - a.sla,
      };
    })
    .filter((x) => x.overBy > 0)
    .sort((a, b) => b.overBy - a.overBy);

  const GROUPS: Array<[string, string[]]> = [
    ['Applied', ['applied', 'sourced']],
    ['Screening', ['screen', 'assessment']],
    ['Interviewing', ['iv1', 'iv2', 'ivf']],
    ['Offer', ['offer']],
  ];
  const pipelineGroups = GROUPS
    .map(([label, keys]) => ({ label, value: mineLive.filter((a) => keys.includes(a.stage)).length }))
    .filter((x) => x.value);

  /* Quality of hire: the three-month probation on the people they hired. */
  const mineHires = data.hires.filter((h) => h.recruiterName === person.name
    && W.inWindow(h.startDate, w, now));
  const decided = mineHires.filter((h) => isDecided(h.probation as ProbationRow));
  const passed = decided.filter((h) => h.probation.state === 'passed');
  const failed = decided.filter((h) => h.probation.state === 'failed');
  const reasonCount: Record<string, number> = {};
  for (const h of failed) {
    const k = h.probation.reason ?? 'Not given';
    reasonCount[k] = (reasonCount[k] ?? 0) + 1;
  }

  const own = data.apps.filter((a) => a.recruiterId === id);
  const monthly = W.monthKeys(12, now).map((k) => ({
    month: k,
    label: monthLabel(k),
    hires: own.filter((a) => a.status === 'hired' && String(a.closedAt).slice(0, 7) === k).length,
  }));

  return {
    person, stat, support: sup, hiring,
    monthly,
    sourcedFunnel: sup.sourcedApps.length ? A.funnel(sup.sourcedApps) : null,
    sourcedTat: sup.sourcedApps.length ? A.tat(sup.sourcedApps, now) : null,
    requisitions, claims, claimsLapsed, chase,
    liveOwned: mineLive.length,
    pipelineGroups,
    pipelineOverSla: chase.length,
    quality: {
      hired: mineHires.length,
      decided: decided.length,
      passed: passed.length,
      failed: failed.length,
      inside: mineHires.length - decided.length,
      rate: decided.length ? passed.length / decided.length : null,
      reasons: Object.entries(reasonCount).map(([reason, n]) => ({ reason, n }))
        .sort((a, b) => b.n - a.n),
    },
  };
}
