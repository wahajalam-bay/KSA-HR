import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import { interviews, jobs, applications, candidates } from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import * as A from './analytics';
import * as W from '@/lib/domain/window';
import { DEFAULT_NAMES, STAGE_INDEX, STAGE_KEYS, type StageKey } from '@/lib/domain/stages';
import {
  CRIT, CRIT_KEYS, MIN_N, band, bandText, isFlagged, scoreFrom,
} from '@/lib/domain/ivreview';
import { isDecided, isOverdue, hasStarted, daysLeft, type ProbationRow } from '@/lib/domain/probation';
import { fmt } from '@/lib/format';

/* ═════════════════════════════════════════════════════════════════════════════
   INSIGHTS

   Eleven tabs over one period control and one department scope. The scope is
   read once and applied to everything — funnel, turnaround, recruiters,
   sources, pay — rather than to one card, so narrowing to a department narrows
   the whole page and the numbers on it still add up.

   Every tab builds from the same scoped dataset in analytics.ts, so two tabs
   cannot quote different figures for the same thing.
   ═════════════════════════════════════════════════════════════════════════════*/

export const INSIGHTS_TABS = [
  { v: 'ask', t: 'Ask AI' },
  { v: 'overview', t: 'Scorecard' },
  { v: 'market', t: 'Hires & pay' },
  { v: 'quality', t: 'Quality of hire' },
  { v: 'tat', t: 'Turnaround' },
  { v: 'recruiters', t: 'Recruiters' },
  { v: 'interviewers', t: 'Interviewers' },
  { v: 'sources', t: 'Sources' },
  { v: 'departments', t: 'Departments' },
  { v: 'offers', t: 'Offers' },
  { v: 'budget', t: 'Budget' },
] as const;

export const PERIOD_NOTE: Record<string, string> = {
  overview: 'Governs the tiles below; the monthly charts always show twelve months.',
  tat: 'Governs the stage figures; the live SLA breaches are always as of today.',
  recruiters: 'Governs every column except live pipeline, which is as of today.',
  interviewers: 'Governs which interviews are counted, by the day they were held.',
  sources: 'Governs which applications are counted.',
  market: 'Governs which hires are analysed; pay is what each person was on before joining.',
  quality: 'Governs which hires are counted, by the day they started.',
  offers: 'Governs which offers are counted, by the date they were sent.',
  budget: 'Requisitions are counted as they stand today; hires and cost follow the period.',
  departments: 'Governs hires and time to hire; requisition counts are as of today.',
};

const EXP_BANDS: Array<[number, number, string]> = [
  [0, 2, '0–2 yrs'], [3, 5, '3–5 yrs'], [6, 9, '6–9 yrs'], [10, 14, '10–14 yrs'], [15, 99, '15+ yrs'],
];
const expBand = (n: number) => (EXP_BANDS.find(([lo, hi]) => n >= lo && n <= hi) ?? EXP_BANDS[0])[2];

const group = <T,>(list: T[], key: (x: T) => string): Map<string, T[]> => {
  const g = new Map<string, T[]>();
  for (const x of list) { const k = key(x); g.set(k, [...(g.get(k) ?? []), x]); }
  return g;
};

export type InsightsContext = {
  data: A.Dataset;
  w: W.Window;
  now: Date;
  deptId: string;
  deptName: string;
  /* The department scope, applied everywhere. */
  apps: A.AppRow[];
  jobs: A.JobRow[];
  offers: A.OfferRow[];
  hires: A.HireRow[];
  jobsById: Map<string, A.JobRow>;
  goalHires: number;
  goalTimeToHire: number | null;
  goalQuality: number | null;
  costPerHireGoal: number | null;
};

export async function context(
  v: Viewer, w: W.Window, deptId: string, now: Date, exec: Exec = db(),
): Promise<InsightsContext> {
  const data = await A.dataset(v, now, exec);
  const apps = deptId ? data.apps.filter((a) => a.deptId === deptId) : data.apps;
  const jobs = deptId ? data.jobs.filter((j) => j.deptId === deptId) : data.jobs;
  const appIds = new Set(apps.map((a) => a.id));
  const offers = deptId ? data.offers.filter((o) => appIds.has(o.applicationId)) : data.offers;
  const hires = deptId ? data.hires.filter((h) => h.deptId === deptId) : data.hires;
  const goal = data.goals;
  return {
    data, w, now, deptId,
    deptName: deptId ? (data.departments.find((d) => d.id === deptId)?.name ?? '') : 'every department',
    apps, jobs, offers, hires,
    jobsById: new Map(data.jobs.map((j) => [j.id, j])),
    goalHires: A.mean(goal.map((g) => g.hires)),
    goalTimeToHire: goal[0]?.timeToHireDays ?? null,
    goalQuality: A.mean(goal.map((g) => g.qualityOfHire ?? 0)) || null,
    costPerHireGoal: goal[0]?.costPerHireSar ?? null,
  };
}

