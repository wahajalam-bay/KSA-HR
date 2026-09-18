import * as React from 'react';
import { Card, Kpi, Bar, Table, Avatar, type Column } from '@/components/ui/primitives';
import { Rings, HBars } from '@/components/charts';
import { fmt } from '@/lib/format';
import type { RecruiterStat } from '@/lib/queries/analytics';

/* The recruiter comparison. Attainment is hires against each person's monthly
   target pro-rated across the period; SLA adherence is the share of their live
   applications still inside their stage SLA today, so it moves with a thin
   pipeline as well as with a slow one. */

export type RecruiterRow = RecruiterStat & {
  quality: number | null;
  qualityPassed: number;
  qualityDecided: number;
  qualityInside: number;
  _act?: string; _v?: string;
};

export const RECRUITER_SORTS: Record<string, (r: RecruiterRow) => number | string> = {
  name: (r) => r.person.name.toLowerCase(),
  hires: (r) => r.hires,
  attainment: (r) => (r.attainment == null ? -1 : r.attainment),
  live: (r) => r.livePipeline,
  tth: (r) => r.timeToHire || Number.MAX_SAFE_INTEGER,
  accept: (r) => (r.offerAccept == null ? -1 : r.offerAccept),
  sla: (r) => (r.slaRate == null ? -1 : r.slaRate),
  interviews: (r) => r.interviews,
  offers: (r) => r.offersSent,
  resp: (r) => r.responseDays || Number.MAX_SAFE_INTEGER,
  scorecards: (r) => r.scorecards,
  quality: (r) => (r.quality == null ? -1 : r.quality),
};

const orDash = (v: number | null, f: (n: number) => string) =>
  (v == null ? <span className="mut">—</span> : f(v));

