import { chrome, q } from '@/lib/queries/chrome';
import { overview } from '@/lib/queries/overview';
import { activityFeed } from '@/lib/queries/job-tabs';
import { TopBar } from '@/components/app/shell';
import { Seg, Push } from '@/components/ui/primitives';
import { fmt } from '@/lib/format';
import { can } from '@/lib/authz';
import * as W from '@/lib/domain/window';
import { PeriodRange } from '@/components/overview/period';
import { Hero, PipelineDonut } from '@/components/overview/hero';
import {
  TeamComposition, KeyMetrics, SourcesDonut, Attention, UpcomingJoiners, QuickActions,
} from '@/components/overview/board';
import {
  Kpis, Needs, Tasks, Agenda, FunnelCard, PipelineNow, PlanCard, ReqsCard, DeptsCard, FeedCard,
} from '@/components/overview/panels';

export const dynamic = 'force-dynamic';

const WDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pl = (n: number, one: string, many?: string) =>
  `${fmt.int(n)} ${n === 1 ? one : (many ?? one + 's')}`;

export default async function OverviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  const w = W.windowFromQuery(sp, 90);

  const data = await overview(viewer, w, now);

  /* Some records carry a future timestamp — a signature date already agreed, an
     interview later today — so the feed is trimmed to what has happened. The
     feed itself stops at a quarter, whichever period is chosen. */
  const feedDays = Math.min(w.days, 90);
  const feedFrom = W.isRange(w)
    ? (w.days > 90 ? W.isoDay(Date.parse(w.to) - 89 * 86_400_000) : w.from)
    : W.isoDay(now.getTime() - feedDays * 86_400_000);
  const feedTo = W.isRange(w) ? w.to : W.isoDay(now);
  const feedLabel = W.isRange(w)
    ? W.inLabel(w.days > 90 ? W.range(feedFrom, feedTo) : w)
    : W.inLabel(W.preset(feedDays));
  /* Four hundred newest first, then what has happened — in that order. The
     count under the heading is the number of things that have actually moved,
     which is not the same as the number of rows the query was willing to
     return, and trimming before the limit would quietly let older entries in
     to take the place of the future-dated ones. */
  const feed = (await activityFeed({ from: feedFrom, to: feedTo }, 400))
    .filter((a) => !a.at || new Date(a.at) <= now);

  const today = W.isoDay(now);
  const hour = (now.getUTCHours() + 3) % 24;                       // Riyadh, UTC+3
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const overdue = data.tasks.filter((t) => !t.done && t.dueOn && t.dueOn < today).length;

  return (
    <>
      <TopBar
        title="Overview"
        sub={
          <>
            {W.label(w)} · {fmt.int(data.open.count)} open requisitions ·{' '}
            {fmt.int(data.inPlay.total)} people in the pipeline · {fmt.int(data.hires.n)} hires
          </>
        }
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 className="t-2">{greet}, {fmt.first(viewer.name)}</h2>
              <p className="t-sub" style={{ marginTop: 3 }}>
                {WDAY[now.getUTCDay()]}, {fmt.date(now.toISOString())} · {pl(overdue, 'task')} of yours
                overdue · {pl(data.agenda.length, 'interview')} ahead ·{' '}
                {pl(data.health.offersOutCount, 'offer')} waiting on a signature
              </p>
            </div>
            <Push />
            <div className="row tight" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
              <Seg action="ov.win" active={W.isRange(w) ? '0' : String(w.days)} options={[
                { v: '30', t: 'Month' }, { v: '90', t: 'Quarter' },
                { v: '180', t: '6 months' }, { v: '365', t: 'Year' },
              ]} />
              <PeriodRange
                from={W.startOf(w, now)} to={W.endOf(w, now)}
                isRange={W.isRange(w)} label={W.label(w)} days={w.days}
                maxDay={W.isoDay(now.getTime() + 30 * 86_400_000)}
              />
            </div>
          </div>

          <div className="grid g-hero">
            <Hero data={data} />
            <PipelineDonut data={data} />
          </div>

          <div className="g-board">
            <TeamComposition data={data} canOpen={can(viewer, 'team.view')} />
            <KeyMetrics data={data} />
            <SourcesDonut data={data} />
          </div>

          <div className="g-board">
            <Attention data={data} />
            <UpcomingJoiners data={data} now={now} />
            <QuickActions />
          </div>

          <div className="grid g-kpi"><Kpis data={data} /></div>

          <div className="grid g-side">
            <Needs data={data} now={now} />
            <div className="stack">
              <Tasks data={data} today={today} now={now} />
              <Agenda data={data} today={today} now={now} />
            </div>
          </div>

          <div className="grid g-2">
            <FunnelCard data={data} />
            <PipelineNow data={data} />
          </div>

          <PlanCard data={data} />

          <div className="grid g-2">
            <ReqsCard data={data} />
            <DeptsCard data={data} />
          </div>

          <FeedCard items={feed.slice(0, 12)} total={feed.length} label={feedLabel}
            capped={w.days > 90} now={now} />
        </div>
      </main>
    </>
  );
}
