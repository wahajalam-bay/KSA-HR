import { loadEnvFiles } from '@/db/env-files';
loadEnvFiles();
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const q = process.argv.slice(2).join(' ');
  const r = await db().execute(sql.raw(q));
  console.log(JSON.stringify((r as { rows?: unknown[] }).rows ?? r, null, 1));
  process.exit(0);
}
main();
