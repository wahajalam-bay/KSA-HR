import { fmt, daysAgo } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   Periods.

   Every number on the Overview and in Insights is "over some period", and the
   period is either one of four presets or any calendar range — a day in one
   month to a day in another. Both have to behave identically everywhere: the
   filters, the bucketing, the comparison against the period before, and the
   sentence the card prints.

   The prototype carried a range as a Number object with `from`/`to` hung off
   it, so `w / 30.4` still worked. Here it is a proper type, because a Number
   object with properties is a trick that survives exactly as long as nobody
   touches it. Everything else — which days are in, where the buckets fall, how
   the plan is pro-rated onto a week — is the product's arithmetic unchanged.
   ───────────────────────────────────────────────────────────────────────────*/

export type Preset = 30 | 90 | 180 | 365;
export type Window =
  | { kind: 'preset'; days: Preset }
  | { kind: 'range'; from: string; to: string; days: number };

export const PRESETS: Record<number, string> = {
  30: 'Last 30 days',
  90: 'Last quarter',
  180: 'Last 6 months',
  365: 'Last 12 months',
};

const DAY = 86_400_000;
export const isoDay = (d: Date | string | number): string => new Date(d).toISOString().slice(0, 10);

export function preset(days: number): Window {
  const d = ([30, 90, 180, 365] as const).includes(days as Preset) ? (days as Preset) : 90;
  return { kind: 'preset', days: d };
}

/** A period from two calendar dates, inclusive, in either order. */
export function range(from: string | Date, to: string | Date): Window {
  let a = isoDay(from), b = isoDay(to);
  if (a > b) [a, b] = [b, a];
  const n = Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1);
  return { kind: 'range', from: a, to: b, days: n };
}

/** Read the period out of a query string — `?win=90`, or `?from=&to=`. */
export function windowFromQuery(q: Record<string, string | undefined>, fallback = 90): Window {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (ISO.test(q.from ?? '') && ISO.test(q.to ?? '')) return range(q.from!, q.to!);
  const n = Number(q.win);
  return Number.isInteger(n) && n >= 1 && n <= 730 ? preset(n) : preset(fallback);
}

export const days = (w: Window): number => w.days;
export const isRange = (w: Window): w is Extract<Window, { kind: 'range' }> => w.kind === 'range';
export const isPreset = (w: Window, n: number): boolean => w.kind === 'preset' && w.days === n;

/** The first and last day of the period, as ISO days. */
export const startOf = (w: Window, now: Date): string =>
  (isRange(w) ? w.from : isoDay(now.getTime() - Math.round(w.days) * DAY));
export const endOf = (w: Window, now: Date): string => (isRange(w) ? w.to : isoDay(now));

/** The equally long period immediately before this one. */
export function previous(w: Window, now: Date): Window {
  if (isRange(w)) {
    return range(isoDay(Date.parse(w.from) - w.days * DAY), isoDay(Date.parse(w.from) - DAY));
  }
  const d = Math.round(w.days);
  return range(isoDay(now.getTime() - 2 * d * DAY), isoDay(now.getTime() - d * DAY - DAY));
}

/** Is this timestamp inside the period? */
export function inWindow(at: string | null | undefined, w: Window, now: Date): boolean {
  if (!at) return false;
  if (isRange(w)) { const d = String(at).slice(0, 10); return d >= w.from && d <= w.to; }
  const n = daysAgo(at, now);
  return n <= w.days && n >= 0;
}

/** Inside the equally long period before it — how every delta is measured. */
export function inPrev(at: string | null | undefined, w: Window, now: Date): boolean {
  if (!at) return false;
  if (isRange(w)) return inWindow(at, previous(w, now), now);
  const n = daysAgo(at, now);
  return n > w.days && n <= 2 * w.days;
}

/* ── How a period is named ────────────────────────────────────────────────*/

