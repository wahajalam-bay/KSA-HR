import { sql, eq, and } from 'drizzle-orm';
import { positions, departments, employees, jobs, auditEvents, domainEvents } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 9 — the manpower plan.

   A seat is the thing a requisition is raised against, so the rules that matter
   are the ones that keep the chart honest: a code means one seat for ever,
   approved heads never fall below the people already in it, a reporting line
   never runs in a circle, and an import says what it could not place.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});

async function aDepartment(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT id, name, code FROM departments ORDER BY sort_order, id LIMIT 1`));
  return row as { id: string; name: string; code: string };
}

/** A seat with nobody in it and no requisition on it. */
async function emptySeat(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT p.id, p.code, p.title, p.dept_id, p.reports_to_id
      FROM positions p
     WHERE p.retired_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM employees e
                        WHERE e.position_code = p.code AND e.status <> 'left')
       AND NOT EXISTS (SELECT 1 FROM jobs j
                        WHERE j.position_code = p.code AND j.status <> 'closed')
     ORDER BY p.id LIMIT 1`));
  return row as {
    id: string; code: string; title: string; dept_id: string; reports_to_id: string | null;
  };
}

const importRows = [
  { title: 'Head of Data', grade: 'D1', approved: 1, holder: 'Layla Al-Otaibi', startDate: '2024-03-01' },
  { title: 'Data Engineer', grade: 'P3', approved: 3, reportsTo: 'Head of Data' },
  { title: 'Analytics Lead', grade: 'M2', approved: 1, reportsTo: 'Head of Data' },
  { title: 'Analyst', grade: 'P2', approved: 2, reportsTo: 'Analytics Lead' },
];

