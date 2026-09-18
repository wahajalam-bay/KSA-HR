import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  applications, candidates, evaluations, evaluationCriteria, interviewKits, jobs, jobStages,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { requireJob } from '@/lib/authz';
import { analyse, type EvaluationInput, type Feedback } from '@/lib/domain/feedback';
import { STAGE_INDEX, type StageKey } from '@/lib/domain/stages';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   Gathering the scorecards a feedback reading is made of.

   One query per requisition rather than one per candidate: the ranking table
   needs every live application's scorecards and the rank needs every scored
   application's mean, so fetching them together is both fewer round trips and
   the only way the rank can be right.
   ───────────────────────────────────────────────────────────────────────────*/

export type RankedRow = {
  applicationId: string;
  candidateId: string;
  name: string;
  photo: string | null;
  hue: number;
  stage: string;
  stageName: string;
  stageOrdinal: number;
  feedback: Feedback;
};

async function kitWeights(jobId: string, exec: Exec): Promise<Record<string, number>> {
  const rows = rowsOf(await exec.execute(sql`
    SELECT k.criteria FROM ${interviewKits} k
      JOIN ${jobs} j ON j.pipeline_id = k.pipeline_id
     WHERE j.id = ${jobId} AND k.archived_at IS NULL
     LIMIT 1`));
  const criteria = (rows[0]?.criteria ?? []) as Array<{ name: string; weight?: number }>;
  return Object.fromEntries(criteria.map((c) => [c.name, c.weight ?? 1]));
}

/** Every scorecard on a requisition, grouped by application. */
async function scorecardsOfJob(jobId: string, exec: Exec) {
  const rows = rowsOf(await exec.execute(sql`
    SELECT e.id, e.application_id, e.evaluator_name, e.stage::text AS stage, e.overall,
           e.verdict::text AS verdict, e.submitted, js.name AS stage_name,
           coalesce(
             (SELECT json_agg(json_build_object('name', c.name, 'score', c.score)
                              ORDER BY c.sort_order)
                FROM ${evaluationCriteria} c WHERE c.evaluation_id = e.id),
             '[]'::json) AS criteria
      FROM ${evaluations} e
      LEFT JOIN ${jobStages} js ON js.job_id = e.job_id AND js.stage_key = e.stage
     WHERE e.job_id = ${jobId}`));

  const byApp = new Map<string, EvaluationInput[]>();
  for (const r of rows) {
    const one: EvaluationInput = {
      id: r.id,
      evaluatorName: r.evaluator_name,
      stage: r.stage,
      stageName: r.stage_name ?? r.stage,
      overall: r.overall == null ? null : Number(r.overall),
      verdict: r.verdict,
      submitted: r.submitted,
      criteria: (r.criteria ?? []).map((c: any) => ({ name: c.name, score: c.score == null ? null : Number(c.score) })),
    };
    byApp.set(r.application_id, [...(byApp.get(r.application_id) ?? []), one]);
  }
  return byApp;
}

/** The peers a rank is measured against: every application here that has been scored. */
function peersOf(byApp: Map<string, EvaluationInput[]>) {
  const peers: Array<{ applicationId: string; mean: number }> = [];
  for (const [applicationId, evs] of byApp) {
    const done = evs.filter((e) => e.submitted && e.overall != null).map((e) => e.overall as number);
    if (done.length) peers.push({ applicationId, mean: done.reduce((a, b) => a + b, 0) / done.length });
  }
  return peers;
}

/** The requisition's live candidates in feedback order, best first. */
export async function jobRanking(v: Viewer, jobId: string, exec: Exec = db()): Promise<RankedRow[]> {
  await requireJob(v, jobId, exec);

  const [weights, byApp] = await Promise.all([kitWeights(jobId, exec), scorecardsOfJob(jobId, exec)]);
  const peers = peersOf(byApp);

  const live = rowsOf(await exec.execute(sql`
    SELECT a.id, a.candidate_id, a.stage::text AS stage, c.name, c.photo, c.hue, js.name AS stage_name
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      LEFT JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
     WHERE a.job_id = ${jobId} AND a.status IN ('active','on_hold')`));

  return live
    .map((r) => {
      const evs = byApp.get(r.id) ?? [];
      const feedback = analyse({ evaluations: evs, weights, peers, applicationId: r.id });
      return {
        applicationId: r.id,
        candidateId: r.candidate_id,
        name: r.name,
        photo: r.photo,
        hue: Number(r.hue ?? 3),
        stage: r.stage,
        stageName: r.stage_name ?? r.stage,
        stageOrdinal: STAGE_INDEX[r.stage as StageKey] ?? 0,
        feedback,
      };
    })
    .filter((x) => x.feedback.done.length)
    .sort((a, b) => (b.feedback.score ?? 0) - (a.feedback.score ?? 0));
}

/** One application's reading, with its rank among the requisition's peers. */
export async function applicationFeedback(
  v: Viewer, applicationId: string, exec: Exec = db(),
): Promise<Feedback | null> {
  const [app] = rowsOf(await exec.execute(sql`
    SELECT job_id FROM ${applications} WHERE id = ${applicationId} LIMIT 1`));
  if (!app) return null;
  await requireJob(v, app.job_id, exec);

  const [weights, byApp] = await Promise.all([kitWeights(app.job_id, exec), scorecardsOfJob(app.job_id, exec)]);
  return analyse({
    evaluations: byApp.get(applicationId) ?? [],
    weights,
    peers: peersOf(byApp),
    applicationId,
  });
}
