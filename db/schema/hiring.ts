import {
  pgTable, text, integer, boolean, timestamp, date, uniqueIndex, index,
  jsonb, numeric, check,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import {
  stageKey, stageKind, jobStatus, jobPriority, employmentType, channelState,
  applicationStatus, evaluationVerdict, reviewRating, questionType, provenance,
} from './enums';
import { departments, functions, locations, staff, positions } from './org';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());

/* ─────────────────────────────────────────────────────────────────────────────
   The stage spine. Ten rows, fixed order, seeded once. Applied and Sourced are
   alternative entries; Offer and Joined are the way out; everything between is
   the recruiter's to pick per requisition.
   ───────────────────────────────────────────────────────────────────────────*/
export const stages = pgTable('stages', {
  key: stageKey('key').primaryKey(),
  name: text('name').notNull(),
  short: text('short').notNull(),
  defaultSla: integer('default_sla').notNull(),
  kind: stageKind('kind').notNull(),
  optional: boolean('optional').notNull().default(false),
  /* Position on the spine. Nothing may reorder these. */
  ordinal: integer('ordinal').notNull(),
  /* The four the recruiter may not switch off. */
  fixed: boolean('fixed').notNull().default(false),
}, (t) => ({
  ordUq: uniqueIndex('stages_ordinal_uq').on(t.ordinal),
}));

