/* ─────────────────────────────────────────────────────────────────────────────
   The migration runner.

   Every .sql file in db/migrations is applied once, in filename order, inside a
   transaction, and recorded in a ledger with the checksum of the file that was
   applied. Editing a migration that has already run is refused rather than
   silently ignored, because a schema that does not match its ledger is a
   deployment nobody can reason about.

     tsx db/migrate.ts up        apply everything outstanding
     tsx db/migrate.ts status    what has run, what has not
     tsx db/migrate.ts reset     drop the public schema and re-apply (dev only)
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { loadEnvFiles } from './env-files';

loadEnvFiles();

const DIR = path.join(process.cwd(), 'db', 'migrations');
const LEDGER = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0
);`;

type Migration = { file: string; sql: string; checksum: string };

function read(): Migration[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      return { file, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 32) };
    });
}

/* drizzle-kit writes `--> statement-breakpoint` between statements; anything we
   author by hand is run whole, because a function body contains semicolons. */
function statements(sql: string): string[] {
  if (sql.includes('--> statement-breakpoint')) {
    return sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  }
  return [sql];
}

async function connect(): Promise<pg.Client> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const c = new pg.Client({ connectionString: url, application_name: 'bayut-ta-migrate' });
  await c.connect();
  return c;
}

async function up(): Promise<number> {
  const c = await connect();
  try {
    await c.query(LEDGER);
    const applied = new Map<string, string>(
      (await c.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migrations'))
        .rows.map((r) => [r.filename, r.checksum]),
    );
    const all = read();
    let ran = 0;

    for (const m of all) {
      const was = applied.get(m.file);
      if (was) {
        if (was !== m.checksum) {
          throw new Error(
            `${m.file} has changed since it was applied (ledger ${was}, file ${m.checksum}).\n` +
            'A migration that has run is history. Add a new migration instead.',
          );
        }
        continue;
      }
      const t0 = Date.now();
      process.stdout.write(`  ${m.file} … `);
      await c.query('BEGIN');
      try {
        for (const s of statements(m.sql)) await c.query(s);
        await c.query(
          'INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3)',
          [m.file, m.checksum, Date.now() - t0],
        );
        await c.query('COMMIT');
        process.stdout.write(`ok (${Date.now() - t0} ms)\n`);
        ran++;
      } catch (err) {
        await c.query('ROLLBACK');
        process.stdout.write('failed\n');
        throw err;
      }
    }
    if (!ran) console.log('  nothing outstanding');
    return ran;
  } finally {
    await c.end();
  }
}

async function status(): Promise<void> {
  const c = await connect();
  try {
    await c.query(LEDGER);
    const applied = new Map<string, { checksum: string; applied_at: Date }>(
      (await c.query('SELECT filename, checksum, applied_at FROM schema_migrations'))
        .rows.map((r: any) => [r.filename, r]),
    );
    for (const m of read()) {
      const a = applied.get(m.file);
      const mark = !a ? 'PENDING ' : a.checksum !== m.checksum ? 'CHANGED ' : 'applied ';
      console.log(`  ${mark} ${m.file}${a ? '  ' + new Date(a.applied_at).toISOString() : ''}`);
    }
    const objects = await c.query<{ kind: string; n: string }>(`
      SELECT 'tables' AS kind, count(*)::text AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'
      UNION ALL SELECT 'indexes', count(*)::text FROM pg_indexes WHERE schemaname='public'
      UNION ALL SELECT 'constraints', count(*)::text FROM information_schema.table_constraints
        WHERE constraint_schema='public'
      UNION ALL SELECT 'enums', count(*)::text FROM pg_type t
        JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typtype='e' AND n.nspname='public'
      UNION ALL SELECT 'functions', count(*)::text FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      UNION ALL SELECT 'triggers', count(*)::text FROM information_schema.triggers
        WHERE trigger_schema='public'`);
    console.log('\n  ' + objects.rows.map((r) => `${r.n} ${r.kind}`).join(' · '));
  } finally {
    await c.end();
  }
}

async function reset(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('reset is refused in production');
  const c = await connect();
  try {
    console.log('  dropping schema public');
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
    await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await c.query('CREATE EXTENSION IF NOT EXISTS btree_gin');
    await c.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
  } finally {
    await c.end();
  }
  await up();
}

const cmd = process.argv[2] ?? 'up';
const run = cmd === 'status' ? status : cmd === 'reset' ? reset : up;
run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n' + (e instanceof Error ? e.message : String(e))); process.exit(1); });
