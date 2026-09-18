import { sql, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import { jobScopeSql, canSeeJob, capabilities } from '@/lib/authz';
import { portal } from '@/lib/queries/portal';
import { listJobs } from '@/lib/queries/jobs';
import { listCandidates } from '@/lib/queries/candidates';
import { search } from '@/lib/queries/search';
import { jobs } from '@/db/schema';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   My Hiring, end to end — and the rule underneath it.

   A hiring manager signs in to one page. What they see on it is the whole of
   their access to the product, and the same predicate that draws it is the one
   that refuses them everywhere else: `jobScopeSql` in lib/authz.ts, applied in
   SQL at the root every query reads from.

   This suite takes one real hiring manager out of the dataset and walks their
   day — the requisitions they own, the candidates on them, the interview they
   are sitting on, the scorecard they owe, the offer they approve — and then
   tries, at each step, to reach a requisition that is not theirs. Nothing here
   depends on which buttons the interface drew.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});

/** A hiring manager who is actually named on something, from the data. */
async function aManager() {
  const [row] = rowsOf(await db().execute(sql`
    SELECT h.name, h.email, count(DISTINCT j.id)::int AS jobs
      FROM job_hiring_managers h
      JOIN jobs j ON j.id = h.job_id
     WHERE j.status = 'open'
     GROUP BY h.name, h.email
     HAVING count(DISTINCT j.id) BETWEEN 1 AND 4
     ORDER BY count(DISTINCT j.id) DESC, h.name
     LIMIT 1`)) as Array<{ name: string; email: string | null; jobs: number }>;
  return row;
}

let manager: { name: string; email: string | null; jobs: number } | null = null;
let hm: ReturnType<typeof viewer> | null = null;

async function who() {
  if (!manager) {
    manager = await aManager();
    hm = viewer({
      name: manager.name,
      email: manager.email ?? `${manager.name.toLowerCase().replace(/[^a-z]+/g, '.')}@bayut.sa`,
      role: 'hiring_manager', staffRole: null, roleLabel: 'Hiring manager',
      isPortal: true, staffId: null,
      scope: { kind: 'own', jobIds: [], own: true },
    });
  }
  return { manager: manager!, hm: hm! };
}

/** The requisitions this viewer may see, straight from the predicate. */
async function visibleJobs(v: ReturnType<typeof viewer>) {
  return (rowsOf(await db().execute(sql`
    SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)} ORDER BY id`)) as Array<{ id: string }>)
    .map((r) => r.id);
}

