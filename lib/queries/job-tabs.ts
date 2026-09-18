import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  applications, candidates, jobs, jobStages, evaluations, offers, interviews,
  applicationStageHistory, comments, staff, pitches, pitchProjects, jobSkills,
  candidateSkills, candidateResumes, applicationAnswers,
} from '@/db/schema';
import { rows as rowsOf, count as countOf } from './sql';
import { requireJob, jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_INDEX, STAGE_KEYS, DEFAULT_NAMES, DEFAULT_SLA, type StageKey } from '@/lib/domain/stages';
import { routeOfSource, type RouteKey } from '@/lib/domain/sourcing';
import { match as skillMatch, type BarRow, type CandidateSkill, type Language, type Evidence, akin } from '@/lib/domain/skills';

/* ─────────────────────────────────────────────────────────────────────────────
   The tabs on a requisition: all applicants, the activity feed, and the
   per-requisition insights — the funnel, the time in stage against the SLA, the
   channel share and the scorecard spread.
   ───────────────────────────────────────────────────────────────────────────*/

export type ApplicantRow = {
  id: string;
  candidateId: string;
  name: string;
  photo: string | null;
  hue: number;
  stage: string;
  stageName: string;
  stageOrdinal: number;
  status: string;
  rating: number | null;
  source: string;
  route: RouteKey;
  appliedAt: string;
  daysInStage: number;
  sla: number;
  fit: number | null;
};

export async function jobApplicants(
  v: Viewer, jobId: string,
  f: { q?: string; from?: string; to?: string; route?: string; sort?: string },
  clock: Date = new Date(),
  exec: Exec = db(),
): Promise<{ rows: ApplicantRow[]; total: number; matched: number }> {
  await requireJob(v, jobId, exec);

  const where = [sql`a.job_id = ${jobId}`];
  if (f.from) where.push(sql`a.applied_at::date >= ${f.from}::date`);
  if (f.to) where.push(sql`a.applied_at::date <= ${f.to}::date`);
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    where.push(sql`(c.name ILIKE ${q} OR c.email ILIKE ${q} OR c.phone ILIKE ${q} OR c.current_company ILIKE ${q})`);
  }

  const list = rowsOf(await exec.execute(sql`
    SELECT a.id, a.candidate_id, a.stage::text AS stage, a.status::text AS status, a.rating,
           a.source, a.applied_at, a.stage_entered_at, a.fit_score,
           c.name, c.photo, c.hue, js.name AS stage_name, js.sla
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      LEFT JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY a.applied_at DESC
     LIMIT 500`));

  const total = countOf(await exec.execute(sql`
    SELECT count(*)::int AS n FROM ${applications} WHERE job_id = ${jobId}`));

  const now = clock.getTime();
  let out: ApplicantRow[] = list.map((r) => ({
    id: r.id,
    candidateId: r.candidate_id,
    name: r.name,
    photo: r.photo,
    hue: Number(r.hue ?? 3),
    stage: r.stage,
    stageName: r.stage_name ?? r.stage,
    stageOrdinal: STAGE_INDEX[r.stage as StageKey] ?? 0,
    status: r.status,
    rating: r.rating == null ? null : Number(r.rating),
    source: r.source,
    route: routeOfSource(r.source),
    appliedAt: r.applied_at,
    daysInStage: (now - new Date(r.stage_entered_at).getTime()) / 86_400_000,
    sla: Number(r.sla ?? 5),
    fit: null,
  }));

  if (f.route) out = out.filter((r) => r.route === f.route);

  /* "To the JD" is the skills match, which needs the bar and everybody's
     skills — one query for the lot rather than one per row. */
  if (out.length) {
    const fit = await matchAll(jobId, out.map((r) => r.candidateId), exec);
    out = out.map((r) => ({ ...r, fit: fit.get(r.candidateId) ?? null }));
  }
  if (f.sort === 'fit') out.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));

  return { rows: out, total, matched: out.length };
}

