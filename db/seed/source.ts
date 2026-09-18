import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* ─────────────────────────────────────────────────────────────────────────────
   The prototype's dataset, read straight out of the file it ships in.

   `source/src/02-data.js` is 8.6 MB of `const DATA = {…}`. Rather than keeping a
   second copy of it, the seeder evaluates that one file in a sandbox with no
   globals of its own and takes the object. The prototype is the acceptance
   specification, so its data is the data the production system is verified
   against — same 49 requisitions, same 1,000 people, same 1,209 applications.
   ───────────────────────────────────────────────────────────────────────────*/

const DEFAULT_PATH = path.resolve(process.cwd(), '..', 'Bayut-TA-CRM-v30', 'source', 'src', '02-data.js');

export type Proto = Record<string, any>;

let cached: Proto | null = null;

export function protoData(file = process.env.SEED_SOURCE ?? DEFAULT_PATH): Proto {
  if (cached) return cached;
  if (!fs.existsSync(file)) {
    throw new Error(
      `The prototype dataset was not found at ${file}.\n` +
      'Set SEED_SOURCE to the path of Bayut-TA-CRM-v30/source/src/02-data.js, ' +
      'or run `npm run db:seed -- --blank` for an empty organisation.',
    );
  }
  const src = fs.readFileSync(file, 'utf8');
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(`${src}\nglobalThis.__DATA = DATA;`, ctx, { timeout: 60_000 });
  cached = (ctx as any).__DATA as Proto;
  if (!cached || !Array.isArray(cached.jobs)) throw new Error('That file did not produce a DATA object.');
  return cached;
}

/* The dataset pins "today" so every relative figure agrees with it. */
export function asOf(d: Proto = protoData()): Date {
  return new Date(d.meta.asOf);
}

/* ── Rebasing ────────────────────────────────────────────────────────────────
   The prototype froze the clock at meta.asOf (2026-09-03) so its demo would not
   rot: every "days in stage", every SLA breach and the whole agenda is measured
   against that date rather than against the wall clock.

   Production has no such luxury — it reads the real clock, as it must. So the
   seed shifts the entire dataset forward by whole days, mapping the dataset's
   "today" onto the day it is seeded. Every interval is preserved exactly: an
   application that had been in Screening for six days still has been, an
   interview that was tomorrow is still tomorrow, a probation that ends in three
   weeks still does. What changes is only that "now" means now.

   `SEED_SHIFT_DAYS=0` turns it off, for a run that has to line up with a
   baseline captured from the prototype's own frozen clock. */
let shiftDays = 0;

export function setShift(days: number): void { shiftDays = Math.round(days); }
export function shift(): number { return shiftDays; }

export function computeShift(d: Proto = protoData()): number {
  const explicit = process.env.SEED_SHIFT_DAYS;
  if (explicit !== undefined && explicit !== '') return Math.round(Number(explicit) || 0);
  const from = new Date(d.meta.asOf);
  const today = new Date();
  /* Whole days, measured at midnight UTC, so the shift never moves a date by a
     fraction and turns "3 Sep" into "2 Sep, 23:00". */
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

const MS_DAY = 86_400_000;

export const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + shiftDays * MS_DAY).toISOString();
};

export const day = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const base = v.slice(0, 10);
  if (!shiftDays) return base;
  const t = Date.parse(base + 'T00:00:00.000Z');
  if (Number.isNaN(t)) return base;
  return new Date(t + shiftDays * MS_DAY).toISOString().slice(0, 10);
};

/** A month key (YYYY-MM) moved by the same shift. */
export const month = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const d = day(v + '-15');          // mid-month, so a shift cannot skip one
  return d ? d.slice(0, 7) : null;
};

/** The dataset's "today" after the shift — which is the real today. */
export const nowIso = (d: Proto = protoData()): string =>
  new Date(new Date(d.meta.asOf).getTime() + shiftDays * MS_DAY).toISOString();

export const num = (v: unknown): number | null =>
  (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export const int = (v: unknown, d = 0): number => {
  const n = num(v);
  return n === null ? d : Math.round(n);
};

export const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
