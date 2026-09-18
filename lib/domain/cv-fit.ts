/* ─────────────────────────────────────────────────────────────────────────────
   The CV fit: 0–100 against one requisition's job description.

   Six parts, weighted the way a recruiter reads a CV against a brief:

     45  the skills the requisition asks for
     15  the requirement lines echoed anywhere in the CV
     15  the current role against the title and the job family
     10  years of experience against what the JD asks for
     10  location
      5  language and licences

   It is deterministic and explainable — the breakdown is shown part by part,
   because a number a recruiter cannot argue with is a number they will not use.
   Where an AI provider is configured, Claude reads the CV against the JD and
   that reading wins, marked as such; with none, this is the answer and the card
   says it came from the local rules.
   ───────────────────────────────────────────────────────────────────────────*/

export type FitPart = { key: string; label: string; pts: number; max: number; detail: string };
export type Fit = {
  score: number;
  parts: FitPart[];
  matched: string[];
  missing: string[];
  band: 'strong' | 'fair' | 'weak';
  label: string;
  model: 'local' | 'ai';
  summary?: string;
};

export type FitCandidate = {
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  locationCity?: string | null;
  nationality?: string | null;
  family?: string | null;
  yearsExperience?: number | null;
  skills: string[];
  languages: string[];
  resumeSummary?: string | null;
  resumeText?: string | null;
  experienceText?: string | null;
};

export type FitJob = {
  title: string;
  family: string;
  city: string;
  remoteOk: boolean;
  skills: string[];
  requirements: string[];
};

const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9+#& ]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (hay: string, needle: string): boolean => {
  const h = ` ${norm(hay)} `, n = ` ${norm(needle)} `;
  return n.trim().length > 1 && h.includes(n);
};

const YEARS_RE = /(\d{1,2})\+?\s*(?:years?|yrs)/i;

/* Words too common to prove anything: a requirement line that only shares
   "experience" with a CV has not been met. */
const WEAK = new Set([
  'years', 'experience', 'with', 'from', 'that', 'this', 'have', 'your', 'their',
  'professional', 'working', 'comfortable', 'strong', 'record', 'based', 'role',
  'relocating', 'valid', 'preferred', 'knowledge',
]);

const ARABIC_NATIONALITIES = new Set([
  'Saudi', 'Egyptian', 'Jordanian', 'Lebanese', 'Syrian', 'Sudanese', 'Yemeni', 'Palestinian',
]);
const ARABIC_FAMILIES = new Set(['Sales', 'Integrated Services', 'Operations']);
const KSA_CITIES = /riyadh|jeddah|dammam|khobar|makkah|madinah|dhahran|jubail/i;

export function fit(c: FitCandidate, j: FitJob): Fit {
  const candText = [
    c.headline, c.currentTitle, c.currentCompany, c.skills.join(' '),
    c.resumeSummary, c.resumeText, c.experienceText,
  ].filter(Boolean).join(' \n ');

  const parts: FitPart[] = [];

  // ── skills the requisition asks for ───────────────────────────────────────
  const want = j.skills;
  const matched = want.filter((s) => c.skills.some((x) => norm(x) === norm(s)) || has(candText, s));
  const missing = want.filter((s) => !matched.includes(s));
  parts.push({
    key: 'skills', label: 'Skills the requisition asks for',
    pts: want.length ? Math.round((45 * matched.length) / want.length) : 30, max: 45,
    detail: want.length
      ? `${matched.length} of ${want.length}: ${matched.join(', ') || '—'}${missing.length ? ` · missing ${missing.join(', ')}` : ''}`
      : 'No skills listed on the requisition',
  });

  // ── requirement lines echoed in the CV ────────────────────────────────────
  const reqs = j.requirements.filter((r) => !YEARS_RE.test(r));
  const strongWords = (line: string) => norm(line).split(' ').filter((w) => w.length > 4 && !WEAK.has(w));
  const reqHits = reqs.filter((r) => strongWords(r).some((w) => has(candText, w)));
  parts.push({
    key: 'requirements', label: 'JD requirements echoed in the CV',
    pts: reqs.length ? Math.round((15 * reqHits.length) / reqs.length) : 10, max: 15,
    detail: reqs.length ? `${reqHits.length} of ${reqs.length} requirement lines` : 'No requirements on the JD',
  });

  // ── the current role against the title and the family ─────────────────────
  const jt = norm(j.title.replace(/\s+—.*$/, ''));
  const ct = norm(c.currentTitle || c.headline || '');
  const jtWords = jt.split(' ').filter((w) => w.length > 3);
  const hit = jtWords.filter((w) => ct.includes(w)).length;
  const sameFamily = !!c.family && c.family === j.family;
  parts.push({
    key: 'role', label: 'Current role vs the requisition',
    pts: Math.min(15, (sameFamily ? 8 : 0) + (jtWords.length ? Math.round((10 * hit) / jtWords.length) : 0)),
    max: 15,
    detail: `${c.currentTitle || 'no title'}${sameFamily ? ' · same job family' : ''}${hit ? ` · ${hit} title word${hit === 1 ? '' : 's'} in common` : ''}`,
  });

  // ── years, against what the JD asks for ───────────────────────────────────
  const need = Math.max(0, ...j.requirements.map((r) => Number((r.match(YEARS_RE) ?? ['', '0'])[1])));
  const yrs = c.yearsExperience ?? null;
  parts.push({
    key: 'experience', label: 'Experience',
    pts: yrs == null ? 5 : need ? Math.round(10 * Math.min(1, yrs / need)) : (yrs >= 2 ? 10 : 6),
    max: 10,
    detail: yrs == null ? 'years unknown' : `${yrs} year${yrs === 1 ? '' : 's'}${need ? ` against ${need}+ asked` : ''}`,
  });

  // ── location ──────────────────────────────────────────────────────────────
  const cc = c.locationCity ?? '';
  const locPts = j.remoteOk || /remote/i.test(j.city) ? 10
    : norm(cc) === norm(j.city) ? 10
      : KSA_CITIES.test(cc) ? 5
        : cc ? 2 : 4;
  parts.push({
    key: 'location', label: 'Location', pts: locPts, max: 10,
    detail: cc ? `${cc} — role in ${j.city}` : `location unknown — role in ${j.city}`,
  });

  // ── Arabic, licences and the other named must-haves ───────────────────────
  const needAr = /arabic/i.test(j.requirements.join(' ')) || ARABIC_FAMILIES.has(j.family);
  const hasAr = c.languages.some((l) => /arabic/i.test(l))
    || /arabic/i.test(candText)
    || (!!c.nationality && ARABIC_NATIONALITIES.has(c.nationality));
  parts.push({
    key: 'musts', label: 'Language and licences',
    pts: needAr ? (hasAr ? 5 : 1) : 5, max: 5,
    detail: needAr ? (hasAr ? 'Arabic — yes' : 'Arabic asked for, not evident') : 'No language requirement',
  });

  const total = Math.max(0, Math.min(100, parts.reduce((n, p) => n + p.pts, 0)));
  return {
    score: total, parts, matched, missing,
    band: total >= 75 ? 'strong' : total >= 50 ? 'fair' : 'weak',
    label: total >= 75 ? 'Strong fit' : total >= 50 ? 'Fair fit' : 'Weak fit',
    model: 'local',
  };
}

export const fitBandOf = (score: number): Fit['band'] =>
  (score >= 75 ? 'strong' : score >= 50 ? 'fair' : 'weak');
export const fitLabelOf = (score: number): string =>
  (score >= 75 ? 'Strong fit' : score >= 50 ? 'Fair fit' : 'Weak fit');
