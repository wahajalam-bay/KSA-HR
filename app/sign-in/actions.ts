'use server';

import { redirect } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db/client';
import { accounts, auditEvents, loginAttempts, staff } from '@/db/schema';
import { hashPassword, verifyPassword, needsRehash, checkPasswordPolicy } from '@/lib/auth/password';
import { createSession, requestMeta } from '@/lib/auth/session';
import { env, providers } from '@/lib/env';
import { audit, emit } from '@/lib/audit';
import { log } from '@/lib/log';

/* ═════════════════════════════════════════════════════════════════════════════
   SIGNING IN

   Access is by invitation, exactly as the prototype described it: only people
   in the accounts list can get in — the TA team, and the hiring managers and
   interview participants who are named on a department, a requisition or an
   interview panel, or invited by hand under Settings → Access.

   What is different is where it is checked. The prototype compared a salted
   SHA-256 in the browser and said so. Here the password never leaves the
   server, the hash is scrypt, the comparison is constant-time, every attempt is
   recorded, and repeated failures lock the pair (e-mail, address) rather than
   the account — so an attacker cannot discover which addresses exist by
   watching which ones lock.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Step = 'email' | 'password' | 'set';

export type SignInState = {
  step: Step;
  email: string;
  error?: string;
  /** Shown once the address is known: who they are about to sign in as. */
  who?: { name: string; title: string; email: string; hue: number; photo: string | null };
};

const norm = (s: string) => s.trim().toLowerCase();

/* Brute-force protection. Counting by (email, ip) means a shared office address
   cannot lock a colleague out by getting their own password wrong, and a
   distributed attempt on one address still trips the per-address ceiling. */
async function tooManyFailures(email: string, ip: string): Promise<number | null> {
  const e = env();
  const since = new Date(Date.now() - e.LOGIN_LOCKOUT_MINUTES * 60_000);
  const rows = await db().execute<{ by_pair: string; by_email: string }>(sql`
    SELECT
      count(*) FILTER (WHERE ip = ${ip}) AS by_pair,
      count(*) AS by_email
      FROM login_attempts
     WHERE lower(email) = ${norm(email)} AND succeeded = false AND at > ${since}`);
  const r = (rows as any).rows?.[0] ?? (rows as any)[0] ?? {};
  const pair = Number(r.by_pair ?? 0);
  const all = Number(r.by_email ?? 0);
  if (pair >= e.LOGIN_MAX_ATTEMPTS || all >= e.LOGIN_MAX_ATTEMPTS * 3) return e.LOGIN_LOCKOUT_MINUTES;
  return null;
}

async function record(email: string, ip: string, succeeded: boolean, reason?: string) {
  await db().insert(loginAttempts).values({ email: norm(email), ip, succeeded, reason: reason ?? null });
}

/* Step one: is this address allowed in, and has it been here before? */
export async function checkEmail(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get('email') ?? '');
  const meta = await requestMeta();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return { step: 'email', email, error: 'Enter your work e-mail address.' };
  }

  const locked = await tooManyFailures(email, meta.ip);
  if (locked) {
    return { step: 'email', email, error: `Too many attempts. Try again in ${locked} minutes.` };
  }

  const [a] = await db()
    .select({
      id: accounts.id, name: accounts.name, title: accounts.title, email: accounts.email,
      role: accounts.role, status: accounts.status, hasPassword: sql<boolean>`${accounts.passwordHash} IS NOT NULL`,
      staffTitle: staff.title, staffHue: staff.hue, staffPhoto: staff.photo, staffName: staff.name,
    })
    .from(accounts).leftJoin(staff, eq(staff.id, accounts.staffId))
    .where(and(eq(accounts.email, norm(email)), sql`${accounts.removedAt} IS NULL`))
    .limit(1);

  if (!a) {
    await record(email, meta.ip, false, 'no such account');
    return {
      step: 'email', email,
      error: 'This e-mail has not been added to the system. Ask the Talent Acquisition team to add you '
        + 'as a hiring manager or an interview participant.',
    };
  }
  if (a.status === 'disabled') {
    await record(email, meta.ip, false, 'disabled');
    return { step: 'email', email, error: 'This account has been disabled. Ask the Talent Acquisition team.' };
  }

  const who = {
    name: a.staffName ?? a.name,
    title: a.staffTitle ?? a.title ?? roleLabel(a.role),
    email: a.email,
    hue: a.staffHue ?? 3,
    photo: a.staffPhoto ?? 'profile',
  };
  return { step: a.hasPassword ? 'password' : 'set', email: a.email, who };
}

