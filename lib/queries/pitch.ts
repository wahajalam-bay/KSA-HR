import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import { pitches, pitchProjects, pitchScores } from '@/db/schema';
import { rows as rowsOf } from './sql';
import { median as scoreMedian } from '@/lib/domain/score';

/* ─────────────────────────────────────────────────────────────────────────────
   The sales pitch, read across a requisition.

   The stage runs on a real Bayut project rather than an invented case study, so
   the interesting question is not "how did this candidate do" but "what are we
   consistently losing marks on" — which is why the card averages each criterion
   across everybody who pitched and names the weakest.
   ───────────────────────────────────────────────────────────────────────────*/

export type PitchInsight = {
  project: { id: string; name: string; criteria: Array<{ key: string; name: string; max: number }> } | null;
  briefed: number;
  scored: number;
  median: number | null;
  /** Average mark per criterion, out of the criterion's own maximum. */
  rows: Array<{ key: string; name: string; avg: number }>;
  weakest: { name: string; avg: number } | null;
  verdicts: Array<{ label: string; value: number; color: string }>;
};

const VERDICT = {
  strong: { label: 'Strong pitch', color: 'var(--ok)' },
  fair: { label: 'Fair', color: 'var(--warn)' },
  weak: { label: 'Weak', color: 'var(--bad)' },
} as const;

/** The project a requisition pitches on: its own, else the first live one. */
async function projectFor(job: { pitchProjectId: string | null }, exec: Exec) {
  const rows = rowsOf(await exec.execute(sql`
    SELECT id, name, criteria, active FROM ${pitchProjects}
     ORDER BY (id = ${job.pitchProjectId ?? ''}) DESC, active DESC, created_at ASC`));
  return rows[0] ?? null;
}

export async function jobPitchInsight(
  job: { id: string; pitchOn: boolean; pitchProjectId: string | null },
  exec: Exec = db(),
): Promise<PitchInsight | null> {
  if (!job.pitchOn) return null;

  const [project, all] = await Promise.all([
    projectFor(job, exec),
    exec.execute(sql`
      SELECT p.id, p.status::text AS status, p.total, p.max, p.score, p.verdict::text AS verdict
        FROM ${pitches} p WHERE p.job_id = ${job.id}`),
  ]);

  const list = rowsOf(all);
  const done = list.filter((p) => p.status === 'completed');

  const marks = done.length ? rowsOf(await exec.execute(sql`
    SELECT s.key, s.name, avg(s.score)::numeric AS avg, min(s.sort_order) AS ord
      FROM ${pitchScores} s
     WHERE s.pitch_id IN (${sql.join(done.map((p) => sql`${p.id}`), sql`, `)})
     GROUP BY 1, 2 ORDER BY 4`)) : [];

  const criteria = (project?.criteria ?? []) as Array<{ key: string; name: string; max: number }>;
  /* The card follows the project's criteria order, not the marks' — a project
     that added a criterion after a pitch was scored still reads in its order. */
  const rows = criteria
    .map((c) => {
      const m = marks.find((x) => x.key === c.key);
      return m ? { key: c.key, name: c.name, avg: Number(m.avg) } : null;
    })
    .filter((x): x is { key: string; name: string; avg: number } => x != null);

  const weakest = rows.length ? [...rows].sort((a, b) => a.avg - b.avg)[0] : null;

  return {
    project: project ? { id: project.id, name: project.name, criteria } : null,
    briefed: list.length,
    scored: done.length,
    median: scoreMedian(done.map((p) => ({
      score: p.score == null ? null : Number(p.score),
      total: p.total == null ? null : Number(p.total),
      max: p.max == null ? null : Number(p.max),
    }))),
    rows,
    weakest: weakest ? { name: weakest.name, avg: weakest.avg } : null,
    verdicts: (['strong', 'fair', 'weak'] as const)
      .map((v) => ({ ...VERDICT[v], value: done.filter((p) => p.verdict === v).length }))
      .filter((x) => x.value),
  };
}
