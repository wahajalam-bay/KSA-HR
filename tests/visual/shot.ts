/* One screenshot of the running application, for looking at a page while
   building it. The full sweep is compare.ts.

     npx tsx tests/visual/shot.ts /jobs 1440 light [out.png]
   ───────────────────────────────────────────────────────────────────────────*/
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { signInProduction, settle } from './drive';

const route = process.argv[2] ?? '/overview';
const width = Number(process.argv[3] ?? 1440);
const theme = (process.argv[4] ?? 'light') as 'light' | 'dark';
const out = process.argv[5] ?? path.join(process.cwd(), 'tests', 'visual', 'out', 'shot.png');
const base = process.env.APP_URL ?? 'http://127.0.0.1:3400';
const full = process.env.FULL_PAGE === '1';

async function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 1440 ? 1000 : width >= 900 ? 1000 : 844 },
    colorScheme: theme, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await signInProduction(page, base, theme);
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot({ path: out, fullPage: full });
  await browser.close();

  console.log(`  ${out}`);
  if (errors.length) {
    console.log(`\n  ${errors.length} console error(s):`);
    for (const e of errors.slice(0, 8)) console.log(`    ${e.slice(0, 200)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
