import 'server-only';

/* ═════════════════════════════════════════════════════════════════════════════
   ASK: a question in plain words becomes a report.

   The rule that shapes this whole file: the assistant never gets database
   access. A question is resolved into a *specification* — one metric, one
   optional dimension, a period and a set of filters, all drawn from closed
   vocabularies defined here — and that specification is then executed against
   the same scoped reporting layer every other report uses. There is no path
   from a question to a query.

   That means three things in practice. An account that may see nine
   requisitions gets an answer about those nine, because the resolver runs
   inside its scope. A question the grammar cannot read is refused rather than
   guessed at. And when a model is configured, it is asked to produce a
   specification in this vocabulary and nothing else — its answer is validated
   against these tables before anything is computed, so a model that invents a
   metric produces an error, not a report.
   ═════════════════════════════════════════════════════════════════════════════*/

export type MetricKey =
  | 'hires' | 'applications' | 'interviews' | 'offers' | 'acceptance' | 'time_to_hire'
  | 'time_to_fill' | 'pipeline' | 'sla' | 'rejections' | 'screenings' | 'pass_rate'
  | 'conversion' | 'open_reqs' | 'joiners' | 'headcount';

export type DimKey =
  | 'department' | 'function' | 'recruiter' | 'source' | 'month' | 'stage' | 'location'
  | 'job' | 'family' | 'hiring_manager' | 'nationality' | 'channel';

export type Metric = {
  label: string; kw: RegExp; unit: string;
  kind: 'count' | 'rate' | 'median' | 'snapshot';
};

export const METRICS: Record<MetricKey, Metric> = {
  hires: { label: 'Hires', kw: /\b(hires?|hired|hiring|joined|joiners?|placements?)\b/i, unit: 'hires', kind: 'count' },
  applications: { label: 'Applications', kw: /\b(applications?|applicants?|applied|candidates? (?:applied|received)|inflow|volume)\b/i, unit: 'applications', kind: 'count' },
  interviews: { label: 'Interviews', kw: /\binterviews?\b/i, unit: 'interviews', kind: 'count' },
  offers: { label: 'Offers sent', kw: /\boffers? (?:sent|made|extended|issued)|\boffers?\b/i, unit: 'offers', kind: 'count' },
  acceptance: { label: 'Offer acceptance rate', kw: /\b(accept(?:ance|ed)? rate|offer acceptance|acceptance|declin)/i, unit: '%', kind: 'rate' },
  time_to_hire: { label: 'Time to hire (median days)', kw: /\btime[- ]to[- ]hire\b|\btth\b|\bdays to hire\b|\bhow long.*hire/i, unit: 'days', kind: 'median' },
  time_to_fill: { label: 'Time to fill (median days)', kw: /\btime[- ]to[- ]fill\b|\bttf\b/i, unit: 'days', kind: 'median' },
  pipeline: { label: 'Live pipeline', kw: /\b(pipeline|in play|live candidates|active candidates|in process)\b/i, unit: 'candidates', kind: 'snapshot' },
  sla: { label: 'Past SLA', kw: /\b(sla|overdue|stuck|past sla|breach(?:es|ing)?|late)\b/i, unit: 'applications', kind: 'snapshot' },
  rejections: { label: 'Rejections', kw: /\b(reject(?:ions?|ed)|regrets?|disqualif)/i, unit: 'rejections', kind: 'count' },
  screenings: { label: 'Screenings completed', kw: /\bscreen(?:ing|ings|ed)\b/i, unit: 'screenings', kind: 'count' },
  pass_rate: { label: 'Screening pass rate', kw: /\bpass rate\b|\bscreening pass/i, unit: '%', kind: 'rate' },
  conversion: { label: 'Application → hire conversion', kw: /\bconversion|convert|yield\b/i, unit: '%', kind: 'rate' },
  open_reqs: { label: 'Open requisitions', kw: /\b(open (?:requisitions?|roles?|positions?|jobs?)|requisitions?|vacanc(?:y|ies)|openings)\b/i, unit: 'requisitions', kind: 'snapshot' },
  joiners: { label: 'Joiners', kw: /\b(start(?:ing|s)?|joining|onboarding)\b/i, unit: 'joiners', kind: 'count' },
  headcount: { label: 'Headcount', kw: /\b(headcount|employees?|staff count|seats?|manpower)\b/i, unit: 'seats', kind: 'snapshot' },
};