/** The head line under the page title. */
export function headline(c: InsightsContext) {
  const hires = A.hiresIn(c.apps, c.w, c.now).length;
  const target = c.deptId ? null : Math.round(c.goalHires * (c.w.days / 30.4));
  const breaching = c.apps.filter(A.isLive)
    .filter((a) => A.days(a.stageEnteredAt, c.now.toISOString()) > a.sla).length;
  return { hires, target, breaching };
}

const breaches = (c: InsightsContext) => c.apps.filter(A.isLive)
  .filter((a) => A.days(a.stageEnteredAt, c.now.toISOString()) > a.sla)
  .sort((a, b) => (A.days(b.stageEnteredAt, c.now.toISOString()) - b.sla)
    - (A.days(a.stageEnteredAt, c.now.toISOString()) - a.sla));

/* ── The scorecard ──────────────────────────────────────────────────────── */
export async function scorecard(c: InsightsContext, v: Viewer, exec: Exec = db()) {
  const ivMonths = await A.interviewsByMonth(v, exec);
  const keys = W.monthKeys(12, c.now);
  const months = A.monthly(c.data, keys, ivMonths, c.deptId || undefined);
  const hs = A.hiresIn(c.apps, c.w, c.now);
  const scoped = A.scopeOf(c.apps, c.w, c.now);
  const offs = c.offers.filter((o) => o.sentAt && W.inWindow(o.sentAt, c.w, c.now));
  const acc = offs.filter((o) => o.state === 'accepted').length;
  const dec = offs.filter((o) => o.state === 'declined').length;
  const values = hs.map((a) => (a.scores.length ? A.mean(a.scores) : null))
    .filter((x): x is number => x != null);

  return {
    months,
    hires: hs.length,
    target: Math.round(c.goalHires * (c.w.days / 30.4)),
    timeToHire: A.timeToHire(hs),
    goalTimeToHire: c.goalTimeToHire,
    accept: { a: acc, d: dec, rate: acc + dec ? acc / (acc + dec) : null },
    quality: { n: values.length, mean: values.length ? A.mean(values) : null, values },
    goalQuality: c.goalQuality,
    live: c.apps.filter(A.isLive).length,
    pastSla: breaches(c).length,
    funnel: A.funnel(scoped),
    offerStates: [
      { label: 'Accepted', value: offs.filter((o) => o.state === 'accepted').length },
      { label: 'Signed, awaiting start', value: offs.filter((o) => o.state === 'signed').length },
      { label: 'Out for signature', value: offs.filter((o) => ['sent', 'viewed'].includes(o.state)).length },
      { label: 'In approval', value: offs.filter((o) => ['draft', 'pending_approval', 'approved'].includes(o.state)).length },
      { label: 'Declined or expired', value: offs.filter((o) => ['declined', 'expired'].includes(o.state)).length, color: 'var(--bad)' },
    ],
    offersTotal: offs.length,
    today: fmt.date(c.now.toISOString()),
  };
}

