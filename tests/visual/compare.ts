/* ─────────────────────────────────────────────────────────────────────────────
   Measure the production interface against the prototype.

   Drives the running application through the same routes at the same three
   widths in both themes, compares each capture with the baseline taken from the
   prototype, and prints the share of pixels that differ. A capture over its
   tolerance is a regression and fails the run; one with a reason recorded in
   KNOWN_DIFFERENCES is reported with that reason and does not fail.

     npm run visual:compare
     npm run visual:compare -- jobs         only the captures whose id matches
     npm run visual:compare -- --write      also write the diff images
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { CAPTURES, VIEWPORTS, THEMES, DEFAULT_TOLERANCE, KNOWN_DIFFERENCES } from './config';
import { signInProduction, settle, expand, collapse, TEST_ACCOUNTS } from './drive';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:3400';
const OUT = path.join(process.cwd(), 'tests', 'visual', 'out');
const DIFF = path.join(process.cwd(), 'tests', 'visual', 'diff');

/* ══════════════════════════════════════════════════════════════════════════════
   TWO FAMILIES OF BASELINE

   `prototype` is the single-file prototype, photographed once. It is the
   specification and it is historical evidence of what was asked for, so nothing
   in this repository writes to it — the guard below refuses even when told to.
   Compare against it to answer "does this still look like what we agreed".

   `current` is the branded application as it stands. Compare against it to
   answer a different and equally important question: "has anything moved that
   nobody meant to move" — which is what catches a hover rule leaking into the
   resting state, or a chart that now sits two pixels lower on every page.

     npm run visual:compare                  against the prototype
     npm run visual:compare -- --against=current
     npm run visual:adopt                    record the current family
   ═════════════════════════════════════════════════════════════════════════════ */

const FAMILIES = {
  prototype: { dir: 'baseline', writable: false },
  current: { dir: 'current', writable: true },
} as const;
type Family = keyof typeof FAMILIES;

const args = process.argv.slice(2);
/* Any number of ids or fragments: `compare.ts insights-ask insights-sources`
   photographs just those two rather than the whole book. */
const filters = args.filter((a) => !a.startsWith('--')).flatMap((a) => a.split(','));
const wanted = (id: string) => !filters.length || filters.some((f) => id.includes(f));
const writeDiff = args.includes('--write');

const familyArg = (args.find((a) => a.startsWith('--against='))?.split('=')[1] ?? 'prototype') as Family;
if (!(familyArg in FAMILIES)) {
  console.error(`  --against must be one of: ${Object.keys(FAMILIES).join(', ')}`);
  process.exit(1);
}
const FAMILY: Family = familyArg;
const BASELINE = path.join(process.cwd(), 'tests', 'visual', FAMILIES[FAMILY].dir);

/* Adopting copies what was just photographed into the family, so the next run
   measures against it. The prototype is never a target: it records what was
   asked for, and a specification that quietly follows the implementation is not
   a specification. */
const adopt = args.includes('--adopt');
if (adopt && !FAMILIES[FAMILY].writable) {
  console.error('  The prototype baselines are reference evidence and are never overwritten.');
  console.error('  Adopt into the current family instead: --against=current --adopt');
  process.exit(1);
}

/* Against its own family a capture should be identical; only anti-aliasing
   moves, and the per-channel tolerance in `diff` already absorbs that. */
const toleranceFor = (cap?: number) => (FAMILY === 'current' ? 0.0005 : cap ?? DEFAULT_TOLERANCE);

