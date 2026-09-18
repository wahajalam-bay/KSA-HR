import * as React from 'react';
import { Card, Kpi, Empty } from '@/components/ui/primitives';
import { Funnel, HBars, Pie, Legend, Bars } from '@/components/charts';
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
          {data.funnel.length ? <Funnel rows={data.funnel} /> : <Empty icon="board" title="Nobody has applied yet" />}
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
              format="days"
            />
          ) : <Empty icon="clock" title="Nothing has moved yet" />}
        </Card>

        <Card
          title="Where they came from"
          sub="Share of applications by channel; the legend notes how many each produced who joined."
        >
          {segs.length ? (
            <div className="pie-row">
              <Pie segments={segs.map((s) => ({ label: s.label, value: s.value }))} size={190} />
              <Legend items={segs.map((x, i) => ({
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
            <Bars data={data.scorecards} h={200} labelMax={3} />
          ) : <Empty icon="star" title="No scorecards yet" />}
        </Card>
      </div>
    </>
  );
}
