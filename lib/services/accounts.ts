import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { accounts, staff } from '@/db/schema';
import { audit, type Ctx } from '@/lib/audit';

/* ═════════════════════════════════════════════════════════════════════════════
   ACCOUNTS PROVISIONED BY THE WORK

   Nobody sits down to invite an interview panel. They book an interview, and
   the four people on it need to be able to sign in and file a scorecard. So
   the account is a side effect of the work, created quietly, in the invited
   state, with a password nobody has set yet.

   Two rules keep it honest:
     · the TA team signs in as staff, so a name that matches a staff e-mail
       never gets a second, portal-shaped account;
     · an account that was removed comes back invited rather than duplicated,
       because the e-mail is unique and a second row would simply fail.
   ═════════════════════════════════════════════════════════════════════════════*/

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

/** first.last@bayut.sa — the convention the company actually uses. */
export const emailOf = (name: string): string =>
  `${norm(name).replace(/[^a-z ]/g, '').trim().split(/\s+/).join('.')}@bayut.sa`;

export type EnsureInput = {
  name: string;
  email?: string | null;
  title?: string | null;
  role?: 'hiring_manager' | 'participant' | 'staff';
  source?: string | null;
};

export type Ensured = {
  accountId: string;
  email: string;
  /** True only when this call is what created it. */
  invited: boolean;
};

/**
 * Make sure this person can sign in. Returns null when they already sign in as
 * a member of the TA team, which is not a failure — it is the answer.
 */
export async function ensureAccount(
  input: EnsureInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<Ensured | null> {
  const name = input.name.trim();
  const email = norm(input.email || emailOf(name));
  if (!name || !email.includes('@')) return null;

  const [have] = await ctx.tx.select().from(accounts)
    .where(sql`lower(${accounts.email}) = ${email}`).limit(1);
  if (have) {
    if (have.removedAt) {
      await ctx.tx.update(accounts).set({
        removedAt: null, status: 'invited', updatedAt: ctx.now,
      }).where(eq(accounts.id, have.id));
    }
    return { accountId: have.id, email: have.email, invited: false };
  }

  /* The TA team already has a way in. */
  const [onStaff] = await ctx.tx.select({ id: staff.id }).from(staff)
    .where(sql`lower(${staff.email}) = ${email}`).limit(1);
  if (onStaff) return null;

  const accountId = `acc_${crypto.randomUUID().slice(0, 12)}`;
  const role = input.role ?? 'hiring_manager';
  await ctx.tx.insert(accounts).values({
    id: accountId,
    kind: 'person',
    name,
    title: input.title ?? null,
    email,
    role,
    status: 'invited',
    source: input.source ?? 'Added in the system',
    invitedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
    invitedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  await audit(ctx, {
    action: 'create',
    summary: `invited ${role === 'participant' ? 'an interview participant' : 'a hiring manager'} to sign in`,
    entityType: 'account', entityId: accountId, entityLabel: `${name} <${email}>`,
    after: { name, email, role, source: input.source ?? null },
  }, ctx.tx);

  return { accountId, email, invited: true };
}
