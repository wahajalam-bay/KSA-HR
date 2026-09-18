import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  positions, departments, employees, jobs, locations, functions,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { headerIndex, type Grid } from '@/lib/domain/sheet';

/* ═════════════════════════════════════════════════════════════════════════════
   THE MANPOWER PLAN

   A position is a seat on the chart: a code, a title, a department, a grade, a
   reporting line and a number of approved heads. Requisitions are raised
   against seats, and a seat only becomes approved headcount when the
   requisition that raised it clears its chain — until then it is `pending` with
   nothing approved, which is what stops a hiring plan from quietly becoming a
   budget.

   Three rules are enforced here rather than in a form:

     · a code is unique for ever. Retiring a seat keeps the code;
     · approved heads can never be fewer than the people already in the seat;
     · a reporting line cannot point at itself, and cannot make a loop.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Position = typeof positions.$inferSelect;

/** The next free code in a department: SLS-001, SLS-002, … */
export async function nextCode(deptId: string, exec: Exec): Promise<string> {
  const [dept] = await exec.select().from(departments).where(eq(departments.id, deptId)).limit(1);
  if (!dept) throw new CommandError('That department no longer exists');
  const prefix = (dept.code ?? dept.name.slice(0, 3)).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'POS';
  const [{ n }] = rowsOf(await exec.execute(sql`
    SELECT coalesce(max(substring(code from '[0-9]+$')::int), 0)::int AS n
      FROM ${positions} WHERE code LIKE ${`${prefix}-%`}`)) as Array<{ n: number }>;
  return `${prefix}-${String(Number(n) + 1).padStart(3, '0')}`;
}

/** How many people are sitting in a seat today. */
export async function holders(code: string, exec: Exec): Promise<number> {
  const [{ n }] = rowsOf(await exec.execute(sql`
    SELECT count(*)::int AS n FROM ${employees}
     WHERE position_code = ${code} AND status <> 'left'`)) as Array<{ n: number }>;
  return Number(n);
}

/** Walk the reporting line upward; a loop is a seat meeting itself. */
async function wouldLoop(
  positionId: string, reportsToId: string | null, exec: Exec,
): Promise<boolean> {
  let at = reportsToId;
  for (let hops = 0; at && hops < 64; hops += 1) {
    if (at === positionId) return true;
    const [row] = await exec.select({ up: positions.reportsToId }).from(positions)
      .where(eq(positions.id, at)).limit(1);
    at = row?.up ?? null;
  }
  return false;
}

export type PositionInput = {
  title: string;
  deptId: string;
  grade?: string | null;
  reportsToId?: string | null;
  approved?: number | null;
  locationId?: string | null;
  kind?: 'leadership' | 'management' | 'role';
  code?: string | null;
};

export async function addPosition(
  input: PositionInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ id: string; code: string; title: string }> {
  if (!ctx.viewer.isAdmin && ctx.viewer.staffRole !== 'tal_lead') {
    throw new CommandError('Only an Admin can add a seat to the plan');
  }
  const title = input.title?.trim();
  if (!title) throw new CommandError('The seat needs a title');

  const [dept] = await ctx.tx.select().from(departments)
    .where(eq(departments.id, input.deptId)).limit(1);
  if (!dept) throw new CommandError('Pick a department');

  const code = input.code?.trim().toUpperCase() || await nextCode(input.deptId, ctx.tx);
  const [clash] = await ctx.tx.select({ id: positions.id }).from(positions)
    .where(eq(positions.code, code)).limit(1);
  if (clash) throw new CommandError(`${code} is already a seat on the plan`);

  if (input.reportsToId) {
    const [up] = await ctx.tx.select({ id: positions.id }).from(positions)
      .where(eq(positions.id, input.reportsToId)).limit(1);
    if (!up) throw new CommandError('That reporting line points at a seat that does not exist');
  }

  const id = `pos_${crypto.randomUUID().slice(0, 12)}`;
  const approved = Math.max(0, Math.round(input.approved ?? 1));
  await ctx.tx.insert(positions).values({
    id,
    code,
    title,
    deptId: input.deptId,
    functionId: dept.functionId,
    grade: input.grade?.trim() || (input.reportsToId ? 'P3' : 'D1'),
    reportsToId: input.reportsToId ?? null,
    planState: 'approved',
    approved,
    requested: 0,
    locationId: input.locationId ?? null,
    kind: input.kind ?? (input.reportsToId ? 'role' : 'leadership'),
    createdAt: ctx.now,
    createdBy: ctx.viewer.staffId ?? null,
  });

  await audit(ctx, {
    action: 'create',
    summary: `added ${code} — ${title} — to ${dept.name}`,
    entityType: 'position', entityId: id, entityLabel: code,
    after: { title, deptId: input.deptId, approved, grade: input.grade ?? null },
  }, ctx.tx);

  return { id, code, title };
}

