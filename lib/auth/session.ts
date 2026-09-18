import 'server-only';
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, sessions, staff } from '@/db/schema';
import { env } from '@/lib/env';

/* ─────────────────────────────────────────────────────────────────────────────
   Sessions.

   The prototype kept "who you are" in a browser preference, which is fine for a
   click-through and is not a boundary. Here a session is a row: an opaque token
   the browser holds, only its SHA-256 in the database, an absolute expiry and an
   idle timeout, and a revoked_at that makes signing out and disabling an account
   immediate rather than eventual.

   The cookie is HttpOnly, SameSite=Lax (so a link from an e-mail still lands
   signed in) and Secure outside development.
   ───────────────────────────────────────────────────────────────────────────*/

export const COOKIE = 'bayut_ta_session';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export type Viewer = {
  accountId: string;
  sessionId: string;
  name: string;
  email: string;
  title: string | null;
  /** 'staff' | 'hiring_manager' | 'participant' */
  role: 'staff' | 'hiring_manager' | 'participant';
  /** The TA role when this is a team member: tal_lead | recruiter | … */
  staffRole: string | null;
  staffId: string | null;
  roleLabel: string;
  hue: number;
  photo: string | null;
  /** Access by position. */
  scope: { kind: 'all' | 'own' | 'jobs'; jobIds: string[]; own: boolean };
  /** True for a hiring manager or an interview participant — the portal. */
  isPortal: boolean;
  /** True for the Head of TA / Admin. */
  isAdmin: boolean;
  /** When an Admin is looking at the product as a colleague. */
  actingAsStaffId: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  staff: 'TA team', hiring_manager: 'Hiring manager', participant: 'Interview participant',
};
const STAFF_LABEL: Record<string, string> = {
  tal_lead: 'Admin', recruiter: 'Talent Partner', sourcer: 'Sourcer',
  coordinator: 'Recruitment Coordinator', onboarding: 'Onboarding Specialist',
};

export async function createSession(accountId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const e = env();
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + e.SESSION_TTL_HOURS * 3600_000);
  const [row] = await db().insert(sessions).values({
    accountId, tokenHash: sha(token), ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 400) ?? null, expiresAt: expires,
  }).returning({ id: sessions.id });

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: e.NODE_ENV === 'production',
    path: '/',
    expires,
  });
  return { sessionId: row.id, token, expiresAt: expires };
}

export async function destroySession(reason = 'signed out'): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await db().update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(eq(sessions.tokenHash, sha(token)));
  }
  jar.delete(COOKIE);
}

/* Revoke every session an account holds — what disabling or removing an account
   has to do to mean anything. */
export async function revokeAllSessions(accountId: string, reason: string): Promise<void> {
  await db().update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
}

/* Read the session, if there is a live one. Touches last_seen_at so the idle
   timeout is measured from activity rather than from sign-in — but only when it
   has actually moved on, so a page with twelve server components does not write
   twelve times. */
export async function currentViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const e = env();
  const rows = await db()
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      actingStaffId: sessions.actingStaffId,
      accountId: accounts.id,
      name: accounts.name,
      email: accounts.email,
      title: accounts.title,
      role: accounts.role,
      status: accounts.status,
      staffId: accounts.staffId,
      scopeKind: accounts.scopeKind,
      scopeJobIds: accounts.scopeJobIds,
      scopeOwn: accounts.scopeOwn,
      staffRole: staff.role,
      staffName: staff.name,
      staffTitle: staff.title,
      staffHue: staff.hue,
      staffPhoto: staff.photo,
      staffStatus: staff.status,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .leftJoin(staff, eq(staff.id, accounts.staffId))
    .where(and(
      eq(sessions.tokenHash, sha(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      isNull(accounts.removedAt),
    ))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  if (r.status === 'disabled') return null;
  if (r.staffId && r.staffStatus === 'deleted') return null;

  const idleMs = Date.now() - new Date(r.lastSeenAt).getTime();
  if (idleMs > e.SESSION_IDLE_MINUTES * 60_000) {
    await db().update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'idle timeout' })
      .where(eq(sessions.id, r.sessionId));
    return null;
  }
  if (idleMs > 60_000) {
    await db().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, r.sessionId));
  }

  const isStaff = r.role === 'staff';
  const isAdmin = isStaff && r.staffRole === 'tal_lead';

  return {
    accountId: r.accountId,
    sessionId: r.sessionId,
    name: r.staffName ?? r.name,
    email: r.email,
    title: r.staffTitle ?? r.title,
    role: r.role,
    staffRole: r.staffRole ?? null,
    staffId: r.staffId,
    roleLabel: isStaff ? (STAFF_LABEL[r.staffRole ?? ''] ?? 'TA team') : ROLE_LABEL[r.role],
    hue: r.staffHue ?? 3,
    photo: r.staffPhoto ?? (isStaff ? 'profile' : 'profile'),
    scope: {
      kind: (r.scopeKind ?? (isStaff ? 'all' : 'own')) as 'all' | 'own' | 'jobs',
      jobIds: r.scopeJobIds ?? [],
      own: r.scopeOwn !== false,
    },
    isPortal: r.role === 'hiring_manager' || r.role === 'participant',
    isAdmin,
    actingAsStaffId: r.actingStaffId,
  };
}

/** The viewer, or a thrown error. For anything that must not run signed out. */
export async function requireViewer(): Promise<Viewer> {
  const v = await currentViewer();
  if (!v) throw new AuthError('Sign in to continue');
  return v;
}

export class AuthError extends Error {
  readonly code = 'unauthenticated';
}
export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(message = 'Your access does not cover this') { super(message); }
}

/* The demo user switcher an Admin has in the profile menu. The session records
   who is really signed in, so the audit trail names both. */
export async function actAsStaff(sessionId: string, staffId: string | null): Promise<void> {
  await db().update(sessions).set({ actingStaffId: staffId }).where(eq(sessions.id, sessionId));
}

/* Request metadata, for the audit trail and the login-attempt ledger. */
export async function requestMeta(): Promise<{ ip: string; userAgent: string; requestId: string }> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return {
    ip: (fwd ? fwd.split(',')[0] : h.get('x-real-ip')) ?? '127.0.0.1',
    userAgent: h.get('user-agent') ?? '',
    requestId: h.get('x-request-id') ?? crypto.randomUUID(),
  };
}

/* Housekeeping: sessions that expired long ago are of no use to anybody. */
export async function purgeExpiredSessions(olderThanDays = 30): Promise<number> {
  const res = await db().execute(sql`
    DELETE FROM sessions
     WHERE expires_at < now() - (${olderThanDays} || ' days')::interval
        OR (revoked_at IS NOT NULL AND revoked_at < now() - (${olderThanDays} || ' days')::interval)`);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
