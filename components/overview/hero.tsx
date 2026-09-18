import * as React from 'react';
import { Card, Stepper } from '@/components/ui/primitives';
import { Badge, Icon } from '@/components/ui/icons';
import { BrandLogo } from '@/components/ui/brand';
import { Line, Donut, Legend, type Picks } from '@/components/charts';
import { applicationsUrl } from '@/lib/charts/drill';
import { fmt } from '@/lib/format';
import * as W from '@/lib/domain/window';
import type { OverviewData } from '@/lib/queries/overview';

/* ─────────────────────────────────────────────────────────────────────────────
   The hero row: three headline tiles beside a cut-paper wave of hiring volume,
   and the pipeline of the period as a donut with a stepper under it.

   The donut is the one card people point at in a review, so it says plainly
   what it is counting: everybody who was in the pipeline at any point in the
   period, at the stage they had reached by the end of it.
   ───────────────────────────────────────────────────────────────────────────*/

function Tile({ icon, label, value, sub }: {
  icon: string; label: string; value: React.ReactNode; sub?: React.ReactNode;
}) {
  return (
    <div className="hero-tile">
      <Badge name={icon} className="ht-i" size={16} />
      <div>
        <span className="ht-l">{label}</span>
        <b className="ht-v num">{value}</b>
        {sub && <span className="ht-s">{sub}</span>}
      </div>
    </div>
  );
}

export function Hero({ data }: { data: OverviewData }) {
  const w = data.window;
  const period = W.phrase(w);
  const range = W.isRange(w);
  const unit = data.buckets[0]?.unit ?? 'month';
  const points = data.buckets.map((m) => ({
    x: unit === 'week' ? m.label : m.label.split(' ')[0],
    y: m.hires,
  }));

  return (
    <section className="card hero">
      <div className="hero-l">
        <div className="hero-brand">
          <BrandLogo variant="chip" className="brand-chip" alt="Bayut" /><i /><span>TA Team</span>
        </div>
        <Tile icon="brief" label="Open positions" value={fmt.int(data.open.count)}
          sub={<>{fmt.int(data.open.openings)} openings · {fmt.int(data.open.opened)} opened{' '}
            {range ? `in ${W.short(w)}` : `in the ${period.replace('last ', '')}`}</>} />
        <Tile icon="trophy" label={`Hired — ${range ? W.short(w) : period}`} value={fmt.int(data.hires.n)}
          sub={data.hires.prev
            ? `${fmt.int(data.hires.prev)} in ${W.previousLabel(w)}`
            : `none in ${W.previousLabel(w)}`} />
        <Tile icon="clock" label="Time to fill"
          value={<>{fmt.dec(data.timeToFill.median, 0)} <small>days</small></>}
          sub={<>median, {range ? W.short(w) : period}
            {data.timeToFill.n ? ` · ${fmt.int(data.timeToFill.n)} hires` : ''}</>} />
      </div>
      <div className="hero-r">
        <div className="hero-cap">
          <b>Hires a {unit}</b>
          <span>{W.label(w)}, {unit} by {unit}</span>
        </div>
        <Line series={[{ name: 'Hires', points }]} h={250}
          dots={unit === 'week' && points.length <= 6} maxTicks={12} />
      </div>
    </section>
  );
}

/* ── The pipeline of the period ─────────────────────────────────────────── */
const GROUPS: Array<[string, string[], string]> = [
  ['Applied', ['applied', 'sourced'], 'var(--wave-1)'],
  ['Screening', ['screen', 'assessment'], 'var(--wave-2)'],
  ['Interview', ['iv1', 'iv2', 'ivf'], 'var(--wave-3)'],
  ['Offer', ['offer'], 'var(--wave-4)'],
  ['Hired', ['joined'], 'var(--wave-5)'],
];

export function PipelineDonut({ data }: { data: OverviewData }) {
  const w = data.window;
  const rows = data.inPlay.rows;
  const asAt = data.to;
  const segs = GROUPS.map(([label, keys, color]) => ({
    label, color,
    value: rows.filter((r) => keys.includes(r.stage)).length,
    live: rows.filter((r) => r.live && keys.includes(r.stage)).length,
  }));
  const steps = [
    { key: 'applied', name: 'Applied' }, { key: 'screen', name: 'Screening' },
    { key: 'iv1', name: 'Interview' }, { key: 'offer', name: 'Offer' },
    { key: 'joined', name: 'Hired' },
  ];
  const counts = {
    applied: segs[0].value, screen: segs[1].value, iv1: segs[2].value,
    offer: segs[3].value, joined: segs[4].value,
  };
  const liveNow = data.inPlay.live;
  const total = rows.length || 1;

  /* Each slice stands for the applications that had reached that group of
     stages by the end of the period. Picking one lands on exactly those — the
     same window, the same reading of "reached by then", the same stage keys —
     so the count on the chart and the count on the list are one number read
     twice, not two numbers that ought to agree. */
  const allPicks: Picks = segs.map((s) => {
    const keys = GROUPS.find(([label]) => label === s.label)![1];
    if (!s.value) return { tip: { label: s.label, value: '0', note: 'Nobody reached this group.' } };
    return {
      act: 'go',
      v: applicationsUrl({
        tab: 'all', apps: true, win: 'inplay',
        from: data.from, to: data.to, stages: keys,
      }),
      tip: {
        label: s.label,
        value: fmt.int(s.value),
        rows: [
          ['Share of the period', fmt.pct(s.value / total)],
          ...(s.live ? [['Still live today', fmt.int(s.live)] as [string, string]] : []),
        ],
        action: `Open ${fmt.int(s.value)} application${s.value === 1 ? '' : 's'}`,
      },
    };
  });
  /* The chart is drawn from the groups that have somebody in them; the legend
     and the stepper show all five. Both read from the same array. */
  const shown = segs.filter((s) => s.value);
  const picks: Picks = shown.map((s) => allPicks![segs.indexOf(s)]);

  return (
    <Card
      title="Candidate pipeline" icon="users"
      sub={`${W.label(w)} · ${liveNow ? `${fmt.int(liveNow)} still in play today` : 'none still in play today'}`}
      foot={
        <span className="t-foot">
          Everybody who was in the pipeline at any point in {W.phrase(w)} — {fmt.int(rows.length)} people —
          counted at the stage they had reached by {fmt.date(asAt)}, or the stage they left from.{' '}
          {liveNow ? `${fmt.int(liveNow)} are still live today` : 'None are still live today'}. Change the
          dates above and every number here moves with them; click a stage on any board to open the people
          behind it.
        </span>
      }
    >
      <div className="donut-row">
        <Donut segments={shown} size={190} picks={picks}
          centre={fmt.int(rows.length)} centreSub="in the period" />
        <Legend
          items={segs.map((s) => ({
            color: s.color, label: s.label, value: fmt.int(s.value),
            sub: s.value
              ? `${fmt.pct(s.value / total)} of the period${s.live ? ` · ${fmt.int(s.live)} still live` : ''}`
              : '',
          }))}
          picks={allPicks} />
      </div>
      <Stepper stages={steps} counts={counts} picks={allPicks ?? []} />
    </Card>
  );
}
