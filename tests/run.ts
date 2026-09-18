/* ─────────────────────────────────────────────────────────────────────────────
   The test runner.

   Small on purpose. A suite is a file that exports `name` and `tests`; a test
   is a name and a function that throws when something is wrong. There is no
   watch mode, no snapshot store and no mocking framework, because the things
   worth testing here are the database's constraints and the state machines
   that sit on them — and both of those want the real thing.

     npx tsx tests/run.ts                 every suite
     npx tsx tests/run.ts requisition     the suites whose name matches
     npx tsx tests/run.ts --list          what there is
   ───────────────────────────────────────────────────────────────────────────*/
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvFiles } from '../db/env-files';

loadEnvFiles();

export type Test = { name: string; fn: () => Promise<void> | void; skip?: string };
export type Suite = { name: string; tests: Test[]; before?: () => Promise<void>; after?: () => Promise<void> };

const argv = process.argv.slice(2);
const filters = argv.filter((a) => !a.startsWith('--'));
const listOnly = argv.includes('--list');
const bail = argv.includes('--bail');

const ROOT = path.join(process.cwd(), 'tests');
const SKIP_DIRS = new Set(['visual', 'reports', 'commands']);

function suiteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) && dir === ROOT) continue;
        walk(p);
      } else if (/\.test\.ts$/.test(entry.name)) out.push(p);
    }
  };
  walk(ROOT);
  return out.sort();
}

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const YELLOW = '[33m';
const OFF = '[0m';

async function main() {
  const files = suiteFiles();
  let pass = 0; let fail = 0; let skipped = 0;
  const failures: Array<{ suite: string; test: string; error: string }> = [];
  /* Kept so the test report in docs/ can be written from a real run rather
     than from somebody's memory of one. */
  const record: Array<{
    name: string; file: string;
    tests: Array<{ name: string; state: 'pass' | 'fail' | 'skip'; ms: number }>;
  }> = [];
  const started = Date.now();

  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: Suite; suite?: Suite };
    const suite = mod.default ?? mod.suite;
    if (!suite) { console.error(`  ${file} exports no suite`); continue; }
    if (filters.length && !filters.some((f) => suite.name.includes(f) || file.includes(f))) continue;

    console.log(`\n  ${suite.name}`);
    if (listOnly) {
      for (const t of suite.tests) console.log(`    ${t.name}`);
      continue;
    }

    const entry = {
      name: suite.name,
      file: path.relative(process.cwd(), file).split(path.sep).join('/'),
      tests: [] as Array<{ name: string; state: 'pass' | 'fail' | 'skip'; ms: number }>,
    };
    record.push(entry);

    if (suite.before) await suite.before();
    for (const t of suite.tests) {
      if (t.skip) {
        skipped++;
        entry.tests.push({ name: t.name, state: 'skip', ms: 0 });
        console.log(`    ${YELLOW}skip${OFF} ${t.name} ${DIM}— ${t.skip}${OFF}`);
        continue;
      }
      const t0 = Date.now();
      try {
        await t.fn();
        pass++;
        const ms = Date.now() - t0;
        entry.tests.push({ name: t.name, state: 'pass', ms });
        console.log(`    ${GREEN}pass${OFF} ${t.name}${ms > 400 ? ` ${DIM}${ms}ms${OFF}` : ''}`);
      } catch (e) {
        fail++;
        const message = e instanceof Error ? e.message : String(e);
        entry.tests.push({ name: t.name, state: 'fail', ms: Date.now() - t0 });
        failures.push({ suite: suite.name, test: t.name, error: message });
        console.log(`    ${RED}FAIL${OFF} ${t.name}`);
        console.log(`         ${message.split('\n').join('\n         ')}`);
        if (bail) break;
      }
    }
    if (suite.after) await suite.after();
    if (bail && fail) break;
  }

  if (listOnly) return;

  console.log(`\n  ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} `
    + `${DIM}in ${((Date.now() - started) / 1000).toFixed(1)}s${OFF}\n`);

  const report = path.join(ROOT, 'reports', 'commands.json');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify({
    at: new Date().toISOString(),
    filters,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    pass, fail, skipped, failures,
    suites: record,
  }, null, 2));

  if (fail) process.exit(1);
}

/* ── the assertions a suite uses ─────────────────────────────────────────── */
export function ok(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

export function eq<T>(actual: T, expected: T, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message ? `${message}: ` : ''}expected ${b}, got ${a}`);
}

export function includes(haystack: string, needle: string, message?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${message ? `${message}: ` : ''}expected "${haystack}" to contain "${needle}"`);
  }
}

/** A command that should have been refused, with the reason it gave. */
export function refused(
  r: { ok: boolean; error?: string }, contains: string, message?: string,
): void {
  if (r.ok) throw new Error(`${message ? `${message}: ` : ''}expected a refusal, got success`);
  if (!String(r.error ?? '').toLowerCase().includes(contains.toLowerCase())) {
    throw new Error(`${message ? `${message}: ` : ''}expected the refusal to mention "${contains}", got "${r.error}"`);
  }
}

/** A command that should have worked, with its own error if it did not. */
export function succeeded(r: { ok: boolean; error?: string }, message?: string): void {
  if (!r.ok) throw new Error(`${message ? `${message}: ` : ''}${r.error}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
