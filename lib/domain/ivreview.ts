/* ─────────────────────────────────────────────────────────────────────────────
   How the interview was run.

   Every interview is recorded, and the recording answers two questions. The
   first — what the conversation says about the candidate — is the scorecard,
   and a human writes that. The second is whether whoever ran it did the job
   properly: did they open it well, ask what the job description actually needs,
   listen more than they talked, stay inside the law, close with a next step,
   and write the scorecard up afterwards.

   This module is the second question: six criteria, one to five, meaned onto a
   hundred, with coaching rather than a verdict. Pure — the service writes the
   review, the queries read it, and this decides what the numbers mean.
   ───────────────────────────────────────────────────────────────────────────*/

export const CRIT: Array<[string, string, string]> = [
  ['opening', 'Opening', 'introduced themselves and the role, set the agenda, put the candidate at ease'],
  ['questions', 'Questions', 'covered what the JD asks for, asked for evidence, nothing leading'],
  ['listening', 'Listening', 'let answers finish, followed up, talked less than the candidate'],
  ['compliance', 'Compliance', 'consent to record, nothing unlawful — age, marital status, family plans, nationality'],
  ['closing', 'Closing', 'answered their questions, gave a next step and a date'],
  ['scorecard', 'Scorecard', 'written up, and written up while it was still fresh'],
];

export const CRIT_KEYS = CRIT.map((c) => c[0]);
export const CRIT_LABEL: Record<string, string> = Object.fromEntries(CRIT.map(([k, t]) => [k, t]));

/** Fewer than this many interviews and the median says nothing; they sit last. */
export const MIN_N = 3;

export const band = (s: number | null): '' | 'ok' | 'warn' | 'bad' =>
  (s == null ? '' : s >= 80 ? 'ok' : s >= 65 ? '' : s >= 50 ? 'warn' : 'bad');

export const bandText = (s: number | null): string =>
  (s == null ? 'Not analysed'
    : s >= 85 ? 'Exemplary' : s >= 80 ? 'Strong' : s >= 65 ? 'Solid'
      : s >= 50 ? 'Needs coaching' : 'Off standard');

/** The score the six ratings make: their mean, onto a hundred. */
export const scoreFrom = (ratings: Record<string, number>): number =>
  Math.round((CRIT_KEYS.reduce((n, k) => n + (ratings[k] ?? 0), 0) / (CRIT_KEYS.length * 5)) * 100);

/** A review worth a second look: compliance at two or less, or a raised flag. */
export const isFlagged = (
  r: { ratings?: Record<string, number> | null; flags?: string[] | null } | null,
): boolean => !!r && (((r.ratings?.compliance ?? 5) <= 2) || !!(r.flags ?? []).length);

export const BANDS: Array<[string, (x: number) => boolean, string]> = [
  ['80 and above', (x) => x >= 80, 'var(--ok)'],
  ['65 – 79', (x) => x >= 65 && x < 80, 'var(--wave-3)'],
  ['50 – 64', (x) => x >= 50 && x < 65, 'var(--warn)'],
  ['below 50', (x) => x < 50, 'var(--bad)'],
];