/** The four presets by name; a range as its two dates. */
export function label(w: Window): string {
  if (isRange(w)) {
    const a = new Date(w.from + 'T00:00:00.000Z'), b = new Date(w.to + 'T00:00:00.000Z');
    return a.getUTCFullYear() === b.getUTCFullYear()
      ? `${fmt.dateShort(w.from)} – ${fmt.date(w.to)}`
      : `${fmt.date(w.from)} – ${fmt.date(w.to)}`;
  }
  const d: number = w.days;
  return PRESETS[d] ?? (d % 30 === 0 && d >= 60 ? `Last ${d / 30} months` : `Last ${d} day${d === 1 ? '' : 's'}`);
}

/** The same, as it reads inside a sentence: a preset lowercased, a range as-is. */
export const phrase = (w: Window): string => (isRange(w) ? label(w) : label(w).toLowerCase());

/** Short enough for a chart legend or a chip. */
export const short = (w: Window): string =>
  (isRange(w) ? `${fmt.dateShort(w.from)} – ${fmt.dateShort(w.to)}`
    : w.days <= 90 ? `${w.days} d` : `${Math.round(w.days / 30.4)} mo`);

/** How the comparison period is named in a delta caption. */
export const previousLabel = (w: Window): string =>
  (isRange(w) ? `the ${w.days} days before ${fmt.dateShort(w.from)}` : `the ${w.days} days before`);

/** "the last quarter" reads naturally after "in"; a range reads as its dates. */
export const inLabel = (w: Window): string => (isRange(w) ? label(w) : 'the ' + label(w).toLowerCase());

/* ── Buckets ────────────────────────────────────────────────────────────────
   A month reads by week, a quarter by week, six or twelve months by month.
   Each bucket carries the plan pro-rated from the monthly targets, so an
   attainment bar follows the period control rather than a fixed year. */
export type Bucket = {
  key: string;
  label: string;
  unit: 'week' | 'month';
  /** Inclusive start, exclusive end — the half-open interval a count uses. */
  start: string;
  end: string;
  /** The calendar month a week's plan is pro-rated from. */
  month: string;
};

export function buckets(w: Window, now: Date): Bucket[] {
  if (w.days <= 90) {
    const n = Math.max(1, Math.round(w.days / 7));      // 30 days → 4 weeks, a quarter → 13
    /* A calendar range ends on its own last day; a preset ends tomorrow, so
       today sits inside the last week rather than falling off the end. */
    const end0 = isRange(w)
      ? Date.parse(w.to) + DAY
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const out: Bucket[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const end = end0 - i * 7 * DAY;
      const start = end - 7 * DAY;
      out.push({
        key: isoDay(start),
        label: fmt.dateShort(new Date(start).toISOString()),
        unit: 'week',
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        month: new Date(start + 3.5 * DAY).toISOString().slice(0, 7),
      });
    }
    return out;
  }

  const keys = isRange(w)
    ? monthsBetween(w.from, w.to)
    : monthKeys(Math.max(2, Math.round(w.days / 30.4)), now);

  return keys.map((k) => {
    const [y, m] = k.split('-').map(Number);
    return {
      key: k,
      label: fmt.month(k),
      unit: 'month' as const,
      start: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
      end: new Date(Date.UTC(y, m, 1)).toISOString(),
      month: k,
    };
  });
}

/** The plan for one bucket, from the monthly hiring goals. */
export function bucketTarget(b: Bucket, goals: Record<string, number>): number {
  if (b.unit === 'month') return goals[b.month] ?? 0;
  const [y, m] = b.month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.round(((goals[b.month] ?? 0) / daysInMonth) * 7 * 10) / 10;
}

/** The last N calendar months, ending with the one we are in. */
export function monthKeys(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

/** Every calendar month a range touches, first to last. */
export function monthsBetween(from: string, to: string): string[] {
  const a = new Date(from + 'T00:00:00.000Z'), b = new Date(to + 'T00:00:00.000Z');
  const out: string[] = [];
  for (let y = a.getUTCFullYear(), m = a.getUTCMonth();
    y * 12 + m <= b.getUTCFullYear() * 12 + b.getUTCMonth(); m++) {
    if (m > 11) { m = 0; y++; }
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
  }
  return out;
}

export const monthLabel = (key: string): string => fmt.month(key);

/** A delta between two periods, as the trend arrows read it. */
export const delta = (now: number | null, before: number | null): number | null =>
  (before ? ((now ?? 0) - before) / before : null);
