import Link from 'next/link';
import { BrandLogo } from '@/components/ui/brand';
import './globals.css';

/* A record or an address that is not there. It stands outside the shell —
   whatever was asked for does not exist, so there is no navigation to draw
   around it — and it carries the brand so the page still looks like the
   product rather than like a server. */

export default function NotFound() {
  return (
    <main className="boot" id="view">
      <BrandLogo variant="loading" alt="Bayut" />
      <h1 className="t-2" style={{ margin: 0 }}>That page is not here</h1>
      <p className="t-sub">
        The address may have changed, or the record it pointed at may have been
        closed. Everything else is where you left it.
      </p>
      <Link className="btn out" href="/overview">Back to the overview</Link>
    </main>
  );
}
