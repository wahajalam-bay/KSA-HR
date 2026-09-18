import 'server-only';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';

/* ─────────────────────────────────────────────────────────────────────────────
   One clock per request.

   A page that asks the database what time it is in one query and JavaScript in
   the next can disagree with itself: the header says three interviews are still
   ahead and the list underneath shows two, because a minute passed between the
   two reads. So the request takes the time once and everything — the SQL, the
   ageing, the "3 days ago" — is measured against that same instant.

   It also makes the interface testable. The visual comparison drives production
   against captures taken from the prototype, whose clock is frozen; without a
   way to hold production's clock still, every window boundary drifts by however
   long the test took to start and the two can never agree exactly.

   That override is a development tool and is fenced as one: it needs
   ALLOW_TEST_CLOCK in the environment and refuses outright in production. It
   never touches authentication — a session's expiry is measured against the
   real clock in lib/auth/session.ts, so a cookie cannot extend a session.
   ───────────────────────────────────────────────────────────────────────────*/

export const CLOCK_COOKIE = 'bayut_ta_clock';

const overrideAllowed = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_TEST_CLOCK === '1';

/** The instant this request is measured against. */
export async function requestNow(): Promise<Date> {
  return (await clockOf()).at;
}

/**
 * The same instant, and whether it is the real one.
 *
 * The visual comparison needs to know: production refuses the override by
 * design, so a sweep run against `npm start` measures every window from the
 * real clock while the prototype captures are frozen — and reports the drift
 * as eleven visual regressions that are not regressions. The shell puts
 * `data-clock="held"` on the page when the override is in force, and the
 * harness refuses to run without it rather than producing a misleading number.
 */
export async function clockOf(): Promise<{ at: Date; held: boolean }> {
  if (!overrideAllowed()) return { at: new Date(), held: false };
  try {
    const v = (await cookies()).get(CLOCK_COOKIE)?.value;
    if (!v) return { at: new Date(), held: false };
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? { at: new Date(), held: false } : { at: d, held: true };
  } catch {
    return { at: new Date(), held: false };
  }
}

/** The same instant, for a SQL fragment — use this instead of `now()`. */
export const at = (now: Date) => sql`${now.toISOString()}::timestamptz`;
