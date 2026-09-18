import * as React from 'react';
import { Card, Table, Avatar, StagePill, Chip, Bar, type Column } from '@/components/ui/primitives';
import { fmt } from '@/lib/format';
import type { RankedRow } from '@/lib/queries/feedback';

/* The requisition's live candidates in the order the panel actually put them —
   the weighted score across the kit's criteria, how many people have filed, how
   much they agree, and what to do next. */

type Row = RankedRow & { _act?: string; _v?: string };

export function RankingCard({ rows }: { rows: RankedRow[] }) {
  if (!rows.length) return null;

  const cols: Array<Column<Row>> = [
    { t: '#', n: true, f: (x) => <b>{x.feedback.rank}</b> },
    {
      t: 'Candidate',
      f: (x) => (
        <div className="row tight nowrap">
          <Avatar person={x} size="s" /><b>{x.name}</b>
        </div>
      ),
    },
    { t: 'Stage', f: (x) => <StagePill name={x.stageName} ordinal={x.stageOrdinal} /> },
    { t: 'Score', n: true, f: (x) => <b>{x.feedback.score}</b> },
    { t: 'Scorecards', n: true, f: (x) => fmt.int(x.feedback.done.length) },
    {
      t: 'Consensus',
      f: (x) => (x.feedback.consensus == null
        ? <span className="mut">—</span>
        : <Bar p={x.feedback.consensus} thin />),
    },
    {
      t: 'Recommendation',
      f: (x) => <Chip tone={x.feedback.tone || undefined}>{x.feedback.recommendation}</Chip>,
    },
  ];

  return (
    <Card title="Candidates ranked by feedback" icon="target" flush>
      <Table cols={cols} rows={rows.map((x) => ({ ...x, _act: 'drawer.open', _v: x.applicationId }))} />
    </Card>
  );
}
