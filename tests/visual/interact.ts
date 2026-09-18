/* ─────────────────────────────────────────────────────────────────────────────
   THE CHARTS, IN A REAL BROWSER

   The reconciliation suites check that a mark points at the right records. They
   cannot check that a person can reach it. That takes a browser: a pointer that
   hovers, a Tab key that lands somewhere visible, an Enter that fires, a finger
   on a phone-sized screen, and a tooltip that stays on the screen when the mark
   is at the edge of it.

     npx tsx tests/visual/interact.ts
     npx tsx tests/visual/interact.ts overview jobs

   It drives the running development server, so start that first. Nothing here
   writes to the database — every drill is a page it can already open.
   ───────────────────────────────────────────────────────────────────────────*/
import { chromium, type Page } from 'playwright';
import { signInProduction, settle } from './drive';

const BASE = process.env.BASE_URL ?? 'http://localhost:3400';

const ROUTES: Array<{ id: string; path: string }> = [
  { id: 'overview', path: '/overview' },
  { id: 'jobs', path: '/jobs' },
  { id: 'job-insights', path: '/jobs/job_01?tab=insights' },
  { id: 'scheduling-load', path: '/scheduling?tab=load' },
  { id: 'team', path: '/team' },
  { id: 'insights-scorecard', path: '/insights?tab=overview' },
  { id: 'insights-sources', path: '/insights?tab=sources' },
  { id: 'insights-tat', path: '/insights?tab=tat' },
  { id: 'insights-departments', path: '/insights?tab=departments' },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const routes = only.length ? ROUTES.filter((r) => only.includes(r.id)) : ROUTES;

const GREEN = '\x1b[32m'; const RED = '\x1b[31m'; const DIM = '\x1b[2m'; const OFF = '\x1b[0m';

let failures = 0;
const check = (okay: boolean, what: string, detail = '') => {
  if (okay) console.log(`    ${GREEN}pass${OFF} ${what}`);
  else { failures += 1; console.log(`    ${RED}FAIL${OFF} ${what}${detail ? `\n         ${detail}` : ''}`); }
};

/* The probes are passed as strings on purpose: an arrow function compiled by
   tsx carries a `__name` helper that does not exist inside the page. */
const evalIn = <T,>(page: Page, body: string): Promise<T> =>
  page.evaluate(body) as Promise<T>;

const COUNT_MARKS = `(() => {
  const marks = Array.from(document.querySelectorAll('.cmk'));
  const acting = marks.filter((m) => m.hasAttribute('data-act'));
  return {
    marks: marks.length,
    acting: acting.length,
    /* A <button> is in the tab order without being told; anything else has to
       be given a tabindex. Both count as reachable. */
    focusable: acting.filter((m) =>
      m.getAttribute('tabindex') === '0'
      || /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(m.tagName)).length,
    named: acting.filter((m) => (m.getAttribute('aria-label') || '').length > 2).length,
    tipped: marks.filter((m) => m.hasAttribute('data-tip')).length,
    nativeTitles: marks.filter((m) => m.querySelector('title') || m.hasAttribute('title')).length,
  };
})()`;

async function probe(page: Page, id: string, path: string) {
  console.log(`\n  ${id}  ${DIM}${path}${OFF}`);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);

  const n = await evalIn<{
    marks: number; acting: number; focusable: number; named: number;
    tipped: number; nativeTitles: number;
  }>(page, COUNT_MARKS);

  check(n.marks > 0, `draws marks (${n.marks})`);
  check(n.tipped === n.marks, 'every mark carries a tooltip',
    `${n.marks - n.tipped} of ${n.marks} have none`);
  check(n.nativeTitles === 0, 'no mark falls back to a browser tooltip',
    `${n.nativeTitles} still carry a <title>`);
  if (!n.acting) {
    console.log(`    ${DIM}no acting mark on this route — nothing to drill${OFF}`);
    return;
  }
  check(n.focusable === n.acting, 'every acting mark is reachable by keyboard',
    `${n.acting - n.focusable} of ${n.acting} are not in the tab order`);
  check(n.named === n.acting, 'every acting mark has an accessible name',
    `${n.acting - n.named} of ${n.acting} are unnamed`);

  /* ── The tooltip, on a pointer ──────────────────────────────────────────── */
  await page.hover('.cmk[data-act]');
  await page.waitForSelector('.ctip', { timeout: 3000 }).catch(() => null);
  const tip = await evalIn<{ shown: boolean; text: string; inside: boolean }>(page, `(() => {
    const t = document.querySelector('.ctip');
    if (!t) return { shown: false, text: '', inside: false };
    const r = t.getBoundingClientRect();
    return {
      shown: true,
      text: (t.textContent || '').trim(),
      inside: r.left >= -1 && r.top >= -1
        && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
    };
  })()`);
  check(tip.shown, 'hovering a mark opens the tooltip');
  check(tip.text.length > 2, 'the tooltip says something', tip.text);
  check(tip.inside, 'the tooltip sits inside the window');

  /* ── And on the keyboard ────────────────────────────────────────────────── */
  await page.mouse.move(0, 0);
  await evalIn(page, `(() => { document.querySelector('.cmk[data-act]').focus(); return 1; })()`);
  await page.waitForTimeout(120);
  const kb = await evalIn<{ tip: boolean; ring: boolean }>(page, `(() => {
    const el = document.activeElement;
    const s = el ? getComputedStyle(el) : null;
    return {
      tip: !!document.querySelector('.ctip'),
      ring: !!s && (s.outlineStyle !== 'none' || s.boxShadow !== 'none'),
    };
  })()`);
  check(kb.tip, 'keyboard focus opens the same tooltip');
  check(kb.ring, 'a focused mark is visibly focused');

  /* Escape closes it, because a tooltip you cannot dismiss is a trap. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  check(!(await evalIn<boolean>(page, `!!document.querySelector('.ctip')`)),
    'Escape closes the tooltip');

  /* ── Enter follows the drill ────────────────────────────────────────────── */
  const before = page.url();
  const target = await evalIn<string>(page, `(() => {
    const el = document.querySelector('.cmk[data-act]');
    el.focus();
    return el.getAttribute('data-v') || '';
  })()`);
  await page.keyboard.press('Enter');
  /* A development server compiles the route it has just been sent to, and the
     first visit can take several seconds. Waiting for the URL rather than for a
     fixed pause is the difference between a real failure and a slow one. */
  await page.waitForURL((u) => u.href !== before, { timeout: 30_000 }).catch(() => {});
  await settle(page);
  const after = page.url();
  check(after !== before, 'Enter on a focused mark follows its drill',
    `still at ${after}`);
  if (target.startsWith('/')) {
    const want = target.split('?')[0];
    check(new URL(after).pathname === want,
      `it lands where the mark said (${want})`, `landed on ${new URL(after).pathname}`);
  }

  /* The list it landed on says what filtered it. */
  const chips = await evalIn<number>(page, `document.querySelectorAll('.cfilter').length`);
  check(chips > 0 || !target.includes('?'), 'the page it lands on says what filtered it');

  /* ── Back returns to the chart ──────────────────────────────────────────── */
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await settle(page);
  check(new URL(page.url()).pathname === new URL(before).pathname,
    'Back returns to the chart');
}

