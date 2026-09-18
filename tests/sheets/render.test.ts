import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import { SHEET_ACTIONS } from '@/lib/nav';
import { viewer } from '../commands/harness';
import { draw, sheetNames } from './harness';
import { valueFor, realIds, MAY_BE_EMPTY } from './fixtures';
import { ok, eq as equals, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Every panel in the product, drawn.

   A sheet is where a query that has drifted from the schema hides: it is not on
   a page, so a page render does not touch it, and it is not a command, so the
   write suites do not either. This suite opens all of them, as three different
   people, and awaits every async component inside — which is the only way the
   queries in the department picker, the workflow block and the joiner form ever
   run outside a browser.

   It asserts three things: that every action the interface can fire as a sheet
   has one, that every sheet draws without throwing, and that a handful of them
   say what they are supposed to say.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const onboarding = viewer({
  name: 'Hatoon Al-Faraj', staffRole: 'onboarding', staffId: 'stf_07', roleLabel: 'Onboarding',
});


const suite: Suite = {
  name: 'sheets · every panel draws',
  tests: [
    {
      name: 'every action the interface fires as a sheet has one',
      async fn() {
        const have = new Set(sheetNames());
        const missing = [...SHEET_ACTIONS]
          /* `drawer.open:tab` is the same sheet with a tab on the value. */
          .map((a) => a.split(':')[0])
          .filter((a) => !have.has(a));
        equals(missing.join(', '), '', 'nothing in SHEET_ACTIONS is unimplemented');
      },
    },

    {
      name: 'every sheet draws for an Admin',
      async fn() {
        const broken: string[] = [];
        for (const name of sheetNames()) {
          const v = await valueFor(name);
          try {
            const { spec } = await draw(name, v, admin);
            if (!spec && !MAY_BE_EMPTY.has(name) && v) broken.push(`${name} (drew nothing)`);
          } catch (e) {
            broken.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        equals(broken.join('\n'), '', 'no sheet threw');
      },
    },

    {
      name: 'every sheet draws for a recruiter and for Onboarding',
      async fn() {
        const broken: string[] = [];
        for (const who of [recruiter, onboarding]) {
          for (const name of sheetNames()) {
            const v = await valueFor(name);
            try {
              await draw(name, v, who);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              /* A refusal is a correct outcome — a recruiter opening an Admin
                 panel should be told no, not shown it. */
              if (/not allowed|cannot|permission|Forbidden|scope/i.test(msg)) continue;
              broken.push(`${who.name} · ${name}: ${msg}`);
            }
          }
        }
        equals(broken.join('\n'), '', 'no sheet threw for a non-Admin');
      },
    },

    {
      name: 'the requisition editor reads the requisition it was opened on',
      async fn() {
        const i = await realIds();
        const [job] = rowsOf(await db().execute(sql`
          SELECT title FROM jobs WHERE id = ${i.job}`)) as Array<{ title: string }>;
        const { spec, drawn } = await draw('job.edit', i.job, admin);
        ok(spec, 'it drew');
        includes(drawn.text, job.title, 'the title is on the form');
        includes(drawn.text, 'The role', 'and the jump bar');
        includes(drawn.text, 'Interview workflow');
        includes(drawn.text, 'Skills this position needs');
        ok(drawn.nodes > 100, `a real form, not a stub (${drawn.nodes} nodes)`);
      },
    },

    {
      name: 'the new-requisition sheet offers the pipelines and the departments',
      async fn() {
        const { spec, drawn } = await draw('job.new', '', admin);
        ok(spec, 'it drew');
        includes(drawn.text, 'Select a department…', 'the department picker is filled');
        includes(drawn.text, 'Submit for approval');
        includes(drawn.text, 'Applied →', 'and the loop preview is built');
      },
    },

    {
      name: 'a panel an account may not reach refuses rather than drawing',
      async fn() {
        const i = await realIds();
        const outsider = viewer({
          name: 'Somebody Else', role: 'hiring_manager', staffRole: null,
          roleLabel: 'Hiring manager', isPortal: true,
          scope: { kind: 'jobs', jobIds: ['job_does_not_exist'], own: false },
        });
        let refused = false;
        try {
          await draw('job.edit', i.job, outsider);
        } catch {
          refused = true;
        }
        ok(refused, 'the editor is refused outside the scope');
      },
    },

    {
      name: 'the phone screen says so when no telephony provider is configured',
      async fn() {
        const i = await realIds();
        const { drawn } = await draw('scr.call', i.screenApp || i.application, admin);
        const configured = !/No telephony provider is configured/.test(drawn.text);
        if (configured) {
          includes(drawn.text, 'Set up the call', 'with a provider it offers the call');
        } else {
          includes(drawn.text, 'Nothing can place this call',
            'without one it refuses rather than scheduling');
          includes(drawn.text, 'chat screen instead', 'and offers what does work');
        }
      },
    },

    {
      name: 'the offer editor refuses to open on a letter that has gone out',
      async fn() {
        const [sent] = rowsOf(await db().execute(sql`
          SELECT id FROM offers
           WHERE state IN ('sent','viewed','signed','accepted','declined','expired')
           LIMIT 1`)) as Array<{ id: string }>;
        if (!sent) return;                       // nothing sent in this dataset
        const { drawn } = await draw('offer.edit', String(sent.id), onboarding);
        includes(drawn.text, 'That letter has gone out');
        includes(drawn.text, 'Make version');
      },
    },

    {
      name: 'the scope sheet lists the requisitions and the four scopes',
      async fn() {
        const i = await realIds();
        if (!i.account) return;
        const { drawn } = await draw('acc.scope', i.account, admin);
        includes(drawn.text, 'Every requisition');
        includes(drawn.text, 'The requisitions they are the hiring manager on');
        includes(drawn.text, 'Only the requisitions picked below');
        includes(drawn.text, 'the ones picked below, and their own');
        includes(drawn.text, 'applied to every query and every command on the server');
      },
    },

    {
      name: 'the plan refuses to add a seat without a requisition',
      async fn() {
        const i = await realIds();
        const { drawn } = await draw('pos.new', i.dept, admin);
        includes(drawn.text, 'A new seat starts with a requisition');
        includes(drawn.text, 'Nothing is added to the plan directly');
        includes(drawn.text, 'Raise the requisition');
      },
    },
  ],
};

export default suite;
