import 'server-only';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  jobs, jobStages, jobSkills, jobChannels, jobHiringManagers, jobQuestions,
  applications, candidates, departments, functions, locations, staff, pipelines, positions,
  employees, approvals, approvalSteps, offers, evaluations, reviews, screenings, interviews,
} from '@/db/schema';
import { jobScopeSql, requireJob } from '@/lib/authz';
import { at } from '@/lib/clock';
import { rows as rowsOf, count as countOf, inList } from './sql';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_KEYS, STAGE_INDEX, slaOf, stageBand, type StageKey } from '@/lib/domain/stages';
import { routeOfSource, routesOf, isConfidential, PUBLISH_CHANNELS, type RouteKey } from '@/lib/domain/sourcing';

/* ─────────────────────────────────────────────────────────────────────────────
   Reading requisitions.

   Every query here starts from `jobScopeSql(viewer)`, so the scope an account
   has is applied at the root rather than at the edges. A list, a board, a count
   and a chart therefore cannot disagree about what that account may see —
   which was the point of putting access by position in the selectors in the
   first place.
   ───────────────────────────────────────────────────────────────────────────*/

export type JobListFilters = {
  status?: string;
  deptId?: string;
  recruiterId?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: string;
};

export type JobRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  openings: number;
  filled: number;
  positionCode: string | null;
  deptName: string;
  deptId: string;
  city: string;
  hiringManager: string | null;
  pipelineName: string | null;
  openedOn: string | null;
  recruiterId: string | null;
  recruiterName: string | null;
  recruiterPhoto: string | null;
  recruiterHue: number;
  budgeted: boolean;
  live: number;
  overSla: number;
  matched?: number;
  /** The stage bar under each row. */
  distribution: Array<{ key: string; name: string; n: number; band: number }>;
};

