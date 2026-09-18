/* ─────────────────────────────────────────────────────────────────────────────
   Put one element from the prototype next to the same element in production.

   A percentage tells you a capture is wrong; it does not tell you why. This
   opens both the prototype and the running application on the same route,
   finds the same selector in each, and prints the markup, the box and the
   computed type for the first few children. Nine times out of ten the answer —
   a missing class, an extra wrapper, a margin that does not collapse — is
   visible in the first ten lines.

     npx tsx tests/visual/probe.ts job-activity ".tl li"
     npx tsx tests/visual/probe.ts job-insights ".card" --index 2
     npx tsx tests/visual/probe.ts overview ".hero" --all

   `--all` prints every match rather than one, `--index n` picks the nth,
   `--as hiringManager` opens both sides as somebody else, which a capture
   marked for the portal does by itself. `--text` prints the element's rows
   instead of its markup — the way to read
   one table against the other — `--expand` unclips the view the way the camera
   does, so a box measured here is the box that was photographed, and
   `--theme dark` / `--width 900` photograph the other layouts.
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { CAPTURES } from './config';
import { signInProduction, settle, expand, TEST_ACCOUNTS } from './drive';
import { prototypeUrl } from './prototype';

const PROTOTYPE = process.env.PROTOTYPE_HTML
  ?? path.resolve(process.cwd(), '..', 'Bayut-TA-CRM-v30', 'Bayut-TA-CRM.html');
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:3400';
const DEMO_PASSWORD = 'bayut2026';

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] ?? fallback : fallback;
};
const has = (name: string) => argv.includes(`--${name}`) || process.env[`PROBE_${name.toUpperCase()}`] === '1';

const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const captureId = positional[0];
const selector = positional[1] ?? '.card';
const index = Number(flag('index', '0'));
const width = Number(flag('width', '1440'));
const theme = (flag('theme', 'light') as 'light' | 'dark');
/* Who to open both sides as. A capture marked `as: 'hiring_manager'` is
   photographed from that person's session, so probing it from the desk's would
   compare two different products. */
const account = (flag('as', '') || '') as keyof typeof TEST_ACCOUNTS | '';

if (!captureId) {
  console.error('  Usage: npx tsx tests/visual/probe.ts <capture-id> "<selector>" [--index n] [--all] [--width 900] [--theme dark]');
  process.exit(1);
}
const cap = CAPTURES.find((c) => c.id === captureId);
if (!cap) {
  console.error(`  No capture called "${captureId}". Known: ${CAPTURES.map((c) => c.id).join(', ')}`);
  process.exit(1);
}

/* The page-side half runs as source text rather than as a compiled closure:
   the TypeScript loader renames inner functions and injects a helper that does
   not exist inside the browser, and a probe that cannot run is no use. */
const INSPECT = `(({ sel, which, all, rules, text }) => {
  const describe = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cls = (typeof el.className === 'string' ? el.className : '').trim().replace(/\\s+/g, '.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + '  '
      + r.width.toFixed(0) + '×' + r.height.toFixed(1) + '  '
      + 'font ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight + '  '
      + 'm ' + cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft + '  '
      + 'p ' + cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft + '  '
      + cs.display + (cs.gap !== 'normal' ? ' gap ' + cs.gap : '')
      + '  top ' + r.top.toFixed(1) + ' bottom ' + r.bottom.toFixed(1)
      + (el.childNodes.length ? '  nodes ' + Array.from(el.childNodes).map((n) =>
          n.nodeType === 3 ? 'text(' + JSON.stringify(n.nodeValue) + ')'
          : n.nodeType === 8 ? 'comment' : n.nodeName.toLowerCase()).join(',') : '');
  };
  const matching = (el) => {
    const out = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let top; try { top = sheet.cssRules; } catch (e) { continue; }
      const walk = (rs) => { for (const r of Array.from(rs || [])) {
        if (r.cssRules) { walk(r.cssRules); continue; }
        if (!r.selectorText) continue;
        for (const one of r.selectorText.split(',')) {
          try { if (el.matches(one.trim())) { out.push(one.trim() + ' { ' + r.style.cssText + ' }'); break; } } catch (e) {}
        }
      } };
      walk(top);
    }
    return out;
  };
  /* Row text, for when the box is right and the contents are not: each direct
     child on a line of its own, its cells joined by pipes, so two tables can be
     read against each other line by line. */
  const lines = (el) => Array.from(el.children).map((r) => {
    const cells = Array.from(r.children);
    const t = (n) => (n.textContent || '').replace(/\\s+/g, ' ').trim();
    return (cells.length ? cells.map(t).join(' | ') : t(r)).slice(0, 200);
  });
  const list = Array.from(document.querySelectorAll(sel));
  const picked = all ? list : list.slice(which, which + 1);
  return picked.map((el) => ({
    html: el.outerHTML.length > 1600 ? el.outerHTML.slice(0, 1600) + ' …' : el.outerHTML,
    box: describe(el),
    children: Array.from(el.querySelectorAll('*')).slice(0, 12).map(describe),
    rules: rules ? matching(el) : [],
    lines: text ? lines(el) : [],
  }));
})`;

