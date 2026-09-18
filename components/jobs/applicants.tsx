import * as React from 'react';
import {
  Card, Table, Seg, Avatar, StagePill, StatusChip, Stars, Bar, Btn, Push, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { SourceMark } from './source-mark';
import { ApplicationSearchBar } from './search-bar';
import { fmt, dateWindowLabel } from '@/lib/format';
import { routeMeta } from '@/lib/domain/sourcing';
import { verdict as skillVerdict } from '@/lib/domain/skills';
import type { jobApplicants } from '@/lib/queries/job-tabs';

/* All applicants: everybody who ever applied to this requisition, whatever the
   route and whatever became of them, with the "To the JD" column that sorts the
   pile by how much of the description each person actually covers. */

type Data = Awaited<ReturnType<typeof jobApplicants>>;
type Row = Data['rows'][number] & { _act?: string; _v?: string };

export function ApplicantsTab({ job, data, sp, now }: {
  job: any; data: Data; sp: Record<string, string>; now: Date;
}) {
  const searching = !!(sp.q || sp.from || sp.to || sp.route);
  const windowLabel = dateWindowLabel(sp.from, sp.to);
  const byFit = sp.sort === 'fit';

  const cols: Array<Column<Row>> = [
    {
      t: 'Candidate',
      f: (a) => (
        <div className="row tight nowrap">
          <Avatar person={a} size="s" /><b>{a.name}</b>
        </div>
      ),
    },
    { t: 'Stage', f: (a) => <StagePill name={a.stageName} ordinal={a.stageOrdinal} /> },
    { t: 'Status', f: (a) => <StatusChip status={a.status} /> },
    { t: 'Rating', f: (a) => <Stars n={a.rating} size={11} /> },
    {
      t: 'To the JD', n: true, cls: 'only-wide',
      f: (a) => {
        if (a.fit == null) return <span className="mut">—</span>;
        const [, tone] = skillVerdict(a.fit);
        return (
          <span className="row tight nowrap">
            <b className={`num ${tone === 'bad' ? 'bad-t' : tone === 'warn' ? 'warn-t' : ''}`}>{fmt.pct(a.fit)}</b>
            <Bar p={a.fit} thin tone={tone === 'ok' ? undefined : tone} />
          </span>
        );
      },
    },
    {
      t: 'How they came', cls: 'wrap',
      f: (a) => (
        <span className="row tight nowrap">
          <SourceMark route={a.route} source={a.source} /><span className="t-sub">{a.source}</span>
        </span>
      ),
    },
    { t: 'Applied', n: true, f: (a) => fmt.date(a.appliedAt) },
    {
      t: 'In stage', n: true,
      f: (a) => {
        const over = a.daysInStage > a.sla;
        const due = !over && a.daysInStage > a.sla * 0.7;
        return <span className={over ? 'bad-t' : due ? 'warn-t' : ''}>{fmt.days(a.daysInStage)}</span>;
      },
    },
  ];

  const routeCounts = (['internal', 'hunt', 'linkedin'] as const)
    .map((k) => ({ key: k, n: data.rows.filter((r) => r.route === k).length }));

  return (
    <>
      <div className="filters">
        <ApplicationSearchBar q={sp.q ?? ''} from={sp.from ?? ''} to={sp.to ?? ''}
          placeholder="Search this requisition by applicant name…" />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Seg action="job.route" active={sp.route || 'all'} options={[
          { v: 'all', t: `Every route · ${data.total}` },
          ...routeCounts.filter((c) => c.n).map((c) => ({
            v: c.key, t: `${routeMeta(c.key).name.replace(' company page', '')} · ${c.n}`,
          })),
        ]} />
        <Push />
        <span className="t-foot">Everyone who applied, by whichever route.</span>
      </div>

      <Card
        flush
        title={searching ? `${data.rows.length} matching applicants` : `${data.total} applicants`}
        actions={
          <span className="row tight">
            <span className="t-foot">
              {searching
                ? <>{data.rows.length} of {data.total}{sp.q ? ` match “${sp.q}”` : ''}{windowLabel ? ` · applied ${windowLabel}` : ''}{sp.route ? ` · ${routeMeta(sp.route).name.toLowerCase()}` : ''}</>
                : <>{data.total} in all, newest first</>}
            </span>
            {searching && <Btn size="xs" variant="ghost" action="job.clearq" icon="x" iconSize={11}>Clear</Btn>}
            <Btn size="xs" variant={byFit ? 'pri' : 'ghost'} action="job.fitSort" icon="target" iconSize={11}
              title="Order by how much of the job description each applicant covers">
              {byFit ? 'By fit to the JD' : 'Sort by fit'}
            </Btn>
          </span>
        }
      >
        <Table
          cols={cols}
          rows={data.rows.map((a) => ({ ...a, _act: 'drawer.open', _v: a.id }))}
          emptyIcon="search" emptyTitle="Nobody on this requisition matches"
          emptySub="Try a wider search, or clear the dates."
        />
      </Card>
    </>
  );
}
