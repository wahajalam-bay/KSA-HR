import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  webhookEvents, messages, offers, offerSignatures, screenings, screeningTurns,
  assessments, employees,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { verifierFor } from '@/lib/providers';
import { recordSignature } from '@/lib/services/offers';
import { recordResult, TRAITS } from '@/lib/services/assessments';
import { recordAnswer, complete } from '@/lib/services/screening';

/* ═════════════════════════════════════════════════════════════════════════════
   WHAT THE PROVIDERS TELL US

   Every callback is stored before it is believed, and believed only if it is
   signed. Three rules:

     · store first. Whatever happens next, the raw payload and its headers are
       on the record, so "the provider says they sent it" can be checked;
     · verify second. An unsigned callback is stored with signatureValid false
       and never acted on. "The offer was signed" is exactly the message
       somebody would forge;
     · act once. The provider's own event id is unique per provider, so a
       redelivery — which every provider does — updates nothing twice.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Incoming = {
  provider: string;
  raw: string;
  headers: Record<string, string>;
};

export type Handled = {
  stored: boolean;
  /** False when the signature did not check out. Nothing was acted on. */
  verified: boolean;
  /** True when this exact delivery had already been processed. */
  duplicate: boolean;
  result: string | null;
};

/** Pull the provider's own id out of whatever shape it sends. */
function externalIdOf(provider: string, body: Record<string, unknown>): string | null {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  };
  switch (provider) {
    case 'docusign': return pick('envelopeId', 'EnvelopeId', 'eventId');
    case 'vapi':
    case 'voice': return pick('callId', 'id');
    case 'whatsapp': return pick('id', 'messageId');
    case 'twilio':
    case 'sms': return pick('MessageSid', 'SmsSid', 'CallSid');
    case 'sendgrid':
    case 'email': return pick('sg_message_id', 'smtp-id', 'messageId');
    case 'assessment': return pick('id', 'assessment_id', 'reference');
    case 'hris': return pick('id', 'event_id');
    default: return pick('id', 'eventId', 'event_id');
  }
}

function parse(raw: string): Record<string, unknown> {
  try {
    const body = JSON.parse(raw);
    /* Some providers post an array of events; the first is the one this
       delivery is about and the rest are handled on their own deliveries. */
    return Array.isArray(body) ? (body[0] ?? {}) : body;
  } catch {
    /* Twilio and others post form-encoded. */
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

export async function receive(
  input: Incoming, ctx: Ctx & { tx: Exec; now: Date },
): Promise<Handled> {
  const body = parse(input.raw);
  const externalId = externalIdOf(input.provider, body);
  const eventType = String(
    body.event ?? body.type ?? body.status ?? body.MessageStatus ?? body.CallStatus ?? 'unknown',
  );

  const verifier = verifierFor(input.provider);
  const verified = verifier ? verifier(input.raw, input.headers) : false;

  /* Store it, whatever it says. */
  const id = `whk_${crypto.randomUUID().slice(0, 12)}`;
  const stored = await ctx.tx.insert(webhookEvents).values({
    id,
    provider: input.provider,
    eventType,
    externalId,
    signatureValid: verified,
    payload: body,
    headers: redactHeaders(input.headers),
    receivedAt: ctx.now,
  }).onConflictDoNothing({
    target: [webhookEvents.provider, webhookEvents.externalId],
  }).returning({ id: webhookEvents.id });

  if (!stored.length) {
    return { stored: false, verified, duplicate: true, result: 'already delivered' };
  }

  if (!verified) {
    await ctx.tx.update(webhookEvents).set({
      processedAt: ctx.now,
      processResult: 'refused — the signature did not check out',
    }).where(eq(webhookEvents.id, id));
    await audit(ctx, {
      action: 'action',
      summary: `refused an unsigned ${input.provider} callback (${eventType})`,
      entityType: 'webhook', entityId: id, entityLabel: input.provider,
      after: { eventType, externalId },
      source: 'webhook',
    }, ctx.tx);
    return { stored: true, verified: false, duplicate: false, result: null };
  }

  let result: string;
  try {
    result = await act(input.provider, eventType, body, ctx);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await ctx.tx.update(webhookEvents).set({
      processedAt: ctx.now, error: message, attempts: 1,
    }).where(eq(webhookEvents.id, id));
    return { stored: true, verified: true, duplicate: false, result: `failed: ${message}` };
  }

  await ctx.tx.update(webhookEvents).set({
    processedAt: ctx.now, processResult: result, attempts: 1,
  }).where(eq(webhookEvents.id, id));
  return { stored: true, verified: true, duplicate: false, result };
}

/* An authorization header on a stored payload would be a credential in the
   database for ever. */
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'proxy-authorization']);
const redactHeaders = (h: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(h).map(([k, v]) =>
    [k, SECRET_HEADERS.has(k.toLowerCase()) ? '[redacted]' : v]));

