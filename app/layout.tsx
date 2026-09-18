import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';

/* Self-hosted rather than fetched from Google at run time: a page showing
   candidate data should not tell a third party it was opened, and the font
   arrives with the document instead of after it. */
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-manrope',
});

export const metadata: Metadata = {
  title: 'Bayut KSA — Talent Acquisition',
  description: 'The Bayut KSA talent acquisition platform: manpower, requisitions, candidates, offers and onboarding.',
  robots: { index: false, follow: false },
  /* Next serves app/icon.png and app/apple-icon.png by convention; naming
     them here as well would point at files that do not exist. */
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Bayut KSA — Talent Acquisition',
    description: 'Manpower, requisitions, candidates, offers and onboarding.',
    images: ['/brand/bayut-source.jpg'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F4F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1A16' },
  ],
};

/* The theme is a preference on the account, but it has to be on <html> before
   the first paint or the page flashes light and then goes dark. This is the one
   piece of script that runs ahead of React; it reads the cookie the theme
   control writes and does nothing else. */
const THEME_BOOTSTRAP = `(function(){try{
  var m=document.cookie.match(/(?:^|; )bayut_ta_theme=([^;]*)/);
  var t=m?decodeURIComponent(m[1]):'system';
  if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <a className="skip-link" href="#view">Skip to the content</a>
        {children}
      </body>
    </html>
  );
}
