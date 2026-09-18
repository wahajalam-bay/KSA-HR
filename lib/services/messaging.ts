import 'server-only';
import { sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { messages, messageThreads } from '@/db/schema';
import { providers } from '@/lib/env';
import { emit, type Ctx } from '@/lib/audit';

/* ═════════════════════════════════════════════════════════════════════════════
   THE OUTBOX

   Nothing in this product sends a message inline. A command writes the message
   it wants sent and returns; the worker drains the outbox and talks to the
   provider. That is what makes a send survive a crashed request, a restarted
   process and a provider that is down for ten minutes.

   It is also what keeps the product honest. A message whose channel has no
   provider configured is written with status `not_configured` — it is visible
   on the thread, it says exactly why it did not go, and nothing anywhere
   claims it was delivered. The alternative — writing `sent` and hoping — is
   the single most dishonest thing an ATS can do, because the recruiter stops
   chasing a candidate who never heard from them.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Channel = 'Email' | 'WhatsApp' | 'SMS' | 'LinkedIn' | 'Internal' | 'Voice';

const PROVIDER_OF: Record<Channel, 'email' | 'whatsapp' | 'sms' | 'linkedin' | null> = {
  Email: 'email',
  WhatsApp: 'whatsapp',
  SMS: 'sms',
  LinkedIn: 'linkedin',
  Voice: null,        // the voice adapter owns its own lifecycle
  Internal: null,     // never leaves the building
};

export type QueueInput = {
  channel: Channel;
  direction?: 'out' | 'in';
  internal?: boolean;
  subject?: string | null;
  body: string;
  toName?: string | null;
  toAddress?: string | null;
  fromName?: string | null;
  applicationId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
  employeeId?: string | null;
  templateId?: string | null;
  /** Sending the same thing twice never produces two messages. */
  idempotencyKey?: string | null;
  /** The subject the thread hangs off, when this belongs on one. */
  thread?: { subjectType: string; subjectId: string; title?: string | null };
  /** A message written by the assistant rather than by a person. */
  authorId?: string | null;
};

export type Queued = {
  messageId: string | null;
  status: 'queued' | 'not_configured';
  provider: string;
  /** Why it will not go, in the words the interface shows. */
  reason: string | null;
};

/** Write one message into the outbox. */
export async function queueMessage(
  input: QueueInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<Queued> {
  const key = PROVIDER_OF[input.channel];
  const p = key ? providers()[key] : { configured: true, provider: 'internal', missing: [] as string[] };
  const configured = p.configured;

  let threadId: string | null = null;
  if (input.thread) {
    const [existing] = await ctx.tx.select({ id: messageThreads.id }).from(messageThreads)
      .where(sql`${messageThreads.subjectType} = ${input.thread.subjectType}
                 AND ${messageThreads.subjectId} = ${input.thread.subjectId}`)
      .limit(1);
    if (existing) {
      threadId = existing.id;
      await ctx.tx.update(messageThreads).set({ lastMessageAt: ctx.now })
        .where(sql`${messageThreads.id} = ${existing.id}`);
    } else {
      threadId = `thr_${crypto.randomUUID().slice(0, 12)}`;
      await ctx.tx.insert(messageThreads).values({
        id: threadId,
        subjectType: input.thread.subjectType,
        subjectId: input.thread.subjectId,
        title: input.thread.title ?? null,
        candidateId: input.candidateId ?? null,
        applicationId: input.applicationId ?? null,
        jobId: input.jobId ?? null,
        lastMessageAt: ctx.now,
        createdAt: ctx.now,
      });
    }
  }

  const messageId = `msg_${crypto.randomUUID().slice(0, 12)}`;
  const status = configured ? 'queued' : 'not_configured';
  const reason = configured
    ? null
    : `${input.channel} is not configured — Settings → Integrations (${p.missing.join(', ')})`;

  const inserted = await ctx.tx.insert(messages).values({
    id: messageId,
    threadId,
    applicationId: input.applicationId ?? null,
    candidateId: input.candidateId ?? null,
    jobId: input.jobId ?? null,
    employeeId: input.employeeId ?? null,
    channel: input.channel,
    direction: input.direction ?? 'out',
    internal: input.internal ?? false,
    fromName: input.fromName ?? ctx.viewer.name,
    toName: input.toName ?? null,
    toAddress: input.toAddress ?? null,
    subject: input.subject ?? null,
    body: input.body,
    templateId: input.templateId ?? null,
    provider: configured ? p.provider : null,
    status,
    statusDetail: reason,
    queuedAt: ctx.now,
    authorId: input.authorId !== undefined ? input.authorId : (ctx.viewer.staffId ?? null),
    idempotencyKey: input.idempotencyKey ?? null,
    at: ctx.now,
  }).onConflictDoNothing({ target: messages.idempotencyKey }).returning({ id: messages.id });

  /* The idempotency key already held a message: this send has happened. */
  if (!inserted.length) return { messageId: null, status: 'queued', provider: p.provider, reason: null };

  if (configured) {
    await emit(ctx, {
      type: 'message.queued', subjectType: 'message', subjectId: messageId,
      payload: { channel: input.channel, applicationId: input.applicationId ?? null },
      idempotencyKey: `msg.queued:${messageId}`,
    }, ctx.tx);
  }

  return { messageId, status, provider: p.provider, reason };
}

/** The sentence a command adds to its toast when a channel is not configured. */
export function notConfiguredNote(q: Queued): string {
  return q.status === 'not_configured' ? ` — but ${q.reason}` : '';
}
