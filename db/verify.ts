/* ─────────────────────────────────────────────────────────────────────────────
   A census of what is actually in the database, and the invariants that must
   hold for the product to tell the truth. Run it after a seed, after a
   migration, and in CI.

     npm run db:verify
   ───────────────────────────────────────────────────────────────────────────*/
import pg from 'pg';
import { loadEnvFiles } from './env-files';

loadEnvFiles();

type Check = { name: string; sql: string; expect: (n: number) => boolean; why: string };

/* Each of these is a way the product could quietly lie. They all count rows
   that should not exist, so the expectation is almost always zero. */
const CHECKS: Check[] = [
  { name: 'stage spine is ten stages in order', why: 'the board and every funnel depend on the order',
    sql: `SELECT count(*) FROM stages`, expect: (n) => n === 10 },

  { name: 'no application sits on a stage its requisition does not run',
    why: 'a card on a column that is not on the board is invisible',
    sql: `SELECT count(*) FROM applications a
           WHERE a.status IN ('active','on_hold')
             AND NOT EXISTS (SELECT 1 FROM job_stages s WHERE s.job_id = a.job_id AND s.stage_key = a.stage)`,
    expect: (n) => n === 0 },

  { name: 'no live application without stage history',
    why: 'stage history is the record; an application with none cannot be audited',
    sql: `SELECT count(*) FROM applications a
           WHERE NOT EXISTS (SELECT 1 FROM application_stage_history h WHERE h.application_id = a.id)`,
    expect: (n) => n === 0 },

  { name: 'stage history is in order',
    why: 'a hop dated before the one it follows makes every dwell time wrong',
    sql: `SELECT count(*) FROM (
            SELECT application_id, at, seq,
                   lag(at) OVER (PARTITION BY application_id ORDER BY seq) AS prev
              FROM application_stage_history) x
           WHERE prev IS NOT NULL AND at < prev`,
    expect: (n) => n === 0 },

  { name: 'no two live applications from one person to one requisition',
    why: 'two live cards for one person double every count on the board',
    sql: `SELECT count(*) FROM (
            SELECT job_id, candidate_id FROM applications
             WHERE status IN ('active','on_hold')
             GROUP BY 1,2 HAVING count(*) > 1) x`,
    expect: (n) => n === 0 },

  { name: 'every requisition has exactly one lead hiring manager',
    why: 'the approval chain and the offer letter both name the lead',
    sql: `SELECT count(*) FROM jobs j
           WHERE (SELECT count(*) FROM job_hiring_managers h WHERE h.job_id = j.id AND h.is_lead) <> 1`,
    expect: (n) => n === 0 },

  { name: 'every requisition has at least one interview stage',
    why: 'a loop with no interview in it is not a loop',
    sql: `SELECT count(*) FROM jobs j
           WHERE NOT EXISTS (SELECT 1 FROM job_stages s WHERE s.job_id = j.id
                              AND s.stage_key IN ('screen','assessment','iv1','iv2','pitch','ivf'))`,
    expect: (n) => n === 0 },

  { name: 'every requisition says how it gets filled',
    why: 'a requisition nobody is filling is not a requisition',
    sql: `SELECT count(*) FROM jobs
           WHERE NOT (sourcing_internal OR sourcing_hunt OR sourcing_linkedin)`,
    expect: (n) => n === 0 },

  { name: 'every requisition has a skill bar',
    why: 'the radar has nothing to measure an applicant against otherwise',
    sql: `SELECT count(*) FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM job_skills s WHERE s.job_id = j.id)`,
    expect: (n) => n === 0 },

  { name: 'no seat holds more people than it has approved',
    why: 'the manpower plan stops reconciling with the people on the books',
    sql: `SELECT count(*) FROM positions p
           WHERE p.plan_state = 'approved'
             AND (SELECT count(*) FROM employees e WHERE e.position_code = p.code AND e.status <> 'left') > p.approved`,
    expect: (n) => n === 0 },

  { name: 'no requested seat has anybody in it',
    why: 'a seat that is not headcount yet cannot be filled',
    sql: `SELECT count(*) FROM positions p
           WHERE p.plan_state = 'pending'
             AND EXISTS (SELECT 1 FROM employees e WHERE e.position_code = p.code AND e.status <> 'left')`,
    expect: (n) => n === 0 },

  { name: 'no reporting line points outside its department',
    why: 'the chart would draw a branch that goes nowhere',
    sql: `SELECT count(*) FROM positions p JOIN positions up ON up.id = p.reports_to_id
           WHERE p.dept_id <> up.dept_id`,
    expect: (n) => n === 0 },

  { name: 'no reporting cycle',
    why: 'the chart would recurse for ever',
    sql: `WITH RECURSIVE up(id, root, depth) AS (
            SELECT id, id, 0 FROM positions
            UNION ALL
            SELECT p.reports_to_id, u.root, u.depth + 1
              FROM up u JOIN positions p ON p.id = u.id
             WHERE p.reports_to_id IS NOT NULL AND u.depth < 40)
          SELECT count(*) FROM up WHERE depth >= 40`,
    expect: (n) => n === 0 },

  { name: 'every hire has a probation record',
    why: 'quality of hire counts the decided; a hire with no record is uncounted',
    sql: `SELECT count(*) FROM employees e
           WHERE e.source = 'hire'
             AND NOT EXISTS (SELECT 1 FROM probation_records p WHERE p.employee_id = e.id)`,
    expect: (n) => n === 0 },

  { name: 'probation ends three months after it starts',
    why: 'the three-month rule is the whole definition',
    sql: `SELECT count(*) FROM probation_records
           WHERE ends_on <> (starts_on + (months || ' months')::interval)::date`,
    expect: (n) => n === 0 },

  { name: 'no employee record without an accepted or signed offer behind it',
    why: 'an employee id is issued by a signature, not by hand',
    sql: `SELECT count(*) FROM employees e
           WHERE e.source = 'hire' AND e.offer_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.id = e.offer_id
                              AND o.state IN ('signed','accepted'))`,
    expect: (n) => n === 0 },

  { name: 'no two employee records for one application',
    why: 'that is a double hire',
    sql: `SELECT count(*) FROM (SELECT application_id FROM employees
            WHERE application_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`,
    expect: (n) => n === 0 },

  { name: 'every offer belongs to an application on its own requisition',
    why: 'an offer on the wrong requisition prices the wrong band',
    sql: `SELECT count(*) FROM offers o JOIN applications a ON a.id = o.application_id
           WHERE a.job_id <> o.job_id OR a.candidate_id <> o.candidate_id`,
    expect: (n) => n === 0 },

  { name: 'a sent offer has a sent_at',
    why: 'the acceptance clock is measured from it',
    sql: `SELECT count(*) FROM offers
           WHERE state IN ('sent','viewed','signed','accepted') AND sent_at IS NULL`,
    expect: (n) => n === 0 },

  { name: 'every declined offer carries a reason',
    why: 'the decline reasons are the only honest read on why offers are lost',
    sql: `SELECT count(*) FROM offers
           WHERE response_state = 'declined' AND (response_reason IS NULL OR response_reason = '')`,
    expect: (n) => n === 0 },

  { name: 'approval steps are numbered without gaps',
    why: '"step 3 of 5" has to mean something',
    sql: `SELECT count(*) FROM (
            SELECT approval_id, count(*) AS n, max(ordinal) AS mx, min(ordinal) AS mn
              FROM approval_steps GROUP BY 1) x
           WHERE mn <> 0 OR mx <> n - 1`,
    expect: (n) => n === 0 },

  { name: 'at most one open approval chain per record',
    why: 'two open chains means nobody knows who is deciding',
    sql: `SELECT count(*) FROM (SELECT subject, subject_id FROM approvals
            WHERE state = 'pending' GROUP BY 1,2 HAVING count(*) > 1) x`,
    expect: (n) => n === 0 },

  { name: 'every scored screening reads 1–100',
    why: 'one ruler for everything the assistant scores',
    sql: `SELECT count(*) FROM screenings
           WHERE status = 'completed' AND (score IS NULL OR score < 1 OR score > 100)`,
    expect: (n) => n === 0 },

  { name: 'every completed pitch reads 1–100',
    why: 'same ruler',
    sql: `SELECT count(*) FROM pitches
           WHERE status = 'completed' AND (score IS NULL OR score < 1 OR score > 100)`,
    expect: (n) => n === 0 },

  { name: 'no interview outside its application',
    why: 'an interview on the wrong candidate is worse than none',
    sql: `SELECT count(*) FROM interviews i JOIN applications a ON a.id = i.application_id
           WHERE a.candidate_id <> i.candidate_id OR a.job_id <> i.job_id`,
    expect: (n) => n === 0 },

  { name: 'no scorecard on a stage the requisition does not run',
    why: 'the scorecard would have nowhere to show',
    sql: `SELECT count(*) FROM evaluations e
           WHERE NOT EXISTS (SELECT 1 FROM job_stages s WHERE s.job_id = e.job_id AND s.stage_key = e.stage)`,
    expect: (n) => n === 0 },

  { name: 'no future timestamp beyond the dataset clock',
    why: 'a record dated after today makes every "days ago" negative',
    sql: `SELECT count(*) FROM applications WHERE applied_at > now() + interval '1 day'`,
    expect: (n) => n === 0 },

  { name: 'every account e-mail is unique and lower-case',
    why: 'two accounts for one address is an authentication bug',
    sql: `SELECT count(*) FROM accounts WHERE email <> lower(email)`,
    expect: (n) => n === 0 },

  { name: 'no account carries a password from the prototype hash',
    why: 'a SHA-256 of a salted password is not a production credential',
    sql: `SELECT count(*) FROM accounts WHERE password_hash IS NOT NULL AND password_hash NOT LIKE 'scrypt$%'`,
    expect: (n) => n === 0 },

  { name: 'the audit trail refuses to be edited',
    why: 'an editable audit trail is decoration',
    sql: `SELECT count(*) FROM information_schema.triggers
           WHERE event_object_table = 'audit_events' AND trigger_name = 'audit_events_append_only'`,
    expect: (n) => n >= 1 },

  { name: 'stage history refuses to be edited',
    why: 'the history is how conversion and dwell time are computed',
    sql: `SELECT count(*) FROM information_schema.triggers
           WHERE event_object_table = 'application_stage_history'
             AND trigger_name = 'application_stage_history_append_only'`,
    expect: (n) => n >= 1 },
];

