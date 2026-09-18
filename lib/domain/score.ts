/* ─────────────────────────────────────────────────────────────────────────────
   One scale for everything the assistant scores.

   The phone screen came back "11 of 12", the sales pitch "18 of 25", the
   interviewer review "74 out of 100" and the behaviour test "68" — four numbers
   a recruiter had to hold four different rulers against. They are one thing:
   a score from 1 to 100, where 100 is great. The raw marks stay on the record,
   because a panel asking what the assistant gave for objection handling
   deserves a real answer, but every number anybody reads is out of a hundred.

     90–100  Great    nothing to argue with
     75–89   Strong   clears the bar comfortably
     60–74   Fair     worth a conversation
     40–59   Weak     would need a reason to go on
      1–39   Poor
   ───────────────────────────────────────────────────────────────────────────*/

export const MAX = 100;

export type Band = 'Great' | 'Strong' | 'Fair' | 'Weak' | 'Poor';
export type Tone = 'ok' | 'warn' | 'bad';

const BANDS: Array<[number, Band, Tone]> = [
  [90, 'Great', 'ok'], [75, 'Strong', 'ok'], [60, 'Fair', 'warn'],
  [40, 'Weak', 'bad'], [0, 'Poor', 'bad'],
];

/* Any raw mark onto the hundred. A scored thing never reads 0 — the floor is 1,
   because 0 of 100 reads like "not scored" and the two are different. A single
   criterion may genuinely be a zero, so it passes `raw`. */
export function pct(total: number | null | undefined, max: number | null | undefined, o: { raw?: boolean } = {}): number | null {
  if (!max || total == null) return null;
  const n = Math.min(MAX, Math.round((total / max) * MAX));
  return o.raw ? Math.max(0, n) : Math.max(1, n);
}

/** The number a scored row carries, whatever shape it is in. */
export function of(row: { score?: number | null; total?: number | null; max?: number | null } | null | undefined): number | null {
  if (!row) return null;
  /* A row that carries a bare score is already on the hundred. A row that
     carries a raw total against a maximum is put on it — which is the case
     that matters, because the raw marks are what the panel actually sees. */
  if (row.score != null && row.max == null) return Math.round(row.score);
  return pct(row.total, row.max) ?? (row.score == null ? null : Math.round(row.score));
}

export function band(n: number): [Band, Tone] {
  const b = BANDS.find((x) => n >= x[0]) ?? BANDS[BANDS.length - 1];
  return [b[1], b[2]];
}

export const label = (n: number | null | undefined): string => (n == null ? '—' : `${n} · ${band(n)[0]}`);
export const tone = (n: number | null | undefined): Tone | '' => (n == null ? '' : band(n)[1]);
export const colour = (n: number | null | undefined): string =>
  (n == null ? 'var(--fg-3)' : n >= 75 ? 'var(--ok)' : n >= 60 ? 'var(--warn)' : 'var(--bad)');

/** A criterion inside a scorecard, on the same scale as the card itself. */
export const critPct = (x: { score: number; max: number }): number | null => pct(x.score, x.max, { raw: true });

/** The legend, so nobody has to guess where the bands are. */
export const legendText = (): string =>
  'Scored out of 100 — ' + BANDS.map(([n, t]) => `${t.toLowerCase()} ${n === 0 ? 'below 40' : n + '+'}`).join(' · ') + '.';

export function median(rows: Array<{ score?: number | null; total?: number | null; max?: number | null }>): number | null {
  const xs = rows.map(of).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return Math.round(xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2);
}

export const BAND_LIST = BANDS.map(([n, t]) => ({ from: n, name: t }));
