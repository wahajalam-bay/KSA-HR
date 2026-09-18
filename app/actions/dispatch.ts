'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { db } from '@/db/client';
import { requireViewer, requestMeta, AuthError, ForbiddenError } from '@/lib/auth/session';
import { require_ } from '@/lib/authz';
import { lookup, CommandError, ConflictError, type CommandInput, type CommandResult } from '@/lib/commands/registry';
import { log } from '@/lib/log';
import '@/lib/commands';   // registers every command

/* ═════════════════════════════════════════════════════════════════════════════
   THE ONE DOOR

   Every write in the product comes through here. Which means there is exactly
   one place that:

     · establishes who is asking,
     · refuses them if they may not,
     · validates what they sent,
     · opens a transaction,
     · runs the command,
     · and turns a refusal into a sentence rather than a stack trace.

   A command that forgets to check a permission cannot exist, because it never
   gets to choose.
   ═════════════════════════════════════════════════════════════════════════════*/

export type DispatchResult =
  | ({ ok: true } & CommandResult)
  | { ok: false; error: string; code: string; tone: 'bad' | 'warn' };

export async function dispatch(
  name: string,
  input: Omit<CommandInput, 'files'>,
  formData?: FormData,
): Promise<DispatchResult> {
  /* eslint-disable no-param-reassign */
  const started = Date.now();
  const meta = await requestMeta();

  try {
    const viewer = await requireViewer();
    /* The whole name first, then whatever comes before the colon — the client
       sends both halves, and a command named with a colon would win over a
       command of the same base. See `splitAction` in lib/nav.ts. */
    let cmd = lookup(name);
    if (!cmd && name.includes(':')) {
      const base = name.slice(0, name.indexOf(':'));
      cmd = lookup(base);
      if (cmd) {
        input = { ...input, arg: input.arg ?? name.slice(name.indexOf(':') + 1) };
        name = base;
      }
    }
    if (!cmd) {
      log.warn('dispatch.unknown', { name, actor: viewer.name });
      return { ok: false, error: `That action is not available (${name})`, code: 'unknown', tone: 'bad' };
    }

    if (cmd.capability) require_(viewer, cmd.capability);

    const files = formData ? formData.getAll('file').filter((f): f is File => f instanceof File) : [];
    const raw: CommandInput = { arg: null, ...input, files };

    let parsed: unknown = raw;
    if (cmd.schema) {
      try {
        parsed = cmd.schema.parse(raw);
      } catch (e) {
        if (e instanceof ZodError) {
          /* The first problem, in the field's own words — a list of eleven
             validation messages is a form nobody fixes. */
          const issue = e.issues[0];
          const where = issue.path.filter((p) => p !== 'fields').join(' ');
          return {
            ok: false,
            error: where ? `${where}: ${issue.message}` : issue.message,
            code: 'invalid',
            tone: 'bad',
          };
        }
        throw e;
      }
    }

    const ctx = {
      viewer,
      requestId: meta.requestId,
      correlationId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      now: new Date(),
    };

    const result = cmd.noTransaction
      ? await cmd.run(parsed as never, { ...ctx, tx: db() as never }, raw)
      : await db().transaction(async (tx) => cmd.run(parsed as never, { ...ctx, tx }, raw));

    const out = (result ?? {}) as CommandResult;
    if (out.refresh !== false) revalidatePath('/', 'layout');

    log.info('dispatch.ok', {
      command: name, actor: viewer.name, ms: Date.now() - started, requestId: meta.requestId,
    });
    return { ok: true, ...out };
  } catch (e) {
    return toResult(name, e, meta.requestId, started);
  }
}

/* Uploads arrive as FormData, so they get their own entry point rather than
   being squeezed through a JSON one. */
export async function dispatchUpload(name: string, formData: FormData): Promise<DispatchResult> {
  const v = String(formData.get('v') ?? '');
  const route = JSON.parse(String(formData.get('route') ?? '{}'));
  const fields: Record<string, string | string[]> = {};
  for (const [k, val] of formData.entries()) {
    if (k === 'file' || k === 'route') continue;
    if (typeof val !== 'string') continue;
    const existing = fields[k];
    if (existing === undefined) fields[k] = val;
    else if (Array.isArray(existing)) existing.push(val);
    else fields[k] = [existing, val];
  }
  return dispatch(name, {
    v, fields, route, arg: (formData.get('arg') as string | null) || null,
  }, formData);
}

