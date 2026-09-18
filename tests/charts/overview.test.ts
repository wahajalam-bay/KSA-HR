import * as React from 'react';
import { overview } from '@/lib/queries/overview';
import { drawTree } from '../sheets/harness';
import { ok, type Suite } from '../run';
import { NOW, WINDOW, all, picked, marks, reconcile } from './reconcile';

import { Hero, PipelineDonut } from '@/components/overview/hero';
import { TeamComposition, SourcesDonut } from '@/components/overview/board';
import { FunnelCard, PipelineNow, PlanCard, DeptsCard } from '@/components/overview/panels';

/* The Overview, mark by mark. What reconciliation means, and why it is worth
   the trouble, is written down in ./reconcile.ts. */

/* ═════════════════════════════════════════════════════════════════════════════ */

const CARDS: Array<[string, (d: any) => React.ReactElement]> = [
  ['Candidate pipeline', (d) => React.createElement(PipelineDonut, { data: d })],
  ['Team composition', (d) => React.createElement(TeamComposition, { data: d, canOpen: true })],
  ['Sourcing channels', (d) => React.createElement(SourcesDonut, { data: d })],
  ['The funnel', (d) => React.createElement(FunnelCard, { data: d })],
  ['Where the pipeline sits now', (d) => React.createElement(PipelineNow, { data: d })],
  ['Hiring against plan', (d) => React.createElement(PlanCard, { data: d })],
  ['Where the demand sits', (d) => React.createElement(DeptsCard, { data: d })],
];

const suite: Suite = {
  name: 'charts · the Overview reconciles with what it drills into',
  tests: [
    ...CARDS.map(([name, make]) => ({
      name: `${name} — every mark finds exactly what it counted`,
      async fn() {
        const data = await overview(all, WINDOW, NOW);
        const n = await reconcile(all, name, make(data));
        ok(n > 0, `${name} drew no acting mark — the card has lost its drill-down`);
      },
    })),

    {
      name: 'a recruiter on a picked list drills into their own requisitions only',
      async fn() {
        /* Two readings of the same thing under a scope that is not everything:
           the chart's own aggregate, and the list the drill lands on. If the
           drill went round the scope, the list would be the larger of the two,
           which is precisely the leak worth catching. */
        const data = await overview(picked, WINDOW, NOW);
        let checked = 0;
        for (const [name, make] of CARDS) checked += await reconcile(picked, name, make(data));
        ok(checked > 0, 'a scoped account saw no chart at all');
      },
    },

    {
      name: 'a mark that counts nothing does not pretend to be clickable',
      async fn() {
        const data = await overview(all, WINDOW, NOW);
        for (const [name, make] of CARDS) {
          for (const m of await marks(make(data))) {
            if (m.value === 0) {
              ok(!m.pick?.act, `${name} · ${m.label} · an empty mark must not act`);
            }
          }
        }
      },
    },

    {
      name: 'every acting mark says what picking it will do',
      async fn() {
        const data = await overview(all, WINDOW, NOW);
        for (const [name, make] of CARDS) {
          for (const m of await marks(make(data))) {
            if (!m.pick?.act) continue;
            ok(!!m.pick.tip, `${name} · ${m.label} · has a tooltip`);
            ok(!!m.pick.tip?.action, `${name} · ${m.label} · the tooltip says where it goes`);
          }
        }
      },
    },

    {
      name: 'the hero draws without a drill, and does not invent one',
      async fn() {
        const data = await overview(all, WINDOW, NOW);
        const { elements } = await drawTree(React.createElement(Hero, { data }));
        ok(elements.some((n) => n.tag === 'Line'), 'the hero still draws its line');
      },
    },
  ],
};

export default suite;