export const pipelines = pgTable('pipelines', {
  id: id(),
  name: text('name').notNull(),
  /* Stages this template leaves off. */
  offStages: text('off_stages').array().notNull().default(sql`'{}'::text[]`),
  sells: boolean('sells').notNull().default(false),
  /* { screen: 'Recruiter Screen', iv1: '1st Interview', … } */
  labels: jsonb('labels').$type<Record<string, string>>().notNull().default({}),
  slaOverrides: jsonb('sla_overrides').$type<Record<string, number>>().notNull().default({}),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /* The order this list is maintained and read in; see
     db/migrations/0009_pipeline_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameUq: uniqueIndex('pipelines_name_uq').on(t.name),
  orderIdx: index('pipelines_order_idx').on(t.sortOrder, t.id),
}));

export const sources = pgTable('sources', {
  id: id(),
  name: text('name').notNull(),
  route: text('route').notNull(),      // internal | hunt | linkedin
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => ({
  nameUq: uniqueIndex('sources_name_uq').on(t.name),
}));

export const hashtags = pgTable('hashtags', {
  id: id(),
  tag: text('tag').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({ tagUq: uniqueIndex('hashtags_tag_uq').on(t.tag) }));

/* ── Requisitions ───────────────────────────────────────────────────────────*/
export const jobs = pgTable('jobs', {
  id: id(),
  reference: text('reference').notNull(),          // REQ-YYYY-NNNN
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  deptId: text('dept_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  locationId: text('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  pipelineId: text('pipeline_id').references(() => pipelines.id, { onDelete: 'set null' }),
  positionCode: text('position_code'),
  employmentType: employmentType('employment_type').notNull().default('full_time'),
  status: jobStatus('status').notNull().default('draft'),
  priority: jobPriority('priority').notNull().default('normal'),
  openings: integer('openings').notNull().default(1),
  filled: integer('filled').notNull().default(0),
  salaryMin: integer('salary_min').notNull().default(0),
  salaryMax: integer('salary_max').notNull().default(0),
  currency: text('currency').notNull().default('SAR'),
  /* The function's name, denormalised because the product speaks of "family". */
  family: text('family').notNull(),
  recruiterId: text('recruiter_id').references(() => staff.id, { onDelete: 'set null' }),
  sourcerId: text('sourcer_id').references(() => staff.id, { onDelete: 'set null' }),
  coordinatorId: text('coordinator_id').references(() => staff.id, { onDelete: 'set null' }),
  /* The lead hiring manager's name, kept in step with job_hiring_managers.lead
     by a trigger, because the offer letter and the approval chain name it. */
  hiringManager: text('hiring_manager'),
  panel: text('panel').array().notNull().default(sql`'{}'::text[]`),
  openedOn: date('opened_on'),
  targetStartOn: date('target_start_on'),
  closedOn: date('closed_on'),
  closedBy: text('closed_by'),
  remoteOk: boolean('remote_ok').notNull().default(false),
  headcountRef: text('headcount_ref'),
  budgeted: boolean('budgeted').notNull().default(true),
  budgetNote: text('budget_note'),
  approvedBy: text('approved_by'),
  /* How it gets filled. */
  sourcingInternal: boolean('sourcing_internal').notNull().default(false),
  sourcingHunt: boolean('sourcing_hunt').notNull().default(false),
  sourcingLinkedin: boolean('sourcing_linkedin').notNull().default(true),
  sourcingNote: text('sourcing_note'),
  /* Sales Pitch configuration, per requisition. */
  pitchOn: boolean('pitch_on').notNull().default(false),
  pitchProjectId: text('pitch_project_id'),
  pitchChannels: text('pitch_channels').array().notNull().default(sql`ARRAY['whatsapp','email']::text[]`),
  pitchLeadHours: integer('pitch_lead_hours'),
  pitchNote: text('pitch_note'),
  /* The job description. */
  descSummary: text('desc_summary'),
  descResponsibilities: text('desc_responsibilities').array().notNull().default(sql`'{}'::text[]`),
  descRequirements: text('desc_requirements').array().notNull().default(sql`'{}'::text[]`),
  descBenefits: text('desc_benefits').array().notNull().default(sql`'{}'::text[]`),
  descUpdatedAt: timestamp('desc_updated_at', { withTimezone: true }),
  hashtags: text('hashtags').array().notNull().default(sql`'{}'::text[]`),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /* Optimistic locking: every write asserts the version it read. */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
}, (t) => ({
  refUq: uniqueIndex('jobs_reference_uq').on(t.reference),
  deptIdx: index('jobs_dept_idx').on(t.deptId, t.status),
  recIdx: index('jobs_recruiter_idx').on(t.recruiterId),
  statusIdx: index('jobs_status_idx').on(t.status),
  posIdx: index('jobs_position_idx').on(t.positionCode),
  titleTrgm: index('jobs_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
  bandCk: check('jobs_band_ck', sql`${t.salaryMax} >= ${t.salaryMin}`),
  openingsCk: check('jobs_openings_ck', sql`${t.openings} >= 1`),
  filledCk: check('jobs_filled_ck', sql`${t.filled} >= 0`),
}));

/* One row per hiring manager on a requisition; exactly one is the lead. */
export const jobHiringManagers = pgTable('job_hiring_managers', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title'),
  email: text('email'),
  isLead: boolean('is_lead').notNull().default(false),
  accountId: text('account_id'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  jobIdx: index('job_hiring_managers_job_idx').on(t.jobId),
  /* At most one lead per requisition. */
  leadUq: uniqueIndex('job_hiring_managers_lead_uq').on(t.jobId).where(sql`${t.isLead}`),
}));

/* The loop this requisition actually runs. */
export const jobStages = pgTable('job_stages', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  stageKey: stageKey('stage_key').notNull(),
  name: text('name').notNull(),
  sla: integer('sla').notNull(),
  ordinal: integer('ordinal').notNull(),
}, (t) => ({
  uq: uniqueIndex('job_stages_uq').on(t.jobId, t.stageKey),
  jobIdx: index('job_stages_job_idx').on(t.jobId, t.ordinal),
  slaCk: check('job_stages_sla_ck', sql`${t.sla} BETWEEN 1 AND 60`),
}));

/* The skill bar: what the description asks for, and how hard. */
export const jobSkills = pgTable('job_skills', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  skill: text('skill').notNull(),
  level: integer('level').notNull().default(3),
  must: boolean('must').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  uq: uniqueIndex('job_skills_uq').on(t.jobId, sql`lower(${t.skill})`),
  levelCk: check('job_skills_level_ck', sql`${t.level} BETWEEN 1 AND 5`),
}));

/* Where a requisition is advertised. */
export const jobChannels = pgTable('job_channels', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  state: channelState('state').notNull().default('not_posted'),
  externalId: text('external_id'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  lastError: text('last_error'),
}, (t) => ({
  uq: uniqueIndex('job_channels_uq').on(t.jobId, t.channel),
}));

/* ── Application questions ──────────────────────────────────────────────────*/
export const questionBank = pgTable('question_bank', {
  id: id(),
  text: text('text').notNull(),
  type: questionType('type').notNull(),
  options: text('options').array(),
  required: boolean('required').notNull().default(false),
  knockout: text('knockout'),
  families: text('families').array().notNull().default(sql`'{}'::text[]`),
  isStandard: boolean('is_standard').notNull().default(false),
  /* The bank is an editorial list: the questions every requisition asks come
     first, then the ones a family adds. */
  sortOrder: integer('sort_order').notNull().default(1000),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('question_bank_order_idx').on(t.sortOrder, t.id),
}));

