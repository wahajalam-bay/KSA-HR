import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import { applications } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { fit, type FitCandidate, type FitJob } from '@/lib/domain/cv-fit';

/* ─────────────────────────────────────────────────────────────────────────────
   Keeping the CV fit in step.

   The score is cached on the application, because the Applied and Sourced
   columns rank by it and a board of forty cards cannot recompute forty CVs
   against a job description on every paint. It is recomputed whenever anything
   it depends on changes: a CV uploaded or re-read, the requisition's skills or
   its description edited, a candidate's record corrected.

   `recomputeFor` takes whichever handle the caller has — an application, a
   requisition, a candidate — and does the least work that keeps the cache
   honest.
   ───────────────────────────────────────────────────────────────────────────*/

type Target = { applicationId?: string; jobId?: string; candidateId?: string; all?: boolean };

export async function recomputeFit(t: Target, exec: Exec = db()): Promise<number> {
  const where = t.applicationId ? sql`a.id = ${t.applicationId}`
    : t.jobId ? sql`a.job_id = ${t.jobId}`
      : t.candidateId ? sql`a.candidate_id = ${t.candidateId}`
        : t.all ? sql`true`
          : null;
  if (!where) return 0;

  const rows = rowsOf(await exec.execute(sql`
    SELECT a.id,
           c.headline, c.current_title, c.current_company, c.location_city, c.nationality,
           c.family, c.years_experience,
           COALESCE((SELECT array_agg(cs.skill) FROM candidate_skills cs
                      WHERE cs.candidate_id = c.id), '{}') AS skills,
           COALESCE(r.languages, '[]'::jsonb) AS languages,
           r.summary AS resume_summary,
           left(COALESCE(r.raw_text, ''), 20000) AS resume_text,
           COALESCE((SELECT string_agg(
                       COALESCE(e->>'title','') || ' ' || COALESCE(e->>'company','') || ' ' ||
                       COALESCE((SELECT string_agg(b::text, ' ') FROM jsonb_array_elements_text(
                         CASE WHEN jsonb_typeof(e->'bullets') = 'array' THEN e->'bullets' ELSE '[]'::jsonb END) b), ''),
                       ' ')
                     FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(r.experience) = 'array' THEN r.experience ELSE '[]'::jsonb END) e), '')
             AS experience_text,
           j.title AS job_title, j.family AS job_family, j.remote_ok,
           l.city AS job_city,
           COALESCE((SELECT array_agg(js.skill ORDER BY js.sort_order) FROM job_skills js
                      WHERE js.job_id = j.id), '{}') AS job_skills,
           COALESCE(j.desc_requirements, '{}') AS job_requirements
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id
      JOIN locations l ON l.id = j.location_id
      LEFT JOIN candidate_resumes r ON r.candidate_id = c.id AND r.is_current
     WHERE ${where}`));

  if (!rows.length) return 0;

  /* One UPDATE … FROM (VALUES …) rather than a round trip per application:
     re-scoring a whole requisition after its skill bar changed is 50 rows, and
     re-scoring everything after a seed is 1,209. */
  const values = rows.map((r) => {
    const c: FitCandidate = {
      headline: r.headline, currentTitle: r.current_title, currentCompany: r.current_company,
      locationCity: r.location_city, nationality: r.nationality, family: r.family,
      yearsExperience: r.years_experience == null ? null : Number(r.years_experience),
      skills: (r.skills ?? []) as string[],
      languages: ((r.languages ?? []) as Array<{ name?: string }>).map((l) => l?.name ?? '').filter(Boolean),
      resumeSummary: r.resume_summary, resumeText: r.resume_text, experienceText: r.experience_text,
    };
    const j: FitJob = {
      title: r.job_title, family: r.job_family, city: r.job_city, remoteOk: !!r.remote_ok,
      skills: (r.job_skills ?? []) as string[],
      requirements: (r.job_requirements ?? []) as string[],
    };
    const f = fit(c, j);
    return { id: r.id as string, score: f.score, band: f.band };
  });

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    await exec.execute(sql`
      UPDATE applications AS a
         SET fit_score = v.score, fit_band = v.band, fit_model = 'local', fit_at = now()
        FROM (VALUES ${sql.join(
          slice.map((x) => sql`(${x.id}, ${x.score}::int, ${x.band}::text)`), sql`, `,
        )}) AS v(id, score, band)
       WHERE a.id = v.id
         AND (a.fit_model IS DISTINCT FROM 'ai')`);
  }
  return values.length;
}

/** The full breakdown, for the sheet the fit badge opens. */
export async function fitBreakdown(applicationId: string, exec: Exec = db()) {
  const rows = rowsOf(await exec.execute(sql`
    SELECT a.id, a.fit_model, c.name AS candidate_name, j.title AS job_title,
           c.headline, c.current_title, c.current_company, c.location_city, c.nationality,
           c.family, c.years_experience,
           COALESCE((SELECT array_agg(cs.skill) FROM candidate_skills cs
                      WHERE cs.candidate_id = c.id), '{}') AS skills,
           COALESCE(r.languages, '[]'::jsonb) AS languages,
           r.summary AS resume_summary,
           j.family AS job_family, j.remote_ok, l.city AS job_city,
           COALESCE((SELECT array_agg(js.skill ORDER BY js.sort_order) FROM job_skills js
                      WHERE js.job_id = j.id), '{}') AS job_skills,
           COALESCE(j.desc_requirements, '{}') AS job_requirements
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id
      JOIN locations l ON l.id = j.location_id
      LEFT JOIN candidate_resumes r ON r.candidate_id = c.id AND r.is_current
     WHERE a.id = ${applicationId}`));
  const r = rows[0];
  if (!r) return null;
  const f = fit(
    {
      headline: r.headline, currentTitle: r.current_title, currentCompany: r.current_company,
      locationCity: r.location_city, nationality: r.nationality, family: r.family,
      yearsExperience: r.years_experience == null ? null : Number(r.years_experience),
      skills: (r.skills ?? []) as string[],
      languages: ((r.languages ?? []) as Array<{ name?: string }>).map((l) => l?.name ?? '').filter(Boolean),
      resumeSummary: r.resume_summary,
    },
    {
      title: r.job_title, family: r.job_family, city: r.job_city, remoteOk: !!r.remote_ok,
      skills: (r.job_skills ?? []) as string[], requirements: (r.job_requirements ?? []) as string[],
    },
  );
  return { ...f, candidateName: r.candidate_name as string, jobTitle: r.job_title as string };
}
