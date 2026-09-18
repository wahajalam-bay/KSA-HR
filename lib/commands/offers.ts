import 'server-only';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { offers, offerTemplates } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str } from './fields';
import { requireApplication } from '@/lib/authz';
import { audit } from '@/lib/audit';
import {
  draftOffer, submitOffer, decideOffer, verifyLetter, unverifyLetter, editLetter, editTerms,
  sendOffer, recordDocument, markViewed, recordSignature, acceptOffer, declineOffer,
  reviseOffer, offerOf, mayVerify, DECLINE_REASONS,
} from '@/lib/services/offers';

/* ─────────────────────────────────────────────────────────────────────────────
   The offer, end to end.

   Every command here takes the offer's id except the two that start from an
   application — drafting one, and the drawer's "make an offer". Each checks the
   viewer's access to the application behind the offer, which is what stops a
   recruiter outside a requisition from touching its offers by knowing an id.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const num = (f: Record<string, unknown>, k: string): number | undefined => {
  const raw = str(f, k);
  if (!raw) return undefined;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : undefined;
};
const sar = (n: number) => `SAR ${n.toLocaleString('en-US')}`;

/** The offer behind an id, with the viewer's access to it checked. */
async function reach(v: string, ctx: Parameters<Parameters<typeof defineMany>[0][string]['run']>[1]) {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, v)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  await requireApplication(ctx.viewer, o.applicationId, ctx.tx);
  return o;
}

function terms(fields: Record<string, unknown>) {
  const t = {
    baseMonthly: num(fields, 'baseMonthly') ?? num(fields, 'base'),
    housing: num(fields, 'housing'),
    transport: num(fields, 'transport'),
    annualBonusPct: num(fields, 'annualBonusPct') ?? num(fields, 'bonus'),
    startDate: str(fields, 'startDate') || undefined,
    templateId: str(fields, 'templateId') || undefined,
  };
  return Object.fromEntries(Object.entries(t).filter(([, x]) => x !== undefined));
}