type Result = {
  id: string; viewport: string; theme: string;
  pct: number | null; note?: string; known?: string; errors: string[];
  tolerance?: number;
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (writeDiff) fs.mkdirSync(DIFF, { recursive: true });

  const browser = await chromium.launch();
  const results: Result[] = [];

  try {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1,
        });
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(e.message));

        /* The sign-in screen is captured before signing in. */
        if (wanted('sign-in')) {
          await page.context().addCookies([{ name: 'bayut_ta_theme', value: theme, url: BASE }]);
          await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
          await settle(page);
          results.push(await capture(page, 'sign-in', vp.name, theme, errors.splice(0)));
        }

        await signInProduction(page, BASE, theme, TEST_ACCOUNTS.admin);
        errors.length = 0;

        for (const cap of CAPTURES) {
          if (cap.id === 'sign-in') continue;
          if (!wanted(cap.id)) continue;
          if (cap.as === 'hiring_manager') continue;    // captured in its own pass
          /* A route that will not load is a result, not the end of the run: one
             unbuilt page used to abandon every capture behind it, which is the
             opposite of what a parity report is for. */
          try {
            await page.goto(BASE + cap.prod, { waitUntil: 'domcontentloaded' });
          } catch (e) {
            results.push({
              id: cap.id, viewport: vp.name, theme, pct: null, note: 'did not load',
              errors: [...errors.splice(0), e instanceof Error ? e.message.split('\n')[0] : String(e)],
            });
            continue;
          }
          await settle(page);
          results.push(await capture(page, cap.id, vp.name, theme, errors.splice(0), cap.tolerance));
        }
        /* The portal is a different product for a different account, so it is
           photographed from its own session rather than from the desk's. */
        const portal = CAPTURES.filter((c) => c.as === 'hiring_manager' && wanted(c.id));
        if (portal.length) {
          const pctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1,
          });
          const ppage = await pctx.newPage();
          const perrors: string[] = [];
          ppage.on('console', (m) => { if (m.type() === 'error') perrors.push(m.text()); });
          ppage.on('pageerror', (e) => perrors.push(e.message));
          await signInProduction(ppage, BASE, theme, TEST_ACCOUNTS.hiringManager);
          perrors.length = 0;
          for (const cap of portal) {
            try {
              await ppage.goto(BASE + cap.prod, { waitUntil: 'domcontentloaded' });
            } catch (e) {
              results.push({
                id: cap.id, viewport: vp.name, theme, pct: null, note: 'did not load',
                errors: [...perrors.splice(0), e instanceof Error ? e.message.split('\n')[0] : String(e)],
              });
              continue;
            }
            await settle(ppage);
            results.push(await capture(ppage, cap.id, vp.name, theme, perrors.splice(0), cap.tolerance));
          }
          await pctx.close();
        }

        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }

  report(results);
}

async function capture(
  page: Page, id: string, vp: string, theme: string, errors: string[], tolerance?: number,
): Promise<Result> {
  const name = `${id}--${vp}--${theme}.png`;
  const shot = path.join(OUT, name);
  await expand(page);
  await page.screenshot({ path: shot, fullPage: true });
  await collapse(page);

  const base = path.join(BASELINE, name);
  if (adopt) {
    fs.mkdirSync(BASELINE, { recursive: true });
    fs.copyFileSync(shot, base);
    return { id, viewport: vp, theme, pct: 0, note: 'adopted', errors };
  }
  if (!fs.existsSync(base)) {
    return { id, viewport: vp, theme, pct: null, note: 'no baseline', errors };
  }
  const { pct, note } = diff(base, shot, writeDiff ? path.join(DIFF, name) : null);
  return {
    id, viewport: vp, theme, pct, note,
    /* A difference from the prototype can be a decision somebody recorded. A
       difference from the current family is always a change nobody asked for,
       so nothing excuses one. */
    known: FAMILY === 'prototype' ? KNOWN_DIFFERENCES[id] : undefined,
    errors,
    tolerance: toleranceFor(tolerance),
  };
}

/* A plain per-pixel comparison with a small tolerance per channel. Anti-aliasing
   on text moves a pixel by a few units, and counting that as a difference would
   make every capture fail for no reason anybody cares about.

   The captures are of the whole page, not the visible window: a card below the
   fold is still part of the product. Two pages of different heights are compared
   over the rows they share, and every row only one of them has is counted as
   differing — so a missing card reads as a large number rather than as a flat
   100% that says nothing about the rest. */
function diff(aPath: string, bPath: string, outPath: string | null): { pct: number; note?: string } {
  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));
  if (a.width !== b.width) return { pct: 1, note: `width ${a.width} vs ${b.width}` };

  const w = a.width;
  const shared = Math.min(a.height, b.height);
  const tallest = Math.max(a.height, b.height);
  const out = outPath ? new PNG({ width: w, height: tallest }) : null;

  let differing = (tallest - shared) * w;
  for (let y = 0; y < shared; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const dr = Math.abs(a.data[k] - b.data[k]);
      const dg = Math.abs(a.data[k + 1] - b.data[k + 1]);
      const db = Math.abs(a.data[k + 2] - b.data[k + 2]);
      const off = dr > 24 || dg > 24 || db > 24;
      if (off) differing++;
      if (out) {
        out.data[k] = off ? 255 : Math.round(b.data[k] * 0.25 + 191);
        out.data[k + 1] = off ? 40 : Math.round(b.data[k + 1] * 0.25 + 191);
        out.data[k + 2] = off ? 40 : Math.round(b.data[k + 2] * 0.25 + 191);
        out.data[k + 3] = 255;
      }
    }
  }
  if (out) {
    for (let y = shared; y < tallest; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        out.data[k] = 255; out.data[k + 1] = 40; out.data[k + 2] = 40; out.data[k + 3] = 255;
      }
    }
    if (outPath) fs.writeFileSync(outPath, PNG.sync.write(out));
  }
  const note = a.height === b.height ? undefined
    : `${b.height > a.height ? b.height - a.height : a.height - b.height}px ${b.height > a.height ? 'taller' : 'shorter'} than the baseline`;
  return { pct: differing / (w * tallest), note };
}

