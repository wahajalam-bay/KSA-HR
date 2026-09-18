'use client';

import * as React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   The colour swatches on the branding panel.

   These are the only values in the product that have to be read from the
   browser rather than from the database: they are the computed value of a
   custom property on the root element, which depends on the stylesheet and on
   the theme currently showing. Printing them from the server would mean
   keeping a second copy of the palette in TypeScript, and a second copy is a
   copy that goes stale.

   Until the first paint the swatch shows the property name, so the card has
   its full height from the start and nothing jumps when the values arrive.
   ───────────────────────────────────────────────────────────────────────────*/

export function Swatches({ names }: { names: string[] }) {
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const n of names) next[n] = (cs.getPropertyValue(n) || '').trim();
      setValues(next);
    };
    read();
    /* The theme is a class on <html>; re-read when it changes so the swatch
       never shows the light value over a dark card. */
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', read);
    return () => { obs.disconnect(); media.removeEventListener('change', read); };
  }, [names]);

  return (
    <div className="brandswatch">
      {names.map((n) => {
        const v = values[n];
        return (
          <div key={n} title={`${n}: ${v || 'not set'}`}>
            <i style={{ background: `var(${n})` }} />
            <span>{n}</span>
            <code>{v || '—'}</code>
          </div>
        );
      })}
    </div>
  );
}