export async function listJobs(
  v: Viewer,
  f: JobListFilters,
  now: Date = new Date(),
  exec: Exec = db(),
): Promise<{
  rows: JobRow[]; counts: Record<string, number>;
  openOpenings: number; totalInScope: number; totalAll: number;
}> {
  const scope = jobScopeSql(v);

  /* The counts on the tab strip are of everything in scope, not of the filtered
     list — a tab that says "3" and then shows nothing is a bug report. */
  const countRows = await exec.execute(sql`
    SELECT status::text AS status, count(*)::text AS n, sum(openings)::text AS openings
      FROM ${jobs} WHERE ${scope} GROUP BY 1`);
  const counts: Record<string, number> = {};
  /* The headline counts every seat on the open requisitions in scope, whatever
     tab is showing — it describes the desk, not the filter. */
  let openOpenings = 0;
  for (const r of rowsOf(countRows)) {
    counts[r.status] = Number(r.n);
    if (r.status === 'open') openOpenings = Number(r.openings ?? 0);
  }
  const totalInScope = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalAll = countOf(await exec.execute(sql`SELECT count(*)::int AS n FROM ${jobs}`));

  const where: ReturnType<typeof sql>[] = [scope];
  if (f.status && f.status !== 'all') where.push(sql`${jobs.status} = ${f.status}::job_status`);
  if (f.deptId) where.push(sql`${jobs.deptId} = ${f.deptId}`);
  if (f.recruiterId) where.push(sql`${jobs.recruiterId} = ${f.recruiterId}`);

  /* A search on Jobs takes a person as well as a requisition: any text is
     matched against the requisitions and against everybody who has applied to
     them, and the two dates narrow it to the applications that arrived between
     them. The list then shows the requisitions behind those people. */
  const searching = !!(f.q || f.from || f.to);
  if (searching) {
    const q = (f.q ?? '').trim();
    const appMatch = sql`EXISTS (
      SELECT 1 FROM ${applications} a JOIN ${candidates} c ON c.id = a.candidate_id
       WHERE a.job_id = ${jobs.id}
         ${f.from ? sql`AND a.applied_at::date >= ${f.from}::date` : sql``}
         ${f.to ? sql`AND a.applied_at::date <= ${f.to}::date` : sql``}
         ${q ? sql`AND (c.name ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'}
                        OR c.phone ILIKE ${'%' + q + '%'} OR c.current_company ILIKE ${'%' + q + '%'})` : sql``}
    )`;
    where.push(q
      ? sql`(${jobs.title} ILIKE ${'%' + q + '%'} OR ${jobs.family} ILIKE ${'%' + q + '%'}
             OR coalesce(${jobs.positionCode}, '') ILIKE ${'%' + q + '%'} OR ${appMatch})`
      : appMatch);
  }

  /* The five orders the select offers, each reproducing the product's own
     comparator exactly — including the one labelled "Newest first", which has
     always listed the longest-open requisition first. The desk reads that list
     as "what has been sitting here", so the label is the thing that is wrong,
     and changing the order silently would move somebody's work under them.
     Recorded in the parity matrix as a label to fix with the product owner.

     Ties fall back to the id, which is the order the records were created in:
     the prototype's sort is stable over its own array, and without this a
     page of requisitions opened on the same day would shuffle between loads. */
  const order = {
    age: sql`${jobs.openedOn} ASC NULLS LAST, ${jobs.id} ASC`,
    title: sql`${jobs.title} ASC, ${jobs.id} ASC`,
    openings: sql`${jobs.openings} DESC, ${jobs.id} ASC`,
    pipeline: sql`live DESC, ${jobs.id} ASC`,
    progress: sql`(${jobs.filled}::numeric / NULLIF(${jobs.openings}, 0)) DESC NULLS LAST, ${jobs.id} ASC`,
  }[f.sort ?? 'age'] ?? sql`${jobs.openedOn} ASC NULLS LAST, ${jobs.id} ASC`;

  /* No alias on `jobs`: the scope predicate and the filters are built from the
     Drizzle table, which renders as "jobs"."…", so aliasing it here would put
     the predicate out of scope. Everything joined in gets an alias of its own. */
  const found = await exec.execute(sql`
    SELECT ${jobs.id} AS id, ${jobs.reference} AS reference, ${jobs.title} AS title,
           ${jobs.status}::text AS status, ${jobs.priority}::text AS priority,
           ${jobs.openings} AS openings, ${jobs.filled} AS filled,
           ${jobs.positionCode} AS position_code, ${jobs.deptId} AS dept_id,
           ${jobs.budgeted} AS budgeted, ${jobs.openedOn}::text AS opened_on,
           ${jobs.hiringManager} AS hiring_manager, ${jobs.recruiterId} AS recruiter_id,
           d.name AS dept_name, l.city AS city, p.name AS pipeline_name,
           s.name AS recruiter_name, s.photo AS recruiter_photo, s.hue AS recruiter_hue,
           (SELECT count(*) FROM ${applications} a
             WHERE a.job_id = ${jobs.id} AND a.status IN ('active','on_hold')) AS live,
           (SELECT count(*) FROM ${applications} a
              JOIN ${jobStages} js ON js.job_id = ${jobs.id} AND js.stage_key = a.stage
             WHERE a.job_id = ${jobs.id} AND a.status IN ('active','on_hold')
               AND ${at(now)} - a.stage_entered_at > (js.sla || ' days')::interval) AS over_sla
           ${searching ? sql`,
           (SELECT count(*) FROM ${applications} a JOIN ${candidates} c ON c.id = a.candidate_id
             WHERE a.job_id = ${jobs.id}
               ${f.from ? sql`AND a.applied_at::date >= ${f.from}::date` : sql``}
               ${f.to ? sql`AND a.applied_at::date <= ${f.to}::date` : sql``}
               ${f.q ? sql`AND (c.name ILIKE ${'%' + f.q + '%'} OR c.email ILIKE ${'%' + f.q + '%'}
                                OR c.phone ILIKE ${'%' + f.q + '%'} OR c.current_company ILIKE ${'%' + f.q + '%'})` : sql``}
           ) AS matched` : sql``}
      FROM ${jobs}
      JOIN ${departments} d ON d.id = ${jobs.deptId}
      JOIN ${locations} l ON l.id = ${jobs.locationId}
      LEFT JOIN ${pipelines} p ON p.id = ${jobs.pipelineId}
      LEFT JOIN ${staff} s ON s.id = ${jobs.recruiterId}
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY ${order}
     LIMIT 200`);

  const list = rowsOf(found);
  const ids = list.map((r) => r.id);
  const dist = ids.length ? await stageDistribution(ids, exec) : new Map();

  return {
    rows: list.map((r) => ({
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      priority: r.priority,
      openings: Number(r.openings),
      filled: Number(r.filled),
      positionCode: r.position_code,
      deptId: r.dept_id,
      deptName: r.dept_name,
      city: r.city,
      hiringManager: r.hiring_manager,
      pipelineName: r.pipeline_name,
      openedOn: r.opened_on,
      recruiterId: r.recruiter_id,
      recruiterName: r.recruiter_name,
      recruiterPhoto: r.recruiter_photo,
      recruiterHue: Number(r.recruiter_hue ?? 3),
      budgeted: r.budgeted,
      live: Number(r.live),
      overSla: Number(r.over_sla),
      matched: r.matched != null ? Number(r.matched) : undefined,
      distribution: dist.get(r.id) ?? [],
    })),
    counts, openOpenings, totalInScope, totalAll,
  };
}

