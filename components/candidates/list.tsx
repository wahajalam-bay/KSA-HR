import * as React from 'react';
import { Avatar, StagePill, StatusChip, Stars, Chip, Empty, Btn } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import type { CandidateRow } from '@/lib/queries/candidates';

/* One row per person: who they are, where they are standing, who has put their
   name on them, and how long they have been there. Clicking opens the panel —
   the application's if they are on one, the person's if they are only on file. */

export function CandidateRows({ rows, total, shown, now }: {
  rows: CandidateRow[]; total: number; shown: number; now: Date;
}) {
  return (
    <>
      <div className="row" style={{ marginBottom: 9 }}>
        <span className="t-sub">
          {fmt.int(total)} {total === 1 ? 'person' : 'people'}
          {total > shown && ` · showing the first ${shown}`}
        </span>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {rows.map((c) => <CRow key={c.applicationId ?? c.candidateId} c={c} now={now} />)}
      </div>
    </>
  );
}

function CRow({ c, now }: { c: CandidateRow; now: Date }) {
  return (
    <button className="crow"
      data-act={c.applicationId ? 'drawer.open' : 'drawer.cand'}
      data-v={c.applicationId ?? c.candidateId}>
      <Avatar person={c} size="m" />
      <span className="bd">
        <b>{c.name}</b>
        <span>
          {c.currentTitle} at {c.currentCompany} · {c.locationCity} ·{' '}
          {c.yearsExperience ? `${c.yearsExperience}y experience` : 'graduate'}
        </span>
      </span>
      <span className="mid">
        {c.jobId && c.stageName
          ? <StagePill name={c.stageName} ordinal={c.stageOrdinal} />
          : <Chip>Talent pool</Chip>}
        {c.status && c.status !== 'active' && <StatusChip status={c.status} />}
        {c.rating != null && <Stars n={c.rating} size={10} hideNum />}
        {c.claimedBy && (
          <span className="clm" title={`Tagged to ${c.claimedBy}${c.claimDaysLeft != null ? ` — ${c.claimDaysLeft} days left` : ''}`}>
            <Icon name="pin" size={10} />{fmt.first(c.claimedBy)}
          </span>
        )}
        {c.applications > 1 && (
          <span title={`In ${c.applications} pipelines`}><Icon name="link" size={13} /></span>
        )}
      </span>
      <span className="rt">
        <i className="trunc" title={c.jobTitle ?? ''}>{c.jobTitle ?? ''}</i>
        {c.sla
          ? <em className={c.sla.state === 'over' ? 'bad-t' : c.sla.state === 'due' ? 'warn-t' : ''}>
              {fmt.days(c.sla.days)} in stage
            </em>
          : <em>{ago(c.lastAt, now)}</em>}
      </span>
      <span className="chev"><Icon name="chev" size={15} /></span>
    </button>
  );
}
