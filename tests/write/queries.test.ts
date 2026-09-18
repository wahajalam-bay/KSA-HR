import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import type { Viewer } from '@/lib/auth/session';
import { jobScopeSql } from '@/lib/authz';
import { viewer } from '../commands/harness';
import { ok, eq as equals, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Every page query, run under every scope.

   `jobScopeSql` expands to `true` for an account whose access is everything —
   which is every account on the desk. So a query that composes the predicate
   wrongly still works perfectly for the people who write the queries, and
   fails only for a hiring manager, a panel member, or a recruiter on a picked
   list. That is exactly the shape of bug a suite has to go looking for, because
   nobody meets it by accident.

   It found one: five queries wrote `FROM jobs j` and then dropped in a
   predicate that says `jobs.recruiter_id`, which PostgreSQL refuses once the
   table has an alias. Every page that used one of them was a 500 for every
   hiring manager in the company, and green for everybody else.

   So this runs each query function with each of the four scopes and asserts
   only that it comes back. What the rows say is the business of the suite that
   owns the flow; this is about the SQL parsing and the predicate landing where
   it was meant to.
   ───────────────────────────────────────────────────────────────────────────*/

import type { Window } from '@/lib/domain/window';

const WINDOW: Window = { kind: 'preset', days: 90 };

function people(): Array<{ label: string; v: Viewer }> {
  return [
    {
      label: 'everything',
      v: viewer({
        name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin',
        isAdmin: true, staffId: 'stf_01',
        scope: { kind: 'all', jobIds: [], own: false },
      }),
    },
    {
      label: 'their own',
      v: viewer({
        name: 'Abdulrahman Al-Qahtani', role: 'hiring_manager', staffRole: null,
        roleLabel: 'Hiring manager', isPortal: true, staffId: null,
        email: 'abdulrahman.alqahtani@bayut.sa',
        scope: { kind: 'own', jobIds: [], own: true },
      }),
    },
    {
      label: 'a picked list',
      v: viewer({
        name: 'Taif Alshaikhi', staffRole: 'recruiter', staffId: 'stf_04',
        scope: { kind: 'jobs', jobIds: ['job_01', 'job_02'], own: false },
      }),
    },
    {
      label: 'a picked list and their own',
      v: viewer({
        name: 'Taif Alshaikhi', staffRole: 'recruiter', staffId: 'stf_04',
        scope: { kind: 'jobs', jobIds: ['job_01'], own: true },
      }),
    },
    {
      label: 'an empty picked list',
      v: viewer({
        name: 'Taif Alshaikhi', staffRole: 'recruiter', staffId: 'stf_04',
        scope: { kind: 'jobs', jobIds: [], own: false },
      }),
    },
  ];
}

const NOW = new Date();

/** Every query a page calls, by name, so a failure says which one. */
async function queries(v: Viewer): Promise<Array<[string, () => Promise<unknown>]>> {
  const overview = await import('@/lib/queries/overview');
  const jobs = await import('@/lib/queries/jobs');
  const jobTabs = await import('@/lib/queries/job-tabs');
  const candidates = await import('@/lib/queries/candidates');
  const scheduling = await import('@/lib/queries/scheduling');
  const offers = await import('@/lib/queries/offers');
  const onboarding = await import('@/lib/queries/onboarding');
  const manpower = await import('@/lib/queries/manpower');
  const insights = await import('@/lib/queries/insights');
  const analytics = await import('@/lib/queries/analytics');
  const ask = await import('@/lib/queries/ask');
  const team = await import('@/lib/queries/team');
  const search = await import('@/lib/queries/search');
  const shell = await import('@/lib/queries/shell');
  const portal = await import('@/lib/queries/portal');
  const approvals = await import('@/lib/queries/approvals');
  const feedback = await import('@/lib/queries/feedback');

  /* A requisition and an application this viewer can actually reach, so the
     per-record queries are asked something answerable. A scope that reaches
     nothing skips those, which is itself the right behaviour. */
  const [reachable] = rowsOf(await db().execute(sql`
    SELECT id FROM jobs WHERE ${jobScopeSql(v)} ORDER BY created_at LIMIT 1`)) as
    Array<{ id: string }>;
  const jobId = reachable?.id ?? '';

  const list: Array<[string, () => Promise<unknown>]> = [
    ['shell.navCounts', () => shell.navCounts(v, NOW)],
    ['overview.overview', () => overview.overview(v, WINDOW, NOW)],
    ['jobs.listJobs', () => jobs.listJobs(v, {} as never, NOW)],
    ['jobs.searchApplicants', () => jobs.searchApplicants(v, { q: 'al' } as never)],
    ['candidates.listCandidates', () => candidates.listCandidates(v, { tab: 'all' } as never, NOW)],
    ['candidates.candidateFilterOptions', () => candidates.candidateFilterOptions(v)],
    ['candidates.tabCounts', () => candidates.tabCounts(v)],
    ['candidates.listPools', () => candidates.listPools(v)],
    ['scheduling.agenda', () => scheduling.agenda(v, {}, NOW)],
    ['scheduling.taskBoard', () => scheduling.taskBoard(v, undefined)],
    ['scheduling.interviewerPanel', () => scheduling.interviewerPanel(v, WINDOW, NOW)],
    ['scheduling.load', () => scheduling.load(v, NOW)],
    ['scheduling.pendingReviewCount', () => scheduling.pendingReviewCount(v, NOW)],
    ['manpower.plan', () => manpower.plan(v)],
    ['offers.offerBoard', () => offers.offerBoard(v, NOW)],
    ['onboarding.joiners', () => onboarding.joiners(v, NOW)],
    ['analytics.dataset', () => analytics.dataset(v, NOW)],
    ['analytics.recruiterExtras', () => analytics.recruiterExtras(v, WINDOW, NOW)],
    ['analytics.interviewsByMonth', () => analytics.interviewsByMonth(v)],
    /* Insights builds a context first, and every one of its panels reads
       from it — so the context is the scoped query worth running. */
    ['insights.context', () => insights.context(v, WINDOW, '', NOW)],
    ['insights.<panels>', async () => {
      const c = await insights.context(v, WINDOW, '', NOW);
      await insights.scorecard(c as never, v);
      await insights.turnaround(c as never, v);
      await insights.recruiters(c as never, v);
      return insights.interviewerReport(c as never, v);
    }],
    ['ask.vocabulary', () => ask.vocabulary(v)],
    ['team.<board>', async () => {
      const fn = (team as Record<string, unknown>).teamBoard
        ?? (team as Record<string, unknown>).leaderboard
        ?? (team as Record<string, unknown>).team;
      return typeof fn === 'function'
        ? (fn as (...a: unknown[]) => Promise<unknown>)(v, WINDOW, NOW)
        : null;
    }],
    ['search.search', () => search.search(v, 'al')],
    ['ask.resolve', async () => {
      const vocab = await ask.vocabulary(v);
      const { parse } = await import('@/lib/services/ask');
      return ask.resolve(v, parse('how many open requisitions', vocab), NOW);
    }],
    ['approvals.requisitionQueue', () => approvals.requisitionQueue(v)],
    ['approvals.pendingApprovals', () => approvals.pendingApprovals('requisition', 'all')],
  ];

  /* The portal's own screen, and the per-requisition tabs. */
  if (v.isPortal) list.push(['portal.portal', () => portal.portal(v, NOW)]);
  if (jobId) {
    list.push(
      ['jobs.getJob', () => jobs.getJob(v, jobId)],
      ['jobs.getBoard', () => jobs.getBoard(v, jobId, null, NOW)],
      ['job-tabs.jobApplicants', () => jobTabs.jobApplicants(v, jobId, {}, NOW)],
      ['job-tabs.jobInsights', () => jobTabs.jobInsights(v, jobId, NOW)],
      ['job-tabs.activityFeed', () => jobTabs.activityFeed({ viewer: v, jobId } as never, 20)],
      ['feedback.jobRanking', () => feedback.jobRanking(v, jobId)],
    );
  }
  return list;
}

const suite: Suite = {
  name: 'write · every page query, under every scope',
  tests: people().map(({ label, v }) => ({
    name: `the queries behind every page run for somebody whose access is ${label}`,
    async fn() {
      const list = await queries(v);
      ok(list.length > 20, `${list.length} queries to run`);

      const broken: string[] = [];
      for (const [name, run] of list) {
        try {
          await run();
        } catch (e) {
          const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
          /* A refusal is a result: a scope that cannot reach a record is
             supposed to say so. A SQL error never is. */
          if (/outside your access|no longer exists|not yours/i.test(message)) continue;
          broken.push(`${name}: ${message}`);
        }
      }
      equals(broken.join('\n'), '', 'every page query composes valid SQL for this scope');
    },
  })),
};

export default suite;
