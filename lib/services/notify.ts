import 'server-only';
import type { Exec } from '@/db/client';
import { notifications } from '@/db/schema';
import type { Ctx } from '@/lib/audit';

/* ═════════════════════════════════════════════════════════════════════════════
   THE BELL

   Three things look similar and are not:

     · a toast is what the person who just acted sees — it disappears;
     · a notification is what somebody ELSE needs to know — it waits in the bell
       until they read it;
     · a task is work somebody owes — it waits until it is done.

   This is the middle one. Most notifications are raised by the automation
   engine from a domain event, but a few belong to the command itself: when a
   recruiter takes over somebody's tag, the person losing it should be told by
   the same transaction that took it, not by a worker that might be down.
   ═════════════════════════════════════════════════════════════════════════════*/

export type NotifyInput = {
  kind: string;
  text: string;
  staffId?: string | null;
  accountId?: string | null;
  link?: string | null;
  candidateId?: string | null;
  applicationId?: string | null;
  jobId?: string | null;
  employeeId?: string | null;
  offerId?: string | null;
  /** The same event never rings the bell twice. */
  dedupeKey?: string | null;
};

export async function notify(
  input: NotifyInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  await ctx.tx.insert(notifications).values({
    kind: input.kind as never,
    text: input.text,
    recipientStaffId: input.staffId ?? null,
    recipientAccountId: input.accountId ?? null,
    applicationId: input.applicationId ?? null,
    jobId: input.jobId ?? null,
    candidateId: input.candidateId ?? null,
    employeeId: input.employeeId ?? null,
    offerId: input.offerId ?? null,
    link: input.link ?? null,
    at: ctx.now,
    dedupeKey: input.dedupeKey ?? null,
  }).onConflictDoNothing({ target: notifications.dedupeKey });
}
