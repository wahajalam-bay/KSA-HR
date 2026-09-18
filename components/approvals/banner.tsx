import * as React from 'react';
import { Banner, Btn, Chip, Card, Li, Sp } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { ago, fmt } from '@/lib/format';
import { mayDecide, approveLabel, type Approval, type ApprovalStep } from '@/lib/queries/approvals';
import { can } from '@/lib/authz';
import type { Viewer } from '@/lib/auth/session';

/* The banner at the top of a requisition that is waiting on somebody, and the
   card that records what happened. The chain is the same engine for offers, so
   both read the same and neither can drift. */

/* Whether the banner will draw anything at all. The page asks first, because
   the gap under it belongs to the banner: reserving it for a banner that never
   comes pushes the whole requisition down by fourteen pixels. */
export const hasApprovalBanner = (job: { status: string }): boolean =>
  job.status === 'pending_approval' || job.status === 'draft';

export function ApprovalBanner({ approval, job, viewer, now }: {
  approval: Approval; job: any; viewer: Viewer; now: Date;
}) {
  if (job.status === 'pending_approval' && approval.state === 'pending') {
    const cur = approval.current;
    const may = can(viewer, 'approval.act') && mayDecide(viewer, cur);
    return (
      <Banner
        tone="warn" icon="shield"
        title={
          <>
            Awaiting approval — step {approval.done + 1} of {approval.total}: {cur?.label}{' '}
            ({cur?.approverName}) · requested by {approval.requestedByName ?? '—'} {ago(approval.requestedAt, now)}
          </>
        }
        body={approval.note
          ? <>“{approval.note}”</>
          : 'The requisition is not published to any channel until the chain closes; the Admin has the last word.'}
        action={may && cur ? (
          <span className="row tight">
            <Btn size="sm" variant="out" action="job.reject" v={job.id}>Send back</Btn>
            <Btn size="sm" variant="pri" action="job.approve" v={job.id} icon="check">
              {approveLabel(viewer, cur)}
            </Btn>
          </span>
        ) : <Chip tone="warn">With {cur?.approverName ?? 'the approver'}</Chip>}
      />
    );
  }

  if (job.status === 'draft') {
    const rejected = approval.state === 'rejected';
    return (
      <Banner
        tone={rejected ? 'warn' : 'info'} icon={rejected ? 'alert' : 'pencil'}
        title={rejected
          ? <>Sent back by {approval.decidedByName ?? '—'} {approval.decidedAt ? ago(approval.decidedAt, now) : ''}</>
          : 'Draft — not yet submitted'}
        body={rejected && approval.note
          ? <>“{approval.note}”</>
          : <>Submit it and the chain starts: {approval.steps.map((s) => s.label).join(', ') || 'the Admin'}. Nothing is published until it closes.</>}
        action={can(viewer, 'job.submit') ? (
          <Btn size="sm" variant="pri" action="job.submit" v={job.id} icon="arrR">
            {rejected ? 'Resubmit for approval' : 'Submit for approval'}
          </Btn>
        ) : undefined}
      />
    );
  }
  return null;
}

export function ApprovalHistory({ approval, viewer, now, publishedTo }: {
  approval: Approval; viewer: Viewer; now: Date; publishedTo?: string[];
}) {
  return (
    <Card
      title="Approval" icon="shield" flush
      actions={can(viewer, 'approval.configure')
        ? <Btn size="xs" variant="ghost" action="go" v="/settings?tab=approvals" icon="gear" iconSize={12}>Workflow</Btn>
        : undefined}
    >
      <div className="list flush">
        <Li icon="pencil" title={`Requested by ${approval.requestedByName ?? '—'}`}
          sub={fmt.when(approval.requestedAt)} right={<Chip>Submitted</Chip>} />
      </div>
      <StepList steps={approval.steps} now={now} />
      <div className="list flush">
        {approval.state === 'approved' && (
          <Li icon="zap" iconTone="brand" title="Published"
            sub={`${fmt.when(approval.decidedAt)} · ${publishedTo?.length ? fmt.list(publishedTo) : 'no channels live'}`}
            right={<Chip tone="ok">Live</Chip>} />
        )}
        {approval.state === 'rejected' && (
          <Li icon="alert" title={`Sent back by ${approval.decidedByName ?? '—'}`} sub={approval.note ?? ''}
            right={<Chip tone="warn">Sent back</Chip>} />
        )}
      </div>
    </Card>
  );
}

export function StepList({ steps, now, flush = true }: { steps: ApprovalStep[]; now: Date; flush?: boolean }) {
  return (
    <div className={`list${flush ? ' flush' : ''}`}>
      {steps.map((st, i) => (
        <Li
          key={st.id}
          icon={st.state === 'approved' ? 'check' : st.state === 'rejected' ? 'alert' : 'clock'}
          iconTone={st.state === 'approved' ? 'brand' : ''}
          title={<><span className="mut">{i + 1} ·</span> {st.label} — {st.approverName}</>}
          sub={
            <>
              {st.approverTitle ?? ''}
              {st.conditionText ? ` · ${st.conditionText}` : ''}
              {st.state === 'approved' && st.decidedAt
                ? ` · ${fmt.when(st.decidedAt)}${st.decidedByName ? ` by ${st.decidedByName}` : st.auto ? ' (recorded at submission)' : ''}`
                : ''}
              {st.onBehalfOf ? ` · on behalf of ${st.onBehalfOf}` : ''}
            </>
          }
          right={
            <Chip tone={st.state === 'approved' ? 'ok' : st.state === 'rejected' ? 'bad' : 'warn'}>
              {st.state === 'approved' ? (st.auto ? 'Auto' : 'Approved')
                : st.state === 'rejected' ? 'Sent back' : 'Pending'}
            </Chip>
          }
        />
      ))}
    </div>
  );
}
