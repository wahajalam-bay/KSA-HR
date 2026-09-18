import type { Config } from 'drizzle-kit';

export default {
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://bayut_ta:bayut_local_dev_pw@127.0.0.1:55441/bayut_ta',
  },
  verbose: true,
  strict: true,
} satisfies Config;