/* ── The skills match, for a whole list at once ─────────────────────────────
   The radar's arithmetic is in lib/domain/skills; this is what feeds it from
   the database without asking 42 separate questions. */
export async function matchAll(
  jobId: string, candidateIds: string[], exec: Exec = db(),
): Promise<Map<string, number>> {
  if (!candidateIds.length) return new Map();
  const ids = sql.join(candidateIds.map((i) => sql`${i}`), sql`, `);

  const bar: BarRow[] = (await exec.select().from(jobSkills)
    .where(sql`${jobSkills.jobId} = ${jobId}`))
    .map((b) => ({ skill: b.skill, level: b.level, must: b.must }));
  if (!bar.length) return new Map();

  const skills = rowsOf(await exec.execute(sql`
    SELECT candidate_id, skill, level, years FROM ${candidateSkills}
     WHERE candidate_id IN (${ids})`));
  const langs = rowsOf(await exec.execute(sql`
    SELECT candidate_id, languages FROM ${candidateResumes}
     WHERE candidate_id IN (${ids}) AND is_current`));

  /* What the loop actually found: every scored criterion on this requisition's
     applications, which is what moves a point away from the CV's claim. */
  const evid = rowsOf(await exec.execute(sql`
    SELECT a.candidate_id, ec.name, ec.score, e.evaluator_name, js.name AS stage_name, 'scorecard' AS kind
      FROM ${evaluations} e
      JOIN ${applications} a ON a.id = e.application_id
      JOIN evaluation_criteria ec ON ec.evaluation_id = e.id
      LEFT JOIN ${jobStages} js ON js.job_id = e.job_id AND js.stage_key = e.stage
     WHERE e.job_id = ${jobId} AND e.submitted AND ec.score IS NOT NULL
       AND a.candidate_id IN (${ids})
    UNION ALL
    SELECT a.candidate_id, ps.name, ps.score, 'the assistant', 'the sales pitch', 'pitch'
      FROM ${pitches} p
      JOIN ${applications} a ON a.id = p.application_id
      JOIN pitch_scores ps ON ps.pitch_id = p.id
     WHERE p.job_id = ${jobId} AND p.status = 'completed' AND a.candidate_id IN (${ids})`));

  const skillsBy = new Map<string, CandidateSkill[]>();
  for (const s of skills) {
    const arr = skillsBy.get(s.candidate_id) ?? [];
    arr.push({ skill: s.skill, level: s.level == null ? null : Number(s.level), years: s.years });
    skillsBy.set(s.candidate_id, arr);
  }
  const langsBy = new Map<string, Language[]>();
  for (const l of langs) langsBy.set(l.candidate_id, (l.languages ?? []) as Language[]);
  const evBy = new Map<string, Array<{ name: string; score: number; who: string; what: string; kind: string }>>();
  for (const e of evid) {
    const arr = evBy.get(e.candidate_id) ?? [];
    arr.push({ name: e.name, score: Number(e.score), who: e.evaluator_name, what: `${e.name} — ${e.stage_name ?? ''}`, kind: e.kind });
    evBy.set(e.candidate_id, arr);
  }

  const out = new Map<string, number>();
  for (const cid of candidateIds) {
    const cs = skillsBy.get(cid) ?? [];
    const ls = langsBy.get(cid) ?? [];
    const ev = evBy.get(cid) ?? [];
    const m = skillMatch(bar, cs, ls, (skill) =>
      ev.filter((x) => akin(x.name, skill) && x.score)
        .map((x): Evidence => ({
          level: Math.max(1, Math.min(5, x.score)),
          what: x.what, who: x.who, kind: x.kind as Evidence['kind'],
        })));
    if (m.score != null) out.set(cid, m.score);
  }
  return out;
}

