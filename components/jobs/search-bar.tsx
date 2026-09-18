'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icons';

/* ─────────────────────────────────────────────────────────────────────────────
   The search on Jobs takes a person as well as a requisition.

   A recruiter looking at this page usually knows a name and a rough date —
   "where did Mohammed apply, and when?" — so the box searches the requisitions
   and everybody who has applied to them, and the two dates narrow it to the
   applications that arrived between them. Both live in the URL, so a search can
   be reloaded, bookmarked or sent to a colleague.

   The text filters as you type; the dates wait for Apply, because a half-typed
   year is not a filter anybody meant.
   ───────────────────────────────────────────────────────────────────────────*/

export function ApplicationSearchBar({ q, from, to, placeholder }: {
  q: string; from: string; to: string; placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = React.useState(q);
  const [f, setF] = React.useState(from);
  const [t, setT] = React.useState(to);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => { setText(q); }, [q]);
  React.useEffect(() => { setF(from); setT(to); }, [from, to]);

  const push = React.useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    next.delete('page');
    router.push(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  }, [params, pathname, router]);

  const onText = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: value }), 280);
  };

  const apply = () => {
    if (!f && !t) { setError('Pick a date — one or both'); return; }
    if (f && t && f > t) { setError('The first date has to come first'); return; }
    setError(null);
    push({ from: f, to: t });
  };

  const on = !!(from || to);
  const max = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <input
        className="inp grow" value={text} onChange={(e) => onText(e.target.value)}
        placeholder={placeholder ?? 'Search requisitions, or an applicant by name…'}
        aria-label="Search"
      />
      <span className={`ovrange${on ? ' on' : ''}`}>
        <span className="t-foot">Applied</span>
        <input className="inp sm" type="date" value={f} max={max}
          onChange={(e) => { setF(e.target.value); setError(null); }} aria-label="Applied from" />
        <span className="t-foot">to</span>
        <input className="inp sm" type="date" value={t} max={max}
          onChange={(e) => { setT(e.target.value); setError(null); }} aria-label="Applied to" />
        <button className={`btn sm ${on ? 'out' : 'pri'}`} type="button" onClick={apply}>
          <Icon name="cal" size={13} /> Apply
        </button>
        {on && (
          <button className="btn sm ghost" type="button" title="Clear the dates"
            onClick={() => { setF(''); setT(''); push({ from: '', to: '' }); }}>
            Clear
          </button>
        )}
        {error && <span className="t-foot bad-t">{error}</span>}
      </span>
    </>
  );
}