export const jobQuestions = pgTable('job_questions', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  bankId: text('bank_id').references(() => questionBank.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  type: questionType('type').notNull(),
  options: text('options').array(),
  required: boolean('required').notNull().default(false),
  knockout: text('knockout'),
  ordinal: integer('ordinal').notNull().default(0),
}, (t) => ({
  jobIdx: index('job_questions_job_idx').on(t.jobId, t.ordinal),
}));

/* ── Candidates ─────────────────────────────────────────────────────────────*/
export const candidates = pgTable('candidates', {
  id: id(),
  name: text('name').notNull(),
  gender: text('gender'),
  email: text('email'),
  /* Normalised keys are what duplicate detection matches on. */
  emailKey: text('email_key'),
  phone: text('phone'),
  phoneKey: text('phone_key'),
  locationCity: text('location_city'),
  nationality: text('nationality'),
  family: text('family'),
  headline: text('headline'),
  currentTitle: text('current_title'),
  currentCompany: text('current_company'),
  sector: text('sector'),
  sectorSource: provenance('sector_source'),
  yearsExperience: integer('years_experience'),
  noticeDays: integer('notice_days'),
  expectedSalary: integer('expected_salary'),
  currentSalary: integer('current_salary'),
  currentSalarySource: provenance('current_salary_source'),
  currentSalaryAt: timestamp('current_salary_at', { withTimezone: true }),
  linkedin: text('linkedin'),
  portfolio: text('portfolio'),
  hue: integer('hue').notNull().default(1),
  /* 'cv' when the picture came out of the résumé; null when there was none. */
  photo: text('photo'),
  photoFileId: text('photo_file_id'),
  photoAt: timestamp('photo_at', { withTimezone: true }),
  consentUntil: date('consent_until'),
  /* Recruiter tag — the prototype's `claim`. */
  claimBy: text('claim_by').references(() => staff.id, { onDelete: 'set null' }),
  claimByName: text('claim_by_name'),
  claimAt: timestamp('claim_at', { withTimezone: true }),
  claimDays: integer('claim_days'),
  claimNote: text('claim_note'),
  /* Résumé metadata; the parsed detail lives in candidate_resumes. */
  hashtags: text('hashtags').array().notNull().default(sql`'{}'::text[]`),
  anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: index('candidates_email_idx').on(t.emailKey),
  phoneIdx: index('candidates_phone_idx').on(t.phoneKey),
  nameTrgm: index('candidates_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  companyTrgm: index('candidates_company_trgm').using('gin', sql`${t.currentCompany} gin_trgm_ops`),
  claimIdx: index('candidates_claim_idx').on(t.claimBy),
}));

export const candidateSkills = pgTable('candidate_skills', {
  id: id(),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  skill: text('skill').notNull(),
  /* 1–5, from where the skill sits on the CV and how long they have worked. */
  level: numeric('level', { precision: 3, scale: 1 }),
  years: integer('years'),
  source: provenance('source').notNull().default('cv'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  uq: uniqueIndex('candidate_skills_uq').on(t.candidateId, sql`lower(${t.skill})`),
  skillIdx: index('candidate_skills_skill_idx').on(sql`lower(${t.skill})`),
}));

/* The parsed résumé. One current row per candidate; supersedes on re-upload,
   and the original file is never overwritten. */
export const candidateResumes = pgTable('candidate_resumes', {
  id: id(),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  fileId: text('file_id'),
  fileName: text('file_name'),
  sizeKb: integer('size_kb'),
  pages: integer('pages'),
  parsed: boolean('parsed').notNull().default(false),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),
  hasTextLayer: boolean('has_text_layer').notNull().default(true),
  summary: text('summary'),
  rawText: text('raw_text'),
  /* Sections the reader recognised, the roles, the schools, the languages. */
  sections: jsonb('sections').$type<string[]>().notNull().default([]),
  experience: jsonb('experience').$type<Array<{
    title: string; company: string; city?: string; from?: string; to?: string;
    current?: boolean; bullets: string[];
  }>>().notNull().default([]),
  education: jsonb('education').$type<Array<{ degree: string; school: string; year?: number }>>()
    .notNull().default([]),
  languages: jsonb('languages').$type<Array<{ name: string; level: string }>>().notNull().default([]),
  certs: text('certs').array().notNull().default(sql`'{}'::text[]`),
  /* Where each parsed field came from — the provenance grid the intake sheet
     shows before anything is created. */
  fieldSources: jsonb('field_sources').$type<Record<string, string>>().notNull().default({}),
  photoFound: boolean('photo_found').notNull().default(false),
  photoMeta: jsonb('photo_meta').$type<Record<string, unknown>>(),
  parserVersion: text('parser_version'),
  parsedBy: text('parsed_by'),        // 'local' | 'ai'
  isCurrent: boolean('is_current').notNull().default(true),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: text('uploaded_by'),
}, (t) => ({
  candIdx: index('candidate_resumes_cand_idx').on(t.candidateId, t.isCurrent),
  currentUq: uniqueIndex('candidate_resumes_current_uq').on(t.candidateId).where(sql`${t.isCurrent}`),
}));

