'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { dispatch, dispatchUpload, type DispatchResult } from '@/app/actions/dispatch';
import { renderSheet, type SheetPayload } from '@/app/actions/sheets';
import { NAV_ACTIONS, LOCAL_ACTIONS, SHEET_ACTIONS, classify, splitAction, parseRoute, type Route } from '@/lib/nav';
import { Icon, type IconName } from '@/components/ui/icons';
import { ChartTooltip } from '@/components/charts/tooltip';

/* ═════════════════════════════════════════════════════════════════════════════
   THE INTERACTION LAYER

   The prototype put `data-act` on every control and listened once at the
   document, which is why a button behaved the same on a board card, in a table
   row and inside a panel. That is kept exactly — the markup is identical — but
   what happens when one fires is different:

     nav      → the URL changes and the server re-renders the view
     sheet    → a server component is fetched and pushed onto the panel stack
     local    → the client handles it: closing a panel, the theme, the palette
     command  → a server action runs, with the authorization check on the server

   Nothing is decided here about whether an action is allowed. The client
   classifies and sends; the server decides and answers.
   ═════════════════════════════════════════════════════════════════════════════*/

type Toast = { id: number; text: string; tone?: string; icon?: string; ms: number };
type SheetEntry = SheetPayload & { key: number; act: string; v: string; arg?: string | null };
type Confirmer = { title: string; body: string; yes: string; no: string; danger?: boolean; resolve: (ok: boolean) => void };

type Ctx = {
  fire: (act: string, v?: string, el?: HTMLElement | null) => void;
  toast: (text: string, o?: { tone?: string; icon?: string; ms?: number }) => void;
  closeSheet: (all?: boolean) => void;
  confirm: (o: Omit<Confirmer, 'resolve'>) => Promise<boolean>;
  pending: boolean;
};

const ActionCtx = React.createContext<Ctx | null>(null);
export const useActions = (): Ctx => {
  const c = React.useContext(ActionCtx);
  if (!c) throw new Error('useActions outside the app shell');
  return c;
};

let toastSeq = 0;
let sheetSeq = 0;

