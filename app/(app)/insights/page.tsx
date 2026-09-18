import { chrome, q } from '@/lib/queries/chrome';
import { TopBar } from '@/components/app/shell';
import { Subnav, Seg, Banner, Btn, Push } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import * as I from '@/lib/queries/insights';
import * as A from '@/lib/queries/analytics';
import * as W from '@/lib/domain/window';
import { fmt } from '@/lib/format';
import { Scorecard } from '@/components/insights/scorecard';
import { Turnaround } from '@/components/insights/turnaround';
import { Recruiters } from '@/components/insights/recruiters';
import { Sources } from '@/components/insights/sources';
import { Departments } from '@/components/insights/departments';
import { Market } from '@/components/insights/market';
import { Quality } from '@/components/insights/quality';
import { Offers, Budget } from '@/components/insights/offers-budget';
import { Interviewers } from '@/components/insights/interviewers';
import { AskPanel } from '@/components/insights/ask';

export const dynamic = 'force-dynamic';

const WINS = ['30', '90', '180', '365'];

export default async function InsightsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();

  const tab = I.INSIGHTS_TABS.some((t) => t.v === sp.tab) ? sp.tab : 'overview';
  const w = W.preset(WINS.includes(String(sp.win)) ? Number(sp.win) : 180);

  /* Ask AI answers questions rather than drawing a period, so it does not pay
     for the whole dataset. */
  if (tab === 'ask') {
    return (
      <>
        <TopBar title="Insights" sub="Ask a question of the hiring data"
          unread={counts.unreadNotifications} viewer={viewer} theme={theme} />
        <main className="view" id="view">
          <Subnav action="ins.tab" active={tab} tabs={[...I.INSIGHTS_TABS]} />
          <AskPanel viewer={viewer} question={sp.q ?? ''} report={sp.rep ?? ''} now={now} />
        </main>
      </>
    );
  }

  const c = await I.context(viewer, w, sp.dept ?? '', now);
  const head = I.headline(c);
  const deptName = c.deptId ? c.deptName : null;

  return (
    <>
      <TopBar
        title="Insights"
        sub={
          <>
            {W.label(w)}{deptName ? ` · ${deptName}` : ''} · {head.hires} hires
            {head.target != null ? ` against a pro-rated target of ${head.target}` : ''} ·{' '}
            {head.breaching} live applications past SLA
          </>
        }
        actions={<Btn variant="out" className="only-wide" action="data.export" v="applications" icon="dl">Export this tab</Btn>}
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <Subnav action="ins.tab" active={tab} tabs={[...I.INSIGHTS_TABS]} />

        <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <Seg action="ins.win" active={String(w.days)} options={WINS.map((k) => ({
            v: k, t: W.PRESETS[Number(k)],
          }))} />
          <label className="fgrp">
            <span>Department</span>
            <select className="inp" data-act="ins.dept" defaultValue={c.deptId}>
              <option value="">Every department</option>
              {c.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          {c.deptId && <Btn size="sm" variant="ghost" action="ins.dept" v="" icon="x" iconSize={12}>Clear</Btn>}
          <span className="t-foot">
            {I.PERIOD_NOTE[tab] ?? ''}{deptName ? ` · ${deptName} only` : ''}
          </span>
          <Push />
          <Btn size="sm" variant="ghost" action="data.export" v="applications" icon="dl" iconSize={13}>Export</Btn>
        </div>

        {c.deptId && !c.apps.filter(A.isLive).length && !A.hiresIn(c.apps, w, now).length && (
          <Banner tone="warn" icon="alert" title={`${c.deptName} has nothing in this period`}
            body="No live applications and no hires inside the window. Widen the period or clear the department." />
        )}

        {tab === 'tat' ? <Turnaround d={await I.turnaround(c, viewer)} />
          : tab === 'recruiters' ? (
            <Recruiters rows={sortRecruiters(await I.recruiters(c, viewer), sp.sort, sp.dir)}
              sortKey={sp.sort && RECRUITER_SORT_KEYS.includes(sp.sort) ? sp.sort : 'hires'}
              sortDir={Number(sp.dir) === 1 ? 1 : -1} />
          )
            : tab === 'interviewers' ? <Interviewers d={await I.interviewerReport(c, viewer)} />
              : tab === 'sources' ? <Sources d={I.sources(c)} />
                : tab === 'departments' ? <Departments d={I.departments(c)} />
                  : tab === 'market' ? <Market d={I.market(c)} />
                    : tab === 'quality' ? <Quality d={I.quality(c)} />
                      : tab === 'offers' ? <Offers d={I.offers(c)} now={now} />
                        : tab === 'budget' ? <Budget d={I.budget(c)} />
                          : <Scorecard d={await I.scorecard(c, viewer)} />}
      </main>
    </>
  );
}

/* The recruiter table sorts on the server so the order survives a reload and a
   shared link, which a client-side sort does not. */
import { RECRUITER_SORTS, type RecruiterRow } from '@/components/insights/recruiters';

const RECRUITER_SORT_KEYS = Object.keys(RECRUITER_SORTS);

function sortRecruiters(rows: RecruiterRow[], key: string | undefined, dir: string | undefined) {
  const k = key && RECRUITER_SORTS[key] ? key : 'hires';
  const d = Number(dir) === 1 ? 1 : -1;
  const f = RECRUITER_SORTS[k];
  return [...rows].sort((a, b) => {
    const x = f(a), y = f(b);
    return (x < y ? -1 : x > y ? 1 : 0) * d;
  });
}