/* ── What each provider's callback means ─────────────────────────────────── */

async function act(
  provider: string, eventType: string, body: Record<string, unknown>,
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<string> {
  switch (provider) {
    case 'docusign':
    case 'esign': return esign(eventType, body, ctx);
    case 'vapi':
    case 'voice': return voice(eventType, body, ctx);
    case 'assessment': return assessment(eventType, body, ctx);
    case 'whatsapp':
    case 'sms':
    case 'twilio':
    case 'sendgrid':
    case 'email': return delivery(provider, eventType, body, ctx);
    case 'hris': return hris(eventType, body, ctx);
    default: return `nothing listens for ${provider} callbacks`;
  }
}

/* ── Message delivery ────────────────────────────────────────────────────── */

const DELIVERY: Record<string, string> = {
  delivered: 'delivered', Delivered: 'delivered', delivery: 'delivered',
  sent: 'sent', Sent: 'sent',
  open: 'opened', opened: 'opened',
  read: 'read',
  bounce: 'bounced', bounced: 'bounced',
  dropped: 'failed', failed: 'failed', Failed: 'failed', undelivered: 'failed',
};

async function delivery(
  provider: string, eventType: string, body: Record<string, unknown>,
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<string> {
  const status = DELIVERY[eventType];
  if (!status) return `${eventType} is not a delivery state`;

  const ref = String(
    body.sg_message_id ?? body.MessageSid ?? body.id ?? body.messageId ?? '',
  ).split('.')[0];
  if (!ref) return 'that callback names no message';

  const stamp = status === 'delivered' ? 'delivered_at'
    : status === 'opened' ? 'opened_at'
      : status === 'read' ? 'read_at'
        : status === 'failed' || status === 'bounced' ? 'failed_at' : 'sent_at';

  const updated = rowsOf(await ctx.tx.execute(sql`
    UPDATE ${messages}
       SET status = ${status}::comm_status,
           ${sql.raw(stamp)} = ${ctx.now},
           failure_reason = ${status === 'failed' || status === 'bounced'
    ? String(body.reason ?? body.ErrorMessage ?? eventType) : null}
     WHERE provider_message_id = ${ref}
     RETURNING id, application_id`));
  if (!updated.length) return `no message here carries the reference ${ref}`;

  await emit(ctx, {
    type: status === 'failed' || status === 'bounced' ? 'message.failed' : 'message.delivered',
    subjectType: 'message',
    subjectId: updated[0].id as string,
    payload: { provider, status, applicationId: updated[0].application_id ?? null },
    idempotencyKey: `message:${updated[0].id}:${status}`,
  }, ctx.tx);

  return `message ${status}`;
}

/* ── E-signature ─────────────────────────────────────────────────────────── */

async function esign(
  eventType: string, body: Record<string, unknown>, ctx: Ctx & { tx: Exec; now: Date },
): Promise<string> {
  const envelopeId = String(body.envelopeId ?? body.EnvelopeId ?? '');
  if (!envelopeId) return 'that callback names no envelope';

  const [offer] = await ctx.tx.select().from(offers)
    .where(eq(offers.esignEnvelopeId, envelopeId)).limit(1);
  if (!offer) return `no offer here carries envelope ${envelopeId}`;

  const state = eventType.toLowerCase();
  if (state === 'delivered' || state === 'viewed') {
    await ctx.tx.update(offers).set({
      state: offer.state === 'sent' ? 'viewed' : offer.state,
      viewedAt: offer.viewedAt ?? ctx.now,
      esignStatus: state,
      updatedAt: ctx.now,
    }).where(eq(offers.id, offer.id));
    await ctx.tx.update(offerSignatures)
      .set({ state: 'viewed', viewedAt: ctx.now })
      .where(and(eq(offerSignatures.offerId, offer.id), eq(offerSignatures.state, 'sent')));
    await emit(ctx, {
      type: 'offer.viewed', subjectType: 'offer', subjectId: offer.id,
      payload: { applicationId: offer.applicationId },
      idempotencyKey: `offer.viewed:${offer.id}`,
    }, ctx.tx);
    return 'the candidate opened the envelope';
  }

  if (state === 'completed' || state === 'signed') {
    const r = await recordSignature({ offerId: offer.id, source: 'provider' }, ctx);
    return `${r.reference} signed by ${r.candidateName}`;
  }

  if (state === 'declined' || state === 'voided') {
    await ctx.tx.update(offers).set({
      esignStatus: state, updatedAt: ctx.now,
    }).where(eq(offers.id, offer.id));
    await ctx.tx.update(offerSignatures).set({
      state: 'declined',
      declinedReason: String(body.reason ?? 'declined at the signature page'),
    }).where(eq(offerSignatures.offerId, offer.id));
    return 'the candidate declined at the signature page';
  }

  return `${eventType} needs no action`;
}

/* ── The phone screen ────────────────────────────────────────────────────── */

async function voice(
  eventType: string, body: Record<string, unknown>, ctx: Ctx & { tx: Exec; now: Date },
): Promise<string> {
  const callId = String(body.callId ?? body.id ?? body.CallSid ?? '');
  if (!callId) return 'that callback names no call';

  const [s] = await ctx.tx.select().from(screenings)
    .where(eq(screenings.callProviderRef, callId)).limit(1);
  if (!s) return `no screening here carries call ${callId}`;

  const state = eventType.toLowerCase();

  if (state === 'in-progress' || state === 'answered' || state === 'started') {
    await ctx.tx.update(screenings).set({
      status: 'running',
      callOutcome: 'in_progress',
      callStartedAt: s.callStartedAt ?? ctx.now,
      updatedAt: ctx.now,
    }).where(eq(screenings.id, s.id));
    return 'the candidate answered';
  }

  if (state === 'no-answer' || state === 'busy' || state === 'no_answer') {
    const again = s.callAttempts < 2;
    await ctx.tx.update(screenings).set({
      status: again ? 'scheduled' : 'no_answer',
      callOutcome: 'no_answer',
      callNextAttemptAt: again ? new Date(ctx.now.getTime() + 2 * 3600_000) : null,
      updatedAt: ctx.now,
    }).where(eq(screenings.id, s.id));
    await emit(ctx, {
      type: 'screening.no_answer', subjectType: 'screening', subjectId: s.id,
      payload: { applicationId: s.applicationId, attempt: s.callAttempts },
      idempotencyKey: `screening.no_answer:${s.id}:${s.callAttempts}`,
    }, ctx.tx);
    return again ? 'no answer — one more try in two hours' : 'no answer, and no more tries';
  }

  if (state === 'consent' || state === 'consent-declined') {
    const gave = state === 'consent';
    await ctx.tx.update(screenings).set({
      callConsent: gave,
      status: gave ? s.status : 'cancelled',
      updatedAt: ctx.now,
    }).where(eq(screenings.id, s.id));
    return gave ? 'consent to record given' : 'consent refused — the call was ended';
  }

  if (state === 'transcript' || state === 'answer') {
    /* One answer at a time, in the assistant's own words and the
       candidate's. The scoring is ours, not the provider's. */
    const key = String(body.questionKey ?? body.key ?? '');
    const answer = String(body.answer ?? body.text ?? '');
    if (!key || !answer) return 'that callback carries no answer';
    await recordAnswer({ screeningId: s.id, key: key as never, answer }, ctx);
    return `answer to ${key} recorded`;
  }

  if (state === 'completed' || state === 'ended') {
    const seconds = Number(body.durationSec ?? body.CallDuration ?? 0) || null;
    await ctx.tx.update(screenings).set({
      callEndedAt: ctx.now,
      callDurationSec: seconds,
      callOutcome: 'completed',
      callTranscriptConfidence: body.confidence != null ? String(body.confidence) : null,
      updatedAt: ctx.now,
    }).where(eq(screenings.id, s.id));

    const answered = rowsOf(await ctx.tx.execute(sql`
      SELECT count(*)::int AS n FROM screening_scores WHERE screening_id = ${s.id}`))[0] as { n: number };
    if (Number(answered.n) > 0 && s.status !== 'completed') {
      const r = await complete(s.id, ctx);
      return `call finished — ${r.pct} of 100, ${r.verdict}`;
    }
    return 'call finished with nothing answered';
  }

  return `${eventType} needs no action`;
}

/* ── The assessment house ────────────────────────────────────────────────── */

async function assessment(
  eventType: string, body: Record<string, unknown>, ctx: Ctx & { tx: Exec; now: Date },
): Promise<string> {
  const ref = String(body.id ?? body.assessment_id ?? body.reference ?? '');
  if (!ref) return 'that callback names no assessment';

  const [a] = await ctx.tx.select().from(assessments)
    .where(eq(assessments.providerRef, ref)).limit(1);
  if (!a) return `no assessment here carries reference ${ref}`;

  const state = eventType.toLowerCase();
  if (state === 'started' || state === 'in_progress') {
    await ctx.tx.update(assessments)
      .set({ status: 'in_progress' })
      .where(eq(assessments.id, a.id));
    return 'the candidate started it';
  }
  if (state !== 'completed' && state !== 'complete') return `${eventType} needs no action`;

  const given = Array.isArray(body.traits) ? body.traits as Array<{ name: string; score: number }> : [];
  if (given.length < TRAITS.length) {
    throw new Error(`the provider sent ${given.length} traits; the report needs ${TRAITS.length}`);
  }
  const r = await recordResult({
    assessmentId: a.id,
    traits: given,
    source: 'provider',
    providerRef: ref,
    reportRef: typeof body.report_url === 'string' ? body.report_url : null,
  }, ctx);
  return `result recorded — ${r.score} of 100, ${r.verdict}`;
}

/* ── The HRIS ────────────────────────────────────────────────────────────── */

async function hris(
  eventType: string, body: Record<string, unknown>, ctx: Ctx & { tx: Exec; now: Date },
): Promise<string> {
  const code = String(body.employee_number ?? body.employeeCode ?? '');
  if (!code) return 'that callback names no employee';
  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.employeeCode, code)).limit(1);
  if (!emp) return `no employee here carries the number ${code}`;

  if (eventType.toLowerCase() === 'onboarded') {
    await audit(ctx, {
      action: 'update',
      summary: `the HRIS confirmed ${emp.name}'s employee file is open`,
      entityType: 'employee', entityId: emp.id, entityLabel: emp.name,
      after: { hris: 'onboarded' },
      source: 'webhook',
    }, ctx.tx);
    return 'the HRIS has them on file';
  }
  return `${eventType} needs no action`;
}
