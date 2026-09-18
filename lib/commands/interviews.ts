import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { interviews, interviewPanel, candidates, jobs, applications } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str, yes } from './fields';
import { requireApplication } from '@/lib/authz';
import { schedule, reschedule, cancel } from '@/lib/services/interviews';
import { analyse as analyseInterview, analyseAll as analyseAllFor } from '@/lib/services/ivreview';
import type { StageKey } from '@/lib/domain/stages';

/* ─────────────────────────────────────────────────────────────────────────────
   Booking, moving and cancelling an interview.

   Three doors reach the same service: the Schedule sheet (`ivw.create`), the
   slot picker on the drawer (`book.confirm`), and the Move sheet
   (`ivw.moveSave`). They differ only in what the form is called; the rules
   about panels, gates, clashes and scorecards live in one place behind them.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const parsePanel = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

/* Riyadh time. The sheet's date and time inputs are local to the office, and
   the record keeps the instant. */
function parseAt(f: Record<string, unknown>): Date {
  const date = str(f, 'date');
  const time = str(f, 'time');
  if (!date || !time) throw new CommandError('A date and a start time are both required');
  const at = new Date(`${date}T${time}:00+03:00`);
  if (Number.isNaN(+at)) throw new CommandError('That date and time were not understood');
  return at;
}

const riyadh = (at: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'Asia/Riyadh' }).format(new Date(at));
const dateShort = (at: string) => riyadh(at, { day: 'numeric', month: 'short' });
const timeOf = (at: string) => riyadh(at, { hour: '2-digit', minute: '2-digit' });

const duration = (f: Record<string, unknown>, k: string, fallback: number): number => {
  const raw = Number(str(f, k));
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback;
};

