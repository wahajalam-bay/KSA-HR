import {
  pgTable, text, integer, boolean, timestamp, date, uniqueIndex, index,
  jsonb, numeric, check,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import {
  stageKey, approvalSubject, approvalState, approvalStepState, approverType, conditionOp,
  offerState, offerResponseState, signerState, documentStatus, messageParty,
  screeningChannel, screeningStatus, screeningVerdict, callOutcome,
  interviewStatus, assessmentStatus, assessmentVerdict, pitchStatus, pitchVerdict,
} from './enums';
import { jobs, applications, candidates } from './hiring';
import { staff } from './org';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());

/* ─────────────────────────────────────────────────────────────────────────────
   APPROVALS — one reusable engine, used by requisitions and offers.

   A flow is the configured chain (Settings → Approvals). Submitting a record
   snapshots the applicable steps onto an approval instance, so editing the flow
   afterwards never rewrites a decision that has already been taken.
   ───────────────────────────────────────────────────────────────────────────*/
export const approvalFlows = pgTable('approval_flows', {
  id: id(),
  subject: approvalSubject('subject').notNull(),
  name: text('name').notNull(),
  publishOnApprove: boolean('publish_on_approve').notNull().default(true),
  publishChannels: text('publish_channels').array().notNull().default(sql`'{}'::text[]`),
  requireVerification: boolean('require_verification').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /* The order this list is maintained and read in; see
     db/migrations/0006_list_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
}, (t) => ({
  activeUq: uniqueIndex('approval_flows_active_uq').on(t.subject).where(sql`${t.isActive}`),
}));

export const approvalFlowSteps = pgTable('approval_flow_steps', {
  id: id(),
  flowId: text('flow_id').notNull().references(() => approvalFlows.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  approverType: approverType('approver_type').notNull(),
  approverRole: text('approver_role'),
  approverStaffId: text('approver_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  approverName: text('approver_name'),
  approverTitle: text('approver_title'),
  approverEmail: text('approver_email'),
  /* Condition: openings >= 4, salaryMax > 30000, … null means always. */
  condField: text('cond_field'),
  condOp: conditionOp('cond_op'),
  condValue: integer('cond_value'),
  auto: boolean('auto').notNull().default(false),
  ordinal: integer('ordinal').notNull(),
}, (t) => ({
  flowIdx: index('approval_flow_steps_flow_idx').on(t.flowId, t.ordinal),
  ordUq: uniqueIndex('approval_flow_steps_ord_uq').on(t.flowId, t.ordinal),
}));

