import * as React from 'react';
import { Card, Kpi, Empty } from '@/components/ui/primitives';
import { Funnel, HBars, Pie, Legend, Bars, type Picks } from '@/components/charts';
import { applicationsUrl } from '@/lib/charts/drill';
import { RAMP } from '@/lib/charts/palette';
import { fmt, sum } from '@/lib/format';
import { PitchInsightCard } from '@/components/pitch/job-insight';
import { RankingCard } from '@/components/feedback/ranking';
import type { jobInsights } from '@/lib/queries/job-tabs';
import type { PitchInsight } from '@/lib/queries/pitch';
import type { RankedRow } from '@/lib/queries/feedback';

/* A requisition's own numbers: how many entered each stage and how many went
   further, how long each stage actually takes against the SLA it set itself,
   which channel produced the people, and how the scorecards were spread. */

type Data = Awaited<ReturnType<typeof jobInsights>>;

export function InsightsTab({ job, data, pitch, ranking }: {
  job: any; data: Data; pitch: PitchInsight | null; ranking: RankedRow[];
}) {
  const { head } = data;
  const answered = head.accepted + head.declined;

  const top = data.sources.slice(0, 4);
  const rest = data.sources.slice(4);
  const segs = [
    ...top.map((x: any) => ({ label: x.source, value: Number(x.n), hires: Number(x.hires) })),
    ...(rest.length ? [{
      label: 'Other channels',
      value: sum(rest.map((x: any) => Number(x.n))),
      hires: sum(rest.map((x: any) => Number(x.hires))),
    }] : []),
  ];
  const total = sum(segs.map((s) => s.value)) || 1;

  /* Everything here is about one requisition, so every drill carries its id and
     lands on the applications of that requisition alone. */
  const on = { tab: 'all' as const, apps: true, jobId: job.id as string };

  const funnelPicks: Picks = data.funnel.map((r: any) => (r.n
    ? {
      act: 'go',
      v: applicationsUrl({ ...on, reached: r.key }),
      tip: {
        label: r.name, value: fmt.int(r.n),
        rows: [['Of everyone who applied', fmt.pct(r.convFromTop)]],
        action: `Open ${fmt.int(r.n)} application${r.n === 1 ? '' : 's'}`,
      },
    }
    : null));

  /* A bar of median days is not a count, so the drill says its own number: the
     applications that reached the stage, which the funnel has already counted
     from the same history. A stage the funnel does not carry — one this
     template skips — keeps its tooltip and does nothing. */
  const tatPicks: Picks = data.tat.map((x: any) => {
    const reached = data.funnel.find((r: any) => r.key === x.key);
    const tip = {
      label: x.name,
      value: `${fmt.dec(x.median, 1)} days`,
      rows: [
        ['Template SLA', `${x.sla} days`] as [string, string],
        ['Dwells measured', fmt.int(x.n)] as [string, string],
        ...(x.breaches ? [['Past the SLA', fmt.int(x.breaches)] as [string, string]] : []),
      ],
      note: x.median > x.sla ? 'This stage is running over its own SLA.' : undefined,
    };
    return reached?.n
      ? {
        act: 'go',
        v: applicationsUrl({ ...on, reached: x.key }),
        n: reached.n,
        tip: { ...tip, action: `Open ${fmt.int(reached.n)} application${reached.n === 1 ? '' : 's'} that reached it` },
      }
      : { tip };
  });

  const restSources = rest.map((x: any) => String(x.source));
  const sourcePicks: Picks = segs.map((s, i) => {
    const isOther = i >= top.length;
    return {
      act: 'go',
      v: applicationsUrl({
        ...on,
        ...(isOther ? { sources: restSources } : { source: String(top[i].source) }),
      }),
      tip: {
        label: s.label,
        value: `${fmt.int(s.value)} application${s.value === 1 ? '' : 's'}`,
        rows: [
          ['Share of this requisition', fmt.pct(s.value / total)],
          ...(s.hires ? [['Joined from it', fmt.int(s.hires)] as [string, string]] : []),
          ...(isOther ? [['Channels', fmt.int(restSources.length)] as [string, string]] : []),
        ],
        action: `Open ${fmt.int(s.value)} application${s.value === 1 ? '' : 's'}`,
      },
    };
  });

  /* Scorecards are evaluations, and there is no list of evaluations to open.
     The band explains itself and does not pretend otherwise. */
  const cardTotal = sum(data.scorecards.map((b: any) => b.value)) || 1;
  const scorePicks: Picks = data.scorecards.map((b: any) => ({
    tip: {
      label: `Rated ${b.label} out of 5`,
      value: `${fmt.int(b.value)} scorecard${b.value === 1 ? '' : 's'}`,
      rows: [['Share of the scorecards', fmt.pct(b.value / cardTotal)]],
    },
  }));

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Applications" value={fmt.int(head.total)} sub={`${fmt.int(head.live)} still live`} />
        <Kpi label="Hires" value={fmt.int(head.hired)} sub={`of ${job.openings} openings`} accent />
        <Kpi label="Median time to hire" value={head.timeToHire == null ? '—' : fmt.dec(head.timeToHire, 0)}
          unit={head.timeToHire == null ? undefined : 'days'}
          sub={head.hired ? `across ${head.hired} hires` : 'no hires yet'} />
        <Kpi label="Offer→accept" value={answered ? fmt.pct(head.accepted / answered) : '—'}
          sub="signed vs declined" />
      </div>

      {pitch && (
        <div style={{ marginBottom: 14 }}><PitchInsightCard data={pitch} /></div>
      )}

      <div className="grid g-2">
        <Card title="Funnel" sub="Who entered each stage, and the share who went further">
          {data.funnel.length
            ? <Funnel rows={data.funnel} picks={funnelPicks} />
            : <Empty icon="board" title="Nobody has applied yet" />}
        </Card>

        <Card title="Time in stage" sub="Median days, against the template SLA">
          {data.tat.length ? (
            <HBars
              data={data.tat.map((x) => ({
                label: x.name,
                value: Math.round(x.median * 10) / 10,
                marker: x.sla,
                markerLabel: `SLA ${x.sla} days`,
                scaleHint: x.sla <= 10 ? x.sla : 0,
                note: x.breaches ? `${x.breaches} past SLA` : '',
                color: x.median > x.sla ? 'var(--bad)' : 'var(--seq-3)',
              }))}
              format="days" picks={tatPicks}
            />
          ) : <Empty icon="clock" title="Nothing has moved yet" />}
        </Card>

        <Card
          title="Where they came from"
          sub="Share of applications by channel; the legend notes how many each produced who joined."
        >
          {segs.length ? (
            <div className="pie-row">
              <Pie segments={segs.map((s) => ({ label: s.label, value: s.value }))} size={190}
                picks={sourcePicks} />
              <Legend picks={sourcePicks} items={segs.map((x, i) => ({
                color: RAMP[i % RAMP.length],
                label: x.label,
                value: `${fmt.pct(x.value / total)}${x.hires ? ` · ${fmt.int(x.hires)} hired` : ''}`,
              }))} />
            </div>
          ) : <Empty icon="search" title="No applications yet" />}
        </Card>

        <RankingCard rows={ranking} />

        <Card title="Scorecard spread">
          {data.scorecards.some((b) => b.value) ? (
            <Bars data={data.scorecards} h={200} labelMax={3} picks={scorePicks} />
          ) : <Empty icon="star" title="No scorecards yet" />}
        </Card>
      </div>
    </>
  );
}
