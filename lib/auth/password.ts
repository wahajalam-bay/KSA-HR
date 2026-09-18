import crypto from 'node:crypto';
import { promisify } from 'node:util';

/* ─────────────────────────────────────────────────────────────────────────────
   Password hashing.

   The prototype stored a salted SHA-256 and checked it in the browser, which it
   was honest about being a gate rather than a boundary. Here it is scrypt with
   a per-password salt, checked on the server, compared in constant time, and
   encoded so the parameters travel with the hash — raising the cost later does
   not invalidate the passwords already set.
   ───────────────────────────────────────────────────────────────────────────*/

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, options: crypto.ScryptOptions,
) => Promise<Buffer>;

/* N=2^15 is ~64 MB of memory per hash and about 100 ms on a server core — slow
   enough to matter to an attacker with the table, fast enough for a sign-in. */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!encoded) return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N, r, p, maxmem: PARAMS.maxmem,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* True when the stored hash was made with weaker parameters than we use now, so
   a successful sign-in can quietly upgrade it. */
export function needsRehash(encoded: string | null): boolean {
  if (!encoded) return true;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < PARAMS.N;
}

/* ── Password policy ─────────────────────────────────────────────────────────
   Length first, because length is what actually helps; then a check against the
   handful of passwords every list starts with, and against the person's own
   name and e-mail, which is what people reach for when a rule forces a change. */
const COMMON = new Set([
  'password', 'password1', 'password123', 'qwertyuiop', '123456789', '1234567890',
  'letmein123', 'welcome123', 'admin12345', 'changeme123', 'bayut12345', 'bayut2026',
  'iloveyou123', 'sunshine123', 'princess123', 'football123', 'monkey12345',
]);

export type PolicyResult = { ok: true } | { ok: false; reason: string };

export function checkPasswordPolicy(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
  minLength = 12,
): PolicyResult {
  const p = password.normalize('NFKC');
  if (p.length < minLength) return { ok: false, reason: `Use at least ${minLength} characters.` };
  if (p.length > 200) return { ok: false, reason: 'That is longer than 200 characters.' };
  if (p.trim().length !== p.length) return { ok: false, reason: 'Do not start or end with a space.' };
  const low = p.toLowerCase();
  if (COMMON.has(low)) return { ok: false, reason: 'That password is on every attacker\'s first list.' };
  if (/^(.)\1+$/.test(p)) return { ok: false, reason: 'One repeated character is not a password.' };

  const local = (context.email ?? '').split('@')[0]?.toLowerCase();
  if (local && local.length > 2 && low.includes(local)) {
    return { ok: false, reason: 'Do not put your e-mail address in your password.' };
  }
  for (const part of (context.name ?? '').toLowerCase().split(/\s+/)) {
    if (part.length > 3 && low.includes(part)) {
      return { ok: false, reason: 'Do not put your own name in your password.' };
    }
  }
  return { ok: true };
}