const suite: Suite = {
  name: 'write · the manpower plan',
  tests: [
    {
      name: 'a new seat takes the next code in its department',
      async fn() {
        await inRollback(async (tx) => {
          const d = await aDepartment(tx);
          const r = await runIn(tx, 'pos.save', admin, {
            v: 'new',
            fields: { title: 'Commercial Analyst', deptId: d.id, grade: 'P2', approved: '2' },
          });
          succeeded(r, 'pos.save');
          const code = String((r as { data?: Record<string, unknown> }).data?.code);
          ok(/^[A-Z]{2,4}-\d{3}$/.test(code), `the code reads like a code: ${code}`);

          const [p] = await tx.select().from(positions).where(eq(positions.code, code));
          equals(p.title, 'Commercial Analyst');
          equals(p.approved, 2);
          equals(p.deptId, d.id);
          equals(p.planState, 'approved');
          equals(p.kind, 'leadership', 'a seat with no manager sits at the top');
        });
      },
    },

    {
      name: 'a code belongs to one seat for ever',
      async fn() {
        await inRollback(async (tx) => {
          const d = await aDepartment(tx);
          const seat = await emptySeat(tx);
          refused(await runIn(tx, 'pos.save', admin, {
            v: 'new', fields: { title: 'Another seat', deptId: d.id, code: seat.code },
          }), 'already a seat');
        });
      },
    },

    {
      name: 'approved headcount cannot fall below the people already in the seat',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT p.id, p.code,
                   (SELECT count(*)::int FROM employees e
                     WHERE e.position_code = p.code AND e.status <> 'left') AS held
              FROM positions p
             WHERE p.retired_at IS NULL
             ORDER BY held DESC, p.id LIMIT 1`)) as Array<{ id: string; code: string; held: number }>;
          ok(Number(row.held) > 0, 'the dataset has a seat with people in it');

          refused(await runIn(tx, 'pos.save', admin, {
            v: row.id, fields: { approved: '0' },
          }), 'cannot be fewer');

          succeeded(await runIn(tx, 'pos.save', admin, {
            v: row.id, fields: { approved: String(Number(row.held) + 1) },
          }), 'raising it is fine');
        });
      },
    },

    {
      name: 'a reporting line never runs in a circle',
      async fn() {
        await inRollback(async (tx) => {
          const d = await aDepartment(tx);
          const top = await runIn(tx, 'pos.save', admin, {
            v: 'new', fields: { title: 'Loop Top', deptId: d.id },
          });
          const topId = String((top as { data?: Record<string, unknown> }).data?.positionId);
          const under = await runIn(tx, 'pos.save', admin, {
            v: 'new', fields: { title: 'Loop Under', deptId: d.id, reportsTo: topId },
          });
          const underId = String((under as { data?: Record<string, unknown> }).data?.positionId);

          refused(await runIn(tx, 'pos.save', admin, {
            v: topId, fields: { reportsTo: topId },
          }), 'cannot report to itself');

          refused(await runIn(tx, 'pos.save', admin, {
            v: topId, fields: { reportsTo: underId },
          }), 'runs in a circle');
        });
      },
    },

    {
      name: 'retiring a seat keeps its code and moves what reported to it up a line',
      async fn() {
        await inRollback(async (tx) => {
          const d = await aDepartment(tx);
          const top = await runIn(tx, 'pos.save', admin, {
            v: 'new', fields: { title: 'Retire Top', deptId: d.id },
          });
          const topId = String((top as { data?: Record<string, unknown> }).data?.positionId);
          const mid = await runIn(tx, 'pos.save', admin, {
            v: 'new', fields: { title: 'Retire Mid', deptId: d.id, reportsTo: topId },
          });
          const midId = String((mid as { data?: Record<string, unknown> }).data?.positionId);
          const low = await runIn(tx, 'pos.save', admin, {
            v: 'new', fields: { title: 'Retire Low', deptId: d.id, reportsTo: midId },
          });
          const lowId = String((low as { data?: Record<string, unknown> }).data?.positionId);

          const asked = await runIn(tx, 'pos.remove', admin, { v: midId });
          ok((asked as { confirm?: unknown }).confirm, 'it asks before retiring a seat');

          const r = await runIn(tx, 'pos.remove', admin, {
            v: midId, fields: { confirmed: '1' },
          });
          succeeded(r, 'pos.remove');
          includes(String((r as { toast?: string }).toast), 'moved up a line');

          const [gone] = await tx.select().from(positions).where(eq(positions.id, midId));
          ok(gone, 'the row is kept');
          ok(gone.retiredAt, 'and marked retired');
          equals(gone.planState, 'retired');

          const [moved] = await tx.select().from(positions).where(eq(positions.id, lowId));
          equals(moved.reportsToId, topId, 'and what was under it now reports to its manager');
        });
      },
    },

    {
      name: 'a seat with somebody in it, or a live requisition on it, is not removed',
      async fn() {
        await inRollback(async (tx) => {
          const [held] = rowsOf(await tx.execute(sql`
            SELECT p.id FROM positions p
             WHERE p.retired_at IS NULL
               AND EXISTS (SELECT 1 FROM employees e
                            WHERE e.position_code = p.code AND e.status <> 'left')
             ORDER BY p.id LIMIT 1`)) as Array<{ id: string }>;
          refused(await runIn(tx, 'pos.remove', admin, {
            v: held.id, fields: { confirmed: '1' },
          }), 'cannot be removed');

          const [onReq] = rowsOf(await tx.execute(sql`
            SELECT p.id FROM positions p
             WHERE p.retired_at IS NULL
               AND EXISTS (SELECT 1 FROM jobs j
                            WHERE j.position_code = p.code AND j.status <> 'closed')
               AND NOT EXISTS (SELECT 1 FROM employees e
                                WHERE e.position_code = p.code AND e.status <> 'left')
             ORDER BY p.id LIMIT 1`)) as Array<{ id: string }>;
          if (onReq) {
            refused(await runIn(tx, 'pos.remove', admin, {
              v: onReq.id, fields: { confirmed: '1' },
            }), 'live requisition');
          }
        });
      },
    },

    {
      name: 'only an Admin changes the plan',
      async fn() {
        await inRollback(async (tx) => {
          const d = await aDepartment(tx);
          const seat = await emptySeat(tx);
          refused(await runIn(tx, 'pos.save', recruiter, {
            v: 'new', fields: { title: 'Nope', deptId: d.id },
          }), 'does not include');
          refused(await runIn(tx, 'pos.remove', recruiter, { v: seat.id }), 'does not include');
        });
      },
    },

    {
      name: 'an imported department arrives as a chart, heads first',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'mp.importCreate', admin, {
            fields: {
              deptName: 'Data & Insight Test',
              deptCode: 'DAT',
              head: 'Layla Al-Otaibi',
              headTitle: 'Head of Data',
              file: 'data-team.xlsx',
              rows: JSON.stringify(importRows),
            },
          });
          succeeded(r, 'mp.importCreate');
          includes(String((r as { toast?: string }).toast), '4 seats');
          includes(String((r as { toast?: string }).toast), '1 already filled');

          const [dept] = await tx.select().from(departments)
            .where(sql`lower(${departments.name}) = 'data & insight test'`);
          ok(dept, 'the department was created');
          equals(dept.code, 'DAT');

          const seats = await tx.select().from(positions)
            .where(eq(positions.deptId, dept.id));
          equals(seats.length, 4);

          const head = seats.find((s) => s.title === 'Head of Data')!;
          ok(!head.reportsToId, 'the head sits at the top');
          equals(head.kind, 'leadership');
          equals(head.grade, 'D1');

          const engineer = seats.find((s) => s.title === 'Data Engineer')!;
          equals(engineer.reportsToId, head.id, 'the line resolved from the name in the sheet');
          equals(engineer.approved, 3);

          const lead = seats.find((s) => s.title === 'Analytics Lead')!;
          const analyst = seats.find((s) => s.title === 'Analyst')!;
          equals(analyst.reportsToId, lead.id, 'two levels down resolved too');

          const people = await tx.select().from(employees)
            .where(eq(employees.positionCode, head.code));
          equals(people.length, 1, 'the person already in the seat is on the books');
          equals(people[0].name, 'Layla Al-Otaibi');
          equals(people[0].source, 'imported', 'as an existing employee, not a hire');
          equals(people[0].status, 'active');
          equals(people[0].startDate, '2024-03-01');
          ok(people[0].employeeCode.startsWith('BYT-'), 'with an employee number');

          const events = await tx.select().from(domainEvents)
            .where(and(eq(domainEvents.subjectId, dept.id), eq(domainEvents.type, 'plan.imported')));
          equals(events.length, 1);
        });
      },
    },

    {
      name: 'a row whose manager is not in the sheet is reported, not guessed at',
      async fn() {
        await inRollback(async (tx) => {
          const r = await runIn(tx, 'mp.importCreate', admin, {
            fields: {
              deptName: 'Orphan Test Department',
              rows: JSON.stringify([
                { title: 'Head of Nothing', approved: 1 },
                { title: 'Lost Soul', reportsTo: 'Somebody Who Left', approved: 1 },
              ]),
            },
          });
          succeeded(r, 'mp.importCreate');
          includes(String((r as { toast?: string }).toast), '1 skipped');
          equals((r as { tone?: string }).tone, 'warn');

          const skipped = (r as { data?: { skipped?: Array<{ title: string; why: string }> } })
            .data?.skipped ?? [];
          equals(skipped.length, 1);
          equals(skipped[0].title, 'Lost Soul');
          includes(skipped[0].why, 'Somebody Who Left');

          const [dept] = await tx.select().from(departments)
            .where(sql`lower(${departments.name}) = 'orphan test department'`);
          const seats = await tx.select().from(positions).where(eq(positions.deptId, dept.id));
          equals(seats.length, 1, 'only the row that could be placed');
        });
      },
    },

    {
      name: 'importing into a department that exists adds to it rather than duplicating it',
      async fn() {
        await inRollback(async (tx) => {
          const d = await aDepartment(tx);
          const before = await tx.select().from(positions).where(eq(positions.deptId, d.id));
          const r = await runIn(tx, 'mp.importCreate', admin, {
            fields: {
              deptName: d.name,
              rows: JSON.stringify([{ title: 'Bolt-on Seat Test', approved: 1 }]),
            },
          });
          succeeded(r, 'mp.importCreate');

          const all = await tx.select().from(departments)
            .where(sql`lower(${departments.name}) = ${d.name.toLowerCase()}`);
          equals(all.length, 1, 'one department, not two');
          const after = await tx.select().from(positions).where(eq(positions.deptId, d.id));
          equals(after.length, before.length + 1);
        });
      },
    },

    {
      name: 'only an Admin imports a department',
      async fn() {
        await inRollback(async (tx) => {
          refused(await runIn(tx, 'mp.importCreate', recruiter, {
            fields: { deptName: 'Nope', rows: JSON.stringify([{ title: 'X' }]) },
          }), 'does not include');
        });
      },
    },
  ],
};

export default suite;
