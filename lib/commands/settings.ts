import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { approvalFlowSteps, accounts, pipelines, pitchProjects } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { list as listOf, str, yes } from './fields';
import {
  saveOrg, saveDepartment, archiveDepartment, saveStep, removeStep, saveFlow,
  savePipeline, saveEmailTemplate, saveQuestion, archiveQuestion,
  savePitchProject, togglePitchProject, savePitchConfig, toggleRule, saveTeam,
  inviteAccount, setScope, setAccountStatus, removeAccount, resetPassword,
} from '@/lib/services/settings';
import { audit } from '@/lib/audit';

/* ─────────────────────────────────────────────────────────────────────────────
   Settings.

   Twelve panels, one capability — `settings.edit` — and a second check inside
   every service for the things only an Admin does. The double check is
   deliberate: `settings.edit` is what opens the panel, and being an Admin is
   what lets somebody change who approves an offer.

   Integrations are not here. They are read from the environment, which is the
   only place a credential belongs, and the page reports what it finds.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const num = (f: Record<string, unknown>, k: string): number | null => {
  const raw = str(f, k);
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const json = <T>(f: Record<string, unknown>, k: string, fallback: T): T => {
  const raw = f[k];
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw as T;
  try { return JSON.parse(raw) as T; } catch { throw new CommandError(`${k} was not understood`); }
};

defineMany({
  /* ── Branding and the organisation ────────────────────────────────────── */
  'set.org': {
    capability: 'settings.edit',
    schema: base,
    async run({ fields }, ctx) {
      const r = await saveOrg({
        orgName: str(fields, 'orgName') || undefined,
        legalName: str(fields, 'legalName') || undefined,
        currency: str(fields, 'currency') || undefined,
        currencySymbol: str(fields, 'currencySymbol') || undefined,
        country: str(fields, 'country') || undefined,
        timezone: str(fields, 'timezone') || undefined,
        fiscalYearStart: str(fields, 'fiscalYearStart') || undefined,
        locale: str(fields, 'locale') || undefined,
        secondLocale: str(fields, 'secondLocale') || undefined,
        dataRetentionMonths: num(fields, 'dataRetentionMonths') ?? undefined,
        probationMonths: num(fields, 'probationMonths') ?? undefined,
        brandPrimary: str(fields, 'brandPrimary') || undefined,
        brandAccent: str(fields, 'brandAccent') || undefined,
        brandNote: str(fields, 'brandNote') || undefined,
        offerApprovalThreshold: num(fields, 'offerApprovalThreshold') ?? undefined,
        leaderName: str(fields, 'leaderName') || undefined,
        leaderTitle: str(fields, 'leaderTitle') || undefined,
        signedBy: str(fields, 'signedBy') || undefined,
        atsOwner: str(fields, 'atsOwner') || undefined,
        hrisName: str(fields, 'hrisName') || undefined,
      }, ctx);
      return {
        toast: r.changed.length ? 'Saved — every page follows' : 'No changes',
        icon: 'check',
        closeSheet: true,
      };
    },
  },

  /* ── Departments ──────────────────────────────────────────────────────── */
  'dept.save': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await saveDepartment(v || 'new', {
        name: str(fields, 'name'),
        code: str(fields, 'code') || null,
        functionId: str(fields, 'functionId') || null,
        head: str(fields, 'head') || null,
        headTitle: str(fields, 'headTitle') || null,
        headcount: num(fields, 'headcount'),
        costCentre: str(fields, 'costCentre') || null,
      }, ctx);
      return {
        toast: r.created
          ? `${r.name} added${str(fields, 'head') ? ` — ${str(fields, 'head')} is its hiring manager` : ''}`
          : `${r.name} saved${r.headChanged ? ` — ${r.headChanged} live requisition${r.headChanged === 1 ? '' : 's'} followed the new head` : ''}`,
        icon: r.created ? 'plus' : 'check',
        closeSheet: true,
      };
    },
  },

  'dept.remove': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      if (!yes(fields, 'confirmed')) {
        return {
          confirm: {
            title: 'Remove this department?',
            body: 'It disappears from the filters and the requisition form. Every closed '
              + 'requisition keeps its name, because history is not rewritten.',
            yes: 'Remove',
            no: 'Keep it',
            danger: true,
          },
        };
      }
      const r = await archiveDepartment(v, ctx);
      return { toast: `${r.name} removed`, icon: 'trash' };
    },
  },

  /* ── The approval chains ──────────────────────────────────────────────── */
  'apf.stepSave': {
    capability: 'approval.configure',
    schema: base,
    async run({ v, fields }, ctx) {
      const [flowId, stepId] = v.split(':');
      if (!flowId) throw new CommandError('That step was not understood');
      const r = await saveStep(flowId, stepId || 'new', {
        label: str(fields, 'label'),
        approverType: (str(fields, 'approverType') || 'role') as never,
        approverRole: str(fields, 'approverRole') || null,
        approverStaffId: str(fields, 'approverStaffId') || null,
        approverName: str(fields, 'approverName') || null,
        approverTitle: str(fields, 'approverTitle') || null,
        approverEmail: str(fields, 'approverEmail') || null,
        condField: str(fields, 'condField') || null,
        condOp: str(fields, 'condOp') || null,
        condValue: num(fields, 'condValue'),
        auto: yes(fields, 'auto'),
      }, ctx);
      return {
        toast: `${r.label} ${r.created ? 'added to the chain' : 'saved'}`,
        icon: 'check',
        closeSheet: true,
      };
    },
  },

  'apf.stepRemove': {
    capability: 'approval.configure',
    schema: base,
    async run({ v }, ctx) {
      const r = await removeStep(v, ctx);
      return {
        toast: `${r.label} removed — ${r.left} step${r.left === 1 ? '' : 's'} left on the chain`,
        icon: 'trash',
      };
    },
  },

  'apf.save': {
    capability: 'approval.configure',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await saveFlow(v, {
        publishOnApprove: 'publishOnApprove' in fields ? yes(fields, 'publishOnApprove') : undefined,
        publishChannels: 'channels' in fields ? listOf(fields, 'channels') : undefined,
        requireVerification: 'requireVerification' in fields ? yes(fields, 'requireVerification') : undefined,
      }, ctx);
      return { toast: `${r.name} saved`, icon: 'check', closeSheet: true };
    },
  },

  /* ── Pipelines ────────────────────────────────────────────────────────── */
  'pl.save': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await savePipeline(v, {
        name: str(fields, 'name') || undefined,
        labels: 'labels' in fields ? json(fields, 'labels', {}) : undefined,
        offStages: 'offStages' in fields ? listOf(fields, 'offStages') : undefined,
        slaOverrides: 'sla' in fields ? json(fields, 'sla', {}) : undefined,
      }, ctx);
      return {
        toast: `${r.name} saved — ${r.live} live requisition${r.live === 1 ? '' : 's'} follow it`,
        icon: 'check',
        closeSheet: true,
      };
    },
  },

  /* ── Templates and the question bank ──────────────────────────────────── */
  'etpl.save': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await saveEmailTemplate(v || 'new', {
        name: str(fields, 'name'),
        stage: str(fields, 'stage') || null,
        lang: str(fields, 'lang') || 'en',
        subject: str(fields, 'subject'),
        body: typeof fields.body === 'string' ? fields.body : '',
      }, ctx);
      return {
        toast: `${r.name} ${r.created ? 'added' : 'saved'}`,
        icon: 'check',
        closeSheet: true,
      };
    },
  },

  'qb.save': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await saveQuestion(v || 'new', {
        text: str(fields, 'text'),
        type: str(fields, 'type') || 'short',
        options: 'options' in fields ? listOf(fields, 'options') : null,
        required: yes(fields, 'required'),
        knockout: str(fields, 'knockout') || null,
        families: listOf(fields, 'families'),
        isStandard: yes(fields, 'isStandard'),
      }, ctx);
      return {
        toast: r.created ? 'Question added to the bank' : 'Question saved',
        icon: 'check',
        closeSheet: true,
      };
    },
  },

  'qb.remove': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      if (!yes(fields, 'confirmed')) {
        return {
          confirm: {
            title: 'Retire this question?',
            body: 'It stops being offered on new requisitions. The ones that already ask it keep '
              + 'asking it, and every answer already given is kept.',
            yes: 'Retire it',
            no: 'Keep it',
          },
        };
      }
      await archiveQuestion(v, ctx);
      return { toast: 'Question retired — the requisitions that ask it keep it', icon: 'trash' };
    },
  },

  /* ── The sales pitch ──────────────────────────────────────────────────── */
  'pp.save': {
    capability: 'pitch.configure',
    schema: base,
    async run({ v, fields }, ctx) {
      const criteria: Array<{ key: string; name: string; hint?: string; max: number }> = [];
      for (let i = 0; i < 8; i += 1) {
        const name = str(fields, `pp_c${i}`);
        if (!name) continue;
        criteria.push({
          key: name.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 18) || `c${i}`,
          name,
          hint: str(fields, `pp_h${i}`) || undefined,
          max: 5,
        });
      }
      const r = await savePitchProject(v || 'new', {
        name: str(fields, 'pp_name'),
        who: str(fields, 'pp_who') || null,
        client: str(fields, 'pp_client') || null,
        brief: str(fields, 'pp_brief'),
        task: str(fields, 'pp_task'),
        durationMin: num(fields, 'pp_dur'),
        prepHours: num(fields, 'pp_prep'),
        criteria,
      }, ctx);
      return {
        toast: `${r.name} saved — every requisition using it follows`,
        icon: 'check',
        ms: 4200,
        closeSheet: true,
      };
    },
  },

  'pp.toggle': {
    capability: 'pitch.configure',
    schema: base,
    async run({ v }, ctx) {
      const r = await togglePitchProject(v, ctx);
      return {
        toast: `${r.name} ${r.active ? 'is live again' : 'retired'}`,
        icon: r.active ? 'check' : 'archive',
      };
    },
  },

  'pp.cfgSave': {
    capability: 'pitch.configure',
    schema: base,
    async run({ fields }, ctx) {
      await savePitchConfig({
        leadHours: num(fields, 'leadHours'),
        channels: 'channels' in fields ? listOf(fields, 'channels') : undefined,
        gateFinal: 'gateFinal' in fields ? yes(fields, 'gateFinal') : undefined,
        waTemplate: typeof fields.waTemplate === 'string' ? fields.waTemplate : undefined,
        emailSubject: str(fields, 'emailSubject') || undefined,
        emailBody: typeof fields.emailBody === 'string' ? fields.emailBody : undefined,
      }, ctx);
      return { toast: 'Saved — the next brief goes out this way', icon: 'check', closeSheet: true };
    },
  },

  /* ── Automations ──────────────────────────────────────────────────────── */
  'aut.toggle': {
    capability: 'automation.manage',
    schema: base,
    async run({ v }, ctx) {
      const r = await toggleRule(v, ctx);
      return {
        toast: `${r.name} switched ${r.enabled ? 'on' : 'off'}`,
        icon: r.enabled ? 'check' : 'pause',
      };
    },
  },

  /* ── The teams a joiner is announced to ───────────────────────────────── */
  'tm.teamSave': {
    capability: 'settings.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await saveTeam(v || 'new', {
        key: str(fields, 'key') || undefined,
        short: str(fields, 'short'),
        name: str(fields, 'name'),
        deptId: str(fields, 'deptId') || null,
        purpose: str(fields, 'purpose') || null,
        ask: str(fields, 'ask') || null,
        onJoining: 'onJoining' in fields ? yes(fields, 'onJoining') : undefined,
        onFile: 'onFile' in fields ? yes(fields, 'onFile') : undefined,
        contacts: 'contacts' in fields
          ? json<Array<{ name: string; email: string; isPrimary?: boolean }>>(fields, 'contacts', [])
          : undefined,
      }, ctx);
      return {
        toast: `${r.name} ${r.created ? 'added' : 'saved'}`,
        icon: 'check',
        closeSheet: true,
      };
    },
  },

  /* ── Access ───────────────────────────────────────────────────────────── */
  'acc.inviteSave': {
    capability: 'access.manage',
    schema: base,
    async run({ fields }, ctx) {
      const role = str(fields, 'role') === 'participant' ? 'participant' : 'hiring_manager';
      const r = await inviteAccount({
        name: str(fields, 'name'),
        email: str(fields, 'email') || null,
        title: str(fields, 'title') || null,
        role,
      }, ctx);
      return {
        toast: r.invited
          ? `Invitation sent to ${r.email} — they set a password at the first sign-in`
          : `${r.email} could already sign in`,
        icon: 'mail',
        ms: 4200,
        closeSheet: true,
      };
    },
  },

  'acc.scopeSave': {
    capability: 'access.manage',
    schema: base,
    async run({ v, fields }, ctx) {
      const kind = (['all', 'own', 'jobs'] as const)
        .find((k) => k === str(fields, 'kind')) ?? 'own';
      const r = await setScope({
        accountId: v,
        kind,
        jobIds: listOf(fields, 'jobIds'),
        own: 'own' in fields ? yes(fields, 'own') : true,
      }, ctx);
      return {
        toast: `${r.name} now sees ${
          r.kind === 'all' ? 'every requisition'
            : r.kind === 'own' ? 'the requisitions they are named on'
              : `${r.jobs} chosen requisition${r.jobs === 1 ? '' : 's'}`}`,
        icon: 'shield',
        closeSheet: true,
      };
    },
  },

  'acc.toggle': {
    capability: 'access.manage',
    schema: base,
    async run({ v }, ctx) {
      const [a] = await ctx.tx.select().from(accounts).where(eq(accounts.id, v)).limit(1);
      if (!a) throw new CommandError('That account no longer exists');
      const r = await setAccountStatus({
        accountId: v,
        status: a.status === 'disabled' ? 'active' : 'disabled',
      }, ctx);
      return {
        toast: `${r.name}'s access ${r.status === 'active' ? 'restored' : 'suspended'}`,
        icon: r.status === 'active' ? 'check' : 'lock',
      };
    },
  },

  'acc.remove': {
    capability: 'access.manage',
    schema: base,
    async run({ v, fields }, ctx) {
      if (!yes(fields, 'confirmed')) {
        const [a] = await ctx.tx.select().from(accounts).where(eq(accounts.id, v)).limit(1);
        return {
          confirm: {
            title: `Remove ${a?.name ?? 'this account'}?`,
            body: 'They can no longer sign in. Their name stays on every record they touched — '
              + 'a scorecard they wrote is still theirs.',
            yes: 'Remove access',
            no: 'Keep it',
            danger: true,
          },
        };
      }
      const r = await removeAccount(v, ctx);
      return { toast: `${r.name} can no longer sign in`, icon: 'trash' };
    },
  },

  'acc.reset': {
    capability: 'access.manage',
    schema: base,
    async run({ v }, ctx) {
      const r = await resetPassword(v, ctx);
      return {
        toast: `${r.name} sets a new password at the next sign-in`,
        icon: 'key',
        ms: 4200,
      };
    },
  },

  /* ── Putting the stage SLAs back ──────────────────────────────────────── */
  /* A pipeline's SLA override is a deliberate decision — "screening on this
     kind of role takes a week" — so clearing them all is an Admin's, it says
     how many it cleared, and it asks first. Requisitions already open keep the
     SLAs they were opened with: the loop on a live requisition is its own. */
  'set.slaReset': {
    capability: 'settings.edit',
    schema: base,
    async run({ fields }, ctx) {
      const rows = await ctx.tx.select().from(pipelines);
      const overridden = rows.filter((p) => Object.keys(p.slaOverrides ?? {}).length);
      const n = overridden.reduce((acc, p) => acc + Object.keys(p.slaOverrides).length, 0);
      if (!n) throw new CommandError('The SLAs are already at their defaults', { tone: 'warn' });

      if (!yes(fields, 'confirmed')) {
        return {
          confirm: {
            title: 'Put every SLA back to its default?',
            body: `${n} override${n === 1 ? '' : 's'} across `
              + `${overridden.length} template${overridden.length === 1 ? '' : 's'} `
              + `— ${overridden.map((p) => p.name).join(', ')}. Requisitions already open keep `
              + 'the SLAs they were opened with; this changes what a new one starts from.',
            yes: 'Restore the defaults',
            no: 'Leave them',
          },
        };
      }

      for (const p of overridden) {
        await ctx.tx.update(pipelines).set({ slaOverrides: {} }).where(eq(pipelines.id, p.id));
      }
      await audit(ctx, {
        action: 'update',
        summary: `restored ${n} stage SLA${n === 1 ? '' : 's'} to the default`,
        entityType: 'settings', entityId: 'pipelines',
        before: Object.fromEntries(overridden.map((p) => [p.name, p.slaOverrides])),
        after: {},
      }, ctx.tx);
      return {
        toast: `${n} SLA${n === 1 ? '' : 's'} restored to the default`,
        icon: 'refresh',
      };
    },
  },

  /* ── Copying a pitch project ──────────────────────────────────────────── */
  /* The briefs are long and mostly the same between two projects in the same
     development, so the way somebody writes the second is by copying the first.
     The copy starts switched off and with no uses, because a project nobody has
     edited yet should not be picked up by a requisition. */
  'pp.copy': {
    capability: 'pitch.configure',
    schema: base,
    async run({ v }, ctx) {
      const [p] = await ctx.tx.select().from(pitchProjects)
        .where(eq(pitchProjects.id, v)).limit(1);
      if (!p) throw new CommandError('That project no longer exists');

      const id = `pp_${crypto.randomUUID().slice(0, 12)}`;
      await ctx.tx.insert(pitchProjects).values({
        id,
        name: `${p.name} (copy)`,
        who: p.who,
        client: p.client,
        brief: p.brief,
        task: p.task,
        durationMin: p.durationMin,
        prepHours: p.prepHours,
        criteria: p.criteria,
        active: false,
        uses: 0,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });

      await audit(ctx, {
        action: 'create',
        summary: `copied the ${p.name} pitch project`,
        entityType: 'pitch_project', entityId: id, entityLabel: `${p.name} (copy)`,
        after: { copiedFrom: p.id },
      }, ctx.tx);
      return {
        toast: 'Copied — edit it and switch it on where you need it',
        icon: 'copy',
        openSheet: { act: 'pp.edit', v: id },
      };
    },
  },
});