export const DIMS: Record<DimKey, { label: string; kw: RegExp }> = {
  department: { label: 'department', kw: /\b(by|per|across|each) (?:department|dept|team)s?\b|\bdepartments?\b/i },
  function: { label: 'function', kw: /\b(by|per|across|each) (?:function|division)s?\b|\bfunctions?\b|\bdivisions?\b/i },
  recruiter: { label: 'recruiter', kw: /\b(by|per|each) recruiters?\b|\brecruiters?\b|\btalent partners?\b|\bowner\b/i },
  source: { label: 'source', kw: /\b(by|per) (?:source|channel)s?\b|\bsources?\b|\bchannels?\b|\bsource mix\b/i },
  month: { label: 'month', kw: /\b(by|per|each) month\b|\bmonthly\b|\btrend\b|\bover time\b|\bmonths?\b/i },
  stage: { label: 'stage', kw: /\b(by|per|each) stage\b|\bstages?\b/i },
  location: { label: 'location', kw: /\b(by|per) (?:location|city|office)s?\b|\blocations?\b|\bcit(?:y|ies)\b/i },
  job: { label: 'requisition', kw: /\b(by|per) (?:job|requisition|role|position)s?\b/i },
  family: { label: 'job family', kw: /\b(by|per) (?:family|families)\b|\bjob famil/i },
  hiring_manager: { label: 'hiring manager', kw: /\bhiring managers?\b|\bhm\b/i },
  nationality: { label: 'nationality', kw: /\bnationalit(?:y|ies)\b|\bsaudi(?:sation|zation)?\b|\bnitaqat\b/i },
  channel: { label: 'screening channel', kw: /\b(by|per) (?:screening )?channel\b/i },
};

const WINDOWS: Array<[RegExp, number | 'ytd', string]> = [
  [/\b(last|past|previous) (7|seven) days\b|\bthis week\b|\blast week\b/i, 7, 'Last 7 days'],
  [/\b(last|past) (30|thirty) days\b|\blast month\b|\bthis month\b|\bpast month\b/i, 30, 'Last 30 days'],
  [/\b(last|past|this) quarter\b|\b(90|ninety) days\b|\b(3|three) months\b|\bq[1-4]\b/i, 90, 'Last quarter'],
  [/\b(6|six) months\b|\bhalf[- ]year\b|\bh[12]\b/i, 180, 'Last 6 months'],
  [/\b(12|twelve) months\b|\blast year\b|\bpast year\b|\b(a|one) year\b/i, 365, 'Last 12 months'],
  [/\bthis year\b|\bytd\b|\byear to date\b/i, 'ytd', 'This year to date'],
  [/\ball[- ]time\b|\bever\b|\boverall\b|\bto date\b/i, 3650, 'All time'],
];

export const SUGGESTIONS = [
  'Hires by department in the last 6 months',
  'Time to hire by recruiter this year',
  'Offer acceptance rate by month',
  'Applications by source last quarter',
  'Live pipeline by stage for Integrated Services',
  'SLA breaches by recruiter',
  'Screening pass rate by channel',
  'Headcount by function',
  'Hires by department in Sales this year',
  'Joiners starting in the next 30 days',
  'Interviews by hiring manager last quarter',
];

export type Spec = {
  q: string;
  metric: MetricKey | null;
  dim: DimKey | null;
  window: number | 'ytd' | null;
  windowLabel: string;
  filters: {
    deptId?: string; fnId?: string; recruiterId?: string; locationId?: string; source?: string;
  };
  share: boolean;
  future: boolean;
  confidence: number;
  via: 'grammar' | 'model';
};

/** What the parser is allowed to recognise as a name, from the viewer's scope. */
export type Vocabulary = {
  departments: Array<{ id: string; name: string }>;
  functions: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; city: string }>;
  sources: string[];
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const looseRe = (name: string) => escapeRe(name)
  .replace(/\\?\s*-\s*/g, '\\s*-?\\s*')
  .replace(/&/g, '(?:&|and)')
  .replace(/\s+/g, '\\s+');

