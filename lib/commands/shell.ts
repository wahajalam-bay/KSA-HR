import 'server-only';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { notifications, staff, accounts } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { destroySession, actAsStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { str } from './fields';
import { exportData, type ExportKind } from '@/lib/services/export';

/* ─────────────────────────────────────────────────────────────────────────────
   The shell's own commands: signing out, the notification bell, and the demo
   user switcher an Admin has in the profile menu.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string(), fields: z.record(z.any()).default({}) });

defineMany({
  'auth.signout': {
    capability: null,
    noTransaction: true,
    async run(_i, ctx) {
      await audit(ctx, { action: 'action', summary: 'signed out', entityType: 'session', entityId: ctx.viewer.sessionId });
      await destroySession('signed out');
      return { go: '/sign-in', toast: 'Signed out', refresh: false };
    },
  },

  'notif.readall': {
    capability: null,
    schema: base,
    async run(_i, ctx) {
      const res = await ctx.tx.update(notifications)
        .set({ readAt: ctx.now })
        .where(and(
          isNull(notifications.readAt),
          sql`(${notifications.recipientAccountId} IS NULL OR ${notifications.recipientAccountId} = ${ctx.viewer.accountId})`,
          sql`(${notifications.recipientStaffId} IS NULL OR ${notifications.recipientStaffId} = ${ctx.viewer.staffId ?? null})`,
        ))
        .returning({ id: notifications.id });
      return { toast: res.length ? 'Notifications cleared' : 'Nothing to clear', closeSheet: true };
    },
  },

  'notif.go': {
    capability: null,
    schema: base,
    async run({ v }, ctx) {
      const [n] = await ctx.tx.select().from(notifications).where(eq(notifications.id, v)).limit(1);
      if (!n) throw new CommandError('That notification is gone');
      await ctx.tx.update(notifications).set({ readAt: ctx.now }).where(eq(notifications.id, v));
      const go = n.link
        ?? (n.employeeId ? `/onboarding?emp=${n.employeeId}`
          : n.applicationId ? `/candidates?app=${n.applicationId}`
            : n.jobId ? `/jobs/${n.jobId}` : '/overview');
      return { go, closeSheet: 'all' as const };
    },
  },

  /* An Admin may look at the product as a colleague — the same switcher the
     prototype had. The session records who is really signed in, so the audit
     trail names both and nobody can hide behind it. */
  'me.set': {
    capability: null,
    schema: base,
    async run({ v }, ctx) {
      if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can switch user');
      const [p] = await ctx.tx.select({ id: staff.id, name: staff.name })
        .from(staff).where(eq(staff.id, v)).limit(1);
      if (!p) throw new CommandError('That colleague is not on the team');
      await actAsStaff(ctx.viewer.sessionId, p.id === ctx.viewer.staffId ? null : p.id);
      await audit(ctx, {
        action: 'action', summary: `viewed the product as ${p.name}`,
        entityType: 'session', entityId: ctx.viewer.sessionId, entityLabel: p.name,
      }, ctx.tx);
      return { toast: `Viewing as ${p.name}`, closeSheet: true, go: '/overview' };
    },
  },

  /* ── Taking data out ──────────────────────────────────────────────────── */
  /* One command behind every Export button, because they are the same
     operation over different rows and a separate command per screen would be
     six places to forget the scope. What it exports is the value; the filters
     ride along in the fields. See lib/services/export.ts for the three rules
     every one of them keeps. */
  'data.export': {
    capability: 'data.export',
    schema: base,
    async run({ v, fields }, ctx) {
      const kind = (v || str(fields, 'kind')) as ExportKind;
      const r = await exportData(kind, ctx, {
        deptId: str(fields, 'dept') || null,
        q: str(fields, 'q') || null,
      });
      return {
        refresh: false,
        download: { text: r.csv, name: r.name, contentType: 'text/csv;charset=utf-8' },
        toast: `${r.rows} row${r.rows === 1 ? '' : 's'} exported`,
        icon: 'dl',
      };
    },
  },
});
