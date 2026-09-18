import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import { candidates, jobs, staff, departments, locations, applications } from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   SEARCH

   One box, three kinds of answer: a person who has applied, a requisition, and
   somebody on the desk. It is a prefix-and-substring search rather than a
   full-text one, because that is what the box is used for — a half-remembered
   name, part of a company, a requisition somebody is looking at right now — and
   because a ranked full-text index would put "Sales" above "Sara" for the query
   "sa", which is never what was meant.

   The ranking is the prototype's: a name that starts with the query first, then
   whatever else matches, earliest match first.

   Access scope applies. A recruiter who cannot see a requisition cannot find it
   here either, and a candidate is only found through an application on a
   requisition the viewer can reach — otherwise the box would be a way to read
   the whole database one name at a time.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Hit = {
  type: 'candidate' | 'job' | 'staff';
  id: string;
  title: string;
  sub: string | null;
  /** Lower is better: 0 when the name starts with what was typed. */
  score: number;
};

export async function search(
  viewer: Viewer, query: string, limit = 12, exec: Exec = db(),
): Promise<Hit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  const scope = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(viewer)})`;

  /* A candidate is reachable when one of their applications is. Somebody with
     no application at all is the desk's to see, and nobody in the portal's. */
  const people = viewer.isPortal ? [] : rowsOf(await exec.execute(sql`
    SELECT c.id, c.name, c.headline, c.current_title, c.current_company,
           position(${q} in lower(c.name)) AS name_at,
           position(${q} in lower(
             c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.current_company, '')
             || ' ' || coalesce(c.current_title, '') || ' '
             || array_to_string(c.hashtags, ' '))) AS any_at
      FROM ${candidates} c
     WHERE (lower(c.name) LIKE ${like}
            OR lower(coalesce(c.email, '')) LIKE ${like}
            OR lower(coalesce(c.current_company, '')) LIKE ${like}
            OR lower(coalesce(c.current_title, '')) LIKE ${like}
            OR EXISTS (SELECT 1 FROM unnest(c.hashtags) h WHERE lower(h) LIKE ${like}))
       AND (
         NOT EXISTS (SELECT 1 FROM ${applications} a WHERE a.candidate_id = c.id)
         OR EXISTS (SELECT 1 FROM ${applications} a WHERE a.candidate_id = c.id AND ${scope}))
     ORDER BY any_at
     LIMIT ${limit * 2}`));

  const roles = rowsOf(await exec.execute(sql`
    SELECT j.id, j.title, d.name AS dept, l.city,
           position(${q} in lower(j.title || ' ' || coalesce(j.family, '')
                                  || ' ' || coalesce(l.city, ''))) AS at
      FROM ${jobs} j
      LEFT JOIN ${departments} d ON d.id = j.dept_id
      LEFT JOIN ${locations} l ON l.id = j.location_id
     WHERE (lower(j.title) LIKE ${like}
            OR lower(coalesce(j.family, '')) LIKE ${like}
            OR lower(coalesce(l.city, '')) LIKE ${like})
       AND j.id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(viewer)})
     ORDER BY at
     LIMIT ${limit * 2}`));

  const desk = viewer.isPortal ? [] : rowsOf(await exec.execute(sql`
    SELECT s.id, s.name, s.title,
           position(${q} in lower(s.name || ' ' || s.title)) AS at
      FROM ${staff} s
     WHERE s.status <> 'deleted'
       AND (lower(s.name) LIKE ${like} OR lower(s.title) LIKE ${like})
     ORDER BY at
     LIMIT ${limit}`));

  const hits: Hit[] = [
    ...people.map((r): Hit => ({
      type: 'candidate',
      id: r.id as string,
      title: r.name as string,
      sub: (r.headline ?? [r.current_title, r.current_company].filter(Boolean).join(' · ')) as string | null,
      /* A name that starts with what was typed comes first. */
      score: (Number(r.name_at) === 1 ? 0 : 10) + Math.max(0, Number(r.any_at) - 1),
    })),
    ...roles.map((r): Hit => ({
      type: 'job',
      id: r.id as string,
      title: r.title as string,
      sub: [r.dept, r.city].filter(Boolean).join(' · ') || null,
      score: Math.max(0, Number(r.at) - 1),
    })),
    ...desk.map((r): Hit => ({
      type: 'staff',
      id: r.id as string,
      title: r.name as string,
      sub: (r.title ?? null) as string | null,
      score: Math.max(0, Number(r.at) - 1),
    })),
  ];

  return hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, limit);
}
