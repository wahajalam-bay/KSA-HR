import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

/* One pool for the process. Next.js reloads modules in development, so the pool
   is parked on globalThis — otherwise a dozen edits leave a dozen pools open and
   the cluster runs out of connections. */
const globalForDb = globalThis as unknown as {
  __bayutPool?: pg.Pool;
  __bayutDb?: NodePgDatabase<typeof schema>;
};

/* `numeric` comes back as a string from node-postgres by default, which is the
   right call for money — but our numerics are ratings and confidences, read as
   numbers everywhere. Parse them, and leave int8 as a string so a count over
   2^53 is never silently wrong. */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example');
  return url;
}

export function pool(): pg.Pool {
  if (!globalForDb.__bayutPool) {
    globalForDb.__bayutPool = new pg.Pool({
      connectionString: connectionString(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
      /* A statement that has run away should not hold a connection for ever. */
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'bayut-ta',
    });
    globalForDb.__bayutPool.on('error', (err) => {
      // A pool-level error is an idle client dropping; log it and let pg reconnect.
      console.error('[db] idle client error', err.message);
    });
  }
  return globalForDb.__bayutPool;
}

export function db(): NodePgDatabase<typeof schema> {
  if (!globalForDb.__bayutDb) {
    globalForDb.__bayutDb = drizzle(pool(), { schema, logger: process.env.LOG_LEVEL === 'debug' });
  }
  return globalForDb.__bayutDb;
}

export type Db = NodePgDatabase<typeof schema>;
/* The type a function gets inside `db().transaction(...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/* Anything that can run a query: the pool, or a transaction. Commands take this
   so they compose — one command may be called inside another's transaction. */
export type Exec = Db | Tx;

export { schema };
