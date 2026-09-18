import {
  pgTable, text, integer, boolean, timestamp, uniqueIndex, index, jsonb,
  bigint, check,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import {
  commChannel, commDirection, commStatus, taskKind, taskPriority, notificationKind,
  integrationKind, integrationState, integrationHealth, automationRunState,
  jobQueueState, fileKind, scanState, auditAction,
} from './enums';
import { staff, accounts } from './org';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());

/* ─────────────────────────────────────────────────────────────────────────────
   FILES — object storage metadata. The bytes live behind a driver (local disk
   or S3); this table is the only thing that knows where, and every download
   goes through an authorisation check and a signed, expiring URL.
   ───────────────────────────────────────────────────────────────────────────*/
export const files = pgTable('files', {
  id: id(),
  kind: fileKind('kind').notNull(),
  /* Storage key inside the driver's namespace. Never guessable from the UI. */
  storageKey: text('storage_key').notNull(),
  storageDriver: text('storage_driver').notNull(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  /* Which record this belongs to, for authorisation. */
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  /* Versioning: a replaced CV supersedes rather than overwrites. */
  supersedesId: text('supersedes_id'),
  version: integer('version').notNull().default(1),
  scanState: scanState('scan_state').notNull().default('pending'),
  scanResult: text('scan_result'),
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
  uploadedBy: text('uploaded_by'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  /* Retention. A file past its date is deleted by the retention worker. */
  retainUntil: timestamp('retain_until', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => ({
  keyUq: uniqueIndex('files_storage_key_uq').on(t.storageKey),
  ownerIdx: index('files_owner_idx').on(t.ownerType, t.ownerId),
  shaIdx: index('files_sha_idx').on(t.sha256),
  scanIdx: index('files_scan_idx').on(t.scanState).where(sql`scan_state = 'pending'`),
  retainIdx: index('files_retain_idx').on(t.retainUntil).where(sql`deleted_at IS NULL`),
  sizeCk: check('files_size_ck', sql`${t.sizeBytes} > 0`),
}));

/* Each download is recorded: who fetched what, and when. */
export const fileAccessLog = pgTable('file_access_log', {
  id: id(),
  fileId: text('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  /* view | download | signed_url — see 0011_file_access_action.sql. */
  action: text('action').notNull().default('download'),
  accountId: text('account_id'),
  actorName: text('actor_name'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  fileIdx: index('file_access_log_file_idx').on(t.fileId, t.at),
}));

/* ─────────────────────────────────────────────────────────────────────────────
   COMMUNICATION — threads and messages across every channel, with the delivery
   state the provider reports back.
   ───────────────────────────────────────────────────────────────────────────*/
export const messageThreads = pgTable('message_threads', {
  id: id(),
  subjectType: text('subject_type').notNull(),   // application | offer | employee | candidate
  subjectId: text('subject_id').notNull(),
  candidateId: text('candidate_id'),
  applicationId: text('application_id'),
  jobId: text('job_id'),
  title: text('title'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subjIdx: index('message_threads_subject_idx').on(t.subjectType, t.subjectId),
  appIdx: index('message_threads_app_idx').on(t.applicationId),
}));

export const messages = pgTable('messages', {
  id: id(),
  threadId: text('thread_id').references(() => messageThreads.id, { onDelete: 'cascade' }),
  applicationId: text('application_id'),
  candidateId: text('candidate_id'),
  jobId: text('job_id'),
  employeeId: text('employee_id'),
  channel: commChannel('channel').notNull(),
  direction: commDirection('direction').notNull(),
  /* Internal = to a colleague rather than to the candidate. */
  internal: boolean('internal').notNull().default(false),
  fromName: text('from_name'),
  fromAddress: text('from_address'),
  toName: text('to_name'),
  toAddress: text('to_address'),
  ccAddresses: text('cc_addresses').array().notNull().default(sql`'{}'::text[]`),
  subject: text('subject'),
  body: text('body').notNull(),
  templateId: text('template_id'),
  /* What the provider gave back. */
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  status: commStatus('status').notNull().default('queued'),
  statusDetail: text('status_detail'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  attempts: integer('attempts').notNull().default(0),
  authorId: text('author_id'),
  /* Replaying the same send never produces two messages. */
  idempotencyKey: text('idempotency_key'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appIdx: index('messages_app_idx').on(t.applicationId, t.at),
  candIdx: index('messages_candidate_idx').on(t.candidateId, t.at),
  providerUq: uniqueIndex('messages_provider_uq').on(t.provider, t.providerMessageId),
  idemUq: uniqueIndex('messages_idem_uq').on(t.idempotencyKey),
  statusIdx: index('messages_status_idx').on(t.status).where(sql`status IN ('queued','sending')`),
}));

/* Provider callbacks, verified and stored before anything is acted on. */
export const webhookEvents = pgTable('webhook_events', {
  id: id(),
  provider: text('provider').notNull(),
  eventType: text('event_type').notNull(),
  /* The provider's own id — the idempotency key for redelivery. */
  externalId: text('external_id'),
  signatureValid: boolean('signature_valid').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processResult: text('process_result'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
}, (t) => ({
  extUq: uniqueIndex('webhook_events_external_uq').on(t.provider, t.externalId),
  pendingIdx: index('webhook_events_pending_idx').on(t.receivedAt).where(sql`processed_at IS NULL`),
}));

export const emailTemplates = pgTable('email_templates', {
  id: id(),
  name: text('name').notNull(),
  stage: text('stage'),
  lang: text('lang').notNull().default('en'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  /* The order this list is maintained and read in; see
     db/migrations/0006_list_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
});

/* ─────────────────────────────────────────────────────────────────────────────
   TASKS · NOTIFICATIONS — deliberately separate. A toast is frontend-only and
   has no table; a notification is an inbox event; a task is work assigned to a
   person with a due date and a tick-box.
   ───────────────────────────────────────────────────────────────────────────*/
export const tasks = pgTable('tasks', {
  id: id(),
  kind: taskKind('kind').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  applicationId: text('application_id'),
  jobId: text('job_id'),
  candidateId: text('candidate_id'),
  employeeId: text('employee_id'),
  offerId: text('offer_id'),
  assigneeId: text('assignee_id').references(() => staff.id, { onDelete: 'set null' }),
  assigneeAccountId: text('assignee_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  dueOn: timestamp('due_on', { withTimezone: true }),
  priority: taskPriority('priority').notNull().default('normal'),
  done: boolean('done').notNull().default(false),
  doneAt: timestamp('done_at', { withTimezone: true }),
  doneBy: text('done_by'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /* An automation that creates the same task twice is a bug, not a feature. */
  dedupeKey: text('dedupe_key'),
}, (t) => ({
  assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId, t.done, t.dueOn),
  appIdx: index('tasks_app_idx').on(t.applicationId),
  dedupeUq: uniqueIndex('tasks_dedupe_uq').on(t.dedupeKey).where(sql`done = false`),
}));

export const notifications = pgTable('notifications', {
  id: id(),
  kind: notificationKind('kind').notNull(),
  text: text('text').notNull(),
  /* Null recipient = the whole TA team's bell. */
  recipientAccountId: text('recipient_account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  recipientStaffId: text('recipient_staff_id').references(() => staff.id, { onDelete: 'cascade' }),
  applicationId: text('application_id'),
  jobId: text('job_id'),
  candidateId: text('candidate_id'),
  employeeId: text('employee_id'),
  offerId: text('offer_id'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: text('dedupe_key'),
}, (t) => ({
  recIdx: index('notifications_recipient_idx').on(t.recipientAccountId, t.readAt, t.at),
  staffIdx: index('notifications_staff_idx').on(t.recipientStaffId, t.readAt),
  dedupeUq: uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey),
}));

/* ─────────────────────────────────────────────────────────────────────────────
   AUTOMATION — a durable trigger → conditions → actions engine. Rules are
   configuration; events are what happened; runs are what the engine did about
   it, with enough detail to answer "why did this candidate get that e-mail".
   ───────────────────────────────────────────────────────────────────────────*/
export const automationRules = pgTable('automation_rules', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  trigger: text('trigger').notNull(),
  /* [{field, op, value}] — all must hold. */
  conditions: jsonb('conditions').$type<Array<{ field: string; op: string; value: unknown }>>()
    .notNull().default([]),
  /* [{type, …params}] — run in order; a failure retries the whole run. */
  actions: jsonb('actions').$type<Array<Record<string, unknown>>>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(false),
  /* Rules the product ships with cannot be deleted, only disabled. */
  isSystem: boolean('is_system').notNull().default(false),
  /* Guard against a rule firing repeatedly on the same subject. */
  dedupeWindowMinutes: integer('dedupe_window_minutes'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  runs30d: integer('runs_30d').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  /* The order this list is maintained and read in; see
     db/migrations/0006_list_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
}, (t) => ({
  triggerIdx: index('automation_rules_trigger_idx').on(t.trigger, t.enabled),
}));

/* The event log the engine reacts to. Append-only; also the source for
   point-in-time reporting. */
export const domainEvents = pgTable('domain_events', {
  id: id(),
  type: text('type').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  correlationId: text('correlation_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  /* The engine marks events it has dispatched, so a restart never re-fires. */
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key'),
}, (t) => ({
  typeIdx: index('domain_events_type_idx').on(t.type, t.at),
  subjIdx: index('domain_events_subject_idx').on(t.subjectType, t.subjectId, t.at),
  pendingIdx: index('domain_events_pending_idx').on(t.at).where(sql`dispatched_at IS NULL`),
  idemUq: uniqueIndex('domain_events_idem_uq').on(t.idempotencyKey),
}));

export const automationRuns = pgTable('automation_runs', {
  id: id(),
  ruleId: text('rule_id').notNull().references(() => automationRules.id, { onDelete: 'cascade' }),
  eventId: text('event_id').references(() => domainEvents.id, { onDelete: 'set null' }),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  state: automationRunState('state').notNull().default('pending'),
  conditionsMet: boolean('conditions_met'),
  skippedReason: text('skipped_reason'),
  actionsRun: jsonb('actions_run').$type<Array<Record<string, unknown>>>().notNull().default([]),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  /* rule + event is unique: replay cannot double-run. */
  idempotencyKey: text('idempotency_key').notNull(),
}, (t) => ({
  idemUq: uniqueIndex('automation_runs_idem_uq').on(t.idempotencyKey),
  ruleIdx: index('automation_runs_rule_idx').on(t.ruleId, t.at),
  stateIdx: index('automation_runs_state_idx').on(t.state).where(sql`state IN ('pending','running')`),
}));

/* The durable work queue behind everything asynchronous: sending, scanning,
   scheduling, SLA sweeps, retention. */
export const jobQueue = pgTable('job_queue', {
  id: id(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  state: jobQueueState('state').notNull().default('pending'),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(6),
  lastError: text('last_error'),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: text('dedupe_key'),
  correlationId: text('correlation_id'),
}, (t) => ({
  pickupIdx: index('job_queue_pickup_idx').on(t.state, t.runAfter)
    .where(sql`state = 'pending'`),
  dedupeUq: uniqueIndex('job_queue_dedupe_uq').on(t.dedupeKey)
    .where(sql`state IN ('pending','running')`),
  kindIdx: index('job_queue_kind_idx').on(t.kind, t.state),
}));

/* ─────────────────────────────────────────────────────────────────────────────
   INTEGRATIONS — one row per connected system, with the credential status the
   UI reports honestly. Credentials themselves live in the environment, never
   in the database.
   ───────────────────────────────────────────────────────────────────────────*/
export const integrations = pgTable('integrations', {
  id: id(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  kind: integrationKind('kind').notNull(),
  provider: text('provider'),
  state: integrationState('state').notNull().default('not_configured'),
  health: integrationHealth('health').notNull().default('unknown'),
  detail: text('detail'),
  /* What the environment is missing, named, so the UI can say so. */
  missingConfig: text('missing_config').array().notNull().default(sql`'{}'::text[]`),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
  lastError: text('last_error'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /* The order this list is maintained and read in; see
     db/migrations/0006_list_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
}, (t) => ({
  keyUq: uniqueIndex('integrations_key_uq').on(t.key),
}));

/* ─────────────────────────────────────────────────────────────────────────────
   AUDIT — append-only. UPDATE and DELETE are refused by a trigger; the table is
   the record of what was done, by whom, to what, with the before and after.
   ───────────────────────────────────────────────────────────────────────────*/
export const auditEvents = pgTable('audit_events', {
  id: id(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorId: text('actor_id'),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role'),
  actorAccountId: text('actor_account_id'),
  /* When an Admin acts as a colleague, both are recorded. */
  onBehalfOfId: text('on_behalf_of_id'),
  onBehalfOfName: text('on_behalf_of_name'),
  action: auditAction('action').notNull(),
  /* The sentence the audit page prints: "approved and published a requisition". */
  summary: text('summary').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  entityLabel: text('entity_label'),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  reason: text('reason'),
  source: text('source').notNull().default('ui'),   // ui | api | worker | webhook | seed
  requestId: text('request_id'),
  correlationId: text('correlation_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  sessionId: text('session_id'),
}, (t) => ({
  atIdx: index('audit_events_at_idx').on(t.at),
  entityIdx: index('audit_events_entity_idx').on(t.entityType, t.entityId, t.at),
  actorIdx: index('audit_events_actor_idx').on(t.actorId, t.at),
  reqIdx: index('audit_events_request_idx').on(t.requestId),
}));

/* ─────────────────────────────────────────────────────────────────────────────
   REPORTING — saved Ask AI reports and the log of what was asked.
   ───────────────────────────────────────────────────────────────────────────*/
export const savedReports = pgTable('saved_reports', {
  id: id(),
  name: text('name').notNull(),
  question: text('question'),
  spec: jsonb('spec').$type<Record<string, unknown>>().notNull(),
  ownerId: text('owner_id').references(() => staff.id, { onDelete: 'cascade' }),
  shared: boolean('shared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
});

export const reportRequests = pgTable('report_requests', {
  id: id(),
  accountId: text('account_id'),
  actorName: text('actor_name'),
  question: text('question').notNull(),
  /* The resolved metric/dimension/filter — never raw SQL from a model. */
  resolvedSpec: jsonb('resolved_spec').$type<Record<string, unknown>>(),
  resolvedBy: text('resolved_by').notNull().default('grammar'),   // grammar | ai
  rowCount: integer('row_count'),
  durationMs: integer('duration_ms'),
  scopeApplied: text('scope_applied'),
  error: text('error'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  atIdx: index('report_requests_at_idx').on(t.at),
}));

/* Point-in-time pipeline snapshots, written nightly, so historic reporting is
   read from a record rather than guessed from current state. */
export const pipelineSnapshots = pgTable('pipeline_snapshots', {
  id: id(),
  snapshotDate: text('snapshot_date').notNull(),   // YYYY-MM-DD
  jobId: text('job_id'),
  deptId: text('dept_id'),
  stage: text('stage').notNull(),
  liveCount: integer('live_count').notNull().default(0),
  enteredCount: integer('entered_count').notNull().default(0),
  exitedCount: integer('exited_count').notNull().default(0),
  breachedCount: integer('breached_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex('pipeline_snapshots_uq').on(t.snapshotDate, t.jobId, t.stage),
  dateIdx: index('pipeline_snapshots_date_idx').on(t.snapshotDate),
}));

/* ─────────────────────────────────────────────────────────────────────────────
   LINKS A CANDIDATE OPENS WITHOUT SIGNING IN — the screening chat, the booking
   page, the offer, the signature, the assessment, the reference form. The token
   is never stored, only its hash: a link in an e-mail is a credential.
   ───────────────────────────────────────────────────────────────────────────*/
export const accessLinks = pgTable('access_links', {
  id: id(),
  tokenHash: text('token_hash').notNull(),
  purpose: text('purpose').notNull(),      // screening | booking | offer | sign | assessment | reference
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  candidateId: text('candidate_id'),
  applicationId: text('application_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  firstUsedAt: timestamp('first_used_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedIp: text('last_used_ip'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenUq: uniqueIndex('access_links_token_uq').on(t.tokenHash),
  subjIdx: index('access_links_subject_idx').on(t.subjectType, t.subjectId),
}));

export const automationRunsRelations = relations(automationRuns, ({ one }) => ({
  rule: one(automationRules, { fields: [automationRuns.ruleId], references: [automationRules.id] }),
  event: one(domainEvents, { fields: [automationRuns.eventId], references: [domainEvents.id] }),
}));
