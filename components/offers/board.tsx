'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icons';

/* The two dates the candidate's question has to fall between. One date on its
   own reads as "from" or "up to", which is what people actually type. */
export function QuestionRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [f, setF] = React.useState(from);
  const [t, setT] = React.useState(to);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { setF(from); setT(to); }, [from, to]);

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    router.push(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };

  const apply = () => {
    if (!f && !t) { setError('Pick a date — one or both'); return; }
    if (f && t && f > t) { setError('The first date has to come first'); return; }
    setError(null);
    push({ qf: f, qt: t });
  };

  const on = !!(from || to);
  return (
    <span className={`ovrange${on ? ' on' : ''}`}>
      <span className="t-foot">Question asked</span>
      <input className="inp sm" type="date" name="qfrom" value={f}
        onChange={(e) => { setF(e.target.value); setError(null); }} aria-label="Questions asked from" />
      <span className="t-foot">to</span>
      <input className="inp sm" type="date" name="qto" value={t}
        onChange={(e) => { setT(e.target.value); setError(null); }} aria-label="Questions asked to" />
      <button className={`btn sm ${on ? 'out' : 'pri'}`} type="button" onClick={apply}>
        <Icon name="cal" size={13} /> Apply
      </button>
      {on && (
        <button className="btn sm ghost" type="button" onClick={() => { setF(''); setT(''); push({ qf: '', qt: '' }); }}>
          Clear
        </button>
      )}
      {error && <span className="t-foot bad-t">{error}</span>}
    </span>
  );
}
