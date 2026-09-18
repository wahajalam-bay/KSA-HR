import { chromium, type ConsoleMessage, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { CAPTURES } from './visual/config';
import { TEST_ACCOUNTS, signInProduction, settle } from './visual/drive';

/* ═════════════════════════════════════════════════════════════════════════════
   THE ROUTE WALK

   Every route in the product, loaded for real, as each of the six kinds of
   person who uses it. Not a screenshot comparison — that is
   `npm run visual:compare` — but the cheaper question underneath it: did the
   page render at all, and is there anything on it that should never reach a
   person?

   Five things fail a route:

     · an error boundary, a stack trace or a Next.js error overlay;
     · `[object Object]`, `NaN`, `undefined` or `null` printed as text, which is
       what a template reaching for a field that moved looks like;
     · an unreplaced `{{merge_field}}`, which is a letter nobody filled in;
     · a console error from the page itself;
     · an HTTP status that is not 200 — or a redirect to /sign-in, which means
       the session was not established.

   A page a role may not see is expected to redirect or to say so politely, so
   a route is walked per role and each role's outcome is recorded separately:
   a hiring manager bounced off Settings is right, and a hiring manager shown a
   stack trace is not.

     npm run walk                 every route, every role
     npm run walk -- overview     the routes whose id matches
     npm run walk -- --role=admin one role

   The dev server (or `npm start`) has to be up on the port in BASE. Each route
   compiles on first hit in development, so a full walk takes a few minutes.
   ═════════════════════════════════════════════════════════════════════════════*/

const BASE = process.env.WALK_BASE ?? 'http://127.0.0.1:3400';
const argv = process.argv.slice(2);
const filters = argv.filter((a) => !a.startsWith('--'));
const roleArg = argv.find((a) => a.startsWith('--role='))?.slice(7);

type Role = keyof typeof TEST_ACCOUNTS;

/* Who walks, and what each of them is expected to be able to reach. The portal
   roles see their own corner of the product and nothing else, which is the
   point of the scope rules — so a redirect is a pass for them, and only for
   them. */
const ROLES: Array<{ role: Role; portal: boolean }> = [
  { role: 'admin', portal: false },
  { role: 'recruiter', portal: false },
  { role: 'picked', portal: false },
  { role: 'coordinator', portal: false },
  { role: 'onboarding', portal: false },
  { role: 'hiringManager', portal: true },
];

/* Two routes are *about* merge fields — the templates tab lists the ones a
   letter may use, and the pitch tab shows the message a candidate is sent
   before it is filled in. Printing `{{first_name}}` there is the page working.
   Everywhere else it is a letter nobody filled in. */
const MERGE_IS_DOCUMENTATION = new Set(['settings-templates', 'settings-pitch']);

const BAD_TEXT: Array<[RegExp, string]> = [
  [/\[object Object\]/, 'printed [object Object]'],
  [/\bundefined\b/, 'printed the word undefined'],
  [/(?<![\w-])NaN(?![\w-])/, 'printed NaN'],
  [/\{\{[a-z0-9_]+\}\}/i, 'left a merge field unreplaced'],
  [/Application error: a (?:client|server)-side exception/i, 'showed an error boundary'],
  [/Unhandled Runtime Error|Server Components render/i, 'showed a Next.js error overlay'],
  [/at (?:async )?\w+ \(.*\.(?:tsx?|js):\d+:\d+\)/, 'printed a stack trace'],
];

/* Words that legitimately contain a banned string. `undefined` is the awkward
   one: the audit trail and the data panel both talk about columns, and a
   settings page may name a field that is undefined by design. */
const EXCUSED: Array<[RegExp, string]> = [
  [/is undefined by design/i, 'printed the word undefined'],
  [/undefined behaviour/i, 'printed the word undefined'],
];

type Finding = { role: Role; id: string; why: string; detail?: string };

const findings: Finding[] = [];
const walked: string[] = [];
const retried: string[] = [];

function checkText(role: Role, id: string, text: string): void {
  for (const [re, why] of BAD_TEXT) {
    if (why === 'left a merge field unreplaced' && MERGE_IS_DOCUMENTATION.has(id)) continue;
    const m = re.exec(text);
    if (!m) continue;
    if (EXCUSED.some(([ex, exWhy]) => exWhy === why && ex.test(text))) continue;
    const at = Math.max(0, m.index - 60);
    findings.push({
      role, id, why,
      detail: text.slice(at, m.index + m[0].length + 60).replace(/\s+/g, ' ').trim(),
    });
    return;
  }
}

/* The development server restarts when it crosses its memory threshold, and a
   route that was mid-flight comes back as a suspended socket or a timeout —
   which is the harness's environment, not the page. So a transport failure is
   given one more go, and only a second failure is a finding. A real defect
   fails both times. */
const TRANSPORT = /ERR_NETWORK_IO_SUSPENDED|ERR_CONNECTION_(?:REFUSED|RESET|CLOSED)|ERR_EMPTY_RESPONSE|Timeout \d+ms exceeded|socket hang up/i;

async function walkOne(
  page: Page, role: Role, portal: boolean, id: string, route: string, attempt = 1,
): Promise<void> {
  const errors: string[] = [];
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    /* Noise from the harness's own environment rather than from the product:
       a favicon or a font that 404s, and the development hot-reload socket,
       which does not exist in a production build and drops whenever the dev
       server recompiles. */
    if (/favicon|Failed to load resource/.test(text)) return;
    if (/webpack-hmr|_next\/static\/(?:chunks|development)/.test(text)) return;
    errors.push(text);
  };
  page.on('console', onConsole);

  try {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const status = res?.status() ?? 0;
    if (status >= 400) {
      findings.push({ role, id, why: `returned HTTP ${status}` });
      return;
    }
    await settle(page);

    if (new URL(page.url()).pathname.startsWith('/sign-in')) {
      /* A portal role sent back to sign-in is a bug in either case: a scope
         refusal shows the product with a message in it, not the door. */
      findings.push({ role, id, why: 'was sent back to sign-in' });
      return;
    }

    const text = (await page.evaluate(() => document.body.innerText)) ?? '';
    checkText(role, id, text);

    /* Something has to be on the page. An empty shell is a page that threw
       above the fold and recovered into nothing. */
    if (text.trim().length < 40) {
      findings.push({ role, id, why: 'rendered almost nothing', detail: text.trim() });
    }

    if (errors.length) {
      if (attempt === 1 && errors.some((x) => TRANSPORT.test(x))) {
        page.off('console', onConsole);
        await page.waitForTimeout(4_000);
        retried.push(`${role}:${id}`);
        await walkOne(page, role, portal, id, route, 2);
        return;
      }
      findings.push({ role, id, why: 'logged a console error', detail: errors[0].slice(0, 200) });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    if (attempt === 1 && TRANSPORT.test(message)) {
      page.off('console', onConsole);
      await page.waitForTimeout(4_000);
      retried.push(`${role}:${id}`);
      await walkOne(page, role, portal, id, route, 2);
      return;
    }
    findings.push({ role, id, why: 'did not load', detail: message });
  } finally {
    page.off('console', onConsole);
    walked.push(`${role}:${id}`);
  }
}

async function main(): Promise<void> {
  const routes = CAPTURES
    .filter((c) => c.prod !== '/sign-in')
    .filter((c) => !filters.length || filters.some((f) => c.id.includes(f)));
  const roles = ROLES.filter((r) => !roleArg || r.role === roleArg);

  if (!routes.length) {
    console.error('no route matches that filter');
    process.exit(2);
  }

  const browser = await chromium.launch();
  console.log(`\n  walking ${routes.length} route${routes.length === 1 ? '' : 's'} `
    + `as ${roles.length} role${roles.length === 1 ? '' : 's'} against ${BASE}\n`);

  for (const { role, portal } of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    try {
      await signInProduction(page, BASE, 'light', TEST_ACCOUNTS[role]);
    } catch (e) {
      findings.push({
        role, id: '(sign-in)', why: 'could not sign in',
        detail: e instanceof Error ? e.message.split('\n')[0] : String(e),
      });
      await context.close();
      continue;
    }

    const before = findings.length;
    for (const c of routes) {
      /* A capture pinned to one role is walked only by that role. */
      if (c.as === 'hiring_manager' && role !== 'hiringManager') continue;
      if (c.as && c.as !== 'hiring_manager' && role !== c.as) continue;
      await walkOne(page, role, portal, c.id, c.prod);
    }
    const found = findings.length - before;
    console.log(`  ${role.padEnd(14)} ${found ? `${found} finding${found === 1 ? '' : 's'}` : 'clean'}`);
    await context.close();
  }

  await browser.close();

  const report = {
    at: new Date().toISOString(),
    base: BASE,
    routes: routes.length,
    roles: roles.map((r) => r.role),
    walked: walked.length,
    /* Routes that needed a second go because the server under test restarted
       mid-flight. Worth reporting: a run with many of them is a run to repeat,
       even when it is green. */
    retried,
    findings,
  };
  const dir = path.join(process.cwd(), 'tests', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'walk.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (findings.length) {
    console.log(`\n  ${findings.length} finding${findings.length === 1 ? '' : 's'}:\n`);
    for (const f of findings) {
      console.log(`    ${f.role} · ${f.id}  ${f.why}`);
      if (f.detail) console.log(`        ${f.detail}`);
    }
    console.log('\n  report written to tests/reports/walk.json\n');
    process.exit(1);
  }

  console.log(`\n  ${walked.length} page loads, nothing on any of them that should not be`
    + `${retried.length ? ` (${retried.length} needed a second go — the server restarted)` : ''}\n`);
  console.log('  report written to tests/reports/walk.json\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
