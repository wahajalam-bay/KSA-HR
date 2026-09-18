import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assessments, pitches } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str } from './fields';
import { requireApplication } from '@/lib/authz';
import { invite, remind, recordResult, TRAITS } from '@/lib/services/assessments';
import { sendBrief, begin, score } from '@/lib/services/pitch';

/* ─────────────────────────────────────────────────────────────────────────────
   The two things that sit between the second interview and the final: the
   behavioural questionnaire a manager-and-above candidate answers, and the
   sales pitch a selling requisition runs. Both gate the final interview, and
   both are scored by somebody rather than by this application.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const listOf = (f: Record<string, unknown>, k: string): string[] => {
  const raw = f[k];
  if (Array.isArray(raw)) return raw.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  return [];
};

defineMany({
  /* ── The behavioural questionnaire ────────────────────────────────────── */
  'asm.send': {
    capability: 'assessment.invite',
    schema: base,
    async run({ v }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await invite(v, ctx);
      const first = r.candidateName.split(/\s+/)[0];
      return {
        toast: r.sent
          ? `${r.provider} questionnaire sent to ${first} — the final unlocks when it is back`
          : `${r.provider} questionnaire written to the thread — ${r.note}`,
        tone: r.sent ? undefined : 'warn',
        icon: 'brain',
        ms: 4600,
      };
    },
  },

  'asm.remind': {
    capability: 'assessment.invite',
    schema: base,
    async run({ v }, ctx) {
      const [a] = await ctx.tx.select().from(assessments).where(eq(assessments.id, v)).limit(1);
      if (!a) throw new CommandError('That questionnaire no longer exists');
      await requireApplication(ctx.viewer, a.applicationId, ctx.tx);
      const r = await remind(v, ctx);
      return {
        toast: r.sent ? 'Reminder sent' : `Reminder written to the thread — ${r.note}`,
        tone: r.sent ? undefined : 'warn',
        icon: 'mail',
      };
    },
  },

  /* The result, typed in from the provider's report. The provider's own webhook
     writes the same record through the same service — this is the path for a
     provider whose report arrives as a PDF in somebody's inbox. */
  'asm.complete': {
    capability: 'assessment.complete',
    schema: base,
    async run({ v, fields }, ctx) {
      const [a] = await ctx.tx.select().from(assessments).where(eq(assessments.id, v)).limit(1);
      if (!a) throw new CommandError('That questionnaire no longer exists');
      await requireApplication(ctx.viewer, a.applicationId, ctx.tx);

      const traits = TRAITS.map(([name]) => {
        const raw = str(fields, `trait_${name.toLowerCase()}`);
        if (!raw) throw new CommandError(`${name} has no score — the report gives all six`);
        return { name, score: Number(raw) };
      });

      const r = await recordResult({
        assessmentId: v,
        traits,
        source: 'manual',
        reportRef: str(fields, 'reportRef') || null,
      }, ctx);

      return {
        toast: `Results in — ${r.score} of 100, ${r.verdict}. The final interview is unlocked.`,
        icon: 'brain',
        ms: 4600,
        closeSheet: true,
      };
    },
  },

  /* ── The sales pitch ──────────────────────────────────────────────────── */
  'pitch.send': {
    capability: 'pitch.send',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await sendBrief({
        applicationId: v,
        channels: listOf(fields, 'channels'),
      }, ctx);
      const first = r.candidateName.split(/\s+/)[0];
      return {
        toast: r.delivered.length
          ? `Brief sent to ${first} — ${r.delivered.join(' and ')}`
          : `Brief written to the thread — ${r.notes[0] ?? 'no channel is configured'}`,
        tone: r.delivered.length ? undefined : 'warn',
        icon: 'mail',
        ms: 4200,
      };
    },
  },

  'pitch.run': {
    capability: 'pitch.run',
    schema: base,
    async run({ v }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await begin(v, ctx);
      return {
        toast: `Pitch under way — ${r.candidateName} on ${r.projectName}. Score it when the call ends.`,
        icon: 'target',
        ms: 4200,
      };
    },
  },

  'pitch.score': {
    capability: 'pitch.run',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const scores: Record<string, number> = {};
      for (const [k, raw] of Object.entries(fields)) {
        if (!k.startsWith('c_')) continue;
        scores[k.slice(2)] = Number(raw);
      }
      if (!Object.keys(scores).length) throw new CommandError('Score each criterion');

      const r = await score({
        applicationId: v,
        scores,
        summary: str(fields, 'summary') || null,
        strengths: listOf(fields, 'strengths'),
        gaps: listOf(fields, 'gaps'),
        model: 'human',
      }, ctx);

      return {
        toast: `Pitch scored ${r.pct} of 100 — ${r.verdict}`,
        icon: 'spark',
        ms: 4200,
        closeSheet: true,
      };
    },
  },

  'pitch.cancel': {
    capability: 'pitch.send',
    schema: base,
    async run({ v }, ctx) {
      const [p] = await ctx.tx.select().from(pitches)
        .where(eq(pitches.applicationId, v)).limit(1);
      if (!p) throw new CommandError('There is no pitch on this application');
      await requireApplication(ctx.viewer, p.applicationId, ctx.tx);
      if (p.status === 'completed') {
        throw new CommandError('That pitch has already been scored', { tone: 'warn' });
      }
      await ctx.tx.update(pitches).set({ status: 'cancelled' }).where(eq(pitches.id, p.id));
      return { toast: 'Pitch cancelled', icon: 'x' };
    },
  },
});
