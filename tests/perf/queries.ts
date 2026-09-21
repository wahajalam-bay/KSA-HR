/* ─────────────────────────────────────────────────────────────────────────────
   WHAT EACH PAGE COSTS BEFORE THE FRAMEWORK TOUCHES IT

   A slow page is either slow to fetch or slow to render, and the two are fixed
   in different places. This times the fetch alone: every page's read, run
   against the real database, with no Next, no bundler and no browser in the
   way. It also counts the statements each one issues, because a page that is
   slow because it asks forty questions needs a different answer from a page
   that is slow because it asks one bad one.

     npx tsx --conditions=react-server tests/perf/queries.ts
     npx tsx --conditions=react-server tests/perf/queries.ts --runs=5
   ───────────────────────────────────────────────────────────────────────────*/
import { loadEnvFiles } from '../../db/env-files';

loadEnvFiles();

const runs = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 3);

/* Count and time every statement, by wrapping the pool the app uses. */
type Stat = { n: number; ms: number; slowest: { ms: number; text: string } };

async function instrument(): Promise<() => Stat> {
  const { db } = await import('@/db/client');
  const pool = db() as unknown as { execute: (q: unknown) => Promise<unknown> };
  const original = pool.execute.bind(pool);
  let n = 0; let ms = 0; let slowest = { ms: 0, text: '' };
  (pool as { execute: unknown }).execute = async (q: unknown) => {
    const t = Date.now();
    try {
      return await original(q);
    } finally {
      const took = Date.now() - t;
      n += 1; ms += took;
      if (took > slowest.ms) {
        /* A Drizzle statement holds references back to its own tables, so it
           cannot be stringified; the chunks that are plain strings are enough
           to recognise which query it was. */
        const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
        const text = chunks
          .map((c) => (typeof c === 'string' ? c
            : Array.isArray((c as { value?: unknown[] })?.value)
              ? (c as { value: unknown[] }).value.join('') : ''))
          .join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        slowest = { ms: took, text };
      }
    }
  };
  return () => {
    const out = { n, ms, slowest };
    n = 0; ms = 0; slowest = { ms: 0, text: '' };
    return out;
  };
}

async function main() {
  const { viewer } = await import('../commands/harness');
  const W = await import('@/lib/domain/window');
  const now = new Date();

  const v = viewer({
    name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin',
    isAdmin: true, staffId: 'stf_01',
    scope: { kind: 'all', jobIds: [], own: false },
  });

  const overview = await import('@/lib/queries/overview');
  const jobs = await import('@/lib/queries/jobs');
  const jobTabs = await import('@/lib/queries/job-tabs');
  const candidates = await import('@/lib/queries/candidates');
  const scheduling = await import('@/lib/queries/scheduling');
  const team = await import('@/lib/queries/team');
  const insights = await import('@/lib/queries/insights');
  const offers = await import('@/lib/queries/offers');
  const chrome = await import('@/lib/queries/chrome');

  const w = W.preset(90);
  const teamW = W.preset(180);

  const CASES: Array<[string, () => Promise<unknown>]> = [
    ['chrome (every page)', () => chrome.chrome()],
    ['overview', () => overview.overview(v, w, now)],
    ['jobs', () => jobs.listJobs(v, { status: 'open' }, now)],
    ['job insights', () => jobTabs.jobInsights(v, 'job_01', now)],
    ['candidates', () => candidates.listCandidates(v, { tab: 'pipeline' }, now)],
    ['scheduling agenda', () => scheduling.agenda(v, {}, now)],
    ['scheduling load', () => scheduling.load(v, now)],
    ['offers board', () => offers.offerBoard(v, now)],
    ['team list', () => team.teamList(v, teamW, now)],
    ['team profile', () => team.profile(v, 'stf_02', teamW, now)],
    ['insights context', () => insights.context(v, w, '', now)],
  ];

  const stat = await instrument();
  stat();                                        // discard anything from import

  /* The context is built once and then every tab is measured against it, which
     is what the page does. */
  const ctx = await insights.context(v, w, '', now);
  stat();

  const TABS: Array<[string, () => Promise<unknown> | unknown]> = [
    ['insights · scorecard', () => insights.scorecard(ctx, v)],
    ['insights · turnaround', () => insights.turnaround(ctx, v)],
    ['insights · recruiters', () => insights.recruiters(ctx, v)],
    ['insights · sources', () => insights.sources(ctx)],
    ['insights · departments', () => insights.departments(ctx)],
    ['insights · pay', () => insights.market(ctx)],
    ['insights · quality', () => insights.quality(ctx)],
    ['insights · offers', () => insights.offers(ctx)],
    ['insights · budget', () => insights.budget(ctx)],
    ['insights · interviewers', () => insights.interviewerReport(ctx, v)],
  ];

  type Row = { id: string; best: number; queries: number; qms: number; slowest: string };
  const rows: Row[] = [];

  for (const [id, fn] of [...CASES, ...TABS]) {
    let best = Infinity; let q: Stat = { n: 0, ms: 0, slowest: { ms: 0, text: '' } };
    for (let i = 0; i < runs; i++) {
      stat();
      const t = Date.now();
      try {
        await fn();
      } catch (e) {
        console.log(`  ${id} threw: ${(e as Error).message.slice(0, 120)}`);
        break;
      }
      const took = Date.now() - t;
      const s = stat();
      if (took < best) { best = took; q = s; }
    }
    if (best === Infinity) continue;
    rows.push({
      id, best, queries: q.n, qms: q.ms,
      slowest: q.slowest.ms > 20 ? `${q.slowest.ms}ms ${q.slowest.text.slice(0, 70)}` : '',
    });
  }

  console.log('\n  read                          best   queries   in SQL   elsewhere');
  console.log('  ' + '─'.repeat(70));
  for (const r of [...rows].sort((a, b) => b.best - a.best)) {
    console.log(
      `  ${r.id.padEnd(26)} ${String(r.best).padStart(6)}ms ${String(r.queries).padStart(7)}  `
      + `${String(r.qms).padStart(6)}ms ${String(Math.max(0, r.best - r.qms)).padStart(8)}ms`,
    );
  }
  const total = rows.reduce((n, r) => n + r.best, 0);
  console.log(`\n  ${rows.length} reads · ${total}ms in total · `
    + `${rows.reduce((n, r) => n + r.queries, 0)} statements\n`);

  process.exit(0);
}

main();
