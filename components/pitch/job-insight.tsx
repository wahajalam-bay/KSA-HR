import * as React from 'react';
import { Card, Chip, Bar } from '@/components/ui/primitives';
import { Donut } from '@/components/charts';
import { fmt } from '@/lib/format';
import { label as scoreLabel } from '@/lib/domain/score';
import type { PitchInsight } from '@/lib/queries/pitch';

/* What the sales pitch is telling the requisition. Not how one candidate did —
   that is on their panel — but what the whole cohort is consistently losing
   marks on, which is a fact about the brief as much as about the people. */

export function PitchInsightCard({ data }: { data: PitchInsight }) {
  const { project, rows, weakest } = data;
  return (
    <Card
      title="Sales pitch" icon="target"
      actions={
        <span className="row tight">
          <Chip tone="brand">{project ? project.name.split(' — ')[0] : 'no project'}</Chip>
          <Chip tone="info">{data.scored} pitched</Chip>
        </span>
      }
      sub={
        <>
          {project?.name ?? ''} — {fmt.int(data.briefed)} candidate{data.briefed === 1 ? '' : 's'} briefed,{' '}
          {fmt.int(data.scored)} scored
          {data.median != null ? `, median ${scoreLabel(data.median)}` : ''}.
        </>
      }
      foot={weakest ? (
        <span className="t-foot">
          Weakest across the pitches: <b>{weakest.name}</b> at {fmt.dec(weakest.avg, 1)} of 5 — worth a line
          in the JD, or a different project.
        </span>
      ) : undefined}
    >
      {data.scored ? (
        <div className="pie-row">
          <Donut segments={data.verdicts} size={150}
            centre={data.median == null ? '—' : String(data.median)} centreSub="median" />
          <div style={{ flex: 1, minWidth: 0 }}>
            {rows.map((x) => (
              <div className="cm" key={x.key}>
                <span>{x.name}</span>
                <Bar p={x.avg / 5} thin tone={x.avg < 3 ? 'bad' : x.avg < 4 ? 'warn' : undefined} />
                <b className="num">{fmt.dec(x.avg, 1)}</b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="t-sub">Nobody has pitched on this requisition yet.</p>
      )}
    </Card>
  );
}
