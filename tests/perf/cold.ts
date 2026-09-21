/* ─────────────────────────────────────────────────────────────────────────────
   THE FIRST VISIT TO EACH ROUTE

   What somebody clicking around actually feels. In development the first
   request to a route compiles it, and that cost lands on the person waiting —
   it is invisible to any measurement that warms the route first, which is why
   this one does not.

   Run it against a freshly started server, or it is measuring nothing.

     npx tsx tests/perf/cold.ts
   ───────────────────────────────────────────────────────────────────────────*/
import { chromium } from 'playwright';
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../visual/drive';

const BASE = process.env.APP_URL ?? 'http://localhost:3400';

const ROUTES = [
  '/overview', '/jobs', '/jobs/job_01', '/candidates', '/scheduling',
  '/offers', '/onboarding', '/manpower', '/team', '/team/stf_02',
  '/insights?tab=overview', '/settings',
];

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

  const signedIn = Date.now();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg_email', TEST_ACCOUNTS.admin);
  await page.click('button[type=submit]');
  await page.waitForSelector('#lg_password', { timeout: 60_000 });
  await page.fill('#lg_password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 120_000 });
  console.log(`\n  sign-in and first page: ${Date.now() - signedIn}ms`);

  console.log('\n  route                        first visit');
  console.log(`  ${'-'.repeat(44)}`);
  let total = 0;
  for (const r of ROUTES) {
    const t = Date.now();
    await page.goto(BASE + r, { waitUntil: 'load' });
    const ms = Date.now() - t;
    total += ms;
    console.log(`  ${r.padEnd(28)} ${String(ms).padStart(7)}ms`);
  }
  console.log(`\n  ${ROUTES.length} routes · ${(total / 1000).toFixed(1)}s in total `
    + `· ${Math.round(total / ROUTES.length)}ms each\n`);
  await browser.close();
}

main();
