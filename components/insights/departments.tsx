import * as React from 'react';
import { Card, Kpi, Empty, Table, AvatarStack, type Column } from '@/components/ui/primitives';
import { Grouped, Pie, Legend, HBars } from '@/components/charts';
import { CAT, RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import type { DeptStat } from '@/lib/queries/analytics';

/* Where the demand sits. People in play per opening is the thinnest number on
   the page — under two, the shortlist has no slack. */

export type DeptRow = DeptStat & { managers: string[] };

export type DepartmentsData = {
  rows: DeptRow[];
  medianTimeToHire: number;
  goalTimeToHire: number | null;
};

export function Departments({ d }: { d: DepartmentsData }) {
  const rows = d.rows;
  const sum = (f: (r: DeptRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const withTth = rows.filter((x) => x.hires);

  const live = [...rows].filter((x) => x.live).sort((a, b) => b.live - a.live);
  const top = live.slice(0, 4);
  const rest = live.slice(4).reduce((n, x) => n + x.live, 0);
  const segs = rest ? [...top.map((x) => ({ label: x.name, value: x.live })), { label: 'Other departments', value: rest }]
    : top.map((x) => ({ label: x.name, value: x.live }));
  const tot = segs.reduce((n, x) => n + x.value, 0) || 1;

  const cols: Array<Column<DeptRow>> = [
    { t: 'Department', f: (x) => <b>{x.name}</b> },
    {
      t: 'Hiring managers',
      f: (x) => (x.managers.length ? (
        <div className="row tight nowrap">
          <AvatarStack people={x.managers} />
          <span className="t-sub">{fmt.list(x.managers)}</span>
        </div>
      ) : <span className="mut">no open requisitions · head {x.head}</span>),
    },
    { t: 'Open requisitions', n: true, f: (x) => fmt.int(x.openReqs) },
    { t: 'Openings', n: true, f: (x) => <b>{fmt.int(x.openings)}</b> },
    { t: 'Live pipeline', n: true, f: (x) => fmt.int(x.live) },
    {
      t: 'Per opening', n: true,
      f: (x) => (x.openings ? fmt.dec(x.live / x.openings, 1) : <span className="mut">—</span>),
    },
    { t: 'Hires', n: true, f: (x) => fmt.int(x.hires) },
    {
      t: 'Median time to hire', n: true,
      f: (x) => (x.hires ? fmt.days(x.timeToHire) : <span className="mut">—</span>),
    },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Open requisitions" value={fmt.int(sum((x) => x.openReqs))}
          def="Requisitions with an open status right now, whatever the period."
          sub={`across ${fmt.int(rows.filter((x) => x.openReqs).length)} departments`} />
        <Kpi label="Openings" value={fmt.int(sum((x) => x.openings))} accent
          def="Seats on those open requisitions — a requisition can carry several."
          sub={`${fmt.dec(sum((x) => x.openings) / (sum((x) => x.openReqs) || 1), 1)} seats per requisition`} />
        <Kpi label="Live pipeline" value={fmt.int(sum((x) => x.live))}
          def={"Active and on-hold applications against that department’s requisitions."}
          sub={`${fmt.dec(sum((x) => x.live) / (sum((x) => x.openings) || 1), 1)} people in play per opening`} />
        <Kpi label="Hires" value={fmt.int(sum((x) => x.hires))}
          def={"Hires closed inside the period, attributed to the requisition’s department."}
          sub={`median time to hire ${fmt.days(d.medianTimeToHire)} across all departments`} />
      </div>

      <div className="grid g-2">
        <Card title="Openings against hires"
          sub="Seats still open today beside hires closed in the period — both are people, so one axis.">
          <Grouped data={rows.map((x) => ({ label: x.name, openings: x.openings, hires: x.hires }))}
            keys={[
              { key: 'openings', name: 'Openings still open', color: CAT[0] },
              { key: 'hires', name: 'Hires in the period', color: CAT[1] },
            ]} h={250} />
          <Legend items={[
            { color: CAT[0], label: 'Openings still open' },
            { color: CAT[1], label: 'Hires in the period' },
          ]} />
        </Card>

        <Card title="Where the live pipeline sits"
          sub="Active and on-hold applications by department, today.">
          {segs.length ? (
            <div className="pie-row">
              <Pie segments={segs} size={200} />
              <Legend items={segs.map((x, i) => ({
                color: RAMP[i % RAMP.length], label: x.label,
                value: `${fmt.int(x.value)} · ${fmt.pct(x.value / tot)}`,
              }))} />
            </div>
          ) : <Empty icon="users" title="Nobody in the pipeline" />}
        </Card>

        <Card title="Median time to hire by department"
          sub="Departments with at least one hire in the period. One hue — this is magnitude."
          foot={
            <span className="t-foot">
              Against a company goal of {d.goalTimeToHire ?? '—'} days. A department with two hires
              can sit anywhere on this chart — read the hire count in the label.
            </span>
          }>
          {withTth.length ? (
            <HBars format="days"
              data={[...withTth].sort((a, b) => b.timeToHire - a.timeToHire).map((x) => ({
                label: x.name, value: Math.round(x.timeToHire), note: `${fmt.int(x.hires)} hires`,
              }))} />
          ) : <Empty icon="clock" title="No hires in this period" />}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card flush title="Demand by department"
          foot={
            <span className="t-foot">
              Hiring managers are the named managers on that department&rsquo;s open requisitions;
              where none are open the department head is shown instead. People in play per opening
              is the thinnest of these numbers — under two, the shortlist has no slack.
            </span>
          }>
          <Table cols={cols} rows={rows} />
        </Card>
      </div>
    </>
  );
}