export function AppClient({ children, isPortal }: { children: React.ReactNode; isPortal: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [sheets, setSheets] = React.useState<SheetEntry[]>([]);
  const [confirmer, setConfirmer] = React.useState<Confirmer | null>(null);
  const [pending, setPending] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const busy = React.useRef(false);

  const route: Route = React.useMemo(
    () => parseRoute(pathname, search.toString()),
    [pathname, search],
  );
  const routeRef = React.useRef(route);
  routeRef.current = route;

  /* ── toasts ─────────────────────────────────────────────────────────────── */
  const toast = React.useCallback((text: string, o: { tone?: string; icon?: string; ms?: number } = {}) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, text, tone: o.tone, icon: o.icon, ms: o.ms ?? 3200 }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), (o.ms ?? 3200) + 320);
  }, []);

  /* ── sheets ─────────────────────────────────────────────────────────────── */
  const closeSheet = React.useCallback((all = false) => {
    setSheets((s) => (all ? [] : s.slice(0, -1)));
  }, []);

  const openSheet = React.useCallback(async (
    act: string, v: string, replace = false, arg: string | null = null,
  ) => {
    setPending(true);
    try {
      /* A sheet that re-renders itself — the access editor with a filter typed
         into it, the import preview — carries what was typed back across. Only
         the single-valued controls; a sheet does not need a checkbox list to
         redraw itself. */
      const raw = collectFields(document.querySelector('.sheet:last-of-type'));
      const fields: Record<string, string> = {};
      for (const [k, val] of Object.entries(raw)) if (typeof val === 'string') fields[k] = val;
      const payload = await renderSheet(act, v, routeRef.current, fields, arg);
      if (!payload.ok) { toast(payload.error, { tone: 'bad' }); return; }
      const entry: SheetEntry = { ...payload, key: ++sheetSeq, act, v, arg };
      setSheets((s) => (replace && s.length ? [...s.slice(0, -1), entry] : [...s, entry]));
    } finally {
      setPending(false);
    }
  }, [toast]);

  /* Re-fetch the sheet that is open, after a command changed what it shows. */
  const refreshSheet = React.useCallback(async () => {
    const top = sheets[sheets.length - 1];
    if (!top) return;
    const payload = await renderSheet(top.act, top.v, routeRef.current, {}, top.arg ?? null);
    if (payload.ok) {
      setSheets((s) => (s.length
        ? [...s.slice(0, -1), { ...payload, key: top.key, act: top.act, v: top.v, arg: top.arg }]
        : s));
    }
  }, [sheets]);

  /* ── confirmation ───────────────────────────────────────────────────────── */
  const confirm = React.useCallback((o: Omit<Confirmer, 'resolve'>) =>
    new Promise<boolean>((resolve) => setConfirmer({ ...o, resolve })), []);
  /* Held in a ref so the dispatcher can ask without being rebuilt every time
     the confirmation state changes — which would make it ask itself. */
  const confirmRef = React.useRef(confirm);
  confirmRef.current = confirm;

  /* ── the dispatcher ─────────────────────────────────────────────────────── */
  const runCommand = React.useCallback(async (
    act: string, v: string, el?: HTMLElement | null, arg: string | null = null,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    if (el) el.dataset.pending = '1';
    try {
      const fields = collectFields(scopeOf(el));
      let res: DispatchResult = await dispatch(act, { v, fields, route: routeRef.current, arg });

      /* A command that wants to be asked first has done nothing yet. The
         question is its own — it knows what is about to happen — and a yes
         fires the same action again, now carrying the answer. */
      if (res.ok && res.confirm) {
        const said = await confirmRef.current({
          title: res.confirm.title,
          body: res.confirm.body,
          yes: res.confirm.yes,
          no: res.confirm.no ?? 'Cancel',
          danger: res.confirm.danger,
        });
        if (!said) return;
        res = await dispatch(act, {
          v,
          arg,
          fields: { ...fields, confirmed: '1' },
          route: routeRef.current,
        });
      }
      await applyResult(res, act);
    } catch {
      toast('That did not reach the server — check your connection', { tone: 'bad' });
    } finally {
      if (el) delete el.dataset.pending;
      busy.current = false;
      setPending(false);
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const applyResult = React.useCallback(async (res: DispatchResult, act: string) => {
    if (!res.ok) {
      toast(res.error, { tone: res.tone ?? 'bad', ms: 4600 });
      if (res.code === 'unauthenticated') router.push('/sign-in');
      return;
    }
    if (res.closeSheet === 'all') setSheets([]);
    else if (res.closeSheet) setSheets((s) => s.slice(0, -1));
    /* A file the command handed back. It has already checked who was asking and
       recorded the access, which is why the download comes through the result
       rather than from a link on the page. */
    if (res.download) save(res.download);
    if (res.toast) toast(res.toast, { tone: res.tone, icon: res.icon, ms: res.ms });
    if (res.go) router.push(res.go);
    else if (res.refresh !== false) router.refresh();
    if (res.openSheet) await openSheet(res.openSheet.act, res.openSheet.v ?? '', res.openSheet.replace);
    else if (!res.closeSheet && sheetsRef.current.length && res.refresh !== false) {
      /* The panel underneath re-reads the record it is showing, so a change made
         from a sheet is visible in that sheet rather than only behind it. */
      setTimeout(() => { void refreshSheet(); }, 0);
    }
  }, [openSheet, refreshSheet, router, toast]);

  const sheetsRef = React.useRef(sheets);
  sheetsRef.current = sheets;

  /* ── local behaviours ───────────────────────────────────────────────────── */
  const runLocal = React.useCallback((act: string, v: string, el?: HTMLElement | null) => {
    switch (act) {
      case 'sheet.close': closeSheet(); return;
      case 'sheet.closeAll': closeSheet(true); return;
      case 'confirm.yes': confirmer?.resolve(true); setConfirmer(null); return;
      case 'confirm.no': confirmer?.resolve(false); setConfirmer(null); return;
      case 'palette.open': if (!isPortal) setPaletteOpen(true); return;
      case 'palette.close': setPaletteOpen(false); return;
      case 'theme.cycle': cycleTheme(); return;
      case 'theme.set': setTheme(v as ThemeName); return;
      case 'job.jump': {
        el?.closest('.sheet')?.querySelector(`#jsec_${v}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      case 'drawer.tab':
      case 'drawer.full':
        /* The panel keeps its own tab in the URL of the sheet it re-requests. */
        void openSheet(sheetsRef.current[sheetsRef.current.length - 1]?.act ?? 'drawer.open',
          `${sheetsRef.current[sheetsRef.current.length - 1]?.v ?? ''}|${act === 'drawer.full' ? 'full' : v}`, true);
        return;
      case 'noop':
      default:
        return;
    }
  }, [closeSheet, confirmer, isPortal, openSheet]);

  /* ── the one entry point ────────────────────────────────────────────────── */
  const fire = React.useCallback((act: string, v = '', el?: HTMLElement | null) => {
    /* `jq.move:job_a:up` is one button, one action and one argument. The whole
       string is resolved first, so a name that happens to contain a colon still
       means itself. */
    const { name, arg } = splitAction(act);
    const kind = classify(name);
    if (kind === 'nav') {
      const url = NAV_ACTIONS[name](v, routeRef.current, arg);
      router.push(url, { scroll: false });
      return;
    }
    if (kind === 'sheet') { void openSheet(name, v, false, arg); return; }
    if (kind === 'local') { runLocal(name, v, el); return; }
    void runCommand(name, v, el, arg);
  }, [openSheet, router, runCommand, runLocal]);

  /* ── delegation ─────────────────────────────────────────────────────────── */
  React.useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
      if (!el) return;
      if (el.matches('select,input,textarea')) return;    // handled on change
      if (el.hasAttribute('disabled')) { ev.preventDefault(); return; }
      ev.preventDefault();
      fire(el.dataset.act!, el.dataset.v ?? '', el);
    };

    const onChange = (ev: Event) => {
      const t = ev.target as HTMLElement | null;
      /* A file input inside a dropzone is the upload path, not an action. */
      if (t?.matches('[data-dz] input[type=file]')) {
        const dz = t.closest<HTMLElement>('[data-dz]');
        const files = Array.from((t as HTMLInputElement).files ?? []);
        if (dz && files.length) void upload(dz.dataset.dz!, files);
        return;
      }
      const el = t?.closest<HTMLElement>('[data-act]');
      if (!el) return;
      if (!el.matches('select,input[type=checkbox],input[type=date],input[type=search],input[type=radio]')) return;
      const value = readValue(el);
      fire(el.dataset.act!, value, el);
    };

    /* A search box marked data-live filters as you type. The caret is kept
       where it was by data-keep, so a re-render does not interrupt typing. */
    let liveTimer: ReturnType<typeof setTimeout> | null = null;
    const onInput = (ev: Event) => {
      const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act][data-live]');
      if (!el) return;
      const value = readValue(el);
      if (liveTimer) clearTimeout(liveTimer);
      liveTimer = setTimeout(() => fire(el.dataset.act!, value, null), 260);
    };

    const onKey = (ev: KeyboardEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
      if (el && (ev.key === 'Enter' || ev.key === ' ') && el.matches('[role=button],[role=switch]')) {
        ev.preventDefault();
        fire(el.dataset.act!, el.dataset.v ?? '', el);
        return;
      }
      /* A focusable thing carrying an action is a button, whatever element it
         happens to be — an SVG group in a chart, most of the time. A real
         <button> gets Enter and Space from the browser; these have to be given
         them, or every chart is mouse-only. */
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        const el = document.activeElement as HTMLElement | null;
        if (el && el.dataset?.act && !/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
          ev.preventDefault();
          fireRef.current(el.dataset.act, el.dataset.v ?? '', el);
          return;
        }
      }
      if (ev.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (confirmer) { confirmer.resolve(false); setConfirmer(null); }
        else if (sheetsRef.current.length) closeSheet();
        return;
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target as HTMLElement)?.tagName ?? '');
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        if (isPortal) return;
        ev.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || isPortal) return;
      if (ev.key === '/') { ev.preventDefault(); setPaletteOpen(true); return; }
      /* `g` then a letter jumps, the way it always did. */
      const jump: Record<string, string> = {
        o: '/overview', j: '/jobs', c: '/candidates', s: '/scheduling',
        i: '/insights', t: '/team', ',': '/settings',
      };
      if (gPressed.current && jump[ev.key]) { gPressed.current = false; router.push(jump[ev.key]); return; }
      gPressed.current = ev.key === 'g';
    };

    /* ── Fetching the page before it is asked for ─────────────────────────

       Every route in this product is dynamic, so a click is a round trip: the
       server reads, renders, and sends the tree back before anything changes on
       screen. That is about a tenth of a second, which is quick — but it is a
       tenth of a second in which nothing happens, and that is what people call
       slow.

       Resting the pointer on something is a decision. Half of it, anyway: by
       the time somebody has held a nav item for a moment they have usually made
       up their mind. So that moment is spent fetching, and the click that
       follows has nothing left to wait for.

       It is deliberately not on every `go` in the page. A chart has dozens of
       marks, each pointing at a different filtered list, and sweeping a pointer
       across one must not fire forty requests. Sustained hover, one request per
       destination, and a cap. */
    const prefetched = new Set<string>();
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    const PREFETCH_LIMIT = 24;

    const worthPrefetching = (el: HTMLElement): string | null => {
      if (prefetched.size >= PREFETCH_LIMIT) return null;
      if (el.dataset.act !== 'go') return null;
      const to = el.dataset.v ?? '';
      if (!to.startsWith('/') || prefetched.has(to)) return null;
      return to;
    };

    const onIntent = (ev: Event) => {
      const el = (ev.target as Element | null)?.closest<HTMLElement>('[data-act="go"]');
      if (!el) return;
      const to = worthPrefetching(el);
      if (!to) return;
      if (hoverTimer) clearTimeout(hoverTimer);
      /* Long enough that crossing a list on the way somewhere else costs
         nothing, short enough to be ready before the click lands. */
      hoverTimer = setTimeout(() => {
        prefetched.add(to);
        try { router.prefetch(to); } catch { /* a route that cannot be prefetched is not an error */ }
      }, 90);
    };
    const onLeave = () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } };

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerover', onIntent, { passive: true });
    document.addEventListener('pointerout', onLeave, { passive: true });
    document.addEventListener('focusin', onIntent);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('change', onChange);
      document.removeEventListener('input', onInput);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('pointerout', onLeave);
      document.removeEventListener('focusin', onIntent);
      if (liveTimer) clearTimeout(liveTimer);
      if (hoverTimer) clearTimeout(hoverTimer);
    };
  }, [fire, closeSheet, confirmer, isPortal, paletteOpen, router]);

  const gPressed = React.useRef(false);
  /* The key handler is installed before `fire` is defined, and re-installing
     it on every render would drop keystrokes; a ref keeps it current. */
  const fireRef = React.useRef<(act: string, v?: string, el?: HTMLElement | null) => void>(() => {});

  /* ── uploads and drag-and-drop ──────────────────────────────────────────── */
  const upload = React.useCallback(async (spec: string, files: File[]) => {
    const { name: act, arg } = splitAction(spec);
    const fd = new FormData();
    /* A dropzone's context is written after the colon, and the commands that
       take one read it as the value — `emp.doc:emp_1:iban` is the employee and
       the document. It is sent as both, so a command may read whichever suits
       it. */
    fd.set('v', arg ?? '');
    fd.set('arg', arg ?? '');
    fd.set('route', JSON.stringify(routeRef.current));
    for (const f of files) fd.append('file', f);
    setPending(true);
    toast(files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} files…`, { icon: 'upload', ms: 2000 });
    try {
      const res = await dispatchUpload(act, fd);
      await applyResult(res, act);
    } catch {
      toast('The upload did not reach the server', { tone: 'bad' });
    } finally {
      setPending(false);
    }
  }, [applyResult, toast]);

  React.useEffect(() => {
    const over = (ev: DragEvent) => {
      const dz = (ev.target as HTMLElement | null)?.closest('.dz');
      if (!dz) return;
      ev.preventDefault();
      dz.classList.add('over');
    };
    const leave = (ev: DragEvent) => {
      (ev.target as HTMLElement | null)?.closest('.dz')?.classList.remove('over');
    };
    const drop = (ev: DragEvent) => {
      const dz = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.dz,[data-dz]');
      if (!dz) return;
      ev.preventDefault();
      dz.classList.remove('over');
      const files = Array.from(ev.dataTransfer?.files ?? []);
      if (files.length && dz.dataset.dz) void upload(dz.dataset.dz, files);
    };
    document.addEventListener('dragover', over);
    document.addEventListener('dragenter', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragenter', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
    };
  }, [upload]);

  /* ── the board's drag and drop ──────────────────────────────────────────── */
  React.useEffect(() => {
    let dragId: string | null = null;
    const start = (ev: DragEvent) => {
      const card = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.bcard[draggable]');
      if (!card) return;
      dragId = card.dataset.app ?? null;
      card.classList.add('drag');
      ev.dataTransfer?.setData('text/plain', dragId ?? '');
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    };
    const end = (ev: DragEvent) => {
      (ev.target as HTMLElement | null)?.closest('.bcard')?.classList.remove('drag');
      dragId = null;
    };
    const over = (ev: DragEvent) => {
      const col = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-drop]');
      if (!col) return;
      ev.preventDefault();
      col.closest('.bcol')?.classList.add('over');
    };
    const leave = (ev: DragEvent) => {
      (ev.target as HTMLElement | null)?.closest('[data-drop]')?.closest('.bcol')?.classList.remove('over');
    };
    const drop = (ev: DragEvent) => {
      const col = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-drop]');
      if (!col) return;
      ev.preventDefault();
      col.closest('.bcol')?.classList.remove('over');
      const id = ev.dataTransfer?.getData('text/plain') || dragId;
      const stage = col.dataset.drop;
      if (!id || !stage) return;
      /* The board never decides whether a move is allowed — it asks. */
      void runCommand('app.moveTo', `${id}|${stage}`, null);
    };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end);
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
    };
  }, [runCommand]);

  /* Body cannot scroll behind an open panel. */
  React.useEffect(() => {
    document.body.classList.toggle('locked', sheets.length > 0 || paletteOpen);
  }, [sheets.length, paletteOpen]);

  /* The tab strips that overflow show their arrows. */

  fireRef.current = fire;

  const ctx: Ctx = React.useMemo(
    () => ({ fire, toast, closeSheet, confirm, pending }),
    [fire, toast, closeSheet, confirm, pending],
  );

  return (
    <ActionCtx.Provider value={ctx}>
      {children}
      <SheetStack sheets={sheets} />
      {/* One tooltip serves every chart; a mark carries `data-tip` and this
          draws it. See components/charts/tooltip.tsx. */}
      <ChartTooltip />
      {confirmer && <ConfirmSheet c={confirmer} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} fire={fire} />}
      <div className="toasts" id="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span className="ic">
              <Icon name={(t.icon as IconName) ?? (t.tone === 'bad' ? 'alert' : 'check')} size={13} sw={2.4} />
            </span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ActionCtx.Provider>
  );
}

