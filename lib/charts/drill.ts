/* ═════════════════════════════════════════════════════════════════════════════
   WHERE A CHART MARK LANDS

   A mark on a chart stands for a set of records. Picking it has to produce that
   set — the same records, counted the same way — and not something near it.

   The only way to keep that true as the product grows is to write the
   destination once, beside the definition of what the mark counts, rather than
   assembling a query string at each of the forty places a chart is drawn. These
   builders are that one place: they take what the mark means, in the product's
   own words, and return the action a `Pick` carries.

   Everything lands on an ordinary page through the ordinary `go` action, which
   is what gives a drill-down its URL, its Back behaviour and — the part that
   matters most — its authorization. The page applies the viewer's scope exactly
   as it always did, so a hiring manager who clicks a bar gets their own
   requisitions and nothing else. Analytics is not a way round access control,
   because analytics is not doing the fetching.
   ═════════════════════════════════════════════════════════════════════════════*/

type Val = string | number | boolean | null | undefined;

/** A query string from the parts that have a value. Order is stable, so two
 *  identical drills produce the same URL and the same cache key. */
export function query(parts: Record<string, Val>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    out.push(`${k}=${encodeURIComponent(String(v === true ? 1 : v))}`);
  }
  return out.join('&');
}

const url = (path: string, parts: Record<string, Val>): string => {
  const q = query(parts);
  return q ? `${path}?${q}` : path;
};

/* ── Applications ──────────────────────────────────────────────────────────── */

export type AppDrill = {
  /** Which tab answers the question. `pipeline` is live work, `hired` is hires,
   *  `all` with `apps` is every application whatever became of it. */
  tab?: 'pipeline' | 'all' | 'hired';
  /** List applications rather than people. */
  apps?: boolean;
  /** The period, and which date it is about. */
  from?: string;
  to?: string;
  /** The same window to the instant. Replaces from/to when given. */
  fromAt?: string;
  toAt?: string;
  win?: 'applied' | 'closed' | 'inplay' | 'touched';
  /** The stages the mark covers. Several, for a mark that groups them. */
  stages?: string[];
  /** Reached at any point — what a funnel step counts. */
  reached?: string;
  source?: string;
  sources?: string[];
  ownerId?: string;
  /** Owned by them or sourced by them. */
  touchedBy?: string;
  deptId?: string;
  deptIds?: string[];
  jobId?: string;
  statuses?: string[];
  /** Live, and past the SLA of the stage it is standing in. */
  overSla?: boolean;
  sort?: string;
};

export function applicationsUrl(d: AppDrill): string {
  return url('/candidates', {
    tab: d.tab ?? 'all',
    apps: d.apps ?? (d.tab === 'pipeline' || d.tab === 'hired' ? undefined : true),
    from: d.from,
    to: d.to,
    fromAt: d.fromAt,
    toAt: d.toAt,
    win: d.win && d.win !== 'applied' ? d.win : undefined,
    stage: d.stages?.length ? d.stages.join(',') : undefined,
    reached: d.reached,
    src: d.sources?.length ? d.sources.join(',') : d.source,
    own: d.ownerId,
    by: d.touchedBy,
    dept: d.deptIds?.length ? d.deptIds.join(',') : d.deptId,
    job: d.jobId,
    status: d.statuses?.length ? d.statuses.join(',') : undefined,
    over: d.overSla,
    sort: d.sort,
  });
}

/* ── Requisitions ──────────────────────────────────────────────────────────── */

export type JobDrill = {
  status?: string;
  deptId?: string;
  recruiterId?: string;
  from?: string;
  to?: string;
  sort?: string;
};

export function jobsUrl(d: JobDrill): string {
  return url('/jobs', {
    status: d.status ?? 'open',
    dept: d.deptId,
    owner: d.recruiterId,
    from: d.from,
    to: d.to,
    sort: d.sort,
  });
}

/* ── Interviews ────────────────────────────────────────────────────────── */

export type IvDrill = {
  /** Which end of the span is closed. See AgendaFilters in the query layer. */
  after?: string;
  fromAt?: string;
  toAt?: string;
  mode?: string;
  /** Somebody on the panel, by the name the interview records. */
  panel?: string;
  /** The recruiter who owns the application behind it. */
  ownerId?: string;
};

export function interviewsUrl(d: IvDrill): string {
  return url('/scheduling', {
    tab: 'agenda',
    after: d.after,
    fromAt: d.fromAt,
    toAt: d.toAt,
    mode: d.mode,
    panel: d.panel,
    owner: d.ownerId,
  });
}

/* ── Reading one back ──────────────────────────────────────────────────────── */

/** The application filters carried by a page's query, as the query layer wants
 *  them. One reader, so every page that accepts a drill accepts the same one. */
export function appFiltersFrom(sp: Record<string, string>) {
  const list = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const win: 'closed' | 'inplay' | 'touched' | undefined =
    sp.win === 'closed' || sp.win === 'inplay' || sp.win === 'touched' ? sp.win : undefined;
  return {
    apps: sp.apps === '1' || sp.apps === 'true',
    from: sp.from || undefined,
    to: sp.to || undefined,
    fromAt: sp.fromAt || undefined,
    toAt: sp.toAt || undefined,
    win,
    stages: list(sp.stage),
    reached: sp.reached || undefined,
    statuses: list(sp.status),
    overSla: sp.over === '1',
    sources: list(sp.src).length > 1 ? list(sp.src) : undefined,
    touchedBy: sp.by || undefined,
    deptId: list(sp.dept).length === 1 ? sp.dept : undefined,
    deptIds: list(sp.dept).length > 1 ? list(sp.dept) : undefined,
    jobId: sp.job || undefined,
  };
}

/** True when the query carries anything a chart put there — which is what tells
 *  a page to show the chips that clear it. */
export function hasDrill(sp: Record<string, string>): boolean {
  return !!(sp.from || sp.to || sp.fromAt || sp.toAt || sp.by || sp.over || sp.stage || sp.reached || sp.status || sp.dept || sp.job || sp.apps);
}
