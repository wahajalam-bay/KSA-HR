import { loadEnvFiles } from '@/db/env-files';
loadEnvFiles();
import { db } from '@/db/client';
import { rows } from '@/lib/queries/sql';
import { sql } from 'drizzle-orm';

async function main() {
  const want = process.argv.slice(2);
  const r = rows(await db().execute(sql`
    SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY(${sql.raw(`ARRAY[${want.map((w) => `'${w}'`).join(',')}]`)})
     GROUP BY table_name ORDER BY table_name`)) as Array<{ table_name: string; cols: string }>;
  for (const t of r) console.log(`\n${t.table_name}\n  ${t.cols}`);
  process.exit(0);
}
main();
