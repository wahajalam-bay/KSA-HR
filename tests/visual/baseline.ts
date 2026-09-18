/* ─────────────────────────────────────────────────────────────────────────────
   Capture the reference.

   Opens the single-file prototype in a headless browser, signs in, walks every
   route at three widths in both themes, and writes a PNG per capture. The
   prototype is opened read-only; the overlay it keeps in local storage is
   cleared between themes so one run cannot affect the next.

     npm run visual:baseline
     npm run visual:baseline -- jobs        only the captures whose id matches
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { CAPTURES, VIEWPORTS, THEMES } from './config';
import { prototypeUrl } from './prototype';
import { expand, collapse } from './drive';
import { loadEnvFiles } from '../../db/env-files';

loadEnvFiles();

const PROTOTYPE = process.env.PROTOTYPE_HTML
  ?? path.resolve(process.cwd(), '..', 'Bayut-TA-CRM-v30', 'Bayut-TA-CRM.html');
const OUT = path.join(process.cwd(), 'tests', 'visual', 'baseline');
/* Every route in this product is taller than this; anything shorter is a
   page that did not finish rendering. */
const MIN_PAGE_HEIGHT = 600;
const DEMO_PASSWORD = 'bayut2026';
/* The account the portal captures are taken from — see TEST_ACCOUNTS in
   drive.ts, which uses the same person on the production side. */
const PORTAL_ACCOUNT = 'abdulrahman.alqahtani@bayut.sa';

const filter = process.argv[2];

/* A filtered run is for looking at one route while working on it. The stored
   baseline is always taken from a full sweep, because a few routes measure a
   line differently depending on what the browser rendered before them, and the
   comparison only holds if both sides walk the same road. */
if (filter) {
  process.stdout.write([
    '',
    `  Capturing only "${filter}". Re-run without a filter before trusting the stored`,
    '  baseline: a partial sweep is for inspection, not for the record.',
    '',
  ].join('\n'));
}

/* One capture, checked before it is stored.
   A baseline that silently came out blank is worse than a missing one: the
   comparison then measures the production screen against an empty page and
   calls a working route a 62% regression. It happened once — a route whose
   sign-in had not finished — and cost an afternoon, so a capture is now
   photographed only when the application is actually on the screen, and a
   suspiciously short page is retried before it is believed. */
async function shoot(page: Page, file: string, label: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ready = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const login = document.querySelector('#login');
      return {
        onScreen: !!app && !(app as HTMLElement).hidden,
        stillSigningIn: !!login && !(login as HTMLElement).hidden,
        height: document.documentElement.scrollHeight,
      };
    });
    if (ready.onScreen && !ready.stillSigningIn && ready.height >= MIN_PAGE_HEIGHT) break;
    if (attempt === 2) {
      throw new Error(
        `${label} would not render (height ${ready.height}px, `
        + `${ready.stillSigningIn ? 'still on the sign-in screen' : 'no application on the page'}). `
        + 'Nothing was written — the stale baseline is better than an empty one.',
      );
    }
    await page.reload({ waitUntil: 'load' });
    await settle(page);
    await signIn(page);
    await settle(page);
  }
  await expand(page);
  await page.screenshot({ path: file, fullPage: true });
  await collapse(page);
}