/* ── Turnaround ─────────────────────────────────────────────────────────── */
export async function turnaround(c: InsightsContext, v: Viewer, exec: Exec = db()) {
  const scoped = A.scopeOf(c.apps, c.w, c.now);
  const over = breaches(c);
  const extras = await A.recruiterExtras(v, c.w, c.now, exec);
  const lb = A.leaderboard(c.data, c.w, c.now, extras, c.deptId || undefined);
  const ivMonths = await A.interviewsByMonth(v, exec);
  const months = A.monthly(c.data, W.monthKeys(12, c.now), ivMonths, c.deptId || undefined);

  const stageName = new Map<string, string>();
  for (const a of c.apps) stageName.set(a.stage, DEFAULT_NAMES[a.stage]);

  const byStage = STAGE_KEYS
    .map((k) => ({ label: DEFAULT_NAMES[k], value: over.filter((a) => a.stage === k).length }))
    .filter((x) => x.value)
    .sort((a, b) => b.value - a.value);
  const topStages = byStage.slice(0, 4);
  const restStages = byStage.slice(4).reduce((n, x) => n + x.value, 0);

  const toBreach = (a: A.AppRow) => {
    const person = c.data.candidates.get(a.candidateId);
    const rec = c.data.staff.find((s) => s.id === a.recruiterId);
    return {
      id: a.id, name: person?.name ?? '', photo: person?.photo ?? null, hue: person?.hue ?? 3,
      jobTitle: a.jobTitle, stageName: a.stageName, stageOrdinal: STAGE_INDEX[a.stage],
      days: A.days(a.stageEnteredAt, c.now.toISOString()), sla: a.sla,
      recruiterName: a.recruiterName, recruiterPhoto: rec?.photo ?? null, recruiterHue: rec?.hue ?? 3,
    };
  };

  return {
    rows: A.tat(scoped, c.now),
    timeToHire: A.timeToHire(scoped),
    timeToFill: A.timeToFill(scoped, c.jobsById),
    firstResponse: A.timeToFirstResponse(scoped),
    goalTimeToHire: c.goalTimeToHire,
    live: c.apps.filter(A.isLive).length,
    breaches: over.map(toBreach),
    shown: over.slice(0, 25).map(toBreach),
    byStage: restStages ? [...topStages, { label: 'Other stages', value: restStages }] : topStages,
    months,
    heat: {
      rows: lb.map((s) => {
        const t = A.tat(s.own, c.now);
        return {
          label: s.person.name,
          values: Object.fromEntries(t.map((x) => [x.key, x.median])) as Record<string, number | null>,
        };
      }),
      cols: STAGE_KEYS.map((k) => ({ key: k, name: DEFAULT_NAMES[k], short: SHORT[k] })),
    },
    today: fmt.date(c.now.toISOString()),
    periodLabel: W.phrase(c.w),
  };
}

const SHORT: Record<StageKey, string> = {
  applied: 'App', sourced: 'Src', screen: 'Screen', assessment: 'Assess', iv1: 'IV 1',
  iv2: 'IV 2', pitch: 'Pitch', ivf: 'IV 3', offer: 'Offer', joined: 'Joined',
};

/* ── Recruiters ─────────────────────────────────────────────────────────── */
export async function recruiters(c: InsightsContext, v: Viewer, exec: Exec = db()) {
  const extras = await A.recruiterExtras(v, c.w, c.now, exec);
  const lb = A.leaderboard(c.data, c.w, c.now, extras, c.deptId || undefined);
  return lb.map((x) => {
    const mine = c.hires.filter((h) => h.recruiterName === x.person.name
      && W.inWindow(h.startDate, c.w, c.now));
    const decided = mine.filter((h) => h.probation.state !== 'in_progress');
    const passed = decided.filter((h) => h.probation.state === 'passed');
    return {
      ...x,
      quality: decided.length ? passed.length / decided.length : null,
      qualityPassed: passed.length,
      qualityDecided: decided.length,
      qualityInside: mine.length - decided.length,
    };
  });
}

/* ── Sources ────────────────────────────────────────────────────────────── */
export function sources(c: InsightsContext) {
  const scoped = A.scopeOf(c.apps, c.w, c.now);
  const mix = A.sourceMix(scoped);
  return {
    mix,
    applications: scoped.length,
    totalHires: A.sum(mix.map((s) => s.hires)),
    floor: Math.max(10, Math.round(scoped.length / 20)),
    costPerHireGoal: c.costPerHireGoal,
  };
}

/* ── Departments ────────────────────────────────────────────────────────── */
export function departments(c: InsightsContext) {
  const stats = A.deptStats(c.data, c.w, c.now)
    .filter((d) => !c.deptId || d.id === c.deptId);
  const open = c.data.jobs.filter((j) => j.status === 'open');
  return {
    rows: stats.map((d) => ({
      ...d,
      managers: [...new Set(open.filter((j) => j.deptId === d.id)
        .map((j) => j.hiringManager).filter((x): x is string => !!x))],
    })),
    medianTimeToHire: A.timeToHire(A.hiresIn(c.apps, c.w, c.now)).median,
    goalTimeToHire: c.goalTimeToHire,
  };
}

