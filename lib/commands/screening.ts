import 'server-only';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { screenings, applications, jobs } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str } from './fields';
import { requireApplication, requireJob } from '@/lib/authz';
import { rows as rowsOf } from '@/lib/queries/sql';
import {
  inviteChat, setUpCall, cancelCall, captureFromTranscript, recordSalary, screeningOf,
} from '@/lib/services/screening';

/* ─────────────────────────────────────────────────────────────────────────────
   Screening: the link, the call, the numbers that come out of it.

   The chat screen goes out over a channel and waits; the phone screen is set up
   here and placed by the worker. Neither pretends to have happened. A channel
   with no provider says so in the toast, and the phone screen is refused
   outright rather than booked into a queue nothing drains.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const num = (f: Record<string, unknown>, k: string): number | null => {
  const raw = str(f, k);
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

const sar = (n: number | null) => (n == null ? '—' : `SAR ${n.toLocaleString('en-US')}`);

defineMany({
  /* ── The chat screen ──────────────────────────────────────────────────── */
  'scr.invite': {
    capability: 'screening.run',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const channel = str(fields, 'channel') === 'Careers site' ? 'Careers site' : 'WhatsApp';
      const r = await inviteChat({ applicationId: v, channel }, ctx);
      return {
        toast: r.sent
          ? `Screening link sent over ${r.channel}`
          : `Screening link written to the thread — ${r.note}`,
        tone: r.sent ? undefined : 'warn',
        icon: 'mail',
      };
    },
  },

  /* The prototype's `scr.run` ran the bot itself. Here the conversation belongs
     to the candidate, so "run it" is "send them the link" — the one thing a
     recruiter can actually do from this side. */
  'scr.run': {
    capability: 'screening.run',
    schema: base,
    async run({ v }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await inviteChat({ applicationId: v, channel: 'WhatsApp' }, ctx);
      return {
        toast: r.sent
          ? `${r.candidateName} has the six questions — the answers land here as they come`
          : `Screening link written to the thread — ${r.note}`,
        tone: r.sent ? undefined : 'warn',
        icon: 'spark',
      };
    },
  },

  /* ── The AI phone screen ──────────────────────────────────────────────── */
  'scr.callGo': {
    capability: 'screening.call',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const when = (['now', 'candidate', 'schedule'] as const)
        .find((x) => x === str(fields, 'when')) ?? 'now';
      const at = str(fields, 'at') ? new Date(`${str(fields, 'at')}:00+03:00`) : null;
      if (when === 'schedule' && (!at || Number.isNaN(+at))) {
        throw new CommandError('Pick a date and a time for the call');
      }
      const r = await setUpCall({
        applicationId: v,
        when,
        at,
        language: str(fields, 'lang') === 'en' ? 'en' : 'ar',
        voice: str(fields, 'voice') || undefined,
      }, ctx);

      const note = r.note ? ` — ${r.note}` : '';
      return {
        toast: when === 'schedule'
          ? `Call scheduled${r.smsSent ? ' — SMS sent' : ''}${note}`
          : when === 'candidate'
            ? `${r.smsSent ? 'SMS with a booking link sent' : 'Booking link written to the thread'}${note}`
            : `Calling ${r.candidateName} — the assistant takes it from here`,
        tone: r.note ? 'warn' : undefined,
        icon: 'phone',
        closeSheet: true,
      };
    },
  },

  'scr.callNow': {
    capability: 'screening.call',
    schema: base,
    async run({ v }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await setUpCall({ applicationId: v, when: 'now' }, ctx);
      return { toast: `Calling ${r.candidateName}`, icon: 'phone' };
    },
  },

  'scr.cancelCall': {
    capability: 'screening.call',
    schema: base,
    async run({ v }, ctx) {
      const s = await screeningOf(v, ctx.tx)
        ?? (await ctx.tx.select().from(screenings).where(eq(screenings.id, v)).limit(1))[0];
      if (!s) throw new CommandError('There is no call to cancel');
      await requireApplication(ctx.viewer, s.applicationId, ctx.tx);
      const r = await cancelCall(s.id, ctx);
      return { toast: `Call with ${r.candidateName} cancelled`, icon: 'x' };
    },
  },

  /* Every unscreened candidate on a requisition's screening stage, called
     fifteen minutes apart from tomorrow morning. */
  'scr.scheduleAll': {
    capability: 'screening.call',
    schema: base,
    async run({ v }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const queue = rowsOf(await ctx.tx.execute(sql`
        SELECT a.id
          FROM ${applications} a
         WHERE a.job_id = ${v} AND a.status IN ('active','on_hold') AND a.stage = 'screen'
           AND NOT EXISTS (
             SELECT 1 FROM ${screenings} s
              WHERE s.application_id = a.id
                AND s.status IN ('completed','scheduled','calling','running'))
         ORDER BY a.id`)) as Array<{ id: string }>;
      if (!queue.length) {
        throw new CommandError('Everybody on the screening stage has been screened', { tone: 'warn' });
      }

      /* Ten in the morning, Riyadh, tomorrow. */
      const start = new Date(ctx.now.getTime() + 86_400_000);
      start.setUTCHours(7, 0, 0, 0);

      let n = 0;
      for (const [i, row] of queue.entries()) {
        await setUpCall({
          applicationId: row.id,
          when: 'schedule',
          at: new Date(start.getTime() + i * 15 * 60_000),
        }, ctx);
        n += 1;
      }
      return {
        toast: `${n} call${n === 1 ? '' : 's'} scheduled from tomorrow morning, fifteen minutes apart`,
        icon: 'phone',
        ms: 4600,
        closeSheet: 'all',
      };
    },
  },

  /* ── What the screen recorded about pay ───────────────────────────────── */
  'scr.capture': {
    capability: 'screening.capture',
    schema: base,
    async run({ v }, ctx) {
      const [s] = await ctx.tx.select().from(screenings).where(eq(screenings.id, v)).limit(1);
      if (!s) throw new CommandError('That screening no longer exists');
      await requireApplication(ctx.viewer, s.applicationId, ctx.tx);
      const r = await captureFromTranscript(v, ctx);
      return {
        toast: `Read off the call — currently on ${sar(r.currentSalary)}, asking ${sar(r.expectedSalary)}`,
        icon: 'coin',
        ms: 4200,
      };
    },
  },

  'scr.salarySave': {
    capability: 'screening.capture',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await recordSalary({
        applicationId: v,
        currentSalary: num(fields, 'cur') ?? 0,
        expectedSalary: num(fields, 'exp'),
        noticeDays: num(fields, 'notice'),
      }, ctx);
      return {
        toast: `Recorded — on ${sar(r.currentSalary)} today${
          r.expectedSalary ? `, asking ${sar(r.expectedSalary)}` : ''}`,
        icon: 'coin',
        closeSheet: true,
      };
    },
  },
});