/** Read a question into a specification, using nothing but the tables above. */
export function parse(q: string, vocab: Vocabulary): Spec {
  const text = String(q ?? '').trim();
  const spec: Spec = {
    q: text, metric: null, dim: null, window: null, windowLabel: '',
    filters: {},
    share: /\b(share|mix|split|breakdown|proportion|percentage of)\b/i.test(text),
    future: /\bnext\b|\bupcoming\b|\bahead\b/i.test(text),
    confidence: 0,
    via: 'grammar',
  };

  /* Filters first, so a department name does not double as a dimension. The
     longest matching name wins: "Integrated Services (A)" beats "Integrated
     Services". */
  const dHit = vocab.departments
    .filter((d) => new RegExp(`(?:^|[^A-Za-z])${looseRe(d.name)}(?![A-Za-z])`, 'i').test(text))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (dHit && !new RegExp(`\\bby\\s+${looseRe(dHit.name)}`, 'i').test(text)) {
    spec.filters.deptId = dHit.id;
  }
  if (!spec.filters.deptId) {
    const fHit = vocab.functions
      .filter((f) => new RegExp(`\\b(in|for|within|of|across)\\s+${looseRe(f.name)}(?![A-Za-z])`, 'i').test(text))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (fHit) spec.filters.fnId = fHit.id;
  }
  for (const s of vocab.staff) {
    const first = s.name.split(' ')[0];
    if (new RegExp(`\\b${escapeRe(first)}\\b`, 'i').test(text)) { spec.filters.recruiterId = s.id; break; }
  }
  for (const l of vocab.locations) {
    if (new RegExp(`\\b${escapeRe(l.city.split(' ')[0])}\\b`, 'i').test(text)
      && !/\bby (?:location|city)/i.test(text)) { spec.filters.locationId = l.id; break; }
  }
  for (const src of vocab.sources) {
    if (new RegExp(`\\b${escapeRe(src.split(' — ')[0])}\\b`, 'i').test(text)
      && !/\bby (?:source|channel)/i.test(text)) { spec.filters.source = src; break; }
  }

  /* The metric: the most specific match wins — acceptance before offers, pass
     rate before screenings, time to hire before hires. */
  const order: MetricKey[] = [
    'acceptance', 'pass_rate', 'time_to_hire', 'time_to_fill', 'conversion', 'sla', 'pipeline',
    'open_reqs', 'headcount', 'rejections', 'screenings', 'interviews', 'offers', 'applications',
    'joiners', 'hires',
  ];
  for (const k of order) if (METRICS[k].kw.test(text)) { spec.metric = k; break; }
  if (spec.metric === 'joiners' && !spec.future && /\bhires?\b/i.test(text)) spec.metric = 'hires';

  for (const [k, d] of Object.entries(DIMS) as Array<[DimKey, typeof DIMS[DimKey]]>) {
    if (d.kw.test(text)) { spec.dim = k; break; }
  }
  if (spec.dim === 'source' && (spec.metric === 'screenings' || spec.metric === 'pass_rate')) spec.dim = 'channel';
  if (spec.dim === 'department' && spec.filters.deptId && !/\bby (?:department|dept|team)/i.test(text)) spec.dim = null;
  if (spec.dim === 'function' && spec.filters.fnId && !/\bby (?:function|division)/i.test(text)) spec.dim = null;
  if (spec.dim === 'recruiter' && spec.filters.recruiterId && !/\bby recruiter/i.test(text)) spec.dim = null;

  for (const [re, days, label] of WINDOWS) {
    if (re.test(text)) { spec.window = days; spec.windowLabel = label; break; }
  }
  if (spec.metric === 'joiners' && spec.future) {
    const m = text.match(/next (\d+) days/i);
    spec.window = m ? Number(m[1]) : 30;
    spec.windowLabel = `Next ${spec.window} days`;
  }
  if (!spec.window) {
    const snapshot = spec.metric != null
      && ['pipeline', 'sla', 'open_reqs', 'headcount'].includes(spec.metric);
    spec.window = snapshot ? null : 180;
    spec.windowLabel = spec.window ? 'Last 6 months' : 'As of today';
  }

  spec.confidence = spec.metric
    ? (spec.dim || spec.filters.deptId || spec.filters.fnId || spec.filters.recruiterId ? 0.9 : 0.7)
    : 0;
  return spec;
}

