/* ─────────────────────────────────────────────────────────────────────────────
   HOW LONG A CLICK TAKES

   Loading a URL is not what using a product feels like. Clicking is. Every
   navigation here goes through the delegated dispatcher and `router.push`, so
   each one is a round trip to the server, a fresh render, and a reconciliation
   of the whole tree — and none of that is visible in a page-load measurement.

   This clicks the things somebody actually clicks and times from the press to
   the moment the new content is on the screen.

     npx tsx tests/perf/clicks.ts
   ───────────────────────────────────────────────────────────────────────────*/
import { chromium, type Page } from 'playwright';
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../visual/drive';

const BASE = process.env.APP_URL ?? 'http://localhost:3400';

type Step = {
  name: string;
  /* Where to start, when it is not wherever the last step left off. */
  from?: string;
  click: string;
  /* What proves the new view has arrived. */
  until: string;
};

const STEPS: Step[] = [
  /* The sidebar. `until` names something only the destination has, so the wait
     cannot be satisfied by the page that is already on screen. */
  { name: 'sidebar · Jobs', from: '/overview', click: '.nav [data-v="/jobs"]', until: 'h1:has-text("Jobs"), .topbar :text("Jobs")' },
  { name: 'sidebar · Candidates', click: '.nav [data-v="/candidates"]', until: '.crow' },
  { name: 'sidebar · Scheduling', click: '.nav [data-v="/scheduling"]', until: '.agenda, .slot, main#view .card' },
  { name: 'sidebar · Insights', click: '.nav [data-v="/insights"]', until: '.subnav' },
  { name: 'sidebar · Overview', click: '.nav [data-v="/overview"]', until: '.hero' },

  /* Within a page: a tab, a period, a chart mark, a row. */
  { name: 'subnav · another tab', from: '/insights?tab=overview', click: '.subnav [data-v="sources"]', until: 'text=Volume by channel' },
  { name: 'period · Month', from: '/overview', click: '[data-act="ov.win"][data-v="30"]', until: '.hero' },
  { name: 'a chart mark', from: '/overview', click: '.cmk[data-act]', until: '.cfilter' },
  { name: 'a candidate row', from: '/candidates', click: '.crow', until: '.sheet, [role=dialog], aside .bd' },
  { name: 'a requisition', from: '/jobs', click: 'main#view [data-act="go"][data-v^="/jobs/job_"]', until: '.stepper, .subnav' },
];

/* How long the pointer rests before the press. 250ms is an unhurried but
   ordinary hover; the prefetch fires at 90ms. */
const HOVER_MS = Number(process.argv.find((a) => a.startsWith('--hover='))?.split('=')[1] ?? 250);

const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m'; const RED = '\x1b[31m'; const OFF = '\x1b[0m';
const colour = (ms: number) => (ms < 250 ? GREEN : ms < 600 ? YELLOW : RED);

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg_email', TEST_ACCOUNTS.admin);
  await page.click('button[type=submit]');
  await page.waitForSelector('#lg_password', { timeout: 60_000 });
  await page.fill('#lg_password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 120_000 });

  console.log('\n  what was clicked               press to content');
  console.log(`  ${'-'.repeat(50)}`);

  const results: Array<[string, number]> = [];
  for (const s of STEPS) {
    if (s.from) {
      await page.goto(BASE + s.from, { waitUntil: 'load' });
      /* Wait for the page to be interactive, not merely painted. The whole
         interface is one delegated listener attached on hydration, so a click
         that lands before that does nothing at all — and a probe that does not
         wait measures a timeout instead of a click. */
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForFunction(
        `!!document.querySelector('main#view') && !document.querySelector('.bloader')`,
        undefined, { timeout: 30_000 },
      ).catch(() => {});
      await page.waitForTimeout(250);
    }
    const target = page.locator(s.click).first();
    if (!(await target.count())) {
      console.log(`  ${s.name.padEnd(30)}   (nothing to click)`);
      continue;
    }
    /* A person rests the pointer on a thing before pressing it. Playwright does
       not, and the difference matters here: resting is what triggers the
       prefetch. `--nohover` measures the other case — a click with no warning
       at all, which is what a keyboard or a very fast hand produces. */
    if (!process.argv.includes('--nohover')) {
      await target.hover({ timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(HOVER_MS);
    }
    const t = Date.now();
    await target.click({ timeout: 15_000 }).catch(() => {});
    await page.waitForSelector(s.until, { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction('!document.querySelector(".skel")', undefined, { timeout: 20_000 })
      .catch(() => {});
    const ms = Date.now() - t;
    results.push([s.name, ms]);
    console.log(`  ${s.name.padEnd(30)} ${colour(ms)}${String(ms).padStart(6)}ms${OFF}`);
  }

  const worst = results.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0] as [string, number]);
  const median = results.map((r) => r[1]).sort((a, b) => a - b)[results.length >> 1] ?? 0;
  console.log(`\n  median ${median}ms · worst ${worst[0]} at ${worst[1]}ms\n`);
  await browser.close();
}

main();
