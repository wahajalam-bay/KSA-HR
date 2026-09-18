import * as React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   The cut-paper landscape the whole interface floats on.

   Layered waves — forest at the back through mint and sage to cream at the
   front — as two fixed-height bands at the top and bottom of the window, so the
   centre stays quiet behind the content and the depth does not grow with a tall
   screen and swallow the page.

   Each sheet is lit as paper: a contact shadow and a wide ambient one beneath
   it, a gradient brightening the face towards its cut edge, and a bright line
   along that edge. Those three cues together are what read as layered paper
   rather than flat colour.
   ───────────────────────────────────────────────────────────────────────────*/

const W = 1600;

type Pt = [number, number];

function wave(P: Pt[]): string {
  let d = `M ${P[0][0]} ${P[0][1]}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? p2;
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ` +
         `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function Filters({ id }: { id: string }) {
  return (
    <defs>
      <filter id={id} x="-10%" y="-40%" width="120%" height="200%" colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#0B2A20" floodOpacity=".32" />
        <feDropShadow dx="0" dy="16" stdDeviation="18" floodColor="#0B2A20" floodOpacity=".22" />
      </filter>
      <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset=".72" stopColor="#fff" stopOpacity=".04" />
        <stop offset="1" stopColor="#fff" stopOpacity=".30" />
      </linearGradient>
      <linearGradient id={`${id}gb`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".30" />
        <stop offset=".3" stopColor="#fff" stopOpacity=".04" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

function Sheet({ pts, fill, filter, grad, closeY, edgeAtTop }: {
  pts: Pt[]; fill: string; filter: string; grad: string; closeY: number; edgeAtTop: boolean;
}) {
  const path = wave(pts);
  const d = edgeAtTop ? `${path} L ${W} 0 L 0 0 Z` : `${path} L ${W} ${closeY} L 0 ${closeY} Z`;
  return (
    <>
      <path d={d} fill={fill} filter={`url(#${filter})`} />
      <path d={d} fill={`url(#${grad})`} />
      <path d={path} fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="2" />
    </>
  );
}

const TOP: Array<[Pt[], string]> = [
  [[[0, 330], [180, 250], [330, 130], [600, 95], [900, 70], [1150, 90], [1380, 190], [1600, 240]], 'var(--wave-1)'],
  [[[0, 270], [200, 190], [360, 95], [640, 65], [940, 45], [1200, 60], [1420, 150], [1600, 190]], 'var(--wave-2)'],
  [[[0, 200], [220, 130], [400, 62], [700, 40], [1000, 25], [1260, 35], [1470, 110], [1600, 140]], 'var(--wave-3)'],
  [[[0, 140], [240, 80], [440, 36], [760, 20], [1060, 10], [1320, 18], [1510, 75], [1600, 95]], 'var(--wave-4)'],
  [[[0, 85], [260, 40], [480, 14], [820, 4], [1120, 0], [1380, 6], [1540, 45], [1600, 55]], 'var(--wave-5)'],
];

const BOTTOM: Array<[Pt[], string]> = [
  [[[0, 200], [300, 160], [600, 220], [900, 120], [1200, 180], [1600, 60]], 'var(--wave-5)'],
  [[[0, 250], [320, 200], [640, 260], [960, 160], [1280, 210], [1600, 110]], 'var(--wave-4)'],
  [[[400, 260], [700, 240], [1000, 200], [1300, 240], [1600, 160]], 'var(--wave-3)'],
  [[[800, 260], [1100, 250], [1400, 220], [1600, 210]], 'var(--wave-2)'],
  [[[1150, 260], [1400, 255], [1600, 245]], 'var(--wave-1)'],
];

export function BackgroundArt() {
  return (
    <div className="bgart" aria-hidden="true">
      <svg className="grain" xmlns="http://www.w3.org/2000/svg">
        <filter id="bggrain">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.2" />
        </filter>
        <rect width="100%" height="100%" filter="url(#bggrain)" />
      </svg>
      <svg className="bg-top" viewBox={`0 0 ${W} 340`} preserveAspectRatio="none">
        <Filters id="bgt" />
        {TOP.map(([pts, fill], i) => (
          <Sheet key={i} pts={pts} fill={fill} filter="bgt" grad="bgtg" closeY={0} edgeAtTop />
        ))}
      </svg>
      <svg className="bg-bottom" viewBox={`0 0 ${W} 260`} preserveAspectRatio="none">
        <Filters id="bgb" />
        {BOTTOM.map(([pts, fill], i) => (
          <Sheet key={i} pts={pts} fill={fill} filter="bgb" grad="bgbgb" closeY={260} edgeAtTop={false} />
        ))}
      </svg>
    </div>
  );
}
