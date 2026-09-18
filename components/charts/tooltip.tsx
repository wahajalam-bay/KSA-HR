'use client';

import * as React from 'react';
import type { Tip } from '@/lib/charts/interaction';

/* ═════════════════════════════════════════════════════════════════════════════
   THE CHART TOOLTIP

   One of these is mounted by the shell and it serves every chart in the
   product. It works the way the rest of the interface works — one delegated
   listener over an attribute — so a chart does not import it, wire it or know
   it exists. A mark carries `data-tip` and this draws it.

   Delegation is what makes that affordable. Forty charts with a tooltip
   component each would be forty subscriptions, forty pieces of positioning
   code and forty chances to get the viewport edge wrong; this is one.

   It opens on pointer and on keyboard focus, because a chart that only
   explains itself to a mouse explains itself to about half the people using
   it. It closes on leave, on blur, on Escape and on scroll — a tooltip still
   pointing at a mark that has moved is worse than none.
   ═════════════════════════════════════════════════════════════════════════════*/

type At = { tip: Tip; x: number; y: number; place: 'top' | 'bottom' | 'left' | 'right' };

/* Room to leave between the mark and the tooltip, and between the tooltip and
   the edge of the window. */
const NIB = 10;
const EDGE = 8;

function read(el: Element): Tip | null {
  const raw = (el as HTMLElement).dataset?.tip;
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Tip;
    return t && typeof t.label === 'string' ? t : null;
  } catch {
    return null;
  }
}

export function ChartTooltip() {
  const [at, setAt] = React.useState<At | null>(null);
  const box = React.useRef<HTMLDivElement | null>(null);

  /* Where it goes is decided after it has been measured, so a long tooltip
     near an edge flips to the side that has room rather than being clipped. */
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el || !at) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = at.x;
    let y = at.y;

    if (at.place === 'top' || at.place === 'bottom') {
      x = Math.min(Math.max(EDGE + r.width / 2, x), vw - EDGE - r.width / 2);
      if (at.place === 'top' && y - r.height - NIB < EDGE) {
        el.dataset.place = 'bottom';
      }
    } else {
      y = Math.min(Math.max(EDGE + r.height / 2, y), vh - EDGE - r.height / 2);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [at]);

  React.useEffect(() => {
    /* The mark under a point, and where a tooltip beside it should sit. */
    const show = (el: Element) => {
      const tip = read(el);
      if (!tip) return;
      const r = el.getBoundingClientRect();
      /* Above the mark by default; beside it when the mark is tall and thin,
         which is what a horizontal bar or a rail segment is. */
      const tall = r.height > r.width * 1.6;
      const place = tall
        ? (r.right + 240 < window.innerWidth ? 'right' : 'left')
        : (r.top > 120 ? 'top' : 'bottom');
      const x = place === 'right' ? r.right + NIB
        : place === 'left' ? r.left - NIB
          : r.left + r.width / 2;
      const y = place === 'top' ? r.top - NIB
        : place === 'bottom' ? r.bottom + NIB
          : r.top + r.height / 2;
      setAt({ tip, x, y, place });
    };

    const hide = () => setAt(null);

    const over = (ev: Event) => {
      const el = (ev.target as Element | null)?.closest?.('[data-tip]');
      if (el) show(el);
      else if (at) hide();
    };
    const out = (ev: PointerEvent) => {
      const from = (ev.target as Element | null)?.closest?.('[data-tip]');
      if (!from) return;
      const to = (ev.relatedTarget as Element | null)?.closest?.('[data-tip]');
      if (to !== from) hide();
    };
    const focus = (ev: FocusEvent) => {
      const el = (ev.target as Element | null)?.closest?.('[data-tip]');
      if (el) show(el);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') hide(); };

    document.addEventListener('pointerover', over, { passive: true });
    document.addEventListener('pointerout', out as EventListener, { passive: true });
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', key);
    /* A tooltip anchored to a mark that has scrolled away points at nothing. */
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('resize', hide, { passive: true });

    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out as EventListener);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', hide);
    };
  }, [at]);

  if (!at) return null;
  const { tip } = at;

  return (
    <div ref={box} className="ctip" data-place={at.place} role="tooltip" aria-hidden="true">
      <b className="ctip-l">{tip.label}</b>
      {tip.value && <span className="ctip-v">{tip.value}</span>}
      {!!tip.rows?.length && (
        <dl className="ctip-rows">
          {tip.rows.map(([k, v], i) => (
            <React.Fragment key={i}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
          ))}
        </dl>
      )}
      {tip.note && <p className="ctip-note">{tip.note}</p>}
      {tip.action && <p className="ctip-act">{tip.action}</p>}
    </div>
  );
}