/* ── the panel stack ───────────────────────────────────────────────────────── */
function SheetStack({ sheets }: { sheets: SheetEntry[] }) {
  return (
    <div id="sheets">
      {sheets.map((s, i) => {
        if (!s.ok) return null;
        const last = i === sheets.length - 1;
        return (
          <React.Fragment key={s.key}>
            <div className={`scrim ${last ? 'in' : 'still'}`} data-act="sheet.close" />
            <aside
              className={`sheet${s.wide ? ' wide' : ''}${s.full ? ' full' : ''} ${last ? 'in' : 'still'}`}
              data-sheeti={i} role="dialog" aria-modal={last} aria-label={s.aria ?? String(s.title)}
            >
              <span className="grabber" />
              <header className="sheet-h">
                <div className="bd">
                  {s.eyebrow && <em>{s.eyebrow}</em>}
                  <h2>{s.title}</h2>
                  {s.sub && <p className="t-sub" style={{ marginTop: 4 }}>{s.sub}</p>}
                </div>
                <div className="act">
                  {s.actions}
                  <button className="btn icon ghost" data-act="sheet.close" aria-label="Close">
                    <Icon name="x" />
                  </button>
                </div>
              </header>
              <div className="sheet-b">{s.body}</div>
              {s.foot && <footer className="sheet-f">{s.foot}</footer>}
            </aside>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ConfirmSheet({ c }: { c: Confirmer }) {
  return (
    <div id="confirm-sheet">
      <div className="scrim in" data-act="confirm.no" />
      <aside className="sheet in" role="dialog" aria-modal="true" aria-label={c.title}>
        <span className="grabber" />
        <header className="sheet-h"><div className="bd"><h2>{c.title}</h2></div></header>
        <div className="sheet-b"><p className="lead">{c.body}</p></div>
        <footer className="sheet-f">
          <button className="btn ghost" data-act="confirm.no">{c.no}</button>
          <span className="sp" />
          <button className={`btn ${c.danger ? 'danger' : 'pri'}`} data-act="confirm.yes">{c.yes}</button>
        </footer>
      </aside>
    </div>
  );
}

/* ── the command palette ───────────────────────────────────────────────────── */
type PaletteHit = { type: string; id: string; title: string; sub: string };

function CommandPalette({ onClose, fire }: { onClose: () => void; fire: Ctx['fire'] }) {
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<PaletteHit[]>([]);
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const CMDS = React.useMemo(() => [
    { t: 'Go to Overview', ic: 'grid', run: () => fire('go', '/overview') },
    { t: 'Go to Jobs', ic: 'brief', run: () => fire('go', '/jobs') },
    { t: 'Go to Candidates', ic: 'users', run: () => fire('go', '/candidates') },
    { t: 'Go to Scheduling', ic: 'cal', run: () => fire('go', '/scheduling') },
    { t: 'Go to Offer stage', ic: 'file', run: () => fire('go', '/offers') },
    { t: 'Go to Onboarding', ic: 'handshake', run: () => fire('go', '/onboarding') },
    { t: 'Go to Manpower plan', ic: 'board', run: () => fire('go', '/manpower') },
    { t: 'Go to Insights', ic: 'chart', run: () => fire('go', '/insights') },
    { t: 'Go to TAT report', ic: 'clock', run: () => fire('go', '/insights?tab=tat') },
    { t: 'Go to Team', ic: 'badge', run: () => fire('go', '/team') },
    { t: 'Go to Settings', ic: 'gear', run: () => fire('go', '/settings') },
    { t: 'New requisition', ic: 'plus', run: () => fire('job.new') },
    { t: 'Add a candidate', ic: 'uplus', run: () => fire('cand.new') },
    { t: 'Add a recruiter', ic: 'badge', run: () => fire('staff.new') },
    { t: 'Switch theme', ic: 'sun', run: () => cycleTheme() },
    { t: 'Export all data as JSON', ic: 'dl', run: () => fire('data.export') },
  ], [fire]);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  React.useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setHits(await res.json());
      } catch { /* aborted, or offline — the commands still work */ }
    }, 160);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const cmds = CMDS.filter((c) => !q || c.t.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 5 : 13);
  const items = [
    ...hits.slice(0, 8).map((h) => ({
      grp: 'Records', t: h.title, sub: h.sub,
      ic: h.type === 'candidate' ? 'users' : h.type === 'job' ? 'brief' : 'badge',
      run: () => fire('go', h.type === 'candidate' ? `/candidates/${h.id}`
        : h.type === 'job' ? `/jobs/${h.id}` : `/team/${h.id}`),
    })),
    ...cmds.map((c) => ({ grp: 'Commands', ...c, sub: undefined as string | undefined })),
  ];

  const run = (i: number) => { const it = items[i]; onClose(); it?.run(); };

  let last: string | null = null;
  return (
    <div id="palette">
      <div className="scrim in" onClick={onClose} />
      <div className="cmdk" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef} id="pq" value={q} autoComplete="off" spellCheck={false}
          placeholder="Search candidates, jobs, people — or type a command"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { setSel((s) => Math.min(items.length - 1, s + 1)); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { setSel((s) => Math.max(0, s - 1)); e.preventDefault(); }
            else if (e.key === 'Enter') { run(sel); }
            else if (e.key === 'Escape') onClose();
          }}
        />
        <div className="res">
          {items.length === 0 ? (
            <div className="empty">
              <span className="ic"><Icon name="search" size={22} /></span>
              <b>Nothing matched</b><p className="t-sub">{q}</p>
            </div>
          ) : items.map((it, i) => {
            const head = it.grp !== last ? (last = it.grp, <div className="grp t-over" key={`g${i}`}>{it.grp}</div>) : null;
            return (
              <React.Fragment key={i}>
                {head}
                <button className={`it${i === sel ? ' on' : ''}`} onClick={() => run(i)} onMouseEnter={() => setSel(i)}>
                  <Icon name={(it.ic as IconName) ?? 'chev'} size={16} />
                  <span className="bd"><b>{it.t}</b>{it.sub && <span className="t-foot">{it.sub}</span>}</span>
                  <span className="chev"><Icon name="chev" size={14} /></span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

/** Where a command's fields come from: the open panel, else the whole view. */
function scopeOf(el: HTMLElement | null | undefined): ParentNode {
  return el?.closest('.sheet') ?? document.querySelector('.sheet:last-of-type') ?? document;
}

/**
 * Save what a command handed back. A `url` is a short-lived signed link to a
 * stored file; `text` is content the command produced. Either way the anchor is
 * created, clicked and thrown away rather than left on the page, because the
 * link expires and a stale one on screen is worse than no link.
 */
function save(d: { url?: string; text?: string; name: string; contentType?: string }): void {
  const a = document.createElement('a');
  let revoke: string | null = null;
  if (d.url) {
    a.href = d.url;
  } else {
    const blob = new Blob([d.text ?? ''], { type: d.contentType ?? 'text/plain;charset=utf-8' });
    revoke = URL.createObjectURL(blob);
    a.href = revoke;
  }
  a.download = d.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke!), 10_000);
}

/** Every named control inside a scope, the way a form post would collect it. */
function collectFields(scope: ParentNode | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!scope) return out;
  scope.querySelectorAll<HTMLElement>('[name]').forEach((el) => {
    const name = (el as HTMLInputElement).name;
    if (!name) return;
    const input = el as HTMLInputElement;
    if (input.type === 'checkbox') {
      if (!input.checked) { if (out[name] === undefined && !Array.isArray(out[name])) out[name] ??= ''; return; }
      const val = input.value === 'on' ? 'true' : input.value;
      const prev = out[name];
      if (prev === undefined || prev === '') out[name] = [val];
      else if (Array.isArray(prev)) prev.push(val);
      else out[name] = [prev, val];
      return;
    }
    if (input.type === 'radio') { if (input.checked) out[name] = input.value; return; }
    out[name] = input.value;
  });
  /* A checkbox group with nothing ticked is an empty list, not an absent field —
     which is how "untick every application question" reaches the server. */
  for (const [k, v] of Object.entries(out)) if (v === '') out[k] = [];
  return out;
}

function readValue(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  if (input.type === 'checkbox') return input.checked ? (input.value === 'on' ? 'true' : input.value) : '';
  return input.value ?? el.dataset.v ?? '';
}

type ThemeName = 'system' | 'light' | 'dark';

function currentTheme(): ThemeName {
  const m = document.cookie.match(/(?:^|; )bayut_ta_theme=([^;]*)/);
  return (m ? decodeURIComponent(m[1]) : 'system') as ThemeName;
}

function setTheme(t: ThemeName): void {
  document.cookie = `bayut_ta_theme=${t}; path=/; max-age=31536000; samesite=lax`;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  /* The theme control shows which one is on, so the shell re-renders. */
  window.dispatchEvent(new CustomEvent('bayut:theme', { detail: t }));
}

function cycleTheme(): void {
  const order: ThemeName[] = ['system', 'light', 'dark'];
  setTheme(order[(order.indexOf(currentTheme()) + 1) % 3]);
}