export async function savePosition(
  id: string, input: Partial<PositionInput>, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ code: string; title: string }> {
  if (!ctx.viewer.isAdmin && ctx.viewer.staffRole !== 'tal_lead') {
    throw new CommandError('Only an Admin can change the plan');
  }
  const [p] = await ctx.tx.select().from(positions).where(eq(positions.id, id)).limit(1);
  if (!p) throw new CommandError('That seat is no longer on the plan');

  const inSeat = await holders(p.code, ctx.tx);
  const wanted = input.approved == null ? p.approved : Math.round(input.approved);
  if (wanted < inSeat) {
    throw new CommandError(
      `${p.code} has ${inSeat} ${inSeat === 1 ? 'person' : 'people'} in it — `
      + 'approved headcount cannot be fewer than that',
    );
  }

  const reportsToId = input.reportsToId === undefined ? p.reportsToId : (input.reportsToId || null);
  if (reportsToId === id) throw new CommandError('A seat cannot report to itself');
  if (reportsToId && await wouldLoop(id, reportsToId, ctx.tx)) {
    throw new CommandError('That reporting line runs in a circle');
  }

  const title = input.title?.trim() || p.title;
  await ctx.tx.update(positions).set({
    title,
    grade: input.grade?.trim() || p.grade,
    approved: wanted,
    reportsToId,
    locationId: input.locationId === undefined ? p.locationId : (input.locationId || null),
  }).where(eq(positions.id, id));

  await audit(ctx, {
    action: 'update',
    summary: `edited ${p.code} on the plan`,
    entityType: 'position', entityId: id, entityLabel: p.code,
    before: { title: p.title, grade: p.grade, approved: p.approved, reportsToId: p.reportsToId },
    after: { title, grade: input.grade ?? p.grade, approved: wanted, reportsToId },
  }, ctx.tx);

  return { code: p.code, title };
}

/**
 * Retire a seat. The code is kept for ever — a report that mentions SLS-014
 * must keep meaning the same thing — and whatever reported to it moves up to
 * its manager rather than being orphaned.
 */
export async function retirePosition(
  id: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ code: string; moved: number }> {
  if (!ctx.viewer.isAdmin && ctx.viewer.staffRole !== 'tal_lead') {
    throw new CommandError('Only an Admin can remove a seat');
  }
  const [p] = await ctx.tx.select().from(positions).where(eq(positions.id, id)).limit(1);
  if (!p) throw new CommandError('That seat is no longer on the plan');
  if (p.retiredAt) throw new CommandError(`${p.code} is already retired`, { tone: 'warn' });

  const inSeat = await holders(p.code, ctx.tx);
  if (inSeat) {
    throw new CommandError(
      `${p.code} has ${inSeat === 1 ? 'somebody' : `${inSeat} people`} in it — a seat with a holder cannot be removed`,
    );
  }
  const [live] = await ctx.tx.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.positionCode, p.code), sql`${jobs.status} <> 'closed'`)).limit(1);
  if (live) throw new CommandError(`${p.code} has a live requisition on it — close that first`);

  const moved = await ctx.tx.update(positions)
    .set({ reportsToId: p.reportsToId })
    .where(eq(positions.reportsToId, id))
    .returning({ id: positions.id });

  await ctx.tx.update(positions)
    .set({ retiredAt: ctx.now, planState: 'retired' })
    .where(eq(positions.id, id));

  await audit(ctx, {
    action: 'delete',
    summary: `retired ${p.code} from the plan`
      + (moved.length ? ` — ${moved.length} seat${moved.length === 1 ? '' : 's'} moved up a line` : ''),
    entityType: 'position', entityId: id, entityLabel: p.code,
    before: { planState: p.planState }, after: { planState: 'retired', moved: moved.length },
  }, ctx.tx);

  return { code: p.code, moved: moved.length };
}