/* ── Insights on one requisition ────────────────────────────────────────── */
export async function jobInsights(v: Viewer, jobId: string, now: Date = new Date(), exec: Exec = db()) {
  await requireJob(v, jobId, exec);

  const stages = await exec.select().from(jobStages)
    .where(sql`${jobStages.jobId} = ${jobId}`).orderBy(jobStages.ordinal);

  /* The funnel counts who ENTERED each stage and what share of them went
     further — always ≤ 100%, and it means the same on every pipeline, which a
     "conversion from the row above" does not when a template skips a stage.
     Applied and Sourced are alternative entries, so they collapse into one row. */
  const hist = rowsOf(await exec.execute(sql`
    SELECT h.application_id, h.to_stage::text AS stage, a.status::text AS status
      FROM ${applicationStageHistory} h
      JOIN ${applications} a ON a.id = h.application_id
     WHERE a.job_id = ${jobId}`));

  const reached = new Map<string, Set<string>>();
  const statusOf = new Map<string, string>();
  for (const h of hist) {
    const key = h.stage === 'sourced' ? 'applied' : h.stage;
    const set = reached.get(h.application_id) ?? new Set<string>();
    set.add(key);
    reached.set(h.application_id, set);
    statusOf.set(h.application_id, h.status);
  }

  const keys = stages.map((s) => s.stageKey).filter((k) => k !== 'sourced');
  const entered: Record<string, number> = {};
  const passed: Record<string, number> = {};
  for (const k of keys) { entered[k] = 0; passed[k] = 0; }
  for (const [appId, set] of reached) {
    const maxIdx = Math.max(
      ...[...set].map((k) => STAGE_INDEX[k as StageKey] ?? -1),
      statusOf.get(appId) === 'hired' ? STAGE_INDEX.joined : -1,
    );
    for (const k of keys) {
      if (!set.has(k)) continue;
      entered[k]++;
      if (maxIdx > (STAGE_INDEX[k as StageKey] ?? 0)) passed[k]++;
    }
  }
  const funnel = keys.map((k, i) => ({
    key: k,
    name: k === 'applied' ? 'Applied or sourced' : DEFAULT_NAMES[k as StageKey],
    n: entered[k],
    convFromPrev: k === 'joined' ? null : (entered[k] ? passed[k] / entered[k] : 0),
    convFromTop: entered[keys[0]] ? entered[k] / entered[keys[0]] : 0,
  }));

  /* Time in stage: every completed dwell, plus the open ones measured to now. */
  const dwell = rowsOf(await exec.execute(sql`
    WITH spine(stage, sla) AS (VALUES ${sql.join(
      STAGE_KEYS.map((k) => sql`(${k}::text, ${DEFAULT_SLA[k]}::int)`), sql`, `)}),
    hops AS (
      SELECT h.application_id, h.to_stage::text AS stage, h.at,
             lead(h.at) OVER (PARTITION BY h.application_id ORDER BY h.seq) AS next_at,
             a.status::text AS status, a.closed_at
        FROM ${applicationStageHistory} h
        JOIN ${applications} a ON a.id = h.application_id
       WHERE a.job_id = ${jobId}
         AND coalesce((h.metadata->>'close')::boolean, false) = false)
    SELECT stage,
           count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (COALESCE(next_at, closed_at, ${at(now)}) - at)) / 86400) AS median,
           count(*) FILTER (WHERE COALESCE(next_at, closed_at, ${at(now)}) - at
                              > ((SELECT sla FROM spine WHERE spine.stage = hops.stage) || ' days')::interval
                           )::int AS breaches
      FROM hops
     WHERE COALESCE(next_at, closed_at, ${at(now)}) >= at
     GROUP BY stage`));
  /* Named and timed by the spine rather than by this requisition's own labels:
     "3 days in Phone Screen" has to mean the same thing on every requisition or
     the number is not worth reporting. The board uses the local names. */
  const tat = STAGE_KEYS.map((k) => {
    const d = dwell.find((x) => x.stage === k);
    return {
      key: k, name: DEFAULT_NAMES[k], sla: DEFAULT_SLA[k],
      n: Number(d?.n ?? 0),
      median: Number(d?.median ?? 0),
      breaches: Number(d?.breaches ?? 0),
    };
  }).filter((r) => r.n > 0);

  const sources = rowsOf(await exec.execute(sql`
    SELECT source, count(*)::int AS n, count(*) FILTER (WHERE status = 'hired')::int AS hires
      FROM ${applications} WHERE job_id = ${jobId} GROUP BY 1 ORDER BY 2 DESC`));

  const scorecards = rowsOf(await exec.execute(sql`
    SELECT round(overall)::int AS band, count(*)::int AS n
      FROM ${evaluations} WHERE job_id = ${jobId} AND submitted AND overall IS NOT NULL
     GROUP BY 1 ORDER BY 1`));

  const head = rowsOf(await exec.execute(sql`
    SELECT
      (SELECT count(*) FROM ${applications} WHERE job_id = ${jobId})::int AS total,
      (SELECT count(*) FROM ${applications} WHERE job_id = ${jobId}
        AND status IN ('active','on_hold'))::int AS live,
      (SELECT count(*) FROM ${applications} WHERE job_id = ${jobId} AND status = 'hired')::int AS hired,
      (SELECT percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (closed_at - applied_at)) / 86400)
         FROM ${applications} WHERE job_id = ${jobId} AND status = 'hired' AND closed_at IS NOT NULL) AS tth,
      (SELECT count(*) FROM ${offers} WHERE job_id = ${jobId} AND state = 'accepted')::int AS accepted,
      (SELECT count(*) FROM ${offers} WHERE job_id = ${jobId} AND state = 'declined')::int AS declined`))[0] ?? {};

  return {
    funnel, tat, sources,
    scorecards: [1, 2, 3, 4, 5].map((n) => ({
      label: String(n), value: Number(scorecards.find((x) => Number(x.band) === n)?.n ?? 0),
    })),
    head: {
      total: Number(head.total ?? 0),
      live: Number(head.live ?? 0),
      hired: Number(head.hired ?? 0),
      timeToHire: head.tth == null ? null : Number(head.tth),
      accepted: Number(head.accepted ?? 0),
      declined: Number(head.declined ?? 0),
    },
  };
}

