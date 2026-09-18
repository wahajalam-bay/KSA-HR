import { NextResponse } from 'next/server';

/* The web manifest, served as a route so the icon paths and the brand colour
   come from one place rather than a JSON file that drifts from the CSS. The
   green is the artwork's own, rgb(50 176 102) — see components/ui/brand.tsx. */

export function GET(): NextResponse {
  return NextResponse.json(
    {
      name: 'Bayut KSA — Talent Acquisition',
      short_name: 'Bayut TA',
      description:
        'The Bayut KSA talent acquisition platform: manpower, requisitions, '
        + 'candidates, offers and onboarding.',
      start_url: '/overview',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#ffffff',
      theme_color: '#32b066',
      icons: [
        { src: '/icon.png', sizes: '64x64', type: 'image/png' },
        { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
        { src: '/brand/bayut-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/brand/bayut-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } },
  );
}