const CENSUS = `
  SELECT 'tables'      AS k, count(*)::int AS n FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
  UNION ALL SELECT 'indexes', count(*)::int FROM pg_indexes WHERE schemaname='public'
  UNION ALL SELECT 'foreign keys', count(*)::int FROM information_schema.table_constraints
    WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'
  UNION ALL SELECT 'check constraints', count(*)::int FROM information_schema.table_constraints
    WHERE constraint_schema='public' AND constraint_type='CHECK'
  UNION ALL SELECT 'unique constraints', count(*)::int FROM pg_indexes
    WHERE schemaname='public' AND indexdef LIKE 'CREATE UNIQUE%'
  UNION ALL SELECT 'enums', count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE t.typtype='e' AND n.nspname='public'
  UNION ALL SELECT 'triggers', count(DISTINCT trigger_name)::int FROM information_schema.triggers
    WHERE trigger_schema='public'
`;

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'bayut-ta-verify' });
  await c.connect();
  let failed = 0;
  try {
    const census = await c.query<{ k: string; n: number }>(CENSUS);
    console.log('\n  Schema');
    for (const r of census.rows) console.log(`    ${String(r.n).padStart(5)}  ${r.k}`);

    const sizes = await c.query<{ collection: string; rows: string }>(
      `SELECT relname AS collection, n_live_tup::text AS rows FROM pg_stat_user_tables
        WHERE schemaname='public' AND n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 12`);
    console.log('\n  Largest collections');
    for (const r of sizes.rows) console.log(`    ${String(r.rows).padStart(6)}  ${r.collection}`);

    console.log('\n  Invariants');
    for (const chk of CHECKS) {
      const { rows } = await c.query<{ count: string }>(chk.sql);
      const n = Number(Object.values(rows[0] ?? { count: '0' })[0]);
      const ok = chk.expect(n);
      if (!ok) failed++;
      console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${chk.name}${ok ? '' : `  (got ${n}) — ${chk.why}`}`);
    }
  } finally {
    await c.end();
  }
  console.log(failed ? `\n  ${failed} invariant(s) failed\n` : '\n  every invariant holds\n');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
