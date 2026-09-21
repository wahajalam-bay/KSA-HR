'use client';

import * as React from 'react';
import { fmt } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   Charts, hand-rolled in SVG.

   Form first, colour only where it carries meaning: one hue for magnitude
   across categories, the categorical ramp only for genuine categories, and
   never two value axes on one frame. Every mark is drawn as a sheet of cut
   paper — a contact shadow, a lit edge, a vertical sheen — because that is the
   language the rest of the interface speaks.

   The prototype measured each chart's box before drawing it, so a chart in a
   narrow card thinned its axis labels rather than overlapping them. That
   behaviour is kept: these are client components that render at a sensible
   width on the server and re-render at the real one once they are in the page.
   ───────────────────────────────────────────────────────────────────────────*/

/* The palette lives in lib/charts/palette.ts — a server component that draws a
   legend has to be able to read the colours, and a constant exported from a
   client module does not survive that crossing. */
export { AX, GR, TX, TX2, CAT, SEQ, RAMP } from '@/lib/charts/palette';
import { AX, GR, TX, TX2, CAT, SEQ, RAMP } from '@/lib/charts/palette';

export function nice(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (max <= p * m) return p * m;
  return p * 10;
}

export const ticks = (max: number, n = 4): number[] =>
  Array.from({ length: n + 1 }, (_, i) => (max / n) * i);

export const trunc = (s: unknown, n: number): string =>
  (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/* Ids have to be unique per chart because several share one document, and
   stable across a server render and its hydration or React complains. */
export function useChartId(prefix = 'nm'): string {
  const id = React.useId();
  return `${prefix}${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/* Every chart carries its own filters: a soft drop shadow so a mark reads as a
   layer lifted off the ground, a paler one for thin marks, and a vertical sheen
   that makes a flat fill read as lit paper. */
export function ChartDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".26" />
        <stop offset=".55" stopColor="#fff" stopOpacity=".04" />
        <stop offset="1" stopColor="#000" stopOpacity=".06" />
      </linearGradient>
      <filter id={id} x="-20%" y="-30%" width="140%" height="170%" colorInterpolationFilters="sRGB">
        <feDropShadow dx="3" dy="4" stdDeviation="3" floodColor="#103828" floodOpacity=".22" />
        <feDropShadow dx="-2" dy="-2" stdDeviation="2" floodColor="#ffffff" floodOpacity=".55" />
      </filter>
      <filter id={`${id}s`} x="-20%" y="-30%" width="140%" height="170%" colorInterpolationFilters="sRGB">
        <feDropShadow dx="2" dy="3" stdDeviation="2.2" floodColor="#103828" floodOpacity=".18" />
      </filter>
    </defs>
  );
}

/* The frame every SVG chart sits in. */
export function ChartFrame({
  w, h, className, children, role = 'img', label,
}: {
  w: number; h: number; className?: string; children: React.ReactNode; role?: string; label?: string;
}) {
  return (
    <div className="chart">
      <svg className={`cvs ${className ?? ''}`.trim()} viewBox={`0 0 ${w} ${h}`} width={w} height={h}
        style={{ width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet"
        role={role} aria-label={label}>
        {children}
      </svg>
    </div>
  );
}

/* Measure the box the chart is in, so the number of axis labels follows the
   space there actually is. The first render uses `initial`, which is what the
   server sends and what a visual baseline without JavaScript captures. */
/* A layout effect on the client, a plain one on the server.

   `useLayoutEffect` has no meaning during server rendering and React says so
   loudly, so the choice is made once, here, rather than with a suppression at
   each call site. */
const useMeasure = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/**
 * The width a chart has to draw into.
 *
 * A chart cannot know its width until it is in the page, so it is drawn once at
 * a guess and again at the truth. What matters is *when* the second draw
 * happens: after a plain effect the browser has already painted the guess, so
 * every chart on the page visibly resizes itself a frame after it appears — on
 * the Overview that is a dozen charts twitching at once, which reads as the
 * page struggling. Measuring in a layout effect puts the correction before the
 * paint, so there is one.
 */
export function useWidth(initial = 720): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [w, setW] = React.useState(initial);
  useMeasure(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.max(260, Math.round(el.clientWidth || el.parentElement?.clientWidth || initial));
      setW((prev) => (Math.abs(prev - next) > 2 ? next : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, w];
}

/* A smooth wave through points: Catmull-Rom converted to cubic Béziers, which
   is what makes the paper sheets read as cut curves rather than polylines. */
export function wavePath(points: Array<[number, number]>, dy = 0): string {
  if (points.length < 2) return '';
  const P = points.map(([px, py]) => [px, py + dy] as [number, number]);
  let d = `M ${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/* A chart's axis formatter is named rather than passed.

   A chart is a client component and the page that uses it is a server one, and
   a function cannot cross that boundary — React refuses it, correctly, because
   there is nothing to serialise. So the caller says which formatter it wants
   and the chart looks it up. It also means every axis in the product is
   formatted by one of a known set rather than by whatever a caller invented. */
export type FmtName = 'int' | 'dec' | 'dec1' | 'pct' | 'pct1' | 'pctWhole' | 'pctWhole1'
  | 'days' | 'sar' | 'sarK' | 'plain';
export type Fmt = (n: number) => string;

export const FORMATTERS: Record<FmtName, Fmt> = {
  int: (n) => fmt.int(n),
  dec: (n) => fmt.dec(n, 0),
  dec1: (n) => fmt.dec(n, 1),
  pct: (n) => fmt.pct(n),
  pct1: (n) => fmt.pct(n, 1),
  /* The value already is a percentage — a rate that was multiplied upstream so
     the axis could be drawn on a 0–100 scale. */
  pctWhole: (n) => `${Math.round(n)}%`,
  pctWhole1: (n) => `${fmt.dec(n, 1)}%`,
  days: (n) => fmt.days(n),
  sar: (n) => fmt.sar(n),
  sarK: (n) => fmt.sarK(n),
  plain: (n) => String(n),
};

export const formatter = (name?: FmtName): Fmt => FORMATTERS[name ?? 'int'];
