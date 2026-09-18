import * as React from 'react';
import { teamList, profile } from '@/lib/queries/team';
import * as W from '@/lib/domain/window';
import { ok, type Suite } from '../run';
import { NOW, all, marks, reconcile } from './reconcile';

import { TeamBoard } from '@/components/team/list';
import { MonthlyCard, PipelinePie, FunnelCard, TatCard } from '@/components/team/profile';

/* The desk, and one person's record.

   These are counted by the clock — "the last 180 days" is 180 × 24 hours from
   this moment, not 181 calendar days — so the drill-downs carry instants. A
   date-wide filter would take in whatever closed later today and quietly
   disagree with the bar it came from. */

const WIN = W.preset(180);

const suite: Suite = {
  name: 'charts · the team reconciles with what it drills into',
  tests: [
    {
      name: 'the desk board finds exactly what each of its marks counted',
      async fn() {
        const d = await teamList(all, WIN, NOW);
        const n = await reconcile(all, 'Team',
          React.createElement(TeamBoard, { d, role: '', win: WIN, now: NOW }));
        ok(n > 0, 'the team board drew no acting mark');
      },
    },

    {
      name: "a recruiter's own record reconciles too",
      async fn() {
        const d = await teamList(all, WIN, NOW);
        const hiring = d.people.filter((p) => p.role === 'recruiter' || p.role === 'tal_lead');
        ok(hiring.length > 0, 'nobody on the desk carries a hiring target');
        let checked = 0;
        for (const p of hiring.slice(0, 3)) {
          const raw = await profile(all, p.id, WIN, NOW);
          if ('missing' in raw) continue;
          const pr = raw;
          for (const [name, node] of [
            ['Monthly', React.createElement(MonthlyCard, { d: pr })],
            ['Pipeline', React.createElement(PipelinePie, { d: pr })],
            ['Funnel', React.createElement(FunnelCard, { d: pr, win: WIN, now: NOW })],
            ['Time in stage', React.createElement(TatCard, { d: pr })],
          ] as Array<[string, React.ReactElement]>) {
            checked += await reconcile(all, `${p.name} · ${name}`, node);
          }
        }
        ok(checked > 0, 'no profile drew an acting mark');
      },
    },

    {
      name: 'a month with no hires, and a target, do not pretend to be clickable',
      async fn() {
        const d = await teamList(all, WIN, NOW);
        const hiring = d.people.filter((p) => p.role === 'recruiter' || p.role === 'tal_lead');
        for (const p of hiring.slice(0, 3)) {
          const raw = await profile(all, p.id, WIN, NOW);
          if ('missing' in raw) continue;
          const pr = raw;
          for (const m of await marks(React.createElement(MonthlyCard, { d: pr }))) {
            if (m.value === 0) ok(!m.pick?.act, `${p.name} · ${m.label} · an empty mark must not act`);
          }
        }
      },
    },
  ],
};

export default suite;
