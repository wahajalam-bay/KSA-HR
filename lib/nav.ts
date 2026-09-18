/* ─────────────────────────────────────────────────────────────────────────────
   Navigation actions.

   The prototype kept every filter, tab and period in the URL, so a filtered
   view could be reloaded, bookmarked or sent to a colleague as a link. That is
   worth keeping, so the same thing happens here — except the URL is a real path
   rather than a hash, which means it is also a server render, a cacheable
   response and something a crawler-free deployment can still put in a Slack
   message.

   These are pure: given the action, its value and where you are, they say where
   you should be. No database, no session — the client dispatcher can run them
   without a round trip, which is what makes changing a tab instant.
   ───────────────────────────────────────────────────────────────────────────*/

export type Route = {
  view: string;
  id: string | null;
  sub: string | null;
  query: Record<string, string>;
};

export function parseRoute(pathname: string, search: string | URLSearchParams): Route {
  const seg = pathname.split('/').filter(Boolean);
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const query: Record<string, string> = {};
  params.forEach((v, k) => { query[k] = v; });
  return { view: seg[0] ?? 'overview', id: seg[1] ?? null, sub: seg[2] ?? null, query };
}

export function buildUrl(path: string, query: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${path.startsWith('/') ? path : `/${path}`}${s ? `?${s}` : ''}`;
}

/** Merge into the current query string, dropping anything set to ''. */
export function setQuery(r: Route, patch: Record<string, string | null | undefined>): string {
  const path = `/${[r.view, r.id, r.sub].filter(Boolean).join('/')}`;
  return buildUrl(path, { ...r.query, ...patch });
}

/* ── The registry ───────────────────────────────────────────────────────────
   Every action that only moves you somewhere. Anything not here is a command,
   a sheet, or one of the handful of local behaviours in the client dispatcher.
   Keeping them in one list is also what lets the parity matrix say, for each of
   the prototype's actions, which kind it became. */
type NavFn = (v: string, r: Route, arg?: string | null) => string;

export const NAV_ACTIONS: Record<string, NavFn> = {
  /* the sidebar, the tab bar, the command palette, every "open this" button */
  go: (v) => (v.startsWith('/') ? v : `/${v}`),

  /* Jobs */
  'job.status': (v, r) => setQuery({ ...r, id: null, sub: null }, { status: v, page: null }),
  'job.dept': (v, r) => setQuery(r, { dept: v, page: null }),
  'job.owner': (v, r) => setQuery(r, { owner: v, page: null }),
  'job.sort': (v, r) => setQuery(r, { sort: v }),
  'job.q': (v, r) => setQuery(r, { q: v, page: null }),
  'job.route': (v, r) => setQuery(r, { route: v === 'all' ? null : v }),
  'job.tab': (v, r) => setQuery(r, { tab: v }),
  'job.appliedClear': (_v, r) => setQuery(r, { from: null, to: null }),
  'job.clearq': (_v, r) => setQuery(r, { q: null, from: null, to: null, route: null }),
  'job.fitSort': (_v, r) => setQuery(r, { sort: r.query.sort === 'fit' ? null : 'fit' }),

  /* Candidates */
  'cand.tab': (v, r) => setQuery(r, { tab: v, page: null }),
  'cand.q': (v, r) => setQuery(r, { q: v, page: null }),
  'cand.fam': (v, r) => setQuery(r, { fam: v, page: null }),
  'cand.stage': (v, r) => setQuery(r, { stage: v, page: null }),
  'cand.src': (v, r) => setQuery(r, { src: v, page: null }),
  'cand.own': (v, r) => setQuery(r, { own: v, page: null }),
  'cand.held': (v, r) => setQuery(r, { held: v, page: null }),
  'cand.sort': (v, r) => setQuery(r, { sort: v }),
  'cand.pool': (v, r) => setQuery({ ...r, id: null }, { pool: v || null, tab: v ? 'pipeline' : r.query.tab }),
  'cand.tags': (v, r) => setQuery(r, { tags: v, page: null }),
  'cand.clear': (_v, r) => setQuery({ ...r, id: null }, {}),
  'cand.page': (v, r) => setQuery(r, { page: v }),

  /* Offer stage */
  'off.tab': (v, r) => setQuery(r, { tab: v }),
  'off.q': (v, r) => setQuery(r, { q: v }),
  'off.dept': (v, r) => setQuery(r, { dept: v, job: null }),
  'off.job': (v, r) => setQuery(r, { job: v }),
  'off.qclear': (_v, r) => setQuery(r, { qf: null, qt: null }),
  'off.clear': (_v, r) => setQuery(r, { q: null, dept: null, job: null, qf: null, qt: null }),

  /* Onboarding */
  'onb.tab': (v, r) => setQuery(r, { tab: v, emp: null }),
  'onb.q': (v, r) => setQuery(r, { q: v }),
  'onb.dept': (v, r) => setQuery(r, { dept: v }),
  /* One handler for six filters: the action names which, after the colon. */
  'onb.f': (v, r, arg) => setQuery(r, { [arg || 'f']: v || null }),
  'onb.clear': (_v, r) => setQuery(r,
    { q: null, dept: null, pos: null, done: null, sf: null, st: null, af: null, at: null }),
  'onb.close': (_v, r) => setQuery(r, { emp: null }),
  'onb.open': (v, r) => setQuery(r, { emp: v }),

  /* Manpower plan */
  'mp.tab': (v, r) => setQuery(r, { tab: v, emp: null }),
  'mp.dept': (v, r) => setQuery(r, { tab: 'structure', dept: v }),
  'mp.deptAll': (v, r) => setQuery(r, { dept: v }),
  'mp.company': (_v, r) => setQuery(r, { dept: 'all' }),
  'mp.filter': (v, r) => setQuery(r, { f: v, emp: null }),

  /* Insights */
  'ins.tab': (v, r) => setQuery(r, { tab: v }),
  'ins.win': (v, r) => setQuery(r, { win: v, from: null, to: null }),
  'ins.dept': (v, r) => setQuery(r, { dept: v }),
  'ins.sort': (v, r) => setQuery(r, { sort: v }),

  /* Overview */
  'ov.win': (v, r) => setQuery(r, { win: v, from: null, to: null }),

  /* Scheduling */
  'sch.tab': (v, r) => setQuery(r, { tab: v }),
  'sch.range': (v, r) => setQuery(r, { range: v }),
  'sch.who': (v, r) => setQuery(r, { who: v }),
  'sch.owner': (v, r) => setQuery(r, { owner: v }),
  'sch.mode': (v, r) => setQuery(r, { mode: v }),
  'sch.iw': (v, r) => setQuery(r, { iw: v }),

  /* Team */
  'team.win': (v, r) => setQuery(r, { win: v }),
  'team.role': (v, r) => setQuery(r, { role: v }),

  /* Settings */
  'set.tab': (v, r) => setQuery(r, { tab: v }),
  /* The audit trail's own filters. The trail is long and append-only, so
     finding one entry in it is the whole of using the panel. */
  'set.audit.q': (v, r) => setQuery(r, { q: v || null }),
  'set.audit.action': (v, r) => setQuery(r, { action: v || null }),
  'set.audit.entity': (v, r) => setQuery(r, { entity: v || null }),
  'set.audit.clear': (_v, r) => setQuery(r, { q: null, action: null, entity: null }),
  /* Which template or kit is open on the Templates tab. */
  'set.tpl': (v, r) => setQuery(r, { tpl: v || null, kit: null }),
  'set.kit': (v, r) => setQuery(r, { kit: v || null, tpl: null }),

  /* Probation */
  'prob.win': (v, r) => setQuery(r, { pw: v }),

  /* Ask AI */
  'ask.suggest': (v, r) => setQuery(r, { q: v, rep: null }),
  'ask.clear': (_v, r) => setQuery(r, { q: null, rep: null }),
};

/* Sheets: an action that opens a panel rather than changing anything. The
   content is rendered on the server — the same components as a page — and
   pushed onto the stack. */
export const SHEET_ACTIONS = new Set<string>([
  'job.new', 'job.edit', 'job.addCand',
  'cand.new', 'cand.newJob', 'cv.review',
  'app.move', 'app.reject', 'app.email',
  'drawer.open', 'drawer.cand', 'drawer.app', 'drawer.cross',
  /* Moving between the panel's tabs re-renders it in place. */
  'drawer.open:tab', 'drawer.cand:tab',
  'offer.open', 'offer.queue', 'offer.edit', 'offer.verify', 'offer.decline', 'offer.revise',
  'otpl.open', 'otpl.fields',
  'scr.call', 'scr.salary', 'scr.stageCalls', 'scr.transcript',
  'book.pick', 'ivw.new', 'ivw.reschedule', 'ivr.open', 'eval.start',
  'asm.invite',
  'pitch.brief', 'pp.new', 'pp.edit', 'pp.cfg',
  'sk.jd',
  'pos.open', 'pos.new', 'pos.openReq', 'mp.import', 'mp.template', 'mp.importPreview',
  'emp.open', 'emp.formEdit', 'ref.add', 'ref.rate',
  'prob.open',
  'acc.invite', 'acc.scope',
  'staff.new', 'staff.edit', 'staff.delete',
  'dept.new', 'dept.edit', 'apf.stepEdit', 'qb.new', 'qb.edit', 'jq.new', 'jq.edit', 'jq.pick',
  'tm.add', 'tm.edit',
  'task.new', 'pool.new', 'tag.add',
  'me.switch', 'notif.open', 'create.open', 'help.open',
  'cand.claim', 'hm.add', 'jd.edit',
  'onb.notify', 'onb.file',
  'data.schema', 'audit.open',
]);

/* Purely local behaviour — the client handles these without a round trip. */
export const LOCAL_ACTIONS = new Set<string>([
  'sheet.close', 'sheet.closeAll', 'confirm.yes', 'confirm.no',
  'palette.open', 'palette.close', 'palette.run',
  'theme.cycle', 'theme.set',
  'drawer.tab', 'drawer.full', 'job.jump',
  'mp.zoom', 'noop',
]);

export function classify(actName: string): 'nav' | 'sheet' | 'local' | 'command' {
  if (NAV_ACTIONS[actName]) return 'nav';
  if (SHEET_ACTIONS.has(actName)) return 'sheet';
  if (LOCAL_ACTIONS.has(actName)) return 'local';
  return 'command';
}

/**
 * An action string, as the name of the thing to run and whatever was written
 * after the colon.
 *
 * `jq.move:job_a`, `onb.f:dept`, `emp.doc:emp_1:iban` — the colon carries the
 * context a button cannot put in `data-v` because `data-v` is already saying
 * which row was pressed. The whole string is tried first, which is what keeps
 * `drawer.open:tab` meaning one thing rather than `drawer.open` with an
 * argument; only if nothing answers to it is it split at the first colon.
 *
 * A command is never known here — the registry is server-side — so a name
 * that is not a route, a panel or a local behaviour is split and both halves
 * are sent. The dispatcher tries the whole string before the base, so a
 * command may still be called something with a colon in it if it ever needs
 * to be.
 */
export function splitAction(act: string): { name: string; arg: string | null } {
  if (NAV_ACTIONS[act] || SHEET_ACTIONS.has(act) || LOCAL_ACTIONS.has(act)) {
    return { name: act, arg: null };
  }
  const i = act.indexOf(':');
  if (i < 0) return { name: act, arg: null };
  return { name: act.slice(0, i), arg: act.slice(i + 1) };
}
