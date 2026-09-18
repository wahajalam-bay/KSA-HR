/* ─────────────────────────────────────────────────────────────────────────────
   What the panel actually said.

   Several people score the same candidate against the kit's criteria, and each
   returns an overall out of five and a verdict. On their own those are four
   opinions in four places; read together they are a decision. This turns them
   into one weighted score, a measure of how much the panel agrees, the flags
   worth saying out loud — somebody has not filed, the panel disagrees by two
   points, the candidate is below the bar on a criterion — and a recommendation
   that says what to do next rather than leaving it implied.

   Pure: it takes rows and returns a reading. The query gathers the rows, the
   card draws the reading, and this decides what the reading is — so the
   requisition's ranking table and the candidate panel cannot disagree.
   ───────────────────────────────────────────────────────────────────────────*/

export type FeedbackVerdict = 'strong_yes' | 'yes' | 'no' | 'strong_no';

export type EvaluationInput = {
  id: string;
  evaluatorName: string;
  stage: string;
  stageName?: string;
  overall: number | null;
  verdict: FeedbackVerdict | null;
  submitted: boolean;
  criteria: Array<{ name: string; score: number | null }>;
};

export type FeedbackInput = {
  evaluations: EvaluationInput[];
  /** The kit's criteria weights, by criterion name. Anything unlisted weighs 1. */
  weights?: Record<string, number>;
  /** Every scored peer on the same requisition, for the rank. */
  peers?: Array<{ applicationId: string; mean: number }>;
  applicationId?: string;
};

export type Flag = { tone: 'ok' | 'warn' | 'bad' | 'info'; text: string };

export type Feedback = {
  done: EvaluationInput[];
  pending: EvaluationInput[];
  criteria: Array<{ name: string; mean: number; n: number; weight: number; min: number; max: number }>;
  /** The weighted mean over the criteria, on the hundred. Null until somebody files. */
  score: number | null;
  /** How much the panel agrees: 1 is unanimous, 0 is a two-point spread or worse. */
  consensus: number | null;
  spread: number;
  votes: Record<FeedbackVerdict, number>;
  flags: Flag[];
  recommendation: string;
  tone: 'ok' | 'warn' | 'bad' | 'brand' | '';
  rank: number;
  of: number;
  evaluators: Array<{ name: string; overall: number | null; verdict: FeedbackVerdict | null; stage: string }>;
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const list = (xs: string[]): string =>
  (xs.length < 2 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const dec = (n: number, k = 1): string => n.toFixed(k);

export function analyse(input: FeedbackInput): Feedback {
  const all = input.evaluations;
  const done = all.filter((e) => e.submitted && e.overall != null);
  const pending = all.filter((e) => !e.submitted);
  const weights = input.weights ?? {};

  const byName = new Map<string, number[]>();
  for (const e of done) {
    for (const c of e.criteria) {
      if (c.score == null) continue;
      byName.set(c.name, [...(byName.get(c.name) ?? []), c.score]);
    }
  }
  const criteria = [...byName.entries()].map(([name, xs]) => ({
    name, mean: mean(xs), n: xs.length, weight: weights[name] ?? 1,
    min: Math.min(...xs), max: Math.max(...xs),
  }));

  const wsum = sum(criteria.map((c) => c.weight)) || 1;
  const weighted = criteria.length
    ? sum(criteria.map((c) => c.mean * c.weight)) / wsum
    : mean(done.map((e) => e.overall as number));

  const overalls = done.map((e) => e.overall as number);
  const spread = overalls.length ? Math.max(...overalls) - Math.min(...overalls) : 0;
  const sd = overalls.length > 1
    ? Math.sqrt(mean(overalls.map((x) => (x - mean(overalls)) ** 2)))
    : 0;

  const score = done.length ? Math.round((weighted / 5) * 100) : null;
  const consensus = done.length > 1 ? clamp(1 - sd / 1.5, 0, 1) : null;

  const votes: Record<FeedbackVerdict, number> = { strong_yes: 0, yes: 0, no: 0, strong_no: 0 };
  for (const e of done) if (e.verdict) votes[e.verdict] += 1;

  const flags: Flag[] = [];
  if (pending.length) {
    flags.push({
      tone: 'warn',
      text: `${pending.length} scorecard${pending.length > 1 ? 's' : ''} still outstanding — ${pending.map((e) => e.evaluatorName).join(', ')}`,
    });
  }
  if (done.length && done.length < 2) {
    flags.push({ tone: 'info', text: 'Only one interviewer has scored — a second view is worth having before a decision' });
  }
  if (spread >= 2) {
    flags.push({ tone: 'bad', text: `Interviewers disagree by ${dec(spread)} points — worth a calibration conversation` });
  }
  const weak = criteria.filter((c) => c.mean < 3);
  if (weak.length) flags.push({ tone: 'warn', text: `Below the bar on ${list(weak.map((c) => c.name))}` });
  const strong = criteria.filter((c) => c.mean >= 4.5);
  if (strong.length) flags.push({ tone: 'ok', text: `Stands out on ${list(strong.map((c) => c.name))}` });

  const ranked = [...(input.peers ?? [])].sort((a, b) => b.mean - a.mean);
  const rank = input.applicationId
    ? ranked.findIndex((p) => p.applicationId === input.applicationId) + 1
    : 0;

  let recommendation: string;
  let tone: Feedback['tone'];
  if (!done.length) { recommendation = 'No scorecards yet'; tone = ''; }
  else if (spread >= 2 && done.length > 1) { recommendation = 'Calibrate before deciding'; tone = 'warn'; }
  else if ((score ?? 0) >= 80 && votes.no + votes.strong_no === 0) { recommendation = 'Proceed to offer'; tone = 'brand'; }
  else if ((score ?? 0) >= 65) { recommendation = 'Progress'; tone = 'ok'; }
  else if ((score ?? 0) >= 50) { recommendation = 'Discuss with the panel'; tone = 'warn'; }
  else { recommendation = 'Do not progress'; tone = 'bad'; }

  return {
    done, pending, criteria, score, consensus, spread, votes, flags,
    recommendation, tone, rank, of: ranked.length,
    evaluators: done.map((e) => ({
      name: e.evaluatorName, overall: e.overall, verdict: e.verdict, stage: e.stageName ?? e.stage,
    })),
  };
}
