import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  candidates, applications, applicationStageHistory, jobs, jobStages, candidateSkills, staff,
  talentPools, talentPoolMembers, evaluations, hashtags as hashtagTable, sources as sourceTable,
} from '@/db/schema';
import { rows as rowsOf, count as countOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_INDEX, slaOf, type StageKey } from '@/lib/domain/stages';

/* ─────────────────────────────────────────────────────────────────────────────
   Reading candidates.

   A candidate is the master person; an application is their relationship with
   one requisition. The four tabs are four different questions —

     In pipeline     everybody live on a board right now
     All candidates  everybody on file
     Talent pools    the saved segments
     Hired           the people who joined

   — and nearly every filter is about the application rather than the person, so
   the query is over applications and folds up to the person. Access by position
   applies at the root: an account scoped to nine requisitions sees the people on
   those nine and nobody else.
   ───────────────────────────────────────────────────────────────────────────*/

export type CandidateTab = 'pipeline' | 'all' | 'hired' | 'pools';

export type CandidateFilters = {
  tab: CandidateTab;
  q?: string;
  family?: string;
  stage?: string;
  source?: string;
  ownerId?: string;
  /** Owned by them or sourced by them. */
  touchedBy?: string;
  held?: string;      // '' | mine | others | free | any
  tags?: string[];
  poolId?: string;
  sort?: string;
  limit?: number;

  /* ── Where a chart lands ───────────────────────────────────────────────────
     A mark on a chart stands for a set of APPLICATIONS, and clicking it has to
     produce that set and no other. These are what make that possible, and they
     are deliberately the same words the charts' own queries use, so the two can
     be checked against each other rather than hoped about.

     `apps` lists applications rather than people. The pipeline and hired tabs
     already do; this is what lets "All candidates" do it too, for a mark that
     counts applications regardless of what became of them. */
  apps?: boolean;

  /* The period, and which date it is about:
       applied  the application arrived inside it          (the default)
       closed   it was closed inside it — a hire, a regret
       inplay   it was open at some point inside it, counted at the stage it
                had reached by the end — the Overview's pipeline of a period
       touched  it arrived inside it, or closed inside it, or is still open —
                what a period is allowed to talk about on the reports, and the
                same predicate `scopeOf` uses in the analytics layer */
  from?: string;
  to?: string;
  /* The same window to the instant rather than to the day. Several reports
     count by the clock — "the last 180 days" means 180 x 24 hours, not 181
     calendar days — and a drill-down off by one boundary is a drill-down that
     disagrees with the chart it came from. When these are given they replace
     `from`/`to` entirely. */
  fromAt?: string;
  toAt?: string;
  win?: 'applied' | 'closed' | 'inplay' | 'touched';

  /* Stages, as a set. Under `inplay` these are matched against the stage the
     application had reached by `to`, not the stage it is at now. */
  stages?: string[];

  /* Reached this stage at any point, from the stage history — which is what a
     funnel step counts. `sourced` folds into `applied`, as the funnel does. */
  reached?: string;

  /* Several sources, for a mark that groups the tail of a ranking into
     "Other" — it stands for those channels and has to land on them. */
  sources?: string[];

  statuses?: string[];
  /** Live, and past the SLA of the stage it is standing in. */
  overSla?: boolean;
  deptId?: string;
  /* Several departments, for a mark that groups the tail of a ranking. */
  deptIds?: string[];
  jobId?: string;
};

/* The stage an application had reached by a date: its last move on or before
   that date, or the stage it sits at if it never moved. Closed applications
   are read at the stage they left from. This is the Overview's own definition,
   written once so a drill-down cannot drift from the chart it came from. */
const stageAsAt = (alias: string, to: string) => sql`
  coalesce(
    (SELECT h.to_stage::text FROM ${applicationStageHistory} h
      WHERE h.application_id = ${sql.raw(alias)}.id
        AND h.at::date <= (CASE WHEN ${sql.raw(alias)}.closed_at IS NOT NULL
                                 AND ${sql.raw(alias)}.closed_at::date < ${to}::date
                                THEN ${sql.raw(alias)}.closed_at::date ELSE ${to}::date END)
      ORDER BY h.at::date DESC, h.seq DESC LIMIT 1),
    ${sql.raw(alias)}.stage::text)`;

