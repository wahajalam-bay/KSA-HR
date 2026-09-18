import * as React from 'react';
import { Card, Timeline, Empty } from '@/components/ui/primitives';
import { ago, fmt } from '@/lib/format';
import type { ActivityItem } from '@/lib/queries/job-tabs';

/* The activity feed, derived from the records rather than kept as a second log
   beside them: the stage hops, the scorecards, the comments and the offer
   milestones, told as sentences. */

export function describe(a: ActivityItem): React.ReactNode {
  const name = a.candidateName ?? 'The candidate';
  switch (a.kind) {
    case 'created':
      return <><b>{name}</b> entered the {a.jobTitle ?? ''} pipeline at {a.stageName}</>;
    case 'stage':
      return <>Moved to <b>{a.stageName}</b></>;
    case 'evaluation':
      return <><b>{a.actorName}</b> submitted a scorecard — {String(a.verdict ?? '').replace('_', ' ')}
        {a.overall != null && ` (${fmt.dec(a.overall, 1)})`}</>;
    case 'comment':
      return <><b>{a.actorName}</b> commented: {String(a.note ?? '').slice(0, 160)}</>;
    case 'offer_sent':
      return <>Offer sent — {fmt.sar(a.amount)} monthly basic</>;
    case 'offer_signed':
      return <>Offer <b>signed</b></>;
    case 'hired':
      return <><b>Joined</b> as {a.jobTitle ?? ''}</>;
    case 'rejected':
      return <>Disqualified at {a.stageName}{a.note ? ` — ${a.note}` : ''}</>;
    case 'withdrawn':
      return <>Withdrew from the process</>;
    default:
      return a.kind;
  }
}

export function ActivityTab({ items, now }: { items: ActivityItem[]; now: Date }) {
  if (!items.length) return <Empty icon="clock" title="Nothing recorded yet" />;
  return (
    <Card title="Recent activity">
      <Timeline items={items.map((a) => ({
        at: a.at,
        when: ago(a.at, now),
        byName: a.actorName,
        on: a.kind === 'stage',
        text: describe(a),
      }))} />
    </Card>
  );
}