const suite: Suite = {
  name: 'write · My Hiring, and the scope underneath it',
  tests: [
    {
      name: 'a hiring manager sees the requisitions they are named on, and no others',
      async fn() {
        const { manager, hm } = await who();
        const mine = await visibleJobs(hm);
        ok(mine.length >= 1, `${manager.name} is named on ${mine.length} requisitions`);

        const all = (rowsOf(await db().execute(sql`SELECT id FROM ${jobs}`)) as Array<{ id: string }>)
          .map((r) => r.id);
        ok(mine.length < all.length, 'which is fewer than all of them');

        /* Every one of them is theirs for a reason the product can state. */
        const reasons = rowsOf(await db().execute(sql`
          SELECT j.id,
                 EXISTS (SELECT 1 FROM job_hiring_managers h
                          WHERE h.job_id = j.id AND lower(h.name) = lower(${manager.name})) AS named,
                 EXISTS (SELECT 1 FROM interviews i
                          JOIN interview_panel p ON p.interview_id = i.id
                         WHERE i.job_id = j.id AND i.status <> 'cancelled'
                           AND lower(p.name) = lower(${manager.name})) AS on_panel
            FROM ${jobs} j
           WHERE j.id = ANY(${sql`ARRAY[${sql.join(mine.map((id) => sql`${id}`), sql`, `)}]::text[]`})`)) as
          Array<{ id: string; named: boolean; on_panel: boolean }>;
        const unexplained = reasons.filter((r) => !r.named && !r.on_panel);
        equals(unexplained.length, 0, 'nothing is visible for no reason');
      },
    },

    {
      name: 'My Hiring shows those requisitions and nothing from outside them',
      async fn() {
        const { hm } = await who();
        const mine = new Set(await visibleJobs(hm));
        const p = await portal(hm, new Date());

        ok(p.jobs.length >= 1, `${p.jobs.length} requisitions on the page`);
        for (const j of p.jobs) ok(mine.has(j.id), `${j.title} is in scope`);

        /* The interviews on the page carry an application; every one of those
           has to belong to a requisition this account can see. Asking the
           database rather than the row is the point — the row could say
           anything, the join cannot. */
        const ivApps = [...p.ahead, ...p.past, ...p.awaitingScorecard].map((i) => i.applicationId);
        if (ivApps.length) {
          const owners = rowsOf(await db().execute(sql`
            SELECT DISTINCT job_id FROM applications
             WHERE id = ANY(${sql`ARRAY[${sql.join(ivApps.map((x) => sql`${x}`), sql`, `)}]::text[]`})`)) as
            Array<{ job_id: string }>;
          for (const o of owners) {
            ok(mine.has(o.job_id), 'every interview on the page is on a requisition in scope');
          }
        }

        /* The approvals are addressed to this person by name, which is the
           other half of the same question. */
        for (const a of p.approvals) {
          ok(a.kind === 'Requisition' || a.kind === 'Offer', 'an approval is one of the two');
          ok(a.v, 'and points at something');
        }
      },
    },

    {
      name: 'the board, the candidate list and search all apply the same scope',
      async fn() {
        const { hm } = await who();
        const mine = new Set(await visibleJobs(hm));

        const board = await listJobs(hm, {}, new Date());
        for (const j of board.rows) ok(mine.has(j.id), 'the board shows only what is in scope');
        equals(board.totalInScope, mine.size, 'and the total agrees with the predicate');

        const list = await listCandidates(hm, { tab: 'pipeline' }, new Date());
        for (const c of list.rows) {
          if (!c.jobId) continue;
          ok(mine.has(c.jobId), 'the candidate list shows only candidates on requisitions in scope');
        }

        /* Search is the easiest place to leak: it reads several tables at once
           and a missing predicate on any one of them shows a name nobody should
           see. */
        const found = await search(hm, 'al', 40);
        for (const r of found.filter((x) => x.type === 'job')) {
          ok(mine.has(r.id), 'search finds only requisitions in scope');
        }
      },
    },

    {
      name: 'a count on the page is the same number as the rows behind it',
      async fn() {
        const { hm } = await who();
        const p = await portal(hm, new Date());
        /* A count computed over everything and filtered afterwards is a count
           that leaks. These are the ones a hiring manager reads first. */
        const live = p.jobs.filter((j) => j.status === 'open');
        equals(p.live.length, live.length, 'the live count matches the live rows');
        ok(p.startingSoon >= 0, 'the joiners figure is a real count');
        ok(p.onboarding >= 0, 'and so is the onboarding one');
      },
    },

    {
      name: 'a requisition outside the scope cannot be reached by knowing its id',
      async fn() {
        const { hm } = await who();
        const mine = new Set(await visibleJobs(hm));
        const [outside] = (rowsOf(await db().execute(sql`
          SELECT id FROM ${jobs} WHERE status = 'open' ORDER BY id`)) as Array<{ id: string }>)
          .filter((r) => !mine.has(r.id));
        ok(outside, 'the dataset has a requisition they are not on');

        equals(await canSeeJob(hm, outside.id), false, 'the read is refused');
        equals(await canSeeJob(hm, [...mine][0]), true, 'and their own is not');

        await inRollback(async (tx) => {
          /* The refusal a portal account gets says what their access *does*
             cover, which is more useful than "forbidden". */
          refused(await runIn(tx, 'job.save', hm, { v: outside.id, fields: { title: 'Mine now' } }),
            'Your access covers', 'and so is the write');
        });
      },
    },

    {
      name: 'an application on somebody else’s requisition is out of reach too',
      async fn() {
        const { hm } = await who();
        const mine = new Set(await visibleJobs(hm));
        const [outside] = (rowsOf(await db().execute(sql`
          SELECT a.id, a.job_id FROM applications a JOIN jobs j ON j.id = a.job_id
           WHERE a.status = 'active' ORDER BY a.id`)) as Array<{ id: string; job_id: string }>)
          .filter((r) => !mine.has(r.job_id));
        ok(outside, 'the dataset has one');

        await inRollback(async (tx) => {
          refused(await runIn(tx, 'rev.save', hm, {
            v: outside.id, fields: { rev_rating: 'up', rev_text: 'Not mine to say' },
          }), 'outside your access');
        });
      },
    },

    {
      name: 'the work a hiring manager actually does, they can do',
      async fn() {
        const { hm } = await who();
        const mine = await visibleJobs(hm);
        const caps = capabilities(hm);
        ok(caps.has('scorecard.write'), 'they write scorecards');
        ok(caps.has('review.write'), 'and quick reviews');
        ok(caps.has('approval.act'), 'and act on approvals');
        ok(!caps.has('candidate.create'), 'and do not add candidates');
        ok(!caps.has('offer.send'), 'or send offers');

        const [app] = rowsOf(await db().execute(sql`
          SELECT id FROM applications
           WHERE status = 'active' AND job_id = ANY(${sql`ARRAY[${
             sql.join(mine.map((id) => sql`${id}`), sql`, `)}]::text[]`})
           LIMIT 1`)) as Array<{ id: string }>;
        ok(app, 'there is somebody in one of their pipelines');

        await inRollback(async (tx) => {
          succeeded(await runIn(tx, 'rev.save', hm, {
            v: app.id, fields: { rev_rating: 'up', rev_text: 'Good conversation, would hire' },
          }), 'they can review a candidate on their own requisition');

          succeeded(await runIn(tx, 'cmt.post', hm, {
            v: app.id, fields: { comment: 'Spoke to the team about this one.' },
          }), 'and leave a note');
        });
      },
    },

    {
      name: 'a participant sees only what they have been asked to do',
      async fn() {
        const [panellist] = rowsOf(await db().execute(sql`
          SELECT p.name, count(*)::int AS n
            FROM interview_panel p JOIN interviews i ON i.id = p.interview_id
           WHERE i.status <> 'cancelled' AND NOT p.is_hiring_manager
           GROUP BY p.name ORDER BY count(*) DESC LIMIT 1`)) as Array<{ name: string; n: number }>;
        ok(panellist, 'the dataset has somebody who only sits on panels');

        const part = viewer({
          name: panellist.name, role: 'participant', staffRole: null,
          roleLabel: 'Participant', isPortal: true, staffId: null,
          scope: { kind: 'own', jobIds: [], own: true },
        });

        const caps = capabilities(part);
        ok(caps.has('scorecard.write'), 'they file the scorecard they were asked for');
        ok(!caps.has('application.move'), 'and move nobody');
        ok(!caps.has('candidate.view') || !caps.has('candidate.export'),
          'and do not take the database home');

        const seen = await visibleJobs(part);
        const all = (rowsOf(await db().execute(sql`SELECT id FROM ${jobs}`)) as Array<{ id: string }>).length;
        ok(seen.length < all, `${seen.length} of ${all} requisitions, not all of them`);
      },
    },

    {
      name: 'a picked list is exactly the list, unless their own is added to it',
      async fn() {
        const some = (rowsOf(await db().execute(sql`
          SELECT id FROM ${jobs} WHERE status = 'open' ORDER BY id LIMIT 3`)) as Array<{ id: string }>)
          .map((r) => r.id);

        const picked = viewer({
          name: 'Nobody In Particular', role: 'hiring_manager', staffRole: null,
          roleLabel: 'Hiring manager', isPortal: true, staffId: null,
          scope: { kind: 'jobs', jobIds: some, own: false },
        });
        equals((await visibleJobs(picked)).sort().join(','), [...some].sort().join(','),
          'exactly the three that were picked');

        const { manager } = await who();
        const pickedPlusOwn = viewer({
          name: manager.name,
          email: manager.email ?? undefined,
          role: 'hiring_manager', staffRole: null, roleLabel: 'Hiring manager',
          isPortal: true, staffId: null,
          scope: { kind: 'jobs', jobIds: some, own: true },
        });
        const both = await visibleJobs(pickedPlusOwn);
        for (const id of some) ok(both.includes(id), 'the picked ones are there');
        const own = await visibleJobs(viewer({
          name: manager.name,
          email: manager.email ?? undefined,
          role: 'hiring_manager', staffRole: null, roleLabel: 'Hiring manager',
          isPortal: true, staffId: null,
          scope: { kind: 'own', jobIds: [], own: true },
        }));
        for (const id of own) ok(both.includes(id), 'and so are their own');
      },
    },

    {
      name: 'an empty picked list shows nothing, rather than everything',
      async fn() {
        const nobody = viewer({
          name: 'Nobody At All', role: 'hiring_manager', staffRole: null,
          roleLabel: 'Hiring manager', isPortal: true, staffId: null,
          scope: { kind: 'jobs', jobIds: [], own: false },
        });
        equals((await visibleJobs(nobody)).length, 0,
          'a scope that names nothing grants nothing — the failure mode that matters');

        const p = await portal(nobody, new Date());
        equals(p.jobs.length, 0, 'and My Hiring is empty rather than full');
      },
    },
  ],
};

export default suite;
