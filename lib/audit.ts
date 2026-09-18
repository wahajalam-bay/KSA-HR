import 'server-only';
import { db, type Exec } from '@/db/client';
import { auditEvents, domainEvents } from '@/db/schema';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   AUDIT, and the domain event log.

   Two different records, deliberately kept apart:

     audit_events   what a person did, in a sentence, with the before and the
                    after. Append-only, enforced by a trigger. This is what the
                    audit trail page prints and what an investigation reads.

     domain_events  what happened, as a fact the rest of the system reacts to.
                    The automation engine subscribes to these; nothing
                    subscribes to the audit trail.

   A command usually writes both: "Naif approved and published a requisition"
   for a person to read, and `requisition.approved` for the engine to act on.
   ═════════════════════════════════════════════════════════════════════════════*/

export type AuditAction = 'create' | 'update' | 'delete' | 'read' | 'action';

export type AuditInput = {
  action: AuditAction;
  /** The sentence the audit page prints: "approved and published a requisition". */
  summary: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  source?: 'ui' | 'api' | 'worker' | 'webhook' | 'seed' | 'cli';
};

export type Ctx = {
  viewer: Viewer;
  requestId: string;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
};

/* Fields that never reach the audit trail, whatever a caller passes. A diff is
   only useful if it is safe to keep for seven years. */
const REDACT = new Set([
  'password', 'passwordHash', 'password_hash', 'token', 'tokenHash', 'token_hash',
  'secret', 'apiKey', 'api_key', 'accessToken', 'refreshToken', 'privateKey',
  'iban', 'nationalId', 'national_id', 'dob', 'emergencyContact', 'emergency_contact',
]);

function redact(o: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!o) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = REDACT.has(k) ? '[redacted]' : v;
  }
  return out;
}

/* Only what actually changed. A diff of forty unchanged fields is noise, and
   noise is what stops anybody reading an audit trail. */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!before || !after) return null;
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const x = before[k], y = after[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    b[k] = x; a[k] = y;
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

export async function audit(ctx: Ctx, input: AuditInput, exec: Exec = db()): Promise<void> {
  const v = ctx.viewer;
  await exec.insert(auditEvents).values({
    actorId: v.staffId ?? v.accountId,
    actorName: v.name,
    actorRole: v.staffRole ?? v.role,
    actorAccountId: v.accountId,
    onBehalfOfId: v.actingAsStaffId,
    onBehalfOfName: null,
    action: input.action,
    summary: input.summary,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    before: redact(input.before),
    after: redact(input.after),
    reason: input.reason ?? null,
    source: input.source ?? 'ui',
    requestId: ctx.requestId,
    correlationId: ctx.correlationId ?? ctx.requestId,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    sessionId: v.sessionId,
  });
}

/* ── Domain events ──────────────────────────────────────────────────────────
   The facts the automation engine reacts to. `idempotencyKey` is what stops a
   retried command raising the same fact twice; the worker picks up anything
   with no dispatched_at. */
export type EventInput = {
  type: string;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function emit(ctx: Ctx | null, input: EventInput, exec: Exec = db()): Promise<void> {
  await exec.insert(domainEvents).values({
    type: input.type,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    payload: input.payload ?? {},
    actorId: ctx?.viewer.staffId ?? ctx?.viewer.accountId ?? null,
    actorName: ctx?.viewer.name ?? 'System',
    correlationId: ctx?.correlationId ?? ctx?.requestId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  }).onConflictDoNothing();
}

/** The catalogue, so a rule editor can offer the triggers that actually exist. */
export const EVENT_TYPES = [
  'candidate.created', 'candidate.updated', 'candidate.claimed', 'candidate.retention_due',
  'application.created', 'application.stage_changed', 'application.rejected',
  'application.withdrawn', 'application.hired',
  'requisition.created', 'requisition.submitted', 'requisition.approved',
  'requisition.rejected', 'requisition.published', 'requisition.archived', 'requisition.reopened',
  'seat.requested', 'seat.approved', 'seat.withdrawn', 'plan.imported',
  'screening.invited', 'screening.completed', 'screening.no_answer',
  'interview.scheduled', 'interview.rescheduled', 'interview.cancelled', 'interview.completed',
  /* How the interview was run, reviewed. Coaching for whoever ran it; nothing
     here reads back onto the candidate. */
  'interview.reviewed',
  'scorecard.requested', 'scorecard.submitted', 'scorecard.overdue',
  'assessment.invited', 'assessment.completed',
  'pitch.sent', 'pitch.completed',
  'offer.drafted', 'offer.submitted', 'offer.approved', 'offer.verified', 'offer.sent',
  'offer.viewed', 'offer.signed', 'offer.accepted', 'offer.declined', 'offer.revised',
  'employee.created', 'joining.confirmed', 'joiner_file.sent',
  'onboarding.document_uploaded', 'onboarding.document_verified', 'onboarding.completed',
  'reference.recorded',
  'probation.due', 'probation.overdue', 'probation.decided',
  'sla.warning', 'sla.breached',
  'message.queued', 'message.sent', 'message.delivered', 'message.failed',
  'message.not_configured', 'message.received',
  'schedule.daily', 'schedule.weekly',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
