import { pgEnum } from 'drizzle-orm/pg-core';

/* ── Every closed vocabulary in the product, as a database enum ──────────────
   The prototype carried these as bare strings; a typo in a string is a silent
   data bug, so each one becomes a type the database enforces. The values are
   exactly the prototype's, so a migrated record reads the same. ───────────── */

/* Who a person is to the platform. The prototype's `accounts.role`. */
export const accountRole = pgEnum('account_role', ['staff', 'hiring_manager', 'participant']);
export const accountStatus = pgEnum('account_status', ['invited', 'active', 'disabled']);
export const accountKind = pgEnum('account_kind', ['staff', 'person']);

/* The TA team's own roles — the prototype's `staff.role`. `tal_lead` is Admin. */
export const staffRole = pgEnum('staff_role', [
  'tal_lead', 'recruiter', 'sourcer', 'coordinator', 'onboarding', 'analyst',
]);
export const staffStatus = pgEnum('staff_status', ['active', 'inactive', 'deleted']);

/* Access by position (Settings → Access). */
export const scopeKind = pgEnum('scope_kind', ['all', 'own', 'jobs']);

/* The ten-stage spine. Fixed order; a requisition may rename or skip, never reorder. */
export const stageKey = pgEnum('stage_key', [
  'applied', 'sourced', 'screen', 'assessment', 'iv1', 'iv2', 'pitch', 'ivf', 'offer', 'joined',
]);
export const stageKind = pgEnum('stage_kind', ['entry', 'screen', 'assess', 'iv', 'offer', 'closed']);

export const jobStatus = pgEnum('job_status', [
  'draft', 'pending_approval', 'open', 'on_hold', 'closed',
]);
export const jobPriority = pgEnum('job_priority', ['critical', 'high', 'normal', 'low']);
export const employmentType = pgEnum('employment_type', ['full_time', 'part_time', 'contract', 'intern']);
export const channelState = pgEnum('channel_state', ['not_posted', 'live', 'expired']);
export const sourcingRoute = pgEnum('sourcing_route', ['internal', 'hunt', 'linkedin']);

export const applicationStatus = pgEnum('application_status', [
  'active', 'on_hold', 'rejected', 'withdrawn', 'hired',
]);

/* Approvals — one engine, two subjects. */
export const approvalSubject = pgEnum('approval_subject', ['requisition', 'offer']);
export const approvalState = pgEnum('approval_state', ['draft', 'pending', 'approved', 'rejected', 'cancelled']);
export const approvalStepState = pgEnum('approval_step_state', ['pending', 'approved', 'rejected', 'skipped']);
export const approverType = pgEnum('approver_type', ['role', 'hiring_manager', 'dept_head', 'staff', 'named']);
export const conditionOp = pgEnum('condition_op', ['gt', 'gte', 'lt', 'lte', 'eq']);

export const offerState = pgEnum('offer_state', [
  'draft', 'pending_approval', 'approved', 'sent', 'viewed', 'signed',
  'accepted', 'declined', 'expired', 'withdrawn',
]);
export const offerResponseState = pgEnum('offer_response_state', ['accepted', 'declined']);
export const signerState = pgEnum('signer_state', ['not_sent', 'sent', 'viewed', 'signed', 'declined']);
export const documentStatus = pgEnum('document_status', ['missing', 'uploaded', 'verified', 'rejected']);
export const messageParty = pgEnum('message_party', ['candidate', 'staff']);

export const screeningChannel = pgEnum('screening_channel', ['WhatsApp', 'Careers site', 'AI phone']);
export const screeningStatus = pgEnum('screening_status', [
  'invited', 'scheduled', 'calling', 'running', 'no_answer', 'completed', 'cancelled',
]);
export const screeningVerdict = pgEnum('screening_verdict', ['pass', 'review', 'fail']);
export const callOutcome = pgEnum('call_outcome', [
  'scheduled', 'in_progress', 'completed', 'no_answer', 'declined', 'failed',
]);

