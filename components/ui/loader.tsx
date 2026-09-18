import * as React from 'react';
import { BrandLogo } from '@/components/ui/brand';

/* ═════════════════════════════════════════════════════════════════════════════
   THE BAYUT LOADER

   A ring with the mark in the middle: a muted track, one green arc sweeping
   round it, and the brand sitting still at the centre. It is the loading state
   for a page, a panel or the shell — the places where something substantial is
   on its way and the product should say so in its own voice.

   It is deliberately not the loader for a button. A control that is waiting
   wants the smallest possible signal next to the thing it is waiting on, and
   putting a brand mark inside a 14-pixel button would be both illegible and
   silly. Those keep the plain spinner.

   The ring is an SVG circle with a dashed stroke rotating around its own
   centre, which costs one composited transform and nothing else — no layout,
   no paint, no JavaScript. Under `prefers-reduced-motion` the sweep stops and
   the ring breathes instead, so the state is still legible without movement.
   ═════════════════════════════════════════════════════════════════════════════*/

export type LoaderSize = 'sm' | 'md' | 'lg';

/* Drawn size, and how much of the ring the moving arc covers. A small ring
   needs a proportionally longer arc to read as motion at all. */
const RING: Record<LoaderSize, { px: number; stroke: number; arc: number }> = {
  sm: { px: 34, stroke: 3, arc: 0.3 },
  md: { px: 60, stroke: 4, arc: 0.26 },
  lg: { px: 96, stroke: 5, arc: 0.22 },
};

export function BrandLoader({
  size = 'md',
  label = 'Loading',
  className = '',
}: {
  size?: LoaderSize;
  /** What is being waited for, announced to a screen reader. */
  label?: string;
  className?: string;
}) {
  const { px, stroke, arc } = RING[size];
  /* The circle is drawn in a 100-unit box so the geometry is size-independent. */
  const r = 50 - stroke * (50 / px) * 2;
  const circumference = 2 * Math.PI * r;

  return (
    <span
      className={`bloader bloader-${size} ${className}`.trim()}
      style={{ width: px, height: px }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <svg className="bloader-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="track" cx="50" cy="50" r={r} strokeWidth={stroke * (100 / px)} />
        <circle
          className="sweep" cx="50" cy="50" r={r}
          strokeWidth={stroke * (100 / px)}
          strokeDasharray={`${circumference * arc} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <BrandLogo variant="compact" alt="" className="bloader-mark" height={Math.round(px * 0.34)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The loader with a line under it, for a whole panel or page that is waiting.
 * `tests/` harnesses wait for `.skel` to clear, so it carries that class and a
 * route caught mid-load is waited out rather than measured.
 */
export function LoadingPanel({ label = 'Loading', sub }: { label?: string; sub?: string }) {
  return (
    <div className="bloader-panel skel">
      <BrandLoader size="lg" label={label} />
      {sub && <p className="t-sub">{sub}</p>}
    </div>
  );
}
