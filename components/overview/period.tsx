'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icons';

/* ─────────────────────────────────────────────────────────────────────────────
   The period, as two calendar dates.

   Pick a day in one month and a day in another; the presets beside it stay as
   shortcuts and simply fill these two fields. Everything downstream takes the
   span and the exact days and does not care which of the two it was given.

   The presets are plain markup with a `data-act`, handled by the delegated
   dispatcher like every other filter. This half needs to read two inputs before
   it navigates, so it is a client component — and it renders the same markup
   the prototype did, because the strip has to line up to the pixel.
   ───────────────────────────────────────────────────────────────────────────*/

export function PeriodRange({ from, to, isRange, label, days, maxDay }: {
  from: string; to: string; isRange: boolean; label: string; days: number; maxDay: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [f, setF] = React.useState(from);
  const [t, setT] = React.useState(to);

  React.useEffect(() => { setF(from); setT(to); }, [from, to]);

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    router.push(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };

  const apply = () => {
    if (!f || !t) return;
    const span = Math.max(1, Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1);
    if (span > 1095) return;
    push({ from: f <= t ? f : t, to: f <= t ? t : f, win: null });
  };

  return (
    <span className={`ovrange${isRange ? ' on' : ''}`}>
      <span className="t-foot">Dates</span>
      <input className="inp sm" type="date" name="ovfrom" value={f} max={maxDay}
        onChange={(e) => setF(e.target.value)} aria-label="From" />
      <span className="t-foot">to</span>
      <input className="inp sm" type="date" name="ovto" value={t} max={maxDay}
        onChange={(e) => setT(e.target.value)} aria-label="To" />
      <button className={`btn sm ${isRange ? 'out' : 'pri'}`} type="button" onClick={apply}>
        <Icon name="cal" size={13} /> Apply
      </button>
      {isRange && (
        <>
          <span className="chip brand">{label} · {days} days</span>
          <button className="btn sm ghost" type="button" title="Back to the preset periods"
            onClick={() => push({ win: '90', from: null, to: null })}>
            Clear
          </button>
        </>
      )}
    </span>
  );
}
