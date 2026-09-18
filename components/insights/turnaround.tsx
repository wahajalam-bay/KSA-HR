import * as React from 'react';
import {
  Card, Kpi, Empty, Bar, Table, Avatar, StagePill, Btn, type Column,
} from '@/components/ui/primitives';
import {
  HBars, Line, Pie, Legend, Heat, type Pick, type Picks, type Picks2,
} from '@/components/charts';
import { applicationsUrl } from '@/lib/charts/drill';
import type { DrillScope } from '@/lib/queries/insights';

/** The last day of a calendar month, as a date. */
const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
import { RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import type { TatRow, MonthRow } from '@/lib/queries/analytics';

/* ─────────────────────────────────────────────────────────────────────────────
   Turnaround: how long each stage actually takes, against the time it gave
   itself, and who is stuck right now.

   The period governs the stage figures. The SLA breaches are always as of
   today, because a breach is a thing to do something about rather than a thing
   that happened in a window.
   ───────────────────────────────────────────────────────────────────────────*/

export type Breach = {
  id: string; name: string; photo: string | null; hue: number;
  jobTitle: string; stageName: string; stageOrdinal: number;
  days: number; sla: number; recruiterName: string | null;
  recruiterPhoto: string | null; recruiterHue: number;
};

export type TurnaroundData = {
  rows: TatRow[];
  timeToHire: { median: number; n: number };
  timeToFill: { median: number; n: number };
  firstResponse: { median: number; n: number };
  goalTimeToHire: number | null;
  live: number;
  breaches: Breach[];
  shown: Breach[];
  byStage: Array<{ keys: string[]; label: string; value: number }>;
  months: MonthRow[];
  heat: { rows: Array<{ label: string; values: Record<string, number | null> }>; cols: Array<{ key: string; name: string; short?: string }> };
  today: string;
  periodLabel: string;
  scope: DrillScope;
};

const dcell = (v: number, bad: boolean) => <span className={bad ? 'bad-t' : ''}>{fmt.dec(v, 1)}</span>;

export function Turnaround({ d }: { d: TurnaroundData }) {
  const worst = [...d.rows].sort((a, b) => (b.median - b.sla) - (a.median - a.sla))[0];
  const leaky = [...d.rows].filter((x) => x.n >= 50).sort((a, b) => b.breachRate - a.breachRate)[0];

  const stageCols: Array<Column<TatRow>> = [
    { t: 'Stage', f: (x) => <b>{x.name}</b> },
    { t: 'SLA', n: true, f: (x) => `${x.sla} d` },
    { t: 'Median', n: true, f: (x) => dcell(x.median, x.median > x.sla) },
    { t: 'p90', n: true, f: (x) => dcell(x.p90, x.p90 > x.sla) },
    { t: 'Spells', n: true, f: (x) => fmt.int(x.n) },
    { t: 'Past SLA', n: true, f: (x) => fmt.int(x.breaches) },
    {
      t: 'Breach rate',
      f: (x) => <Bar p={x.breachRate} thin
        tone={x.breachRate > 0.4 ? 'bad' : x.breachRate > 0.2 ? 'warn' : undefined}
        title={`${fmt.pct(x.breachRate)} of spells past SLA`} />,
    },
    { t: 'Open now', n: true, f: (x) => fmt.int(x.openNow) },
  ];

  const breachCols: Array<Column<Breach & { _act?: string; _v?: string }>> = [
    {
      t: 'Candidate',
      f: (a) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: a.name, photo: a.photo, hue: a.hue }} size="s" /><b>{a.name}</b>
        </div>
      ),
    },
    {
      t: 'Requisition',
      f: (a) => <span className="trunc" style={{ maxWidth: 230, display: 'inline-block' }}>{a.jobTitle}</span>,
    },
    { t: 'Stage', f: (a) => <StagePill name={a.stageName} ordinal={a.stageOrdinal} /> },
    { t: 'In stage', n: true, f: (a) => <b className="bad-t">{fmt.dec(a.days, 0)} d</b> },
    { t: 'SLA', n: true, f: (a) => `${a.sla} d` },
    { t: 'Over by', n: true, f: (a) => `${fmt.dec(a.days - a.sla, 0)} d` },
    {
      t: 'Recruiter',
      f: (a) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: a.recruiterName ?? '', photo: a.recruiterPhoto, hue: a.recruiterHue }} size="s" />
          <span>{a.recruiterName}</span>
        </div>
      ),
    },
  ];

  const totalStuck = d.byStage.reduce((n, x) => n + x.value, 0) || 1;

  /* A median is a duration, not a set of records — so the bar says out loud
     how many applications its drill will find: the ones standing in that stage
     right now. The median itself was taken over spells, which include spells
     that ended, and there is no list of those. */
  const stagePicks: Picks = d.rows.map((x): Pick => ({
    ...(x.openNow
      ? {
        act: 'go',
        v: applicationsUrl({ tab: 'pipeline', stages: [x.key], deptId: d.scope.deptId }),
        n: x.openNow,
      }
      : {}),
    tip: {
      label: x.name,
      value: `${fmt.dec(x.median, 1)} days`,
      rows: [
        ['Stage SLA', `${x.sla} days`],
        ['90th percentile', `${fmt.dec(x.p90, 1)} days`],
        ['Spells measured', fmt.int(x.n)],
        ['Past the SLA', `${fmt.int(x.breaches)} · ${fmt.pct(x.breachRate)}`],
        ['Standing here now', fmt.int(x.openNow)],
      ],
      ...(x.median > x.sla ? { note: 'The median itself is past the SLA.' } : {}),
      ...(x.openNow
        ? { action: `Open ${fmt.int(x.openNow)} live application${x.openNow === 1 ? '' : 's'}` }
        : {}),
    },
  }));

  /* The monthly line is the median for the people who joined in that calendar
     month, whatever the period control says — so the drill carries the month
     and the department, and not the period. */
  const monthPicks: Picks2 = [d.months.map((m): Pick => ({
    ...(m.hires
      ? {
        act: 'go',
        v: applicationsUrl({
          tab: 'hired', win: 'closed',
          from: `${m.month}-01`, to: monthEnd(m.month), deptId: d.scope.deptId,
        }),
        n: m.hires,
      }
      : {}),
    tip: {
      label: m.label,
      value: m.hires ? `${fmt.dec(m.timeToHire, 0)} days` : 'no hires',
      rows: [
        ['Hires that month', fmt.int(m.hires)],
        ...(d.goalTimeToHire != null
          ? [['Goal', `${d.goalTimeToHire} days`] as [string, string]] : []),
      ],
      ...(m.hires ? { action: `Open ${fmt.int(m.hires)} hire${m.hires === 1 ? '' : 's'}` } : {}),
    },
  }))];

  const stuckPicks: Picks = d.byStage.map((x): Pick => ({
    act: 'go',
    v: applicationsUrl({
      tab: 'pipeline', stages: x.keys, overSla: true, deptId: d.scope.deptId,
    }),
    tip: {
      label: x.label,
      value: `${fmt.int(x.value)} past SLA`,
      rows: [['Share of everything past SLA', fmt.pct(x.value / totalStuck)]],
      action: `Open ${fmt.int(x.value)} application${x.value === 1 ? '' : 's'}`,
    },
  }));

  /* The heat cells are medians per recruiter per stage. There is no list of
     "the spells behind this median", so they explain themselves. */
  const heatPicks: Picks2 = d.heat.rows.map((r) => d.heat.cols.map((c): Pick => ({
    tip: {
      label: `${r.label} · ${c.name}`,
      value: r.values[c.key] == null ? 'no spells' : `${fmt.dec(r.values[c.key]!, 1)} days`,
      note: r.values[c.key] == null
        ? 'None of their applications has spent time in this stage.'
        : undefined,
    },
  })));

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Median time to hire" value={fmt.dec(d.timeToHire.median, 0)} unit="days" accent
          def={`Application arriving to hire closed. Median of ${d.timeToHire.n} hires.`}
          sub={`From the application arriving to the hire closing · goal ${d.goalTimeToHire ?? '—'} days`} />
        <Kpi label="Median time to fill" value={fmt.dec(d.timeToFill.median, 0)} unit="days"
          def={`Requisition opening to the hire closing. Median of ${d.timeToFill.n} filled openings.`}
          sub={`From the requisition opening to the hire closing · ${fmt.int(d.timeToFill.n)} openings`} />
        <Kpi label="Time to first response" value={fmt.dec(d.firstResponse.median, 1)} unit="days"
          def="First move on the application after it arrived — the first history step to the second."
          sub={`From arrival to the first move on the application · ${fmt.int(d.firstResponse.n)} measured`} />
        <Kpi label="Past SLA now" value={fmt.int(d.breaches.length)}
          def={"Live applications whose days in the current stage exceed that stage’s SLA."}
          sub={`${fmt.pct(d.live ? d.breaches.length / d.live : 0)} of ${fmt.int(d.live)} live — as of ${d.today}`} />
      </div>

      <div className="stack">
        <Card title="Days in stage against SLA"
          sub={
            <>
              Median and 90th percentile dwell time in each of the nine stages. A bar is red only
              where the median itself has passed the SLA
              {worst && worst.median > worst.sla
                ? ` — today only ${worst.name}, and by ${fmt.dec(worst.median - worst.sla, 1)} days`
                : ' — no stage is over on the median today'}. The median hides the spread, so read
              the breach rate beside it
              {leaky ? `: ${leaky.name} loses ${fmt.pct(leaky.breachRate)} of its spells to the SLA` : ''}.
            </>
          }
          foot={
            <span className="t-foot">
              A spell is one application&rsquo;s stay in one stage, taken from that
              application&rsquo;s own history: the step into the stage to the step out of it, and for
              a stage nobody has left yet, the step in to {d.today}. Still-open spells are therefore
              truncated and pull the medians down, not up. p90 is the 90th percentile of the same
              spells.
            </span>
          }>
          <HBars format="dec1" picks={stagePicks}
            data={d.rows.map((x) => ({
              label: x.name, value: Math.round(x.median * 10) / 10,
              marker: x.sla, markerLabel: `SLA ${x.sla} days`,
              scaleHint: x.sla <= 10 ? x.sla : 0,
              note: `SLA ${x.sla} d${x.breaches ? ` · ${fmt.int(x.breaches)} past` : ''}`,
              color: x.median > x.sla ? 'var(--bad)' : 'var(--seq-3)',
            }))} />
          <div style={{ marginTop: 16 }}>
            <Table cols={stageCols} rows={d.rows} />
          </div>
        </Card>

        <div className="grid g-2">
          <Card title="Time to hire, by month"
            sub="Median days from application to hire for the people who joined in each month."
            foot={
              <span className="t-foot">
                Goal {d.goalTimeToHire ?? '—'} days. A month with no hires reads as zero rather than
                being left out, so the sheet stays continuous.
              </span>
            }>
            <Line format="days" h={240} dots picks={monthPicks}
              series={[{
                name: 'Median time to hire',
                points: d.months.map((m) => ({
                  x: m.label.split(' ')[0], y: m.hires ? Math.round(m.timeToHire) : 0,
                })),
              }]} />
          </Card>

          <Card title="Where the live board is stuck" sub="Live applications past their stage SLA, by stage."
            foot={
              <span className="t-foot">
                {fmt.int(d.breaches.length)} of {fmt.int(d.live)} live applications. The list below
                names them, worst first.
              </span>
            }>
            {d.byStage.length ? (
              <div className="pie-row">
                <Pie segments={d.byStage} size={200} picks={stuckPicks} />
                <Legend picks={stuckPicks} items={d.byStage.map((x, i) => ({
                  color: RAMP[i % RAMP.length], label: x.label,
                  value: `${fmt.int(x.value)} · ${fmt.pct(x.value / totalStuck)}`,
                }))} />
              </div>
            ) : <Empty icon="check" title="Nothing is past SLA" />}
          </Card>
        </div>

        <Card title="Median days in stage, by recruiter"
          sub={'Darker is slower. Read across a row for one recruiter’s rhythm and down a column '
            + 'to find a stage that is slow for everyone; a blank cell means none of their '
            + 'applications has spent time in that stage.'}
          foot={
            <span className="t-foot">
              Recruiter rows come from each owner&rsquo;s own applications ({d.periodLabel} plus
              everything still open), so a row with a thin pipeline moves on very few spells.
            </span>
          }>
          <Heat rows={d.heat.rows} cols={d.heat.cols} format="dec1" picks={heatPicks} />
        </Card>

        <Card flush title={`Past SLA now — ${fmt.int(d.breaches.length)} applications`}
          actions={<Btn size="sm" variant="out" action="data.export" v="sla_breaches" icon="dl" iconSize={13}>
            Export all {fmt.int(d.breaches.length)}
          </Btn>}
          foot={
            <span className="t-foot">
              Worst first, by how far past the SLA rather than by raw age — a 30-day Joined stage
              should not outrank a 3-day Applied stage. Showing {fmt.int(d.shown.length)} of{' '}
              {fmt.int(d.breaches.length)}; the export has all of them. Click a row to open the
              candidate.
            </span>
          }>
          <Table cols={breachCols}
            rows={d.shown.map((a) => ({ ...a, _act: 'drawer.open', _v: a.id }))}
            emptyIcon="check" emptyTitle="Nothing is past SLA"
            emptySub="Every live application is inside its stage SLA today." />
        </Card>
      </div>
    </>
  );
}
