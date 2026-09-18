'use client';

import { BrandLogo } from '@/components/ui/brand';
import './globals.css';

/* The last resort: something threw above every other boundary. It renders its
   own <html>, because at this point the layout is what failed.

   What it deliberately does not do is say what went wrong. The reason is in
   the server log against the digest below, which is the one thing worth
   showing — it is what the team searches on — and it is not the message, the
   stack, the query or the path. See docs/14-security-notes.md. */

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="boot" id="view">
          <BrandLogo variant="loading" alt="Bayut" />
          <h1 className="t-2" style={{ margin: 0 }}>Something went wrong</h1>
          <p className="t-sub">
            The page could not be drawn. Nothing you were doing has been saved or
            lost — every write in this product either completes or does not
            happen at all.
          </p>
          <span className="row tight">
            <button className="btn pri" type="button" onClick={() => reset()}>Try again</button>
            <a className="btn out" href="/overview">Back to the overview</a>
          </span>
          {error.digest && (
            <p className="t-foot">
              The team can find this one by <span className="mono">{error.digest}</span>.
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
