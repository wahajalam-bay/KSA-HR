import 'server-only';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  applications, candidates, jobStages, evaluations, evaluationCriteria, reviews, comments,
  notifications, jobs, staff,
} from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str } from './fields';
import { requireApplication } from '@/lib/authz';
import { moveStage, closeApplication, finalGate, DISQUALIFY_REASONS } from '@/lib/services/transitions';
import { audit, emit } from '@/lib/audit';
import { rows as rowsOf } from '@/lib/queries/sql';
import { nextStage, type StageKey, type JobStage } from '@/lib/domain/stages';
import { recomputeFit } from '@/lib/services/fit';
import { queueMessage } from '@/lib/services/messaging';

/* ─────────────────────────────────────────────────────────────────────────────
   What can be done to an application: move it, hold it, close it, rate it, and
   the feedback that hangs off it — the quick review, the scorecard, the
   comments. Every one goes through the transition machine or writes an
   auditable record; none of them trusts the interface to have checked anything.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().min(1), fields: z.record(z.any()).default({}) });

defineMany({
  /* Advance to whatever this requisition runs next. Applied and Sourced are
     alternative entries, so advancing out of either lands on the first real
     stage rather than on the other entry. */
  'app.advance': {
    capability: 'application.move',
    schema: base,
    async run({ v }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const [app] = await ctx.tx.select().from(applications).where(eq(applications.id, v)).limit(1);
      if (!app) throw new CommandError('That application no longer exists');
      const loop = (await ctx.tx.select().from(jobStages)
        .where(eq(jobStages.jobId, app.jobId)).orderBy(asc(jobStages.ordinal))) as unknown as JobStage[];
      const next = nextStage(loop, app.stage);
      if (!next) throw new CommandError('Already at the end of this pipeline', { tone: 'warn' });

      const r = await moveStage({ applicationId: v, toStage: next, source: 'advance' }, ctx);
      return {
        toast: r.closed ? `${r.candidateName} marked as joined` : `${r.candidateName} → ${r.stageName}`,
        icon: r.closed ? 'trophy' : 'arrR',
      };
    },
  },

  /* The Move to… sheet, and the drop on the board. Both send `appId|stage`. */
  'app.moveTo': {
    capability: 'application.move',
    schema: base,
    async run({ v }, ctx) {
      const [applicationId, stage] = v.split('|');
      if (!applicationId || !stage) throw new CommandError('That move was not understood');
      await requireApplication(ctx.viewer, applicationId, ctx.tx);
      const r = await moveStage({
        applicationId, toStage: stage as StageKey, source: 'drag',
      }, ctx);
      return {
        toast: r.closed
          ? `${r.candidateName} marked as joined`
          : `${r.candidateName} → ${r.stageName}${r.backwards ? ' (moved back)' : ''}`,
        icon: r.closed ? 'trophy' : r.backwards ? 'arrL' : 'arrR',
        closeSheet: true,
      };
    },
  },

  'app.hold': {
    capability: 'application.hold',
    schema: base,
    async run({ v }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const [app] = await ctx.tx.select().from(applications).where(eq(applications.id, v)).limit(1);
      if (!app) throw new CommandError('That application no longer exists');
      if (!['active', 'on_hold'].includes(app.status)) {
        throw new CommandError('That application is closed');
      }
      const on = app.status === 'on_hold';
      await ctx.tx.update(applications).set({ status: on ? 'active' : 'on_hold' })
        .where(eq(applications.id, v));
      const [c] = await ctx.tx.select({ name: candidates.name }).from(candidates)
        .where(eq(candidates.id, app.candidateId)).limit(1);
      await audit(ctx, {
        action: 'update', summary: on ? `took ${c?.name} off hold` : `put ${c?.name} on hold`,
        entityType: 'application', entityId: v, entityLabel: c?.name,
        before: { status: app.status }, after: { status: on ? 'active' : 'on_hold' },
      }, ctx.tx);
      return { toast: on ? 'Back in play' : 'Put on hold' };
    },
  },

  'app.rejectWith': {
    capability: 'application.disqualify',
    schema: base,
    async run({ v }, ctx) {
      const idx = v.indexOf('|');
      const applicationId = idx < 0 ? v : v.slice(0, idx);
      const reason = idx < 0 ? '' : v.slice(idx + 1);
      if (!reason) throw new CommandError('Pick a reason');
      await requireApplication(ctx.viewer, applicationId, ctx.tx);
      const r = await closeApplication(applicationId, reason, ctx);
      return {
        toast: `${r.name} disqualified — ${reason.toLowerCase()}`,
        tone: 'bad' as const, icon: 'x', closeSheet: 'all' as const,
      };
    },
  },

  'app.rate': {
    capability: 'application.rate',
    schema: base,
    async run({ v }, ctx) {
      const [applicationId, n] = v.split('|');
      await requireApplication(ctx.viewer, applicationId, ctx.tx);
      const rating = Math.max(1, Math.min(5, Number(n) || 0));
      await ctx.tx.update(applications).set({ rating: String(rating) })
        .where(eq(applications.id, applicationId));
      return { toast: `Rated ${rating} of 5`, icon: 'star' };
    },
  },

  /* ── The quick review: thumbs up, thumbs down or a star ──────────────────
     One per reviewer per application; a second replaces the first rather than
     stacking, so a panel of four reads as four opinions and not as eleven. */
  'rev.save': {
    capability: 'review.write',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const rating = str(fields, 'rev_rating');
      if (!['up', 'down', 'star'].includes(rating)) {
        throw new CommandError('Pick thumbs up, thumbs down or a star first');
      }
      const text = str(fields, 'rev_text');
      const [app] = await ctx.tx.select().from(applications).where(eq(applications.id, v)).limit(1);
      if (!app) throw new CommandError('That application no longer exists');

      const who = ctx.viewer.staffId ?? ctx.viewer.accountId;
      const existing = rowsOf(await ctx.tx.execute(sql`
        SELECT id FROM ${reviews}
         WHERE application_id = ${v}
           AND (by_id = ${who} OR lower(by_name) = lower(${ctx.viewer.name}))
         LIMIT 1`))[0];

      if (existing) {
        await ctx.tx.update(reviews)
          .set({ rating: rating as 'up' | 'down' | 'star', text, at: ctx.now, stage: app.stage })
          .where(eq(reviews.id, existing.id));
      } else {
        await ctx.tx.insert(reviews).values({
          applicationId: v, candidateId: app.candidateId, jobId: app.jobId,
          rating: rating as 'up' | 'down' | 'star', text,
          byId: who, byName: ctx.viewer.name, byEmail: ctx.viewer.email,
          stage: app.stage, at: ctx.now,
        });
      }

      const label = { up: 'Positive', down: 'Concern', star: 'Outstanding' }[rating]!;
      const [c] = await ctx.tx.select({ name: candidates.name }).from(candidates)
        .where(eq(candidates.id, app.candidateId)).limit(1);
      await audit(ctx, {
        action: existing ? 'update' : 'create',
        summary: `reviewed a candidate (${label.toLowerCase()})`,
        entityType: 'review', entityId: existing?.id ?? null, entityLabel: c?.name,
      }, ctx.tx);
      return { toast: `Review saved — ${label}`, icon: rating === 'down' ? 'thumbDown' : rating === 'star' ? 'star' : 'thumbUp' };
    },
  },

  'rev.remove': {
    capability: 'review.write',
    schema: base,
    async run({ v }, ctx) {
      const [r] = await ctx.tx.select().from(reviews).where(eq(reviews.id, v)).limit(1);
      if (!r) throw new CommandError('That review is gone');
      const mine = r.byId === (ctx.viewer.staffId ?? ctx.viewer.accountId)
        || r.byName.toLowerCase() === ctx.viewer.name.toLowerCase();
      if (!mine && !ctx.viewer.isAdmin) {
        throw new CommandError('Only the reviewer or an Admin can remove a review');
      }
      await requireApplication(ctx.viewer, r.applicationId, ctx.tx);
      await ctx.tx.delete(reviews).where(eq(reviews.id, v));
      await audit(ctx, {
        action: 'delete', summary: 'removed a review', entityType: 'review', entityId: v,
        before: { rating: r.rating, text: r.text },
      }, ctx.tx);
      return { toast: 'Review removed' };
    },
  },

  /* ── Scorecards ───────────────────────────────────────────────────────── */
  'eval.save': {
    capability: 'scorecard.write',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const [app] = await ctx.tx.select().from(applications).where(eq(applications.id, v)).limit(1);
      if (!app) throw new CommandError('That application no longer exists');

      const stage = str(fields, 'stage') || app.stage;
      const verdict = str(fields, 'verdict') || 'yes';
      const comment = str(fields, 'comment');

      /* The criteria arrive as crit:<name> = 1–5. */
      const criteria = Object.entries(fields)
        .filter(([k]) => k.startsWith('crit:'))
        .map(([k, val]) => ({ name: k.slice(5), score: Number(Array.isArray(val) ? val[0] : val) }))
        .filter((c) => Number.isFinite(c.score) && c.score >= 1 && c.score <= 5);
      if (!criteria.length) throw new CommandError('Score at least one criterion');

      const overall = criteria.reduce((n, c) => n + c.score, 0) / criteria.length;

      /* Booking an interview raises an empty scorecard for each panellist. This
         is the moment one of those is filled in — finding it and completing it
         rather than inserting a second row is what makes “awaiting feedback”
         mean something. Somebody who is not on the panel gets a new one. */
      const who = ctx.viewer.staffId ?? ctx.viewer.accountId;
      const mine = rowsOf(await ctx.tx.execute(sql`
        SELECT id, submitted FROM ${evaluations}
         WHERE application_id = ${v} AND stage = ${stage}::stage_key
           AND (evaluator_id = ${who} OR lower(evaluator_name) = ${ctx.viewer.name.toLowerCase()})
         ORDER BY submitted, created_at
         LIMIT 1`)) as Array<{ id: string; submitted: boolean }>;

      if (mine[0]?.submitted) {
        throw new CommandError(
          'You have already filed a scorecard for this stage — a second one would count twice',
          { tone: 'warn' },
        );
      }

      let evaluationId = mine[0]?.id ?? null;
      if (evaluationId) {
        await ctx.tx.update(evaluations).set({
          evaluatorId: who,
          evaluatorName: ctx.viewer.name,
          overall: String(Math.round(overall * 2) / 2),
          verdict: verdict as 'strong_yes' | 'yes' | 'no' | 'strong_no',
          comment,
          submitted: true,
          at: ctx.now,
        }).where(eq(evaluations.id, evaluationId));
        /* The criteria were seeded with their weights when the scorecard was
           raised; the scores replace them, keeping the weights. */
        await ctx.tx.delete(evaluationCriteria)
          .where(eq(evaluationCriteria.evaluationId, evaluationId));
      } else {
        const [made] = await ctx.tx.insert(evaluations).values({
          applicationId: v, jobId: app.jobId, candidateId: app.candidateId,
          stage: stage as StageKey,
          evaluatorId: who,
          evaluatorName: ctx.viewer.name,
          overall: String(Math.round(overall * 2) / 2),
          verdict: verdict as 'strong_yes' | 'yes' | 'no' | 'strong_no',
          comment, submitted: true, at: ctx.now,
        }).returning({ id: evaluations.id });
        evaluationId = made.id;
      }
      const e = { id: evaluationId };

      await ctx.tx.insert(evaluationCriteria).values(
        criteria.map((c, i) => ({ evaluationId: e.id, name: c.name, score: c.score, sortOrder: i })),
      );

      /* The candidate's rating is the mean of the submitted scorecards. */
      await ctx.tx.execute(sql`
        UPDATE ${applications} SET rating = (
          SELECT round(avg(overall)::numeric, 1) FROM ${evaluations}
           WHERE application_id = ${v} AND submitted AND overall IS NOT NULL)
         WHERE id = ${v}`);

      const [c] = await ctx.tx.select({ name: candidates.name }).from(candidates)
        .where(eq(candidates.id, app.candidateId)).limit(1);
      await audit(ctx, {
        action: 'create', summary: `submitted a scorecard for ${c?.name}`,
        entityType: 'evaluation', entityId: e.id, entityLabel: c?.name,
        after: { stage, verdict, overall, criteria },
      }, ctx.tx);
      await emit(ctx, {
        type: 'scorecard.submitted', subjectType: 'application', subjectId: v,
        payload: { evaluationId: e.id, stage, verdict, overall, jobId: app.jobId },
      }, ctx.tx);

      return { toast: 'Scorecard submitted', icon: 'star' };
    },
  },

  'eval.nudge': {
    capability: 'scorecard.nudge',
    schema: base,
    async run({ v }, ctx) {
      const [e] = await ctx.tx.select().from(evaluations).where(eq(evaluations.id, v)).limit(1);
      if (!e) throw new CommandError('That scorecard request is gone');
      await requireApplication(ctx.viewer, e.applicationId, ctx.tx);
      await ctx.tx.insert(notifications).values({
        kind: 'evaluation',
        text: `${ctx.viewer.name} is waiting on your scorecard`,
        applicationId: e.applicationId, jobId: e.jobId, candidateId: e.candidateId,
        dedupeKey: `nudge:${v}:${ctx.now.toISOString().slice(0, 10)}`,
      }).onConflictDoNothing();
      await emit(ctx, {
        type: 'scorecard.overdue', subjectType: 'evaluation', subjectId: v,
        payload: { applicationId: e.applicationId, evaluator: e.evaluatorName },
      }, ctx.tx);
      return { toast: `Reminder sent to ${e.evaluatorName}`, icon: 'bell' };
    },
  },

  /* ── Comments ─────────────────────────────────────────────────────────── */
  'cmt.post': {
    capability: 'comment.write',
    schema: base,
    async run({ v, fields }, ctx) {
      const body = str(fields, 'comment') || str(fields, 'cmtbox');
      if (!body) throw new CommandError('Write something first');
      let candidateId = str(fields, 'candidateId');
      let jobId: string | null = null;
      if (v) {
        await requireApplication(ctx.viewer, v, ctx.tx);
        const [app] = await ctx.tx.select().from(applications).where(eq(applications.id, v)).limit(1);
        if (!app) throw new CommandError('That application no longer exists');
        candidateId = app.candidateId;
        jobId = app.jobId;
      }
      if (!candidateId) throw new CommandError('A comment needs a candidate');

      /* @mentions become notifications, which is the only reason to record
         them separately from the text. */
      const mentions = [...body.matchAll(/@([\w .'-]{2,40})/g)].map((m) => m[1].trim());

      const [row] = await ctx.tx.insert(comments).values({
        applicationId: v || null, candidateId, jobId,
        authorId: ctx.viewer.staffId ?? ctx.viewer.accountId, authorName: ctx.viewer.name,
        body, mentions, at: ctx.now,
      }).returning({ id: comments.id });

      for (const m of mentions) {
        const [p] = await ctx.tx.select({ id: staff.id }).from(staff)
          .where(sql`lower(${staff.name}) LIKE ${m.toLowerCase() + '%'}`).limit(1);
        if (!p) continue;
        await ctx.tx.insert(notifications).values({
          kind: 'mention', recipientStaffId: p.id,
          text: `${ctx.viewer.name} mentioned you on a candidate`,
          applicationId: v || null, candidateId, jobId,
          dedupeKey: `mention:${row.id}:${p.id}`,
        }).onConflictDoNothing();
      }

      await audit(ctx, {
        action: 'create', summary: 'commented on a candidate',
        entityType: 'comment', entityId: row.id,
      }, ctx.tx);
      return { toast: 'Comment added' };
    },
  },

  'cmt.pin': {
    capability: 'comment.pin',
    schema: base,
    async run({ v }, ctx) {
      const [c] = await ctx.tx.select().from(comments).where(eq(comments.id, v)).limit(1);
      if (!c) throw new CommandError('That comment is gone');
      if (c.applicationId) await requireApplication(ctx.viewer, c.applicationId, ctx.tx);
      await ctx.tx.update(comments).set({ pinned: !c.pinned }).where(eq(comments.id, v));
      return { toast: c.pinned ? 'Unpinned' : 'Pinned to the top' };
    },
  },

  'cmt.del': {
    capability: 'comment.delete',
    schema: base,
    async run({ v }, ctx) {
      const [c] = await ctx.tx.select().from(comments).where(eq(comments.id, v)).limit(1);
      if (!c) throw new CommandError('That comment is gone');
      const mine = c.authorId === (ctx.viewer.staffId ?? ctx.viewer.accountId);
      if (!mine && !ctx.viewer.isAdmin) throw new CommandError('Only the author or an Admin can delete a comment');
      /* Soft-deleted: it disappears for the hiring team, and the record of what
         was said and removed survives for the audit. */
      await ctx.tx.update(comments)
        .set({ deletedAt: ctx.now, deletedBy: ctx.viewer.staffId ?? ctx.viewer.accountId })
        .where(eq(comments.id, v));
      await audit(ctx, {
        action: 'delete', summary: 'deleted a comment', entityType: 'comment', entityId: v,
        before: { body: c.body, authorName: c.authorName },
      }, ctx.tx);
      return { toast: 'Comment deleted' };
    },
  },

  /* ── Writing to the candidate ─────────────────────────────────────────── */
  /* The sheet fills a template in and the recruiter edits it; what leaves the
     building is what is on the screen. It goes into the outbox like every other
     message, which means an unconfigured mail provider says so rather than
     reporting a send that never happened. */
  'app.emailSend': {
    capability: 'application.view',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const [app] = await ctx.tx.select().from(applications).where(eq(applications.id, v)).limit(1);
      if (!app) throw new CommandError('That application no longer exists');
      const [cand] = await ctx.tx.select().from(candidates)
        .where(eq(candidates.id, app.candidateId)).limit(1);
      const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);

      const to = str(fields, 'to') || cand?.email || '';
      const subject = str(fields, 'subject');
      const body = str(fields, 'body');
      if (!to) throw new CommandError('There is no address to send to — add one on the profile');
      if (!subject) throw new CommandError('A subject, please');
      if (!body) throw new CommandError('The message is empty');

      const q = await queueMessage({
        channel: 'Email',
        subject,
        body,
        toName: cand?.name ?? null,
        toAddress: to,
        applicationId: v,
        candidateId: app.candidateId,
        jobId: app.jobId,
        templateId: str(fields, 'tpl') || null,
        thread: {
          subjectType: 'application', subjectId: v,
          title: cand && job ? `${cand.name} — ${job.title}` : null,
        },
      }, ctx);

      /* The hiring team sees that it was written, whether or not it has left:
         a message sitting in the outbox is still a thing somebody did. */
      await ctx.tx.insert(comments).values({
        id: `cmt_${crypto.randomUUID().slice(0, 12)}`,
        applicationId: v,
        candidateId: app.candidateId,
        jobId: app.jobId,
        authorId: ctx.viewer.staffId ?? ctx.viewer.accountId,
        authorName: ctx.viewer.name,
        body: q.status === 'queued'
          ? `Emailed ${cand?.name ?? 'the candidate'} — “${subject}”`
          : `Wrote to ${cand?.name ?? 'the candidate'} — “${subject}” — waiting on the mail provider`,
        at: ctx.now,
        pinned: false,
      });

      await audit(ctx, {
        action: 'update',
        summary: `wrote to ${cand?.name ?? 'the candidate'} — ${subject}`,
        entityType: 'application', entityId: v, entityLabel: cand?.name,
        after: { to, subject, status: q.status },
      }, ctx.tx);

      return q.status === 'queued'
        ? { toast: `Email queued to ${cand?.name ?? to}`, icon: 'mail', closeSheet: true }
        : { toast: q.reason ?? 'Email is not configured', tone: 'warn', icon: 'plug', closeSheet: true };
    },
  },
});

export { DISQUALIFY_REASONS };