async function main() {
  if (!fs.existsSync(PROTOTYPE)) {
    throw new Error(`The prototype was not found at ${PROTOTYPE}. Set PROTOTYPE_HTML.`);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  /* The reference is opened on production's calendar — see prototype.ts. */
  const url = await prototypeUrl(PROTOTYPE);
  let n = 0;

  try {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: theme,
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'load' });
        await settle(page);
        await signIn(page);
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

        for (const cap of CAPTURES) {
          if (filter && !cap.id.includes(filter)) continue;
          if (cap.id === 'sign-in') continue;   // captured below, before signing in
          if (cap.as === 'hiring_manager') continue;   // its own pass, below
          /* Every route is photographed from a fresh load rather than by
             changing the hash on the page the last one left behind. Walking
             the hash is faster, but it carried something over: the same route
             came out twenty pixels taller inside a full run than on its own,
             which is the kind of drift that makes a baseline worth less than
             no baseline. The session survives the reload, so the cost is one
             parse of the file and the reference is the same every time. */
          await page.goto(`${url}${cap.proto}`, { waitUntil: 'load' });
          await settle(page);
          await signIn(page);
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await settle(page);
          const file = path.join(OUT, `${cap.id}--${vp.name}--${theme}.png`);
          await shoot(page, file, `${cap.id} ${vp.name} ${theme}`);
          n++;
          process.stdout.write(`  ${cap.id} ${vp.name} ${theme}\n`);
        }

        /* The portal, from a hiring manager's own session. */
        const portal = CAPTURES.filter((c) => c.as === 'hiring_manager'
          && (!filter || c.id.includes(filter)));
        if (portal.length) {
          const pctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce',
          });
          const ppage = await pctx.newPage();
          for (const cap of portal) {
            await ppage.goto(`${url}${cap.proto}`, { waitUntil: 'load' });
            await settle(ppage);
            await signIn(ppage, PORTAL_ACCOUNT);
            await ppage.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
            await settle(ppage);
            await shoot(
              ppage,
              path.join(OUT, `${cap.id}--${vp.name}--${theme}.png`),
              `${cap.id} ${vp.name} ${theme}`,
            );
            n++;
            process.stdout.write(`  ${cap.id} ${vp.name} ${theme}\n`);
          }
          await pctx.close();
        }

        /* The sign-in screen, from a clean context. */
        if (!filter || 'sign-in'.includes(filter)) {
          const fresh = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            colorScheme: theme, reducedMotion: 'reduce',
          });
          const p2 = await fresh.newPage();
          await p2.goto(url, { waitUntil: 'load' });
          await settle(p2);
          await p2.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await expand(p2);
          await p2.screenshot({ path: path.join(OUT, `sign-in--${vp.name}--${theme}.png`), fullPage: true });
          await fresh.close();
          n++;
        }

        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n  ${n} baseline captures in tests/visual/baseline\n`);
}

/* The prototype opens on its sign-in screen; the four demo accounts all use the
   same password, which it prints on the page itself. */
async function signIn(page: Page, email = 'naif.allehaidan@bayut.sa') {
  const emailField = page.locator('#login [name="email"]');
  if (!(await emailField.count())) return;
  await emailField.fill(email);
  await page.locator('#login [data-act="auth.email"]').click();
  await page.waitForTimeout(150);
  const pw = page.locator('#login [name="pw"]');
  if (await pw.count()) {
    await pw.fill(DEMO_PASSWORD);
    await page.locator('#login [data-act="auth.signin"]').click();
  }
  await page.waitForSelector('#app:not([hidden])', { timeout: 10_000 });
  await settle(page);
}

/* Wait for the view to stop moving: fonts loaded, charts hydrated, the entrance
   animations finished. Without this the same route photographs differently
   twice in a row and every comparison is noise. */
async function settle(page: Page) {
  await page.waitForTimeout(120);
  /* Load every declared face, not just the ones this route happens to use.
     `document.fonts.ready` only waits for what has been requested, so a page
     visited after a heavier one measures differently from the same page
     visited first: the weight it needs is already in the context's cache.
     That is what made one route twenty pixels taller inside a full run than
     on its own. Loading the whole set first takes the order out of it. */
  await page.evaluate(async () => {
    const fonts = (document as any).fonts;
    if (!fonts) return;
    await Promise.all([...fonts].map((f: any) => f.load().catch(() => {})));
    await fonts.ready;
  }).catch(() => {});

  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const s = el as HTMLElement;
      s.style.animationDuration = '0s';
      s.style.transitionDuration = '0s';
    });
  });
  await page.waitForTimeout(80);
}

main().catch((e) => { console.error(e); process.exit(1); });