function toResult(name: string, e: unknown, requestId: string, started: number): DispatchResult {
  if (e instanceof AuthError) {
    return { ok: false, error: 'Your session has ended — sign in again', code: 'unauthenticated', tone: 'warn' };
  }
  if (e instanceof ForbiddenError) {
    return { ok: false, error: e.message, code: 'forbidden', tone: 'bad' };
  }
  if (e instanceof ConflictError || e instanceof CommandError) {
    return { ok: false, error: e.message, code: e.code, tone: e.tone };
  }

  /* A database constraint is a business rule that the code let through. Say what
     the rule is, not what PostgreSQL called it. */
  const pg = e as { code?: string; constraint?: string; detail?: string; message?: string };
  const friendly = CONSTRAINT_MESSAGES[pg.constraint ?? ''];
  if (friendly) {
    log.warn('dispatch.constraint', { command: name, constraint: pg.constraint, requestId });
    return { ok: false, error: friendly, code: 'constraint', tone: 'bad' };
  }
  if (pg.code === '23505') {
    return { ok: false, error: 'That already exists', code: 'duplicate', tone: 'bad' };
  }
  if (pg.code === '23503') {
    return { ok: false, error: 'Something this depends on is missing — reload and try again', code: 'fk', tone: 'warn' };
  }
  if (pg.code === '40001' || pg.code === '40P01') {
    return { ok: false, error: 'Two people saved at the same moment — try again', code: 'serialisation', tone: 'warn' };
  }
  if (pg.code === '2F004' || pg.code === '23P01' || pg.code === '0A000') {
    return { ok: false, error: pg.message ?? 'That is not allowed', code: 'restricted', tone: 'bad' };
  }

  log.error('dispatch.failed', {
    command: name, requestId, ms: Date.now() - started,
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
  });
  return {
    ok: false,
    error: `That did not work. The team can find it by ${requestId.slice(0, 8)}.`,
    code: 'server',
    tone: 'bad',
  };
}

/* Constraints whose violation is a business rule worth saying out loud. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  applications_live_uq: 'That person already has a live application on this requisition',
  employees_application_uq: 'An employee record already exists for this application',
  employees_offer_uq: 'An employee record already exists for this offer',
  offers_app_version_uq: 'That offer version already exists — reload and try again',
  jobs_band_ck: 'The top of the band cannot sit below the bottom of it',
  jobs_openings_ck: 'A requisition needs at least one opening',
  job_stages_sla_ck: 'A stage SLA has to be between 1 and 60 days',
  job_skills_level_ck: 'A skill level has to be between 1 and 5',
  evaluation_criteria_score_ck: 'A criterion is scored 1 to 5',
  interviews_duration_ck: 'An interview runs between 5 minutes and 8 hours',
  offers_money_ck: 'The basic has to be above zero, and the allowances cannot be negative',
  job_hiring_managers_lead_uq: 'A requisition has exactly one lead hiring manager',
  approvals_open_uq: 'That record already has an approval chain open',
  approval_steps_ord_uq: 'The approval steps are out of order — reload and try again',
  reviews_reviewer_uq: 'You have already reviewed this candidate — your review was updated',
  tasks_dedupe_uq: 'That task is already open',
  notifications_dedupe_uq: 'That notification has already gone out',
  job_queue_dedupe_uq: 'That job is already queued',
  messages_idem_uq: 'That message has already been sent',
  offer_templates_default_uq: 'There is already a fallback default template',
  offer_templates_family_uq: 'That job family already has a default template',
  candidate_resumes_current_uq: 'That candidate already has a current résumé',
  positions_code_uq: 'That position code is already in use',
  accounts_email_uq: 'That e-mail address can already sign in',
  staff_email_uq: 'That e-mail address is already on the team',
};
