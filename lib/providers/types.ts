import 'server-only';

/* ═════════════════════════════════════════════════════════════════════════════
   WHAT AN ADAPTER IS

   Every outside system this product talks to — e-mail, WhatsApp, SMS,
   LinkedIn, the calendar, e-signature, the phone assistant, the HRIS, the
   assessment house, the model, object storage and the malware scanner — is
   reached through one of these. The rules are the same for all of them:

     · an adapter says whether it is configured, and what is missing when it is
       not. It never guesses, and it never succeeds by default;
     · every call returns a result rather than throwing for an expected failure,
       because "the provider said no" is information the record should keep;
     · every send carries an idempotency key. A retry after a timeout must not
       send a second message to a candidate;
     · nothing here writes to the database. The worker calls the adapter and
       records what it said, so a provider outage never leaves a half-written
       record behind.

   The `none` implementations are not stubs that pretend. They refuse, with the
   reason, so an unconfigured product behaves like an unconfigured product
   instead of like a working one that loses everything.
   ═════════════════════════════════════════════════════════════════════════════*/

export type NotConfigured = {
  ok: false;
  reason: 'not_configured';
  message: string;
  /** The environment variables that would make it work. */
  missing: string[];
};

export type Failed = {
  ok: false;
  reason: 'failed';
  message: string;
  /** True when trying again later could work — a timeout, a 500, a rate limit. */
  retryable: boolean;
  status?: number;
  detail?: unknown;
};

export type Sent<T = Record<string, unknown>> = {
  ok: true;
  /** The provider's own id, which later webhooks refer to. */
  externalId: string | null;
  detail?: T;
};

export type Result<T = Record<string, unknown>> = Sent<T> | NotConfigured | Failed;

export const notConfigured = (what: string, missing: string[]): NotConfigured => ({
  ok: false,
  reason: 'not_configured',
  message: `${what} is not configured — Settings → Integrations`
    + (missing.length ? ` (${missing.join(', ')})` : ''),
  missing,
});

export const failed = (
  message: string, opts: { retryable?: boolean; status?: number; detail?: unknown } = {},
): Failed => ({
  ok: false,
  reason: 'failed',
  message,
  retryable: opts.retryable ?? true,
  status: opts.status,
  detail: opts.detail,
});

export const sent = <T>(externalId: string | null, detail?: T): Sent<T> =>
  ({ ok: true, externalId, detail });

/** What every adapter can say about itself, for Settings → Integrations. */
export type Status = {
  /** The key in `providers()` — email, whatsapp, calendar … */
  key: string;
  /** The implementation in use: smtp, meta_cloud, docusign, none … */
  provider: string;
  configured: boolean;
  missing: string[];
};

export type Adapter = {
  readonly key: string;
  status(): Status;
};

/* ── Messaging ───────────────────────────────────────────────────────────── */

export type OutboundMessage = {
  to: string;
  toName?: string | null;
  cc?: string[];
  subject?: string | null;
  body: string;
  /** Used by the provider to collapse a retry into the original send. */
  idempotencyKey: string;
  replyTo?: string | null;
  attachments?: Array<{ filename: string; contentType: string; bytes: Uint8Array }>;
};

export type MessageAdapter = Adapter & {
  send(message: OutboundMessage): Promise<Result<{ status?: string }>>;
  /** Verify a callback before anything in it is believed. */
  verify?(raw: string, headers: Record<string, string>): boolean;
};

/* ── Calendar ────────────────────────────────────────────────────────────── */

export type CalendarEvent = {
  title: string;
  description?: string | null;
  start: Date;
  durationMin: number;
  location?: string | null;
  attendees: Array<{ name: string; email: string; optional?: boolean }>;
  idempotencyKey: string;
};

export type CalendarAdapter = Adapter & {
  create(event: CalendarEvent): Promise<Result<{ meetingUrl?: string | null }>>;
  update(eventId: string, event: CalendarEvent): Promise<Result<{ meetingUrl?: string | null }>>;
  cancel(eventId: string, reason?: string | null): Promise<Result>;
  /** Free/busy for a set of people, so a clash is the calendar's answer. */
  busy?(
    emails: string[], from: Date, to: Date,
  ): Promise<Result<{ busy: Array<{ email: string; from: string; to: string }> }>>;
};

