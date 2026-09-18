import * as React from 'react';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import { jobInsights } from '@/lib/queries/job-tabs';
import { listJobs } from '@/lib/queries/jobs';
import { applicationsUrl } from '@/lib/charts/drill';
import { ok, type Suite } from '../run';
import { NOW, all, marks, reconcile, behind } from './reconcile';

import { InsightsTab } from '@/components/jobs/insights';

/* A requisition's own analytics, and the stage rail on the requisition list.
   Same rule as everywhere: the number on the chart and the number on the list
   behind it are one number read twice. */

/** The requisitions worth checking: the ones with enough on them to draw. */
async function busiest(n: number): Promise<Array<{ id: string; title: string; openings: number }>> {
  return rowsOf(await db().execute(sql`
    SELECT j.id, j.title, j.openings,
           (SELECT count(*) FROM applications a WHERE a.job_id = j.id) AS apps
      FROM jobs j
     ORDER BY apps DESC, j.id ASC
     LIMIT ${n}`)).map((r) => ({
    id: r.id as string, title: r.title as string, openings: Number(r.openings),
  }));
}

const suite: Suite = {
  name: 'charts · a requisition reconciles with what it drills into',
  tests: [
    {
      name: 'every mark on the insights tab finds exactly what it counted',
      async fn() {
        const jobs = await busiest(3);
        ok(jobs.length > 0, 'there is no requisition to check');
        let checked = 0;
        for (const job of jobs) {
          const data = await jobInsights(all, job.id, NOW);
          checked += await reconcile(all, `${job.title}`,
            React.createElement(InsightsTab, { job, data, pitch: null, ranking: [] }));
        }
        ok(checked > 0, 'the insights tab drew no acting mark');
      },
    },

    {
      name: 'a stage that nobody reached does not pretend to be clickable',
      async fn() {
        const jobs = await busiest(3);
        for (const job of jobs) {
          const data = await jobInsights(all, job.id, NOW);
          const node = React.createElement(InsightsTab, { job, data, pitch: null, ranking: [] });
          for (const m of await marks(node)) {
            if (m.value === 0) ok(!m.pick?.act, `${job.title} · ${m.label} · an empty mark must not act`);
          }
        }
      },
    },

    {
      name: 'the stage rail on the list opens exactly the people standing in that stage',
      async fn() {
        /* The rail is drawn inside the page rather than in a component of its
           own, so this rebuilds the same pick from the same row — which is
           what the page does — and checks where it lands. */
        const { rows } = await listJobs(all, { status: 'open' }, NOW);
        let checked = 0;
        for (const j of rows.slice(0, 8)) {
          for (const d of j.distribution) {
            const found = await behind(all, applicationsUrl({
              tab: 'pipeline', jobId: j.id, stages: [d.key],
            }));
            ok(found === d.n,
              `${j.title} · ${d.name} · the rail says ${d.n}, the list behind it finds ${found}`);
            checked += 1;
          }
        }
        ok(checked > 0, 'no open requisition has anybody in its pipeline');
      },
    },
  ],
};

export default suite;