const med = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function Recruiters({ rows, sortKey, sortDir }: {
  rows: RecruiterRow[]; sortKey: string; sortDir: 1 | -1;
}) {
  const lead = rows.find((x) => x.person.role === 'tal_lead');
  const sum = (f: (r: RecruiterRow) => number) => rows.reduce((n, r) => n + f(r), 0);

  const cols: Array<Column<RecruiterRow>> = [
    {
      t: 'Recruiter', sort: 'name',
      f: (x) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: x.person.name, photo: x.person.photo, hue: x.person.hue }} size="s" />
          <span><b>{x.person.name}</b><br /><em className="t-cap">{x.person.roleLabel}</em></span>
        </div>
      ),
    },
    {
      t: 'Hires', n: true, sort: 'hires',
      f: (x) => <><b>{fmt.int(x.hires)}</b> <span className="mut">/ {fmt.int(x.target)}</span></>,
    },
    {
      t: 'Attainment', sort: 'attainment',
      f: (x) => (x.attainment == null ? <span className="mut">—</span> : (
        <div className="row tight nowrap">
          <Bar p={x.attainment} thin
            tone={x.attainment >= 0.95 ? undefined : x.attainment >= 0.6 ? 'warn' : 'bad'}
            title={`${fmt.pct(x.attainment)} of target`} />
          <span className="num">{fmt.pct(x.attainment)}</span>
        </div>
      )),
    },
    { t: 'Live pipeline', n: true, sort: 'live', f: (x) => fmt.int(x.livePipeline) },
    {
      t: 'Median time to hire', n: true, sort: 'tth',
      f: (x) => (x.hires ? fmt.days(x.timeToHire) : <span className="mut">—</span>),
    },
    { t: 'Offer acceptance', n: true, sort: 'accept', f: (x) => orDash(x.offerAccept, fmt.pct) },
    {
      t: 'Quality of hire', sort: 'quality',
      f: (x) => (x.quality == null
        ? <span className="mut" title="No hire of theirs has finished three months in this period">—</span>
        : (
          <div className="row tight nowrap"
            title={`${x.qualityPassed} of ${x.qualityDecided} hires passed their three months${x.qualityInside ? `; ${x.qualityInside} still inside` : ''}`}>
            <Bar p={x.quality} thin tone={x.quality >= 0.9 ? undefined : x.quality >= 0.75 ? 'warn' : 'bad'} />
            <span className="num">{fmt.pct(x.quality)}</span>
          </div>
        )),
    },
    {
      t: 'SLA adherence', sort: 'sla',
      f: (x) => (x.slaRate == null ? <span className="mut">—</span> : (
        <div className="row tight nowrap">
          <Bar p={x.slaRate} thin
            tone={x.slaRate >= 0.8 ? undefined : x.slaRate >= 0.5 ? 'warn' : 'bad'}
            title={`${fmt.pct(x.slaRate)} of live applications inside SLA`} />
          <span className="num">{fmt.pct(x.slaRate)}</span>
        </div>
      )),
    },
    { t: 'Interviews', n: true, sort: 'interviews', cls: 'only-wide', f: (x) => fmt.int(x.interviews) },
    { t: 'Offers sent', n: true, sort: 'offers', cls: 'only-wide', f: (x) => fmt.int(x.offersSent) },
    {
      t: 'First response', n: true, sort: 'resp', cls: 'only-wide',
      f: (x) => (x.responseDays ? `${fmt.dec(x.responseDays, 1)} d` : <span className="mut">—</span>),
    },
    { t: 'Scorecards', n: true, sort: 'scorecards', cls: 'only-wide', f: (x) => fmt.int(x.scorecards) },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Recruiters" value={fmt.int(rows.length)}
          def="Staff with the recruiter or talent-lead role."
          sub={`${fmt.int(sum((x) => x.openReqs))} open requisitions between them`} />
        <Kpi label="Hires" value={fmt.int(sum((x) => x.hires))} accent
          def="Hires closed inside the period, credited to the owning recruiter."
          sub={`against a combined target of ${fmt.int(sum((x) => x.target))}`} />
        <Kpi label="Live pipeline" value={fmt.int(sum((x) => x.livePipeline))}
          def="Active and on-hold applications owned right now."
          sub={`median ${fmt.int(med(rows.map((x) => x.livePipeline)))} per recruiter`} />
        <Kpi label="Scorecards submitted" value={fmt.int(sum((x) => x.scorecards))}
          def="Evaluations these recruiters have submitted, all time — not limited by the period."
          sub={`median ${fmt.int(med(rows.map((x) => x.scorecards)))} per recruiter`} />
      </div>

      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <Card title="Attainment against target"
          sub={<>Hires in the period as a share of each recruiter&rsquo;s pro-rated target. Click a ring.</>}>
          <Rings items={rows.filter((x) => x.target).map((x) => ({
            name: `${fmt.first(x.person.name)} ${(x.person.name.split(' ')[1] ?? '').slice(0, 1)}.`,
            value: Math.min(1.5, x.attainment ?? 0),
            label: fmt.pct(x.attainment ?? 0),
            sub: `${fmt.int(x.hires)} of ${fmt.int(x.target)}`,
            title: `${x.person.name}: ${fmt.pct(x.attainment ?? 0)}`,
            act: 'go', v: `/team/${x.person.id}`,
          }))} />
        </Card>

        <Card title="Hires, with the target marked"
          sub="One bar per recruiter; the tick is their pro-rated target for the period.">
          <HBars data={[...rows].filter((x) => x.target || x.hires)
            .sort((a, b) => b.hires - a.hires)
            .map((x) => ({
              label: x.person.name, value: x.hires, marker: x.target,
              markerLabel: `target ${fmt.int(x.target)}`,
              note: x.attainment != null ? fmt.pct(x.attainment) : '',
              color: x.attainment == null ? 'var(--seq-2)'
                : x.attainment >= 0.95 ? 'var(--brand-500)'
                  : x.attainment >= 0.6 ? 'var(--seq-3)' : 'var(--warn)',
            }))} />
        </Card>
      </div>

      <Card flush title="Recruiter comparison"
        foot={
          <span className="t-foot">
            Click a row for the recruiter&rsquo;s own page. Attainment is hires against that
            person&rsquo;s monthly target pro-rated across the period
            {lead ? `, so ${fmt.first(lead.person.name)} reads high — as talent lead they carry a nominal target of ${lead.person.monthlyTarget} a month while owning the widest desk` : ''}.
            SLA adherence is the share of the recruiter&rsquo;s live applications that are still
            inside their stage SLA today, so it moves with a thin pipeline. The four right-hand
            columns are hidden on a narrow screen.
          </span>
        }>
        <div className="tw-trim">
          <Table cols={cols} sortAct="ins.sort" sortKey={sortKey} sortDir={sortDir}
            rows={rows.map((x) => ({ ...x, _act: 'go', _v: `/team/${x.person.id}` }))} />
        </div>
      </Card>
    </>
  );
}