/* The instance: one per submission of one record. */
export const approvals = pgTable('approvals', {
  id: id(),
  subject: approvalSubject('subject').notNull(),
  subjectId: text('subject_id').notNull(),
  flowId: text('flow_id').references(() => approvalFlows.id, { onDelete: 'set null' }),
  /* The whole flow as it stood at submission, for the record. */
  flowSnapshot: jsonb('flow_snapshot').$type<Record<string, unknown>>().notNull().default({}),
  state: approvalState('state').notNull().default('pending'),
  requestedBy: text('requested_by'),
  requestedByName: text('requested_by_name'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: text('decided_by'),
  decidedByName: text('decided_by_name'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  note: text('note'),
  /* Attempt number — a resubmission after a send-back is a new instance. */
  attempt: integer('attempt').notNull().default(1),
  supersededById: text('superseded_by_id'),
}, (t) => ({
  subjIdx: index('approvals_subject_idx').on(t.subject, t.subjectId, t.state),
  /* Only one open chain per record at a time. */
  openUq: uniqueIndex('approvals_open_uq').on(t.subject, t.subjectId)
    .where(sql`state = 'pending'`),
}));

export const approvalSteps = pgTable('approval_steps', {
  id: id(),
  approvalId: text('approval_id').notNull().references(() => approvals.id, { onDelete: 'cascade' }),
  stepKey: text('step_key').notNull(),
  label: text('label').notNull(),
  approverType: approverType('approver_type').notNull(),
  approverRole: text('approver_role'),
  approverStaffId: text('approver_staff_id'),
  approverName: text('approver_name'),
  approverTitle: text('approver_title'),
  approverEmail: text('approver_email'),
  conditionText: text('condition_text'),
  auto: boolean('auto').notNull().default(false),
  state: approvalStepState('state').notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedByName: text('decided_by_name'),
  /* An Admin acting for somebody outside the platform. */
  onBehalfOf: text('on_behalf_of'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  note: text('note'),
  ordinal: integer('ordinal').notNull(),
}, (t) => ({
  apIdx: index('approval_steps_approval_idx').on(t.approvalId, t.ordinal),
  ordUq: uniqueIndex('approval_steps_ord_uq').on(t.approvalId, t.ordinal),
}));

/* ── Offers ─────────────────────────────────────────────────────────────────*/
export const offerTemplates = pgTable('offer_templates', {
  id: id(),
  name: text('name').notNull(),
  family: text('family'),
  isDefault: boolean('is_default').notNull().default(false),
  fileId: text('file_id'),
  fileName: text('file_name'),
  fileType: text('file_type'),
  sizeKb: integer('size_kb'),
  lang: text('lang').notNull().default('en'),
  version: integer('version').notNull().default(1),
  body: text('body').notNull(),
  detectedFields: text('detected_fields').array().notNull().default(sql`'{}'::text[]`),
  note: text('note'),
  uploadedBy: text('uploaded_by'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  /* The order HR thinks of the letters in: standard, then the variants. */
  sortOrder: integer('sort_order').notNull().default(1000),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => ({
  /* At most one fallback default, and one default per family. */
  defaultUq: uniqueIndex('offer_templates_default_uq').on(sql`(1)`).where(sql`is_default AND archived_at IS NULL`),
  familyUq: uniqueIndex('offer_templates_family_uq').on(t.family).where(sql`family IS NOT NULL AND archived_at IS NULL`),
  orderIdx: index('offer_templates_order_idx').on(t.sortOrder, t.id),
}));

export const offers = pgTable('offers', {
  id: id(),
  reference: text('reference').notNull(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  supersedesId: text('supersedes_id'),
  baseMonthly: integer('base_monthly').notNull(),
  housing: integer('housing').notNull().default(0),
  transport: integer('transport').notNull().default(0),
  annualBonusPct: integer('annual_bonus_pct').notNull().default(0),
  currency: text('currency').notNull().default('SAR'),
  startDate: date('start_date').notNull(),
  state: offerState('state').notNull().default('draft'),
  templateId: text('template_id').references(() => offerTemplates.id, { onDelete: 'set null' }),
  templateName: text('template_name'),
  /* Hand-edited wording; null means "the template, filled fresh". */
  letterOverride: text('letter_override'),
  /* Corrections to individual merge fields, keyed by field name. */
  fieldOverrides: jsonb('field_overrides').$type<Record<string, string>>().notNull().default({}),
  verifiedBy: text('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedNote: text('verified_note'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentBy: text('sent_by'),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /* E-signature envelope. */
  esignProvider: text('esign_provider'),
  esignEnvelopeId: text('esign_envelope_id'),
  esignStatus: text('esign_status'),
  generatedFileId: text('generated_file_id'),
  signedFileId: text('signed_file_id'),
  /* The candidate's answer. */
  responseState: offerResponseState('response_state'),
  responseAt: timestamp('response_at', { withTimezone: true }),
  responseBy: text('response_by'),
  responseReason: text('response_reason'),
  responseNote: text('response_note'),
  responseSource: text('response_source'),
  version_lock: integer('version_lock').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  refUq: uniqueIndex('offers_reference_uq').on(t.reference),
  appVerUq: uniqueIndex('offers_app_version_uq').on(t.applicationId, t.version),
  appIdx: index('offers_app_idx').on(t.applicationId),
  stateIdx: index('offers_state_idx').on(t.state),
  sentIdx: index('offers_sent_idx').on(t.sentAt),
  envUq: uniqueIndex('offers_envelope_uq').on(t.esignEnvelopeId),
  moneyCk: check('offers_money_ck', sql`${t.baseMonthly} > 0 AND ${t.housing} >= 0 AND ${t.transport} >= 0`),
}));

/* Every correction to a letter, with who, when, from and to. Append-only. */
export const offerLetterEdits = pgTable('offer_letter_edits', {
  id: id(),
  offerId: text('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  field: text('field').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  byId: text('by_id'),
  byName: text('by_name'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  offerIdx: index('offer_letter_edits_offer_idx').on(t.offerId, t.at),
}));

/* The documents the envelope collects before the signature page. */
export const offerDocuments = pgTable('offer_documents', {
  id: id(),
  offerId: text('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  status: documentStatus('status').notNull().default('missing'),
  fileId: text('file_id'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  uploadedBy: text('uploaded_by'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  uq: uniqueIndex('offer_documents_uq').on(t.offerId, t.key),
}));

export const offerSignatures = pgTable('offer_signatures', {
  id: id(),
  offerId: text('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').notNull().default('Candidate'),
  state: signerState('state').notNull().default('not_sent'),
  providerRecipientId: text('provider_recipient_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  declinedReason: text('declined_reason'),
  ipAddress: text('ip_address'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  offerIdx: index('offer_signatures_offer_idx').on(t.offerId),
}));

/* The conversation on an offer. */
export const offerMessages = pgTable('offer_messages', {
  id: id(),
  offerId: text('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  fromParty: messageParty('from_party').notNull(),
  authorId: text('author_id'),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  messageId: text('message_id'),
  readAt: timestamp('read_at', { withTimezone: true }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  offerIdx: index('offer_messages_offer_idx').on(t.offerId, t.at),
  appIdx: index('offer_messages_app_idx').on(t.applicationId),
}));

/* ── Screening ──────────────────────────────────────────────────────────────*/
export const screenings = pgTable('screenings', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  channel: screeningChannel('channel').notNull(),
  status: screeningStatus('status').notNull().default('invited'),
  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  total: integer('total'),
  max: integer('max'),
  /* The 1–100 the interface shows. */
  score: integer('score'),
  verdict: screeningVerdict('verdict'),
  summary: text('summary'),
  /* What the screen recorded about pay and notice. */
  capturedCurrentSalary: integer('captured_current_salary'),
  capturedExpectedSalary: integer('captured_expected_salary'),
  capturedNoticeDays: integer('captured_notice_days'),
  capturedSource: text('captured_source'),
  capturedBy: text('captured_by'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  capturedQuote: text('captured_quote'),
  /* AI phone screen: the call. */
  callDirection: text('call_direction'),
  callPhone: text('call_phone'),
  callLanguage: text('call_language'),
  callVoice: text('call_voice'),
  callAttempts: integer('call_attempts').notNull().default(0),
  callConsent: boolean('call_consent'),
  callScheduledFor: timestamp('call_scheduled_for', { withTimezone: true }),
  callStartedAt: timestamp('call_started_at', { withTimezone: true }),
  callEndedAt: timestamp('call_ended_at', { withTimezone: true }),
  callNextAttemptAt: timestamp('call_next_attempt_at', { withTimezone: true }),
  callDurationSec: integer('call_duration_sec'),
  callOutcome: callOutcome('call_outcome'),
  callProvider: text('call_provider'),
  callProviderRef: text('call_provider_ref'),
  callRecordingFileId: text('call_recording_file_id'),
  callTranscriptConfidence: numeric('call_transcript_confidence', { precision: 4, scale: 3 }),
  callClarity: integer('call_clarity'),
  callFluency: integer('call_fluency'),
  callEngagement: integer('call_engagement'),
  /* The assistant's read of the conversation. */
  analysis: jsonb('analysis').$type<Record<string, unknown>>(),
  /* The review of how the call was run. */
  interviewerReview: jsonb('interviewer_review').$type<Record<string, unknown>>(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appIdx: index('screenings_app_idx').on(t.applicationId, t.invitedAt),
  statusIdx: index('screenings_status_idx').on(t.status),
  providerUq: uniqueIndex('screenings_provider_uq').on(t.callProviderRef),
}));

export const screeningTurns = pgTable('screening_turns', {
  id: id(),
  screeningId: text('screening_id').notNull().references(() => screenings.id, { onDelete: 'cascade' }),
  who: text('who').notNull(),         // bot | candidate
  text: text('text').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  seq: integer('seq').notNull(),
}, (t) => ({
  uq: uniqueIndex('screening_turns_uq').on(t.screeningId, t.seq),
}));

export const screeningScores = pgTable('screening_scores', {
  id: id(),
  screeningId: text('screening_id').notNull().references(() => screenings.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  question: text('question').notNull(),
  answer: text('answer'),
  score: integer('score').notNull(),
  max: integer('max').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  uq: uniqueIndex('screening_scores_uq').on(t.screeningId, t.key),
}));

/* ── Interviews ─────────────────────────────────────────────────────────────*/
export const interviews = pgTable('interviews', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  stage: stageKey('stage').notNull(),
  title: text('title').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  durationMin: integer('duration_min').notNull().default(45),
  mode: text('mode').notNull(),
  /* The hiring manager taking this one. */
  interviewer: text('interviewer'),
  organiserId: text('organiser_id').references(() => staff.id, { onDelete: 'set null' }),
  status: interviewStatus('status').notNull().default('scheduled'),
  location: text('location'),
  meetingUrl: text('meeting_url'),
  calendarProvider: text('calendar_provider'),
  calendarEventId: text('calendar_event_id'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: text('cancelled_by'),
  cancelReason: text('cancel_reason'),
  rescheduledFromId: text('rescheduled_from_id'),
  /* Recording and its review. */
  recorded: boolean('recorded').notNull().default(false),
  recordingFileId: text('recording_file_id'),
  recordingRef: text('recording_ref'),
  minutes: integer('minutes'),
  analysis: jsonb('analysis').$type<Record<string, unknown>>(),
  reviewerScore: integer('reviewer_score'),
  reviewerRatings: jsonb('reviewer_ratings').$type<Record<string, number>>(),
  reviewerStrengths: text('reviewer_strengths').array(),
  reviewerImprove: text('reviewer_improve').array(),
  reviewerModel: text('reviewer_model'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appIdx: index('interviews_app_idx').on(t.applicationId, t.at),
  atIdx: index('interviews_at_idx').on(t.at, t.status),
  jobIdx: index('interviews_job_idx').on(t.jobId),
  calUq: uniqueIndex('interviews_calendar_uq').on(t.calendarProvider, t.calendarEventId),
  durCk: check('interviews_duration_ck', sql`${t.durationMin} BETWEEN 5 AND 480`),
}));

export const interviewPanel = pgTable('interview_panel', {
  id: id(),
  interviewId: text('interview_id').notNull().references(() => interviews.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  accountId: text('account_id'),
  isHiringManager: boolean('is_hiring_manager').notNull().default(false),
  responded: text('responded'),      // accepted | declined | tentative | null
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  ivIdx: index('interview_panel_iv_idx').on(t.interviewId),
  uq: uniqueIndex('interview_panel_uq').on(t.interviewId, sql`lower(${t.name})`),
}));

/* ── Behavioural assessments ────────────────────────────────────────────────*/
export const assessments = pgTable('assessments', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('behavioural'),
  provider: text('provider').notNull(),
  providerRef: text('provider_ref'),
  status: assessmentStatus('status').notNull().default('invited'),
  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  invitedBy: text('invited_by'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  score: integer('score'),
  traits: jsonb('traits').$type<Array<{ name: string; note?: string; score: number }>>()
    .notNull().default([]),
  verdict: assessmentVerdict('verdict'),
  summary: text('summary'),
  reportFileId: text('report_file_id'),
  reportRef: text('report_ref'),
}, (t) => ({
  /* One behavioural test per application. */
  appUq: uniqueIndex('assessments_app_uq').on(t.applicationId, t.kind),
  providerUq: uniqueIndex('assessments_provider_uq').on(t.providerRef),
}));

/* ── Sales Pitch ────────────────────────────────────────────────────────────*/
export const pitchProjects = pgTable('pitch_projects', {
  id: id(),
  name: text('name').notNull(),
  who: text('who'),
  client: text('client'),
  brief: text('brief').notNull(),
  task: text('task').notNull(),
  durationMin: integer('duration_min').notNull().default(20),
  prepHours: integer('prep_hours').notNull().default(24),
  criteria: jsonb('criteria').$type<Array<{ key: string; name: string; hint?: string; max: number }>>()
    .notNull().default([]),
  active: boolean('active').notNull().default(true),
  uses: integer('uses').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  /* The order this list is maintained and read in; see
     db/migrations/0006_list_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
});

export const pitchConfig = pgTable('pitch_config', {
  id: text('id').primaryKey().default('pitch_cfg'),
  leadHours: integer('lead_hours').notNull().default(24),
  channels: text('channels').array().notNull().default(sql`ARRAY['whatsapp','email']::text[]`),
  gateFinal: boolean('gate_final').notNull().default(true),
  waTemplate: text('wa_template').notNull(),
  emailSubject: text('email_subject').notNull(),
  emailBody: text('email_body').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

export const pitches = pgTable('pitches', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => pitchProjects.id, { onDelete: 'set null' }),
  status: pitchStatus('status').notNull().default('not_sent'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentWhatsapp: text('sent_whatsapp'),
  sentEmail: text('sent_email'),
  channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
  dueAt: timestamp('due_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMin: integer('duration_min'),
  total: integer('total'),
  max: integer('max'),
  score: integer('score'),
  verdict: pitchVerdict('verdict'),
  summary: text('summary'),
  strengths: text('strengths').array().notNull().default(sql`'{}'::text[]`),
  gaps: text('gaps').array().notNull().default(sql`'{}'::text[]`),
  model: text('model'),
  recordingFileId: text('recording_file_id'),
  recordingRef: text('recording_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appUq: uniqueIndex('pitches_app_uq').on(t.applicationId),
}));

export const pitchTurns = pgTable('pitch_turns', {
  id: id(),
  pitchId: text('pitch_id').notNull().references(() => pitches.id, { onDelete: 'cascade' }),
  who: text('who').notNull(),         // ai | cand
  text: text('text').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  seq: integer('seq').notNull(),
}, (t) => ({
  uq: uniqueIndex('pitch_turns_uq').on(t.pitchId, t.seq),
}));

export const pitchScores = pgTable('pitch_scores', {
  id: id(),
  pitchId: text('pitch_id').notNull().references(() => pitches.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  score: integer('score').notNull(),
  max: integer('max').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  uq: uniqueIndex('pitch_scores_uq').on(t.pitchId, t.key),
}));

export const offersRelations = relations(offers, ({ one, many }) => ({
  application: one(applications, { fields: [offers.applicationId], references: [applications.id] }),
  job: one(jobs, { fields: [offers.jobId], references: [jobs.id] }),
  candidate: one(candidates, { fields: [offers.candidateId], references: [candidates.id] }),
  template: one(offerTemplates, { fields: [offers.templateId], references: [offerTemplates.id] }),
  documents: many(offerDocuments),
  signatures: many(offerSignatures),
  messages: many(offerMessages),
  edits: many(offerLetterEdits),
}));

export const approvalsRelations = relations(approvals, ({ many }) => ({
  steps: many(approvalSteps),
}));

export const screeningsRelations = relations(screenings, ({ many, one }) => ({
  turns: many(screeningTurns),
  scores: many(screeningScores),
  application: one(applications, { fields: [screenings.applicationId], references: [applications.id] }),
}));

export const interviewsRelations = relations(interviews, ({ many, one }) => ({
  panel: many(interviewPanel),
  application: one(applications, { fields: [interviews.applicationId], references: [applications.id] }),
}));
