import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  interviews, interviewPanel, applications, candidates, jobs, jobStages, staff, tasks,
  evaluations,
} from '@/db/schema';
import { rows as rowsOf, inList } from './sql';
import { titlesByName } from './analytics';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_INDEX, type StageKey } from '@/lib/domain/stages';
import { CRIT_KEYS, MIN_N, isFlagged } from '@/lib/domain/ivreview';
import { inWindow, type Window } from '@/lib/domain/window';

/* ═════════════════════════════════════════════════════════════════════════════
   SCHEDULING

   The agenda, the task list, how the interviews themselves were run, and who is
   over capacity. Everything is read from interviews, tasks and evaluations and
   measured against now. Times are Asia/Riyadh — UTC+3, no daylight saving —
   which is also the clock the interface prints.

   The working week in the Kingdom runs Sunday to Thursday. Friday and Saturday
   are the weekend, so a booking that lands there is called out rather than
   quietly accepted.
   ═════════════════════════════════════════════════════════════════════════════*/

export const AST = 3 * 3_600_000;
/** The calendar day an instant falls on in Riyadh. */
export const dayKey = (iso: string | Date): string =>
  new Date(new Date(iso).getTime() + AST).toISOString().slice(0, 10);
export const dowOf = (key: string): number => new Date(key + 'T12:00:00Z').getUTCDay();
export const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const isWeekend = (key: string): boolean => dowOf(key) === 5 || dowOf(key) === 6;

export const TASK_KIND: Record<string, string> = {
  send_offer: 'Offer', schedule: 'Scheduling', reject: 'Regret', reference: 'References',
  screen_call: 'Screen call', sourcing: 'Sourcing', review_cv: 'CV review',
  chase_feedback: 'Chase feedback', verify_offer: 'Verify offer letter',
  interview: 'Interview', document: 'Documents',
};

export const NEXT_D = 14;
export const BACK_D = 30;
export const CAP = { live: 35, ahead: 6, waiting: 5 };

export type Slot = {
  id: string;
  applicationId: string;
  candidateId: string;
  candidateName: string;
  photo: string | null;
  hue: number;
  jobId: string;
  jobTitle: string;
  stage: string;
  stageName: string;
  stageOrdinal: number;
  title: string;
  at: string;
  mode: string;
  durationMin: number;
  status: string;
  interviewer: string | null;
  panel: string[];
  reviewScore: number | null;
  reviewFlagged: boolean;
  reviewed: boolean;
};

const slotSelect = sql`
  SELECT i.id, i.application_id, i.candidate_id, i.job_id, i.stage::text AS stage, i.title, i.at,
         i.mode, i.duration_min, i.status::text AS status, i.interviewer,
         i.reviewer_score, i.reviewer_ratings, i.flags,
         c.name AS candidate_name, c.photo, c.hue, j.title AS job_title, js.name AS stage_name,
         (SELECT array_agg(p.name ORDER BY p.sort_order)
            FROM ${interviewPanel} p WHERE p.interview_id = i.id) AS panel
    FROM ${interviews} i
    JOIN ${candidates} c ON c.id = i.candidate_id
    JOIN ${jobs} j ON j.id = i.job_id
    LEFT JOIN ${jobStages} js ON js.job_id = i.job_id AND js.stage_key = i.stage`;

const toSlot = (r: any): Slot => ({
  id: r.id,
  applicationId: r.application_id,
  candidateId: r.candidate_id,
  candidateName: r.candidate_name,
  photo: r.photo,
  hue: Number(r.hue ?? 3),
  jobId: r.job_id,
  jobTitle: r.job_title,
  stage: r.stage,
  stageName: r.stage_name ?? r.stage,
  stageOrdinal: STAGE_INDEX[r.stage as StageKey] ?? 0,
  title: r.title,
  at: String(r.at),
  mode: r.mode,
  durationMin: Number(r.duration_min),
  status: r.status,
  interviewer: r.interviewer,
  panel: (r.panel ?? []).filter(Boolean),
  reviewScore: r.reviewer_score == null ? null : Number(r.reviewer_score),
  reviewFlagged: isFlagged({ ratings: r.reviewer_ratings, flags: r.flags }),
  reviewed: r.reviewer_score != null,
});

