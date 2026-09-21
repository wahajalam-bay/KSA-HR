import * as React from 'react';
import { Avatar, StagePill, StatusChip, Stars, Chip, Empty, Btn } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import type { CandidateRow } from '@/lib/queries/candidates';

/* One row per person: who they are, where they are standing, who has put their
   name on them, and how long they have been there. Clicking opens the panel —
   the application's if they are on one, the person's if they are only on file. */

export function CandidateRows({ rows, total, shown, now, unit = 'person', pager }: {
  rows: CandidateRow[]; total: number; shown: number; now: Date;
  /** The pager for this list, when the list has more than one page. */
  pager?: React.ReactNode;
  /* Two of the tabs, and any list a chart sends here, are lists of
     APPLICATIONS — somebody live on two boards is two rows. Saying "people"
     over those rows would make the count read as wrong against the chart it
     came from, when it is the word that is wrong. */
  unit?: 'person' | 'application';
}) {
  const noun = unit === 'application'
    ? `${total === 1 ? 'application' : 'applications'}`
    : `${total === 1 ? 'person' : 'people'}`;
  return (
    <>
      <div className="row" style={{ marginBottom: 9 }}>
        <span className="t-sub">
          {fmt.int(total)} {noun}
          {total > shown && ` · ${shown} on this page`}
        </span>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {rows.map((c) => <CRow key={c.applicationId ?? c.candidateId} c={c} now={now} />)}
      </div>
      {pager}
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
