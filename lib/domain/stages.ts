/* ─────────────────────────────────────────────────────────────────────────────
   The stage spine, and the rules about moving along it.

   Ten stages in a fixed order. Four of them never move — Applied and Sourced
   are the alternative ways in, Offer and Joined are the way out — and the six
   between them are the recruiter's to pick, rename and time, requisition by
   requisition. A pipeline template may rename or skip a stage; nothing may
   reorder one, because every funnel, every conversion rate and every dwell time
   is computed from the order.
   ───────────────────────────────────────────────────────────────────────────*/

export const STAGE_KEYS = [
  'applied', 'sourced', 'screen', 'assessment', 'iv1', 'iv2', 'pitch', 'ivf', 'offer', 'joined',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_INDEX: Record<StageKey, number> = Object.fromEntries(
  STAGE_KEYS.map((k, i) => [k, i]),
) as Record<StageKey, number>;

/** The four the recruiter may not switch off. */
export const FIXED: StageKey[] = ['applied', 'sourced', 'offer', 'joined'];
/** The six they pick. */
export const PICKABLE: StageKey[] = ['screen', 'assessment', 'iv1', 'iv2', 'pitch', 'ivf'];
/** The three that are interview rounds, and get numbered. */
export const ROUNDS: StageKey[] = ['iv1', 'iv2', 'ivf'];
export const FINAL_STAGE: StageKey = 'ivf';

export const isFixed = (k: string): boolean => FIXED.includes(k as StageKey);
export const isPickable = (k: string): boolean => PICKABLE.includes(k as StageKey);
export const isEntry = (k: string): boolean => k === 'applied' || k === 'sourced';
export const isClosed = (k: string): boolean => k === 'joined';

export type JobStage = { stageKey: StageKey; name: string; sla: number; ordinal: number };

/** Put a requisition's loop back into spine order, whatever order it arrived in. */
export const inSpineOrder = <T extends { stageKey: string }>(stages: T[]): T[] =>
  [...stages].sort((a, b) => (STAGE_INDEX[a.stageKey as StageKey] ?? 99) - (STAGE_INDEX[b.stageKey as StageKey] ?? 99));

/* ── Advancing ──────────────────────────────────────────────────────────────
   Applied and Sourced are alternatives rather than consecutive steps, so
   advancing out of either lands on whatever the requisition runs first. */
export function nextStage(loop: JobStage[], from: string): StageKey | null {
  const keys = inSpineOrder(loop).map((s) => s.stageKey);
  let i = keys.indexOf(from as StageKey);
  if (i < 0) return null;
  i += 1;
  while (i < keys.length && isEntry(keys[i])) i += 1;
  return i < keys.length ? keys[i] : null;
}

export function previousStage(loop: JobStage[], from: string): StageKey | null {
  const keys = inSpineOrder(loop).map((s) => s.stageKey);
  const i = keys.indexOf(from as StageKey);
  return i > 0 ? keys[i - 1] : null;
}

export const isForward = (loop: JobStage[], from: string, to: string): boolean =>
  (STAGE_INDEX[to as StageKey] ?? -1) > (STAGE_INDEX[from as StageKey] ?? -1);

/* ── Numbering the rounds ───────────────────────────────────────────────────
   The rounds are numbered by where they fall in that requisition's own loop, so
   a requisition running two interviews has a 1st and a 2nd rather than a 1st
   and a 3rd. Drop the middle one and what was the 3rd becomes the 2nd.

   A name the recruiter typed themselves — "Panel with the Director" — is never
   renumbered over: only a name that is still a plain ordinal moves. */
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export const isOrdinalName = (name: string): boolean =>
  /^(1st|2nd|3rd|4th|5th|6th)\s+Interview$/i.test(String(name).trim());

export function numberRounds<T extends { stageKey: string; name: string }>(rows: T[]): T[] {
  let n = 0;
  return rows.map((r) => {
    if (!ROUNDS.includes(r.stageKey as StageKey)) return r;
    const label = `${ORDINALS[n] ?? `${n + 1}th`} Interview`;
    n += 1;
    return isOrdinalName(r.name) || !r.name ? { ...r, name: label } : r;
  });
}

/* ── Building a loop ────────────────────────────────────────────────────────
   From the recruiter's ticks to the rows that get stored: the fixed spine
   always present, the picked stages in spine order, the rounds renumbered, and
   the SLA clamped to something a person could mean. */
export type LoopInput = { key: string; on: boolean; name?: string; sla?: number };

export function buildLoop(
  picked: LoopInput[],
  opts: { existing?: JobStage[]; defaults?: Record<string, { name: string; sla: number }> } = {},
): JobStage[] {
  const existing = new Map((opts.existing ?? []).map((s) => [s.stageKey, s]));
  const defaults = opts.defaults ?? {};
  const byKey = new Map(picked.map((p) => [p.key, p]));

  const rows: JobStage[] = [];
  for (const key of STAGE_KEYS) {
    const fixed = isFixed(key);
    const p = byKey.get(key);
    if (!fixed && !(p && p.on)) continue;
    const prior = existing.get(key);
    const fallback = defaults[key];
    rows.push({
      stageKey: key,
      /* A fixed stage keeps whatever this requisition calls it. */
      name: (fixed ? (prior?.name ?? fallback?.name) : (p?.name?.trim() || prior?.name || fallback?.name))
        ?? DEFAULT_NAMES[key],
      sla: Math.max(1, Math.min(60, Math.round(
        (fixed ? (prior?.sla ?? fallback?.sla) : (p?.sla ?? prior?.sla ?? fallback?.sla)) ?? DEFAULT_SLA[key],
      ))),
      ordinal: STAGE_INDEX[key],
    });
  }
  return numberRounds(rows);
}

export const DEFAULT_NAMES: Record<StageKey, string> = {
  applied: 'Applied', sourced: 'Sourced', screen: 'Phone Screen', assessment: 'Assessment',
  iv1: '1st Interview', iv2: '2nd Interview', pitch: 'Sales Pitch', ivf: '3rd Interview',
  offer: 'Offer Stage', joined: 'Joined',
};

export const DEFAULT_SLA: Record<StageKey, number> = {
  applied: 3, sourced: 4, screen: 4, assessment: 5, iv1: 6, iv2: 6, pitch: 4, ivf: 5, offer: 7, joined: 30,
};

/* ── SLA ageing ─────────────────────────────────────────────────────────────
   Measured against the requisition's own stage SLA, not a global one. `due` is
   the warning band at 70% — the point at which a recruiter can still do
   something about it. */
export type SlaState = 'ok' | 'due' | 'over';

export function slaOf(daysInStage: number, sla: number): { days: number; sla: number; ratio: number; state: SlaState } {
  const s = sla || 5;
  return {
    days: daysInStage,
    sla: s,
    ratio: daysInStage / s,
    state: daysInStage > s ? 'over' : daysInStage > s * 0.7 ? 'due' : 'ok',
  };
}

/** The colour band a stage pill uses — darker the further along the spine. */
export const stageBand = (ordinal: number): number => Math.min(6, Math.floor((ordinal / 8) * 5) + 1);