export const talentPools = pgTable('talent_pools', {
  id: id(),
  name: text('name').notNull(),
  filter: jsonb('filter').$type<Record<string, unknown>>().notNull().default({}),
  ownerId: text('owner_id').references(() => staff.id, { onDelete: 'set null' }),
  /* The grid's order: the order they were built in, so it does not reshuffle
     when somebody renames one. New pools append. */
  sortOrder: integer('sort_order').notNull().default(1000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const talentPoolMembers = pgTable('talent_pool_members', {
  id: id(),
  poolId: text('pool_id').notNull().references(() => talentPools.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  addedBy: text('added_by'),
}, (t) => ({
  uq: uniqueIndex('talent_pool_members_uq').on(t.poolId, t.candidateId),
}));

/* ── Applications: candidate × requisition ──────────────────────────────────*/
export const applications = pgTable('applications', {
  id: id(),
  reference: text('reference').notNull(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'restrict' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'restrict' }),
  recruiterId: text('recruiter_id').references(() => staff.id, { onDelete: 'set null' }),
  sourcerId: text('sourcer_id').references(() => staff.id, { onDelete: 'set null' }),
  stage: stageKey('stage').notNull().default('applied'),
  status: applicationStatus('status').notNull().default('active'),
  source: text('source').notNull(),
  referrer: text('referrer'),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
  rating: numeric('rating', { precision: 3, scale: 1 }),
  disqualifyReason: text('disqualify_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  startDate: date('start_date'),
  hashtags: text('hashtags').array().notNull().default(sql`'{}'::text[]`),
  /* CV fit against this requisition's description, cached on write. */
  fitScore: integer('fit_score'),
  fitBand: text('fit_band'),
  fitModel: text('fit_model'),
  fitAt: timestamp('fit_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  refUq: uniqueIndex('applications_reference_uq').on(t.reference),
  /* One live application per person per requisition: the guard against a
     double application from the careers form and a recruiter at the same time. */
  liveUq: uniqueIndex('applications_live_uq').on(t.jobId, t.candidateId)
    .where(sql`status IN ('active','on_hold')`),
  jobIdx: index('applications_job_idx').on(t.jobId, t.status),
  candIdx: index('applications_candidate_idx').on(t.candidateId),
  stageIdx: index('applications_stage_idx').on(t.stage, t.status),
  recIdx: index('applications_recruiter_idx').on(t.recruiterId),
  appliedIdx: index('applications_applied_idx').on(t.appliedAt),
  closedIdx: index('applications_closed_idx').on(t.closedAt),
}));

/* Append-only stage history. Every transition, with who and why. A trigger
   forbids UPDATE and DELETE. */
export const applicationStageHistory = pgTable('application_stage_history', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  fromStage: stageKey('from_stage'),
  toStage: stageKey('to_stage').notNull(),
  fromStatus: applicationStatus('from_status'),
  toStatus: applicationStatus('to_status'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  /* 'drag' | 'advance' | 'move' | 'offer' | 'automation' | 'import' | 'seed' */
  source: text('source').notNull().default('action'),
  reason: text('reason'),
  note: text('note'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  /* Guards a replayed action from writing the same hop twice. */
  idempotencyKey: text('idempotency_key'),
  seq: integer('seq').notNull(),
}, (t) => ({
  appIdx: index('application_stage_history_app_idx').on(t.applicationId, t.seq),
  seqUq: uniqueIndex('application_stage_history_seq_uq').on(t.applicationId, t.seq),
  idemUq: uniqueIndex('application_stage_history_idem_uq').on(t.idempotencyKey),
  atIdx: index('application_stage_history_at_idx').on(t.at),
}));

export const applicationAnswers = pgTable('application_answers', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  questionId: text('question_id'),
  questionText: text('question_text').notNull(),
  answer: text('answer'),
  knockoutMiss: boolean('knockout_miss').notNull().default(false),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appIdx: index('application_answers_app_idx').on(t.applicationId),
}));

/* Same person, more than one live application. */
export const crossLinks = pgTable('cross_links', {
  id: id(),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  applicationA: text('application_a').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  applicationB: text('application_b').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  matchedOn: text('matched_on').array().notNull().default(sql`'{}'::text[]`),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex('cross_links_uq').on(t.applicationA, t.applicationB),
  candIdx: index('cross_links_cand_idx').on(t.candidateId),
}));

/* ── Feedback ───────────────────────────────────────────────────────────────*/
export const evaluations = pgTable('evaluations', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  interviewId: text('interview_id'),
  stage: stageKey('stage').notNull(),
  evaluatorId: text('evaluator_id'),
  evaluatorName: text('evaluator_name').notNull(),
  overall: numeric('overall', { precision: 3, scale: 1 }),
  verdict: evaluationVerdict('verdict'),
  comment: text('comment'),
  submitted: boolean('submitted').notNull().default(false),
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  at: timestamp('at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appIdx: index('evaluations_app_idx').on(t.applicationId),
  jobIdx: index('evaluations_job_idx').on(t.jobId, t.submitted),
  evalIdx: index('evaluations_evaluator_idx').on(t.evaluatorId),
}));

export const evaluationCriteria = pgTable('evaluation_criteria', {
  id: id(),
  evaluationId: text('evaluation_id').notNull().references(() => evaluations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  score: integer('score'),
  weight: numeric('weight', { precision: 4, scale: 2 }).notNull().default('1'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  evalIdx: index('evaluation_criteria_eval_idx').on(t.evaluationId),
  scoreCk: check('evaluation_criteria_score_ck', sql`${t.score} IS NULL OR ${t.score} BETWEEN 1 AND 5`),
}));

/* The quick read: thumbs up, thumbs down or a star. One per reviewer per
   application — a second one replaces the first. */
export const reviews = pgTable('reviews', {
  id: id(),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  rating: reviewRating('rating').notNull(),
  text: text('text'),
  byId: text('by_id'),
  byName: text('by_name').notNull(),
  byEmail: text('by_email'),
  stage: stageKey('stage'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex('reviews_reviewer_uq').on(t.applicationId, sql`coalesce(${t.byId}, lower(${t.byName}))`),
  appIdx: index('reviews_app_idx').on(t.applicationId),
}));

export const comments = pgTable('comments', {
  id: id(),
  applicationId: text('application_id').references(() => applications.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  authorId: text('author_id'),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  mentions: text('mentions').array().notNull().default(sql`'{}'::text[]`),
  pinned: boolean('pinned').notNull().default(false),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
}, (t) => ({
  appIdx: index('comments_app_idx').on(t.applicationId, t.at),
  candIdx: index('comments_cand_idx').on(t.candidateId, t.at),
}));

export const interviewKits = pgTable('interview_kits', {
  id: id(),
  pipelineId: text('pipeline_id').references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  criteria: jsonb('criteria').$type<Array<{ name: string; weight: number; guidance?: string }>>()
    .notNull().default([]),
  questions: text('questions').array().notNull().default(sql`'{}'::text[]`),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /* The order this list is maintained and read in; see
     db/migrations/0006_list_order.sql. */
  sortOrder: integer('sort_order').notNull().default(1000),
});

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  department: one(departments, { fields: [jobs.deptId], references: [departments.id] }),
  location: one(locations, { fields: [jobs.locationId], references: [locations.id] }),
  pipeline: one(pipelines, { fields: [jobs.pipelineId], references: [pipelines.id] }),
  recruiter: one(staff, { fields: [jobs.recruiterId], references: [staff.id] }),
  hiringManagers: many(jobHiringManagers),
  stages: many(jobStages),
  skills: many(jobSkills),
  channels: many(jobChannels),
  questions: many(jobQuestions),
  applications: many(applications),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  job: one(jobs, { fields: [applications.jobId], references: [jobs.id] }),
  candidate: one(candidates, { fields: [applications.candidateId], references: [candidates.id] }),
  recruiter: one(staff, { fields: [applications.recruiterId], references: [staff.id] }),
  history: many(applicationStageHistory),
  answers: many(applicationAnswers),
  evaluations: many(evaluations),
  comments: many(comments),
  reviews: many(reviews),
}));

export const candidatesRelations = relations(candidates, ({ many, one }) => ({
  applications: many(applications),
  skills: many(candidateSkills),
  resume: one(candidateResumes, { fields: [candidates.id], references: [candidateResumes.candidateId] }),
}));