/* ── The agenda ─────────────────────────────────────────────────────────── */
export type AgendaFilters = {
  range?: string; owner?: string; mode?: string;
  /* An exact span, in instants rather than days — which is what a chart on the
     Load tab counts by. `after` is exclusive and `fromAt` inclusive, because
     the windows those charts use are not all closed at the same end: a week bar
     counts `(start, end]` and the format ring counts `[now - 30d, now + 14d]`.
     Getting that wrong by one boundary is how a drill-down quietly returns one
     record more than the bar it came from. */
  after?: string; fromAt?: string; toAt?: string;
  /* Somebody on the panel, by the name the interview records. */
  panel?: string;
};

export async function agenda(
  v: Viewer, f: AgendaFilters, now: Date, exec: Exec = db(),
) {
  const scope = sql`i.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const list = rowsOf(await exec.execute(sql`
    ${slotSelect}
     WHERE i.status <> 'cancelled' AND ${scope}
     ORDER BY i.at ASC`)).map(toSlot);

  const modes = [...new Set(list.map((i) => i.mode))].sort();

  const owners = rowsOf(await exec.execute(sql`
    SELECT s.id, s.name FROM ${staff} s
     WHERE s.role IN ('recruiter','tal_lead') AND s.status <> 'deleted' ORDER BY s.name`));

  /* Which recruiter owns each interview — the owner of the application behind it. */
  const ownerOf = new Map<string, string>(rowsOf(await exec.execute(sql`
    SELECT a.id, a.recruiter_id FROM ${applications} a
     WHERE ${inList(sql`a.id`, list.map((i) => i.applicationId))}`))
    .map((r) => [r.id, r.recruiter_id]));

  const today = dayKey(now);
  const weekStart = new Date(Date.parse(today + 'T00:00:00Z') - dowOf(today) * 86_400_000)
    .toISOString().slice(0, 10);
  const weekEnd = new Date(Date.parse(weekStart + 'T00:00:00Z') + 6 * 86_400_000)
    .toISOString().slice(0, 10);

  const counts = { up: 0, week: 0, past: 0 };
  for (const i of list) {
    const k = dayKey(i.at);
    if (k >= today) counts.up += 1;
    if (k >= weekStart && k <= weekEnd) counts.week += 1;
    if (k < today) counts.past += 1;
  }

  /* A span, when one was given, replaces the day ranges entirely — the two
     answer different questions and mixing them would answer neither. */
  const span = !!(f.after || f.fromAt || f.toAt);
  const range = span ? 'span' : (f.range ?? 'up');
  const inRange = (k: string) =>
    (range === 'week' ? k >= weekStart && k <= weekEnd : range === 'past' ? k < today : k >= today);
  const afterMs = f.after ? Date.parse(f.after) : null;
  const fromMs = f.fromAt ? Date.parse(f.fromAt) : null;
  const toMs = f.toAt ? Date.parse(f.toAt) : null;
  const inSpan = (iso: string) => {
    const t = Date.parse(iso);
    if (afterMs != null && !(t > afterMs)) return false;
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    return true;
  };

  const kept = list.filter((i) => {
    if (span ? !inSpan(i.at) : !inRange(dayKey(i.at))) return false;
    if (f.mode && i.mode !== f.mode) return false;
    if (f.panel && !i.panel.includes(f.panel)) return false;
    if (f.owner && ownerOf.get(i.applicationId) !== f.owner) return false;
    return true;
  });

  const desc = range === 'past' || (span && toMs != null && toMs <= now.getTime());
  const shown = [...kept].sort((a, b) => (desc ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)))
    .slice(0, desc ? 90 : 400);

  return {
    counts, range, today, weekStart, weekEnd, modes, owners,
    shown, keptTotal: kept.length,
    /* "Ahead" counts whole days — anything from today onwards. "Still to come"
       counts the clock, so an interview held this morning is already behind. */
    stillToCome: list.filter((i) => new Date(i.at) >= now).length,
    weekendBooked: shown.filter((i) => isWeekend(dayKey(i.at))).length,
  };
}

/* ── Tasks ──────────────────────────────────────────────────────────────── */
export type TaskRow = {
  id: string;
  title: string;
  kind: string;
  dueOn: string | null;
  done: boolean;
  priority: string;
  applicationId: string | null;
  candidateName: string | null;
  jobTitle: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
};

export async function taskBoard(v: Viewer, who: string | undefined, exec: Exec = db()) {
  const all = rowsOf(await exec.execute(sql`
    SELECT t.id, t.title, t.kind::text AS kind, t.due_on::date::text AS due_on, t.done,
           t.priority::text AS priority, t.application_id, t.assignee_id,
           s.name AS assignee_name, c.name AS candidate_name, j.title AS job_title
      FROM ${tasks} t
      LEFT JOIN ${staff} s ON s.id = t.assignee_id
      LEFT JOIN ${candidates} c ON c.id = t.candidate_id
      LEFT JOIN ${jobs} j ON j.id = t.job_id
     ORDER BY t.due_on ASC NULLS LAST, t.id ASC`)).map((r): TaskRow => ({
    id: r.id, title: r.title, kind: r.kind, dueOn: r.due_on, done: r.done,
    priority: r.priority, applicationId: r.application_id,
    candidateName: r.candidate_name, jobTitle: r.job_title,
    assigneeId: r.assignee_id, assigneeName: r.assignee_name,
  }));

  const owners = [...new Map(all.filter((t) => t.assigneeId)
    .map((t) => [t.assigneeId!, { id: t.assigneeId!, name: t.assigneeName ?? '' }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  const kept = who ? all.filter((t) => t.assigneeId === who) : all;
  return { all, kept, owners };
}

/* ── Interviewer reviews ────────────────────────────────────────────────── */
export type ReviewedInterview = Slot & {
  ratings: Record<string, number> | null;
  strengths: string[];
  improve: string[];
  flags: string[];
  talkRatio: number | null;
  analysisAt: string | null;
};

export async function interviewerPanel(v: Viewer, w: Window, now: Date, exec: Exec = db()) {
  const scope = sql`i.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const list = rowsOf(await exec.execute(sql`
    ${slotSelect}
     WHERE i.status = 'completed' AND i.at < ${at(now)} AND ${scope}
     ORDER BY i.at DESC`))
    .map((r) => ({
      ...toSlot(r),
      ratings: (r.reviewer_ratings ?? null) as Record<string, number> | null,
      strengths: (r.reviewer_strengths ?? []) as string[],
      improve: (r.reviewer_improve ?? []) as string[],
      flags: (r.flags ?? []) as string[],
      talkRatio: null as number | null,
      analysisAt: null as string | null,
    }))
    .filter((i) => inWindow(i.at, w, now));

  /* The airtime lives inside the stored analysis; pulling it out here keeps the
     JSON blob at the edge rather than letting it leak into every component. */
  const details = list.length ? rowsOf(await exec.execute(sql`
    SELECT id, (analysis->>'talkRatio')::int AS talk_ratio, reviewed_at,
           reviewer_strengths, reviewer_improve
      FROM ${interviews}
     WHERE id IN (${sql.join(list.map((i) => sql`${i.id}`), sql`, `)})`)) : [];
  const byId = new Map(details.map((r) => [r.id, r]));
  for (const i of list) {
    const d = byId.get(i.id);
    i.talkRatio = d?.talk_ratio == null ? null : Number(d.talk_ratio);
    i.analysisAt = d?.reviewed_at ? String(d.reviewed_at) : null;
    i.strengths = d?.reviewer_strengths ?? [];
    i.improve = d?.reviewer_improve ?? [];
  }

  const done = list.filter((i) => i.reviewed);
  const pending = list.filter((i) => !i.reviewed);
  /* The table reads newest first, but the flagged banner names the people in the
     order the interviews were recorded — the order a reviewer worked through
     them — so the first name on it is the first one to have a word with, not
     merely the most recent. */
  const flagged = done.filter((i) => i.reviewFlagged)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const scores = done.map((i) => i.reviewScore!).filter((x) => x != null);

  /* Whoever ran it: the named hiring manager, else the first person on the panel. */
  const runner = (i: (typeof list)[number]) => i.interviewer || i.panel[0] || null;

  const names = [...new Set(list.map(runner).filter((x): x is string => !!x))];
  const titles = await titlesByName(names, exec);
  const board = names.map((name) => {
    const mine = done.filter((i) => runner(i) === name);
    const heldN = list.filter((i) => runner(i) === name).length;
    const ss = mine.map((i) => i.reviewScore!).filter((x) => x != null).sort((a, b) => a - b);
    const ratings: Record<string, number | null> = {};
    for (const k of CRIT_KEYS) {
      const vals = mine.map((i) => i.ratings?.[k]).filter((x): x is number => x != null);
      ratings[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    const ranked = CRIT_KEYS.filter((k) => ratings[k] != null)
      .sort((a, b) => (ratings[a] as number) - (ratings[b] as number));
    const airtimes = mine.map((i) => i.talkRatio).filter((x): x is number => x != null);
    const slips: Record<string, number> = {};
    for (const i of mine) for (const s of i.improve) slips[s] = (slips[s] ?? 0) + 1;
    return {
      name, title: titles.get(name) ?? '', n: mine.length, heldN,
      score: ss.length ? Math.round(ss.length % 2 ? ss[ss.length >> 1] : (ss[(ss.length >> 1) - 1] + ss[ss.length >> 1]) / 2) : null,
      ratings, best: ranked[ranked.length - 1] ?? null, worst: ranked[0] ?? null,
      flags: mine.filter((i) => i.reviewFlagged).length,
      airtime: airtimes.length ? Math.round(airtimes.reduce((a, b) => a + b, 0) / airtimes.length) : null,
      slips: Object.entries(slips).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n),
    };
  }).sort((a, b) => {
    /* Too few interviews to judge, so they sit at the bottom whatever the median. */
    const ra = a.n < MIN_N ? -1 : (a.score ?? -1);
    const rb = b.n < MIN_N ? -1 : (b.score ?? -1);
    return rb - ra;
  });

  const worstAcross: Record<string, number> = {};
  for (const i of done) for (const s of i.improve) worstAcross[s] = (worstAcross[s] ?? 0) + 1;

  const critMeans = CRIT_KEYS.map((k) => {
    const vals = done.map((i) => i.ratings?.[k]).filter((x): x is number => x != null);
    return { key: k, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });

  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted.length
    ? Math.round(sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[(sorted.length >> 1) - 1] + sorted[sorted.length >> 1]) / 2)
    : null;

  return {
    list, done, pending, flagged, scores, median, board, critMeans,
    worst: Object.entries(worstAcross).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n).slice(0, 6),
    runnerOf: (id: string) => {
      const i = list.find((x) => x.id === id);
      return i ? (i.interviewer || i.panel[0] || null) : null;
    },
  };
}