/* ── E-signature ─────────────────────────────────────────────────────────── */

export type Envelope = {
  subject: string;
  message: string;
  documentName: string;
  documentPdf: Uint8Array;
  signers: Array<{ name: string; email: string; role: string }>;
  idempotencyKey: string;
};

export type EsignAdapter = Adapter & {
  create(envelope: Envelope): Promise<Result<{ envelopeId: string }>>;
  void(envelopeId: string, reason: string): Promise<Result>;
  /** The signed PDF, once the provider says it is complete. */
  fetchSigned(envelopeId: string): Promise<Result<{ bytes: Uint8Array; contentType: string }>>;
  verify(raw: string, headers: Record<string, string>): boolean;
};

/* ── Telephony and the phone assistant ───────────────────────────────────── */

export type CallRequest = {
  to: string;
  language: 'ar' | 'en';
  voice: string;
  /** The six questions, in order. */
  script: Array<{ key: string; question: string }>;
  /** Read out before anything else, and consent recorded. */
  recordingNotice: string;
  idempotencyKey: string;
  webhookUrl: string;
};

export type VoiceAdapter = Adapter & {
  place(call: CallRequest): Promise<Result<{ callId: string }>>;
  cancel(callId: string): Promise<Result>;
  recording(callId: string): Promise<Result<{ url: string; expiresAt: string }>>;
  verify(raw: string, headers: Record<string, string>): boolean;
};

/* ── Assessments ─────────────────────────────────────────────────────────── */

export type AssessmentInvite = {
  candidate: { name: string; email: string };
  kind: string;
  returnUrl: string;
  idempotencyKey: string;
};

export type AssessmentAdapter = Adapter & {
  invite(input: AssessmentInvite): Promise<Result<{ assessmentRef: string; link: string }>>;
  fetch(ref: string): Promise<Result<{
    status: string;
    score?: number;
    traits?: Array<{ name: string; score: number }>;
    reportUrl?: string;
  }>>;
  verify(raw: string, headers: Record<string, string>): boolean;
};

/* ── HRIS ────────────────────────────────────────────────────────────────── */

export type JoinerPayload = {
  employeeCode: string;
  name: string;
  title: string;
  department: string;
  startDate: string;
  locationCity: string | null;
  idempotencyKey: string;
};

export type HrisAdapter = Adapter & {
  pushJoiner(joiner: JoinerPayload): Promise<Result<{ hrisId: string }>>;
  verify(raw: string, headers: Record<string, string>): boolean;
};

/* ── LinkedIn and the boards ─────────────────────────────────────────────── */

export type Posting = {
  title: string;
  description: string;
  city: string | null;
  employmentType: string | null;
  applyUrl: string;
  idempotencyKey: string;
};

export type JobBoardAdapter = Adapter & {
  publish(posting: Posting): Promise<Result<{ postingId: string; url: string }>>;
  close(postingId: string): Promise<Result>;
};

/* ── The model ───────────────────────────────────────────────────────────── */

export type AiAdapter = Adapter & {
  /**
   * Ask for JSON of a given shape. The caller validates what comes back —
   * nothing here trusts a model's output enough to write it unchecked.
   */
  json<T>(input: {
    prompt: string;
    system?: string;
    maxTokens?: number;
  }): Promise<Result<{ value: T; model: string }>>;
};

/* ── Files ───────────────────────────────────────────────────────────────── */

export type StoredFile = {
  key: string;
  size: number;
  contentType: string;
  checksum: string;
};

export type StorageAdapter = Adapter & {
  put(input: {
    key: string; bytes: Uint8Array; contentType: string;
  }): Promise<Result<StoredFile>>;
  get(key: string): Promise<Result<{ bytes: Uint8Array; contentType: string }>>;
  delete(key: string): Promise<Result>;
  /** A URL that works for a while and then does not. */
  signedUrl(key: string, seconds: number): Promise<Result<{ url: string; expiresAt: string }>>;
};

export type ScanVerdict = 'clean' | 'infected' | 'unknown';

export type ScannerAdapter = Adapter & {
  scan(bytes: Uint8Array): Promise<Result<{ verdict: ScanVerdict; signature?: string | null }>>;
};