/* ── Hires and pay ──────────────────────────────────────────────────────── */
export function market(c: InsightsContext) {
  const hs = A.hiresIn(c.apps, c.w, c.now);
  const offerBy = new Map(c.offers.map((o) => [o.applicationId, o.baseMonthly]));

  const rows = hs.map((a) => {
    const p = c.data.candidates.get(a.candidateId);
    const j = c.jobsById.get(a.jobId);
    if (!p || !j) return null;
    const years = p.yearsExperience ?? 0;
    return {
      applicationId: a.id,
      name: p.name, photo: p.photo, hue: p.hue,
      position: j.title.replace(/\s+—.*$/, ''),
      sector: p.sector ?? 'Other',
      from: p.currentCompany,
      dept: a.deptName,
      fn: a.functionName ?? a.jobFamily ?? '—',
      gender: p.gender === 'f' ? 'Female' : 'Male',
      years, band: expBand(years),
      before: p.currentSalary,
      offered: offerBy.get(a.id) ?? Math.round((j.salaryMin + j.salaryMax) / 2),
      source: p.currentSalarySource,
      jobBand: `${fmt.sarK(j.salaryMin)} – ${fmt.sarK(j.salaryMax)}`,
    };
  }).filter((x): x is NonNullable<typeof x> => x != null);

  const withPay = rows.filter((x) => x.before);

  const byPosition = [...group(withPay, (x) => x.position).entries()].map(([position, list]) => ({
    position, n: list.length,
    market: A.med(list.map((x) => x.before!)),
    ours: A.med(list.map((x) => x.offered)),
    years: A.med(list.map((x) => x.years)),
    gap: A.med(list.map((x) => (x.offered - x.before!) / x.before!)),
    band: list[0].jobBand,
    dept: list[0].dept,
    sector: list[0].sector,
  })).sort((a, b) => b.n - a.n);

  const bySector = [...group(rows, (x) => x.sector).entries()].map(([sector, list]) => {
    const pay = list.filter((x) => x.before);
    return {
      sector, n: list.length,
      women: list.filter((x) => x.gender === 'Female').length,
      years: A.med(list.map((x) => x.years)),
      market: pay.length ? A.med(pay.map((x) => x.before!)) : null,
      ours: pay.length ? A.med(pay.map((x) => x.offered)) : null,
      gap: pay.length ? A.med(pay.map((x) => (x.offered - x.before!) / x.before!)) : null,
    };
  }).sort((a, b) => b.n - a.n);

  const byBand = EXP_BANDS.map(([, , label]) => {
    const list = rows.filter((x) => x.band === label);
    const pay = list.filter((x) => x.before);
    return {
      label, n: list.length,
      market: pay.length ? A.med(pay.map((x) => x.before!)) : null,
      ours: pay.length ? A.med(pay.map((x) => x.offered)) : null,
    };
  }).filter((x) => x.n);

  return {
    rows, byPosition, bySector, byBand,
    medianBefore: A.med(withPay.map((x) => x.before!)),
    medianOffer: A.med(withPay.map((x) => x.offered)),
    uplift: withPay.length ? A.med(withPay.map((x) => (x.offered - x.before!) / x.before!)) : null,
    medianYears: A.med(rows.map((x) => x.years)),
    women: rows.filter((x) => x.gender === 'Female').length,
    deptName: c.deptName,
    periodLabel: W.label(c.w).toLowerCase(),
    scopedToDept: !!c.deptId,
  };
}