defineMany({
  /* ── The Schedule sheet ───────────────────────────────────────────────── */
  'ivw.create': {
    capability: 'interview.schedule',
    schema: base,
    async run({ fields }, ctx) {
      const applicationId = str(fields, 'appId');
      if (!applicationId) throw new CommandError('Pick a live application first');
      await requireApplication(ctx.viewer, applicationId, ctx.tx);

      const r = await schedule({
        applicationId,
        at: parseAt(fields),
        durationMin: duration(fields, 'durationMin', 45),
        mode: str(fields, 'mode') || 'Google Meet',
        stage: (str(fields, 'stage') || undefined) as StageKey | undefined,
        interviewer: str(fields, 'interviewer') || null,
        panel: parsePanel(str(fields, 'panel')),
        organiserId: str(fields, 'organiserId') || null,
        force: yes(fields, 'force'),
      }, ctx);

      return {
        toast: `Booked for ${dateShort(r.at)}, ${timeOf(r.at)}${
          r.weekend ? ' — that is a Friday or Saturday' : ''}`,
        icon: 'cal',
        tone: r.weekend ? 'bad' : undefined,
        closeSheet: 'all',
        go: '/scheduling?tab=agenda&range=up',
        data: { interviewId: r.interviewId, scorecards: r.scorecards, invited: r.invited },
      };
    },
  },

  /* ── The slot picker on the drawer: `appId|isoAt` ─────────────────────── */
  'book.confirm': {
    capability: 'interview.schedule',
    schema: base,
    async run({ v, fields }, ctx) {
      const [applicationId, at] = v.split('|');
      if (!applicationId || !at) throw new CommandError('That slot was not understood');
      await requireApplication(ctx.viewer, applicationId, ctx.tx);
      const when = new Date(at);
      if (Number.isNaN(+when)) throw new CommandError('That slot was not understood');

      const r = await schedule({
        applicationId,
        at: when,
        durationMin: duration(fields, 'dur', 45),
        mode: str(fields, 'mode') || 'Google Meet',
        stage: (str(fields, 'stage') || undefined) as StageKey | undefined,
        interviewer: str(fields, 'interviewer') || null,
        panel: parsePanel(str(fields, 'panel')),
        confirmCandidate: true,
        force: yes(fields, 'force'),
      }, ctx);

      return {
        toast: `Booked ${dateShort(r.at)} at ${timeOf(r.at)} — invitation sent`,
        icon: 'cal',
        closeSheet: 'all',
        data: { interviewId: r.interviewId },
      };
    },
  },

  /* ── The Move sheet ───────────────────────────────────────────────────── */
  'ivw.moveSave': {
    capability: 'interview.reschedule',
    schema: base,
    async run({ v, fields }, ctx) {
      const [iv] = await ctx.tx.select().from(interviews).where(eq(interviews.id, v)).limit(1);
      if (!iv) throw new CommandError('That interview no longer exists');
      await requireApplication(ctx.viewer, iv.applicationId, ctx.tx);

      const gaveInterviewer = 'interviewer' in fields;
      const r = await reschedule({
        interviewId: v,
        at: parseAt(fields),
        durationMin: duration(fields, 'durationMin', iv.durationMin),
        mode: str(fields, 'mode') || iv.mode,
        interviewer: gaveInterviewer ? (str(fields, 'interviewer') || null) : undefined,
        panel: 'panel' in fields ? parsePanel(str(fields, 'panel')) : undefined,
        reason: str(fields, 'reason') || null,
        force: yes(fields, 'force'),
      }, ctx);

      return {
        toast: `Moved to ${dateShort(r.to)}, ${timeOf(r.to)}${
          r.weekend ? ' — that is a Friday or Saturday' : ''}`,
        icon: 'clock',
        tone: r.weekend ? 'warn' : undefined,
        closeSheet: 'all',
      };
    },
  },

  /* ── Cancel, from the agenda row or the drawer ────────────────────────── */
  'ivw.cancel': {
    capability: 'interview.cancel',
    schema: base,
    async run({ v, fields }, ctx) {
      const [iv] = await ctx.tx.select().from(interviews).where(eq(interviews.id, v)).limit(1);
      if (!iv) throw new CommandError('That interview no longer exists');
      await requireApplication(ctx.viewer, iv.applicationId, ctx.tx);

      if (!yes(fields, 'confirmed')) {
        const [c] = await ctx.tx.select({ name: candidates.name }).from(candidates)
          .where(eq(candidates.id, iv.candidateId)).limit(1);
        const panel = await ctx.tx.select({ name: interviewPanel.name }).from(interviewPanel)
          .where(eq(interviewPanel.interviewId, iv.id));
        return {
          confirm: {
            title: 'Cancel this interview?',
            body: `${c?.name ?? iv.title} on ${dateShort(iv.at.toISOString())} at `
              + `${timeOf(iv.at.toISOString())}, with `
              + `${panel.length ? panel.map((p) => p.name).join(', ') : 'no panel set'}. `
              + 'The slot is released and the panel loses the invitation. The application stays '
              + 'exactly where it is — cancelling an interview is not a rejection.',
            yes: 'Cancel the interview',
            no: 'Keep it',
            danger: true,
          },
        };
      }

      const r = await cancel({ interviewId: v, reason: str(fields, 'reason') || null }, ctx);
      return { toast: 'Interview cancelled', icon: 'x', data: { candidate: r.candidateName } };
    },
  },

  /* ── How the interview was run ────────────────────────────────────────── */
  /* Coaching from the recording, for whoever ran it. Refused when there is no
     recording or no model — see the note at the top of
     lib/services/ivreview.ts, which is the whole point of the flow. */
  'ivr.analyse': {
    capability: 'ivreview.analyse',
    schema: base,
    async run({ v }, ctx) {
      const [iv] = await ctx.tx.select().from(interviews).where(eq(interviews.id, v)).limit(1);
      if (!iv) throw new CommandError('That interview no longer exists');
      await requireApplication(ctx.viewer, iv.applicationId, ctx.tx);

      const r = await analyseInterview(v, ctx);
      return {
        toast: `${iv.interviewer ?? 'The panel'} scored ${r.score} of 100`
          + (r.flags.length ? ` — ${r.flags.length} thing${r.flags.length === 1 ? '' : 's'} flagged` : ''),
        tone: r.flags.length ? 'warn' as const : undefined,
        icon: 'target',
        ms: 4600,
      };
    },
  },

  'ivr.analyseAll': {
    capability: 'ivreview.analyse',
    schema: base,
    async run({ v }, ctx) {
      /* One interviewer's back catalogue. An Admin's button — it reads every
         recording that person has left behind, and a recruiter should not be
         able to run the whole desk's. */
      if (!ctx.viewer.isAdmin) {
        throw new CommandError('Only an Admin reviews a whole back catalogue');
      }
      if (!v) throw new CommandError('Whose interviews?');
      const r = await analyseAllFor(v, ctx);
      return {
        toast: `${r.done} interview${r.done === 1 ? '' : 's'} reviewed`
          + (r.skipped.length
            ? ` — ${r.skipped.length} could not be: ${r.skipped[0].why}`
            : ''),
        tone: r.skipped.length ? 'warn' as const : undefined,
        icon: 'target',
        ms: 5200,
        data: { done: r.done, skipped: r.skipped },
      };
    },
  },
});