/** A specification a model returned, validated against the vocabulary. Anything
    outside it is refused rather than coerced. */
export function validate(raw: unknown, vocab: Vocabulary, q: string): Spec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const metric = String(o.metric ?? '') as MetricKey;
  if (!METRICS[metric]) return null;
  const dim = o.dim ? (String(o.dim) as DimKey) : null;
  if (dim && !DIMS[dim]) return null;

  const filters: Spec['filters'] = {};
  const f = (o.filters ?? {}) as Record<string, unknown>;
  if (f.deptId && vocab.departments.some((d) => d.id === f.deptId)) filters.deptId = String(f.deptId);
  if (f.fnId && vocab.functions.some((x) => x.id === f.fnId)) filters.fnId = String(f.fnId);
  if (f.recruiterId && vocab.staff.some((s) => s.id === f.recruiterId)) filters.recruiterId = String(f.recruiterId);
  if (f.locationId && vocab.locations.some((l) => l.id === f.locationId)) filters.locationId = String(f.locationId);
  if (f.source && vocab.sources.includes(String(f.source))) filters.source = String(f.source);

  const win = o.window === 'ytd' ? 'ytd'
    : Number.isFinite(Number(o.window)) ? Math.max(1, Math.min(3650, Number(o.window))) : 180;

  return {
    q,
    metric,
    dim,
    window: win,
    windowLabel: String(o.windowLabel ?? (win === 'ytd' ? 'This year to date' : `Last ${win} days`)),
    filters,
    share: !!o.share,
    future: !!o.future,
    confidence: 0.95,
    via: 'model',
  };
}

/** The prompt a model is given. It is asked for a specification, never a query. */
export function prompt(q: string, vocab: Vocabulary): string {
  return [
    'Turn this question about a recruitment database into a report specification.',
    'Reply with JSON only, and use only the keys and values listed.',
    '',
    `Question: ${q}`,
    '',
    `metric: one of ${Object.keys(METRICS).join(', ')}`,
    `dim: one of ${Object.keys(DIMS).join(', ')} or null`,
    'window: a number of days, or "ytd", or null for a snapshot as of today',
    'windowLabel: how you would name that period in English',
    'filters: { deptId, fnId, recruiterId, locationId, source } — use only these ids:',
    `  departments: ${vocab.departments.map((d) => `${d.id}=${d.name}`).join('; ')}`,
    `  functions: ${vocab.functions.map((f) => `${f.id}=${f.name}`).join('; ')}`,
    `  staff: ${vocab.staff.map((s) => `${s.id}=${s.name}`).join('; ')}`,
    `  locations: ${vocab.locations.map((l) => `${l.id}=${l.city}`).join('; ')}`,
    `  sources: ${vocab.sources.join('; ')}`,
    'share: true when the question asks for a split or a mix',
    'future: true when the question asks about something still to come',
    '',
    'Return nothing but the JSON object.',
  ].join('\n');
}

/** The title a report carries. */
export function title(spec: Spec, vocab: Vocabulary): string {
  if (!spec.metric) return 'Report';
  const f: string[] = [];
  if (spec.filters.deptId) f.push(`in ${vocab.departments.find((d) => d.id === spec.filters.deptId)?.name ?? ''}`);
  if (spec.filters.fnId) f.push(`in ${vocab.functions.find((x) => x.id === spec.filters.fnId)?.name ?? ''}`);
  if (spec.filters.recruiterId) f.push(`for ${vocab.staff.find((s) => s.id === spec.filters.recruiterId)?.name ?? ''}`);
  if (spec.filters.locationId) f.push(`in ${vocab.locations.find((l) => l.id === spec.filters.locationId)?.city ?? ''}`);
  if (spec.filters.source) f.push(`from ${spec.filters.source}`);
  return `${METRICS[spec.metric].label}${spec.dim ? ` by ${DIMS[spec.dim].label}` : ''}`
    + `${f.length ? ` ${f.join(', ')}` : ''} — ${spec.windowLabel}`;
}