/** The live pipeline of each requisition, by stage, for the bar under a row. */
async function stageDistribution(jobIds: string[], exec: Exec) {
  const rows = rowsOf(await exec.execute(sql`
    SELECT a.job_id, a.stage::text AS stage, js.name, count(*)::int AS n
      FROM ${applications} a
      LEFT JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
     WHERE ${inList(sql`a.job_id`, jobIds)}
       AND a.status IN ('active','on_hold')
     GROUP BY 1, 2, 3`));
  const out = new Map<string, Array<{ key: string; name: string; n: number; band: number }>>();
  for (const r of rows) {
    const arr = out.get(r.job_id) ?? [];
    arr.push({
      key: r.stage,
      name: r.name ?? r.stage,
      n: Number(r.n),
      band: stageBand(STAGE_INDEX[r.stage as StageKey] ?? 0),
    });
    out.set(r.job_id, arr);
  }
  for (const [, arr] of out) {
    arr.sort((a, b) => (STAGE_INDEX[a.key as StageKey] ?? 0) - (STAGE_INDEX[b.key as StageKey] ?? 0));
  }
  return out;
}

/** The people a Jobs search turned up, wherever they applied. */
export async function searchApplicants(
  v: Viewer, f: JobListFilters, limit = 40, exec: Exec = db(),
) {
  if (!f.q && !f.from && !f.to) return { rows: [] as any[], total: 0 };
  const q = (f.q ?? '').trim();
  const where = [sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`];
  if (f.from) where.push(sql`a.applied_at::date >= ${f.from}::date`);
  if (f.to) where.push(sql`a.applied_at::date <= ${f.to}::date`);
  if (q) {
    where.push(sql`(c.name ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'}
                    OR c.phone ILIKE ${'%' + q + '%'} OR c.current_company ILIKE ${'%' + q + '%'})`);
  }

  const total = countOf(await exec.execute(sql`
    SELECT count(*)::int AS n FROM ${applications} a JOIN ${candidates} c ON c.id = a.candidate_id
     WHERE ${sql.join(where, sql` AND `)}`));

  const rows = rowsOf(await exec.execute(sql`
    SELECT a.id, a.stage::text AS stage, a.status::text AS status, a.source,
           a.applied_at, c.id AS candidate_id, c.name, c.current_title, c.current_company,
           c.photo, c.hue, jb.id AS job_id, jb.title AS job_title, d.name AS dept_name,
           js.name AS stage_name
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      JOIN ${jobs} jb ON jb.id = a.job_id
      JOIN ${departments} d ON d.id = jb.dept_id
      LEFT JOIN ${jobStages} js ON js.job_id = jb.id AND js.stage_key = a.stage
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY a.applied_at DESC
     LIMIT ${limit}`));

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      stage: r.stage,
      stageName: r.stage_name ?? r.stage,
      stageOrdinal: STAGE_INDEX[r.stage as StageKey] ?? 0,
      status: r.status,
      source: r.source,
      route: routeOfSource(r.source),
      appliedAt: r.applied_at,
      candidate: {
        id: r.candidate_id, name: r.name, currentTitle: r.current_title,
        currentCompany: r.current_company, photo: r.photo, hue: Number(r.hue ?? 3),
      },
      job: { id: r.job_id, title: r.job_title, deptName: r.dept_name },
    })),
  };
}

/* ── One requisition, in full ───────────────────────────────────────────── */
export type JobDetail = Awaited<ReturnType<typeof getJob>>;

export async function getJob(v: Viewer, id: string, exec: Exec = db()) {
  await requireJob(v, id, exec);

  const [row] = await exec.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!row) return null;

  const [dept] = await exec.select().from(departments).where(eq(departments.id, row.deptId)).limit(1);
  const [fn] = dept?.functionId
    ? await exec.select().from(functions).where(eq(functions.id, dept.functionId)).limit(1)
    : [null];
  const [loc] = await exec.select().from(locations).where(eq(locations.id, row.locationId)).limit(1);
  const [pipe] = row.pipelineId
    ? await exec.select().from(pipelines).where(eq(pipelines.id, row.pipelineId)).limit(1)
    : [null];

  const [stages, skills, channels, hms, questions] = await Promise.all([
    exec.select().from(jobStages).where(eq(jobStages.jobId, id)).orderBy(asc(jobStages.ordinal)),
    exec.select().from(jobSkills).where(eq(jobSkills.jobId, id)).orderBy(asc(jobSkills.sortOrder)),
    exec.select().from(jobChannels).where(eq(jobChannels.jobId, id))
      .orderBy(sql`array_position(${sql.raw(`ARRAY[${PUBLISH_CHANNELS.map((c) => `'${c}'`).join(',')}]::text[]`)}, ${jobChannels.channel}) NULLS LAST`),
    exec.select().from(jobHiringManagers).where(eq(jobHiringManagers.jobId, id))
      .orderBy(desc(jobHiringManagers.isLead), asc(jobHiringManagers.sortOrder)),
    exec.select().from(jobQuestions).where(eq(jobQuestions.jobId, id)).orderBy(asc(jobQuestions.ordinal)),
  ]);

  const people = await exec.select().from(staff).where(inArray(staff.id,
    [row.recruiterId, row.sourcerId, row.coordinatorId].filter((x): x is string => !!x)));
  const byId = new Map(people.map((p) => [p.id, p]));

  const seat = row.positionCode
    ? (await exec.select().from(positions).where(eq(positions.code, row.positionCode)).limit(1))[0] ?? null
    : null;

  const stats = rowsOf(await exec.execute(sql`
    SELECT
      (SELECT count(*) FROM ${applications} WHERE job_id = ${id}) AS total,
      (SELECT count(*) FROM ${applications} WHERE job_id = ${id} AND status IN ('active','on_hold')) AS live,
      (SELECT count(*) FROM ${applications} WHERE job_id = ${id} AND status = 'hired') AS hired,
      (SELECT count(*) FROM ${applications} WHERE job_id = ${id} AND stage = 'offer'
        AND status IN ('active','on_hold')) AS at_offer`))[0] ?? {};

  const sourcing = {
    internal: row.sourcingInternal, hunt: row.sourcingHunt,
    linkedin: row.sourcingLinkedin, note: row.sourcingNote,
  };

  return {
    ...row,
    dept, fn, loc, pipeline: pipe, seat,
    stages, skills, channels, hiringManagers: hms, questions,
    recruiter: row.recruiterId ? byId.get(row.recruiterId) ?? null : null,
    sourcer: row.sourcerId ? byId.get(row.sourcerId) ?? null : null,
    coordinator: row.coordinatorId ? byId.get(row.coordinatorId) ?? null : null,
    sourcing,
    routes: routesOf(sourcing),
    confidential: isConfidential(sourcing),
    counts: {
      total: Number(stats.total ?? 0),
      live: Number(stats.live ?? 0),
      hired: Number(stats.hired ?? 0),
      atOffer: Number(stats.at_offer ?? 0),
    },
  };
}

/* ── The board ──────────────────────────────────────────────────────────── */
export type BoardCard = {
  id: string;
  candidateId: string;
  name: string;
  currentTitle: string | null;
  currentCompany: string | null;
  photo: string | null;
  hue: number;
  source: string;
  route: RouteKey;
  status: string;
  daysInStage: number;
  sla: { days: number; sla: number; state: 'ok' | 'due' | 'over' };
  fitScore: number | null;
  fitBand: string | null;
  scorecards: { done: number; pending: number; mean: number | null };
  reviews: { up: number; down: number; star: number; n: number };
  crossApplications: number;
  screening: { status: string; channel: string; verdict: string | null; score: number | null } | null;
  claimedBy: string | null;
};

export type BoardColumn = {
  key: StageKey;
  name: string;
  sla: number;
  ordinal: number;
  band: number;
  cards: BoardCard[];
  overSla: number;
  medianDays: number;
  unscreened?: number;
};

export async function getBoard(
  v: Viewer, jobId: string, route: string | null, clock: Date = new Date(), exec: Exec = db(),
): Promise<{ columns: BoardColumn[]; total: number; shown: number; routeCounts: Array<{ key: RouteKey; n: number; live: number }> }> {
  await requireJob(v, jobId, exec);

  const stages = await exec.select().from(jobStages)
    .where(eq(jobStages.jobId, jobId)).orderBy(asc(jobStages.ordinal));

  const rows = rowsOf(await exec.execute(sql`
    SELECT a.id, a.candidate_id, a.stage::text AS stage, a.status::text AS status, a.source,
           a.stage_entered_at, a.fit_score, a.fit_band,
           c.name, c.current_title, c.current_company, c.photo, c.hue, c.claim_by_name, c.claim_at, c.claim_days,
           js.sla,
           (SELECT count(*) FROM ${evaluations} e WHERE e.application_id = a.id AND e.submitted) AS ev_done,
           (SELECT count(*) FROM ${evaluations} e WHERE e.application_id = a.id AND NOT e.submitted) AS ev_open,
           (SELECT avg(e.overall) FROM ${evaluations} e WHERE e.application_id = a.id AND e.submitted) AS ev_mean,
           (SELECT count(*) FROM ${reviews} r WHERE r.application_id = a.id AND r.rating = 'up') AS rv_up,
           (SELECT count(*) FROM ${reviews} r WHERE r.application_id = a.id AND r.rating = 'down') AS rv_down,
           (SELECT count(*) FROM ${reviews} r WHERE r.application_id = a.id AND r.rating = 'star') AS rv_star,
           (SELECT count(*) FROM ${applications} x
             WHERE x.candidate_id = a.candidate_id AND x.id <> a.id) AS cross_apps,
           s.status::text AS scr_status, s.channel::text AS scr_channel,
           s.verdict::text AS scr_verdict, s.score AS scr_score
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      LEFT JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
      LEFT JOIN LATERAL (
        SELECT * FROM ${screenings} sc WHERE sc.application_id = a.id
         ORDER BY sc.invited_at DESC LIMIT 1) s ON true
     WHERE a.job_id = ${jobId} AND a.status IN ('active','on_hold')`));

  const now = clock.getTime();
  const all: BoardCard[] = rows.map((r) => {
    const days = (now - new Date(r.stage_entered_at).getTime()) / 86_400_000;
    const claimLive = r.claim_at && r.claim_days
      && (now - new Date(r.claim_at).getTime()) / 86_400_000 < Number(r.claim_days);
    return {
      id: r.id,
      candidateId: r.candidate_id,
      name: r.name,
      currentTitle: r.current_title,
      currentCompany: r.current_company,
      photo: r.photo,
      hue: Number(r.hue ?? 3),
      source: r.source,
      route: routeOfSource(r.source),
      status: r.status,
      stage: r.stage,
      daysInStage: days,
      sla: slaOf(days, Number(r.sla ?? 5)),
      fitScore: r.fit_score == null ? null : Number(r.fit_score),
      fitBand: r.fit_band,
      scorecards: {
        done: Number(r.ev_done), pending: Number(r.ev_open),
        mean: r.ev_mean == null ? null : Number(r.ev_mean),
      },
      reviews: {
        up: Number(r.rv_up), down: Number(r.rv_down), star: Number(r.rv_star),
        n: Number(r.rv_up) + Number(r.rv_down) + Number(r.rv_star),
      },
      crossApplications: Number(r.cross_apps),
      screening: r.scr_status
        ? { status: r.scr_status, channel: r.scr_channel, verdict: r.scr_verdict, score: r.scr_score == null ? null : Number(r.scr_score) }
        : null,
      claimedBy: claimLive ? r.claim_by_name : null,
    } as BoardCard & { stage: string };
  });

  const routeCounts = (['internal', 'hunt', 'linkedin'] as RouteKey[]).map((k) => ({
    key: k,
    n: all.filter((c) => c.route === k).length,
    live: all.filter((c) => c.route === k).length,
  }));

  const kept = route ? all.filter((c) => c.route === route) : all;

  const columns: BoardColumn[] = stages.map((s) => {
    const cards = kept.filter((c) => (c as any).stage === s.stageKey);
    /* The entry stages rank by CV fit — best first — because that is the pile a
       recruiter works down. Later stages keep arrival order. */
    const ordered = (s.stageKey === 'applied' || s.stageKey === 'sourced')
      ? [...cards].sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || a.daysInStage - b.daysInStage)
      : [...cards].sort((a, b) => b.daysInStage - a.daysInStage);
    const ds = ordered.map((c) => c.daysInStage).sort((a, b) => a - b);
    return {
      key: s.stageKey as StageKey,
      name: s.name,
      sla: s.sla,
      ordinal: s.ordinal,
      band: stageBand(s.ordinal),
      cards: ordered,
      overSla: ordered.filter((c) => c.sla.state === 'over').length,
      medianDays: ds.length ? (ds.length % 2 ? ds[ds.length >> 1] : (ds[(ds.length >> 1) - 1] + ds[ds.length >> 1]) / 2) : 0,
      unscreened: s.stageKey === 'screen'
        ? ordered.filter((c) => !c.screening || !['completed', 'scheduled', 'calling', 'running'].includes(c.screening.status)).length
        : undefined,
    };
  });

  return { columns, total: all.length, shown: kept.length, routeCounts };
}

