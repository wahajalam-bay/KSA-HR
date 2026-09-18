import * as React from 'react';
import { Card, Kpi, Bar, Table, Avatar, type Column } from '@/components/ui/primitives';
import { Line } from '@/components/charts';
import { fmt } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   Quality of hire.

   A hire counts once the person has been here three months and has not been let
   go. The rate is the passes among the hires whose three months are up; the
   ones still inside are named rather than counted, and a month is only plotted
   once half its hires have had their three months — otherwise the trend is a
   picture of how recently we hired.
   ───────────────────────────────────────────────────────────────────────────*/

export type QualityCut = {
  key: string; hired: number; decided: number; passed: number; failed: number;
  inside: number; rate: number | null;
};

export type FailRow = {
  employeeId: string; name: string; title: string;
  deptName: string; source: string | null; recruiterName: string | null;
  startDate: string; decidedOn: string | null; lasted: number; reason: string | null;
  _act?: string; _v?: string;
};

export type QualityData = {
  rate: number | null;
  prevRate: number | null;
  hired: number;
  decided: number;
  passed: number;
  failed: number;
  inside: number;
  reasons: Array<{ reason: string; n: number }>;
  months: Array<{ month: string; label: string; hired: number; decided: number; passed: number; rate: number | null }>;
  settling: Array<{ label: string; hired: number; decided: number }>;
  bySource: QualityCut[];
  byRecruiter: QualityCut[];
  byDept: QualityCut[];
  byJob: QualityCut[];
  fails: FailRow[];
  periodLabel: string;
};

const rateCell = (x: QualityCut) => (x.rate == null ? <>—</> : (
  <span className="row tight">
    <b className="num">{fmt.pct(x.rate)}</b>
    <Bar p={x.rate} thin tone={x.rate >= 0.9 ? undefined : x.rate >= 0.75 ? 'warn' : 'bad'} />
  </span>
));

function CutTable({ rows, label, title, head, icon, foot }: {
  rows: QualityCut[]; label: string; title: string; head: string; icon: string; foot?: string;
}) {
  const cols: Array<Column<QualityCut>> = [
    { t: head, cls: 'wrap', f: (x) => <b>{x.key}</b> },
    { t: 'Hired', n: true, f: (x) => fmt.int(x.hired) },
    { t: 'Decided', n: true, f: (x) => fmt.int(x.decided) },
    { t: 'Passed', n: true, f: (x) => fmt.int(x.passed) },
    { t: 'Left inside 3 months', n: true, f: (x) => (x.failed ? <span className="bad-t">{x.failed}</span> : <>—</>) },
    { t: 'Still inside', n: true, f: (x) => (x.inside ? <span className="mut">{x.inside}</span> : <>—</>) },
    { t: 'Quality of hire', n: true, f: rateCell },
  ];
  return (
    <Card flush title={title} icon={icon as any}
      actions={
        <span className="t-foot">
          {rows.length} {label}{rows.length === 1 ? '' : 's'} · two decided hires or more
        </span>
      }
      foot={foot ? <span className="t-foot">{foot}</span> : undefined}>
      <Table cols={cols} rows={rows} emptyIcon="shield" emptyTitle={`Nothing decided by ${label} yet`} />
    </Card>
  );
}

