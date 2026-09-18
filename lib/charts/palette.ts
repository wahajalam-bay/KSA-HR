/* ─────────────────────────────────────────────────────────────────────────────
   The chart palette.

   Three ramps, and the rule about which to use: one hue for magnitude across
   categories, the categorical ramp only for genuine categories, and the wave
   ramp for the layered sheets.

   They live here rather than beside the charts because the charts are client
   components and a page that draws a legend beside one is usually a server
   component. A constant exported from a `'use client'` module reaches the
   server as a reference rather than as its value, which is a very quiet way for
   every swatch in the product to come out blank — so the colours are kept in a
   module both sides can import for real.
   ───────────────────────────────────────────────────────────────────────────*/

export const AX = 'var(--axis)';
export const GR = 'var(--grid)';
export const TX = 'var(--fg-3)';
export const TX2 = 'var(--fg-2)';

/** Genuine categories — at most four, or the eye stops distinguishing them. */
export const CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)'];

/** One hue, four steps: magnitude, not category. */
export const SEQ = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'];

/** The layered sheets, and every pie and legend that goes with them. */
export const RAMP = [
  'var(--wave-1)', 'var(--wave-2)', 'var(--wave-3)', 'var(--wave-4)', 'var(--wave-5)',
];
