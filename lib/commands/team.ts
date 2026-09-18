import 'server-only';
import { z } from 'zod';
import { defineMany, CommandError } from './registry';
import { list as listOf, str } from './fields';
import {
  addPerson, savePerson, deactivate, reactivate, deletePerson, restorePerson,
  setTarget, owned, heirs,
} from '@/lib/services/team';
import { TEAM_ROLES, type RoleKey } from '@/lib/domain/team';

/* ─────────────────────────────────────────────────────────────────────────────
   The TA team.

   `team.manage` covers adding, editing and deactivating; deleting a profile is
   an Admin's alone and is refused in the service as well, because it is the one
   action here that moves other people's work.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const num = (f: Record<string, unknown>, k: string): number | null => {
  const raw = str(f, k);
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

function readRole(f: Record<string, unknown>, fallback?: string): RoleKey {
  const raw = str(f, 'role') || fallback || 'recruiter';
  const def = TEAM_ROLES.find((x) => x.v === raw);
  if (!def) throw new CommandError('That is not one of the roles on the team');
  return def.v;
}

const first = (name: string) => name.split(/\s+/)[0];

defineMany({
  'staff.create': {
    capability: 'team.manage',
    schema: base,
    async run({ fields }, ctx) {
      const r = await addPerson({
        name: str(fields, 'name'),
        title: str(fields, 'title') || null,
        role: readRole(fields),
        email: str(fields, 'email') || null,
        phone: str(fields, 'phone') || null,
        locationId: str(fields, 'locationId') || null,
        deptIds: listOf(fields, 'deptIds'),
        monthlyTarget: num(fields, 'monthlyTarget'),
        gender: str(fields, 'gender') || null,
      }, ctx);
      return {
        toast: `${first(r.name)} added to the team`,
        icon: 'badge',
        closeSheet: true,
        go: `/team/${r.id}`,
        data: { staffId: r.id },
      };
    },
  },

  'staff.save': {
    capability: 'team.manage',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await savePerson(v, {
        name: str(fields, 'name'),
        title: str(fields, 'title') || null,
        role: readRole(fields, str(fields, 'currentRole')),
        email: str(fields, 'email') || null,
        phone: str(fields, 'phone') || null,
        locationId: str(fields, 'locationId') || null,
        deptIds: listOf(fields, 'deptIds'),
        monthlyTarget: num(fields, 'monthlyTarget'),
        gender: str(fields, 'gender') || null,
      }, ctx);
      return { toast: `${first(r.name)}'s profile saved`, icon: 'check', closeSheet: true };
    },
  },

  'staff.deactivate': {
    capability: 'team.manage',
    schema: base,
    async run({ v, fields }, ctx) {
      if (!['1', 'true', 'on', 'yes'].includes(str(fields, 'confirmed'))) {
        const what = await owned(v, ctx.tx);
        return {
          confirm: {
            title: 'Mark them inactive?',
            body: 'They keep their history and stay on the record of everything they touched, and '
              + 'they can no longer sign in.'
              + (what.requisitions.length
                ? ` ${what.requisitions.length} open requisition${what.requisitions.length === 1 ? '' : 's'} `
                  + `${what.requisitions.length === 1 ? 'needs' : 'need'} a new owner.`
                : ''),
            yes: 'Deactivate',
            no: 'Keep active',
            danger: true,
          },
        };
      }
      const r = await deactivate(v, ctx);
      return {
        toast: r.openRequisitions
          ? `${r.name} marked inactive — ${r.openRequisitions} open `
            + `${r.openRequisitions === 1 ? 'requisition needs' : 'requisitions need'} a new owner`
          : `${r.name} marked inactive`,
        tone: r.openRequisitions ? 'warn' : undefined,
        icon: 'alert',
        closeSheet: 'all',
      };
    },
  },

  'staff.reactivate': {
    capability: 'team.manage',
    schema: base,
    async run({ v }, ctx) {
      const r = await reactivate(v, ctx);
      return { toast: `${first(r.name)} is back on the team`, icon: 'check' };
    },
  },

  /* Deleting hands the desk over in the same transaction. The sheet asks who
     inherits it; this refuses without an answer when there is anything to
     inherit. */
  'staff.deleteConfirm': {
    capability: 'team.manage',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await deletePerson({ id: v, heirId: str(fields, 'heir') || null }, ctx);
      const moved = r.requisitions + r.applications + r.tasks;
      return {
        toast: r.heirName
          ? `${r.name} deleted — ${moved} ${moved === 1 ? 'record' : 'records'} handed to ${first(r.heirName)}`
          : `${r.name} deleted`,
        tone: 'bad',
        icon: 'trash',
        ms: 7000,
        closeSheet: 'all',
        go: '/team',
      };
    },
  },

  'staff.restore': {
    capability: 'team.manage',
    schema: base,
    async run({ v }, ctx) {
      const r = await restorePerson(v, ctx);
      return { toast: `${r.name} restored`, icon: 'refresh' };
    },
  },

  'staff.target': {
    capability: 'team.manage',
    schema: base,
    async run({ v, fields }, ctx) {
      const target = num(fields, 'monthlyTarget');
      if (target == null) throw new CommandError('A monthly target, please');
      const r = await setTarget({ id: v, monthlyTarget: target }, ctx);
      return {
        toast: `${first(r.name)}'s target is ${r.monthlyTarget} a month`,
        icon: 'target',
        closeSheet: true,
      };
    },
  },

  /* What the delete sheet shows before anybody presses the red button. */
  'staff.owned': {
    capability: 'team.view',
    schema: base,
    async run({ v }, ctx) {
      const what = await owned(v, ctx.tx);
      const who = await heirs(v, ctx.tx);
      return { refresh: false, data: { owned: what, heirs: who } };
    },
  },
});
