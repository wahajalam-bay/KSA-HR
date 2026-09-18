import * as React from 'react';
import { Card, Kpi, Bar, Table, Banner, type Column } from '@/components/ui/primitives';
import { Pie, Legend, HBars } from '@/components/charts';
import { RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import type { SourceRow } from '@/lib/queries/analytics';

/* Where the people came from, and which channels actually produce joiners. The
   tallest channel and the best channel are rarely the same one, which is the
   whole reason the two charts sit side by side. */

export type SourcesData = {
  mix: SourceRow[];
  applications: number;
  totalHires: number;
  /* The volume a channel needs before its conversion rate is worth acting on —
     a thin channel with one lucky hire must not win the comparison. */
  floor: number;
  costPerHireGoal: number | null;
};

export function Sources({ d }: { d: SourcesData }) {
  const { mix, floor } = d;
  const byHires = [...mix].sort((a, b) => b.hires - a.hires);
  const solid = mix.filter((s) => s.applications >= floor);
  const thin = mix.length - solid.length;
  const best = [...solid].sort((a, b) => b.conv - a.conv)[0];
  const biggest = mix[0];
  const outbound = mix.find((s) => s.source === 'Sourced — Outbound');
  const totalH = d.totalHires || 1;

  const top = mix.slice(0, 4);
  const rest = mix.slice(4).reduce((n, m) => n + m.applications, 0);
  const segs = [
    ...top.map((m) => ({ label: m.source, value: m.applications, hires: m.hires })),
    ...(rest ? [{ label: 'Other channels', value: rest, hires: mix.slice(4).reduce((n, m) => n + m.hires, 0) }] : []),
  ];
  const tot = segs.reduce((n, x) => n + x.value, 0) || 1;

  const cols: Array<Column<SourceRow>> = [
    { t: 'Source', f: (s) => <b>{s.source}</b> },
    { t: 'Applications', n: true, f: (s) => fmt.int(s.applications) },
    { t: 'Interviewed', n: true, f: (s) => fmt.int(s.interviewed) },
    { t: 'Hires', n: true, f: (s) => <b>{fmt.int(s.hires)}</b> },
    {
      t: 'Application to hire', n: true,
      f: (s) => <span className={s.applications < floor ? 'mut' : ''}>{fmt.pct(s.conv, 1)}</span>,
    },
    {
      t: 'Share of hires',
      f: (s) => <Bar p={s.hires / totalH} thin title={`${fmt.pct(s.hires / totalH)} of hires in the period`} />,
    },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Applications" value={fmt.int(d.applications)}
          def="Applications in scope for the period, across every channel."
          sub={`${fmt.int(mix.length)} channels in use`} />
        <Kpi label="Biggest channel" value={biggest ? biggest.source.split(' — ')[0] : '—'}
          def="The channel with the most applications in the period."
          sub={biggest ? `${fmt.int(biggest.applications)} applications · ${fmt.int(biggest.hires)} hires` : ''} />
        <Kpi label="Best converting" value={best ? best.source.split(' — ')[0] : '—'} accent
          def={`Highest application-to-hire rate among channels carrying at least ${floor} applications in the period, so a thin channel with one lucky hire cannot win it.`}
          sub={best ? `${fmt.pct(best.conv, 1)} of ${fmt.int(best.applications)} applications` : ''} />
        <Kpi label="Hires from outbound"
          value={outbound ? fmt.pct(outbound.hires / totalH) : '—'}
          def="Share of all hires in the period whose source is outbound sourcing."
          sub={outbound
            ? `${fmt.int(outbound.hires)} of ${fmt.int(d.totalHires)} hires, from ${fmt.pct(outbound.applications / (d.applications || 1))} of the applications`
            : ''} />
      </div>

      <Card title="Share of applications by channel"
        sub="The four biggest channels and everything else, for the period.">
        <div className="pie-row">
          <Pie segments={segs.map((s) => ({ label: s.label, value: s.value }))} size={220} />
          <Legend items={segs.map((x, i) => ({
            color: RAMP[i % RAMP.length], label: x.label,
            value: `${fmt.pct(x.value / tot)} · ${fmt.int(x.hires)} hired`,
          }))} />
        </div>
      </Card>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Volume by channel"
          sub="Applications in the period, ranked. One hue: this is magnitude, not category.">
          <HBars data={mix.map((s) => ({
            label: s.source, value: s.applications,
            note: s.hires ? `${fmt.int(s.hires)} hired` : 'no hires',
          }))} />
        </Card>

        <Card title="Which channels produce joiners"
          sub={'Application-to-hire rate, ranked. Read it against the volume chart — the tallest '
            + 'channel and the best channel are not the same one.'}
          foot={
            <span className="t-foot">
              {thin
                ? `Pale bars are the ${fmt.int(thin)} channels carrying fewer than ${floor} applications in this period — the rate is real, the sample is thin.`
                : `Every channel here carries at least ${floor} applications in this period, so the rates are all worth acting on.`}
            </span>
          }>
          <HBars format="pctWhole1"
            data={[...mix].sort((a, b) => b.conv - a.conv).map((s) => ({
              label: s.source,
              value: Math.round(s.conv * 1000) / 10,
              note: `${fmt.int(s.hires)} of ${fmt.int(s.applications)}`,
              color: s.applications < floor ? 'var(--seq-1)' : 'var(--seq-3)',
            }))} />
        </Card>
      </div>

      <Banner tone="info" icon="alert" title="Cost per hire is not in this dataset"
        body={
          <>
            Channel spend, agency fees and job-board contracts are not held in the ATS, so nothing
            here divides money by hires. The monthly goals carry a cost-per-hire figure of{' '}
            {d.costPerHireGoal == null ? '—' : fmt.sar(d.costPerHireGoal)}, but there is no actual to
            compare it with. Take these channels as volume and conversion only.
          </>
        } />

      <div style={{ marginTop: 14 }}>
        <Card flush title="Channel by channel"
          foot={
            <span className="t-foot">
              Ranked by hires, not applications. Interviewed counts anyone whose history reached a
              1st, 2nd or final interview. Application to hire divides hires by applications within
              the channel, so it is a channel yield, not a stage conversion.
            </span>
          }>
          <Table cols={cols} rows={byHires} />
        </Card>
      </div>
    </>
  );
}
