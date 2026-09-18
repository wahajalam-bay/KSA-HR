import * as React from 'react';
import { load, interviewerPanel } from '@/lib/queries/scheduling';
import * as W from '@/lib/domain/window';
import { ok, type Suite } from '../run';
import { NOW, all, picked, marks, reconcile } from './reconcile';

import { LoadTab } from '@/components/scheduling/load';
import { InterviewersTab } from '@/components/scheduling/interviewers';

/* Scheduling. The Load tab counts interviews by the clock rather than by the
   calendar — held is "the last thirty days up to this moment", a week bar is
   "(start, end]" — so its drill-downs carry instants and the boundaries have to
   be the same ones. A day-wide filter here would be off by whatever happened
   earlier today, quietly, and only sometimes. */

const suite: Suite = {
  name: 'charts · scheduling reconciles with what it drills into',
  tests: [
    {
      name: 'every mark on the Load tab finds exactly the interviews it counted',
      async fn() {
        const data = await load(all, NOW);
        const n = await reconcile(all, 'Load',
          React.createElement(LoadTab, { data, now: NOW }));
        ok(n > 0, 'the Load tab drew no acting mark');
      },
    },

    {
      name: 'the same holds for a recruiter on a picked list',
      async fn() {
        const data = await load(picked, NOW);
        await reconcile(picked, 'Load', React.createElement(LoadTab, { data, now: NOW }));
      },
    },

    {
      name: 'an empty week does not pretend to be clickable',
      async fn() {
        const data = await load(all, NOW);
        for (const m of await marks(React.createElement(LoadTab, { data, now: NOW }))) {
          if (m.value === 0) ok(!m.pick?.act, `Load · ${m.label} · an empty mark must not act`);
        }
      },
    },

    {
      name: 'the review score bands explain themselves and lead nowhere',
      async fn() {
        /* There is no page of "interviews that scored 65 to 79". A mark that
           cannot land anywhere honest says what it is and stays out of the tab
           order, rather than inventing a destination. */
        const w = W.preset(90);
        const data = await interviewerPanel(all, w, NOW);
        const node = React.createElement(InterviewersTab, { data, w, sel: '', now: NOW });
        const ms = await marks(node);
        ok(ms.length > 0, 'the interviewers tab drew no marks at all');
        for (const m of ms) {
          ok(!m.pick?.act, `Interviewers · ${m.label} · must not claim a destination`);
          ok(!!m.pick?.tip, `Interviewers · ${m.label} · still explains itself`);
        }
      },
    },
  ],
};

export default suite;