/* ── Activity ───────────────────────────────────────────────────────────────
   Derived from the records themselves rather than kept as a separate log: the
   stage hops, the scorecards, the comments and the offer milestones, in one
   ordered stream. */
export type ActivityItem = {
  at: string;
  kind: string;
  applicationId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string | null;
  stageName: string | null;
  actorName: string | null;
  note: string | null;
  amount: number | null;
  verdict: string | null;
  overall: number | null;
};

export type ActivityScope = {
  jobId?: string;
  applicationId?: string;
  candidateId?: string;
  recruiterId?: string;
  /** Only the requisitions this account may see. */
  viewer?: Viewer;
  /** The period, as ISO days; `until` drops anything dated in the future. */
  from?: string;
  to?: string;
  until?: Date;
};

export async function activityFeed(
  scope: ActivityScope,
  limit = 60,
  exec: Exec = db(),
): Promise<ActivityItem[]> {
  const w: ReturnType<typeof sql>[] = [];
  if (scope.jobId) w.push(sql`a.job_id = ${scope.jobId}`);
  if (scope.applicationId) w.push(sql`a.id = ${scope.applicationId}`);
  if (scope.candidateId) w.push(sql`a.candidate_id = ${scope.candidateId}`);
  if (scope.recruiterId) w.push(sql`a.recruiter_id = ${scope.recruiterId}`);
  if (scope.viewer) {
    w.push(sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(scope.viewer)})`);
  }
  const where = w.length ? sql`WHERE ${sql.join(w, sql` AND `)}` : sql``;

  /* The period is applied to the stream rather than to the applications: an
     application that arrived last year still belongs in this week's feed if
     somebody commented on it this week. */
  const span: ReturnType<typeof sql>[] = [];
  if (scope.from) span.push(sql`x.at::date >= ${scope.from}::date`);
  if (scope.to) span.push(sql`x.at::date <= ${scope.to}::date`);
  if (scope.until) span.push(sql`x.at <= ${scope.until.toISOString()}::timestamptz`);
  const window = span.length ? sql`WHERE ${sql.join(span, sql` AND `)}` : sql``;

  /* Who a hop is attributed to: whoever actually made it, and where the record
     predates that being captured, the desk that owns the application — the
     sourcer for an arrival by sourcing, the recruiter for everything else. */
  const list = rowsOf(await exec.execute(sql`
    WITH base AS (
      SELECT a.*, rc.name AS recruiter_name, sc.name AS sourcer_name
        FROM ${applications} a
        LEFT JOIN ${staff} rc ON rc.id = a.recruiter_id
        LEFT JOIN ${staff} sc ON sc.id = a.sourcer_id
      ${where})
    SELECT * FROM (
      SELECT h.at, CASE WHEN h.seq = 1 THEN 'created' ELSE 'stage' END AS kind,
             b.id AS application_id, b.candidate_id, b.job_id, h.to_stage::text AS stage,
             coalesce(h.actor_name,
                      CASE WHEN h.to_stage = 'sourced' THEN coalesce(b.sourcer_name, b.recruiter_name)
                           ELSE b.recruiter_name END) AS actor_name,
             h.reason AS note, NULL::int AS amount, NULL::text AS verdict, NULL::numeric AS overall
        FROM ${applicationStageHistory} h JOIN base b ON b.id = h.application_id
       /* A close writes its own history row so the drawer's timeline carries it,
          but it moved nobody to a new stage. The feed reads the close from the
          application itself, just below, so counting this row as a hop would
          print "Moved to 2nd Interview" twice and the withdrawal once. */
       WHERE h.metadata->>'close' IS NULL
      UNION ALL
      SELECT b.closed_at, b.status::text, b.id, b.candidate_id, b.job_id, b.stage::text,
             b.recruiter_name, b.disqualify_reason, NULL, NULL, NULL
        FROM base b WHERE b.closed_at IS NOT NULL AND b.status IN ('rejected','withdrawn','hired')
      UNION ALL
      SELECT e.at, 'evaluation', b.id, b.candidate_id, b.job_id, e.stage::text,
             e.evaluator_name, e.comment, NULL, e.verdict::text, e.overall
        FROM ${evaluations} e JOIN base b ON b.id = e.application_id
       WHERE e.submitted AND e.at IS NOT NULL
      UNION ALL
      SELECT c.at, 'comment', b.id, b.candidate_id, b.job_id, NULL,
             c.author_name, c.body, NULL, NULL, NULL
        FROM ${comments} c JOIN base b ON b.id = c.application_id
       WHERE c.deleted_at IS NULL
      UNION ALL
      SELECT o.sent_at, 'offer_sent', b.id, b.candidate_id, b.job_id, NULL,
             b.recruiter_name, NULL, o.base_monthly, NULL, NULL
        FROM ${offers} o JOIN base b ON b.id = o.application_id WHERE o.sent_at IS NOT NULL
      UNION ALL
      SELECT o.signed_at, 'offer_signed', b.id, b.candidate_id, b.job_id, NULL,
             b.recruiter_name, NULL, o.base_monthly, NULL, NULL
        FROM ${offers} o JOIN base b ON b.id = o.application_id WHERE o.signed_at IS NOT NULL
    ) x
    ${window}
    ORDER BY x.at DESC NULLS LAST
    LIMIT ${limit}`));

  const jobIds = [...new Set(list.map((r) => r.job_id).filter(Boolean))];
  const candIds = [...new Set(list.map((r) => r.candidate_id).filter(Boolean))];
  const jobRows = jobIds.length ? rowsOf(await exec.execute(sql`
    SELECT id, title FROM ${jobs} WHERE id IN (${sql.join(jobIds.map((i) => sql`${i}`), sql`, `)})`)) : [];
  const candRows = candIds.length ? rowsOf(await exec.execute(sql`
    SELECT id, name FROM ${candidates} WHERE id IN (${sql.join(candIds.map((i) => sql`${i}`), sql`, `)})`)) : [];
  const stageRows = jobIds.length ? rowsOf(await exec.execute(sql`
    SELECT job_id, stage_key::text AS stage_key, name FROM ${jobStages}
     WHERE job_id IN (${sql.join(jobIds.map((i) => sql`${i}`), sql`, `)})`)) : [];

  const jobTitle = new Map(jobRows.map((r) => [r.id, r.title]));
  const candName = new Map(candRows.map((r) => [r.id, r.name]));
  const stageName = new Map(stageRows.map((r) => [`${r.job_id}|${r.stage_key}`, r.name]));

  return list.map((r) => ({
    at: r.at,
    kind: r.kind,
    applicationId: r.application_id,
    candidateId: r.candidate_id,
    candidateName: r.candidate_id ? candName.get(r.candidate_id) ?? null : null,
    jobId: r.job_id,
    jobTitle: r.job_id ? jobTitle.get(r.job_id) ?? null : null,
    stage: r.stage,
    stageName: r.stage ? stageName.get(`${r.job_id}|${r.stage}`) ?? r.stage : null,
    actorName: r.actor_name,
    note: r.note,
    amount: r.amount == null ? null : Number(r.amount),
    verdict: r.verdict,
    overall: r.overall == null ? null : Number(r.overall),
  }));
}

/* ── The Details tab's counts ───────────────────────────────────────────────
   Three small numbers the cards on Details quote and nothing else needs: how
   many people each sourcing route actually brought in, how many interviews each
   hiring manager has taken on this requisition, and how many applicants got as
   far as answering the form. They are counted here rather than in the card so
   the card stays a renderer. */
export type JobDetailExtras = {
  routeCounts: Array<{ key: RouteKey; n: number; live: number; hired: number }>;
  interviewsBy: Record<string, number>;
  answered: number;
};

export async function jobDetailExtras(
  v: Viewer, jobId: string, exec: Exec = db(),
): Promise<JobDetailExtras> {
  await requireJob(v, jobId, exec);

  const [apps, ivs, answered] = await Promise.all([
    exec.execute(sql`
      SELECT a.source, a.status::text AS status FROM ${applications} a WHERE a.job_id = ${jobId}`),
    exec.execute(sql`
      SELECT i.interviewer, count(*)::int AS n FROM ${interviews} i
       WHERE i.job_id = ${jobId} AND i.status <> 'cancelled' AND i.interviewer IS NOT NULL
       GROUP BY 1`),
    exec.execute(sql`
      SELECT count(DISTINCT an.application_id)::int AS n
        FROM ${applicationAnswers} an
        JOIN ${applications} a ON a.id = an.application_id
       WHERE a.job_id = ${jobId}`),
  ]);

  const list = rowsOf(apps).map((r) => ({ route: routeOfSource(r.source), status: r.status }));
  const routeCounts = (['internal', 'hunt', 'linkedin'] as RouteKey[]).map((key) => {
    const mine = list.filter((a) => a.route === key);
    return {
      key,
      n: mine.length,
      live: mine.filter((a) => a.status === 'active' || a.status === 'on_hold').length,
      hired: mine.filter((a) => a.status === 'hired').length,
    };
  });

  const interviewsBy: Record<string, number> = {};
  for (const r of rowsOf(ivs)) interviewsBy[r.interviewer] = Number(r.n);

  return { routeCounts, interviewsBy, answered: countOf(answered) };
}