export function Quality({ d }: { d: QualityData }) {
  const trend = d.rate != null && d.prevRate ? (d.rate - d.prevRate) / d.prevRate : null;

  const failCols: Array<Column<FailRow>> = [
    {
      t: 'Joiner', cls: 'wrap',
      f: (e) => (
        <div className="row tight nowrap">
          <Avatar person={e.name} size="s" />
          <span className="ivwho"><b>{e.name}</b><em>{e.title}</em></span>
        </div>
      ),
    },
    { t: 'Department', f: (e) => <span className="t-sub">{e.deptName}</span> },
    { t: 'Source', f: (e) => <span className="t-sub">{e.source ?? '—'}</span> },
    { t: 'Recruiter', f: (e) => <span className="t-sub">{fmt.first(e.recruiterName ?? '—')}</span> },
    { t: 'Started', n: true, f: (e) => fmt.date(e.startDate) },
    { t: 'Lasted', n: true, f: (e) => `${e.lasted} d` },
    { t: 'Why', cls: 'wrap', f: (e) => e.reason ?? '—' },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Quality of hire" value={d.rate == null ? '—' : fmt.pct(d.rate)} accent
          sub={`${fmt.int(d.passed)} of ${fmt.int(d.decided)} decided hires`}
          trendValue={trend}
          def={'A hire counts once the person has been here three months and has not been let go. The '
            + 'rate is the passes among the hires whose three months are up; the trend compares the '
            + 'period before.'} />
        <Kpi label="Hires counted" value={fmt.int(d.decided)}
          sub={`of ${fmt.int(d.hired)} who started in ${d.periodLabel}`}
          def="Hires whose first three months are behind them and have a decision on file." />
        <Kpi label="Still inside three months" value={fmt.int(d.inside)}
          sub="not counted either way yet"
          def="Hires who have not finished probation. Counting them as good would flatter the number." />
        <Kpi label="Left inside three months" value={fmt.int(d.failed)} inverse
          sub={d.reasons.length ? `most often: ${d.reasons[0].reason.toLowerCase()}` : 'nobody'}
          def="Hires let go, or who resigned, before the three months were up." />
      </div>

      <div className="grid g-side" style={{ marginBottom: 14 }}>
        <Card title="Quality of hire, month by month" icon="chart"
          sub="By the month they started. A month only settles once its hires have had their three months."
          foot={
            <span className="t-foot">
              A month is plotted once half its hires have had their three months.{' '}
              {d.settling.length
                ? `${d.settling.map((m) => m.label).join(', ')} ${d.settling.length === 1 ? 'is' : 'are'} still settling — ${fmt.int(d.inside)} hire${d.inside === 1 ? '' : 's'} are inside their three months.`
                : `${fmt.int(d.inside)} hire${d.inside === 1 ? '' : 's'} are still inside theirs.`}
            </span>
          }>
          {d.months.length ? (
            <Line h={230} dots={d.months.length <= 8} maxTicks={12} format="pctWhole"
              series={[{
                name: 'Quality of hire',
                points: d.months.map((m) => ({ x: m.label, y: Math.round((m.rate ?? 0) * 100) })),
              }]} />
          ) : <p className="t-sub">No hire has finished their three months in this window yet.</p>}
        </Card>

        <Card title="Why they did not last" icon="alert"
          foot={<span className="t-foot">Recorded at the probation review, on the joiner&rsquo;s record.</span>}>
          {d.reasons.length ? (
            <div className="stack sm">
              {d.reasons.map((x) => (
                <div className="cm" key={x.reason}>
                  <span>{x.reason}</span>
                  <Bar p={x.n / d.reasons[0].n} thin tone="bad" />
                  <b className="num">{x.n}</b>
                </div>
              ))}
            </div>
          ) : <p className="t-sub">Nobody has left inside their three months in this window.</p>}
        </Card>
      </div>

      <div style={{ marginBottom: 14 }}>
        <CutTable rows={d.bySource} label="channel" title="By where the hire came from" icon="search"
          head="Channel"
          foot={'The number that tells you which channels are worth the money — a channel that fills '
            + 'fast and loses people in ten weeks is not cheap.'} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <CutTable rows={d.byRecruiter} label="recruiter" title="By recruiter" icon="users"
          head="Recruiter"
          foot={'Hires that lasted, not hires made. Small numbers move this a lot — two decided hires '
            + 'is the minimum shown.'} />
      </div>
      <div className="grid g-2">
        <CutTable rows={d.byDept} label="department" title="By department" icon="grid" head="Department" />
        <CutTable rows={d.byJob} label="requisition" title="By requisition" icon="brief" head="Requisition" />
      </div>

      {!!d.fails.length && (
        <div style={{ marginTop: 14 }}>
          <Card flush icon="alert" title={`The ${d.fails.length} who did not make it`}
            foot={<span className="t-foot">Click a row for the joiner&rsquo;s record and the note from the review.</span>}>
            <Table cols={failCols} emptyIcon="check" emptyTitle="Nobody"
              rows={d.fails.map((e) => ({
                ...e, _act: 'go', _v: `/onboarding?tab=probation&emp=${e.employeeId}`,
              }))} />
          </Card>
        </div>
      )}
    </>
  );
}