/* ── The department import ───────────────────────────────────────────────── */

/**
 * The sheet somebody fills in, column by column. This is the contract with a
 * spreadsheet nobody here controls, so it is written down once and read by the
 * template, the preview and the parser alike.
 */
export const IMPORT_COLUMNS: Array<{ key: string; note: string }> = [
  { key: 'Position title', note: 'What the seat is called — the only column that must be filled in' },
  { key: 'Reports to', note: 'The title (or code) of another row; blank means the top of the department' },
  { key: 'Holder', note: 'Who sits in it today; blank means a vacant seat' },
  { key: 'Grade', note: 'D1, M4…P1; blank becomes P3' },
  { key: 'Approved headcount', note: 'How many people the seat is funded for; blank means one' },
  { key: 'Location', note: 'The city; blank uses the department’s' },
  { key: 'Position code', note: 'Issued automatically when the column is empty' },
  { key: 'Hiring manager', note: 'Who would own a requisition on this seat' },
  { key: 'Start date', note: 'When the holder started, as YYYY-MM-DD' },
  { key: 'Department', note: 'Several departments in one file are fine' },
  { key: 'Function', note: 'Sales, Integrated Services, Human Resources… places it on the company chart' },
];

/** A worked example of that sheet, which is also what the template downloads. */
export function importTemplate(): Array<Record<string, string | number>> {
  const row = (
    title: string, reportsTo: string, holder: string, grade: string, approved: number,
    location: string, hm: string, start: string,
  ) => ({
    'Position title': title,
    'Reports to': reportsTo,
    Holder: holder,
    Grade: grade,
    'Approved headcount': approved,
    Location: location,
    'Position code': '',
    'Hiring manager': hm,
    'Start date': start,
    Department: 'Compliance',
    Function: 'Finance & Legal',
  });
  return [
    row('Head of Compliance', '', 'Sami Al-Rashid', 'D1', 1, 'Riyadh', '', '2024-03-01'),
    row('Senior Compliance Officer', 'Head of Compliance', 'Huda Al-Saleh', 'M2', 1, 'Riyadh', '', '2025-01-15'),
    row('Regulatory Affairs Manager', 'Head of Compliance', '', 'M2', 1, 'Riyadh', 'Sami Al-Rashid', ''),
    row('Compliance Officer', 'Senior Compliance Officer', 'Omar Bakr', 'P4', 2, 'Jeddah', 'Huda Al-Saleh', '2025-09-01'),
    row('Compliance Analyst', 'Senior Compliance Officer', '', 'P2', 1, 'Riyadh', 'Huda Al-Saleh', ''),
  ];
}

export type ImportRow = {
  title: string;
  code?: string | null;
  grade?: string | null;
  reportsTo?: string | null;
  approved?: number | null;
  holder?: string | null;
  holderTitle?: string | null;
  startDate?: string | null;
  location?: string | null;
};

export type ImportInput = {
  department: { name: string; code?: string | null; head?: string | null; headTitle?: string | null; functionId?: string | null };
  rows: ImportRow[];
  source?: string | null;
};

export type ImportResult = {
  department: string;
  departmentCreated: boolean;
  seats: number;
  people: number;
  skipped: Array<{ title: string; why: string }>;
};

/**
 * A department's chart, out of the spreadsheet somebody keeps.
 *
 * Reporting lines in the sheet are names, not ids, so the rows are planted in
 * two passes: the ones with no manager first — they are the top of the chart —
 * and then everybody else, whose manager is by then a seat with an id. A row
 * whose manager is a name nobody in the sheet has is reported rather than
 * silently hung off the top.
 */
