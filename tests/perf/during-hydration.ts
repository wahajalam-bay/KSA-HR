/* ─────────────────────────────────────────────────────────────────────────────
   CLICKING WHILE THE PAGE IS STILL COMING UP

   The regression this exists to measure: a hard load of a heavy page, then a
   sidebar click the instant the control can be clicked — before the page has
   settled. That is what somebody does when they know where they are going, and
   it is the one case that still felt slow.

   It is deliberately unfair. `waitForSelector` returns as soon as the element
   is in the DOM, which on a server-rendered page is long before React has
   attached anything, so the click lands in the worst possible moment.

   Several samples, and it reports the median and the 95th percentile. One run
   of anything on a laptop is noise.

     npx tsx tests/perf/during-hydration.ts
     npx tsx tests/perf/during-hydration.ts --samples=9 --json
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../visual/drive';

const BASE = process.env.APP_URL ?? 'http://localhost:3400';
const samples = Number(process.argv.find((a) => a.startsWith('--samples='))?.split('=')[1] ?? 7);
const asJson = process.argv.includes('--json');

/* from → click this → wait for something only the destination has. */
const JOURNEYS: Array<{ name: string; from: string; to: string; until: string }> = [
  { name: 'Overview → Jobs', from: '/overview', to: '/jobs', until: '[data-act="job.status"]' },
  { name: 'Candidates → Jobs', from: '/candidates', to: '/jobs', until: '[data-act="job.status"]' },
  { name: 'Insights → Candidates', from: '/insights?tab=overview', to: '/candidates', until: '[data-act="cand.tab"]' },
  { name: 'Jobs → Overview', from: '/jobs', to: '/overview', until: '.hero' },
  { name: 'Candidates → Overview', from: '/candidates', to: '/overview', until: '.hero' },
];

/* A click the page never acted on, kept out of the percentiles and counted
   separately — averaging it in would turn a correctness problem into a
   slightly worse timing. */
const LOST = -1;

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] ?? 0;
};

async function signIn(page: Page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg_email', TEST_ACCOUNTS.admin);
  await page.click('button[type=submit]');
  await page.waitForSelector('#lg_password', { timeout: 60_000 });
  await page.fill('#lg_password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60_000 });
}

async function once(page: Page, j: (typeof JOURNEYS)[number]): Promise<number> {
  /* A hard load, exactly as a reload or a pasted link would do — waited to
     `load` so the browser has finished with it. Anything earlier races the
     first navigation against the second and measures neither. React has not
     necessarily hydrated by then, which is the whole point. */
  await page.goto(BASE + j.from, { waitUntil: 'load' });
  const nav = page.locator(`.nav [data-v="${j.to.split('?')[0]}"]`).first();
  await nav.waitFor({ state: 'visible', timeout: 60_000 });

  const t = Date.now();
  /* `force` skips Playwright's actionability wait, which would otherwise sit
     out exactly the interval being measured. */
  await nav.click({ force: true, noWaitAfter: true }).catch(() => {});

  /* Polled rather than waited on.

     A pre-hydration click on an anchor is a real browser navigation, which
     tears down the execution context `waitForSelector` is waiting in; it
     recovers, but not promptly, and the recovery was being counted as the page
     being slow. Re-resolving the locator each time measures the page instead of
     the harness — it was the difference between reporting 840ms and 360ms for
     the same navigation. */
  let acted = LOST;
  for (let i = 0; i < 600; i++) {
    if (await page.locator(j.until).count().catch(() => 0)) { acted = Date.now() - t; break; }
    await page.waitForTimeout(20);
  }
  return acted;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page);

  /* Warm every route once so this measures hydration, not compilation. */
  for (const j of JOURNEYS) {
    await page.goto(BASE + j.from, { waitUntil: 'load' });
    await page.goto(BASE + j.to, { waitUntil: 'load' });
  }

  const rows: Array<{ name: string; runs: number[]; p50: number; p95: number }> = [];
  for (const j of JOURNEYS) {
    const runs: number[] = [];
    for (let i = 0; i < samples; i++) runs.push(await once(page, j));
    const good = runs.filter((x) => x !== LOST);
    rows.push({ name: j.name, runs, p50: pct(good, 0.5), p95: pct(good, 0.95) });
  }
  await browser.close();

  console.log(`\n  clicking the sidebar the instant it appears  (${samples} samples each)\n`);
  console.log('  journey                       p50      p95     runs');
  console.log(`  ${'-'.repeat(68)}`);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(26)} ${`${r.p50}ms`.padStart(7)} ${`${r.p95}ms`.padStart(8)}   `
      + r.runs.map((x) => (x === LOST ? 'lost' : String(x))).join(' '),
    );
  }
  const lost = rows.flatMap((r) => r.runs).filter((x) => x === LOST).length;
  if (lost) console.log(`
  ${lost} click(s) the page never acted on`);
  const all = rows.flatMap((r) => r.runs).filter((x) => x !== LOST);
  console.log(`\n  overall p50 ${pct(all, 0.5)}ms · p95 ${pct(all, 0.95)}ms\n`);

  if (asJson) {
    const out = path.join(process.cwd(), 'tests', 'reports', 'during-hydration.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      at: new Date().toISOString(), base: BASE, samples, rows,
      overall: { p50: pct(all, 0.5), p95: pct(all, 0.95) },
    }, null, 2));
    console.log(`  written to ${path.relative(process.cwd(), out)}\n`);
  }
}

main();
