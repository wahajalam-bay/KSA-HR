import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { files } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { str } from './fields';
import {
  addPosition, savePosition, retirePosition, importDepartment, nextCode,
  type ImportRow,
} from '@/lib/services/manpower';

/* ─────────────────────────────────────────────────────────────────────────────
   The manpower plan: seats, their reporting lines, and the spreadsheet a
   department head keeps.

   The import is the only command in the product that writes a whole
   department's chart at once, so it is also the only one that reports what it
   could not do: a row whose manager is not in the sheet is listed back rather
   than hung off the top of the chart and forgotten.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const num = (f: Record<string, unknown>, k: string): number | null => {
  const raw = str(f, k);
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

/* The import sheet arrives parsed. The upload route reads the workbook and
   posts the rows as JSON in one field, because a form field is a string and
   pretending otherwise only moves the parsing somewhere less visible. */
function readRows(raw: unknown): ImportRow[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { throw new CommandError('The sheet was not understood'); }
  }
  if (!Array.isArray(list)) throw new CommandError('The sheet was not understood');
  return list.map((r) => {
    const row = r as Record<string, unknown>;
    const text = (k: string) => (typeof row[k] === 'string' ? (row[k] as string).trim() : null);
    return {
      title: text('title') ?? '',
      code: text('code'),
      grade: text('grade'),
      reportsTo: text('reportsTo'),
      approved: Number(row.approved) || null,
      holder: text('holder'),
      holderTitle: text('holderTitle'),
      startDate: text('startDate'),
      location: text('location'),
    };
  });
}

defineMany({
  'pos.save': {
    capability: 'plan.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      if (v === 'new') {
        const r = await addPosition({
          title: str(fields, 'title'),
          deptId: str(fields, 'deptId'),
          grade: str(fields, 'grade') || null,
          reportsToId: str(fields, 'reportsTo') || null,
          approved: num(fields, 'approved'),
          locationId: str(fields, 'locationId') || null,
          code: str(fields, 'code') || null,
        }, ctx);
        return {
          toast: `${r.code} added to the plan`,
          icon: 'plus',
          closeSheet: true,
          data: { positionId: r.id, code: r.code },
        };
      }
      const r = await savePosition(v, {
        title: str(fields, 'title'),
        grade: str(fields, 'grade') || null,
        reportsToId: 'reportsTo' in fields ? (str(fields, 'reportsTo') || null) : undefined,
        approved: num(fields, 'approved'),
        locationId: 'locationId' in fields ? (str(fields, 'locationId') || null) : undefined,
      }, ctx);
      return { toast: `${r.code} saved`, icon: 'check', closeSheet: true };
    },
  },

  'pos.remove': {
    capability: 'plan.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      if (!['1', 'true', 'on', 'yes'].includes(str(fields, 'confirmed'))) {
        return {
          confirm: {
            title: 'Remove this seat?',
            body: 'The code is retired and kept, so every report that mentions it still means '
              + 'the same thing. Seats reporting to it move up to its manager.',
            yes: 'Remove',
            no: 'Keep it',
            danger: true,
          },
        };
      }
      const r = await retirePosition(v, ctx);
      return {
        toast: r.moved
          ? `${r.code} removed — ${r.moved} seat${r.moved === 1 ? '' : 's'} moved up a line`
          : `${r.code} removed from the plan`,
        icon: 'trash',
        closeSheet: 'all',
      };
    },
  },

  /* The next free code, for the form to show before anything is saved. */
  'pos.nextCode': {
    capability: 'plan.view',
    schema: base,
    async run({ v }, ctx) {
      const code = await nextCode(v, ctx.tx);
      return { refresh: false, data: { code } };
    },
  },

  /* One department out of the previewed file. The value is the file and which
     block of it — a sheet with three departments in it is three of these, and
     each is its own transaction, so the second failing does not undo the
     first. The file remembers which blocks have been imported, which is what
     stops a double-click from creating every seat twice. */
  'mp.importCreate': {
    capability: 'plan.import',
    schema: base,
    async run({ v, fields }, ctx) {
      const [fileId, blockRaw] = v.includes('|') ? v.split('|') : ['', ''];
      const i = blockRaw === '' ? null : Number(blockRaw);
      const suffix = i == null ? '' : `_${i}`;

      let stored: typeof files.$inferSelect | undefined;
      if (fileId) {
        [stored] = await ctx.tx.select().from(files).where(eq(files.id, fileId)).limit(1);
        if (!stored || stored.deletedAt) throw new CommandError('That file is no longer here');
        const done = (((stored.metadata ?? {}) as { imported?: number[] }).imported ?? []);
        if (i != null && done.includes(i)) {
          throw new CommandError('That department has already been imported from this file', { tone: 'warn' });
        }
      }

      const rows = readRows(fields[`rows${suffix}`] ?? fields.rows);
      const r = await importDepartment({
        department: {
          name: str(fields, `deptName${suffix}`) || str(fields, 'deptName'),
          code: str(fields, `deptCode${suffix}`) || str(fields, 'deptCode') || null,
          head: str(fields, `head${suffix}`) || str(fields, 'head') || null,
          headTitle: str(fields, `headTitle${suffix}`) || str(fields, 'headTitle') || null,
          functionId: str(fields, `functionId${suffix}`) || str(fields, 'functionId') || null,
        },
        rows,
        source: stored?.originalName ?? (str(fields, 'file') || null),
      }, ctx);

      if (stored && i != null) {
        const meta = (stored.metadata ?? {}) as Record<string, unknown>;
        const done = ((meta.imported as number[] | undefined) ?? []).concat(i);
        await ctx.tx.update(files).set({ metadata: { ...meta, imported: done } })
          .where(eq(files.id, stored.id));
      }

      const parts = [`${r.seats} seat${r.seats === 1 ? '' : 's'}`];
      if (r.people) parts.push(`${r.people} already filled`);
      if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
      return {
        toast: `${r.department} imported — ${parts.join(', ')}`,
        tone: r.skipped.length ? 'warn' : undefined,
        icon: 'upload',
        ms: 4600,
        closeSheet: 'all',
        go: '/manpower',
        data: { skipped: r.skipped },
      };
    },
  },
});
