/* Recompute the derived values that are cached on records so a list can be
   drawn without recomputing every CV: the CV fit on every application, and the
   requisition `filled` counter.

     npx tsx scripts/recompute.ts           everything
     npx tsx scripts/recompute.ts fit       just the fit
   ───────────────────────────────────────────────────────────────────────────*/
import { loadEnvFiles } from '../db/env-files';
loadEnvFiles();

async function main() {
  const what = process.argv[2] ?? 'all';
  const { recomputeFit } = await import('../lib/services/fit');
  const { db } = await import('../db/client');
  const { sql } = await import('drizzle-orm');

  if (what === 'all' || what === 'fit') {
    const t0 = Date.now();
    const n = await recomputeFit({ all: true });
    console.log(`  CV fit recomputed on ${n.toLocaleString('en-US')} applications in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  if (what === 'all' || what === 'filled') {
    /* `filled` is denormalised onto the requisition because every list shows it.
       This puts it back in step with the applications that were actually hired. */
    const res = await db().execute(sql`
      UPDATE jobs j SET filled = x.n
        FROM (SELECT job_id, count(*)::int AS n FROM applications
               WHERE status = 'hired' GROUP BY 1) x
       WHERE x.job_id = j.id AND j.filled <> x.n`);
    console.log(`  filled counters corrected on ${(res as any).rowCount ?? 0} requisitions`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
