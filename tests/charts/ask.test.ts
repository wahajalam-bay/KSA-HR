import * as React from 'react';
import { AskPanel } from '@/components/insights/ask';
import { ok, type Suite } from '../run';
import { NOW, all, picked, marks } from './reconcile';

/* ─────────────────────────────────────────────────────────────────────────────
   ASK AI DRAWS, IT DOES NOT HAND OUT RECORDS

   Every other chart in the product has a destination written beside the query
   that feeds it, and a suite that holds the two to each other. A report here is
   assembled from whatever was typed — any metric against any dimension — so
   there is no such pair to check. A link built from a guess is a list of
   records nobody authorised.

   So the rule is simple and it is worth a test of its own: a mark on an Ask AI
   report explains itself and leads nowhere. The figures are already inside the
   account's access, because the resolver reads the same scoped dataset every
   other report does; this stops a second, unchecked way in being opened on top
   of it.
   ───────────────────────────────────────────────────────────────────────────*/

const QUESTIONS = [
  'hires by month',
  'applications by source',
  'time to hire by department',
  'offer acceptance by recruiter',
];

const suite: Suite = {
  name: 'charts · Ask AI explains and never links out',
  tests: [
    {
      name: 'no mark on any generated report carries an action',
      async fn() {
        let drawn = 0;
        for (const viewer of [all, picked]) {
          for (const question of QUESTIONS) {
            const node = React.createElement(AskPanel, {
              viewer, question, report: '1', now: NOW,
            });
            for (const m of await marks(node)) {
              ok(!m.pick?.act,
                `"${question}" · ${m.label} · an Ask AI mark must not link to records`);
              drawn += 1;
            }
          }
        }
        ok(drawn > 0, 'no question produced a chart at all');
      },
    },

    {
      name: 'every mark still says what it is worth',
      async fn() {
        const node = React.createElement(AskPanel, {
          viewer: all, question: 'applications by source', report: '1', now: NOW,
        });
        const ms = await marks(node);
        ok(ms.length > 0, 'the question produced no chart');
        for (const m of ms) {
          ok(!!m.pick?.tip, `${m.label} · has a tooltip`);
          ok(!!m.pick?.tip?.rows?.length, `${m.label} · says how many records are behind it`);
        }
      },
    },
  ],
};

export default suite;