/* ── Load: who is carrying how much ─────────────────────────────────────── */
export type LoadRow = {
  name: string;
  staffId: string | null;
  roleLabel: string | null;
  photo: string | null;
  hue: number;
  ahead: number;
  held: number;
  waiting: number;
  waitedMax: number;
  live: number;
  overSla: number;
  reqs: number;
  flags: string[];
};

/* Interviews a week: the weeks behind and the two ahead, so a desk can see
   whether the load it is about to take is the load it just carried. The last
   bars are bookings rather than history, which the card says out loud. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekWindows(now: Date) {
  const out: Array<{ key: string; label: string; start: string; end: string }> = [];
  for (let k = Math.ceil(BACK_D / 7) - 1; k >= -Math.ceil(NEXT_D / 7); k--) {
    const end = new Date(now.getTime() - k * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    out.push({
      key: String(k),
      label: `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }
  return out;
}

export async function load(v: Viewer, now: Date, exec: Exec = db()) {
  const scope = sql`i.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const scopedApps = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;

  const [aheadRows, heldRows, openRows, recruiterRows, weeksRows] = await Promise.all([
    exec.execute(sql`${slotSelect}
       WHERE i.status <> 'cancelled' AND ${scope}
         AND i.at >= ${at(now)} AND i.at <= ${at(now)} + (${NEXT_D} || ' days')::interval
       ORDER BY i.at ASC`),
    exec.execute(sql`${slotSelect}
       WHERE i.status <> 'cancelled' AND ${scope}
         AND i.at <= ${at(now)} AND i.at >= ${at(now)} - (${BACK_D} || ' days')::interval`),
    exec.execute(sql`
      SELECT e.evaluator_name, e.application_id, e.stage::text AS stage,
             (SELECT max(i.at) FROM ${interviews} i
               WHERE i.application_id = e.application_id AND i.stage = e.stage) AS iv_at,
             a.stage_entered_at
        FROM ${evaluations} e
        JOIN ${applications} a ON a.id = e.application_id
       WHERE NOT e.submitted AND ${scopedApps}`),
    exec.execute(sql`
      SELECT s.id, s.name, s.photo, s.hue, s.role::text AS role,
             (SELECT count(*) FROM ${applications} a
               WHERE a.recruiter_id = s.id AND a.status IN ('active','on_hold') AND ${scopedApps})::int AS live,
             (SELECT count(*) FROM ${applications} a
                JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
               WHERE a.recruiter_id = s.id AND a.status IN ('active','on_hold') AND ${scopedApps}
                 AND ${at(now)} - a.stage_entered_at > (js.sla || ' days')::interval)::int AS over_sla,
             (SELECT count(*) FROM ${jobs} j
               WHERE j.recruiter_id = s.id AND j.status = 'open' AND ${jobScopeSql(v, 'j')})::int AS reqs
        FROM ${staff} s
       WHERE s.role IN ('recruiter','tal_lead') AND s.status <> 'deleted'`),
    exec.execute(sql`
      WITH b(key, s, e) AS (VALUES ${sql.join(
        weekWindows(now).map((x) => sql`(${x.key}::text, ${x.start}::timestamptz, ${x.end}::timestamptz)`), sql`, `)})
      SELECT b.key,
        (SELECT count(*) FROM ${interviews} i
          WHERE i.status <> 'cancelled' AND ${scope} AND i.at > b.s AND i.at <= b.e)::int AS n
      FROM b`),
  ]);

  const ahead = rowsOf(aheadRows).map(toSlot);
  const held = rowsOf(heldRows).map(toSlot);
  const open = rowsOf(openRows);

  const rows = new Map<string, LoadRow>();
  const row = (name: string): LoadRow => {
    if (!rows.has(name)) {
      rows.set(name, {
        name, staffId: null, roleLabel: null, photo: null, hue: 4,
        ahead: 0, held: 0, waiting: 0, waitedMax: 0, live: 0, overSla: 0, reqs: 0, flags: [],
      });
    }
    return rows.get(name)!;
  };

  for (const i of ahead) for (const p of i.panel) row(p).ahead += 1;
  for (const i of held) for (const p of i.panel) row(p).held += 1;
  for (const e of open) {
    const r = row(e.evaluator_name);
    r.waiting += 1;
    const since = e.iv_at ?? e.stage_entered_at;
    if (since) {
      const d = (now.getTime() - new Date(since).getTime()) / 86_400_000;
      r.waitedMax = Math.max(r.waitedMax, d);
    }
  }
  for (const s of rowsOf(recruiterRows)) {
    const r = row(s.name);
    r.staffId = s.id;
    r.roleLabel = s.role === 'tal_lead' ? 'Head of TA' : 'Recruiter';
    r.photo = s.photo;
    r.hue = Number(s.hue ?? 3);
    r.live = Number(s.live);
    r.overSla = Number(s.over_sla);
    r.reqs = Number(s.reqs);
  }
  for (const r of rows.values()) {
    r.flags = [
      r.live > CAP.live ? `${r.live} live applications` : null,
      r.ahead > CAP.ahead ? `${r.ahead} interviews in the next fortnight` : null,
      r.waitedMax > CAP.waiting ? `a scorecard waiting ${Math.round(r.waitedMax)} days` : null,
    ].filter((x): x is string => !!x);
  }

  const byWeek = new Map(rowsOf(weeksRows).map((r) => [r.key as string, Number(r.n)]));
  /* The bar carries its own boundaries, so a drill-down can ask for exactly
     the interval that was counted rather than a day range near it. */
  const weeks = weekWindows(now).map((x) => ({
    label: x.label, value: byWeek.get(x.key) ?? 0,
    start: x.start, end: x.end, ahead: Date.parse(x.end) > now.getTime(),
  }));

  return { ahead, held, open, rows: [...rows.values()], weeks };
}

/* The number on the Interviewers tab: recordings held in the last thirty days
   that nobody has analysed. Counted on its own so every tab can show it without
   loading the whole panel. */
export async function pendingReviewCount(v: Viewer, now: Date = new Date(), exec: Exec = db()): Promise<number> {
  const rows = rowsOf(await exec.execute(sql`
    SELECT count(*)::int AS n FROM ${interviews} i
     WHERE i.status = 'completed' AND i.at < ${at(now)}
       AND i.at >= ${at(now)} - interval '30 days'
       AND i.reviewer_score IS NULL
       AND i.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`));
  return Number(rows[0]?.n ?? 0);
}
