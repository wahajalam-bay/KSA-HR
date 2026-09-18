/* ─────────────────────────────────────────────────────────────────────────────
   Probation, and what "a good hire" means.

   A hire is not a good hire the day they sign. It counts once the person has
   been here three months and has not been let go — that is the definition this
   module carries everywhere, and it is why quality of hire is the share of
   *decided* hires that passed. The ones still inside their three months are
   reported beside the rate rather than quietly counted as good, because
   counting them would make the number flatter to exactly the degree that the
   desk had recently been busy.
   ───────────────────────────────────────────────────────────────────────────*/

export const PROBATION_MONTHS = 3;

export type ProbationState = 'passed' | 'failed' | 'in_progress' | 'due';

export const PROBATION_STATES: Record<ProbationState, [string, string]> = {
  passed: ['Passed probation', 'ok'],
  failed: ['Not confirmed', 'bad'],
  in_progress: ['Inside the three months', 'info'],
  due: ['Review due', 'warn'],
};

export const PROBATION_REASONS = [
  'Performance below the bar',
  'Attendance and reliability',
  'Did not sell — no closes in three months',
  'Resigned during probation',
  'Conduct',
  'Role changed under them',
];

/** Three months on from a day, clamped when the month is short. */
export function addMonths(isoDay: string, n: number): string {
  const d = new Date(`${isoDay.slice(0, 10)}T09:00:00.000Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export type ProbationRow = {
  startsOn: string;
  endsOn: string;
  state: 'passed' | 'failed' | 'in_progress';
  decidedOn: string | null;
  decidedByName: string | null;
  reason: string | null;
  note: string | null;
};

export const isDecided = (p: ProbationRow): boolean => p.state === 'passed' || p.state === 'failed';

export const daysLeft = (p: ProbationRow, now: Date): number =>
  Math.ceil((Date.parse(`${p.endsOn}T00:00:00.000Z`) - now.getTime()) / 86_400_000);

/** Has the person actually started? An accepted offer with a joining date still
    ahead of it is not inside anything yet. */
export const hasStarted = (startDate: string, now: Date): boolean =>
  Date.parse(`${startDate.slice(0, 10)}T00:00:00.000Z`) <= now.getTime();

export const isOverdue = (p: ProbationRow, now: Date): boolean =>
  !isDecided(p) && daysLeft(p, now) < 0;

export function probationState(p: ProbationRow, now: Date): ProbationState {
  if (isDecided(p)) return p.state as ProbationState;
  return isOverdue(p, now) ? 'due' : 'in_progress';
}

/** The chip's words: a countdown while it runs, the outcome once it is decided. */
export function probationChip(
  p: ProbationRow, startDate: string, now: Date,
): { text: string; tone: string } {
  const st = probationState(p, now);
  const [label, tone] = PROBATION_STATES[st];
  if (st !== 'in_progress') return { text: label, tone };
  return {
    text: hasStarted(startDate, now) ? `${Math.max(0, daysLeft(p, now))} days left` : 'Has not started',
    tone,
  };
}
