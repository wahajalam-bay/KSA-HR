import 'server-only';
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { accessLinks } from '@/db/schema';
import { env } from '@/lib/env';
import type { Ctx } from '@/lib/audit';

/* ═════════════════════════════════════════════════════════════════════════════
   LINKS A CANDIDATE OPENS WITHOUT SIGNING IN

   Six flows send one: the screening chat, "pick a time", the offer, the
   signature page, the behaviour assessment and the reference form. They are all
   the same object — a single-purpose, expiring, revocable key to one record —
   so they are issued, checked and revoked in one place.

   The token is returned once, at the moment it is minted, and never stored:
   only its SHA-256 goes to the database. Anybody holding a database dump still
   cannot open a candidate's offer.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Purpose = 'screening' | 'booking' | 'offer' | 'sign' | 'assessment' | 'reference';

const PATH: Record<Purpose, string> = {
  screening: 'screen',
  booking: 'book',
  offer: 'offer',
  sign: 'sign',
  assessment: 'assess',
  reference: 'reference',
};

/** Default lifetimes, in days. Short enough to matter, long enough to be used. */
const LIFE: Record<Purpose, number> = {
  screening: 14, booking: 14, offer: 30, sign: 30, assessment: 21, reference: 30,
};

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export type Minted = { id: string; token: string; url: string; expiresAt: Date };

export async function mintLink(
  input: {
    purpose: Purpose;
    subjectType: string;
    subjectId: string;
    candidateId?: string | null;
    applicationId?: string | null;
    days?: number;
    maxUses?: number | null;
    /** Retire any live link for the same subject and purpose first. */
    replace?: boolean;
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<Minted> {
  if (input.replace) {
    await ctx.tx.update(accessLinks).set({ revokedAt: ctx.now, revokedBy: ctx.viewer.staffId ?? null })
      .where(and(
        eq(accessLinks.purpose, input.purpose),
        eq(accessLinks.subjectType, input.subjectType),
        eq(accessLinks.subjectId, input.subjectId),
        sql`${accessLinks.revokedAt} IS NULL`,
      ));
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const id = `lnk_${crypto.randomUUID().slice(0, 12)}`;
  const expiresAt = new Date(ctx.now.getTime() + (input.days ?? LIFE[input.purpose]) * 86_400_000);

  await ctx.tx.insert(accessLinks).values({
    id,
    tokenHash: hash(token),
    purpose: input.purpose,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    candidateId: input.candidateId ?? null,
    applicationId: input.applicationId ?? null,
    expiresAt,
    maxUses: input.maxUses ?? null,
    createdBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
    createdAt: ctx.now,
  });

  return {
    id,
    token,
    url: `${env().APP_URL}/${PATH[input.purpose]}/${token}`,
    expiresAt,
  };
}

export type Opened =
  | { ok: true; linkId: string; subjectType: string; subjectId: string; candidateId: string | null; applicationId: string | null }
  | { ok: false; reason: 'unknown' | 'revoked' | 'expired' | 'spent' };

/**
 * Check a token and count the use. Every failure is reported the same way to
 * the caller, so probing cannot tell a wrong token from a revoked one.
 */
export async function openLink(
  token: string, purpose: Purpose, exec: Exec, now: Date, ip?: string | null,
): Promise<Opened> {
  const [row] = await exec.select().from(accessLinks)
    .where(and(eq(accessLinks.tokenHash, hash(token)), eq(accessLinks.purpose, purpose)))
    .limit(1);
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: 'expired' };
  if (row.maxUses !== null && row.uses >= row.maxUses) return { ok: false, reason: 'spent' };

  await exec.update(accessLinks).set({
    uses: row.uses + 1,
    firstUsedAt: row.firstUsedAt ?? now,
    lastUsedAt: now,
    lastUsedIp: ip ?? null,
  }).where(eq(accessLinks.id, row.id));

  return {
    ok: true,
    linkId: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    candidateId: row.candidateId,
    applicationId: row.applicationId,
  };
}

/** Pull a link back — the offer was revised, the screen was cancelled. */
export async function revokeLinks(
  input: { purpose: Purpose; subjectType: string; subjectId: string },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<number> {
  const done = await ctx.tx.update(accessLinks)
    .set({ revokedAt: ctx.now, revokedBy: ctx.viewer.staffId ?? null })
    .where(and(
      eq(accessLinks.purpose, input.purpose),
      eq(accessLinks.subjectType, input.subjectType),
      eq(accessLinks.subjectId, input.subjectId),
      sql`${accessLinks.revokedAt} IS NULL`,
    ))
    .returning({ id: accessLinks.id });
  return done.length;
}
