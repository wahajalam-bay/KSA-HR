'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/icons';
import { fmt } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   THE TAB STRIP

   A client component for one reason: it has to know whether it overflows, and
   that is a measurement of the rendered box rather than anything the server
   can work out. The strip used to be a server component whose overflow classes
   were written onto it afterwards by the shell's own DOM code — which React 19
   reports as a hydration mismatch on every page whose strip is wide enough to
   scroll. Settings has twelve tabs, so it was every Settings page, for every
   role.

   Now React owns the state. A ResizeObserver watches the strip and its
   contents, the scroll handler is React's, and the classes come out of the
   render — so there is nothing for the server and the client to disagree
   about.
   ───────────────────────────────────────────────────────────────────────────*/

export type SubnavTab = { v: string; t: string; n?: number | string | null };

export function Subnav({ tabs, active, action }: {
  tabs: SubnavTab[]; active: string; action: string;
}) {
  const strip = React.useRef<HTMLElement | null>(null);
  const [edge, setEdge] = React.useState<{ l: boolean; r: boolean }>({ l: false, r: false });

  const measure = React.useCallback(() => {
    const n = strip.current;
    if (!n) return;
    const more = n.scrollWidth > n.clientWidth + 4;
    setEdge({
      l: more && n.scrollLeft > 4,
      r: more && n.scrollLeft + n.clientWidth < n.scrollWidth - 4,
    });
  }, []);

  React.useEffect(() => {
    const n = strip.current;
    if (!n) return;

    /* Bring the current tab into view when the strip is wider than its box —
       landing on a page whose tab is off-screen is landing nowhere. */
    const on = n.querySelector<HTMLElement>('button.on');
    if (on && n.scrollWidth > n.clientWidth + 4) {
      const x = on.offsetLeft - (n.clientWidth - on.offsetWidth) / 2;
      if (x > 0) n.scrollLeft = x;
    }
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(n);
    for (const child of Array.from(n.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, tabs.length, active]);

  const nudge = (dir: -1 | 1) => {
    const n = strip.current;
    if (!n) return;
    n.scrollBy({ left: dir * Math.max(120, n.clientWidth * 0.6), behavior: 'smooth' });
  };

  return (
    <div className={`snav-wrap${edge.l ? ' has-l' : ''}${edge.r ? ' has-r' : ''}`}>
      <nav className="subnav" ref={strip} onScroll={measure}>
        {tabs.map((x) => (
          <button key={x.v} className={x.v === active ? 'on' : ''} data-act={action} data-v={x.v}
            aria-current={x.v === active ? 'page' : undefined}>
            {x.t}
            {x.n != null && <b>{typeof x.n === 'number' ? fmt.int(x.n) : x.n}</b>}
          </button>
        ))}
      </nav>
      <button className="snav-arrow l" type="button" onClick={() => nudge(-1)}
        aria-label="Scroll tabs left" tabIndex={-1}>
        <Icon name="chevL" size={14} />
      </button>
      <button className="snav-arrow r" type="button" onClick={() => nudge(1)}
        aria-label="More tabs" tabIndex={-1}>
        <Icon name="chev" size={14} />
      </button>
    </div>
  );
}

/* The sheet harness walks a tree by calling each component it meets. This one
   uses hooks, which do not exist in the `react-server` runtime the harness
   runs in — and the framework does not call it there either, it serialises a
   reference and the browser renders it. The flag says so, the same way
   `Btn.isControl` marks a control, so the walk stops here and records the
   element rather than throwing. */
Subnav.isClient = true;
