import * as React from 'react';
import * as I from '@/lib/queries/insights';
import * as W from '@/lib/domain/window';
import { ok, type Suite } from '../run';
import { NOW, all, picked, marks, reconcile } from './reconcile';
import type { Viewer } from '@/lib/auth/session';

import { Sources } from '@/components/insights/sources';
import { Departments } from '@/components/insights/departments';
import { Turnaround } from '@/components/insights/turnaround';
import { Scorecard } from '@/components/insights/scorecard';
import { Recruiters } from '@/components/insights/recruiters';
import { Market } from '@/components/insights/market';
import { Quality } from '@/components/insights/quality';
import { Interviewers } from '@/components/insights/interviewers';
import { Offers, Budget } from '@/components/insights/offers-budget';

/* Insights, tab by tab.

   Every tab is built from one context — one period, one department scope — so
   a drill-down that disagrees with a chart here disagrees with the whole page.
   The period is read by the clock on a preset and by the day on a calendar
   range, and `drillScope` is what carries that distinction across. */

const WIN = W.preset(90);

/* The viewer travels with the context. Two of these tabs read interviews
   through a query of their own, and handing it a different account from the one
   the context was built for would compare two different people's data. */
type Make = (c: I.InsightsContext, v: Viewer) => Promise<React.ReactElement>;

const TABS: Array<[string, Make]> = [
  ['Sources', async (c) => React.createElement(Sources, { d: I.sources(c) })],
  ['Departments', async (c) => React.createElement(Departments, { d: I.departments(c) })],
  ['Turnaround', async (c, v) => React.createElement(Turnaround, { d: await I.turnaround(c, v) })],
  ['Scorecard', async (c, v) => React.createElement(Scorecard, { d: await I.scorecard(c, v) })],
  ['Recruiters', async (c, v) => React.createElement(Recruiters, {
    rows: await I.recruiters(c, v), sortKey: 'hires', sortDir: -1, scope: I.drillScope(c),
  })],
];

/* These three measure things the product keeps no list of: what a hire was
   earning before they joined, which sector they came from, how a probation
   review went, how an interview scored out of a hundred. There is no honest
   destination for a mark on any of them, so they explain themselves and stay
   out of the tab order — which is a decision worth holding to, not an
   oversight to be fixed later by inventing a page. */
const EXPLAINING: Array<[string, Make]> = [
  ['Hires & pay', async (c) => React.createElement(Market, { d: I.market(c) })],
  ['Quality of hire', async (c) => React.createElement(Quality, { d: I.quality(c) })],
  ['Interviewers', async (c, v) =>
    React.createElement(Interviewers, { d: await I.interviewerReport(c, v) })],
  ['Offers', async (c) => React.createElement(Offers, { d: I.offers(c), now: NOW })],
  ['Budget', async (c) => React.createElement(Budget, { d: I.budget(c) })],
];

const suite: Suite = {
  name: 'charts · insights reconciles with what it drills into',
  tests: [
    ...TABS.map(([name, make]) => ({
      name: `${name} — every mark finds exactly what it counted`,
      async fn() {
        const c = await I.context(all, WIN, '', NOW);
        const n = await reconcile(all, name, await make(c, all));
        ok(n > 0, `${name} drew no acting mark`);
      },
    })),

    ...EXPLAINING.map(([name, make]) => ({
      name: `${name} — explains every mark and claims no destination`,
      async fn() {
        const c = await I.context(all, WIN, '', NOW);
        const ms = await marks(await make(c, all));
        ok(ms.length > 0, `${name} drew no marks at all`);
        for (const m of ms) {
          ok(!m.pick?.act, `${name} · ${m.label} · must not claim a destination`);
        }
      },
    })),

    {
      name: 'narrowing to one department narrows every drill-down with it',
      async fn() {
        const base = await I.context(all, WIN, '', NOW);
        const dept = I.departments(base).rows.find((r) => r.live > 0);
        ok(!!dept, 'no department has a live pipeline to narrow to');
        const c = await I.context(all, WIN, dept!.id, NOW);
        for (const [name, make] of TABS) {
          await reconcile(all, `${name} · ${dept!.name}`, await make(c, all));
        }
      },
    },

    {
      name: 'a scoped account sees only its own records behind a mark',
      async fn() {
        const c = await I.context(picked, WIN, '', NOW);
        for (const [name, make] of TABS) await reconcile(picked, name, await make(c, picked));
      },
    },

    {
      name: 'an empty mark does not pretend to be clickable',
      async fn() {
        const c = await I.context(all, WIN, '', NOW);
        for (const [name, make] of TABS) {
          for (const m of await marks(await make(c, all))) {
            if (m.value === 0 && m.pick?.n == null) {
              ok(!m.pick?.act, `${name} · ${m.label} · an empty mark must not act`);
            }
          }
        }
      },
    },
  ],
};

export default suite;