export const interviewStatus = pgEnum('interview_status', [
  'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show',
]);
export const evaluationVerdict = pgEnum('evaluation_verdict', ['strong_yes', 'yes', 'no', 'strong_no']);
export const reviewRating = pgEnum('review_rating', ['up', 'down', 'star']);

export const assessmentStatus = pgEnum('assessment_status', ['invited', 'in_progress', 'completed', 'expired']);
export const assessmentVerdict = pgEnum('assessment_verdict', ['strong', 'mixed', 'concern']);

export const pitchStatus = pgEnum('pitch_status', [
  'not_sent', 'sent', 'scheduled', 'running', 'completed', 'cancelled',
]);
export const pitchVerdict = pgEnum('pitch_verdict', ['strong', 'fair', 'weak']);

export const employeeStatus = pgEnum('employee_status', ['onboarding', 'active', 'left']);
export const employeeSource = pgEnum('employee_source', ['hire', 'existing', 'imported']);
export const probationState = pgEnum('probation_state', ['in_progress', 'passed', 'failed']);
export const referenceStatus = pgEnum('reference_status', ['pending', 'contacted', 'done', 'declined']);

export const positionPlanState = pgEnum('position_plan_state', ['pending', 'approved', 'retired']);
export const positionKind = pgEnum('position_kind', ['leadership', 'management', 'role']);

/* Communication. Channels are what the product sends on; direction and delivery
   state are what the provider reports back. */
export const commChannel = pgEnum('comm_channel', ['Email', 'WhatsApp', 'SMS', 'LinkedIn', 'Internal', 'Voice']);
export const commDirection = pgEnum('comm_direction', ['out', 'in']);
export const commStatus = pgEnum('comm_status', [
  'queued', 'sending', 'sent', 'delivered', 'opened', 'read', 'replied', 'failed', 'bounced', 'not_configured',
]);

export const taskKind = pgEnum('task_kind', [
  'chase_feedback', 'verify_offer', 'offer_question', 'assessment', 'reference',
  'joining', 'onboarding', 'probation', 'screening', 'sla', 'generic',
  /* Added in 0002 — the kinds the desk actually raises. */
  'review_cv', 'schedule', 'screen_call', 'send_offer', 'sourcing', 'reject',
  'interview', 'document',
]);
export const taskPriority = pgEnum('task_priority', ['high', 'normal', 'low']);

export const notificationKind = pgEnum('notification_kind', [
  'mention', 'evaluation', 'application', 'offer', 'sla', 'interview', 'approval',
  'joiner', 'notice', 'file', 'question', 'assessment', 'feedback', 'claim',
  'ivreview', 'probation', 'automation', 'integration',
]);

export const integrationKind = pgEnum('integration_kind', [
  'calendar', 'email', 'whatsapp', 'sms', 'esign', 'voice', 'hris', 'assessment', 'job_board', 'ai', 'storage',
]);
export const integrationState = pgEnum('integration_state', ['connected', 'not_configured', 'error', 'disabled']);
export const integrationHealth = pgEnum('integration_health', ['ok', 'degraded', 'down', 'unknown']);

export const automationRunState = pgEnum('automation_run_state', [
  'pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled',
]);
export const jobQueueState = pgEnum('job_queue_state', [
  'pending', 'running', 'succeeded', 'failed', 'dead',
]);

export const fileKind = pgEnum('file_kind', [
  'cv', 'photo', 'offer_template', 'offer_letter', 'signed_offer', 'candidate_document',
  'onboarding_document', 'recording', 'transcript', 'import', 'export', 'other',
]);
export const scanState = pgEnum('scan_state', ['pending', 'clean', 'infected', 'skipped', 'error']);

export const questionType = pgEnum('question_type', ['yesno', 'choice', 'multi', 'short', 'long', 'number']);

export const provenance = pgEnum('provenance', [
  'cv', 'experience_section', 'education_section', 'skills_section', 'languages_section',
  'personal_section', 'email_address', 'ai', 'recruiter', 'screening', 'not_found',
]);

export const auditAction = pgEnum('audit_action', ['create', 'update', 'delete', 'read', 'action']);
