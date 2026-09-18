import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://bayut_ta:bayut_local_dev_pw@127.0.0.1:55441/bayut_ta' });
await c.connect();
const q = async (s) => (await c.query(s)).rows;
console.log(await q(`SELECT count(*) total FROM application_stage_history`));
console.log(await q(`SELECT to_stage, count(*) FROM application_stage_history GROUP BY 1 ORDER BY 2 DESC LIMIT 4`));
await c.end();
