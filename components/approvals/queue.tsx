import * as React from 'react';
import { Card, Li, Chip, Btn } from '@/components/ui/primitives';
import { fmt, ago } from '@/lib/format';
import { can } from '@/lib/authz';
import type { QueueRow } from '@/lib/queries/approvals';
import type { Viewer } from '@/lib/auth/session';

/* Everything waiting on somebody, on the tab that is about waiting. The row
   carries its own decision buttons when the step is this account's to take, and
   says who has it when it is not — so nobody has to open a requisition to find
   out that they cannot do anything with it yet. */

export function ApprovalQueue({ rows, viewer, now }: {
  rows: QueueRow[]; viewer: Viewer; now: Date;
}) {
  if (!rows.length) return null;
  const admin = can(viewer, 'approval.configure');

  return (
    <Card
      title={`${rows.length} requisition${rows.length === 1 ? '' : 's'} awaiting approval`}
      icon="shield" flush
      foot={admin ? (
        <span className="t-foot">
          The Admin closes every chain; approving the last step publishes to the configured channels.{' '}
          <button className="linkbtn" data-act="go" data-v="/settings?tab=approvals">Edit the workflow</button>
        </span>
      ) : (
        <span className="t-foot">
          Approvers act on their own step; the Admin can act on anyone&rsquo;s behalf. You can still add
          candidates to a draft board.
        </span>
      )}
    >
      <div className="list">
        {rows.map((r) => (
          <Li
            key={r.jobId} icon="brief" title={r.title}
            sub={
              <>
                {r.deptName} · {r.openings} opening{r.openings === 1 ? '' : 's'} ·{' '}
                {fmt.sarK(r.salaryMin)}–{fmt.sarK(r.salaryMax)} · step {r.done + 1}/{r.total} with{' '}
                {r.current?.approverName ?? '—'} · asked by {r.requestedByName ?? '—'}{' '}
                {r.requestedAt ? ago(r.requestedAt, now) : ''}
              </>
            }
            right={r.mine && can(viewer, 'approval.act') ? (
              <span className="row tight">
                <Btn size="xs" variant="out" action="job.reject" v={r.jobId}>Send back</Btn>
                <Btn size="xs" variant="pri" action="job.approve" v={r.jobId}>Approve</Btn>
              </span>
            ) : (
              <Chip tone="warn">With {fmt.first(r.current?.approverName ?? '')}</Chip>
            )}
            action="go" v={`/jobs/${r.jobId}`}
          />
        ))}
      </div>
    </Card>
  );
}