export async function importDepartment(
  input: ImportInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<ImportResult> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can import a department');
  const name = input.department.name?.trim();
  if (!name) throw new CommandError('The department needs a name');
  if (!input.rows.length) throw new CommandError('The sheet has no seats in it');

  let departmentCreated = false;
  let [dept] = await ctx.tx.select().from(departments)
    .where(sql`lower(${departments.name}) = ${name.toLowerCase()}`).limit(1);
  if (!dept) {
    const deptId = `dep_${crypto.randomUUID().slice(0, 12)}`;
    const [{ order }] = rowsOf(await ctx.tx.execute(sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS order FROM ${departments}`)) as Array<{ order: number }>;
    await ctx.tx.insert(departments).values({
      id: deptId,
      name,
      code: (input.department.code ?? 'NEW').toUpperCase(),
      functionId: input.department.functionId ?? null,
      head: input.department.head ?? '—',
      headTitle: input.department.headTitle ?? null,
      sortOrder: Number(order),
      createdAt: ctx.now,
    });
    [dept] = await ctx.tx.select().from(departments).where(eq(departments.id, deptId)).limit(1);
    departmentCreated = true;
  } else if (input.department.functionId && !dept.functionId) {
    await ctx.tx.update(departments)
      .set({ functionId: input.department.functionId })
      .where(eq(departments.id, dept.id));
  }

  const [defaultLocation] = await ctx.tx.select().from(locations)
    .orderBy(asc(locations.id)).limit(1);

  /* Heads first, so a line that points at one resolves on the second pass. */
  const ordered = [
    ...input.rows.filter((r) => !r.reportsTo?.trim()),
    ...input.rows.filter((r) => r.reportsTo?.trim()),
  ];

  const byKey = new Map<string, string>();
  const skipped: Array<{ title: string; why: string }> = [];
  let seats = 0;
  let people = 0;

  for (const r of ordered) {
    const title = r.title?.trim();
    if (!title) { skipped.push({ title: '(blank)', why: 'no title' }); continue; }

    const wanted = r.code?.trim().toUpperCase() || null;
    let code = wanted;
    if (code) {
      const [taken] = await ctx.tx.select({ id: positions.id }).from(positions)
        .where(eq(positions.code, code)).limit(1);
      if (taken) code = null;
    }
    if (!code) code = await nextCode(dept!.id, ctx.tx);

    let reportsToId: string | null = null;
    const parentKey = r.reportsTo?.trim().toLowerCase() ?? '';
    if (parentKey) {
      reportsToId = byKey.get(parentKey) ?? null;
      if (!reportsToId) {
        const [found] = await ctx.tx.select({ id: positions.id }).from(positions)
          .where(and(
            eq(positions.deptId, dept!.id),
            sql`(lower(${positions.title}) = ${parentKey} OR lower(${positions.code}) = ${parentKey})`,
          )).limit(1);
        reportsToId = found?.id ?? null;
      }
      if (!reportsToId) {
        skipped.push({ title, why: `reports to "${r.reportsTo}", which is not in the sheet` });
        continue;
      }
    }

    const city = r.location?.trim().toLowerCase();
    const [loc] = city
      ? await ctx.tx.select().from(locations)
        .where(sql`lower(${locations.city}) LIKE ${`${city.slice(0, 4)}%`}`).limit(1)
      : [];

    const id = `pos_${crypto.randomUUID().slice(0, 12)}`;
    await ctx.tx.insert(positions).values({
      id,
      code,
      title,
      deptId: dept!.id,
      functionId: dept!.functionId,
      grade: r.grade?.trim() || (reportsToId ? 'P3' : 'D1'),
      reportsToId,
      planState: 'approved',
      approved: Math.max(1, Math.round(r.approved ?? 1)),
      locationId: loc?.id ?? defaultLocation?.id ?? null,
      kind: reportsToId ? 'role' : 'leadership',
      holderName: r.holder?.trim() || null,
      importedFrom: input.source ?? null,
      createdAt: ctx.now,
      createdBy: ctx.viewer.staffId ?? null,
    });
    seats += 1;
    byKey.set(title.toLowerCase(), id);
    if (wanted) byKey.set(wanted.toLowerCase(), id);

    /* Somebody already sitting in the seat is an existing employee, not a hire:
       they have no application, no offer and no onboarding to do. */
    if (r.holder?.trim()) {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(r.startDate ?? '')
        ? r.startDate!
        : ctx.now.toISOString().slice(0, 10);
      const [{ empCode }] = rowsOf(await ctx.tx.execute(sql`
        SELECT next_reference('BYT', 4) AS "empCode"`)) as Array<{ empCode: string }>;
      await ctx.tx.insert(employees).values({
        id: `emp_${crypto.randomUUID().slice(0, 12)}`,
        employeeCode: empCode,
        name: r.holder.trim(),
        positionCode: code,
        deptId: dept!.id,
        title: r.holderTitle?.trim() || title,
        locationId: loc?.id ?? defaultLocation?.id ?? null,
        startDate: start,
        status: 'active',
        source: 'imported',
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      people += 1;
    }
  }

  await audit(ctx, {
    action: 'create',
    summary: `imported ${name} — ${seats} seat${seats === 1 ? '' : 's'}`
      + (people ? `, ${people} already filled` : '')
      + (skipped.length ? `, ${skipped.length} skipped` : ''),
    entityType: 'department', entityId: dept!.id, entityLabel: name,
    after: { seats, people, skipped: skipped.length, source: input.source ?? null },
  }, ctx.tx);
  await emit(ctx, {
    type: 'plan.imported', subjectType: 'department', subjectId: dept!.id,
    payload: { seats, people, skipped: skipped.length },
  }, ctx.tx);

  return { department: name, departmentCreated, seats, people, skipped };
}


/* ── Reading the spreadsheet somebody sent ───────────────────────────────── */

/* The names a column might actually carry. The sheet is written down in
   IMPORT_COLUMNS, but the file arrives from somebody's laptop, so the header
   is matched loosely: case, spaces and punctuation are ignored, and the
   obvious shorthands are accepted. A column nobody recognises is reported
   rather than ignored, because a silently dropped column is a plan that is
   quietly wrong. */
const COLUMN_ALIASES: Record<string, string[]> = {
  title: ['positiontitle', 'position', 'title', 'seat', 'role', 'jobtitle'],
  reportsTo: ['reportsto', 'reportingto', 'manager', 'linemanager', 'parent'],
  holder: ['holder', 'incumbent', 'employee', 'employeename', 'currentholder'],
  grade: ['grade', 'band', 'level'],
  approved: ['approvedheadcount', 'approved', 'headcount', 'heads', 'budgetedheadcount'],
  location: ['location', 'city', 'office', 'site'],
  code: ['positioncode', 'code', 'seatcode', 'positionid'],
  hiringManager: ['hiringmanager', 'hm', 'requisitionowner'],
  startDate: ['startdate', 'started', 'joiningdate', 'doj', 'start'],
  department: ['department', 'dept', 'departmentname'],
  functionName: ['function', 'businessfunction', 'division', 'group'],
};

export type ReadPlan = {
  /** One block per department named in the file, in the order they appear. */
  departments: Array<{
    name: string;
    functionName: string | null;
    rows: ImportRow[];
    /** Reporting lines the file names but does not contain. */
    orphans: string[];
  }>;
  /** Columns in the file that mean nothing here. */
  unknownColumns: string[];
  /** Rows left out, and why. */
  dropped: Array<{ row: number; why: string }>;
  /** How many data rows the file had. */
  rows: number;
};

/** A date as the plan is allowed to write it: 2025-09-01, 01/09/2025, 1 Sep 2025. */
function dayIn(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (dmy) {
    const [, a, b, y] = dmy;
    /* Day first, which is how it is written here — 01/09/2025 is September.
       A field above twelve can only be the day, which settles the ambiguous
       American files without having to ask. */
    const [day, month] = Number(b) > 12 ? [b, a] : [a, b];
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  /* "1 Sep 2025" and "Sep 1 2025". Parsed by hand rather than by `new Date`,
     which reads a bare date as local midnight — and this machine is three
     hours ahead of UTC, so the round trip through an ISO string moved every
     such start date back a day. */
  const words = /^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4})$/i.exec(s)
    ?? (() => {
      const m = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
      return m ? ([m[0], m[2], m[1], m[3]] as unknown as RegExpExecArray) : null;
    })();
  if (words) {
    const month = MONTHS.indexOf(words[2].slice(0, 3).toLowerCase()) + 1;
    const day = Number(words[1]);
    if (month && day >= 1 && day <= 31) {
      return `${words[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The grid, as departments of seats.
 *
 * Nothing is created here — this is the reading the preview shows, and the
 * recruiter confirms one department at a time. Which means a file with three
 * departments in it is three decisions rather than one, and a row the reader
 * could not place is in front of somebody before anything is written.
 */
export function readPlanGrid(grid: Grid): ReadPlan {
  const dropped: Array<{ row: number; why: string }> = [];
  if (!grid.length) throw new CommandError('That file has nothing in it');

  /* The header is the first row with at least two non-empty cells — a plan
     often has the department's name in A1 and the header underneath. */
  let headerAt = grid.findIndex((r) => r.filter((c) => c.trim() !== '').length >= 2);
  if (headerAt < 0) headerAt = 0;
  const header = grid[headerAt].map((h) => h.trim());
  const index = headerIndex(header);

  const at: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  const used = new Set<number>();
  for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
    for (const n of names) {
      const i = index.get(n);
      if (i !== undefined) {
        at[field as keyof typeof COLUMN_ALIASES] = i;
        used.add(i);
        break;
      }
    }
  }
  if (at.title === undefined) {
    throw new CommandError(
      'The sheet needs a "Position title" column — that is the only one that must be there. '
      + `What it has is: ${header.filter(Boolean).join(', ') || '(nothing)'}`,
    );
  }
  const unknownColumns = header
    .map((h, i) => (h && !used.has(i) ? h : ''))
    .filter(Boolean);

  const cell = (row: string[], field: keyof typeof COLUMN_ALIASES): string => {
    const i = at[field];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  type Block = ReadPlan['departments'][number];
  const blocks = new Map<string, Block>();
  const order: string[] = [];
  let count = 0;

  for (let r = headerAt + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row.some((c) => c.trim() !== '')) continue;
    count += 1;

    const title = cell(row, 'title');
    if (!title) {
      dropped.push({ row: r + 1, why: 'no position title' });
      continue;
    }

    const deptName = cell(row, 'department');
    const key = deptName.toLowerCase();
    let block = blocks.get(key);
    if (!block) {
      block = { name: deptName, functionName: cell(row, 'functionName') || null, rows: [], orphans: [] };
      blocks.set(key, block);
      order.push(key);
    } else if (!block.functionName && cell(row, 'functionName')) {
      block.functionName = cell(row, 'functionName');
    }

    const approvedRaw = cell(row, 'approved').replace(/[, ]/g, '');
    const approved = approvedRaw === '' ? null : Number(approvedRaw);
    if (approvedRaw !== '' && !Number.isFinite(approved)) {
      dropped.push({ row: r + 1, why: `"${approvedRaw}" is not a headcount` });
      continue;
    }

    const startRaw = cell(row, 'startDate');
    const startDate = dayIn(startRaw);
    if (startRaw && !startDate) {
      dropped.push({ row: r + 1, why: `"${startRaw}" is not a date the importer reads` });
      continue;
    }

    block.rows.push({
      title,
      code: cell(row, 'code') || null,
      grade: cell(row, 'grade') || null,
      reportsTo: cell(row, 'reportsTo') || null,
      approved: approved == null ? null : Math.max(0, Math.round(approved)),
      holder: cell(row, 'holder') || null,
      holderTitle: null,
      startDate,
      location: cell(row, 'location') || null,
    });
  }

  /* A reporting line that names a seat the file does not have. The importer
     reports these too, but saying so before anything is written is the point
     of a preview. */
  for (const block of blocks.values()) {
    const have = new Set(
      block.rows.flatMap((x) => [x.title.toLowerCase(), (x.code ?? '').toLowerCase()]).filter(Boolean),
    );
    block.orphans = [...new Set(
      block.rows
        .map((x) => (x.reportsTo ?? '').trim())
        .filter((x) => x && !have.has(x.toLowerCase())),
    )];
  }

  const departments = order.map((k) => blocks.get(k)!).filter((b) => b.rows.length);
  if (!departments.length) {
    throw new CommandError(
      dropped.length
        ? `Every row was left out — ${dropped[0].why} on row ${dropped[0].row}`
        : 'That file has a header but no seats under it',
    );
  }
  return { departments, unknownColumns, dropped, rows: count };
}
