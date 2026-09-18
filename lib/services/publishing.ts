import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { jobs, jobChannels } from '@/db/schema';
import { CommandError } from '@/lib/commands/registry';
import { audit, emit, type Ctx } from '@/lib/audit';
import { jobBoardAdapter } from '@/lib/providers';
import { env, providers } from '@/lib/env';
import { routesOf } from '@/lib/domain/sourcing';

/* ─────────────────────────────────────────────────────────────────────────────
   Advertising a requisition.

   Where a requisition is published is a fact about it, kept in `job_channels`
   with the state of each — not posted, live, or expired — and the provider's own
   id when there is one. That row is what the board shows, so it has to say the
   truth: a channel with no provider behind it stays `not_posted` and carries
   the reason.

   A requisition nobody is allowed to advertise is refused outright. That is the
   confidential case — a role whose incumbent does not know yet — and posting it
   by accident is the one mistake here that cannot be taken back.
   ───────────────────────────────────────────────────────────────────────────*/

export type PublishResult = {
  title: string;
  channel: string;
  state: 'live' | 'not_posted';
  /** Why it is not live, in the words the interface shows. */
  reason: string | null;
  externalId: string | null;
};

export async function publishToLinkedIn(
  jobId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<PublishResult> {
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new CommandError('That requisition no longer exists');

  if (job.status !== 'open') {
    throw new CommandError(
      `${job.title} is ${job.status.replace('_', ' ')} — only an open requisition is advertised`,
    );
  }

  /* How this position gets filled is the recruiter's decision, taken when the
     requisition was opened. Publishing one that is not set to be published
     would put a confidential role on a public page. */
  const routes = routesOf({
    internal: job.sourcingInternal,
    hunt: job.sourcingHunt,
    linkedin: job.sourcingLinkedin,
    note: job.sourcingNote,
  });
  if (!routes.includes('linkedin')) {
    throw new CommandError(
      routes.length === 1 && routes[0] === 'hunt'
        ? `${job.title} is confidential — it is not advertised anywhere. Switch the LinkedIn `
          + 'company page on from the requisition if it should be.'
        : `${job.title} is not set to be published — switch the LinkedIn company page on from `
          + 'the requisition first',
    );
  }

  const CHANNEL = 'LinkedIn';
  const p = providers().linkedin;

  const row = async (
    state: 'live' | 'not_posted', externalId: string | null, lastError: string | null,
  ) => {
    await ctx.tx.insert(jobChannels).values({
      jobId, channel: CHANNEL, state, externalId,
      postedAt: state === 'live' ? ctx.now : null,
      lastError,
    }).onConflictDoUpdate({
      target: [jobChannels.jobId, jobChannels.channel],
      set: {
        state, externalId,
        postedAt: state === 'live' ? ctx.now : null,
        lastError,
      },
    });
  };

  if (!p.configured) {
    const reason = `LinkedIn is not configured — Settings → Integrations (${p.missing.join(', ')})`;
    await row('not_posted', null, reason);
    await audit(ctx, {
      action: 'action',
      summary: `could not publish ${job.title} — LinkedIn is not configured`,
      entityType: 'requisition', entityId: jobId, entityLabel: job.title,
      after: { channel: CHANNEL, state: 'not_posted', reason },
    }, ctx.tx);
    return { title: job.title, channel: CHANNEL, state: 'not_posted', reason, externalId: null };
  }

  const r = await jobBoardAdapter().publish({
    title: job.title,
    description: [
      job.descSummary ?? '',
      ...(job.descResponsibilities ?? []).map((x) => `• ${x}`),
      ...(job.descRequirements ?? []).map((x) => `• ${x}`),
    ].filter(Boolean).join('\n'),
    city: null,
    employmentType: job.employmentType ?? null,
    applyUrl: `${env().APP_URL}/apply/${job.slug ?? job.id}`,
    idempotencyKey: `job:${job.id}`,
  });

  if (!r.ok) {
    await row('not_posted', null, r.message);
    await audit(ctx, {
      action: 'action',
      summary: `could not publish ${job.title} — ${r.message}`,
      entityType: 'requisition', entityId: jobId, entityLabel: job.title,
      after: { channel: CHANNEL, state: 'not_posted', reason: r.message },
    }, ctx.tx);
    return {
      title: job.title, channel: CHANNEL, state: 'not_posted',
      reason: r.message, externalId: null,
    };
  }

  const externalId = r.detail?.postingId ?? null;
  await row('live', externalId, null);
  await audit(ctx, {
    action: 'action',
    summary: `published ${job.title} to the LinkedIn company page`,
    entityType: 'requisition', entityId: jobId, entityLabel: job.title,
    after: { channel: CHANNEL, state: 'live', externalId },
  }, ctx.tx);
  await emit(ctx, {
    type: 'requisition.published', subjectType: 'requisition', subjectId: jobId,
    payload: { channel: CHANNEL, externalId },
  }, ctx.tx);

  return { title: job.title, channel: CHANNEL, state: 'live', reason: null, externalId };
}

/** Take it down again — the state a closed or filled requisition ends in. */
export async function expireChannels(
  jobId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<number> {
  const live = await ctx.tx.select().from(jobChannels)
    .where(and(eq(jobChannels.jobId, jobId), eq(jobChannels.state, 'live')));
  if (!live.length) return 0;
  await ctx.tx.update(jobChannels)
    .set({ state: 'expired', expiredAt: ctx.now })
    .where(and(eq(jobChannels.jobId, jobId), eq(jobChannels.state, 'live')));
  return live.length;
}
