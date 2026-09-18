/* ─────────────────────────────────────────────────────────────────────────────
   Formatting.

   Ported verbatim in behaviour from the prototype's `fmt`, because the exact
   strings it produces — "12 d", "SAR 9.5k", "3w ago", "14 Mar 2026" — are part
   of the interface, and a visual-regression test compares them character for
   character. Pure functions with no dependency on the database or the clock,
   so a server component and the browser render the same thing.
   ───────────────────────────────────────────────────────────────────────────*/

export const DAY = 864e5;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

type Dateish = string | number | Date | null | undefined;

const toDate = (v: Dateish): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
export const avg = (a: number[]): number => (a.length ? sum(a) / a.length : 0);
export const med = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const pct = (n: number, d: number): number => (d ? n / d : 0);
export const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n));
export const uniq = <T>(a: T[]): T[] => [...new Set(a)];

export function groupBy<T, K extends string | number>(a: T[], f: (x: T) => K): Record<K, T[]> {
  return a.reduce((o, x) => {
    const k = f(x);
    (o[k] ||= []).push(x);
    return o;
  }, {} as Record<K, T[]>);
}

export function sortBy<T>(a: readonly T[], f: (x: T) => unknown, dir: 1 | -1 = 1): T[] {
  return [...a].sort((x, y) => {
    const u = f(x) as any, v = f(y) as any;
    return (u == null ? 1 : v == null ? -1 : u < v ? -1 : u > v ? 1 : 0) * dir;
  });
}

/* HTML escaping, for the few places that still assemble markup (the letter
   preview, the CSV export). React escapes everything else on its own. */
export const esc = (s: unknown): string =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const cls = (...a: Array<string | false | null | undefined>): string =>
  a.filter(Boolean).join(' ');

/* A stable hue in 1–5 from any string — the avatar colours. */
export const hue = (s: unknown): number =>
  (String(s).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5) + 1;

export const fmt = {
  int: (n: number | null | undefined): string =>
    (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US')),

  dec: (n: number | null | undefined, k = 1): string =>
    (n == null || Number.isNaN(n) ? '—' : n.toFixed(k)),

  pct: (n: number | null | undefined, k = 0): string =>
    (n == null || Number.isNaN(n) ? '—' : (n * 100).toFixed(k) + '%'),

  sar: (n: number | null | undefined): string =>
    (n == null ? '—' : 'SAR ' + Math.round(n).toLocaleString('en-US')),

  /* Thousands for a salary, millions once a figure is annual. */
  sarK: (n: number | null | undefined): string => {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e6) {
      return 'SAR ' + (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 2).replace(/\.00$/, '') + 'm';
    }
    return 'SAR ' + (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k';
  },

  /* The tint an avatar falls back to when the record carries no photo and no
     hue of its own: derived from the name, so the same person is the same
     colour on every screen and two people beside each other rarely clash. */
  hue: (name: string): number =>
    ([...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5) + 1,

  days: (n: number | null | undefined): string =>
    (n == null || Number.isNaN(n) ? '—' : n < 1 ? '<1 d' : Math.round(n) + ' d'),

  date: (s: Dateish): string => {
    const d = toDate(s);
    return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
  },

  dateShort: (s: Dateish): string => {
    const d = toDate(s);
    return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : '—';
  },

  month: (s: string): string => {
    const [y, m] = s.split('-');
    return `${MONTHS[+m - 1]} ${y.slice(2)}`;
  },

  /* Riyadh is UTC+3 and does not observe daylight saving, so the offset is a
     constant rather than a timezone database lookup. */
  time: (s: Dateish): string => {
    const d = toDate(s);
    if (!d) return '—';
    let h = d.getUTCHours() + 3;
    let ap = 'am';
    if (h >= 24) h -= 24;
    if (h >= 12) { ap = 'pm'; if (h > 12) h -= 12; }
    if (h === 0) h = 12;
    return `${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${ap}`;
  },

  when: (s: Dateish): string => (toDate(s) ? `${fmt.dateShort(s)}, ${fmt.time(s)}` : '—'),

  initials: (n: unknown): string =>
    String(n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),

  first: (n: unknown): string => String(n || '').split(' ')[0],

  kb: (n: number): string => (n < 1024 ? `${n} KB` : `${(n / 1024).toFixed(1)} MB`),

  bytes: (n: number): string =>
    (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`),

  list: (a: readonly string[]): string =>
    (a.length < 2 ? (a[0] || '—') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`),
};

/* "3 days ago" is measured against a clock the caller supplies, so a server
   render and a later hydration cannot disagree about what "now" is. */
export function ago(s: Dateish, now: Date): string {
  const d = toDate(s);
  if (!d) return '—';
  const ms = now.getTime() - d.getTime();
  if (ms < 0) return 'in ' + ago(new Date(2 * now.getTime() - d.getTime()), now).replace(' ago', '');
  const m = ms / 6e4, h = m / 60, days = h / 24;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  if (days < 7) return `${Math.round(days)}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export const agoShort = (s: Dateish, now: Date): string => ago(s, now).replace(' ago', '');

export const daysBetween = (a: Dateish, b: Dateish): number => {
  const x = toDate(a), y = toDate(b);
  return x && y ? (y.getTime() - x.getTime()) / DAY : 0;
};

export const daysAgo = (a: Dateish, now: Date): number => {
  const x = toDate(a);
  return x ? (now.getTime() - x.getTime()) / DAY : 0;
};

export const isoDay = (d: Dateish): string => {
  const x = toDate(d);
  return x ? x.toISOString().slice(0, 10) : '';
};

/* Friday and Saturday. One definition, matching is_ksa_weekend() in the
   database and the booking calendar in the product. */
export const isKsaWeekend = (d: Dateish): boolean => {
  const x = toDate(d);
  return x ? [5, 6].includes(x.getUTCDay()) : false;
};

/* How a date window reads in a sentence: "14 Mar 2026 – 2 Apr 2026", or one
   date on its own as "from …" / "up to …". Shared by the Jobs search bar (a
   client component) and the cards that describe what it filtered (server
   components), so it cannot live in either. */
export function dateWindowLabel(from?: string | null, to?: string | null): string {
  if (!from && !to) return '';
  if (from && to) return `${fmt.date(from + 'T00:00:00.000Z')} – ${fmt.date(to + 'T00:00:00.000Z')}`;
  return from
    ? `from ${fmt.date(from + 'T00:00:00.000Z')}`
    : `up to ${fmt.date(to + 'T00:00:00.000Z')}`;
}
