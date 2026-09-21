/* ─────────────────────────────────────────────────────────────────────────────
   THE FULL PICTURE, PER ROUTE

   Everything that decides how a page feels, measured in one pass rather than
   inferred from one number: what the server sent, how much of it is hydration
   data nobody reads, how many nodes the browser has to build, how long the main
   thread was blocked, and how long the page took to become interactive.

   It also reports where the weight sits inside the page — which container holds
   the most nodes — because "the page is heavy" is not an instruction and "the
   list is 120 rows of 53 nodes" is.

     npx tsx tests/perf/profile.ts
     npx tsx tests/perf/profile.ts --json
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../visual/drive';

const BASE = process.env.APP_URL ?? 'http://localhost:3400';
const asJson = process.argv.includes('--json');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const ROUTES: Array<[string, string]> = [
  ['overview', '/overview'],
  ['candidates', '/candidates'],
  ['jobs', '/jobs'],
  ['insights', '/insights?tab=overview'],
  ['insights · pay', '/insights?tab=market'],
  ['team', '/team'],
  ['scheduling · load', '/scheduling?tab=load'],
];

export type Profile = {
  id: string; path: string;
  htmlWire: number; htmlRaw: number; flight: number;
  jsWire: number; cssWire: number;
  nodes: number; depth: number; svgs: number;
  server: number; paint: number; interactive: number; visible: number;
  blocking: number; longest: number; tasks: number;
  heaviest: Array<{ what: string; nodes: number }>;
};

/* Installed before the document runs so nothing is missed. */
const OBSERVE = `
  window.__perf = { long: [] };
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { window.__perf.long.push(Math.round(e.duration)); });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}
`;

const READY = `(() => {
  var v = document.querySelector('main#view');
  return !!v && !v.querySelector('.bloader');
})()`;

const MEASURE = `(() => {
  var nav = performance.getEntriesByType('navigation')[0] || {};
  var res = performance.getEntriesByType('resource');
  var js = 0, css = 0;
  for (var i = 0; i < res.length; i++) {
    var u = res[i].name;
    if (u.indexOf('.js') > 0) js += res[i].encodedBodySize || 0;
    if (u.indexOf('.css') > 0) css += res[i].encodedBodySize || 0;
  }

  /* The flight payload: what React embeds so it can hydrate. It is HTML weight
     that nobody reads, and it tracks the size of the rendered tree. */
  var flight = 0;
  var tags = document.querySelectorAll('script');
  for (var i = 0; i < tags.length; i++) {
    var t = tags[i].textContent || '';
    if (t.indexOf('__next_f') >= 0) flight += t.length;
  }

  /* Where the nodes are. Every element that holds more than a fortieth of the
     page is named, so the worst container is obvious rather than guessed. */
  var all = document.getElementsByTagName('*');
  var total = all.length;
  var heaviest = [];
  var seen = document.querySelectorAll('main#view *');
  var floor = Math.max(40, Math.round(total / 40));
  for (var i = 0; i < seen.length; i++) {
    var el = seen[i];
    var n = el.getElementsByTagName('*').length;
    if (n < floor) continue;
    var kids = el.children.length;
    /* Only report a container that actually branches, so a chain of single
       wrappers does not fill the list with the same subtree. */
    if (kids < 2 && n > floor) continue;
    var name = el.tagName.toLowerCase()
      + (el.className && typeof el.className === 'string'
        ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '');
    heaviest.push({ what: name + ' (' + kids + ' children)', nodes: n });
  }
  heaviest.sort(function (a, b) { return b.nodes - a.nodes; });

  /* How deep the tree goes: depth costs style recalculation and layout. */
  var depth = 0;
  for (var i = 0; i < all.length; i++) {
    var d = 0, p = all[i];
    while (p && p !== document.documentElement) { d++; p = p.parentElement; }
    if (d > depth) depth = d;
  }

  var long = (window.__perf && window.__perf.long) || [];
  return {
    htmlWire: Math.round((nav.encodedBodySize || 0) / 1024),
    htmlRaw: Math.round((nav.decodedBodySize || 0) / 1024),
    flight: Math.round(flight / 1024),
    jsWire: Math.round(js / 1024),
    cssWire: Math.round(css / 1024),
    nodes: total,
    depth: depth,
    svgs: document.querySelectorAll('svg').length,
    paint: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0),
    interactive: Math.round(nav.domInteractive || 0),
    /* Everything over 50ms blocks the main thread; the excess is what a person
       feels as the page refusing to respond. */
    blocking: long.reduce(function (a, b) { return a + Math.max(0, b - 50); }, 0),
    longest: long.reduce(function (a, b) { return Math.max(a, b); }, 0),
    tasks: long.length,
    heaviest: heaviest.slice(0, 5),
  };
})()`;

async function profile(page: Page, id: string, p: string): Promise<Profile> {
  const url = BASE + p;
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
  await page.goto(url, { waitUntil: 'load' });
  const started = Date.now();
  await page.waitForFunction(READY, undefined, { timeout: 60_000 }).catch(() => {});
  const visible = Date.now() - started;
  /* Give the main thread a moment so the long-task observer has reported. */
  await page.waitForTimeout(600);
  const m = await page.evaluate(MEASURE) as Omit<Profile, 'id' | 'path' | 'server' | 'visible'>;
  page.off('response', onResponse as never);
  return { id, path: p, server: Math.round(server), visible, ...m };
}

export async function signIn(page: Page, who = TEST_ACCOUNTS.admin) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg_email', who);
  await page.click('button[type=submit]');
  await page.waitForSelector('#lg_password', { timeout: 60_000 });
  await page.fill('#lg_password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60_000 });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(OBSERVE);
  const page = await ctx.newPage();
  await signIn(page);

  const routes = only.length ? ROUTES.filter(([id]) => only.some((o) => id.includes(o))) : ROUTES;
  const rows: Profile[] = [];
  for (const [id, p] of routes) {
    await profile(page, id, p);                       // warm
    rows.push(await profile(page, id, p));
  }
  await browser.close();

  if (asJson) {
    const out = path.join(process.cwd(), 'tests', 'reports', 'profile.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: BASE, rows }, null, 2));
    console.log(`  written to ${path.relative(process.cwd(), out)}`);
  }

  console.log('\n  route              nodes  depth   svg    html  flight    wire   server  visible  block');
  console.log(`  ${'-'.repeat(95)}`);
  for (const r of [...rows].sort((a, b) => b.nodes - a.nodes)) {
    console.log(
      `  ${r.id.padEnd(17)} ${String(r.nodes).padStart(6)} ${String(r.depth).padStart(6)} `
      + `${String(r.svgs).padStart(5)} ${`${r.htmlRaw}kB`.padStart(7)} ${`${r.flight}kB`.padStart(7)} `
      + `${`${r.htmlWire}kB`.padStart(7)} ${`${r.server}ms`.padStart(8)} ${`${r.visible}ms`.padStart(8)} `
      + `${`${r.blocking}ms`.padStart(6)}`,
    );
  }
  console.log('\n  where the nodes are');
  for (const r of [...rows].sort((a, b) => b.nodes - a.nodes).slice(0, 4)) {
    console.log(`\n    ${r.id}  (${r.nodes} nodes)`);
    for (const h of r.heaviest) console.log(`      ${String(h.nodes).padStart(6)}  ${h.what}`);
  }
  console.log('');
}

if (process.argv[1] && process.argv[1].includes('profile')) main();
