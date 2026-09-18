/* ─────────────────────────────────────────────────────────────────────────────
   The recruiter tag.

   Two recruiters ringing the same person on the same morning is the oldest
   failure on a shared desk. A recruiter puts their name on a candidate, the tag
   rides along on every row, card and profile, and anybody else who reaches out
   has to say out loud that they are going over it.

   A tag lapses on its own so nobody sits on a name forever, and the recruiter
   chooses how long when they set it — a week for somebody they are calling this
   afternoon, a quarter for a passive candidate they are nurturing. The length
   is stored with the tag, so changing the default never silently expires or
   extends a tag somebody already placed.
   ───────────────────────────────────────────────────────────────────────────*/

export const CLAIM_DEFAULT_DAYS = 30;
export const CLAIM_DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

/** When a tag placed at `at` for `days` runs out. */
export const claimEndsAt = (at: Date | string, days: number | null | undefined): Date =>
  new Date(new Date(at).getTime() + (days ?? CLAIM_DEFAULT_DAYS) * 86_400_000);

/** Whether a tag is still in force. An expired tag counts as released. */
export const claimIsLive = (
  at: Date | string | null | undefined, days: number | null | undefined, now: Date,
): boolean => !!at && claimEndsAt(at, days).getTime() > now.getTime();

/** Whole days left on a tag; zero or less once it has lapsed. */
export const claimDaysLeft = (
  at: Date | string, days: number | null | undefined, now: Date,
): number => Math.ceil((claimEndsAt(at, days).getTime() - now.getTime()) / 86_400_000);

/** The length a sheet asked for, kept inside what the product offers. */
export function readClaimDays(raw: unknown): number {
  const n = Math.round(Number(raw));
  return (CLAIM_DAY_OPTIONS as readonly number[]).includes(n) ? n : CLAIM_DEFAULT_DAYS;
}
