/* ─────────────────────────────────────────────────────────────────────────────
   The skills radar: the candidate against the job description.

   A CV is a list of claims and a job description is a list of demands, and
   until somebody lays one over the other nobody can say in a sentence whether
   this person can do this job. That is what this computes: one axis per skill
   the description asks for, the level it asks for, and what the candidate
   brings — starting from the CV and then moved by what the loop actually found.

   Levels are 1–5 and mean something:
     1 exposure · 2 working knowledge · 3 does it unsupervised · 4 strong ·
     5 sets the standard
   ───────────────────────────────────────────────────────────────────────────*/

export const LEVELS = ['—', 'Exposure', 'Working knowledge', 'Does it unsupervised', 'Strong', 'Sets the standard'];
export const LEVELS_SHORT = ['Exposure', 'Working knowledge', 'Unsupervised', 'Strong', 'Sets the standard'];
export const MAX_LEVEL = 5;

/* The words that make two differently-worded things the same thing. */
const STOP = new Set([
  'the', 'and', 'of', 'a', 'an', 'in', 'to', 'for', 'with', 'skills', 'skill',
  'knowledge', 'native', 'ksa', 'saudi',
]);

const words = (s: string): string[] =>
  String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Two labels are about the same thing when they share a real word. */
export function akin(a: string, b: string): boolean {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return false;
  return A.some((w) => B.some((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, 5)))));
}

/* A language on the skill list is not a claim like the others: the CV states
   the level outright, so it is read from there rather than from where the skill
   happens to sit in a list. */
const LANG_LEVEL: Record<string, number> = {
  Native: 5, Fluent: 4.5, Professional: 4, Conversational: 3, Basic: 1.5, None: 0,
};

export type BarRow = { skill: string; level: number; must: boolean };
export type CandidateSkill = { skill: string; level: number | null; years: number | null };
export type Language = { name: string; level: string };
export type Evidence = { level: number; what: string; who: string; kind: 'scorecard' | 'pitch' | 'screening' };

export type Claim = {
  level: number;
  from: 'cv' | 'language' | 'near' | 'none';
  years?: number | null;
  stated?: string;
  near?: string;
};

export function claimed(
  skill: string,
  skills: CandidateSkill[],
  languages: Language[],
): Claim {
  const lang = languages.find((l) => new RegExp(`\\b${escapeRe(l.name)}\\b`, 'i').test(skill));
  if (lang) {
    return { level: LANG_LEVEL[lang.level] ?? 3, from: 'language', stated: lang.level };
  }
  const exact = skills.find((s) => s.skill.toLowerCase() === skill.toLowerCase());
  if (exact) return { level: exact.level ?? 3, from: 'cv', years: exact.years };
  /* Something close enough to count as adjacent, but unproven. */
  const near = skills.find((s) => akin(s.skill, skill));
  if (near) return { level: 1, from: 'near', near: near.skill };
  return { level: 0, from: 'none' };
}

/* The level to draw: the CV moved towards what the room found. Evidence is
   worth more than a CV line, and two pieces of evidence more than one. */
export type Blended = Omit<Claim, 'from'> & { from: Claim['from'] | 'evidence'; ev: Evidence[] };

export function blend(claim: Claim, evidence: Evidence[]): Blended {
  if (!evidence.length) return { ...claim, ev: [] };
  const seen = evidence.reduce((n, x) => n + x.level, 0) / evidence.length;
  const w = Math.min(0.75, 0.45 + 0.15 * (evidence.length - 1));
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.round((claim.level * (1 - w) + seen * w) * 10) / 10));
  return { ...claim, level: lvl, ev: evidence, from: 'evidence' };
}

export type MatchRow = BarRow & {
  got: number;
  from: Claim['from'] | 'evidence';
  years?: number | null;
  near?: string;
  stated?: string;
  ev: Evidence[];
  gap: number;
};

export type Match = {
  rows: MatchRow[];
  /** Coverage 0–1, or null when the description asks for nothing. */
  score: number | null;
  gaps: MatchRow[];
  strong: MatchRow[];
  missing: MatchRow[];
  musts: MatchRow[];
  metMusts: number;
  tested: number;
};

/* Coverage against the bar, essentials weighted double. A candidate over the
   bar on one skill earns nothing extra for it — being twice as good at cold
   calling does not fill a missing licence. */
export function match(
  bar: BarRow[],
  skills: CandidateSkill[],
  languages: Language[],
  evidenceFor: (skill: string) => Evidence[],
): Match {
  const rows: MatchRow[] = bar.map((b) => {
    const got = blend(claimed(b.skill, skills, languages), evidenceFor(b.skill));
    return {
      ...b,
      got: got.level,
      from: got.from,
      years: got.years,
      near: got.near,
      stated: got.stated,
      ev: got.ev ?? [],
      gap: Math.max(0, b.level - got.level),
    };
  });
  const wt = (r: MatchRow) => (r.must ? 2 : 1);
  const want = rows.reduce((n, r) => n + wt(r) * r.level, 0);
  const have = rows.reduce((n, r) => n + wt(r) * Math.min(r.got, r.level), 0);
  return {
    rows,
    score: want ? have / want : null,
    gaps: rows.filter((r) => r.gap > 0).sort((a, b) => (b.gap * wt(b)) - (a.gap * wt(a))),
    strong: rows.filter((r) => r.got > r.level).sort((a, b) => (b.got - b.level) - (a.got - a.level)),
    missing: rows.filter((r) => r.from === 'none' || r.from === 'near'),
    musts: rows.filter((r) => r.must),
    metMusts: rows.filter((r) => r.must && !r.gap).length,
    tested: rows.filter((r) => r.ev.length).length,
  };
}

/* At most six axes, essentials first — a radar with nine spokes is a picture of
   nothing. */
export function axesOf(m: Match, n = 6): MatchRow[] {
  return [...m.rows]
    .sort((a, b) => (
      ((b.must ? 100 : 0) + b.level * 10 + b.ev.length) -
      ((a.must ? 100 : 0) + a.level * 10 + a.ev.length)
    ))
    .slice(0, n);
}

export function verdict(score: number | null): [string, 'ok' | 'warn' | 'bad' | ''] {
  if (score == null) return ['No job description to match against', ''];
  if (score >= 0.92) return ['Matches the description', 'ok'];
  if (score >= 0.78) return ['Close to the bar', 'ok'];
  if (score >= 0.6) return ['Short in places', 'warn'];
  return ['Well short of the bar', 'bad'];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