/* Step two: the password. */
export async function signIn(prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get('email') ?? prev.email);
  const password = String(form.get('password') ?? '');
  const meta = await requestMeta();

  const locked = await tooManyFailures(email, meta.ip);
  if (locked) {
    return { ...prev, email, error: `Too many attempts. Try again in ${locked} minutes.` };
  }

  const [a] = await db().select().from(accounts)
    .where(and(eq(accounts.email, norm(email)), sql`${accounts.removedAt} IS NULL`)).limit(1);

  /* Verify even when there is no account, so a missing address and a wrong
     password take the same time and cannot be told apart by measuring. */
  const ok = await verifyPassword(password, a?.passwordHash ?? await dummyHash());

  if (!a || !ok || a.status === 'disabled') {
    await record(email, meta.ip, false, !a ? 'no such account' : 'wrong password');
    if (a) {
      await db().update(accounts)
        .set({ failedAttempts: sql`${accounts.failedAttempts} + 1` })
        .where(eq(accounts.id, a.id));
    }
    return { ...prev, email, error: 'That password is not right.' };
  }

  await record(email, meta.ip, true);
  /* A hash made with weaker parameters is quietly upgraded on a good password —
     the one moment we hold the plaintext. */
  const patch: Record<string, unknown> = {
    failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip, status: 'active',
  };
  if (needsRehash(a.passwordHash)) patch.passwordHash = await hashPassword(password);
  await db().update(accounts).set(patch).where(eq(accounts.id, a.id));

  await createSession(a.id, { ip: meta.ip, userAgent: meta.userAgent });
  log.info('auth.signin', { accountId: a.id, role: a.role });

  await db().insert(auditEvents).values({
    actorId: a.staffId ?? a.id, actorName: a.name, actorRole: a.role, actorAccountId: a.id,
    action: 'action', summary: 'signed in', entityType: 'account', entityId: a.id,
    source: 'ui', requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent.slice(0, 400),
  });

  /* Straight into the product. A hiring manager or a participant lands on
     their own hiring; the desk lands on the overview. */
  redirect(a.role === 'staff' ? '/overview' : '/my');
}

/* Step two, for somebody who has never been here: choose a password. */
export async function setPassword(prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get('email') ?? prev.email);
  const pw = String(form.get('password') ?? '');
  const pw2 = String(form.get('password2') ?? '');
  const meta = await requestMeta();
  const e = env();

  const [a] = await db().select().from(accounts)
    .where(and(eq(accounts.email, norm(email)), sql`${accounts.removedAt} IS NULL`)).limit(1);
  if (!a) return { step: 'email', email, error: 'Start again with your work e-mail address.' };
  if (a.passwordHash) return { step: 'password', email: a.email, who: prev.who, error: 'You already have a password — sign in with it.' };

  if (pw !== pw2) return { ...prev, step: 'set', email, error: 'The two passwords do not match.' };
  const policy = checkPasswordPolicy(pw, { email: a.email, name: a.name }, e.PASSWORD_MIN_LENGTH);
  if (!policy.ok) return { ...prev, step: 'set', email, error: policy.reason };

  await db().update(accounts).set({
    passwordHash: await hashPassword(pw),
    passwordSetAt: new Date(),
    status: 'active',
    failedAttempts: 0,
    lastLoginAt: new Date(),
    lastLoginIp: meta.ip,
  }).where(eq(accounts.id, a.id));

  await record(email, meta.ip, true, 'first password');
  await createSession(a.id, { ip: meta.ip, userAgent: meta.userAgent });

  await db().insert(auditEvents).values({
    actorId: a.staffId ?? a.id, actorName: a.name, actorRole: a.role, actorAccountId: a.id,
    action: 'action', summary: 'set a password and signed in for the first time',
    entityType: 'account', entityId: a.id, source: 'ui', requestId: meta.requestId, ip: meta.ip,
  });

  redirect(a.role === 'staff' ? '/overview' : '/my');
}

/* A real scrypt hash of a value nobody knows, computed once, so the "no such
   account" path does the same work as the wrong-password one. A hand-written
   constant would be rejected by the decoder and return early, which is exactly
   the timing difference this exists to remove. */
let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword(crypto.randomUUID() + crypto.randomUUID());
  return dummy;
}

function roleLabel(role: string): string {
  return role === 'hiring_manager' ? 'Hiring manager'
    : role === 'participant' ? 'Interview participant' : 'TA team';
}

/** Whether single sign-on is available, so the page can offer it or say why not. */
export async function ssoStatus(): Promise<{ available: boolean; reason?: string }> {
  const p = providers().oidc;
  if (p.configured) return { available: true };
  return {
    available: false,
    reason: env().AUTH_MODE === 'password'
      ? 'Single sign-on is switched off for this deployment.'
      : `Single sign-on is not configured — ${p.missing.join(', ')} ${p.missing.length === 1 ? 'is' : 'are'} not set.`,
  };
}