async function touchAndNarrow(page: Page) {
  console.log(`\n  phone  ${DIM}390 × 844, touch${OFF}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' });
  await settle(page);

  const overflow = await evalIn<number>(page,
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check(overflow <= 1, 'nothing spills sideways at 390', `${overflow}px of overflow`);

  /* A tap is a pointer event, so the same delegated listener serves it. What is
     worth checking is that the tooltip it opens is not wider than the phone. */
  const el = await page.$('.cmk[data-act]');
  if (el) {
    await el.tap().catch(async () => { await el.click(); });
    await page.waitForTimeout(250);
    const fits = await evalIn<boolean>(page, `(() => {
      const t = document.querySelector('.ctip');
      if (!t) return true;
      const r = t.getBoundingClientRect();
      return r.left >= -1 && r.right <= window.innerWidth + 1;
    })()`);
    check(fits, 'a tooltip opened by touch fits the screen');
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${BASE}/insights?tab=sources`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const narrow = await evalIn<number>(page,
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check(narrow <= 1, 'nothing spills sideways at 320', `${narrow}px of overflow`);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const wide = await evalIn<number>(page, `document.querySelectorAll('.cmk').length`);
  check(wide > 0, 'the charts still draw at 1920');
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  const page = await context.newPage();

  console.log(`\n  Chart interaction · ${BASE}`);
  await signInProduction(page, BASE, 'light');

  for (const r of routes) {
    try {
      await probe(page, r.id, r.path);
    } catch (e) {
      failures += 1;
      console.log(`    ${RED}FAIL${OFF} ${r.id} threw\n         ${(e as Error).message}`);
    }
  }

  try {
    await touchAndNarrow(page);
  } catch (e) {
    failures += 1;
    console.log(`    ${RED}FAIL${OFF} the narrow pass threw\n         ${(e as Error).message}`);
  }

  await browser.close();
  console.log(failures
    ? `\n  ${RED}${failures} failed${OFF}\n`
    : `\n  ${GREEN}every check passed${OFF}\n`);
  process.exit(failures ? 1 : 0);
}

main();
