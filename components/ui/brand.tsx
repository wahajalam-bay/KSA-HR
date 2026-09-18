import * as React from 'react';

/* ═════════════════════════════════════════════════════════════════════════════
   THE BAYUT BRAND

   One place that knows where the artwork lives and how it is allowed to be
   used. Every surface that shows the brand — the sidebar, the sign-in card,
   the boot screen, the overview chip, the error pages — renders `<BrandLogo>`,
   so replacing the logo is replacing the files in `public/brand/` and nothing
   else.

   The artwork is the supplied `bayut-source.jpg`, kept verbatim beside its
   derivatives. The derivatives are that file's own pixels: the alpha is how
   far each pixel lifts off the card's green, and the two colourways are the
   artwork's own white ink and the card's own green, rgb(50 176 102). Nothing
   is redrawn and nothing is recoloured at runtime — no `filter`, no `invert`,
   no mask tinting — because a logo that the interface tints is a logo that
   goes wrong the first time a theme changes.

   That is also why each colourway is a real file rather than one file bent to
   fit: the sidebar chip is always brand green so it always carries the white
   ink, and the sign-in card is cream in one theme and forest in the other, so
   it carries the green ink in the first and the white in the second. The pair
   is swapped by CSS, which is in app/styles/02-extra.css under `.brand`.

   Aspect ratio is never the caller's to choose. Each variant sets a height and
   the intrinsic width follows from the file's own proportions, so the mark
   cannot be stretched by a layout that changes around it.
   ═════════════════════════════════════════════════════════════════════════════*/

const ART = {
  /* the wordmark with its mark — 630 × 170 */
  wordmark: { white: '/brand/bayut-wordmark-white.png', green: '/brand/bayut-wordmark-green.png', w: 630, h: 170 },
  /* the magnifier and its house, on its own — 161 × 127 */
  mark: { white: '/brand/bayut-mark-white.png', green: '/brand/bayut-mark-green.png', w: 161, h: 127 },
} as const;

export type BrandVariant =
  /** The full lockup, for a sidebar at its normal width. */
  | 'full'
  /** The mark alone, for a collapsed sidebar or anywhere narrow. */
  | 'compact'
  /** The full lockup at the size the sign-in card uses. */
  | 'login'
  /** The full lockup at the size the boot screen uses. */
  | 'loading'
  /** The mark and a small lockup inline, for the overview's brand chip. */
  | 'chip';

/* Each variant's drawn height. The width follows the artwork's own ratio, so
   nothing here can distort it. */
const HEIGHT: Record<BrandVariant, number> = {
  full: 26,
  compact: 21,
  login: 38,
  loading: 44,
  chip: 19,
};

const USES_MARK: Record<BrandVariant, boolean> = {
  full: false, compact: true, login: false, loading: false, chip: true,
};

/**
 * The Bayut logo.
 *
 * `variant` picks the artwork and the size; both colourways are rendered and
 * CSS shows the one that suits the ground, which is how the same component
 * works on the green chip and on the cream card.
 *
 * `on` says what it is sitting on. `brand` means a brand-green ground, so the
 * white ink always wins and no swapping happens — the sidebar chip and the app
 * icon. `surface` is a page or a card, where the theme decides.
 */
export function BrandLogo({
  variant = 'full',
  on = 'surface',
  alt = 'Bayut',
  className = '',
  height,
}: {
  variant?: BrandVariant;
  on?: 'brand' | 'surface';
  /** Empty for a decorative instance sitting beside the name in text. */
  alt?: string;
  className?: string;
  /** Overrides the variant's height; the width still follows the artwork. */
  height?: number;
}) {
  const art = USES_MARK[variant] ? ART.mark : ART.wordmark;
  const h = height ?? HEIGHT[variant];
  const w = Math.round((art.w / art.h) * h);

  /* On a brand-green ground there is nothing to decide: the ink is white. */
  if (on === 'brand') {
    return (
      <img
        className={`brand-art ${className}`.trim()}
        src={art.white} alt={alt} width={w} height={h}
        draggable={false} decoding="async"
      />
    );
  }

  /* On a page or a card, both are rendered and CSS shows one. They are the
     same artwork at the same size, so nothing moves when they swap. */
  return (
    <span className={`brand brand-${variant} ${className}`.trim()} style={{ width: w, height: h }}>
      <img className="brand-art on-light" src={art.green} alt={alt} width={w} height={h}
        draggable={false} decoding="async" />
      <img className="brand-art on-dark" src={art.white} alt="" width={w} height={h}
        draggable={false} decoding="async" aria-hidden="true" />
    </span>
  );
}