type Found = {
  html: string; box: string; children: string[]; rules: string[]; lines: string[];
};

async function inspect(page: Page, sel: string, which: number, all: boolean): Promise<Found[]> {
  return page.evaluate(
    `${INSPECT}(${JSON.stringify({ sel, which, all, rules: has('rules'), text: has('text') })})`,
  ) as Promise<Found[]>;
}

function print(label: string, found: Found[]) {
  console.log(`\n  ══ ${label} ${'═'.repeat(Math.max(0, 68 - label.length))}`);
  if (!found.length) { console.log('     nothing matched'); return; }
  found.forEach((f, i) => {
    if (found.length > 1) console.log(`\n   [${i}]`);
    console.log(`   ${f.box}`);
    if (!has('text')) console.log(f.html.split('\n').map((l) => '   │ ' + l).join('\n'));
    f.children.forEach((c) => console.log('     · ' + c));
    f.rules.forEach((r) => console.log('     ⟨ ' + r));
    f.lines.forEach((l, n) => console.log(`     ${String(n).padStart(3)} ${l}`));
  });
}

async function main() {
  if (!fs.existsSync(PROTOTYPE)) throw new Error(`The prototype was not found at ${PROTOTYPE}.`);
  /* The capture says whose product it is; --as overrides it. */
  const who = account ? TEST_ACCOUNTS[account]
    : cap!.as === 'hiring_manager' ? TEST_ACCOUNTS.hiringManager
      : TEST_ACCOUNTS.admin;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1,
  });

  try {
    const proto = await ctx.newPage();
    await proto.goto(await prototypeUrl(PROTOTYPE), { waitUntil: 'load' });
    await proto.waitForTimeout(400);
    const email = proto.locator('#login [name="email"]');
    if (await email.count()) {
      await email.fill(who);
      await proto.locator('#login [data-act="auth.email"]').click();
      await proto.waitForTimeout(200);
      const pw = proto.locator('#login [name="pw"]');
      if (await pw.count()) {
        await pw.fill(DEMO_PASSWORD);
        await proto.locator('#login [data-act="auth.signin"]').click();
      }
      await proto.waitForSelector('#app:not([hidden])', { timeout: 10_000 });
    }
    await proto.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await proto.evaluate((h) => { location.hash = h; }, cap!.proto);
    await settle(proto);
    if (has('expand')) await expand(proto);
    print('PROTOTYPE', await inspect(proto, selector, index, has('all')));

    const prod = await ctx.newPage();
    await signInProduction(prod, BASE, theme, who);
    await prod.goto(BASE + cap!.prod, { waitUntil: 'domcontentloaded' });
    await settle(prod);
    if (has('expand')) await expand(prod);
    print('PRODUCTION', await inspect(prod, selector, index, has('all')));
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
