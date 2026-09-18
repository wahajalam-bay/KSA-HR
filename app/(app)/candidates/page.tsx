import { chrome, q } from '@/lib/queries/chrome';
import {
  listCandidates, listPools, candidateFilterOptions, tabCounts, type CandidateTab,
} from '@/lib/queries/candidates';
import { db } from '@/db/client';
import { talentPools } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { TopBar } from '@/components/app/shell';
import { Subnav, Btn, Empty } from '@/components/ui/primitives';
import { can } from '@/lib/authz';
import { fmt } from '@/lib/format';
import { CandidateFilters } from '@/components/candidates/filters';
import { CandidateRows } from '@/components/candidates/list';
import { PoolsTab } from '@/components/candidates/pools';

export const dynamic = 'force-dynamic';

const TABS: CandidateTab[] = ['pipeline', 'all', 'hired', 'pools'];

export default async function CandidatesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  const tab = (TABS.includes(sp.tab as CandidateTab) ? sp.tab : 'pipeline') as CandidateTab;

  const [tabs, options, pools] = await Promise.all([
    tabCounts(viewer),
    candidateFilterOptions(viewer),
    listPools(viewer),
  ]);

  const pool = sp.pool
    ? (await db().select().from(talentPools).where(eq(talentPools.id, sp.pool)).limit(1))[0] ?? null
    : null;

  const head = (
    <TopBar
      title="Candidates"
      sub={
        <>
          {fmt.int(tabs.all)} people · {fmt.int(tabs.pipeline)} live applications · {tabs.pools} talent pools
        </>
      }
      actions={
        <>
          {can(viewer, 'cv.upload') && (
            <label className="btn out only-wide dz-inline" data-dz="cv.intake"
              title="Drop or pick CVs — read, matched and scored against every open requisition">
              Upload CVs
              <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.txt" multiple />
            </label>
          )}
          {can(viewer, 'candidate.create') && (
            <Btn variant="out" className="only-wide" action="cand.new" icon="uplus">Add candidate</Btn>
          )}
        </>
      }
      unread={counts.unreadNotifications} viewer={viewer} theme={theme}
    />
  );

  const strip = (
    <Subnav action="cand.tab" active={tab} tabs={[
      { v: 'pipeline', t: 'In pipeline', n: tabs.pipeline },
      { v: 'all', t: 'All candidates', n: tabs.all },
      { v: 'pools', t: 'Talent pools', n: tabs.pools },
      { v: 'hired', t: 'Hired', n: tabs.hired },
    ]} />
  );

  if (tab === 'pools') {
    return (
      <>
        {head}
        <main className="view" id="view">
          {strip}
          <PoolsTab pools={pools} viewer={viewer} now={now} />
        </main>
      </>
    );
  }

  const data = await listCandidates(viewer, {
    tab, q: sp.q, family: sp.fam, stage: sp.stage, source: sp.src, ownerId: sp.own,
    held: sp.held, tags: (sp.tags ?? '').split(',').filter(Boolean),
    poolId: sp.pool, sort: sp.sort,
  }, now);

  return (
    <>
      {head}
      <main className="view" id="view">
        {strip}
        <CandidateFilters sp={sp} options={options} tab={tab}
          tagFacets={data.tagFacets} poolName={pool?.name ?? null} />
        {data.rows.length ? (
          <CandidateRows rows={data.rows} total={data.total} shown={data.shown} now={now} />
        ) : (
          <Empty icon="search" title="Nobody matches" sub="Loosen a filter or clear the tags."
            action={<Btn variant="out" action="cand.clear">Clear filters</Btn>} />
        )}
      </main>
    </>
  );
}
