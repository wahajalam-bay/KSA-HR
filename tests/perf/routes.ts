/* ─────────────────────────────────────────────────────────────────────────────
   HOW LONG EVERY PAGE TAKES, AND WHAT IT WEIGHS

   A slow page is slow for one of three reasons: the server thought for too
   long, it sent too much, or the browser had too much to do with what arrived.
   This separates the three — the server's own think time, the bytes of HTML,
   the number of DOM nodes, and what the browser itself recorded for first
   paint and for load.

   `settle()` is deliberately not used. It waits for the network to be quiet
   for half a second, which is right before a screenshot and useless in a
   measurement: it would add the same half second to every route and hide
   whatever the route actually costs.

     npx tsx tests/perf/routes.ts
     npx tsx tests/perf/routes.ts --json
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../visual/drive';

const BASE = process.env.APP_URL ?? 'http://localhost:3400';
const asJson = process.argv.includes('--json');

const ROUTES: Array<[string, string]> = [
  ['overview', '/overview'],
  ['jobs', '/jobs'],
  ['job board', '/jobs/job_01'],
  ['job insights', '/jobs/job_01?tab=insights'],
  ['candidates', '/candidates'],
  ['scheduling', '/scheduling'],
  ['scheduling · load', '/scheduling?tab=load'],
  ['offers', '/offers'],
  ['onboarding', '/onboarding'],
  ['manpower', '/manpower'],
  ['team', '/team'],
  ['team · person', '/team/stf_02'],
  ['insights · scorecard', '/insights?tab=overview'],
  ['insights · turnaround', '/insights?tab=tat'],
  ['insights · recruiters', '/insights?tab=recruiters'],
  ['insights · sources', '/insights?tab=sources'],
  ['insights · departments', '/insights?tab=departments'],
  ['insights · pay', '/insights?tab=market'],
  ['insights · quality', '/insights?tab=quality'],
  ['insights · interviewers', '/insights?tab=interviewers'],
  ['insights · offers', '/insights?tab=offers'],
  ['insights · budget', '/insights?tab=budget'],
  ['settings', '/settings'],
];

type Timing = {
  server: number; paint: number; ready: number;
  bytes: number; nodes: number; script: number;
};
type Row = { id: string; path: string } & Timing;

async function time(page: Page, url: string): Promise<Timing> {
  let server = 0;
  const onResponse = (r: {
    url: () => string;
    request: () => { timing: () => { responseStart: number; requestStart: number } };
  }) => {
    if (r.url() === url) {
      const t = r.request().timing();
      server = Math.max(0, t.responseStart - t.requestStart);
    }
  };
  page.on('response', onResponse as never);
  const res = await page.goto(url, { waitUntil: 'load' });
  const bytes = (await res?.body().catch(() => null))?.length ?? 0;
  const m = await page.evaluate(`(() => {
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0];
    /* How much of the page is the flight data React embeds to hydrate with.
       It is HTML weight that nobody reads, so it is worth knowing separately. */
    var flight = 0;
    var tags = document.querySelectorAll('script');
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i].textContent || '';
      if (t.indexOf('__next_f') >= 0) flight += t.length;
    }
    return {
      paint: Math.round(fcp ? fcp.startTime : 0),
      ready: Math.round(nav.loadEventEnd || 0),
      nodes: document.getElementsByTagName('*').length,
      script: flight,
    };
  })()`) as { paint: number; ready: number; nodes: number; script: number };
  page.off('response', onResponse as never);
  return { server, bytes, ...m };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  /* A plain sign-in. The visual harness holds the clock to the dataset instant
     and refuses without it; a production build declines that override by
     design, and timing a page does not need it. */
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg_email', TEST_ACCOUNTS.admin);
  await page.click('button[type=submit]');
  await page.waitForSelector('#lg_password', { timeout: 20_000 });
  await page.fill('#lg_password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30_000 });

  const rows: Row[] = [];
  for (const [id, p] of ROUTES) {
    const url = BASE + p;
    await time(page, url);                        // warm the route
    await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
    rows.push({ id, path: p, ...(await time(page, url)) });
  }

  await browser.close();

  if (asJson) {
    const out = path.join(process.cwd(), 'tests', 'reports', 'perf.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: BASE, rows }, null, 2));
    console.log(`  written to ${path.relative(process.cwd(), out)}`);
  }

  const kb = (n: number) => `${Math.round(n / 1024)}kB`;
  console.log('\n  route                      server   paint  loaded      html   flight     nodes');
  console.log(`  ${'-'.repeat(76)}`);
  for (const r of [...rows].sort((a, b) => b.bytes - a.bytes)) {
    console.log(
      `  ${r.id.padEnd(24)} ${`${Math.round(r.server)}ms`.padStart(7)} `
      + `${`${r.paint}ms`.padStart(7)} ${`${r.ready}ms`.padStart(7)} `
      + `${kb(r.bytes).padStart(9)} ${kb(r.script).padStart(8)} ${String(r.nodes).padStart(9)}`,
    );
  }
  const heaviest = rows.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  const slowest = rows.reduce((a, b) => (b.ready > a.ready ? b : a));
  const medianReady = [...rows].sort((a, b) => a.ready - b.ready)[rows.length >> 1].ready;
  console.log(`\n  median ${medianReady}ms to loaded · slowest ${slowest.id} at ${slowest.ready}ms`);
  console.log(`  heaviest ${heaviest.id} at ${kb(heaviest.bytes)} of HTML, `
    + `${kb(heaviest.script)} of it hydration data\n`);
}

main();
