import type { Page } from 'playwright';
import { loadEnvFiles } from '../../db/env-files';

/* The harnesses run outside Next, so they load the same environment files it
   would — the database URL for the dataset clock, and the demo password. */
loadEnvFiles();

/* Driving the production application from a test: signing in, and waiting until
   a page has stopped moving. Shared by the screenshot tool, the comparison
   sweep and the route walk, so all three agree about what "loaded" means. */

export const TEST_ACCOUNTS = {
  admin: 'naif.allehaidan@bayut.sa',
  recruiter: 'abdulaziz.alsaloum@bayut.sa',
  coordinator: 'hatoon@bayut.sa',
  onboarding: 'sara@bayut.sa',
  /* The third scope: a recruiter whose access is a hand-picked list of
     requisitions rather than everything or their own. Its queries take a
     different branch, so it is worth walking as well as reading about. */
  picked: 'taif.alshaikhi@bayut.sa',
  /* The portal pass. Abdulrahman heads Operations, carries live requisitions,
     sits on interviews and has joiners on the way, so the portal is not empty
     when it is photographed. */
  hiringManager: 'abdulrahman.alqahtani@bayut.sa',
} as const;

export const TEST_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Bayut-KSA-2026!demo';

/* The instant the reference captures were taken at.

   The prototype's clock is frozen at its dataset's "as of" moment; the seed
   rebases that dataset onto the day it runs, and records where it landed. So
   production is asked to hold its clock to the same instant while it is being
   photographed — otherwise every window boundary on every dashboard drifts by
   however long the test took to start, and the two can never agree exactly.

   This needs ALLOW_TEST_CLOCK=1 in the application's environment; production
   refuses it outright. */
export async function datasetClock(): Promise<string | null> {
  try {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(`SELECT extra->>'datasetClock' AS clock FROM org_settings WHERE id = 'org'`);
    await c.end();
    return r.rows[0]?.clock ?? null;
  } catch {
    return null;
  }
}

export async function signInProduction(
  page: Page,
  base: string,
  theme: 'light' | 'dark' = 'light',
  email: string = TEST_ACCOUNTS.admin,
): Promise<void> {
  /* The theme is a cookie the layout reads before the first paint; the clock is
     one the request reads when the environment allows it. */
  const clock = await datasetClock();
  await page.context().addCookies([
    { name: 'bayut_ta_theme', value: theme, url: base },
    ...(clock ? [{ name: 'bayut_ta_clock', value: clock, url: base }] : []),
  ]);
  await page.goto(`${base}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.fill('#lg_email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#lg_password', { timeout: 15_000 });
  await page.fill('#lg_password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 20_000 });
  await settle(page);

  /* The prototype's captures are frozen at its dataset's instant, so production
     has to be held to the same one or every window boundary on every dashboard
     drifts by however long the run took. The override is fenced to development
     — a production build refuses it by design — and the shell says so with
     `data-clock="held"`. Without it a sweep reports a dozen routes as
     regressions that are nothing of the kind, so this refuses instead. */
  if (clock) {
    const held = await page.locator('#app[data-clock="held"]').count().catch(() => 0);
    if (!held) {
      throw new Error(
        'The application is not holding its clock to the dataset instant, so a comparison '
        + 'against the frozen captures would be meaningless. Run the sweep against '
        + '`npm run dev` with ALLOW_TEST_CLOCK=1 in the environment — a production build '
        + 'refuses the override on purpose (lib/clock.ts).',
      );
    }
  }
}

/** Wait until the view has stopped moving, then freeze what is left. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});
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

  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const s = el as HTMLElement;
      s.style.animationDuration = '0s';
      s.style.transitionDuration = '0s';
    });
  });
  await page.waitForTimeout(80);
}

/* ── Unclip the view, so the capture is the whole page ─────────────────────
   The shell is a fixed-height grid: the body does not scroll, `.view` does.
   A full-page screenshot of that is just the window again, which would mean
   the comparison only ever sees the top of every screen — and a card below
   the fold could rot for months without a test noticing.

   So the scroll container is released just before the shutter: the body grows
   to its content, `.view` stops clipping, and the screenshot is everything the
   page has. Both sides get the same treatment, so the comparison stays fair;
   nothing is written back, and the page is thrown away afterwards. */
const EXPAND_ID = 'bayut-visual-expand';

export async function expand(page: Page): Promise<void> {
  /* One tag, reused. Left to accumulate, the injected rules pile up across a
     run and — worse — the view stays unclipped while the *next* route lays
     itself out, which is not the state a route photographed on its own is in.
     That difference showed up as a page twenty pixels taller in a full run
     than in a filtered one, which is exactly the kind of drift that makes a
     baseline untrustworthy. */
  await collapse(page);
  await page.addStyleTag({
    content: `
      /* ${EXPAND_ID} */
      html, body { height: auto !important; overflow: visible !important; }
      #app { height: auto !important; min-height: 100vh; }
      .main { min-height: 0 !important; }
      .view { overflow: visible !important; height: auto !important; flex: none !important; }
      .side { position: sticky !important; top: 0; align-self: start; max-height: 100vh; }
    `,
  });
  await page.waitForTimeout(160);
}

/** Put the scroll container back, so the next route starts where a solo run would. */
export async function collapse(page: Page): Promise<void> {
  await page.evaluate((mark) => {
    document.querySelectorAll('style').forEach((el) => {
      if (el.textContent?.includes(mark)) el.remove();
    });
    const v = document.querySelector('.view');
    if (v) v.scrollTop = 0;
    window.scrollTo(0, 0);
  }, EXPAND_ID).catch(() => {});
}