function report(results: Result[]) {
  const rows = results.filter((r) => r.pct != null);
  const missing = results.filter((r) => r.pct == null);
  const failures: Result[] = [];

  /* One line per capture id, with the worst of its six. */
  const byId = new Map<string, Result[]>();
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);

  if (adopt) {
    console.log(`\n  ${rows.length} capture(s) recorded as the ${FAMILY} family\n`);
    process.exit(0);
  }

  console.log(`\n  Visual parity against the ${FAMILY}\n`);
  console.log('  route                      worst   where                 verdict');
  console.log('  ' + '─'.repeat(78));

  for (const [id, list] of [...byId.entries()].sort()) {
    const worst = list.reduce((a, b) => ((b.pct ?? 0) > (a.pct ?? 0) ? b : a));
    const pct = worst.pct ?? 0;
    const tol = worst.tolerance ?? DEFAULT_TOLERANCE;
    const known = worst.known;
    const ok = pct <= tol;
    if (!ok && !known) failures.push(worst);
    const verdict = ok ? 'match' : known ? 'expected' : 'REGRESSION';
    console.log(
      `  ${id.padEnd(26)} ${(pct * 100).toFixed(2).padStart(5)}%  ` +
      `${`${worst.viewport} ${worst.theme}`.padEnd(20)} ${verdict}`,
    );
    if (!ok && known) console.log(`      ${known}`);
    if (!ok && worst.note) console.log(`      ${worst.note}`);
  }

  const withErrors = results.filter((r) => r.errors.length);
  if (withErrors.length) {
    console.log('\n  Console errors');
    for (const r of withErrors) {
      console.log(`    ${r.id} ${r.viewport} ${r.theme}`);
      for (const e of r.errors.slice(0, 3)) console.log(`      ${e.slice(0, 160)}`);
    }
  }

  if (missing.length) {
    console.log(`\n  ${missing.length} capture(s) had no baseline — run npm run visual:baseline`);
  }

  const matched = byId.size - failures.length;
  const headline = FAMILY === 'current'
    ? `\n  ${matched} of ${byId.size} routes are pixel-for-pixel what they were`
    : `\n  ${matched} of ${byId.size} routes within ${(DEFAULT_TOLERANCE * 100).toFixed(0)}% of the prototype`;
  console.log(headline);
  if (withErrors.length) console.log(`  ${withErrors.length} capture(s) logged a console error`);
  console.log('');

  /* The run leaves a report behind: a long sweep scrolls off a terminal, and the
     parity numbers are one of the things this project has to be able to show. */
  const report = {
    at: new Date().toISOString(),
    family: FAMILY,
    tolerance: toleranceFor(),
    matched,
    total: byId.size,
    routes: [...byId.entries()].sort().map(([id, list]) => {
      const worst = list.reduce((a, b) => ((b.pct ?? 0) > (a.pct ?? 0) ? b : a));
      return {
        id,
        worst: worst.pct,
        where: `${worst.viewport} ${worst.theme}`,
        note: worst.note ?? null,
        known: worst.known ?? null,
        ok: (worst.pct ?? 0) <= (worst.tolerance ?? DEFAULT_TOLERANCE),
        captures: list.map((r) => ({ viewport: r.viewport, theme: r.theme, pct: r.pct, note: r.note ?? null })),
      };
    }),
    missing: missing.map((r) => `${r.id} ${r.viewport} ${r.theme}`),
    consoleErrors: withErrors.map((r) => ({ id: r.id, viewport: r.viewport, theme: r.theme, errors: r.errors.slice(0, 5) })),
  };
  fs.mkdirSync(path.join(process.cwd(), 'tests', 'reports'), { recursive: true });
  const file = path.join(process.cwd(), 'tests', 'reports',
    FAMILY === 'current' ? 'visual-current.json' : 'visual.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`  report written to ${path.relative(process.cwd(), file)}
`);

  process.exit(failures.length || withErrors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
