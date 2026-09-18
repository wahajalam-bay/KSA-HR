CREATE TYPE "public"."account_kind" AS ENUM('staff', 'person');--> statement-breakpoint
CREATE TYPE "public"."account_role" AS ENUM('staff', 'hiring_manager', 'participant');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('active', 'on_hold', 'rejected', 'withdrawn', 'hired');--> statement-breakpoint
CREATE TYPE "public"."approval_state" AS ENUM('draft', 'pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_step_state" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."approval_subject" AS ENUM('requisition', 'offer');--> statement-breakpoint
CREATE TYPE "public"."approver_type" AS ENUM('role', 'hiring_manager', 'dept_head', 'staff', 'named');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('invited', 'in_progress', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."assessment_verdict" AS ENUM('strong', 'mixed', 'concern');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'read', 'action');--> statement-breakpoint
CREATE TYPE "public"."automation_run_state" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('scheduled', 'in_progress', 'completed', 'no_answer', 'declined', 'failed');--> statement-breakpoint
CREATE TYPE "public"."channel_state" AS ENUM('not_posted', 'live', 'expired');--> statement-breakpoint
CREATE TYPE "public"."comm_channel" AS ENUM('Email', 'WhatsApp', 'SMS', 'LinkedIn', 'Internal', 'Voice');--> statement-breakpoint
CREATE TYPE "public"."comm_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."comm_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'opened', 'read', 'replied', 'failed', 'bounced', 'not_configured');--> statement-breakpoint
CREATE TYPE "public"."condition_op" AS ENUM('gt', 'gte', 'lt', 'lte', 'eq');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('missing', 'uploaded', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."employee_source" AS ENUM('hire', 'existing', 'imported');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('onboarding', 'active', 'left');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'intern');--> statement-breakpoint
CREATE TYPE "public"."evaluation_verdict" AS ENUM('strong_yes', 'yes', 'no', 'strong_no');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('cv', 'photo', 'offer_template', 'offer_letter', 'signed_offer', 'candidate_document', 'onboarding_document', 'recording', 'transcript', 'import', 'export', 'other');--> statement-breakpoint
CREATE TYPE "public"."integration_health" AS ENUM('ok', 'degraded', 'down', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('calendar', 'email', 'whatsapp', 'sms', 'esign', 'voice', 'hris', 'assessment', 'job_board', 'ai', 'storage');--> statement-breakpoint
CREATE TYPE "public"."integration_state" AS ENUM('connected', 'not_configured', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."job_priority" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."job_queue_state" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('draft', 'pending_approval', 'open', 'on_hold', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_party" AS ENUM('candidate', 'staff');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('mention', 'evaluation', 'application', 'offer', 'sla', 'interview', 'approval', 'joiner', 'notice', 'file', 'question', 'assessment', 'feedback', 'claim', 'ivreview', 'probation', 'automation', 'integration');--> statement-breakpoint
CREATE TYPE "public"."offer_response_state" AS ENUM('accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."offer_state" AS ENUM('draft', 'pending_approval', 'approved', 'sent', 'viewed', 'signed', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."pitch_status" AS ENUM('not_sent', 'sent', 'scheduled', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pitch_verdict" AS ENUM('strong', 'fair', 'weak');--> statement-breakpoint
CREATE TYPE "public"."position_kind" AS ENUM('leadership', 'management', 'role');--> statement-breakpoint
CREATE TYPE "public"."position_plan_state" AS ENUM('pending', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."probation_state" AS ENUM('in_progress', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('cv', 'experience_section', 'education_section', 'skills_section', 'languages_section', 'personal_section', 'email_address', 'ai', 'recruiter', 'screening', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('yesno', 'choice', 'multi', 'short', 'long', 'number');--> statement-breakpoint
CREATE TYPE "public"."reference_status" AS ENUM('pending', 'contacted', 'done', 'declined');--> statement-breakpoint
CREATE TYPE "public"."review_rating" AS ENUM('up', 'down', 'star');--> statement-breakpoint
CREATE TYPE "public"."scan_state" AS ENUM('pending', 'clean', 'infected', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."scope_kind" AS ENUM('all', 'own', 'jobs');--> statement-breakpoint
CREATE TYPE "public"."screening_channel" AS ENUM('WhatsApp', 'Careers site', 'AI phone');--> statement-breakpoint
CREATE TYPE "public"."screening_status" AS ENUM('invited', 'scheduled', 'calling', 'running', 'no_answer', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."screening_verdict" AS ENUM('pass', 'review', 'fail');--> statement-breakpoint
CREATE TYPE "public"."signer_state" AS ENUM('not_sent', 'sent', 'viewed', 'signed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."sourcing_route" AS ENUM('internal', 'hunt', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('tal_lead', 'recruiter', 'sourcer', 'coordinator', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'inactive', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."stage_key" AS ENUM('applied', 'sourced', 'screen', 'assessment', 'iv1', 'iv2', 'pitch', 'ivf', 'offer', 'joined');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('entry', 'screen', 'assess', 'iv', 'offer', 'closed');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('chase_feedback', 'verify_offer', 'offer_question', 'assessment', 'reference', 'joining', 'onboarding', 'probation', 'screening', 'sla', 'generic');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('high', 'normal', 'low');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "account_kind" NOT NULL,
	"staff_id" text,
	"name" text NOT NULL,
	"title" text,
	"email" text NOT NULL,
	"role" "account_role" NOT NULL,
	"status" "account_status" DEFAULT 'invited' NOT NULL,
	"password_hash" text,
	"password_set_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"oidc_subject" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"scope_kind" "scope_kind" DEFAULT 'own' NOT NULL,
	"scope_job_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope_own" boolean DEFAULT true NOT NULL,
	"source" text,
	"invited_by" text,
	"invited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"function_id" text,
	"head" text,
	"head_title" text,
	"headcount" integer,
	"cost_centre" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_code" text NOT NULL,
	"name" text NOT NULL,
	"gender" text,
	"candidate_id" text,
	"application_id" text,
	"offer_id" text,
	"job_id" text,
	"position_code" text,
	"dept_id" text NOT NULL,
	"title" text NOT NULL,
	"location_id" text,
	"start_date" date NOT NULL,
	"status" "employee_status" DEFAULT 'onboarding' NOT NULL,
	"source" "employee_source" NOT NULL,
	"left_on" date,
	"left_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "functions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"head" text,
	"head_title" text,
	"hue" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"month" text PRIMARY KEY NOT NULL,
	"hires" integer DEFAULT 0 NOT NULL,
	"time_to_hire_days" integer,
	"cost_per_hire_sar" integer,
	"offer_accept_rate" text,
	"quality_of_hire" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "joining_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"team_key" text NOT NULL,
	"start_date" date,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" text NOT NULL,
	"to_name" text,
	"to_email" text,
	"cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"form_included" boolean DEFAULT false NOT NULL,
	"message_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"region" text NOT NULL,
	"office" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"is_remote" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notified_team_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notified_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"short" text NOT NULL,
	"name" text NOT NULL,
	"dept_id" text,
	"purpose" text,
	"ask" text,
	"on_joining" boolean DEFAULT true NOT NULL,
	"on_file" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"status" "document_status" DEFAULT 'missing' NOT NULL,
	"file_id" text,
	"uploaded_at" timestamp with time zone,
	"uploaded_by" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"rejected_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_records" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"form_sent_at" timestamp with time zone,
	"form_submitted_at" timestamp with time zone,
	"national_id" text,
	"nationality" text,
	"dob" date,
	"address" text,
	"emergency_contact" text,
	"bank" text,
	"iban" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_settings" (
	"id" text PRIMARY KEY DEFAULT 'org' NOT NULL,
	"org_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"currency_symbol" text DEFAULT 'SAR' NOT NULL,
	"country" text DEFAULT 'Saudi Arabia' NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"weekend_days" integer[] DEFAULT ARRAY[5,6] NOT NULL,
	"workday_start_min" integer DEFAULT 540 NOT NULL,
	"workday_end_min" integer DEFAULT 1080 NOT NULL,
	"fiscal_year_start" text DEFAULT 'January' NOT NULL,
	"locale" text DEFAULT 'en-SA' NOT NULL,
	"second_locale" text DEFAULT 'ar-SA' NOT NULL,
	"data_retention_months" integer DEFAULT 24 NOT NULL,
	"brand_primary" text DEFAULT '#0E9E62' NOT NULL,
	"brand_accent" text DEFAULT '#C98A16' NOT NULL,
	"brand_note" text,
	"offer_approval_threshold" integer DEFAULT 30000 NOT NULL,
	"leader_name" text,
	"leader_title" text,
	"signed_by" text,
	"ats_owner" text,
	"hris_name" text,
	"probation_months" integer DEFAULT 3 NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"dept_id" text NOT NULL,
	"function_id" text,
	"grade" text,
	"reports_to_id" text,
	"reports_to_function_id" text,
	"plan_state" "position_plan_state" DEFAULT 'approved' NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"requested" integer DEFAULT 0 NOT NULL,
	"job_id" text,
	"location_id" text,
	"kind" "position_kind" DEFAULT 'role' NOT NULL,
	"holder_name" text,
	"holder_gender" text,
	"imported_from" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "probation_records" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"months" integer DEFAULT 3 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"state" "probation_state" DEFAULT 'in_progress' NOT NULL,
	"decided_on" date,
	"decided_by" text,
	"decided_by_name" text,
	"reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_references" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"company" text,
	"relationship" text,
	"contact" text,
	"status" "reference_status" DEFAULT 'pending' NOT NULL,
	"rating" text,
	"notes" text,
	"contacted_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"acting_staff_id" text,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"role_label" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"gender" text,
	"location_id" text,
	"dept_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"monthly_target" integer DEFAULT 0 NOT NULL,
	"lifetime_hires" integer DEFAULT 0 NOT NULL,
	"joined_on" date,
	"hue" integer DEFAULT 1 NOT NULL,
	"seniority" text,
	"placeholder_name" boolean DEFAULT false NOT NULL,
	"photo" text,
	"photo_file_id" text,
	"portrait_style" text,
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"handed_over_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"question_id" text,
	"question_text" text NOT NULL,
	"answer" text,
	"knockout_miss" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"from_stage" "stage_key",
	"to_stage" "stage_key" NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status",
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"source" text DEFAULT 'action' NOT NULL,
	"reason" text,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"recruiter_id" text,
	"sourcer_id" text,
	"stage" "stage_key" DEFAULT 'applied' NOT NULL,
	"status" "application_status" DEFAULT 'active' NOT NULL,
	"source" text NOT NULL,
	"referrer" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" numeric(3, 1),
	"disqualify_reason" text,
	"closed_at" timestamp with time zone,
	"start_date" date,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"fit_score" integer,
	"fit_band" text,
	"fit_model" text,
	"fit_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_resumes" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"file_id" text,
	"file_name" text,
	"size_kb" integer,
	"pages" integer,
	"parsed" boolean DEFAULT false NOT NULL,
	"confidence" numeric(4, 3),
	"has_text_layer" boolean DEFAULT true NOT NULL,
	"summary" text,
	"raw_text" text,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certs" text[] DEFAULT '{}'::text[] NOT NULL,
	"field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photo_found" boolean DEFAULT false NOT NULL,
	"photo_meta" jsonb,
	"parser_version" text,
	"parsed_by" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"skill" text NOT NULL,
	"level" numeric(3, 1),
	"years" integer,
	"source" "provenance" DEFAULT 'cv' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gender" text,
	"email" text,
	"email_key" text,
	"phone" text,
	"phone_key" text,
	"location_city" text,
	"nationality" text,
	"family" text,
	"headline" text,
	"current_title" text,
	"current_company" text,
	"sector" text,
	"sector_source" "provenance",
	"years_experience" integer,
	"notice_days" integer,
	"expected_salary" integer,
	"current_salary" integer,
	"current_salary_source" "provenance",
	"current_salary_at" timestamp with time zone,
	"linkedin" text,
	"portfolio" text,
	"hue" integer DEFAULT 1 NOT NULL,
	"photo" text,
	"photo_file_id" text,
	"photo_at" timestamp with time zone,
	"consent_until" date,
	"claim_by" text,
	"claim_by_name" text,
	"claim_at" timestamp with time zone,
	"claim_days" integer,
	"claim_note" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"anonymised_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text,
	"candidate_id" text NOT NULL,
	"job_id" text,
	"author_id" text,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cross_links" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"application_a" text NOT NULL,
	"application_b" text NOT NULL,
	"matched_on" text[] DEFAULT '{}'::text[] NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evaluation_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"name" text NOT NULL,
	"score" integer,
	"weight" numeric(4, 2) DEFAULT '1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "evaluation_criteria_score_ck" CHECK ("evaluation_criteria"."score" IS NULL OR "evaluation_criteria"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"interview_id" text,
	"stage" "stage_key" NOT NULL,
	"evaluator_id" text,
	"evaluator_name" text NOT NULL,
	"overall" numeric(3, 1),
	"verdict" "evaluation_verdict",
	"comment" text,
	"submitted" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone,
	"at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hashtags" (
	"id" text PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_kits" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text,
	"name" text NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"channel" text NOT NULL,
	"state" "channel_state" DEFAULT 'not_posted' NOT NULL,
	"external_id" text,
	"posted_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_hiring_managers" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"is_lead" boolean DEFAULT false NOT NULL,
	"account_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"bank_id" text,
	"text" text NOT NULL,
	"type" "question_type" NOT NULL,
	"options" text[],
	"required" boolean DEFAULT false NOT NULL,
	"knockout" text,
	"ordinal" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"skill" text NOT NULL,
	"level" integer DEFAULT 3 NOT NULL,
	"must" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "job_skills_level_ck" CHECK ("job_skills"."level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"stage_key" "stage_key" NOT NULL,
	"name" text NOT NULL,
	"sla" integer NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "job_stages_sla_ck" CHECK ("job_stages"."sla" BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"dept_id" text NOT NULL,
	"location_id" text NOT NULL,
	"pipeline_id" text,
	"position_code" text,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"priority" "job_priority" DEFAULT 'normal' NOT NULL,
	"openings" integer DEFAULT 1 NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"salary_min" integer DEFAULT 0 NOT NULL,
	"salary_max" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"family" text NOT NULL,
	"recruiter_id" text,
	"sourcer_id" text,
	"coordinator_id" text,
	"hiring_manager" text,
	"panel" text[] DEFAULT '{}'::text[] NOT NULL,
	"opened_on" date,
	"target_start_on" date,
	"closed_on" date,
	"closed_by" text,
	"remote_ok" boolean DEFAULT false NOT NULL,
	"headcount_ref" text,
	"budgeted" boolean DEFAULT true NOT NULL,
	"budget_note" text,
	"approved_by" text,
	"sourcing_internal" boolean DEFAULT false NOT NULL,
	"sourcing_hunt" boolean DEFAULT false NOT NULL,
	"sourcing_linkedin" boolean DEFAULT true NOT NULL,
	"sourcing_note" text,
	"pitch_on" boolean DEFAULT false NOT NULL,
	"pitch_project_id" text,
	"pitch_channels" text[] DEFAULT ARRAY['whatsapp','email']::text[] NOT NULL,
	"pitch_lead_hours" integer,
	"pitch_note" text,
	"desc_summary" text,
	"desc_responsibilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"desc_requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"desc_benefits" text[] DEFAULT '{}'::text[] NOT NULL,
	"desc_updated_at" timestamp with time zone,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "jobs_band_ck" CHECK ("jobs"."salary_max" >= "jobs"."salary_min"),
	CONSTRAINT "jobs_openings_ck" CHECK ("jobs"."openings" >= 1),
	CONSTRAINT "jobs_filled_ck" CHECK ("jobs"."filled" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"off_stages" text[] DEFAULT '{}'::text[] NOT NULL,
	"sells" boolean DEFAULT false NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sla_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "question_bank" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"type" "question_type" NOT NULL,
	"options" text[],
	"required" boolean DEFAULT false NOT NULL,
	"knockout" text,
	"families" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_standard" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"job_id" text NOT NULL,
	"rating" "review_rating" NOT NULL,
	"text" text,
	"by_id" text,
	"by_name" text NOT NULL,
	"by_email" text,
	"stage" "stage_key",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"route" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stages" (
	"key" "stage_key" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short" text NOT NULL,
	"default_sla" integer NOT NULL,
	"kind" "stage_kind" NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"ordinal" integer NOT NULL,
	"fixed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "talent_pool_members" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "talent_pools" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_flow_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"label" text NOT NULL,
	"approver_type" "approver_type" NOT NULL,
	"approver_role" text,
	"approver_staff_id" text,
	"approver_name" text,
	"approver_title" text,
	"approver_email" text,
	"cond_field" text,
	"cond_op" "condition_op",
	"cond_value" integer,
	"auto" boolean DEFAULT false NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" "approval_subject" NOT NULL,
	"name" text NOT NULL,
	"publish_on_approve" boolean DEFAULT true NOT NULL,
	"publish_channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"require_verification" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_id" text NOT NULL,
	"step_key" text NOT NULL,
	"label" text NOT NULL,
	"approver_type" "approver_type" NOT NULL,
	"approver_role" text,
	"approver_staff_id" text,
	"approver_name" text,
	"approver_title" text,
	"approver_email" text,
	"condition_text" text,
	"auto" boolean DEFAULT false NOT NULL,
	"state" "approval_step_state" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_by_name" text,
	"on_behalf_of" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" "approval_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"flow_id" text,
	"flow_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "approval_state" DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"requested_by_name" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"superseded_by_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"job_id" text NOT NULL,
	"kind" text DEFAULT 'behavioural' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" "assessment_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by" text,
	"completed_at" timestamp with time zone,
	"score" integer,
	"traits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdict" "assessment_verdict",
	"summary" text,
	"report_file_id" text,
	"report_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_panel" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"account_id" text,
	"is_hiring_manager" boolean DEFAULT false NOT NULL,
	"responded" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"stage" "stage_key" NOT NULL,
	"title" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 45 NOT NULL,
	"mode" text NOT NULL,
	"interviewer" text,
	"organiser_id" text,
	"status" "interview_status" DEFAULT 'scheduled' NOT NULL,
	"location" text,
	"meeting_url" text,
	"calendar_provider" text,
	"calendar_event_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"rescheduled_from_id" text,
	"recorded" boolean DEFAULT false NOT NULL,
	"recording_file_id" text,
	"recording_ref" text,
	"minutes" integer,
	"analysis" jsonb,
	"reviewer_score" integer,
	"reviewer_ratings" jsonb,
	"reviewer_strengths" text[],
	"reviewer_improve" text[],
	"reviewer_model" text,
	"reviewed_at" timestamp with time zone,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interviews_duration_ck" CHECK ("interviews"."duration_min" BETWEEN 5 AND 480)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"status" "document_status" DEFAULT 'missing' NOT NULL,
	"file_id" text,
	"uploaded_at" timestamp with time zone,
	"uploaded_by" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_letter_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"by_id" text,
	"by_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"application_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"from_party" "message_party" NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"message_id" text,
	"read_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'Candidate' NOT NULL,
	"state" "signer_state" DEFAULT 'not_sent' NOT NULL,
	"provider_recipient_id" text,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_reason" text,
	"ip_address" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"family" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"file_id" text,
	"file_name" text,
	"file_type" text,
	"size_kb" integer,
	"lang" text DEFAULT 'en' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"detected_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"application_id" text NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" text,
	"base_monthly" integer NOT NULL,
	"housing" integer DEFAULT 0 NOT NULL,
	"transport" integer DEFAULT 0 NOT NULL,
	"annual_bonus_pct" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"start_date" date NOT NULL,
	"state" "offer_state" DEFAULT 'draft' NOT NULL,
	"template_id" text,
	"template_name" text,
	"letter_override" text,
	"field_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"verified_note" text,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"esign_provider" text,
	"esign_envelope_id" text,
	"esign_status" text,
	"generated_file_id" text,
	"signed_file_id" text,
	"response_state" "offer_response_state",
	"response_at" timestamp with time zone,
	"response_by" text,
	"response_reason" text,
	"response_note" text,
	"response_source" text,
	"version_lock" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_money_ck" CHECK ("offers"."base_monthly" > 0 AND "offers"."housing" >= 0 AND "offers"."transport" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pitch_config" (
	"id" text PRIMARY KEY DEFAULT 'pitch_cfg' NOT NULL,
	"lead_hours" integer DEFAULT 24 NOT NULL,
	"channels" text[] DEFAULT ARRAY['whatsapp','email']::text[] NOT NULL,
	"gate_final" boolean DEFAULT true NOT NULL,
	"wa_template" text NOT NULL,
	"email_subject" text NOT NULL,
	"email_body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pitch_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"who" text,
	"client" text,
	"brief" text NOT NULL,
	"task" text NOT NULL,
	"duration_min" integer DEFAULT 20 NOT NULL,
	"prep_hours" integer DEFAULT 24 NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pitch_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"pitch_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"score" integer NOT NULL,
	"max" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pitch_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"pitch_id" text NOT NULL,
	"who" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pitches" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"job_id" text NOT NULL,
	"project_id" text,
	"status" "pitch_status" DEFAULT 'not_sent' NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_whatsapp" text,
	"sent_email" text,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_min" integer,
	"total" integer,
	"max" integer,
	"score" integer,
	"verdict" "pitch_verdict",
	"summary" text,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"gaps" text[] DEFAULT '{}'::text[] NOT NULL,
	"model" text,
	"recording_file_id" text,
	"recording_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screening_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"screening_id" text NOT NULL,
	"key" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"score" integer NOT NULL,
	"max" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screening_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"screening_id" text NOT NULL,
	"who" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screenings" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"job_id" text NOT NULL,
	"channel" "screening_channel" NOT NULL,
	"status" "screening_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total" integer,
	"max" integer,
	"score" integer,
	"verdict" "screening_verdict",
	"summary" text,
	"captured_current_salary" integer,
	"captured_expected_salary" integer,
	"captured_notice_days" integer,
	"captured_source" text,
	"captured_by" text,
	"captured_at" timestamp with time zone,
	"captured_quote" text,
	"call_direction" text,
	"call_phone" text,
	"call_language" text,
	"call_voice" text,
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"call_consent" boolean,
	"call_scheduled_for" timestamp with time zone,
	"call_started_at" timestamp with time zone,
	"call_ended_at" timestamp with time zone,
	"call_next_attempt_at" timestamp with time zone,
	"call_duration_sec" integer,
	"call_outcome" "call_outcome",
	"call_provider" text,
	"call_provider_ref" text,
	"call_recording_file_id" text,
	"call_transcript_confidence" numeric(4, 3),
	"call_clarity" integer,
	"call_fluency" integer,
	"call_engagement" integer,
	"analysis" jsonb,
	"interviewer_review" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"actor_role" text,
	"actor_account_id" text,
	"on_behalf_of_id" text,
	"on_behalf_of_name" text,
	"action" "audit_action" NOT NULL,
	"summary" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_label" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"source" text DEFAULT 'ui' NOT NULL,
	"request_id" text,
	"correlation_id" text,
	"ip" text,
	"user_agent" text,
	"session_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"dedupe_window_minutes" integer,
	"last_run_at" timestamp with time zone,
	"runs_30d" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"event_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"state" "automation_run_state" DEFAULT 'pending' NOT NULL,
	"conditions_met" boolean,
	"skipped_reason" text,
	"actions_run" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"correlation_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stage" text,
	"lang" text DEFAULT 'en' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"account_id" text,
	"actor_name" text,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "file_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"storage_driver" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"supersedes_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"scan_state" "scan_state" DEFAULT 'pending' NOT NULL,
	"scan_result" text,
	"scanned_at" timestamp with time zone,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "files_size_ck" CHECK ("files"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"provider" text,
	"state" "integration_state" DEFAULT 'not_configured' NOT NULL,
	"health" "integration_health" DEFAULT 'unknown' NOT NULL,
	"detail" text,
	"missing_config" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_check_at" timestamp with time zone,
	"last_error" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "job_queue_state" DEFAULT 'pending' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"last_error" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text,
	"correlation_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"candidate_id" text,
	"application_id" text,
	"job_id" text,
	"title" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"application_id" text,
	"candidate_id" text,
	"job_id" text,
	"employee_id" text,
	"channel" "comm_channel" NOT NULL,
	"direction" "comm_direction" NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"from_name" text,
	"from_address" text,
	"to_name" text,
	"to_address" text,
	"cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"template_id" text,
	"provider" text,
	"provider_message_id" text,
	"status" "comm_status" DEFAULT 'queued' NOT NULL,
	"status_detail" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"author_id" text,
	"idempotency_key" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"text" text NOT NULL,
	"recipient_account_id" text,
	"recipient_staff_id" text,
	"application_id" text,
	"job_id" text,
	"candidate_id" text,
	"employee_id" text,
	"offer_id" text,
	"link" text,
	"read_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_date" text NOT NULL,
	"job_id" text,
	"dept_id" text,
	"stage" text NOT NULL,
	"live_count" integer DEFAULT 0 NOT NULL,
	"entered_count" integer DEFAULT 0 NOT NULL,
	"exited_count" integer DEFAULT 0 NOT NULL,
	"breached_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"actor_name" text,
	"question" text NOT NULL,
	"resolved_spec" jsonb,
	"resolved_by" text DEFAULT 'grammar' NOT NULL,
	"row_count" integer,
	"duration_ms" integer,
	"scope_applied" text,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"question" text,
	"spec" jsonb NOT NULL,
	"owner_id" text,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "task_kind" NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"application_id" text,
	"job_id" text,
	"candidate_id" text,
	"employee_id" text,
	"offer_id" text,
	"assignee_id" text,
	"assignee_account_id" text,
	"due_on" timestamp with time zone,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"external_id" text,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"process_result" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "departments" ADD CONSTRAINT "departments_function_id_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."functions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employees" ADD CONSTRAINT "employees_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "joining_notices" ADD CONSTRAINT "joining_notices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notified_team_contacts" ADD CONSTRAINT "notified_team_contacts_team_id_notified_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."notified_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notified_teams" ADD CONSTRAINT "notified_teams_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_function_id_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."functions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_reports_to_function_id_functions_id_fk" FOREIGN KEY ("reports_to_function_id") REFERENCES "public"."functions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "probation_records" ADD CONSTRAINT "probation_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_references" ADD CONSTRAINT "employee_references_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_staff_id_staff_id_fk" FOREIGN KEY ("acting_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff" ADD CONSTRAINT "staff_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_stage_history" ADD CONSTRAINT "application_stage_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_recruiter_id_staff_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_sourcer_id_staff_id_fk" FOREIGN KEY ("sourcer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_resumes" ADD CONSTRAINT "candidate_resumes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidates" ADD CONSTRAINT "candidates_claim_by_staff_id_fk" FOREIGN KEY ("claim_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_links" ADD CONSTRAINT "cross_links_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_links" ADD CONSTRAINT "cross_links_application_a_applications_id_fk" FOREIGN KEY ("application_a") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_links" ADD CONSTRAINT "cross_links_application_b_applications_id_fk" FOREIGN KEY ("application_b") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evaluation_criteria" ADD CONSTRAINT "evaluation_criteria_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interview_kits" ADD CONSTRAINT "interview_kits_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_channels" ADD CONSTRAINT "job_channels_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_hiring_managers" ADD CONSTRAINT "job_hiring_managers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_questions" ADD CONSTRAINT "job_questions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_questions" ADD CONSTRAINT "job_questions_bank_id_question_bank_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."question_bank"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_stages" ADD CONSTRAINT "job_stages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_recruiter_id_staff_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sourcer_id_staff_id_fk" FOREIGN KEY ("sourcer_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_coordinator_id_staff_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_pool_id_talent_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."talent_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "talent_pools" ADD CONSTRAINT "talent_pools_owner_id_staff_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_flow_steps" ADD CONSTRAINT "approval_flow_steps_flow_id_approval_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."approval_flows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_flow_steps" ADD CONSTRAINT "approval_flow_steps_approver_staff_id_staff_id_fk" FOREIGN KEY ("approver_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_flow_id_approval_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."approval_flows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interview_panel" ADD CONSTRAINT "interview_panel_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interviews" ADD CONSTRAINT "interviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organiser_id_staff_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_documents" ADD CONSTRAINT "offer_documents_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_letter_edits" ADD CONSTRAINT "offer_letter_edits_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_messages" ADD CONSTRAINT "offer_messages_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_messages" ADD CONSTRAINT "offer_messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_messages" ADD CONSTRAINT "offer_messages_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_signatures" ADD CONSTRAINT "offer_signatures_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_template_id_offer_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."offer_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pitch_scores" ADD CONSTRAINT "pitch_scores_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pitch_turns" ADD CONSTRAINT "pitch_turns_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pitches" ADD CONSTRAINT "pitches_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pitches" ADD CONSTRAINT "pitches_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pitches" ADD CONSTRAINT "pitches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pitches" ADD CONSTRAINT "pitches_project_id_pitch_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."pitch_projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_scores" ADD CONSTRAINT "screening_scores_screening_id_screenings_id_fk" FOREIGN KEY ("screening_id") REFERENCES "public"."screenings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_turns" ADD CONSTRAINT "screening_turns_screening_id_screenings_id_fk" FOREIGN KEY ("screening_id") REFERENCES "public"."screenings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screenings" ADD CONSTRAINT "screenings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screenings" ADD CONSTRAINT "screenings_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screenings" ADD CONSTRAINT "screenings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_access_log" ADD CONSTRAINT "file_access_log_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_account_id_accounts_id_fk" FOREIGN KEY ("recipient_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_staff_id_staff_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_owner_id_staff_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_staff_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_account_id_accounts_id_fk" FOREIGN KEY ("assignee_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_email_uq" ON "accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_oidc_uq" ON "accounts" USING btree ("oidc_subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_staff_idx" ON "accounts" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_role_idx" ON "accounts" USING btree ("role","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "departments_code_uq" ON "departments" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "departments_name_uq" ON "departments" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "departments_function_idx" ON "departments" USING btree ("function_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employees_code_uq" ON "employees" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employees_application_uq" ON "employees" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employees_offer_uq" ON "employees" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_dept_idx" ON "employees" USING btree ("dept_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_position_idx" ON "employees" USING btree ("position_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_candidate_idx" ON "employees" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_start_idx" ON "employees" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "functions_code_uq" ON "functions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "functions_name_uq" ON "functions" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "joining_notices_emp_idx" ON "joining_notices" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locations_city_office_uq" ON "locations" USING btree ("city","office");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_lookup_idx" ON "login_attempts" USING btree (lower("email"),"ip","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notified_team_contacts_team_idx" ON "notified_team_contacts" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notified_teams_key_uq" ON "notified_teams" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_documents_uq" ON "onboarding_documents" USING btree ("employee_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_records_employee_uq" ON "onboarding_records" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "positions_code_uq" ON "positions" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_dept_idx" ON "positions" USING btree ("dept_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_reports_idx" ON "positions" USING btree ("reports_to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_job_idx" ON "positions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_plan_idx" ON "positions" USING btree ("plan_state");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "probation_records_employee_uq" ON "probation_records" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "probation_records_ends_idx" ON "probation_records" USING btree ("ends_on","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_references_emp_idx" ON "employee_references" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_account_idx" ON "sessions" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_email_uq" ON "staff" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_role_idx" ON "staff" USING btree ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_answers_app_idx" ON "application_answers" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_stage_history_app_idx" ON "application_stage_history" USING btree ("application_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_stage_history_seq_uq" ON "application_stage_history" USING btree ("application_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_stage_history_idem_uq" ON "application_stage_history" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_stage_history_at_idx" ON "application_stage_history" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "applications_reference_uq" ON "applications" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "applications_live_uq" ON "applications" USING btree ("job_id","candidate_id") WHERE status IN ('active','on_hold');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_job_idx" ON "applications" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_candidate_idx" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_stage_idx" ON "applications" USING btree ("stage","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_recruiter_idx" ON "applications" USING btree ("recruiter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_applied_idx" ON "applications" USING btree ("applied_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_closed_idx" ON "applications" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_resumes_cand_idx" ON "candidate_resumes" USING btree ("candidate_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_resumes_current_uq" ON "candidate_resumes" USING btree ("candidate_id") WHERE "candidate_resumes"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_skills_uq" ON "candidate_skills" USING btree ("candidate_id",lower("skill"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_skills_skill_idx" ON "candidate_skills" USING btree (lower("skill"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_email_idx" ON "candidates" USING btree ("email_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_phone_idx" ON "candidates" USING btree ("phone_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_name_trgm" ON "candidates" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_company_trgm" ON "candidates" USING gin ("current_company" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_claim_idx" ON "candidates" USING btree ("claim_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_app_idx" ON "comments" USING btree ("application_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_cand_idx" ON "comments" USING btree ("candidate_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cross_links_uq" ON "cross_links" USING btree ("application_a","application_b");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cross_links_cand_idx" ON "cross_links" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluation_criteria_eval_idx" ON "evaluation_criteria" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_app_idx" ON "evaluations" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_job_idx" ON "evaluations" USING btree ("job_id","submitted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluations_evaluator_idx" ON "evaluations" USING btree ("evaluator_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hashtags_tag_uq" ON "hashtags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_channels_uq" ON "job_channels" USING btree ("job_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_hiring_managers_job_idx" ON "job_hiring_managers" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_hiring_managers_lead_uq" ON "job_hiring_managers" USING btree ("job_id") WHERE "job_hiring_managers"."is_lead";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_questions_job_idx" ON "job_questions" USING btree ("job_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_skills_uq" ON "job_skills" USING btree ("job_id",lower("skill"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_stages_uq" ON "job_stages" USING btree ("job_id","stage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_stages_job_idx" ON "job_stages" USING btree ("job_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_reference_uq" ON "jobs" USING btree ("reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_dept_idx" ON "jobs" USING btree ("dept_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_recruiter_idx" ON "jobs" USING btree ("recruiter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_position_idx" ON "jobs" USING btree ("position_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_title_trgm" ON "jobs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipelines_name_uq" ON "pipelines" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_reviewer_uq" ON "reviews" USING btree ("application_id",coalesce("by_id", lower("by_name")));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_app_idx" ON "reviews" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sources_name_uq" ON "sources" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stages_ordinal_uq" ON "stages" USING btree ("ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "talent_pool_members_uq" ON "talent_pool_members" USING btree ("pool_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_flow_steps_flow_idx" ON "approval_flow_steps" USING btree ("flow_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_flow_steps_ord_uq" ON "approval_flow_steps" USING btree ("flow_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_flows_active_uq" ON "approval_flows" USING btree ("subject") WHERE "approval_flows"."is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_steps_approval_idx" ON "approval_steps" USING btree ("approval_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_steps_ord_uq" ON "approval_steps" USING btree ("approval_id","ordinal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_subject_idx" ON "approvals" USING btree ("subject","subject_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvals_open_uq" ON "approvals" USING btree ("subject","subject_id") WHERE state = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assessments_app_uq" ON "assessments" USING btree ("application_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assessments_provider_uq" ON "assessments" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interview_panel_iv_idx" ON "interview_panel" USING btree ("interview_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "interview_panel_uq" ON "interview_panel" USING btree ("interview_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interviews_app_idx" ON "interviews" USING btree ("application_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interviews_at_idx" ON "interviews" USING btree ("at","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interviews_job_idx" ON "interviews" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "interviews_calendar_uq" ON "interviews" USING btree ("calendar_provider","calendar_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_documents_uq" ON "offer_documents" USING btree ("offer_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_letter_edits_offer_idx" ON "offer_letter_edits" USING btree ("offer_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_messages_offer_idx" ON "offer_messages" USING btree ("offer_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_messages_app_idx" ON "offer_messages" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_signatures_offer_idx" ON "offer_signatures" USING btree ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_templates_default_uq" ON "offer_templates" USING btree ((1)) WHERE is_default AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_templates_family_uq" ON "offer_templates" USING btree ("family") WHERE family IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_reference_uq" ON "offers" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_app_version_uq" ON "offers" USING btree ("application_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_app_idx" ON "offers" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_state_idx" ON "offers" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_sent_idx" ON "offers" USING btree ("sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_envelope_uq" ON "offers" USING btree ("esign_envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pitch_scores_uq" ON "pitch_scores" USING btree ("pitch_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pitch_turns_uq" ON "pitch_turns" USING btree ("pitch_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pitches_app_uq" ON "pitches" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screening_scores_uq" ON "screening_scores" USING btree ("screening_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screening_turns_uq" ON "screening_turns" USING btree ("screening_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screenings_app_idx" ON "screenings" USING btree ("application_id","invited_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screenings_status_idx" ON "screenings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screenings_provider_uq" ON "screenings" USING btree ("call_provider_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_request_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_rules_trigger_idx" ON "automation_rules" USING btree ("trigger","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_runs_idem_uq" ON "automation_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_state_idx" ON "automation_runs" USING btree ("state") WHERE state IN ('pending','running');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_type_idx" ON "domain_events" USING btree ("type","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_subject_idx" ON "domain_events" USING btree ("subject_type","subject_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_pending_idx" ON "domain_events" USING btree ("at") WHERE dispatched_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_events_idem_uq" ON "domain_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_access_log_file_idx" ON "file_access_log" USING btree ("file_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "files_storage_key_uq" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_owner_idx" ON "files" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_sha_idx" ON "files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_scan_idx" ON "files" USING btree ("scan_state") WHERE scan_state = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_retain_idx" ON "files" USING btree ("retain_until") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_key_uq" ON "integrations" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_queue_pickup_idx" ON "job_queue" USING btree ("state","run_after") WHERE state = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_queue_dedupe_uq" ON "job_queue" USING btree ("dedupe_key") WHERE state IN ('pending','running');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_queue_kind_idx" ON "job_queue" USING btree ("kind","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_threads_subject_idx" ON "message_threads" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_threads_app_idx" ON "message_threads" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_app_idx" ON "messages" USING btree ("application_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_candidate_idx" ON "messages" USING btree ("candidate_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_provider_uq" ON "messages" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_idem_uq" ON "messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_status_idx" ON "messages" USING btree ("status") WHERE status IN ('queued','sending');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_idx" ON "notifications" USING btree ("recipient_account_id","read_at","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_staff_idx" ON "notifications" USING btree ("recipient_staff_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_snapshots_uq" ON "pipeline_snapshots" USING btree ("snapshot_date","job_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_snapshots_date_idx" ON "pipeline_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_requests_at_idx" ON "report_requests" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","done","due_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_app_idx" ON "tasks" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_dedupe_uq" ON "tasks" USING btree ("dedupe_key") WHERE done = false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_external_uq" ON "webhook_events" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_pending_idx" ON "webhook_events" USING btree ("received_at") WHERE processed_at IS NULL;