import { sql, eq, and } from 'drizzle-orm';
import { staff, jobs, applications, tasks, accounts, auditEvents } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';
import { owned } from '@/lib/services/team';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 8 — the TA team.

   Adding somebody is the easy half. The suite is mostly about the other one:
   that nobody leaves a desk without an owner, that a deletion moves the live
   work and leaves the closed work alone, and that history is never rewritten.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const coordinator = viewer({
  name: 'Taif Alshaikhi', staffRole: 'coordinator', staffId: 'stf_05', roleLabel: 'Coordinator',
});

const person = (over: Record<string, string> = {}) => ({
  name: 'Noura Al-Subaie Test',
  role: 'recruiter',
  title: 'Talent Partner',
  monthlyTarget: '8',
  locationId: 'loc_ruh',
  ...over,
});

const idOf = (r: unknown) => String((r as { data?: Record<string, unknown> }).data?.staffId);

/** Somebody with a desk worth handing over. */
async function busy(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT s.id, s.name,
           (SELECT count(*)::int FROM jobs j
             WHERE j.recruiter_id = s.id AND j.status <> 'closed' AND j.archived_at IS NULL) reqs
      FROM staff s
     WHERE s.status = 'active' AND s.role = 'recruiter' AND s.id <> 'stf_01'
     ORDER BY reqs DESC, s.id LIMIT 1`));
  return row as { id: string; name: string; reqs: number };
}

const suite: Suite = {
  name: 'write · the TA team',
  tests: [
    {
      name: 'a new recruiter gets a title, an address and their tint',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'staff.create', admin, { fields: person() });
          succeeded(r, 'staff.create');
          const id = idOf(r);

          const [p] = await tx.select().from(staff).where(eq(staff.id, id));
          equals(p.name, 'Noura Al-Subaie Test');
          equals(p.role, 'recruiter');
          equals(p.roleLabel, 'Recruiter');
          equals(p.title, 'Talent Partner');
          equals(p.email, 'noura.alsubaie.test@bayut.sa', 'on the company convention');
          equals(p.monthlyTarget, 8);
          equals(p.status, 'active');
          ok(p.hue >= 1 && p.hue <= 5, 'with a tint');
          ok(p.joinedOn, 'and the day they joined');
          equals(p.seniority, 'Mid');
        });
      },
    },

    {
      name: 'only the roles that own requisitions carry a target',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'staff.create', admin, {
            fields: person({ role: 'coordinator', title: 'Interview Coordinator', monthlyTarget: '9' }),
          });
          succeeded(r);
          const [p] = await tx.select().from(staff).where(eq(staff.id, idOf(r)));
          equals(p.monthlyTarget, 0, 'a coordinator is measured on something else');

          refused(await runIn(tx, 'staff.target', admin, {
            v: p.id, fields: { monthlyTarget: '5' },
          }), 'does not carry a hiring target');
        });
      },
    },

    {
      name: 'the sixth role the form offers is a role the database accepts',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'staff.create', admin, {
            fields: person({ role: 'analyst', title: 'Talent Analyst' }),
          });
          succeeded(r, 'an analyst can be hired');
          const [p] = await tx.select().from(staff).where(eq(staff.id, idOf(r)));
          equals(p.role, 'analyst');
        });
      },
    },

    {
      name: 'two people cannot share an address',
      async fn() {
        await inRollback(async (tx) => {
          const [existing] = await tx.select().from(staff)
            .where(eq(staff.id, 'stf_02'));
          refused(await runIn(tx, 'staff.create', admin, {
            fields: person({ email: existing.email }),
          }), 'already somebody');
        });
      },
    },

    {
      name: 'a title with Senior in it is recorded as senior',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'staff.create', admin, {
            fields: person({ title: 'Senior Talent Partner' }),
          });
          succeeded(r);
          const [p] = await tx.select().from(staff).where(eq(staff.id, idOf(r)));
          equals(p.seniority, 'Senior');
        });
      },
    },

    {
      name: 'deactivating keeps the desk and closes the way in',
      async fn() {
        await inRollback(async (tx) => {
          const b = await busy(tx);
          const before = await owned(b.id, tx);

          const asked = await runIn(tx, 'staff.deactivate', admin, { v: b.id });
          ok((asked as { confirm?: unknown }).confirm, 'it asks first');

          const r = await runIn(tx, 'staff.deactivate', admin, {
            v: b.id, fields: { confirmed: '1' },
          });
          succeeded(r, 'staff.deactivate');

          const [p] = await tx.select().from(staff).where(eq(staff.id, b.id));
          equals(p.status, 'inactive');
          const after = await owned(b.id, tx);
          equals(after.requisitions.length, before.requisitions.length,
            'their requisitions stay theirs');

          const accts = await tx.select().from(accounts).where(eq(accounts.staffId, b.id));
          ok(accts.every((a) => a.status === 'disabled'), 'and they cannot sign in');

          refused(await runIn(tx, 'staff.deactivate', admin, {
            v: b.id, fields: { confirmed: '1' },
          }), 'already inactive');
          succeeded(await runIn(tx, 'staff.reactivate', admin, { v: b.id }));
          const [back] = await tx.select().from(staff).where(eq(staff.id, b.id));
          equals(back.status, 'active');
        });
      },
    },

    {
      name: 'nobody deactivates themselves',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'staff.deactivate', admin, {
            v: 'stf_01', fields: { confirmed: '1' },
          }), 'your own profile');
        });
      },
    },

    {
      name: 'deleting a busy desk without an heir is refused',
      async fn() {
        await inRollback(async (tx) => {
          const b = await busy(tx);
          const what = await owned(b.id, tx);
          ok(what.requisitions.length + what.live + what.tasks > 0, 'they are holding something');
          refused(await runIn(tx, 'staff.deleteConfirm', admin, { v: b.id }),
            'Choose who inherits');
        });
      },
    },

    {
      name: 'deleting hands the live work over and leaves the closed work alone',
      async fn() {
        await inRollback(async (tx) => {
          const b = await busy(tx);
          const [heir] = rowsOf(await tx.execute(sql`
            SELECT id FROM staff WHERE status = 'active' AND role IN ('recruiter','tal_lead')
               AND id <> ${b.id} ORDER BY id LIMIT 1`)) as Array<{ id: string }>;

          const closedBefore = rowsOf(await tx.execute(sql`
            SELECT id FROM applications
             WHERE recruiter_id = ${b.id} AND status NOT IN ('active','on_hold')`))
            .map((x) => x.id as string);
          const liveBefore = rowsOf(await tx.execute(sql`
            SELECT id FROM applications
             WHERE recruiter_id = ${b.id} AND status IN ('active','on_hold')`))
            .map((x) => x.id as string);

          const r = await runIn(tx, 'staff.deleteConfirm', admin, {
            v: b.id, fields: { heir: heir.id },
          });
          succeeded(r, 'staff.deleteConfirm');

          const [p] = await tx.select().from(staff).where(eq(staff.id, b.id));
          equals(p.status, 'deleted', 'the profile is marked, not removed');
          ok(p.deletedAt, 'with when');
          equals(p.handedOverTo, heir.id, 'and who took the desk');

          const stillOpen = await tx.select().from(jobs)
            .where(and(eq(jobs.recruiterId, b.id), sql`${jobs.status} <> 'closed'`));
          equals(stillOpen.length, 0, 'no open requisition is left with them');

          if (liveBefore.length) {
            const moved = rowsOf(await tx.execute(sql`
              SELECT count(*)::int AS n FROM applications
               WHERE id IN (${sql.join(liveBefore.map((i) => sql`${i}`), sql`, `)})
                 AND recruiter_id = ${heir.id}`))[0] as { n: number };
            equals(Number(moved.n), liveBefore.length, 'every live application moved');
          }
          if (closedBefore.length) {
            const kept = rowsOf(await tx.execute(sql`
              SELECT count(*)::int AS n FROM applications
               WHERE id IN (${sql.join(closedBefore.map((i) => sql`${i}`), sql`, `)})
                 AND recruiter_id = ${b.id}`))[0] as { n: number };
            equals(Number(kept.n), closedBefore.length,
              'and every closed one keeps the name of whoever worked it');
          }

          const openTasks = await tx.select().from(tasks)
            .where(and(eq(tasks.assigneeId, b.id), eq(tasks.done, false)));
          equals(openTasks.length, 0, 'their open tasks moved too');

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, b.id));
          includes(trail.map((t) => t.summary).join(' | '), 'handed their desk to');
        });
      },
    },

    {
      name: 'only an Admin deletes, and never themselves',
      async fn() {
        await inRollback(async (tx) => {
          const b = await busy(tx);
          refused(await runIn(tx, 'staff.deleteConfirm', recruiter, { v: b.id }), 'does not include');
          refused(await runIn(tx, 'staff.deleteConfirm', admin, { v: 'stf_01' }), 'your own profile');

          /* A coordinator holds team.view but not team.manage. */
          refused(await runIn(tx, 'staff.create', coordinator, { fields: person() }), 'does not include');
        });
      },
    },

    {
      name: 'a restored profile comes back without taking the desk back',
      async fn() {
        await inRollback(async (tx) => {
          const b = await busy(tx);
          const [heir] = rowsOf(await tx.execute(sql`
            SELECT id FROM staff WHERE status = 'active' AND role IN ('recruiter','tal_lead')
               AND id <> ${b.id} ORDER BY id LIMIT 1`)) as Array<{ id: string }>;
          succeeded(await runIn(tx, 'staff.deleteConfirm', admin, {
            v: b.id, fields: { heir: heir.id },
          }));
          succeeded(await runIn(tx, 'staff.restore', admin, { v: b.id }));

          const [p] = await tx.select().from(staff).where(eq(staff.id, b.id));
          equals(p.status, 'active');
          ok(!p.deletedAt, 'and is no longer marked deleted');

          const back = await tx.select().from(jobs)
            .where(and(eq(jobs.recruiterId, b.id), sql`${jobs.status} <> 'closed'`));
          equals(back.length, 0, 'the requisitions stay with whoever inherited them');
        });
      },
    },

    {
      name: 'editing a profile records what changed',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'staff.create', admin, { fields: person() });
          const id = idOf(r);
          succeeded(await runIn(tx, 'staff.save', admin, {
            v: id,
            fields: person({ title: 'Senior Talent Partner', monthlyTarget: '12' }),
          }));

          const [p] = await tx.select().from(staff).where(eq(staff.id, id));
          equals(p.title, 'Senior Talent Partner');
          equals(p.monthlyTarget, 12);
          equals(p.seniority, 'Senior');

          const trail = await tx.select().from(auditEvents)
            .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'update')));
          ok(trail.length >= 1, 'the edit is on the record');
          equals((trail[0].before as Record<string, unknown>).monthlyTarget, 8);
          equals((trail[0].after as Record<string, unknown>).monthlyTarget, 12);
        });
      },
    },
  ],
};

export default suite;