defineMany({
  /* ── Drafting and the chain ───────────────────────────────────────────── */
  'offer.draft': {
    capability: 'offer.draft',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireApplication(ctx.viewer, v, ctx.tx);
      const r = await draftOffer({ applicationId: v, terms: terms(fields) }, ctx);
      return {
        toast: r.templateName
          ? `Letter filled from ${r.templateName} — ${r.verifierName?.split(/\s+/)[0] ?? 'Onboarding'} has been asked to verify it`
          : 'Offer drafted — no letter template is uploaded yet',
        icon: 'file',
        ms: 4200,
        data: { offerId: r.offerId, reference: r.reference },
      };
    },
  },

  'offer.submit': {
    capability: 'offer.submit',
    schema: base,
    async run({ v }, ctx) {
      await reach(v, ctx);
      const r = await submitOffer(v, ctx);
      return {
        toast: r.approvedImmediately
          ? 'Approved — every step on the chain was recorded automatically'
          : `Sent for approval — ${r.steps} step${r.steps === 1 ? '' : 's'}`,
        icon: 'check',
      };
    },
  },

  'offer.approve': {
    capability: 'approval.act',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);
      const r = await decideOffer(v, 'approve', str(fields, 'note') || null, ctx);
      return {
        toast: r.finished
          ? `Approved by the chain${r.verified ? ' — ready to send' : ' — Onboarding verifies the letter next'}`
          : `${r.label} approved — now with ${r.nextWith}`,
        icon: 'check',
        ms: 4200,
      };
    },
  },

  'offer.reject': {
    capability: 'approval.act',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);
      const r = await decideOffer(v, 'reject', str(fields, 'reason') || null, ctx);
      return { toast: `Sent back at ${r.label}`, icon: 'x', closeSheet: true };
    },
  },

  /* ── The letter ───────────────────────────────────────────────────────── */
  'offer.verifyConfirm': {
    capability: 'offer.verify',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);
      const r = await verifyLetter({ offerId: v, note: str(fields, 'note') || null }, ctx);
      return {
        toast: r.readyToSend
          ? 'Verified — the offer can now be sent for signature'
          : 'Verified — it can be sent once the approval chain closes',
        icon: 'check',
        ms: 4200,
        closeSheet: true,
      };
    },
  },

  'offer.unverify': {
    capability: 'offer.verify',
    schema: base,
    async run({ v }, ctx) {
      await reach(v, ctx);
      await unverifyLetter(v, ctx);
      return {
        toast: 'Re-opened for corrections — sending is blocked until it is verified again',
        icon: 'pencil',
      };
    },
  },

  'offer.editSave': {
    capability: 'offer.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);

      /* The sheet carries the terms and the merge fields together, because that
         is how the specialist reads the letter — the figures at the top and the
         words underneath. Both go through their own door. */
      const t = terms(fields);
      const changed = Object.keys(t).length
        ? (await editTerms({ offerId: v, terms: t }, ctx)).changed
        : [];

      let n = 0;
      for (const [k, raw] of Object.entries(fields)) {
        if (!k.startsWith('f_') && k !== 'wording') continue;
        const field = k === 'wording' ? 'wording' : k.slice(2);
        await editLetter({ offerId: v, field, value: typeof raw === 'string' ? raw : null }, ctx);
        n += 1;
      }

      const parts: string[] = [];
      if (changed.length) parts.push(`${changed.join(', ')} changed`);
      if (n) parts.push(`${n} correction${n === 1 ? '' : 's'} recorded`);
      return {
        toast: parts.length
          ? `${parts.join(', ')} — verify the letter again`
          : 'No changes',
        icon: 'pencil',
        closeSheet: true,
      };
    },
  },

  /* Which requisitions a letter template is the default for. */
  'otpl.scope': {
    capability: 'offer.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      if (!mayVerify(ctx.viewer)) {
        throw new CommandError('Only Onboarding or an Admin can change a letter template');
      }
      const [t] = await ctx.tx.select().from(offerTemplates)
        .where(eq(offerTemplates.id, v)).limit(1);
      if (!t) throw new CommandError('That template no longer exists');

      const scope = str(fields, 'family');
      const before = { family: t.family, isDefault: t.isDefault };

      if (scope === '*') {
        /* One fallback at a time, or two letters would both claim to be the
           one a requisition with no family-specific template gets. */
        await ctx.tx.update(offerTemplates).set({ isDefault: false })
          .where(sql`${offerTemplates.id} <> ${v}`);
        await ctx.tx.update(offerTemplates).set({ isDefault: true, family: null })
          .where(eq(offerTemplates.id, v));
      } else if (scope) {
        await ctx.tx.update(offerTemplates).set({ isDefault: false, family: scope })
          .where(eq(offerTemplates.id, v));
      } else {
        await ctx.tx.update(offerTemplates).set({ isDefault: false, family: null })
          .where(eq(offerTemplates.id, v));
      }

      await audit(ctx, {
        action: 'update',
        summary: scope === '*'
          ? `made ${t.name} the default offer letter`
          : scope
            ? `made ${t.name} the default for ${scope} requisitions`
            : `${t.name} is now available on request only`,
        entityType: 'template', entityId: v, entityLabel: t.name,
        before, after: { family: scope === '*' ? null : scope || null, isDefault: scope === '*' },
      }, ctx.tx);

      return {
        toast: scope === '*' ? `${t.name} is the default letter`
          : scope ? `${t.name} is the default for ${scope}`
            : `${t.name} is on request only`,
        icon: 'file',
      };
    },
  },

  /* ── Sending and the envelope ─────────────────────────────────────────── */
  'offer.send': {
    capability: 'offer.send',
    schema: base,
    async run({ v }, ctx) {
      await reach(v, ctx);
      const r = await sendOffer(v, ctx);
      return {
        toast: r.envelope
          ? 'Envelope sent for e-signature — the candidate uploads the four documents before signing'
          : `Offer sent to ${r.candidateName} — ${r.note}`,
        tone: r.envelope ? undefined : 'warn',
        icon: 'file',
        ms: 4600,
      };
    },
  },

  /* `offerId:key` from the drawer's dropzone. The file itself is handled by the
     upload route; this records what arrived. */
  'offer.doc': {
    capability: 'offer.document',
    schema: base,
    async run({ v, fields }, ctx) {
      const [offerId, key] = v.split(':');
      if (!offerId || !key) throw new CommandError('That document was not understood');
      await reach(offerId, ctx);
      const r = await recordDocument({ offerId, key, fileId: str(fields, 'fileId') || null }, ctx);
      return {
        toast: `${r.label} received${r.left ? ` — ${r.left} more to go` : ' — all four in, the offer can now be signed'}`,
        icon: r.left ? 'upload' : 'check',
      };
    },
  },

  'offer.viewed': {
    capability: 'offer.record_response',
    schema: base,
    async run({ v }, ctx) {
      await reach(v, ctx);
      await markViewed(v, ctx);
      return { toast: 'Candidate opened the envelope', icon: 'eye' };
    },
  },

  /* The signed copy came back. With a provider configured the webhook writes
     this; without one, somebody records it when the PDF arrives. */
  'offer.recordSigned': {
    capability: 'offer.record_response',
    schema: base,
    async run({ v }, ctx) {
      await reach(v, ctx);
      const r = await recordSignature({ offerId: v, source: 'manual' }, ctx);
      return { toast: `${r.reference} signed by ${r.candidateName}`, icon: 'badge', ms: 4200 };
    },
  },

  /* ── The answer ───────────────────────────────────────────────────────── */
  'offer.accept': {
    capability: 'offer.record_response',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);
      const r = await acceptOffer({
        offerId: v,
        source: str(fields, 'source') || undefined,
        note: str(fields, 'note') || null,
      }, ctx);
      return {
        toast: `${r.candidateName} joins on ${r.startDate} as ${r.employeeCode}`,
        icon: 'trophy',
        ms: 4600,
      };
    },
  },

  'offer.declineSave': {
    capability: 'offer.record_response',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);
      const reason = str(fields, 'why') || str(fields, 'reason');
      if (!(DECLINE_REASONS as readonly string[]).includes(reason)) {
        throw new CommandError('Pick one of the reasons — it is what Insights counts');
      }
      const r = await declineOffer({
        offerId: v,
        reason,
        note: str(fields, 'note') || null,
        source: str(fields, 'source') || 'call',
      }, ctx);
      return {
        toast: `${r.candidateName} declined — ${r.reason.toLowerCase()}`,
        icon: 'x',
        ms: 4200,
        closeSheet: true,
      };
    },
  },

  'offer.reviseConfirm': {
    capability: 'offer.revise',
    schema: base,
    async run({ v, fields }, ctx) {
      await reach(v, ctx);
      const r = await reviseOffer({ offerId: v, terms: terms(fields) }, ctx);
      return {
        toast: `Version ${r.version} created — the sent letter stays as it was; the new one needs verifying`,
        icon: 'file',
        ms: 4200,
        data: { offerId: r.offerId, reference: r.reference },
      };
    },
  },

  /* The drawer's button takes the application, not the offer. */
});