export type CandidateRow = {
  candidateId: string;
  applicationId: string | null;
  name: string;
  currentTitle: string | null;
  currentCompany: string | null;
  locationCity: string | null;
  yearsExperience: number | null;
  photo: string | null;
  hue: number;
  hashtags: string[];
  claimedBy: string | null;
  claimDaysLeft: number | null;
  applications: number;
  jobId: string | null;
  jobTitle: string | null;
  stage: string | null;
  stageName: string | null;
  stageOrdinal: number;
  status: string | null;
  live: boolean;
  daysInStage: number | null;
  sla: ReturnType<typeof slaOf> | null;
  rating: number | null;
  lastAt: string | null;
};

export async function listCandidates(
  v: Viewer, f: CandidateFilters, clock: Date = new Date(), exec: Exec = db(),
): Promise<{ rows: CandidateRow[]; total: number; shown: number; tagFacets: Array<{ tag: string; n: number }> }> {
  const scopedJobs = sql`(SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const limit = f.limit ?? 120;

  /* Which applications count in this tab. The predicate is written against
     whichever alias the join below uses — `l` when the tab is a list of
     applications, `a` inside the lateral that picks one per person. */
  const pickFor = (alias: string) => (f.tab === 'pipeline'
    ? sql.raw(`${alias}.status IN ('active','on_hold')`)
    : f.tab === 'hired' ? sql.raw(`${alias}.status = 'hired'`) : sql`true`);

  const where: ReturnType<typeof sql>[] = [];
  if (f.q?.trim()) {
    const q = `%${f.q.trim().replace(/^#/, '')}%`;
    where.push(sql`(
      c.name ILIKE ${q} OR c.email ILIKE ${q} OR c.current_company ILIKE ${q}
      OR c.current_title ILIKE ${q}
      OR EXISTS (SELECT 1 FROM ${candidateSkills} s WHERE s.candidate_id = c.id AND s.skill ILIKE ${q})
      OR EXISTS (SELECT 1 FROM unnest(c.hashtags) h WHERE h ILIKE ${q}))`);
  }
  if (f.family) where.push(sql`c.family = ${f.family}`);
  const srcs = (f.sources?.length ? f.sources : f.source ? [f.source] : []).filter(Boolean);
  if (srcs.length) {
    where.push(sql`l.source IN (${sql.join(srcs.map((s) => sql`${s}`), sql`, `)})`);
  }
  if (f.ownerId) where.push(sql`l.recruiter_id = ${f.ownerId}`);
  /* Owned OR sourced. A sourcer's own pipeline is the applications they brought
     in as well as any they carry, and the reports count it that way. */
  if (f.touchedBy) {
    where.push(sql`(l.recruiter_id = ${f.touchedBy} OR l.sourcer_id = ${f.touchedBy})`);
  }

  /* ── What a chart handed over ─────────────────────────────────────────────*/
  const win = f.win ?? 'applied';
  if (f.fromAt && f.toAt) {
    const col = win === 'closed' ? sql`l.closed_at` : sql`l.applied_at`;
    if (win === 'inplay') {
      where.push(sql`l.applied_at <= ${f.toAt}::timestamptz`);
      where.push(sql`(l.closed_at IS NULL OR l.closed_at >= ${f.fromAt}::timestamptz)`);
    } else if (win === 'touched') {
      where.push(sql`(
        (l.applied_at >= ${f.fromAt}::timestamptz AND l.applied_at <= ${f.toAt}::timestamptz)
        OR (l.closed_at >= ${f.fromAt}::timestamptz AND l.closed_at <= ${f.toAt}::timestamptz)
        OR l.status IN ('active','on_hold'))`);
    } else {
      where.push(sql`${col} >= ${f.fromAt}::timestamptz AND ${col} <= ${f.toAt}::timestamptz`);
    }
  } else if (f.from && f.to) {
    if (win === 'closed') {
      where.push(sql`l.closed_at::date BETWEEN ${f.from}::date AND ${f.to}::date`);
    } else if (win === 'inplay') {
      /* Open at some point inside the period: applied by the end of it and not
         already closed before it began. */
      where.push(sql`l.applied_at::date <= ${f.to}::date`);
      where.push(sql`(l.closed_at IS NULL OR l.closed_at::date >= ${f.from}::date)`);
    } else if (win === 'touched') {
      where.push(sql`(l.applied_at::date BETWEEN ${f.from}::date AND ${f.to}::date
        OR l.closed_at::date BETWEEN ${f.from}::date AND ${f.to}::date
        OR l.status IN ('active','on_hold'))`);
    } else {
      where.push(sql`l.applied_at::date BETWEEN ${f.from}::date AND ${f.to}::date`);
    }
  }

  /* Stage, as a set. One stage or several reads the same way, so a chart whose
     mark groups stages together — Screening is screen and assessment — lands on
     exactly the people it counted. */
  const stages = (f.stages?.length ? f.stages : f.stage ? [f.stage] : []).filter(Boolean);
  if (stages.length) {
    const list = sql.join(stages.map((s) => sql`${s}`), sql`, `);
    const asAt = f.to ?? (f.toAt ? String(f.toAt).slice(0, 10) : null);
    where.push(win === 'inplay' && asAt
      ? sql`${stageAsAt('l', asAt)} IN (${list})`
      : sql`l.stage::text IN (${list})`);
  }

  if (f.reached) {
    where.push(sql`EXISTS (SELECT 1 FROM ${applicationStageHistory} h
      WHERE h.application_id = l.id
        AND (CASE WHEN h.to_stage::text = 'sourced' THEN 'applied' ELSE h.to_stage::text END)
            = ${f.reached})`);
  }

  /* Past the SLA of the stage they are standing in, right now — the same test
     the reports use, against the same `job_stages` row. */
  if (f.overSla) {
    where.push(sql`l.status IN ('active','on_hold')
      AND ${at(clock)} - l.stage_entered_at > (coalesce(js.sla, 5) || ' days')::interval`);
  }

  if (f.statuses?.length) {
    where.push(sql`l.status::text IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`);
  }
  const depts = (f.deptIds?.length ? f.deptIds : f.deptId ? [f.deptId] : []).filter(Boolean);
  if (depts.length) {
    where.push(sql`EXISTS (SELECT 1 FROM ${jobs} j WHERE j.id = l.job_id
      AND j.dept_id IN (${sql.join(depts.map((x) => sql`${x}`), sql`, `)}))`);
  }
  if (f.jobId) where.push(sql`l.job_id = ${f.jobId}`);
  if (f.tags?.length) {
    where.push(sql`c.hashtags @> ${sql`ARRAY[${sql.join(f.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`}`);
  }
  if (f.poolId) {
    where.push(sql`EXISTS (SELECT 1 FROM ${talentPoolMembers} m
      WHERE m.candidate_id = c.id AND m.pool_id = ${f.poolId})`);
  }

  /* The recruiter tag. A tag that has run out counts as released, so "somebody
     else's" never includes a hold nobody is honouring any more. */
  const liveClaim = sql`(c.claim_at IS NOT NULL AND c.claim_days IS NOT NULL
    AND c.claim_at + (c.claim_days || ' days')::interval > ${at(clock)})`;
  if (f.held === 'mine') where.push(sql`${liveClaim} AND c.claim_by = ${v.staffId ?? null}`);
  else if (f.held === 'others') where.push(sql`${liveClaim} AND c.claim_by IS DISTINCT FROM ${v.staffId ?? null}`);
  else if (f.held === 'free') where.push(sql`NOT ${liveClaim}`);
  else if (f.held === 'any') where.push(liveClaim);

  /* Only people this account may see at all. */
  where.push(sql`EXISTS (SELECT 1 FROM ${applications} a
    WHERE a.candidate_id = c.id AND a.job_id IN ${scopedJobs})`);

  const whereSql = where.length ? sql.join(where, sql` AND `) : sql`true`;

  const order = {
    stale: sql`CASE WHEN l.status IN ('active','on_hold')
                    THEN EXTRACT(EPOCH FROM (${at(clock)} - l.stage_entered_at)) / 86400 / NULLIF(js.sla, 0)
                    ELSE -1 END DESC NULLS LAST`,
    recent: sql`COALESCE(l.stage_entered_at, c.created_at) DESC NULLS LAST`,
    rating: sql`l.rating DESC NULLS LAST`,
    experience: sql`c.years_experience DESC NULLS LAST`,
    name: sql`c.name ASC`,
  }[f.sort ?? (f.tab === 'pipeline' ? 'stale' : 'recent')] ?? sql`c.name ASC`;

  /* In pipeline and Hired are lists of APPLICATIONS — somebody live on two
     boards is two rows, because they are two pieces of work. All candidates is
     a list of PEOPLE, each shown through their live application if they have
     one and their most recent otherwise. The prototype drew the same
     distinction, and the counts on the tab strip depend on it. */
  const perApplication = f.tab === 'pipeline' || f.tab === 'hired' || !!f.apps;
  const lateral = perApplication
    ? sql`JOIN ${applications} l ON l.candidate_id = c.id AND l.job_id IN ${scopedJobs} AND ${pickFor('l')}`
    : sql`
    LEFT JOIN LATERAL (
      SELECT a.* FROM ${applications} a
       WHERE a.candidate_id = c.id AND a.job_id IN ${scopedJobs}
       ORDER BY (a.status IN ('active','on_hold')) DESC,
                CASE a.stage
                  WHEN 'joined' THEN 9 WHEN 'offer' THEN 8 WHEN 'ivf' THEN 7 WHEN 'pitch' THEN 6
                  WHEN 'iv2' THEN 5 WHEN 'iv1' THEN 4 WHEN 'assessment' THEN 3
                  WHEN 'screen' THEN 2 ELSE 1 END DESC,
                a.applied_at DESC
       LIMIT 1) l ON true`;

  const total = countOf(await exec.execute(sql`
    SELECT count(*)::int AS n FROM ${candidates} c ${lateral}
      LEFT JOIN ${jobStages} js ON js.job_id = l.job_id AND js.stage_key = l.stage
     WHERE ${whereSql}`));

  const list = rowsOf(await exec.execute(sql`
    SELECT c.id, c.name, c.current_title, c.current_company, c.location_city,
           c.years_experience, c.photo, c.hue, c.hashtags, c.created_at,
           c.claim_by, c.claim_by_name, c.claim_at, c.claim_days,
           (SELECT count(*) FROM ${applications} a
             WHERE a.candidate_id = c.id AND a.job_id IN ${scopedJobs})::int AS apps,
           l.id AS app_id, l.job_id, l.stage::text AS stage, l.status::text AS status,
           l.rating, l.stage_entered_at, l.applied_at, l.closed_at,
           js.name AS stage_name, js.sla, js.ordinal AS stage_ord,
           jb.title AS job_title,
           (SELECT avg(e.overall) FROM ${evaluations} e
             WHERE e.application_id = l.id AND e.submitted) AS ev_mean
      FROM ${candidates} c
      ${lateral}
      LEFT JOIN ${jobs} jb ON jb.id = l.job_id
      LEFT JOIN ${jobStages} js ON js.job_id = l.job_id AND js.stage_key = l.stage
     WHERE ${whereSql}
     ORDER BY ${order}
     LIMIT ${limit}`));

  /* The tag facets are counted over the same filtered set, minus the tag filter
     itself — a facet that vanishes the moment you use it is not a facet. */
  const tagWhere = where.filter((_, i) => true);
  const tagFacets = rowsOf(await exec.execute(sql`
    SELECT h AS tag, count(*)::int AS n, COALESCE(min(t.sort_order), 99) AS ord
      FROM ${candidates} c ${lateral}
      LEFT JOIN ${jobStages} js ON js.job_id = l.job_id AND js.stage_key = l.stage,
           unnest(c.hashtags) h
      LEFT JOIN ${hashtagTable} t ON t.tag = h
     WHERE ${whereSql}
     GROUP BY 1 ORDER BY 2 DESC, 3 ASC LIMIT 12`)).map((r) => ({ tag: r.tag, n: Number(r.n) }));

  const now = clock.getTime();
  const rows: CandidateRow[] = list.map((r) => {
    const claimLive = r.claim_at && r.claim_days
      && (now - new Date(r.claim_at).getTime()) / 86_400_000 < Number(r.claim_days);
    const live = ['active', 'on_hold'].includes(r.status ?? '');
    const days = r.stage_entered_at ? (now - new Date(r.stage_entered_at).getTime()) / 86_400_000 : null;
    return {
      candidateId: r.id,
      applicationId: r.app_id ?? null,
      name: r.name,
      currentTitle: r.current_title,
      currentCompany: r.current_company,
      locationCity: r.location_city,
      yearsExperience: r.years_experience == null ? null : Number(r.years_experience),
      photo: r.photo,
      hue: Number(r.hue ?? 3),
      hashtags: (r.hashtags ?? []) as string[],
      claimedBy: claimLive ? r.claim_by_name : null,
      claimDaysLeft: claimLive
        ? Math.round(Number(r.claim_days) - (now - new Date(r.claim_at).getTime()) / 86_400_000)
        : null,
      applications: Number(r.apps ?? 0),
      jobId: r.job_id ?? null,
      jobTitle: r.job_title ?? null,
      stage: r.stage ?? null,
      stageName: r.stage_name ?? r.stage ?? null,
      stageOrdinal: Number(r.stage_ord ?? STAGE_INDEX[r.stage as StageKey] ?? 0),
      status: r.status ?? null,
      live,
      daysInStage: live ? days : null,
      sla: live && days != null ? slaOf(days, Number(r.sla ?? 5)) : null,
      rating: r.ev_mean == null ? (r.rating == null ? null : Number(r.rating)) : Number(r.ev_mean),
      lastAt: r.closed_at ?? r.applied_at ?? r.created_at ?? null,
    };
  });

  return { rows, total, shown: rows.length, tagFacets };
}

/* The dropdowns. Counted over what this account may see, so a filter never
   promises rows the list then refuses to show. */
export async function candidateFilterOptions(v: Viewer, exec: Exec = db()) {
  const scopedJobs = sql`(SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const [fams, srcs, owners, tags, stages] = await Promise.all([
    exec.execute(sql`SELECT DISTINCT c.family AS v FROM ${candidates} c
       WHERE c.family IS NOT NULL
         AND EXISTS (SELECT 1 FROM ${applications} a WHERE a.candidate_id = c.id AND a.job_id IN ${scopedJobs})
       ORDER BY 1`),
    exec.execute(sql`SELECT name AS v FROM ${sourceTable} WHERE archived_at IS NULL ORDER BY sort_order`),
    exec.execute(sql`SELECT id, name FROM ${staff}
       WHERE role IN ('recruiter','tal_lead') AND status <> 'deleted' ORDER BY name`),
    exec.execute(sql`SELECT tag AS v FROM ${hashtagTable} ORDER BY sort_order`),
    exec.execute(sql`SELECT key::text AS v, name FROM stages ORDER BY ordinal`),
  ]);
  return {
    families: rowsOf(fams).map((r) => r.v as string),
    sources: rowsOf(srcs).map((r) => r.v as string),
    owners: rowsOf(owners).map((r) => ({ id: r.id as string, name: r.name as string })),
    tags: rowsOf(tags).map((r) => r.v as string),
    stages: rowsOf(stages).map((r) => ({ key: r.v as string, name: r.name as string })),
  };
}

export async function tabCounts(v: Viewer, exec: Exec = db()) {
  const scopedJobs = sql`(SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const r = rowsOf(await exec.execute(sql`
    SELECT
      (SELECT count(*) FROM ${applications} a
        WHERE a.status IN ('active','on_hold') AND a.job_id IN ${scopedJobs})::int AS pipeline,
      (SELECT count(DISTINCT c.id) FROM ${candidates} c
        WHERE EXISTS (SELECT 1 FROM ${applications} a
                       WHERE a.candidate_id = c.id AND a.job_id IN ${scopedJobs}))::int AS all_people,
      (SELECT count(*) FROM ${applications} a
        WHERE a.status = 'hired' AND a.job_id IN ${scopedJobs})::int AS hired,
      (SELECT count(*) FROM ${talentPools})::int AS pools`))[0] ?? {};
  return {
    pipeline: Number(r.pipeline ?? 0),
    all: Number(r.all_people ?? 0),
    hired: Number(r.hired ?? 0),
    pools: Number(r.pools ?? 0),
  };
}

/* ── Talent pools ───────────────────────────────────────────────────────────
   Three numbers per pool, which is what makes one worth keeping: how many
   people are in it, how many of them are live on a board right now, and how
   many of them have been hired. All three are counted inside this account's
   access, so a pool never promises people it then refuses to list. */
export type PoolCard = {
  id: string; name: string; filter: Record<string, unknown>; created_at: string;
  owner_name: string | null; members: number; live: number; hired: number;
};

export async function listPools(v: Viewer, exec: Exec = db()): Promise<PoolCard[]> {
  const scopedJobs = sql`(SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;
  const visible = sql`EXISTS (SELECT 1 FROM ${applications} a
    WHERE a.candidate_id = m.candidate_id AND a.job_id IN ${scopedJobs})`;
  return rowsOf<PoolCard>(await exec.execute(sql`
    SELECT p.id, p.name, p.filter, p.created_at, s.name AS owner_name,
           (SELECT count(*) FROM ${talentPoolMembers} m
             WHERE m.pool_id = p.id AND ${visible})::int AS members,
           (SELECT count(*) FROM ${talentPoolMembers} m
             WHERE m.pool_id = p.id AND ${visible}
               AND EXISTS (SELECT 1 FROM ${applications} a
                            WHERE a.candidate_id = m.candidate_id
                              AND a.status IN ('active','on_hold')
                              AND a.job_id IN ${scopedJobs}))::int AS live,
           (SELECT count(*) FROM ${talentPoolMembers} m
             WHERE m.pool_id = p.id AND ${visible}
               AND EXISTS (SELECT 1 FROM ${applications} a
                            WHERE a.candidate_id = m.candidate_id
                              AND a.status = 'hired' AND a.job_id IN ${scopedJobs}))::int AS hired
      FROM ${talentPools} p
      LEFT JOIN ${staff} s ON s.id = p.owner_id
     ORDER BY p.sort_order, p.name`));
}
