import { sql } from 'drizzle-orm';
import { loadEnvFiles } from '../db/env-files';

/* Who can sign in, and as what. Used when a harness needs a real address and
   nobody wants to guess at one. `npm run accounts`. */
loadEnvFiles();

async function main(): Promise<void> {
  const { db } = await import('../db/client');
  const { rows } = await db().execute(sql`
    SELECT a.email, a.role::text AS role, a.status::text AS status,
           coalesce(s.name, a.name) AS name,
           coalesce(s.role::text, '—') AS staff_role,
           a.scope_kind::text AS scope
      FROM accounts a
      LEFT JOIN staff s ON s.id = a.staff_id
     ORDER BY a.role, coalesce(s.role::text, ''), a.email`) as unknown as {
    rows: Array<Record<string, string>>;
  };

  console.log('');
  for (const r of rows) {
    console.log(
      `  ${String(r.role).padEnd(15)} ${String(r.staff_role).padEnd(13)} `
      + `${String(r.scope).padEnd(6)} ${String(r.email).padEnd(40)} ${r.name}`
      + (r.status === 'active' ? '' : `  (${r.status})`),
    );
  }
  console.log(`\n  ${rows.length} accounts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
