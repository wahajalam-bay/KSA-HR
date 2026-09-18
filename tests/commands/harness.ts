import { ZodError } from 'zod';
import { db, type Tx } from '@/db/client';
import { lookup, CommandError } from '@/lib/commands/registry';
import { require_ } from '@/lib/authz';
import { ForbiddenError } from '@/lib/auth/session';
import type { Viewer } from '@/lib/auth/session';
import type { CommandInput, CommandResult } from '@/lib/commands/registry';
import '@/lib/commands';   // registers every command

/* ═════════════════════════════════════════════════════════════════════════════
   RUNNING A COMMAND IN A TEST

   The dispatcher does five things before a command runs: establishes who is
   asking, refuses them if they may not, validates the input, opens a
   transaction, and turns a refusal into a sentence. A test that skipped any of
   those would be testing something the product does not do.

   So this harness does the same five, with two differences that make it a
   test rather than a request:

     · the viewer is constructed rather than read from a session cookie, which
       is how one test can be a recruiter and the next a hiring manager;
     · the transaction is rolled back at the end, so a suite can run against the
       real database, with the real constraints and the real triggers, without
       leaving anything behind.

   The rollback is the important part. An in-memory double would not have the
   append-only trigger on audit_events, the unique index that stops two people
   being hired into one seat, or the foreign key that refuses an orphan — and
   those are exactly the things worth testing.
   ═════════════════════════════════════════════════════════════════════════════*/

export type RunResult =
  | ({ ok: true } & CommandResult)
  | { ok: false; error: string; code: string };

export type Actor = Partial<Viewer> & { name: string };

/** A viewer with everything a command reads, from a few fields. */
export function viewer(a: Actor): Viewer {
  return {
    accountId: a.accountId ?? 'acc_test',
    sessionId: a.sessionId ?? 'ses_test',
    name: a.name,
    email: a.email ?? `${a.name.toLowerCase().replace(/[^a-z]+/g, '.')}@bayut.sa`,
    title: a.title ?? null,
    role: a.role ?? 'staff',
    staffRole: a.staffRole ?? 'recruiter',
    staffId: a.staffId ?? null,
    roleLabel: a.roleLabel ?? 'Recruiter',
    hue: a.hue ?? 1,
    photo: a.photo ?? null,
    scope: a.scope ?? { kind: 'all', jobIds: [], own: true },
    isPortal: a.isPortal ?? false,
    isAdmin: a.isAdmin ?? false,
    ...(a as object),
  } as Viewer;
}

export type RunOptions = {
  v?: string;
  fields?: Record<string, string | string[]>;
  route?: CommandInput['route'];
  now?: Date;
  /** What a button wrote after the colon in its action. See `splitAction`. */
  arg?: string | null;
  /** What a dropzone posted — the upload commands read these. */
  files?: File[];
  /** The transaction to run inside, when a test is chaining several commands. */
  tx?: Tx;
};

/** Run one command exactly as the dispatcher would, inside `tx`. */
export async function runIn(
  tx: Tx, name: string, who: Viewer, opts: RunOptions = {},
): Promise<RunResult> {
  const cmd = lookup(name);
  if (!cmd) return { ok: false, error: `no such command: ${name}`, code: 'unknown' };

  const raw: CommandInput = {
    v: opts.v ?? '',
    fields: opts.fields ?? {},
    files: opts.files ?? [],
    arg: opts.arg ?? null,
    route: opts.route ?? { view: 'jobs', id: null, sub: null, query: {} },
  };

  try {
    if (cmd.capability) require_(who, cmd.capability);
    const parsed = cmd.schema ? cmd.schema.parse(raw) : raw;
    const out = await cmd.run(parsed as never, {
      viewer: who,
      requestId: `test_${Math.random().toString(36).slice(2, 10)}`,
      correlationId: 'test',
      ip: '127.0.0.1',
      userAgent: 'tests/commands',
      tx,
      now: opts.now ?? new Date(),
    }, raw);
    return { ok: true, ...((out ?? {}) as CommandResult) };
  } catch (e: unknown) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message, code: 'forbidden' };
    if (e instanceof CommandError) return { ok: false, error: e.message, code: e.code };
    if (e instanceof ZodError) {
      const issue = e.issues[0];
      return { ok: false, error: issue?.message ?? 'invalid', code: 'invalid' };
    }
    throw e;
  }
}

/** A rolled-back transaction, so a suite leaves the database as it found it. */
export async function inRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ROLLBACK = Symbol('rollback');
  let value: T;
  try {
    await db().transaction(async (tx) => {
      value = await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return value!;
}

/** Run one command in its own rolled-back transaction. */
export async function run(name: string, who: Viewer, opts: RunOptions = {}): Promise<RunResult> {
  return inRollback((tx) => runIn(tx, name, who, opts));
}
