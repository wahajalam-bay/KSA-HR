import 'server-only';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { tasks, savedReports, reportRequests, jobs, applications, candidates } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str } from './fields';
import { requireApplication, requireJob } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { rows as rowsOf } from '@/lib/queries/sql';
import { parse as parseQuestion } from '@/lib/services/ask';
import { vocabulary, resolve as resolveAsk, type Row as AskRow } from '@/lib/queries/ask';

/* ─────────────────────────────────────────────────────────────────────────────
   The chase list, and the reports somebody keeps.

   A task is the smallest write in the product and the one people use most, so
   it is deliberately plain: a title, an owner, a date, and a tick. The only
   rules are that it belongs to somebody and that ticking it is recorded — a
   chase list nobody can audit is a chase list nobody trusts.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const KINDS = [
  'chase_feedback', 'verify_offer', 'offer_question', 'assessment', 'reference',
  'joining', 'onboarding', 'sla', 'probation', 'other',
];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];

defineMany({
  'task.create': {
    capability: 'application.view',
    schema: base,
    async run({ v, fields }, ctx) {
      const title = str(fields, 'title');
      if (!title) throw new CommandError('The task needs a title');

      const kind = KINDS.includes(str(fields, 'kind')) ? str(fields, 'kind') : 'other';
      const priority = PRIORITIES.includes(str(fields, 'priority'))
        ? str(fields, 'priority') : 'normal';
      const dueRaw = str(fields, 'dueOn');
      if (dueRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) {
        throw new CommandError('A due date, as a day');
      }

      const applicationId = str(fields, 'applicationId') || v || null;
      const jobId = str(fields, 'jobId') || null;
      if (applicationId) await requireApplication(ctx.viewer, applicationId, ctx.tx);
      if (jobId) await requireJob(ctx.viewer, jobId, ctx.tx);

      const [app] = applicationId
        ? await ctx.tx.select().from(applications)
          .where(eq(applications.id, applicationId)).limit(1)
        : [];

      const id = `tsk_${crypto.randomUUID().slice(0, 12)}`;
      await ctx.tx.insert(tasks).values({
        id,
        kind: kind as never,
        title,
        detail: str(fields, 'detail') || null,
        applicationId: app?.id ?? null,
        jobId: jobId ?? app?.jobId ?? null,
        candidateId: app?.candidateId ?? null,
        assigneeId: str(fields, 'assigneeId') || ctx.viewer.staffId || null,
        dueOn: dueRaw ? new Date(`${dueRaw}T00:00:00Z`) : null,
        priority: priority as never,
        done: false,
        createdBy: ctx.viewer.staffId ?? null,
        createdAt: ctx.now,
      });

      await audit(ctx, {
        action: 'create',
        summary: `added a task — ${title}`,
        entityType: 'task', entityId: id, entityLabel: title,
        after: { kind, priority, dueOn: dueRaw || null, assigneeId: str(fields, 'assigneeId') || ctx.viewer.staffId },
      }, ctx.tx);

      return { toast: 'Task added', icon: 'check', closeSheet: true, data: { taskId: id } };
    },
  },

  'task.toggle': {
    capability: 'application.view',
    schema: base,
    async run({ v }, ctx) {
      const [t] = await ctx.tx.select().from(tasks).where(eq(tasks.id, v)).limit(1);
      if (!t) throw new CommandError('That task is gone');
      if (t.applicationId) await requireApplication(ctx.viewer, t.applicationId, ctx.tx);

      const done = !t.done;
      await ctx.tx.update(tasks).set({
        done,
        doneAt: done ? ctx.now : null,
        doneBy: done ? (ctx.viewer.staffId ?? null) : null,
      }).where(eq(tasks.id, v));

      await audit(ctx, {
        action: 'update',
        summary: done ? `ticked off "${t.title}"` : `reopened "${t.title}"`,
        entityType: 'task', entityId: v, entityLabel: t.title,
        before: { done: t.done }, after: { done },
      }, ctx.tx);

      return {
        toast: done ? `Ticked off — ${t.title}` : 'Task reopened',
        icon: done ? 'check' : 'refresh',
      };
    },
  },

  'task.assign': {
    capability: 'application.view',
    schema: base,
    async run({ v, fields }, ctx) {
      const [t] = await ctx.tx.select().from(tasks).where(eq(tasks.id, v)).limit(1);
      if (!t) throw new CommandError('That task is gone');
      const assigneeId = str(fields, 'assigneeId') || null;
      await ctx.tx.update(tasks).set({ assigneeId }).where(eq(tasks.id, v));
      await audit(ctx, {
        action: 'update',
        summary: `moved "${t.title}" to somebody else`,
        entityType: 'task', entityId: v, entityLabel: t.title,
        before: { assigneeId: t.assigneeId }, after: { assigneeId },
      }, ctx.tx);
      return { toast: 'Task reassigned', icon: 'users' };
    },
  },

  /* ── The answer, as a spreadsheet ─────────────────────────────────────── */
  /* The rows behind a number on Insights. Somebody who asks "how many hires in
     Sales this quarter" and gets 14 wants the fourteen, and re-running the
     question rather than keeping the rows means what they download is what the
     screen showed — resolved under their own scope, again. */
  'ask.csv': {
    capability: 'reports.ask',
    schema: base,
    async run({ v, fields }, ctx) {
      const question = v || str(fields, 'q');
      if (!question) throw new CommandError('There is no question to answer');

      const vocab = await vocabulary(ctx.viewer, ctx.tx);
      const spec = parseQuestion(question, vocab);
      if (!spec.metric) {
        throw new CommandError('That question has no figure in it to export');
      }
      const res = await resolveAsk(ctx.viewer, spec, ctx.now, ctx.tx);
      if (!res.rows.length) {
        throw new CommandError('That question matches no records', { tone: 'warn' });
      }

      const cols = ['department', 'function', 'recruiter', 'source', 'month', 'stage',
        'location', 'job', 'family', 'hiring_manager', 'nationality', 'channel', 'n'] as const;
      const cell = (x: unknown) => {
        const s = x == null ? '' : String(x);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = `﻿${[
        cols.join(','),
        ...res.rows.map((r: AskRow) => cols.map((c) => cell(r[c])).join(',')),
      ].join('\r\n')}\r\n`;

      await audit(ctx, {
        action: 'read',
        summary: `exported ${res.rows.length} rows behind "${question}"`,
        entityType: 'export', entityId: 'ask',
        after: { question, metric: spec.metric, rows: res.rows.length },
      }, ctx.tx);

      return {
        refresh: false,
        download: {
          text: csv,
          name: `${question.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.csv`,
          contentType: 'text/csv;charset=utf-8',
        },
        toast: `${res.rows.length} row${res.rows.length === 1 ? '' : 's'} exported`,
        icon: 'dl',
      };
    },
  },

  /* ── Saved reports ────────────────────────────────────────────────────── */
  'ask.save': {
    capability: 'reports.save',
    schema: base,
    async run({ v, fields }, ctx) {
      /* `v` is the id of a question already asked; the spec is on the request. */
      const [asked] = await ctx.tx.select().from(reportRequests)
        .where(eq(reportRequests.id, v)).limit(1);
      const spec = asked?.resolvedSpec ?? null;
      const title = str(fields, 'title') || asked?.question || '';
      if (!spec || !title) throw new CommandError('There is nothing to save yet');

      const [clash] = await ctx.tx.select({ id: savedReports.id }).from(savedReports)
        .where(sql`lower(${savedReports.name}) = ${title.toLowerCase()}`).limit(1);
      if (clash) throw new CommandError('That one is already saved', { tone: 'warn' });

      const id = `rep_${crypto.randomUUID().slice(0, 12)}`;
      await ctx.tx.insert(savedReports).values({
        id,
        name: title,
        question: asked?.question ?? null,
        spec,
        ownerId: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
        shared: true,
        createdAt: ctx.now,
      });

      await audit(ctx, {
        action: 'create',
        summary: `saved the report "${title}"`,
        entityType: 'report', entityId: id, entityLabel: title,
      }, ctx.tx);

      return { toast: 'Saved — it stays under Ask for a report', icon: 'star' };
    },
  },

  'ask.unsave': {
    capability: 'reports.save',
    schema: base,
    async run({ v }, ctx) {
      const [r] = await ctx.tx.select().from(savedReports).where(eq(savedReports.id, v)).limit(1);
      if (!r) throw new CommandError('That report is already gone');
      if (r.ownerId !== (ctx.viewer.staffId ?? ctx.viewer.accountId) && !ctx.viewer.isAdmin) {
        throw new CommandError(`"${r.name}" belongs to somebody else — only they or an Admin can remove it`);
      }
      await ctx.tx.delete(savedReports).where(eq(savedReports.id, v));
      await audit(ctx, {
        action: 'delete',
        summary: `removed the saved report "${r.name}"`,
        entityType: 'report', entityId: v, entityLabel: r.name,
      }, ctx.tx);
      return { toast: 'Removed', icon: 'trash' };
    },
  },
});