/* ── Quality of hire ────────────────────────────────────────────────────── */
const cut = (list: A.HireRow[], key: (h: A.HireRow) => string) =>
  [...group(list, key).entries()].map(([k, es]) => {
    const decided = es.filter((e) => isDecided(e.probation as ProbationRow));
    const passed = decided.filter((e) => e.probation.state === 'passed');
    return {
      key: k, hired: es.length, decided: decided.length, passed: passed.length,
      failed: decided.length - passed.length, inside: es.length - decided.length,
      rate: decided.length ? passed.length / decided.length : null,
    };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

export function quality(c: InsightsContext) {
  const mine = c.hires;
  const inWin = mine.filter((h) => W.inWindow(h.startDate, c.w, c.now));
  const decided = inWin.filter((h) => isDecided(h.probation as ProbationRow));
  const passed = decided.filter((h) => h.probation.state === 'passed');
  const failed = decided.filter((h) => h.probation.state === 'failed');

  const prevW = W.previous(c.w, c.now);
  const prevIn = mine.filter((h) => W.inWindow(h.startDate, prevW, c.now));
  const prevDec = prevIn.filter((h) => isDecided(h.probation as ProbationRow));
  const prevPassed = prevDec.filter((h) => h.probation.state === 'passed');

  const reasons: Record<string, number> = {};
  for (const h of failed) {
    const k = h.probation.reason ?? 'Not given';
    reasons[k] = (reasons[k] ?? 0) + 1;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const all12 = W.monthKeys(12, c.now).map((k) => {
    const es = mine.filter((h) => h.startDate.slice(0, 7) === k);
    const dec = es.filter((h) => isDecided(h.probation as ProbationRow));
    const pass = dec.filter((h) => h.probation.state === 'passed');
    const [y, m] = k.split('-');
    return {
      month: k, label: `${MONTHS[Number(m) - 1]} ${y.slice(2)}`,
      hired: es.length, decided: dec.length, passed: pass.length,
      rate: dec.length ? pass.length / dec.length : null,
    };
  });

  const filterThin = <T extends { decided: number }>(xs: T[]) => xs.filter((x) => x.decided >= 2);

  return {
    rate: decided.length ? passed.length / decided.length : null,
    prevRate: prevDec.length ? prevPassed.length / prevDec.length : null,
    hired: inWin.length,
    decided: decided.length,
    passed: passed.length,
    failed: failed.length,
    inside: inWin.length - decided.length,
    reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    months: all12.filter((m) => m.hired && m.decided / m.hired >= 0.5),
    settling: all12.filter((m) => m.hired && m.decided / m.hired < 0.5),
    fails: failed
      .map((h) => {
        const ended = h.probation.decidedOn ?? h.probation.endsOn;
        return {
          employeeId: h.employeeId, name: h.name,
          title: h.title, deptName: h.deptName, source: h.source,
          recruiterName: h.recruiterName, startDate: h.startDate,
          decidedOn: h.probation.decidedOn,
          lasted: Math.max(1, Math.round(A.days(h.startDate, ended))),
          reason: h.probation.reason,
        };
      })
      /* Most recently decided first — the review that just happened is the one
         somebody is looking for. */
      .sort((a, b) => (b.decidedOn ?? '').localeCompare(a.decidedOn ?? '')),
    bySource: filterThin(cut(inWin, (h) => h.source ?? 'Unknown')),
    byRecruiter: filterThin(cut(inWin, (h) => h.recruiterName ?? '—')),
    byDept: filterThin(cut(inWin, (h) => h.deptName)),
    byJob: filterThin(cut(inWin, (h) => h.title)),
    periodLabel: W.phrase(c.w),
  };
}

/* ── Offers ─────────────────────────────────────────────────────────────── */
export function offers(c: InsightsContext) {
  const sent = c.offers.filter((o) => o.sentAt && W.inWindow(o.sentAt, c.w, c.now));
  const acc = sent.filter((o) => o.state === 'accepted');
  const dec = sent.filter((o) => o.state === 'declined');
  const lapsed = sent.filter((o) => o.state === 'expired');
  const live = sent.filter((o) => ['sent', 'viewed', 'signed'].includes(o.state));
  const answerDays = sent
    .map((o) => (o.sentAt && o.responseAt ? A.days(o.sentAt, o.responseAt) : null))
    .filter((x): x is number => x != null);

  const reasons: Record<string, number> = {};
  for (const o of dec) {
    if (!o.responseReason) continue;
    reasons[o.responseReason] = (reasons[o.responseReason] ?? 0) + 1;
  }

  const byDept = [...group(sent, (o) => o.deptName).entries()].map(([name, os]) => {
    const a = os.filter((o) => o.state === 'accepted').length;
    const d = os.filter((o) => o.state === 'declined').length;
    return { name, n: os.length, a, d, rate: a + d ? a / (a + d) : null };
  }).sort((a, b) => b.n - a.n);

  /* Waiting on us first, then oldest last word — the order the prototype's
     offer desk works the list in. */
  const threads = sent.filter((o) => o.questions).map((o) => ({
    applicationId: o.applicationId,
    candidateName: o.candidateName,
    jobTitle: o.jobTitle,
    asked: o.asked,
    answered: o.answered,
    open: o.openQuestion,
    lastAt: o.lastMessageAt,
  })).sort((a, b) =>
    ((a.open ? '0' : '1') + (a.lastAt ?? '')).localeCompare((b.open ? '0' : '1') + (b.lastAt ?? '')));

  return {
    sent: sent.length,
    accepted: acc.length,
    declined: dec.length,
    lapsed: lapsed.length,
    live: live.length,
    atOffer: c.apps.filter((a) => a.stage === 'offer' && A.isLive(a)).length,
    rate: acc.length + dec.length ? acc.length / (acc.length + dec.length) : null,
    medianDays: A.med(answerDays),
    answered: answerDays.length,
    reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    byDept,
    declines: dec.map((o) => {
      const p = c.data.candidates.get(o.candidateId);
      return {
        applicationId: o.applicationId,
        name: o.candidateName, photo: p?.photo ?? null, hue: p?.hue ?? 3, sector: p?.sector ?? null,
        jobTitle: o.jobTitle, deptName: o.deptName, baseMonthly: o.baseMonthly,
        premium: p?.currentSalary ? (o.baseMonthly - p.currentSalary) / p.currentSalary : null,
        days: o.sentAt && o.responseAt ? A.days(o.sentAt, o.responseAt) : null,
        reason: o.responseReason ?? '—',
        note: o.responseNote,
      };
    }),
    threads,
    openQuestions: threads.filter((t) => t.open).length,
    deptName: c.deptName,
    periodLabel: W.label(c.w).toLowerCase(),
    scopedToDept: !!c.deptId,
  };
}

/* ── Budget ─────────────────────────────────────────────────────────────── */
export function budget(c: InsightsContext) {
  const all = c.jobs.filter((j) => !j.archived);
  const live = all.filter((j) => ['open', 'pending_approval', 'draft', 'on_hold'].includes(j.status));
  const out = live.filter((j) => j.budgeted === false);
  const inPlan = live.filter((j) => j.budgeted !== false);
  const cost = (list: A.JobRow[]) =>
    A.sum(list.map((j) => ((j.salaryMin + j.salaryMax) / 2) * 12 * 1.25 * (j.openings || 1)));
  const hiresOut = A.hiresIn(c.apps, c.w, c.now)
    .filter((a) => c.jobsById.get(a.jobId)?.budgeted === false).length;

  return {
    live: live.length,
    openings: A.sum(live.map((j) => j.openings)),
    inPlan: inPlan.length,
    out: out.map((j) => ({
      id: j.id, title: j.title, status: j.status, deptName: j.deptName, city: j.city,
      hiringManager: j.hiringManager, openings: j.openings,
      salaryMin: j.salaryMin, salaryMax: j.salaryMax, budgetNote: j.budgetNote,
    })),
    withJustification: out.filter((j) => (j.budgetNote ?? '').trim()).length,
    outCost: cost(out),
    hiresOut,
    byDept: [...group(live, (j) => j.deptName).entries()].map(([name, list]) => ({
      name, n: list.length,
      out: list.filter((j) => j.budgeted === false).length,
      openings: A.sum(list.map((j) => j.openings)),
      outCost: cost(list.filter((j) => j.budgeted === false)),
    })).sort((a, b) => b.out - a.out),
    deptName: c.deptId ? c.deptName : null,
  };
}

/* ── Interviewers ───────────────────────────────────────────────────────── */
export async function interviewerReport(
  c: InsightsContext, v: Viewer, exec: Exec = db(),
) {
  const jobIds = new Set(c.jobs.map((j) => j.id));
  const rows = rowsOf(await exec.execute(sql`
    SELECT i.id, i.job_id, i.stage::text AS stage, i.at, i.interviewer, i.reviewer_score,
           i.reviewer_ratings, i.reviewer_improve, i.flags, i.title,
           (i.analysis->>'talkRatio')::int AS talk_ratio,
           c.name AS candidate_name,
           (SELECT array_agg(p.name ORDER BY p.sort_order)
              FROM interview_panel p WHERE p.interview_id = i.id) AS panel
      FROM ${interviews} i
      JOIN ${candidates} c ON c.id = i.candidate_id
     WHERE i.status = 'completed' AND i.at < ${at(c.now)}
       AND i.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`));

  const all = rows
    .filter((r) => jobIds.has(r.job_id))
    .map((r) => ({
      id: r.id, jobId: r.job_id, stage: r.stage as StageKey, at: String(r.at),
      interviewer: (r.interviewer || (r.panel ?? [])[0] || null) as string | null,
      score: r.reviewer_score == null ? null : Number(r.reviewer_score),
      ratings: (r.reviewer_ratings ?? null) as Record<string, number> | null,
      improve: (r.reviewer_improve ?? []) as string[],
      flags: (r.flags ?? []) as string[],
      talkRatio: r.talk_ratio == null ? null : Number(r.talk_ratio),
      candidateName: r.candidate_name as string,
      title: r.title as string,
    }));

  const list = all.filter((i) => W.inWindow(i.at, c.w, c.now));
  const prevW = W.previous(c.w, c.now);
  const prevScores = all.filter((i) => W.inWindow(i.at, prevW, c.now) && i.score != null)
    .map((i) => i.score!);

  const done = list.filter((i) => i.score != null);
  const scores = done.map((i) => i.score!);
  const median = scores.length ? Math.round(A.med(scores)) : null;
  const flagged = done.filter((i) => isFlagged({ ratings: i.ratings, flags: i.flags }));

  const names = [...new Set(list.map((i) => i.interviewer).filter((x): x is string => !!x))];
  const board = names.map((name) => {
    const mine = done.filter((i) => i.interviewer === name);
    const heldN = list.filter((i) => i.interviewer === name).length;
    const ss = mine.map((i) => i.score!);
    const ratings: Record<string, number | null> = {};
    for (const k of CRIT_KEYS) {
      const vals = mine.map((i) => i.ratings?.[k]).filter((x): x is number => x != null);
      ratings[k] = vals.length ? A.mean(vals) : null;
    }
    const ranked = CRIT_KEYS.filter((k) => ratings[k] != null)
      .sort((a, b) => (ratings[a] as number) - (ratings[b] as number));
    const airs = mine.map((i) => i.talkRatio).filter((x): x is number => x != null);
    return {
      name, n: mine.length, heldN,
      title: '',
      score: ss.length ? Math.round(A.med(ss)) : null,
      airtime: airs.length ? Math.round(A.mean(airs)) : null,
      best: ranked[ranked.length - 1] ?? null,
      worst: ranked[0] ?? null,
      flags: mine.filter((i) => isFlagged({ ratings: i.ratings, flags: i.flags })).length,
    };
  }).sort((a, b) => {
    const ra = a.n < MIN_N ? -1 : (a.score ?? -1);
    const rb = b.n < MIN_N ? -1 : (b.score ?? -1);
    return rb - ra;
  });

  const titles = await A.titlesByName(names, exec);

  const slipCount: Record<string, number> = {};
  for (const i of done) for (const t of i.improve) slipCount[t] = (slipCount[t] ?? 0) + 1;

  return {
    held: list.length,
    reviewed: done.length,
    median,
    medianPrev: prevScores.length ? A.med(prevScores) : null,
    bandText: median == null ? '—' : bandText(median),
    flagged: flagged.map((i) => ({
      id: i.id, interviewer: i.interviewer, candidateName: i.candidateName,
      at: i.at, flag: i.flags[0] ?? '', score: i.score,
    })).sort((a, b) => b.at.localeCompare(a.at)),
    board: board.map((b) => ({ ...b, title: titles.get(b.name) ?? '' })),
    crit: CRIT.map(([k, label, hint]) => {
      const vals = done.map((i) => i.ratings?.[k]).filter((x): x is number => x != null);
      return { k, label, hint, avg: vals.length ? A.mean(vals) : null, n: vals.length };
    }),
    byStage: STAGE_KEYS.filter((k) => /iv|assessment/.test(k)).map((k) => {
      const vals = done.filter((i) => i.stage === k).map((i) => i.score!);
      return { label: DEFAULT_NAMES[k], value: vals.length ? Math.round(A.med(vals)) : 0, n: vals.length };
    }).filter((x) => x.n),
    slips: Object.entries(slipCount).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n).slice(0, 7),
    airtime: done.map((i) => i.talkRatio).filter((x): x is number => x != null),
    periodLabel: W.phrase(c.w),
    scopedToDept: !!c.deptId,
  };
}
