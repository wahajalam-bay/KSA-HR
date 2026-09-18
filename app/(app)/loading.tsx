import { BrandLoader } from '@/components/ui/loader';

/* The boot screen, shown while a page behind the shell is still coming back.
   The loader and nothing else: the point of it is to be the cheapest thing the
   application can draw, and a word underneath only competes with it.

   The `skel` class is deliberate — every harness in tests/ already waits for
   `.skel` to disappear before it measures anything, so a route caught
   mid-load is waited out rather than photographed. */

export default function Loading() {
  return (
    <main className="view boot skel" id="view" aria-busy="true">
      <BrandLoader size="lg" label="Loading" />
    </main>
  );
}
