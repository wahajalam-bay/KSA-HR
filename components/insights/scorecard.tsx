import * as React from 'react';
import { Card, Kpi, Empty, Bar, Table, type Column } from '@/components/ui/primitives';
import {
  Bars, Line, Legend, Funnel, Pie, Waves, Spark, type Pick, type Picks, type Picks2,
} from '@/components/charts';
import { applicationsUrl, interviewsUrl } from '@/lib/charts/drill';

/* A calendar month, as the two ends a drill-down needs. The monthly series on
   this tab are grouped by the UTC month of the record's own date, so these are
   the exact edges of what each point counted. */
const monthDays = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
    fromAt: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    toAt: new Date(Date.UTC(y, m, 1) - 1).toISOString(),
  };
};
import { CAT, RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import type { MonthRow, FunnelRow } from '@/lib/queries/analytics';
import type { DrillScope } from '@/lib/queries/insights';

/* ─────────────────────────────────────────────────────────────────────────────
   The hiring scorecard: the five numbers a monthly review opens with, then the
   year behind them.

   The period control governs the tiles. The monthly charts always show twelve
   months, because a trend read over a quarter is not a trend — and the card
   says so rather than letting somebody assume otherwise.
   ───────────────────────────────────────────────────────────────────────────*/

export type ScorecardData = {
  months: MonthRow[];
  hires: number;
  target: number;
  timeToHire: { median: number; n: number };
  goalTimeToHire: number | null;
  accept: { a: number; d: number; rate: number | null };
  quality: { n: number; mean: number | null; values: number[] };
  goalQuality: number | null;
  live: number;
  pastSla: number;
  funnel: FunnelRow[];
  offerStates: Array<{ label: string; value: number; color?: string }>;
  offersTotal: number;
  scope: DrillScope;
  today: string;
};

const orDash = (v: number | null, f: (n: number) => string) =>
  (v == null ? <span className="mut">—</span> : f(v));

export function Scorecard({ d }: { d: ScorecardData }) {
  const m12 = d.months;
  const partial = m12[m12.length - 1];
  const joined = d.funnel[d.funnel.length - 1]?.n ?? 0;
  const top = d.funnel[0]?.n ?? 0;
  const offered = d.funnel.find((r) => r.key === 'offer')?.n ?? 0;
  const totalOffers = d.offerStates.reduce((n, s) => n + s.value, 0) || 1;

  const monthCols: Array<Column<MonthRow>> = [
    { t: 'Month', f: (m) => <b>{m.label}</b> },
    { t: 'Applications', n: true, f: (m) => fmt.int(m.applications) },
    { t: 'Interviews', n: true, f: (m) => fmt.int(m.interviews) },
    { t: 'Offers sent', n: true, f: (m) => fmt.int(m.offersSent) },
    { t: 'Hires', n: true, f: (m) => <b>{fmt.int(m.hires)}</b> },
    { t: 'Target', n: true, f: (m) => fmt.int(m.target) },
    { t: 'Attainment', f: (m) => <Bar p={m.attainment} thin title={`${fmt.pct(m.attainment)} of target`} /> },
    {
      t: 'Median time to hire', n: true,
      f: (m) => (m.hires ? fmt.days(m.timeToHire) : <span className="mut">—</span>),
    },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Hires" value={fmt.int(d.hires)} accent
          def="Applications marked hired whose closing date falls inside the period."
          sub={`${fmt.pct(d.target ? d.hires / d.target : 0)} of ${fmt.int(d.target)} pro-rated target`}
          spark={<Spark values={m12.map((m) => m.hires)} />} />
        <Kpi label="Median time to hire" value={fmt.dec(d.timeToHire.median, 0)} unit="days"
          def="Days from the application arriving to the hire being closed. Median, not mean."
          sub={`goal ${d.goalTimeToHire ?? '—'} days · ${fmt.int(d.timeToHire.n)} hires measured`} />
        <Kpi label="Offer acceptance" value={orDash(d.accept.rate, fmt.pct)}
          def="Offers accepted as a share of offers accepted plus declined. Offers still out are excluded."
          sub={`${d.accept.a} accepted, ${d.accept.d} declined`} />
        <Kpi label="Quality of hire" value={orDash(d.quality.mean, (v) => fmt.dec(v, 2))} unit="/5"
          def="Mean of the submitted scorecard scores for people who joined in the period."
          sub={`${fmt.int(d.quality.n)} of ${fmt.int(d.hires)} joiners scored · goal ${fmt.dec(d.goalQuality ?? 0, 1)}`} />
        <Kpi label="Live pipeline" value={fmt.int(d.live)}
          def="Applications with an active or on-hold status right now, whatever the period."
          sub={`${fmt.int(d.pastSla)} past SLA`} action={{ act: 'go', v: '/candidates' }} />
      </div>

      <div className="grid g-2">
        <Card title="Hires against target, by month"
          sub={<>Bars are hires closed in the month; the dashed rule is that month&rsquo;s goal.</>}
          foot={
            <span className="t-foot">
              {partial?.label} is a part month — the dataset stops at {d.today}. Twelve months
              regardless of the period above.
            </span>
          }>
          <Bars data={m12.map((m) => ({ label: m.label, value: m.hires, target: m.target }))}
            h={250} labelMax={6}
            /* Twelve months regardless of the period, so each bar carries its
               own month rather than the period control's dates. */
            picks={m12.map((m): Pick => ({
              ...(m.hires
                ? {
                  act: 'go',
                  v: applicationsUrl({
                    tab: 'hired', win: 'closed',
                    from: monthDays(m.month).from, to: monthDays(m.month).to,
                    deptId: d.scope.deptId,
                  }),
                }
                : {}),
              tip: {
                label: m.label,
                value: m.hires ? `${fmt.int(m.hires)} hire${m.hires === 1 ? '' : 's'}` : 'no hires',
                rows: [
                  ['Plan for the month', fmt.int(m.target)],
                  ['Against plan', m.target ? fmt.pct(m.hires / m.target) : '\u2014'],
                ],
                ...(m.hires
                  ? { action: `Open ${fmt.int(m.hires)} hire${m.hires === 1 ? '' : 's'}` }
                  : {}),
              },
            }))} />
        </Card>

        <Card title="Applications and interviews"
          sub="Both are event counts on one axis, so the gap between them is the load per interview."
          foot={
            <span className="t-foot">
              August carries a job-fair intake, which is why the two lines pull apart at the right.
            </span>
          }>
          <Line series={[
            { name: 'Applications', color: CAT[0], points: m12.map((m) => ({ x: m.label, y: m.applications })) },
            { name: 'Interviews', color: CAT[1], points: m12.map((m) => ({ x: m.label, y: m.interviews })) },
          ]} h={250}
            /* [series][month]. Applications are applications; interviews are
               interviews, and they live on different pages. */
            picks={[
              m12.map((m): Pick => ({
                ...(m.applications
                  ? {
                    act: 'go',
                    v: applicationsUrl({
                      tab: 'all', apps: true, win: 'applied',
                      from: monthDays(m.month).from, to: monthDays(m.month).to,
                      deptId: d.scope.deptId,
                    }),
                  }
                  : {}),
                tip: {
                  label: `${m.label} \u00b7 applications`,
                  value: fmt.int(m.applications),
                  ...(m.applications
                    ? { action: `Open ${fmt.int(m.applications)} application${m.applications === 1 ? '' : 's'}` }
                    : {}),
                },
              })),
              m12.map((m): Pick => ({
                ...(m.interviews
                  ? {
                    act: 'go',
                    v: interviewsUrl({
                      fromAt: monthDays(m.month).fromAt, toAt: monthDays(m.month).toAt,
                    }),
                  }
                  : {}),
                tip: {
                  label: `${m.label} \u00b7 interviews`,
                  value: fmt.int(m.interviews),
                  note: 'Interviews are counted across the whole desk, whatever department is selected.',
                  ...(m.interviews
                    ? { action: `Open ${fmt.int(m.interviews)} interview${m.interviews === 1 ? '' : 's'}` }
                    : {}),
                },
              })),
            ] satisfies Picks2} />
          <Legend items={[
            { color: CAT[0], label: 'Applications', value: fmt.int(m12.reduce((n, m) => n + m.applications, 0)) },
            { color: CAT[1], label: 'Interviews', value: fmt.int(m12.reduce((n, m) => n + m.interviews, 0)) },
          ]} />
        </Card>

        <Card title="Conversion through the nine stages"
          sub="The right-hand figure is the share of people who entered that stage and went further."
          foot={
            <span className="t-foot">
              Applied and Sourced are alternative entries, so they share the top row; the assessment
              and the later interview rounds are skipped by some loops, so each row is measured
              against its own entrants rather than the row above. End to end:{' '}
              <b>{fmt.dec(top / (joined || 1), 1)}</b> applications per joiner and{' '}
              <b>{fmt.pct(offered ? joined / offered : 0)}</b> offer to joined.
            </span>
          }>
          <Funnel rows={d.funnel} picks={d.funnel.map((r): Pick | null => (r.n
            ? {
              act: 'go',
              v: applicationsUrl({
                tab: 'all', apps: true, win: 'touched', ...d.scope, reached: r.key,
              }),
              tip: {
                label: r.name,
                value: fmt.int(r.n),
                rows: [['Of everyone who applied', fmt.pct(r.convFromTop)]],
                action: `Open ${fmt.int(r.n)} application${r.n === 1 ? '' : 's'}`,
              },
            }
            : null))} />
        </Card>

        <Card title="Quality of hire"
          sub={`Mean submitted scorecard score for the ${fmt.int(d.quality.n)} joiners who have one.`}
          foot={
            <span className="t-foot">
              Mean <b>{orDash(d.quality.mean, (v) => fmt.dec(v, 2))}</b> against a goal of{' '}
              {fmt.dec(d.goalQuality ?? 0, 1)}. Joiners without a submitted scorecard are left out
              rather than counted as zero.
            </span>
          }>
          {d.quality.n ? (
            <Bars h={210} labelMax={6} color="var(--seq-3)"
              data={[1, 2, 3, 4, 5].map((n) => ({
                label: `${n} of 5`,
                value: d.quality.values.filter((x) => Math.round(x) === n).length,
              }))} />
          ) : <Empty icon="star" title="No scored joiners in this period" />}
        </Card>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Offer outcomes" sub="Every offer created in the period, by where it stands today."
          foot={
            <span className="t-foot">
              Acceptance above counts only accepted against declined; this shows the whole book,
              including offers still moving.
            </span>
          }>
          {d.offersTotal ? (
            <div className="pie-row">
              <Pie segments={d.offerStates} size={200} />
              <Legend items={d.offerStates.map((x, i) => ({
                color: x.color ?? RAMP[i % RAMP.length], label: x.label,
                value: `${fmt.int(x.value)} · ${fmt.pct(x.value / totalOffers)}`,
              }))} />
            </div>
          ) : <Empty icon="file" title="No offers in this period" />}
        </Card>

        <Card title="Twelve months, layered"
          sub={'Applications at the back, then interviews, offers sent and hires in front — each '
            + 'series as a sheet, so the shape of the year reads at a glance.'}
          foot={
            <span className="t-foot">
              The sheets overlap rather than stack — each is drawn from zero, so a height is always
              the month&rsquo;s own count.
            </span>
          }>
          <Waves series={[
            { name: 'Applications', points: m12.map((m) => ({ x: m.label.split(' ')[0], y: m.applications })) },
            { name: 'Interviews', points: m12.map((m) => ({ x: m.label.split(' ')[0], y: m.interviews })) },
            { name: 'Offers sent', points: m12.map((m) => ({ x: m.label.split(' ')[0], y: m.offersSent })) },
            { name: 'Hires', points: m12.map((m) => ({ x: m.label.split(' ')[0], y: m.hires })) },
          ]} h={260}
            /* The same four series as the cards above, so the same
               destinations. Offers sent has no list of its own that counts by
               the month it was sent, so that sheet explains itself. */
            picks={[
              m12.map((m): Pick => ({
                ...(m.applications
                  ? {
                    act: 'go',
                    v: applicationsUrl({
                      tab: 'all', apps: true, win: 'applied',
                      from: monthDays(m.month).from, to: monthDays(m.month).to,
                      deptId: d.scope.deptId,
                    }),
                  }
                  : {}),
                tip: {
                  label: `${m.label} \u00b7 applications`, value: fmt.int(m.applications),
                  ...(m.applications ? { action: `Open ${fmt.int(m.applications)}` } : {}),
                },
              })),
              m12.map((m): Pick => ({
                ...(m.interviews
                  ? {
                    act: 'go',
                    v: interviewsUrl({
                      fromAt: monthDays(m.month).fromAt, toAt: monthDays(m.month).toAt,
                    }),
                  }
                  : {}),
                tip: {
                  label: `${m.label} \u00b7 interviews`, value: fmt.int(m.interviews),
                  ...(m.interviews ? { action: `Open ${fmt.int(m.interviews)}` } : {}),
                },
              })),
              m12.map((m): Pick => ({
                tip: { label: `${m.label} \u00b7 offers sent`, value: fmt.int(m.offersSent) },
              })),
              m12.map((m): Pick => ({
                ...(m.hires
                  ? {
                    act: 'go',
                    v: applicationsUrl({
                      tab: 'hired', win: 'closed',
                      from: monthDays(m.month).from, to: monthDays(m.month).to,
                      deptId: d.scope.deptId,
                    }),
                  }
                  : {}),
                tip: {
                  label: `${m.label} \u00b7 hires`, value: fmt.int(m.hires),
                  ...(m.hires ? { action: `Open ${fmt.int(m.hires)}` } : {}),
                },
              })),
            ] satisfies Picks2} />
          <Legend items={[
            { color: RAMP[0], label: 'Applications', value: fmt.int(m12.reduce((n, m) => n + m.applications, 0)) },
            { color: RAMP[1], label: 'Interviews', value: fmt.int(m12.reduce((n, m) => n + m.interviews, 0)) },
            { color: RAMP[2], label: 'Offers sent', value: fmt.int(m12.reduce((n, m) => n + m.offersSent, 0)) },
            { color: RAMP[3], label: 'Hires', value: fmt.int(m12.reduce((n, m) => n + m.hires, 0)) },
          ]} />
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card flush title="Month by month">
          <Table cols={monthCols} rows={[...m12].reverse()} />
        </Card>
      </div>
    </>
  );
}
