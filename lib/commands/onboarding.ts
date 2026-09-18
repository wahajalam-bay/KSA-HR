import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { employees, references } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { list as listOf, str } from './fields';
import {
  saveForm, recordJoinerDocument, verifyDocument, addReference, recordReference,
  sendJoiningNotice, sendJoinerFile, decideProbation, progress, chaseJoiner,
} from '@/lib/services/joiner';

/* ─────────────────────────────────────────────────────────────────────────────
   Onboarding: the joiner's own details, their documents, their referees, the
   joining date and the two packs the back office acts on.

   Access is by capability rather than by requisition scope: a joiner is not on
   a pipeline any more, and the people who finish their file — Onboarding, the
   coordinator, an Admin — are not necessarily the ones who hired them.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

type Ctx = Parameters<Parameters<typeof defineMany>[0][string]['run']>[1];

/** The joiner behind an id, refused clearly when there is not one. */
async function joiner(id: string, ctx: Ctx) {
  const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!emp) throw new CommandError('That joiner no longer exists');
  return emp;
}

defineMany({
  /* ── The joiner's own details ─────────────────────────────────────────── */
  'emp.formSave': {
    capability: 'onboarding.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      await joiner(v, ctx);
      const r = await saveForm({
        employeeId: v,
        nationalId: str(fields, 'nationalId') || null,
        nationality: str(fields, 'nationality') || null,
        dob: str(fields, 'dob') || null,
        address: str(fields, 'address') || null,
        emergencyContact: str(fields, 'emergency') || null,
        bank: str(fields, 'bank') || null,
        iban: str(fields, 'iban') || null,
      }, ctx);
      return {
        toast: r.submitted
          ? `${r.name.split(/\s+/)[0]}'s details are complete`
          : 'Saved — the form is not complete yet',
        icon: r.submitted ? 'check' : 'pencil',
        closeSheet: true,
      };
    },
  },

  /* ── Documents ────────────────────────────────────────────────────────── */
  /* `employeeId:key` from the file's dropzone. */
  'onb.doc': {
    capability: 'onboarding.file',
    schema: base,
    async run({ v, fields }, ctx) {
      const [employeeId, key] = v.split(':');
      if (!employeeId || !key) throw new CommandError('That document was not understood');
      await joiner(employeeId, ctx);
      const r = await recordJoinerDocument({
        employeeId, key, fileId: str(fields, 'fileId') || null,
      }, ctx);
      return {
        toast: `${r.label} received${r.left ? ` — ${r.left} still to verify` : ''}`,
        icon: 'upload',
      };
    },
  },

  'onb.verify': {
    capability: 'onboarding.verify',
    schema: base,
    async run({ v, fields }, ctx) {
      const [employeeId, key] = v.split(':');
      if (!employeeId || !key) throw new CommandError('That document was not understood');
      await joiner(employeeId, ctx);
      const r = await verifyDocument({ employeeId, key, accept: true }, ctx);
      return {
        toast: r.completed
          ? `${r.label} verified — the file is complete`
          : `${r.label} verified${r.left ? ` — ${r.left} to go` : ''}`,
        icon: r.completed ? 'trophy' : 'check',
        ms: r.completed ? 4600 : undefined,
      };
    },
  },

  'onb.reject': {
    capability: 'onboarding.verify',
    schema: base,
    async run({ v, fields }, ctx) {
      const [employeeId, key] = v.split(':');
      if (!employeeId || !key) throw new CommandError('That document was not understood');
      await joiner(employeeId, ctx);
      const r = await verifyDocument({
        employeeId, key, accept: false, reason: str(fields, 'reason') || null,
      }, ctx);
      return { toast: `${r.label} sent back`, icon: 'x', closeSheet: true };
    },
  },

  /* ── References ───────────────────────────────────────────────────────── */
  'ref.create': {
    capability: 'reference.record',
    schema: base,
    async run({ v, fields }, ctx) {
      await joiner(v, ctx);
      const r = await addReference({
        employeeId: v,
        name: str(fields, 'r_name'),
        title: str(fields, 'r_title') || null,
        company: str(fields, 'r_company') || null,
        relationship: str(fields, 'r_rel') || null,
        contact: str(fields, 'r_contact') || null,
      }, ctx);
      return { toast: `${r.name} added as a referee`, icon: 'uplus', closeSheet: true };
    },
  },

  'ref.save': {
    capability: 'reference.record',
    schema: base,
    async run({ v, fields }, ctx) {
      const [ref] = await ctx.tx.select().from(references).where(eq(references.id, v)).limit(1);
      if (!ref) throw new CommandError('That referee is no longer on the file');
      const status = str(fields, 'r_status') || 'pending';
      if (!['pending', 'contacted', 'done', 'declined'].includes(status)) {
        throw new CommandError('That is not one of the states');
      }
      const r = await recordReference({
        referenceId: v,
        status: status as 'pending' | 'contacted' | 'done' | 'declined',
        rating: str(fields, 'r_rating') || null,
        notes: str(fields, 'r_notes') || null,
      }, ctx);
      return {
        toast: r.rating
          ? `Reference recorded${r.completed ? ' — the file is complete' : ''}`
          : 'Referee updated',
        icon: r.rating ? 'check' : 'pencil',
        closeSheet: true,
      };
    },
  },

  /* ── The joining date and the two packs ───────────────────────────────── */
  'onb.notifySend': {
    capability: 'onboarding.notify',
    schema: base,
    async run({ v, fields }, ctx) {
      await joiner(v, ctx);
      const r = await sendJoiningNotice({
        employeeId: v,
        startDate: str(fields, 'join_date') || null,
        teamKeys: listOf(fields, 'notify'),
      }, ctx);
      return {
        toast: `Joining date ${r.startDate} confirmed — ${r.teams.join(', ')} notified `
          + `(${r.people} ${r.people === 1 ? 'person' : 'people'})`
          + (r.notConfigured ? ` — ${r.notConfigured}` : ''),
        tone: r.notConfigured ? 'warn' : undefined,
        icon: 'mail',
        ms: 4600,
      };
    },
  },

  'onb.fileSend': {
    capability: 'onboarding.file',
    schema: base,
    async run({ v, fields }, ctx) {
      await joiner(v, ctx);
      const r = await sendJoinerFile({ employeeId: v, teamKeys: listOf(fields, 'teams') }, ctx);
      return {
        toast: `File sent to ${r.teams.join(', ')} — ${r.documents} document${r.documents === 1 ? '' : 's'} attached`
          + (r.notConfigured ? ` — ${r.notConfigured}` : ''),
        tone: r.notConfigured ? 'warn' : undefined,
        icon: 'mail',
        ms: 4200,
      };
    },
  },

  /* ── Probation ────────────────────────────────────────────────────────── */
  'prob.save': {
    capability: 'probation.decide',
    schema: base,
    async run({ v, fields }, ctx) {
      await joiner(v, ctx);
      const pass = str(fields, 'outcome') !== 'fail';
      const r = await decideProbation({
        employeeId: v,
        pass,
        reason: str(fields, 'reason') || null,
        note: str(fields, 'note') || null,
      }, ctx);
      return {
        toast: r.state === 'passed'
          ? `${r.name.split(/\s+/)[0]} passed probation`
          : `${r.name} did not pass probation`,
        icon: r.state === 'passed' ? 'check' : 'x',
        tone: r.state === 'passed' ? undefined : 'warn',
        closeSheet: true,
      };
    },
  },

  /* The joiner's own progress, for the panel that shows what is outstanding. */
  'onb.progress': {
    capability: 'onboarding.view',
    schema: base,
    async run({ v }, ctx) {
      const p = await progress(v, ctx.tx);
      return { refresh: false, data: { ...p } };
    },
  },

  /* ── Chasing the joiner ───────────────────────────────────────────────── */
  /* The one thing onboarding actually spends its time on. The message names
     what is outstanding rather than asking in general, because "please
     complete your onboarding" is a message nobody acts on. */
  'emp.remind': {
    capability: 'onboarding.notify',
    schema: base,
    async run({ v }, ctx) {
      const e = await joiner(v, ctx);
      const r = await chaseJoiner(v, ctx);
      if (!r.outstanding.length) {
        throw new CommandError(
          `${e.name} has given us everything — there is nothing to chase`, { tone: 'warn' },
        );
      }
      return {
        toast: r.sent
          ? `Reminder sent to ${e.name.split(/\s+/)[0]} — ${r.outstanding.join(', ')}`
          : `Written to the thread — ${r.note}`,
        tone: r.sent ? undefined : 'warn',
        icon: 'mail',
        ms: 4600,
      };
    },
  },
});
