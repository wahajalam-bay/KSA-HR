# Database

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

PostgreSQL 16. 84 tables, 57 enumerated types,
151 unique indexes, 10 check constraints and
34 triggers — read out of the live schema, so this is what the
database actually holds rather than what anybody believes it holds.

## The rules the database itself enforces

The product checks these, and so does the database. Anything that can corrupt
the record if it happens twice is stopped in both places, because a race the
application loses is still a race.

| Rule | How |
| --- | --- |
| One candidate per human | Unique on the normalised e-mail key, and on the last nine digits of the phone |
| One application per candidate per requisition | Unique on `(candidate_id, job_id)` |
| One employee per accepted offer | Unique on `offer_id` in `employees` |
| One employee number, ever | Unique on `employee_code` |
| One lead hiring manager per requisition | Partial unique index on `job_hiring_managers` |
| One live claim per candidate | The claim lives on the candidate row |
| One scorecard per reviewer per application | Unique on `(application_id, coalesce(by_id, lower(by_name)))` |
| Nobody signs the same offer twice | Unique on the signature, and the state machine refuses |
| The audit trail is append-only | A trigger that raises on `UPDATE` and `DELETE` |
| Two people cannot be hired into one seat | Seat arithmetic checked against `positions.approved` |

## Enumerated types

An enum is a closed vocabulary. A value the product invents that is not on this
list is refused by the database, which is the point.

| Type | Values |
| --- | --- |
| `account_kind` | `staff` `person` |
| `account_role` | `staff` `hiring_manager` `participant` |
| `account_status` | `invited` `active` `disabled` |
| `application_status` | `active` `on_hold` `rejected` `withdrawn` `hired` |
| `approval_state` | `draft` `pending` `approved` `rejected` `cancelled` |
| `approval_step_state` | `pending` `approved` `rejected` `skipped` |
| `approval_subject` | `requisition` `offer` |
| `approver_type` | `role` `hiring_manager` `dept_head` `staff` `named` |
| `assessment_status` | `invited` `in_progress` `completed` `expired` |
| `assessment_verdict` | `strong` `mixed` `concern` |
| `audit_action` | `create` `update` `delete` `read` `action` |
| `automation_run_state` | `pending` `running` `succeeded` `failed` `skipped` `cancelled` |
| `call_outcome` | `scheduled` `in_progress` `completed` `no_answer` `declined` `failed` |
| `channel_state` | `not_posted` `live` `expired` |
| `comm_channel` | `Email` `WhatsApp` `SMS` `LinkedIn` `Internal` `Voice` |
| `comm_direction` | `out` `in` |
| `comm_status` | `queued` `sending` `sent` `delivered` `opened` `read` `replied` `failed` `bounced` `not_configured` |
| `condition_op` | `gt` `gte` `lt` `lte` `eq` |
| `document_status` | `missing` `uploaded` `verified` `rejected` |
| `employee_source` | `hire` `existing` `imported` |
| `employee_status` | `onboarding` `active` `left` |
| `employment_type` | `full_time` `part_time` `contract` `intern` |
| `evaluation_verdict` | `strong_yes` `yes` `no` `strong_no` |
| `file_kind` | `cv` `photo` `offer_template` `offer_letter` `signed_offer` `candidate_document` `onboarding_document` `recording` `transcript` `import` `export` `other` |
| `integration_health` | `ok` `degraded` `down` `unknown` |
| `integration_kind` | `calendar` `email` `whatsapp` `sms` `esign` `voice` `hris` `assessment` `job_board` `ai` `storage` |
| `integration_state` | `connected` `not_configured` `error` `disabled` |
| `interview_status` | `scheduled` `confirmed` `completed` `cancelled` `no_show` |
| `job_priority` | `critical` `high` `normal` `low` |
| `job_queue_state` | `pending` `running` `succeeded` `failed` `dead` |
| `job_status` | `draft` `pending_approval` `open` `on_hold` `closed` |
| `message_party` | `candidate` `staff` |
| `notification_kind` | `mention` `evaluation` `application` `offer` `sla` `interview` `approval` `joiner` `notice` `file` `question` `assessment` `feedback` `claim` `ivreview` `probation` `automation` `integration` |
| `offer_response_state` | `accepted` `declined` |
| `offer_state` | `draft` `pending_approval` `approved` `sent` `viewed` `signed` `accepted` `declined` `expired` `withdrawn` |
| `pitch_status` | `not_sent` `sent` `scheduled` `running` `completed` `cancelled` |
| `pitch_verdict` | `strong` `fair` `weak` |
| `position_kind` | `leadership` `management` `role` |
| `position_plan_state` | `pending` `approved` `retired` |
| `probation_state` | `in_progress` `passed` `failed` |
| `provenance` | `cv` `experience_section` `education_section` `skills_section` `languages_section` `personal_section` `email_address` `ai` `recruiter` `screening` `not_found` |
| `question_type` | `yesno` `choice` `multi` `short` `long` `number` |
| `reference_status` | `pending` `contacted` `done` `declined` |
| `review_rating` | `up` `down` `star` |
| `scan_state` | `pending` `clean` `infected` `skipped` `error` |
| `scope_kind` | `all` `own` `jobs` |
| `screening_channel` | `WhatsApp` `Careers site` `AI phone` |
| `screening_status` | `invited` `scheduled` `calling` `running` `no_answer` `completed` `cancelled` |
| `screening_verdict` | `pass` `review` `fail` |
| `signer_state` | `not_sent` `sent` `viewed` `signed` `declined` |
| `sourcing_route` | `internal` `hunt` `linkedin` |
| `staff_role` | `tal_lead` `recruiter` `sourcer` `coordinator` `onboarding` `analyst` |
| `staff_status` | `active` `inactive` `deleted` |
| `stage_key` | `applied` `sourced` `screen` `assessment` `iv1` `iv2` `pitch` `ivf` `offer` `joined` |
| `stage_kind` | `entry` `screen` `assess` `iv` `offer` `closed` |
| `task_kind` | `chase_feedback` `verify_offer` `offer_question` `assessment` `reference` `joining` `onboarding` `probation` `screening` `sla` `generic` `review_cv` `schedule` `screen_call` `send_offer` `sourcing` `reject` `interview` `document` |
| `task_priority` | `high` `normal` `low` |

## Every table

### `access_links`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `token_hash` | text | not null |  |  |
| `purpose` | text | not null |  |  |
| `subject_type` | text | not null |  |  |
| `subject_id` | text | not null |  |  |
| `candidate_id` | text |  |  | → `candidates.id` *(on delete cascade)* |
| `application_id` | text |  |  | → `applications.id` *(on delete cascade)* |
| `expires_at` | timestamptz |  |  |  |
| `max_uses` | integer |  |  |  |
| `uses` | integer | not null | `0` |  |
| `first_used_at` | timestamptz |  |  |  |
| `last_used_at` | timestamptz |  |  |  |
| `last_used_ip` | text |  |  |  |
| `revoked_at` | timestamptz |  |  |  |
| `revoked_by` | text |  |  |  |
| `created_by` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `access_links_pkey` — (id)
- `access_links_token_uq` — (token_hash)

**Checks**

- `access_links_uses_ck` — CHECK (((max_uses IS NULL) OR (uses <= max_uses)))

### `accounts`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `kind` | account_kind *(enum)* | not null |  |  |
| `staff_id` | text |  |  | → `staff.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `title` | text |  |  |  |
| `email` | text | not null |  |  |
| `role` | account_role *(enum)* | not null |  |  |
| `status` | account_status *(enum)* | not null | `'invited'` |  |
| `password_hash` | text |  |  |  |
| `password_set_at` | timestamptz |  |  |  |
| `must_change_password` | boolean | not null | `false` |  |
| `oidc_subject` | text |  |  |  |
| `failed_attempts` | integer | not null | `0` |  |
| `locked_until` | timestamptz |  |  |  |
| `last_login_at` | timestamptz |  |  |  |
| `last_login_ip` | text |  |  |  |
| `scope_kind` | scope_kind *(enum)* | not null | `'own'` |  |
| `scope_job_ids` | text[] | not null | `'{}'` |  |
| `scope_own` | boolean | not null | `true` |  |
| `source` | text |  |  |  |
| `invited_by` | text |  |  |  |
| `invited_at` | timestamptz |  |  |  |
| `removed_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `accounts_email_uq` — (lower(email))
- `accounts_oidc_uq` — (oidc_subject)
- `accounts_pkey` — (id)

**Triggers**

- `accounts_touch`

**Referenced by** `notifications`, `sessions`, `tasks`

### `application_answers`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `question_id` | text |  |  |  |
| `question_text` | text | not null |  |  |
| `answer` | text |  |  |  |
| `knockout_miss` | boolean | not null | `false` |  |
| `answered_at` | timestamptz | not null | `now()` |  |

**Unique**

- `application_answers_pkey` — (id)

### `application_stage_history`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `from_stage` | stage_key *(enum)* |  |  |  |
| `to_stage` | stage_key *(enum)* | not null |  |  |
| `from_status` | application_status *(enum)* |  |  |  |
| `to_status` | application_status *(enum)* |  |  |  |
| `at` | timestamptz | not null | `now()` |  |
| `actor_id` | text |  |  |  |
| `actor_name` | text |  |  |  |
| `source` | text | not null | `'action'` |  |
| `reason` | text |  |  |  |
| `note` | text |  |  |  |
| `metadata` | jsonb | not null | `'{}'` |  |
| `idempotency_key` | text |  |  |  |
| `seq` | integer | not null |  |  |

**Unique**

- `application_stage_history_idem_uq` — (idempotency_key)
- `application_stage_history_pkey` — (id)
- `application_stage_history_seq_uq` — (application_id, seq)

**Triggers**

- `application_stage_history_append_only`
- `application_stage_history_seq`

### `applications`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `reference` | text | not null |  |  |
| `job_id` | text | not null |  | → `jobs.id` *(on delete restrict)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete restrict)* |
| `recruiter_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `sourcer_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `stage` | stage_key *(enum)* | not null | `'applied'` |  |
| `status` | application_status *(enum)* | not null | `'active'` |  |
| `source` | text | not null |  |  |
| `referrer` | text |  |  |  |
| `applied_at` | timestamptz | not null | `now()` |  |
| `stage_entered_at` | timestamptz | not null | `now()` |  |
| `rating` | numeric |  |  |  |
| `disqualify_reason` | text |  |  |  |
| `closed_at` | timestamptz |  |  |  |
| `start_date` | date |  |  |  |
| `hashtags` | text[] | not null | `'{}'` |  |
| `fit_score` | integer |  |  |  |
| `fit_band` | text |  |  |  |
| `fit_model` | text |  |  |  |
| `fit_at` | timestamptz |  |  |  |
| `version` | integer | not null | `1` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `applications_live_uq` — (job_id, candidate_id) WHERE (status = ANY (ARRAY['active'::application_status, 'on_hold'::application_status]))
- `applications_pkey` — (id)
- `applications_reference_uq` — (reference)

**Triggers**

- `applications_touch`
- `applications_version`

**Referenced by** `access_links`, `application_answers`, `application_stage_history`, `assessments`, `comments`, `cross_links`, `evaluations`, `interviews`, `offer_messages`, `offers`, `pitches`, `reviews`, `screenings`

### `approval_flow_steps`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `flow_id` | text | not null |  | → `approval_flows.id` *(on delete cascade)* |
| `label` | text | not null |  |  |
| `approver_type` | approver_type *(enum)* | not null |  |  |
| `approver_role` | text |  |  |  |
| `approver_staff_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `approver_name` | text |  |  |  |
| `approver_title` | text |  |  |  |
| `approver_email` | text |  |  |  |
| `cond_field` | text |  |  |  |
| `cond_op` | condition_op *(enum)* |  |  |  |
| `cond_value` | integer |  |  |  |
| `auto` | boolean | not null | `false` |  |
| `ordinal` | integer | not null |  |  |

**Unique**

- `approval_flow_steps_ord_uq` — (flow_id, ordinal)
- `approval_flow_steps_pkey` — (id)

### `approval_flows`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `subject` | approval_subject *(enum)* | not null |  |  |
| `name` | text | not null |  |  |
| `publish_on_approve` | boolean | not null | `true` |  |
| `publish_channels` | text[] | not null | `'{}'` |  |
| `require_verification` | boolean | not null | `false` |  |
| `is_active` | boolean | not null | `true` |  |
| `updated_by` | text |  |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `approval_flows_active_uq` — (subject) WHERE is_active
- `approval_flows_pkey` — (id)

**Triggers**

- `approval_flows_touch`

**Referenced by** `approval_flow_steps`, `approvals`

### `approval_steps`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `approval_id` | text | not null |  | → `approvals.id` *(on delete cascade)* |
| `step_key` | text | not null |  |  |
| `label` | text | not null |  |  |
| `approver_type` | approver_type *(enum)* | not null |  |  |
| `approver_role` | text |  |  |  |
| `approver_staff_id` | text |  |  |  |
| `approver_name` | text |  |  |  |
| `approver_title` | text |  |  |  |
| `approver_email` | text |  |  |  |
| `condition_text` | text |  |  |  |
| `auto` | boolean | not null | `false` |  |
| `state` | approval_step_state *(enum)* | not null | `'pending'` |  |
| `decided_by` | text |  |  |  |
| `decided_by_name` | text |  |  |  |
| `on_behalf_of` | text |  |  |  |
| `decided_at` | timestamptz |  |  |  |
| `note` | text |  |  |  |
| `ordinal` | integer | not null |  |  |

**Unique**

- `approval_steps_ord_uq` — (approval_id, ordinal)
- `approval_steps_pkey` — (id)

**Triggers**

- `approval_steps_once`

### `approvals`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `subject` | approval_subject *(enum)* | not null |  |  |
| `subject_id` | text | not null |  |  |
| `flow_id` | text |  |  | → `approval_flows.id` *(on delete set null)* |
| `flow_snapshot` | jsonb | not null | `'{}'` |  |
| `state` | approval_state *(enum)* | not null | `'pending'` |  |
| `requested_by` | text |  |  |  |
| `requested_by_name` | text |  |  |  |
| `requested_at` | timestamptz | not null | `now()` |  |
| `decided_by` | text |  |  |  |
| `decided_by_name` | text |  |  |  |
| `decided_at` | timestamptz |  |  |  |
| `note` | text |  |  |  |
| `attempt` | integer | not null | `1` |  |
| `superseded_by_id` | text |  |  |  |

**Unique**

- `approvals_open_uq` — (subject, subject_id) WHERE (state = 'pending'::approval_state)
- `approvals_pkey` — (id)

**Referenced by** `approval_steps`

### `assessments`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `kind` | text | not null | `'behavioural'` |  |
| `provider` | text | not null |  |  |
| `provider_ref` | text |  |  |  |
| `status` | assessment_status *(enum)* | not null | `'invited'` |  |
| `invited_at` | timestamptz | not null | `now()` |  |
| `invited_by` | text |  |  |  |
| `completed_at` | timestamptz |  |  |  |
| `score` | integer |  |  |  |
| `traits` | jsonb | not null | `'[]'` |  |
| `verdict` | assessment_verdict *(enum)* |  |  |  |
| `summary` | text |  |  |  |
| `report_file_id` | text |  |  |  |
| `report_ref` | text |  |  |  |

**Unique**

- `assessments_app_uq` — (application_id, kind)
- `assessments_pkey` — (id)
- `assessments_provider_uq` — (provider_ref)

### `audit_events`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `at` | timestamptz | not null | `now()` |  |
| `actor_id` | text |  |  |  |
| `actor_name` | text | not null |  |  |
| `actor_role` | text |  |  |  |
| `actor_account_id` | text |  |  |  |
| `on_behalf_of_id` | text |  |  |  |
| `on_behalf_of_name` | text |  |  |  |
| `action` | audit_action *(enum)* | not null |  |  |
| `summary` | text | not null |  |  |
| `entity_type` | text | not null |  |  |
| `entity_id` | text |  |  |  |
| `entity_label` | text |  |  |  |
| `before` | jsonb |  |  |  |
| `after` | jsonb |  |  |  |
| `reason` | text |  |  |  |
| `source` | text | not null | `'ui'` |  |
| `request_id` | text |  |  |  |
| `correlation_id` | text |  |  |  |
| `ip` | text |  |  |  |
| `user_agent` | text |  |  |  |
| `session_id` | text |  |  |  |

**Unique**

- `audit_events_pkey` — (id)

**Triggers**

- `audit_events_append_only`

### `automation_rules`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `description` | text |  |  |  |
| `trigger` | text | not null |  |  |
| `conditions` | jsonb | not null | `'[]'` |  |
| `actions` | jsonb | not null | `'[]'` |  |
| `enabled` | boolean | not null | `false` |  |
| `is_system` | boolean | not null | `false` |  |
| `dedupe_window_minutes` | integer |  |  |  |
| `last_run_at` | timestamptz |  |  |  |
| `runs_30d` | integer | not null | `0` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `updated_by` | text |  |  |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `automation_rules_pkey` — (id)

**Triggers**

- `automation_rules_touch`

**Referenced by** `automation_runs`

### `automation_runs`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `rule_id` | text | not null |  | → `automation_rules.id` *(on delete cascade)* |
| `event_id` | text |  |  | → `domain_events.id` *(on delete set null)* |
| `subject_type` | text | not null |  |  |
| `subject_id` | text | not null |  |  |
| `state` | automation_run_state *(enum)* | not null | `'pending'` |  |
| `conditions_met` | boolean |  |  |  |
| `skipped_reason` | text |  |  |  |
| `actions_run` | jsonb | not null | `'[]'` |  |
| `error` | text |  |  |  |
| `attempts` | integer | not null | `0` |  |
| `started_at` | timestamptz |  |  |  |
| `finished_at` | timestamptz |  |  |  |
| `at` | timestamptz | not null | `now()` |  |
| `idempotency_key` | text | not null |  |  |

**Unique**

- `automation_runs_idem_uq` — (idempotency_key)
- `automation_runs_pkey` — (id)

### `candidate_resumes`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `file_id` | text |  |  |  |
| `file_name` | text |  |  |  |
| `size_kb` | integer |  |  |  |
| `pages` | integer |  |  |  |
| `parsed` | boolean | not null | `false` |  |
| `confidence` | numeric |  |  |  |
| `has_text_layer` | boolean | not null | `true` |  |
| `summary` | text |  |  |  |
| `raw_text` | text |  |  |  |
| `sections` | jsonb | not null | `'[]'` |  |
| `experience` | jsonb | not null | `'[]'` |  |
| `education` | jsonb | not null | `'[]'` |  |
| `languages` | jsonb | not null | `'[]'` |  |
| `certs` | text[] | not null | `'{}'` |  |
| `field_sources` | jsonb | not null | `'{}'` |  |
| `photo_found` | boolean | not null | `false` |  |
| `photo_meta` | jsonb |  |  |  |
| `parser_version` | text |  |  |  |
| `parsed_by` | text |  |  |  |
| `is_current` | boolean | not null | `true` |  |
| `uploaded_at` | timestamptz | not null | `now()` |  |
| `uploaded_by` | text |  |  |  |

**Unique**

- `candidate_resumes_current_uq` — (candidate_id) WHERE is_current
- `candidate_resumes_pkey` — (id)

### `candidate_skills`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `skill` | text | not null |  |  |
| `level` | numeric |  |  |  |
| `years` | integer |  |  |  |
| `source` | provenance *(enum)* | not null | `'cv'` |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `candidate_skills_pkey` — (id)
- `candidate_skills_uq` — (candidate_id, lower(skill))

### `candidates`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `gender` | text |  |  |  |
| `email` | text |  |  |  |
| `email_key` | text |  |  |  |
| `phone` | text |  |  |  |
| `phone_key` | text |  |  |  |
| `location_city` | text |  |  |  |
| `nationality` | text |  |  |  |
| `family` | text |  |  |  |
| `headline` | text |  |  |  |
| `current_title` | text |  |  |  |
| `current_company` | text |  |  |  |
| `sector` | text |  |  |  |
| `sector_source` | provenance *(enum)* |  |  |  |
| `years_experience` | integer |  |  |  |
| `notice_days` | integer |  |  |  |
| `expected_salary` | integer |  |  |  |
| `current_salary` | integer |  |  |  |
| `current_salary_source` | provenance *(enum)* |  |  |  |
| `current_salary_at` | timestamptz |  |  |  |
| `linkedin` | text |  |  |  |
| `portfolio` | text |  |  |  |
| `hue` | integer | not null | `1` |  |
| `photo` | text |  |  |  |
| `photo_file_id` | text |  |  |  |
| `photo_at` | timestamptz |  |  |  |
| `consent_until` | date |  |  |  |
| `claim_by` | text |  |  | → `staff.id` *(on delete set null)* |
| `claim_by_name` | text |  |  |  |
| `claim_at` | timestamptz |  |  |  |
| `claim_days` | integer |  |  |  |
| `claim_note` | text |  |  |  |
| `hashtags` | text[] | not null | `'{}'` |  |
| `anonymised_at` | timestamptz |  |  |  |
| `version` | integer | not null | `1` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `created_by` | text |  |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `candidates_pkey` — (id)

**Triggers**

- `candidates_keys`
- `candidates_touch`
- `candidates_version`

**Referenced by** `access_links`, `applications`, `assessments`, `candidate_resumes`, `candidate_skills`, `comments`, `cross_links`, `evaluations`, `interviews`, `offer_messages`, `offers`, `pitches`, `reviews`, `screenings`, `talent_pool_members`

### `comments`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text |  |  | → `applications.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `job_id` | text |  |  | → `jobs.id` *(on delete cascade)* |
| `author_id` | text |  |  |  |
| `author_name` | text | not null |  |  |
| `body` | text | not null |  |  |
| `mentions` | text[] | not null | `'{}'` |  |
| `pinned` | boolean | not null | `false` |  |
| `at` | timestamptz | not null | `now()` |  |
| `edited_at` | timestamptz |  |  |  |
| `deleted_at` | timestamptz |  |  |  |
| `deleted_by` | text |  |  |  |

**Unique**

- `comments_pkey` — (id)

### `cross_links`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `application_a` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `application_b` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `matched_on` | text[] | not null | `'{}'` |  |
| `detected_at` | timestamptz | not null | `now()` |  |

**Unique**

- `cross_links_pkey` — (id)
- `cross_links_uq` — (application_a, application_b)

### `departments`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `code` | text | not null |  |  |
| `function_id` | text |  |  | → `functions.id` *(on delete set null)* |
| `head` | text |  |  |  |
| `head_title` | text |  |  |  |
| `headcount` | integer |  |  |  |
| `cost_centre` | text |  |  |  |
| `archived_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `created_by` | text |  |  |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `departments_code_uq` — (code)
- `departments_name_uq` — (name)
- `departments_pkey` — (id)

**Referenced by** `employees`, `jobs`, `notified_teams`, `positions`

### `domain_events`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `type` | text | not null |  |  |
| `subject_type` | text | not null |  |  |
| `subject_id` | text | not null |  |  |
| `payload` | jsonb | not null | `'{}'` |  |
| `actor_id` | text |  |  |  |
| `actor_name` | text |  |  |  |
| `correlation_id` | text |  |  |  |
| `at` | timestamptz | not null | `now()` |  |
| `dispatched_at` | timestamptz |  |  |  |
| `idempotency_key` | text |  |  |  |

**Unique**

- `domain_events_idem_uq` — (idempotency_key)
- `domain_events_pkey` — (id)

**Triggers**

- `domain_events_guard_trg`

**Referenced by** `automation_runs`

### `email_templates`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `stage` | text |  |  |  |
| `lang` | text | not null | `'en'` |  |
| `subject` | text | not null |  |  |
| `body` | text | not null |  |  |
| `archived_at` | timestamptz |  |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `updated_by` | text |  |  |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `email_templates_pkey` — (id)

**Triggers**

- `email_templates_touch`

### `employee_references`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `employee_id` | text | not null |  | → `employees.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `title` | text |  |  |  |
| `company` | text |  |  |  |
| `relationship` | text |  |  |  |
| `contact` | text |  |  |  |
| `status` | reference_status *(enum)* | not null | `'pending'` |  |
| `rating` | text |  |  |  |
| `notes` | text |  |  |  |
| `contacted_at` | timestamptz |  |  |  |
| `answered_at` | timestamptz |  |  |  |
| `recorded_by` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `employee_references_pkey` — (id)

### `employees`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `employee_code` | text | not null |  |  |
| `name` | text | not null |  |  |
| `gender` | text |  |  |  |
| `candidate_id` | text |  |  |  |
| `application_id` | text |  |  |  |
| `offer_id` | text |  |  |  |
| `job_id` | text |  |  |  |
| `position_code` | text |  |  |  |
| `dept_id` | text | not null |  | → `departments.id` *(on delete restrict)* |
| `title` | text | not null |  |  |
| `location_id` | text |  |  | → `locations.id` *(on delete set null)* |
| `start_date` | date | not null |  |  |
| `status` | employee_status *(enum)* | not null | `'onboarding'` |  |
| `source` | employee_source *(enum)* | not null |  |  |
| `left_on` | date |  |  |  |
| `left_reason` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `employees_application_uq` — (application_id)
- `employees_code_uq` — (employee_code)
- `employees_offer_uq` — (offer_id)
- `employees_pkey` — (id)

**Triggers**

- `employees_seat_capacity`
- `employees_touch`

**Referenced by** `employee_references`, `joining_notices`, `onboarding_documents`, `onboarding_records`, `probation_records`

### `evaluation_criteria`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `evaluation_id` | text | not null |  | → `evaluations.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `score` | integer |  |  |  |
| `weight` | numeric | not null | `'1'` |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `evaluation_criteria_pkey` — (id)

**Checks**

- `evaluation_criteria_score_ck` — CHECK (((score IS NULL) OR ((score >= 1) AND (score <= 5))))

### `evaluations`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `interview_id` | text |  |  |  |
| `stage` | stage_key *(enum)* | not null |  |  |
| `evaluator_id` | text |  |  |  |
| `evaluator_name` | text | not null |  |  |
| `overall` | numeric |  |  |  |
| `verdict` | evaluation_verdict *(enum)* |  |  |  |
| `comment` | text |  |  |  |
| `submitted` | boolean | not null | `false` |  |
| `requested_at` | timestamptz |  |  |  |
| `at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `evaluations_pkey` — (id)

**Referenced by** `evaluation_criteria`

### `file_access_log`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `file_id` | text | not null |  | → `files.id` *(on delete cascade)* |
| `account_id` | text |  |  |  |
| `actor_name` | text |  |  |  |
| `ip` | text |  |  |  |
| `user_agent` | text |  |  |  |
| `at` | timestamptz | not null | `now()` |  |
| `action` | text | not null | `'download'` |  |

**Unique**

- `file_access_log_pkey` — (id)

**Triggers**

- `file_access_log_append_only`

### `files`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `kind` | file_kind *(enum)* | not null |  |  |
| `storage_key` | text | not null |  |  |
| `storage_driver` | text | not null |  |  |
| `original_name` | text | not null |  |  |
| `content_type` | text | not null |  |  |
| `size_bytes` | bigint | not null |  |  |
| `sha256` | text | not null |  |  |
| `owner_type` | text | not null |  |  |
| `owner_id` | text | not null |  |  |
| `supersedes_id` | text |  |  |  |
| `version` | integer | not null | `1` |  |
| `scan_state` | scan_state *(enum)* | not null | `'pending'` |  |
| `scan_result` | text |  |  |  |
| `scanned_at` | timestamptz |  |  |  |
| `uploaded_by` | text |  |  |  |
| `uploaded_at` | timestamptz | not null | `now()` |  |
| `retain_until` | timestamptz |  |  |  |
| `deleted_at` | timestamptz |  |  |  |
| `deleted_by` | text |  |  |  |
| `metadata` | jsonb | not null | `'{}'` |  |

**Unique**

- `files_pkey` — (id)
- `files_storage_key_uq` — (storage_key)

**Checks**

- `files_size_ck` — CHECK ((size_bytes > 0))

**Referenced by** `file_access_log`

### `functions`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `code` | text | not null |  |  |
| `head` | text |  |  |  |
| `head_title` | text |  |  |  |
| `hue` | integer | not null | `1` |  |
| `sort_order` | integer | not null | `0` |  |
| `archived_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `functions_code_uq` — (code)
- `functions_name_uq` — (name)
- `functions_pkey` — (id)

**Referenced by** `departments`, `positions`

### `goals`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `month` | text | not null |  | PK |
| `hires` | integer | not null | `0` |  |
| `time_to_hire_days` | integer |  |  |  |
| `cost_per_hire_sar` | integer |  |  |  |
| `offer_accept_rate` | text |  |  |  |
| `quality_of_hire` | text |  |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `goals_pkey` — (month)

**Triggers**

- `goals_touch`

### `hashtags`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `tag` | text | not null |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `hashtags_pkey` — (id)
- `hashtags_tag_uq` — (tag)

### `integrations`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `key` | text | not null |  |  |
| `name` | text | not null |  |  |
| `kind` | integration_kind *(enum)* | not null |  |  |
| `provider` | text |  |  |  |
| `state` | integration_state *(enum)* | not null | `'not_configured'` |  |
| `health` | integration_health *(enum)* | not null | `'unknown'` |  |
| `detail` | text |  |  |  |
| `missing_config` | text[] | not null | `'{}'` |  |
| `last_sync_at` | timestamptz |  |  |  |
| `last_check_at` | timestamptz |  |  |  |
| `last_error` | text |  |  |  |
| `settings` | jsonb | not null | `'{}'` |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `integrations_key_uq` — (key)
- `integrations_pkey` — (id)

**Triggers**

- `integrations_touch`

### `interview_kits`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `pipeline_id` | text |  |  | → `pipelines.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `criteria` | jsonb | not null | `'[]'` |  |
| `questions` | text[] | not null | `'{}'` |  |
| `archived_at` | timestamptz |  |  |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `interview_kits_pkey` — (id)

### `interview_panel`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `interview_id` | text | not null |  | → `interviews.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `email` | text |  |  |  |
| `account_id` | text |  |  |  |
| `is_hiring_manager` | boolean | not null | `false` |  |
| `responded` | text |  |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `interview_panel_pkey` — (id)
- `interview_panel_uq` — (interview_id, lower(name))

### `interviews`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `stage` | stage_key *(enum)* | not null |  |  |
| `title` | text | not null |  |  |
| `at` | timestamptz | not null |  |  |
| `duration_min` | integer | not null | `45` |  |
| `mode` | text | not null |  |  |
| `interviewer` | text |  |  |  |
| `organiser_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `status` | interview_status *(enum)* | not null | `'scheduled'` |  |
| `location` | text |  |  |  |
| `meeting_url` | text |  |  |  |
| `calendar_provider` | text |  |  |  |
| `calendar_event_id` | text |  |  |  |
| `cancelled_at` | timestamptz |  |  |  |
| `cancelled_by` | text |  |  |  |
| `cancel_reason` | text |  |  |  |
| `rescheduled_from_id` | text |  |  |  |
| `recorded` | boolean | not null | `false` |  |
| `recording_file_id` | text |  |  |  |
| `recording_ref` | text |  |  |  |
| `minutes` | integer |  |  |  |
| `analysis` | jsonb |  |  |  |
| `reviewer_score` | integer |  |  |  |
| `reviewer_ratings` | jsonb |  |  |  |
| `reviewer_strengths` | text[] |  |  |  |
| `reviewer_improve` | text[] |  |  |  |
| `reviewer_model` | text |  |  |  |
| `reviewed_at` | timestamptz |  |  |  |
| `flags` | text[] | not null | `'{}'` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `interviews_calendar_uq` — (calendar_provider, calendar_event_id)
- `interviews_pkey` — (id)

**Checks**

- `interviews_duration_ck` — CHECK (((duration_min >= 5) AND (duration_min <= 480)))

**Triggers**

- `interviews_touch`

**Referenced by** `interview_panel`

### `job_channels`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `channel` | text | not null |  |  |
| `state` | channel_state *(enum)* | not null | `'not_posted'` |  |
| `external_id` | text |  |  |  |
| `posted_at` | timestamptz |  |  |  |
| `expired_at` | timestamptz |  |  |  |
| `last_error` | text |  |  |  |

**Unique**

- `job_channels_pkey` — (id)
- `job_channels_uq` — (job_id, channel)

### `job_hiring_managers`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `title` | text |  |  |  |
| `email` | text |  |  |  |
| `is_lead` | boolean | not null | `false` |  |
| `account_id` | text |  |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `job_hiring_managers_lead_uq` — (job_id) WHERE is_lead
- `job_hiring_managers_pkey` — (id)

**Triggers**

- `job_hiring_managers_sync`

### `job_questions`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `bank_id` | text |  |  | → `question_bank.id` *(on delete set null)* |
| `text` | text | not null |  |  |
| `type` | question_type *(enum)* | not null |  |  |
| `options` | text[] |  |  |  |
| `required` | boolean | not null | `false` |  |
| `knockout` | text |  |  |  |
| `ordinal` | integer | not null | `0` |  |

**Unique**

- `job_questions_pkey` — (id)

### `job_queue`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `kind` | text | not null |  |  |
| `payload` | jsonb | not null | `'{}'` |  |
| `state` | job_queue_state *(enum)* | not null | `'pending'` |  |
| `run_after` | timestamptz | not null | `now()` |  |
| `attempts` | integer | not null | `0` |  |
| `max_attempts` | integer | not null | `6` |  |
| `last_error` | text |  |  |  |
| `locked_by` | text |  |  |  |
| `locked_at` | timestamptz |  |  |  |
| `started_at` | timestamptz |  |  |  |
| `finished_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `dedupe_key` | text |  |  |  |
| `correlation_id` | text |  |  |  |

**Unique**

- `job_queue_dedupe_uq` — (dedupe_key) WHERE (state = ANY (ARRAY['pending'::job_queue_state, 'running'::job_queue_state]))
- `job_queue_pkey` — (id)

### `job_skills`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `skill` | text | not null |  |  |
| `level` | integer | not null | `3` |  |
| `must` | boolean | not null | `false` |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `job_skills_pkey` — (id)
- `job_skills_uq` — (job_id, lower(skill))

**Checks**

- `job_skills_level_ck` — CHECK (((level >= 1) AND (level <= 5)))

### `job_stages`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `stage_key` | stage_key *(enum)* | not null |  |  |
| `name` | text | not null |  |  |
| `sla` | integer | not null |  |  |
| `ordinal` | integer | not null |  |  |

**Unique**

- `job_stages_pkey` — (id)
- `job_stages_uq` — (job_id, stage_key)

**Checks**

- `job_stages_sla_ck` — CHECK (((sla >= 1) AND (sla <= 60)))

### `jobs`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `reference` | text | not null |  |  |
| `title` | text | not null |  |  |
| `slug` | text | not null |  |  |
| `dept_id` | text | not null |  | → `departments.id` *(on delete restrict)* |
| `location_id` | text | not null |  | → `locations.id` *(on delete restrict)* |
| `pipeline_id` | text |  |  | → `pipelines.id` *(on delete set null)* |
| `position_code` | text |  |  |  |
| `employment_type` | employment_type *(enum)* | not null | `'full_time'` |  |
| `status` | job_status *(enum)* | not null | `'draft'` |  |
| `priority` | job_priority *(enum)* | not null | `'normal'` |  |
| `openings` | integer | not null | `1` |  |
| `filled` | integer | not null | `0` |  |
| `salary_min` | integer | not null | `0` |  |
| `salary_max` | integer | not null | `0` |  |
| `currency` | text | not null | `'SAR'` |  |
| `family` | text | not null |  |  |
| `recruiter_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `sourcer_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `coordinator_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `hiring_manager` | text |  |  |  |
| `panel` | text[] | not null | `'{}'` |  |
| `opened_on` | date |  |  |  |
| `target_start_on` | date |  |  |  |
| `closed_on` | date |  |  |  |
| `closed_by` | text |  |  |  |
| `remote_ok` | boolean | not null | `false` |  |
| `headcount_ref` | text |  |  |  |
| `budgeted` | boolean | not null | `true` |  |
| `budget_note` | text |  |  |  |
| `approved_by` | text |  |  |  |
| `sourcing_internal` | boolean | not null | `false` |  |
| `sourcing_hunt` | boolean | not null | `false` |  |
| `sourcing_linkedin` | boolean | not null | `true` |  |
| `sourcing_note` | text |  |  |  |
| `pitch_on` | boolean | not null | `false` |  |
| `pitch_project_id` | text |  |  |  |
| `pitch_channels` | text[] | not null | `ARRAY['whatsapp', 'email']` |  |
| `pitch_lead_hours` | integer |  |  |  |
| `pitch_note` | text |  |  |  |
| `desc_summary` | text |  |  |  |
| `desc_responsibilities` | text[] | not null | `'{}'` |  |
| `desc_requirements` | text[] | not null | `'{}'` |  |
| `desc_benefits` | text[] | not null | `'{}'` |  |
| `desc_updated_at` | timestamptz |  |  |  |
| `hashtags` | text[] | not null | `'{}'` |  |
| `archived_at` | timestamptz |  |  |  |
| `version` | integer | not null | `1` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `created_by` | text |  |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `updated_by` | text |  |  |  |

**Unique**

- `jobs_pkey` — (id)
- `jobs_reference_uq` — (reference)

**Checks**

- `jobs_band_ck` — CHECK ((salary_max >= salary_min))
- `jobs_filled_ck` — CHECK ((filled >= 0))
- `jobs_openings_ck` — CHECK ((openings >= 1))

**Triggers**

- `jobs_touch`
- `jobs_version`

**Referenced by** `applications`, `assessments`, `comments`, `evaluations`, `interviews`, `job_channels`, `job_hiring_managers`, `job_questions`, `job_skills`, `job_stages`, `offers`, `pitches`, `reviews`, `screenings`

### `joining_notices`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `employee_id` | text | not null |  | → `employees.id` *(on delete cascade)* |
| `kind` | text | not null |  |  |
| `team_key` | text | not null |  |  |
| `start_date` | date |  |  |  |
| `sent_at` | timestamptz | not null | `now()` |  |
| `sent_by` | text | not null |  |  |
| `to_name` | text |  |  |  |
| `to_email` | text |  |  |  |
| `cc_emails` | text[] | not null | `'{}'` |  |
| `document_count` | integer | not null | `0` |  |
| `form_included` | boolean | not null | `false` |  |
| `message_id` | text |  |  |  |

**Unique**

- `joining_notices_pkey` — (id)

### `locations`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `city` | text | not null |  |  |
| `region` | text | not null |  |  |
| `office` | text | not null |  |  |
| `timezone` | text | not null | `'Asia/Riyadh'` |  |
| `is_remote` | boolean | not null | `false` |  |
| `archived_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `locations_city_office_uq` — (city, office)
- `locations_pkey` — (id)

**Referenced by** `employees`, `jobs`, `positions`, `staff`

### `login_attempts`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `email` | text | not null |  |  |
| `ip` | text | not null |  |  |
| `succeeded` | boolean | not null |  |  |
| `reason` | text |  |  |  |
| `at` | timestamptz | not null | `now()` |  |

**Unique**

- `login_attempts_pkey` — (id)

**Triggers**

- `login_attempts_append_only`

### `message_threads`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `subject_type` | text | not null |  |  |
| `subject_id` | text | not null |  |  |
| `candidate_id` | text |  |  |  |
| `application_id` | text |  |  |  |
| `job_id` | text |  |  |  |
| `title` | text |  |  |  |
| `last_message_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `message_threads_pkey` — (id)

**Referenced by** `messages`

### `messages`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `thread_id` | text |  |  | → `message_threads.id` *(on delete cascade)* |
| `application_id` | text |  |  |  |
| `candidate_id` | text |  |  |  |
| `job_id` | text |  |  |  |
| `employee_id` | text |  |  |  |
| `channel` | comm_channel *(enum)* | not null |  |  |
| `direction` | comm_direction *(enum)* | not null |  |  |
| `internal` | boolean | not null | `false` |  |
| `from_name` | text |  |  |  |
| `from_address` | text |  |  |  |
| `to_name` | text |  |  |  |
| `to_address` | text |  |  |  |
| `cc_addresses` | text[] | not null | `'{}'` |  |
| `subject` | text |  |  |  |
| `body` | text | not null |  |  |
| `template_id` | text |  |  |  |
| `provider` | text |  |  |  |
| `provider_message_id` | text |  |  |  |
| `status` | comm_status *(enum)* | not null | `'queued'` |  |
| `status_detail` | text |  |  |  |
| `queued_at` | timestamptz | not null | `now()` |  |
| `sent_at` | timestamptz |  |  |  |
| `delivered_at` | timestamptz |  |  |  |
| `opened_at` | timestamptz |  |  |  |
| `read_at` | timestamptz |  |  |  |
| `failed_at` | timestamptz |  |  |  |
| `failure_reason` | text |  |  |  |
| `attempts` | integer | not null | `0` |  |
| `author_id` | text |  |  |  |
| `idempotency_key` | text |  |  |  |
| `at` | timestamptz | not null | `now()` |  |

**Unique**

- `messages_idem_uq` — (idempotency_key)
- `messages_pkey` — (id)
- `messages_provider_uq` — (provider, provider_message_id)

### `notifications`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `kind` | notification_kind *(enum)* | not null |  |  |
| `text` | text | not null |  |  |
| `recipient_account_id` | text |  |  | → `accounts.id` *(on delete cascade)* |
| `recipient_staff_id` | text |  |  | → `staff.id` *(on delete cascade)* |
| `application_id` | text |  |  |  |
| `job_id` | text |  |  |  |
| `candidate_id` | text |  |  |  |
| `employee_id` | text |  |  |  |
| `offer_id` | text |  |  |  |
| `link` | text |  |  |  |
| `read_at` | timestamptz |  |  |  |
| `at` | timestamptz | not null | `now()` |  |
| `dedupe_key` | text |  |  |  |

**Unique**

- `notifications_dedupe_uq` — (dedupe_key)
- `notifications_pkey` — (id)

### `notified_team_contacts`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `team_id` | text | not null |  | → `notified_teams.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `email` | text | not null |  |  |
| `role` | text |  |  |  |
| `is_primary` | boolean | not null | `false` |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `notified_team_contacts_pkey` — (id)

### `notified_teams`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `key` | text | not null |  |  |
| `short` | text | not null |  |  |
| `name` | text | not null |  |  |
| `dept_id` | text |  |  | → `departments.id` *(on delete set null)* |
| `purpose` | text |  |  |  |
| `ask` | text |  |  |  |
| `on_joining` | boolean | not null | `true` |  |
| `on_file` | boolean | not null | `true` |  |
| `sort_order` | integer | not null | `0` |  |
| `archived_at` | timestamptz |  |  |  |

**Unique**

- `notified_teams_key_uq` — (key)
- `notified_teams_pkey` — (id)

**Referenced by** `notified_team_contacts`

### `offer_documents`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `offer_id` | text | not null |  | → `offers.id` *(on delete cascade)* |
| `key` | text | not null |  |  |
| `label` | text | not null |  |  |
| `status` | document_status *(enum)* | not null | `'missing'` |  |
| `file_id` | text |  |  |  |
| `uploaded_at` | timestamptz |  |  |  |
| `uploaded_by` | text |  |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `offer_documents_pkey` — (id)
- `offer_documents_uq` — (offer_id, key)

### `offer_letter_edits`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `offer_id` | text | not null |  | → `offers.id` *(on delete cascade)* |
| `field` | text | not null |  |  |
| `from_value` | text |  |  |  |
| `to_value` | text |  |  |  |
| `by_id` | text |  |  |  |
| `by_name` | text |  |  |  |
| `at` | timestamptz | not null | `now()` |  |

**Unique**

- `offer_letter_edits_pkey` — (id)

**Triggers**

- `offer_letter_edits_append_only`

### `offer_messages`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `offer_id` | text | not null |  | → `offers.id` *(on delete cascade)* |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `from_party` | message_party *(enum)* | not null |  |  |
| `author_id` | text |  |  |  |
| `author_name` | text | not null |  |  |
| `body` | text | not null |  |  |
| `message_id` | text |  |  |  |
| `read_at` | timestamptz |  |  |  |
| `at` | timestamptz | not null | `now()` |  |

**Unique**

- `offer_messages_pkey` — (id)

### `offer_signatures`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `offer_id` | text | not null |  | → `offers.id` *(on delete cascade)* |
| `name` | text | not null |  |  |
| `email` | text |  |  |  |
| `role` | text | not null | `'Candidate'` |  |
| `state` | signer_state *(enum)* | not null | `'not_sent'` |  |
| `provider_recipient_id` | text |  |  |  |
| `sent_at` | timestamptz |  |  |  |
| `viewed_at` | timestamptz |  |  |  |
| `signed_at` | timestamptz |  |  |  |
| `declined_reason` | text |  |  |  |
| `ip_address` | text |  |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `offer_signatures_pkey` — (id)

### `offer_templates`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `family` | text |  |  |  |
| `is_default` | boolean | not null | `false` |  |
| `file_id` | text |  |  |  |
| `file_name` | text |  |  |  |
| `file_type` | text |  |  |  |
| `size_kb` | integer |  |  |  |
| `lang` | text | not null | `'en'` |  |
| `version` | integer | not null | `1` |  |
| `body` | text | not null |  |  |
| `detected_fields` | text[] | not null | `'{}'` |  |
| `note` | text |  |  |  |
| `uploaded_by` | text |  |  |  |
| `uploaded_at` | timestamptz | not null | `now()` |  |
| `archived_at` | timestamptz |  |  |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `offer_templates_default_uq` — ((1)) WHERE (is_default AND (archived_at IS NULL))
- `offer_templates_family_uq` — (family) WHERE ((family IS NOT NULL) AND (archived_at IS NULL))
- `offer_templates_pkey` — (id)

**Referenced by** `offers`

### `offers`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `reference` | text | not null |  |  |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `version` | integer | not null | `1` |  |
| `supersedes_id` | text |  |  |  |
| `base_monthly` | integer | not null |  |  |
| `housing` | integer | not null | `0` |  |
| `transport` | integer | not null | `0` |  |
| `annual_bonus_pct` | integer | not null | `0` |  |
| `currency` | text | not null | `'SAR'` |  |
| `start_date` | date | not null |  |  |
| `state` | offer_state *(enum)* | not null | `'draft'` |  |
| `template_id` | text |  |  | → `offer_templates.id` *(on delete set null)* |
| `template_name` | text |  |  |  |
| `letter_override` | text |  |  |  |
| `field_overrides` | jsonb | not null | `'{}'` |  |
| `verified_by` | text |  |  |  |
| `verified_at` | timestamptz |  |  |  |
| `verified_note` | text |  |  |  |
| `sent_at` | timestamptz |  |  |  |
| `sent_by` | text |  |  |  |
| `viewed_at` | timestamptz |  |  |  |
| `signed_at` | timestamptz |  |  |  |
| `expires_at` | timestamptz |  |  |  |
| `esign_provider` | text |  |  |  |
| `esign_envelope_id` | text |  |  |  |
| `esign_status` | text |  |  |  |
| `generated_file_id` | text |  |  |  |
| `signed_file_id` | text |  |  |  |
| `response_state` | offer_response_state *(enum)* |  |  |  |
| `response_at` | timestamptz |  |  |  |
| `response_by` | text |  |  |  |
| `response_reason` | text |  |  |  |
| `response_note` | text |  |  |  |
| `response_source` | text |  |  |  |
| `version_lock` | integer | not null | `1` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `created_by` | text |  |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `offers_app_version_uq` — (application_id, version)
- `offers_envelope_uq` — (esign_envelope_id)
- `offers_pkey` — (id)
- `offers_reference_uq` — (reference)

**Checks**

- `offers_money_ck` — CHECK (((base_monthly > 0) AND (housing >= 0) AND (transport >= 0)))

**Triggers**

- `offers_immutable_after_send`
- `offers_touch`

**Referenced by** `offer_documents`, `offer_letter_edits`, `offer_messages`, `offer_signatures`

### `onboarding_documents`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `employee_id` | text | not null |  | → `employees.id` *(on delete cascade)* |
| `key` | text | not null |  |  |
| `label` | text | not null |  |  |
| `status` | document_status *(enum)* | not null | `'missing'` |  |
| `file_id` | text |  |  |  |
| `uploaded_at` | timestamptz |  |  |  |
| `uploaded_by` | text |  |  |  |
| `verified_at` | timestamptz |  |  |  |
| `verified_by` | text |  |  |  |
| `rejected_reason` | text |  |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `onboarding_documents_pkey` — (id)
- `onboarding_documents_uq` — (employee_id, key)

### `onboarding_records`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `employee_id` | text | not null |  | → `employees.id` *(on delete cascade)* |
| `form_sent_at` | timestamptz |  |  |  |
| `form_submitted_at` | timestamptz |  |  |  |
| `national_id` | text |  |  |  |
| `nationality` | text |  |  |  |
| `dob` | date |  |  |  |
| `address` | text |  |  |  |
| `emergency_contact` | text |  |  |  |
| `bank` | text |  |  |  |
| `iban` | text |  |  |  |
| `completed_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `onboarding_records_employee_uq` — (employee_id)
- `onboarding_records_pkey` — (id)

**Triggers**

- `onboarding_records_touch`

### `org_settings`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null | `'org'` | PK |
| `org_name` | text | not null |  |  |
| `legal_name` | text | not null |  |  |
| `currency` | text | not null | `'SAR'` |  |
| `currency_symbol` | text | not null | `'SAR'` |  |
| `country` | text | not null | `'Saudi Arabia'` |  |
| `timezone` | text | not null | `'Asia/Riyadh'` |  |
| `weekend_days` | int4[] | not null | `ARRAY[5, 6]` |  |
| `workday_start_min` | integer | not null | `540` |  |
| `workday_end_min` | integer | not null | `1080` |  |
| `fiscal_year_start` | text | not null | `'January'` |  |
| `locale` | text | not null | `'en-SA'` |  |
| `second_locale` | text | not null | `'ar-SA'` |  |
| `data_retention_months` | integer | not null | `24` |  |
| `brand_primary` | text | not null | `'#0E9E62'` |  |
| `brand_accent` | text | not null | `'#C98A16'` |  |
| `brand_note` | text |  |  |  |
| `offer_approval_threshold` | integer | not null | `30000` |  |
| `leader_name` | text |  |  |  |
| `leader_title` | text |  |  |  |
| `signed_by` | text |  |  |  |
| `ats_owner` | text |  |  |  |
| `hris_name` | text |  |  |  |
| `probation_months` | integer | not null | `3` |  |
| `extra` | jsonb | not null | `'{}'` |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `updated_by` | text |  |  |  |

**Unique**

- `org_settings_pkey` — (id)

**Triggers**

- `org_settings_touch`

### `pipeline_snapshots`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `snapshot_date` | text | not null |  |  |
| `job_id` | text |  |  |  |
| `dept_id` | text |  |  |  |
| `stage` | text | not null |  |  |
| `live_count` | integer | not null | `0` |  |
| `entered_count` | integer | not null | `0` |  |
| `exited_count` | integer | not null | `0` |  |
| `breached_count` | integer | not null | `0` |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `pipeline_snapshots_pkey` — (id)
- `pipeline_snapshots_uq` — (snapshot_date, job_id, stage)

### `pipelines`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `off_stages` | text[] | not null | `'{}'` |  |
| `sells` | boolean | not null | `false` |  |
| `labels` | jsonb | not null | `'{}'` |  |
| `sla_overrides` | jsonb | not null | `'{}'` |  |
| `archived_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `pipelines_name_uq` — (name)
- `pipelines_pkey` — (id)

**Referenced by** `interview_kits`, `jobs`

### `pitch_config`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null | `'pitch_cfg'` | PK |
| `lead_hours` | integer | not null | `24` |  |
| `channels` | text[] | not null | `ARRAY['whatsapp', 'email']` |  |
| `gate_final` | boolean | not null | `true` |  |
| `wa_template` | text | not null |  |  |
| `email_subject` | text | not null |  |  |
| `email_body` | text | not null |  |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `updated_by` | text |  |  |  |

**Unique**

- `pitch_config_pkey` — (id)

**Triggers**

- `pitch_config_touch`

### `pitch_projects`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `who` | text |  |  |  |
| `client` | text |  |  |  |
| `brief` | text | not null |  |  |
| `task` | text | not null |  |  |
| `duration_min` | integer | not null | `20` |  |
| `prep_hours` | integer | not null | `24` |  |
| `criteria` | jsonb | not null | `'[]'` |  |
| `active` | boolean | not null | `true` |  |
| `uses` | integer | not null | `0` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |
| `updated_by` | text |  |  |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `pitch_projects_pkey` — (id)

**Triggers**

- `pitch_projects_touch`

**Referenced by** `pitches`

### `pitch_scores`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `pitch_id` | text | not null |  | → `pitches.id` *(on delete cascade)* |
| `key` | text | not null |  |  |
| `name` | text | not null |  |  |
| `score` | integer | not null |  |  |
| `max` | integer | not null |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `pitch_scores_pkey` — (id)
- `pitch_scores_uq` — (pitch_id, key)

### `pitch_turns`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `pitch_id` | text | not null |  | → `pitches.id` *(on delete cascade)* |
| `who` | text | not null |  |  |
| `text` | text | not null |  |  |
| `at` | timestamptz | not null |  |  |
| `seq` | integer | not null |  |  |

**Unique**

- `pitch_turns_pkey` — (id)
- `pitch_turns_uq` — (pitch_id, seq)

### `pitches`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `project_id` | text |  |  | → `pitch_projects.id` *(on delete set null)* |
| `status` | pitch_status *(enum)* | not null | `'not_sent'` |  |
| `sent_at` | timestamptz |  |  |  |
| `sent_whatsapp` | text |  |  |  |
| `sent_email` | text |  |  |  |
| `channels` | text[] | not null | `'{}'` |  |
| `due_at` | timestamptz |  |  |  |
| `started_at` | timestamptz |  |  |  |
| `completed_at` | timestamptz |  |  |  |
| `duration_min` | integer |  |  |  |
| `total` | integer |  |  |  |
| `max` | integer |  |  |  |
| `score` | integer |  |  |  |
| `verdict` | pitch_verdict *(enum)* |  |  |  |
| `summary` | text |  |  |  |
| `strengths` | text[] | not null | `'{}'` |  |
| `gaps` | text[] | not null | `'{}'` |  |
| `model` | text |  |  |  |
| `recording_file_id` | text |  |  |  |
| `recording_ref` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |

**Unique**

- `pitches_app_uq` — (application_id)
- `pitches_pkey` — (id)

**Referenced by** `pitch_scores`, `pitch_turns`

### `positions`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `code` | text | not null |  |  |
| `title` | text | not null |  |  |
| `dept_id` | text | not null |  | → `departments.id` *(on delete restrict)* |
| `function_id` | text |  |  | → `functions.id` *(on delete set null)* |
| `grade` | text |  |  |  |
| `reports_to_id` | text |  |  |  |
| `reports_to_function_id` | text |  |  | → `functions.id` *(on delete set null)* |
| `plan_state` | position_plan_state *(enum)* | not null | `'approved'` |  |
| `approved` | integer | not null | `0` |  |
| `requested` | integer | not null | `0` |  |
| `job_id` | text |  |  |  |
| `location_id` | text |  |  | → `locations.id` *(on delete set null)* |
| `kind` | position_kind *(enum)* | not null | `'role'` |  |
| `holder_name` | text |  |  |  |
| `holder_gender` | text |  |  |  |
| `imported_from` | text |  |  |  |
| `approved_at` | timestamptz |  |  |  |
| `approved_by` | text |  |  |  |
| `retired_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `created_by` | text |  |  |  |

**Unique**

- `positions_code_uq` — (code)
- `positions_pkey` — (id)

### `probation_records`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `employee_id` | text | not null |  | → `employees.id` *(on delete cascade)* |
| `months` | integer | not null | `3` |  |
| `starts_on` | date | not null |  |  |
| `ends_on` | date | not null |  |  |
| `state` | probation_state *(enum)* | not null | `'in_progress'` |  |
| `decided_on` | date |  |  |  |
| `decided_by` | text |  |  |  |
| `decided_by_name` | text |  |  |  |
| `reason` | text |  |  |  |
| `note` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `probation_records_employee_uq` — (employee_id)
- `probation_records_pkey` — (id)

**Triggers**

- `probation_records_touch`

### `question_bank`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `text` | text | not null |  |  |
| `type` | question_type *(enum)* | not null |  |  |
| `options` | text[] |  |  |  |
| `required` | boolean | not null | `false` |  |
| `knockout` | text |  |  |  |
| `families` | text[] | not null | `'{}'` |  |
| `is_standard` | boolean | not null | `false` |  |
| `archived_at` | timestamptz |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `question_bank_pkey` — (id)

**Referenced by** `job_questions`

### `reference_counters`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `prefix` | text | not null |  | PK |
| `year` | integer | not null |  | PK |
| `next` | integer | not null | `1` |  |

**Unique**

- `reference_counters_pkey` — (prefix, year)

### `report_requests`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `account_id` | text |  |  |  |
| `actor_name` | text |  |  |  |
| `question` | text | not null |  |  |
| `resolved_spec` | jsonb |  |  |  |
| `resolved_by` | text | not null | `'grammar'` |  |
| `row_count` | integer |  |  |  |
| `duration_ms` | integer |  |  |  |
| `scope_applied` | text |  |  |  |
| `error` | text |  |  |  |
| `at` | timestamptz | not null | `now()` |  |

**Unique**

- `report_requests_pkey` — (id)

### `reviews`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `rating` | review_rating *(enum)* | not null |  |  |
| `text` | text |  |  |  |
| `by_id` | text |  |  |  |
| `by_name` | text | not null |  |  |
| `by_email` | text |  |  |  |
| `stage` | stage_key *(enum)* |  |  |  |
| `at` | timestamptz | not null | `now()` |  |

**Unique**

- `reviews_pkey` — (id)
- `reviews_reviewer_uq` — (application_id, COALESCE(by_id, lower(by_name)))

### `saved_reports`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `question` | text |  |  |  |
| `spec` | jsonb | not null |  |  |
| `owner_id` | text |  |  | → `staff.id` *(on delete cascade)* |
| `shared` | boolean | not null | `false` |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `last_run_at` | timestamptz |  |  |  |

**Unique**

- `saved_reports_pkey` — (id)

### `schema_migrations`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `filename` | text | not null |  | PK |
| `checksum` | text | not null |  |  |
| `applied_at` | timestamptz | not null | `now()` |  |
| `duration_ms` | integer | not null | `0` |  |

**Unique**

- `schema_migrations_pkey` — (filename)

### `screening_scores`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `screening_id` | text | not null |  | → `screenings.id` *(on delete cascade)* |
| `key` | text | not null |  |  |
| `question` | text | not null |  |  |
| `answer` | text |  |  |  |
| `score` | integer | not null |  |  |
| `max` | integer | not null |  |  |
| `sort_order` | integer | not null | `0` |  |

**Unique**

- `screening_scores_pkey` — (id)
- `screening_scores_uq` — (screening_id, key)

### `screening_turns`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `screening_id` | text | not null |  | → `screenings.id` *(on delete cascade)* |
| `who` | text | not null |  |  |
| `text` | text | not null |  |  |
| `at` | timestamptz | not null |  |  |
| `seq` | integer | not null |  |  |

**Unique**

- `screening_turns_pkey` — (id)
- `screening_turns_uq` — (screening_id, seq)

### `screenings`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `application_id` | text | not null |  | → `applications.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `job_id` | text | not null |  | → `jobs.id` *(on delete cascade)* |
| `channel` | screening_channel *(enum)* | not null |  |  |
| `status` | screening_status *(enum)* | not null | `'invited'` |  |
| `invited_at` | timestamptz | not null | `now()` |  |
| `started_at` | timestamptz |  |  |  |
| `completed_at` | timestamptz |  |  |  |
| `total` | integer |  |  |  |
| `max` | integer |  |  |  |
| `score` | integer |  |  |  |
| `verdict` | screening_verdict *(enum)* |  |  |  |
| `summary` | text |  |  |  |
| `captured_current_salary` | integer |  |  |  |
| `captured_expected_salary` | integer |  |  |  |
| `captured_notice_days` | integer |  |  |  |
| `captured_source` | text |  |  |  |
| `captured_by` | text |  |  |  |
| `captured_at` | timestamptz |  |  |  |
| `captured_quote` | text |  |  |  |
| `call_direction` | text |  |  |  |
| `call_phone` | text |  |  |  |
| `call_language` | text |  |  |  |
| `call_voice` | text |  |  |  |
| `call_attempts` | integer | not null | `0` |  |
| `call_consent` | boolean |  |  |  |
| `call_scheduled_for` | timestamptz |  |  |  |
| `call_started_at` | timestamptz |  |  |  |
| `call_ended_at` | timestamptz |  |  |  |
| `call_next_attempt_at` | timestamptz |  |  |  |
| `call_duration_sec` | integer |  |  |  |
| `call_outcome` | call_outcome *(enum)* |  |  |  |
| `call_provider` | text |  |  |  |
| `call_provider_ref` | text |  |  |  |
| `call_recording_file_id` | text |  |  |  |
| `call_transcript_confidence` | numeric |  |  |  |
| `call_clarity` | integer |  |  |  |
| `call_fluency` | integer |  |  |  |
| `call_engagement` | integer |  |  |  |
| `analysis` | jsonb |  |  |  |
| `interviewer_review` | jsonb |  |  |  |
| `created_by` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `screenings_pkey` — (id)
- `screenings_provider_uq` — (call_provider_ref)

**Triggers**

- `screenings_touch`

**Referenced by** `screening_scores`, `screening_turns`

### `sessions`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `account_id` | text | not null |  | → `accounts.id` *(on delete cascade)* |
| `token_hash` | text | not null |  |  |
| `acting_staff_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `user_agent` | text |  |  |  |
| `ip` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `last_seen_at` | timestamptz | not null | `now()` |  |
| `expires_at` | timestamptz | not null |  |  |
| `revoked_at` | timestamptz |  |  |  |
| `revoked_reason` | text |  |  |  |

**Unique**

- `sessions_pkey` — (id)
- `sessions_token_uq` — (token_hash)

### `sources`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `route` | text | not null |  |  |
| `sort_order` | integer | not null | `0` |  |
| `archived_at` | timestamptz |  |  |  |

**Unique**

- `sources_name_uq` — (name)
- `sources_pkey` — (id)

### `staff`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `title` | text | not null |  |  |
| `role` | staff_role *(enum)* | not null |  |  |
| `role_label` | text | not null |  |  |
| `email` | text | not null |  |  |
| `phone` | text |  |  |  |
| `gender` | text |  |  |  |
| `location_id` | text |  |  | → `locations.id` *(on delete set null)* |
| `dept_ids` | text[] | not null | `'{}'` |  |
| `monthly_target` | integer | not null | `0` |  |
| `lifetime_hires` | integer | not null | `0` |  |
| `joined_on` | date |  |  |  |
| `hue` | integer | not null | `1` |  |
| `seniority` | text |  |  |  |
| `placeholder_name` | boolean | not null | `false` |  |
| `photo` | text |  |  |  |
| `photo_file_id` | text |  |  |  |
| `portrait_style` | text |  |  |  |
| `status` | staff_status *(enum)* | not null | `'active'` |  |
| `deleted_at` | timestamptz |  |  |  |
| `handed_over_to` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `updated_at` | timestamptz | not null | `now()` |  |

**Unique**

- `staff_email_uq` — (lower(email))
- `staff_pkey` — (id)

**Triggers**

- `staff_touch`

**Referenced by** `accounts`, `applications`, `approval_flow_steps`, `candidates`, `interviews`, `jobs`, `notifications`, `saved_reports`, `sessions`, `talent_pools`, `tasks`

### `stages`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `key` | stage_key *(enum)* | not null |  | PK |
| `name` | text | not null |  |  |
| `short` | text | not null |  |  |
| `default_sla` | integer | not null |  |  |
| `kind` | stage_kind *(enum)* | not null |  |  |
| `optional` | boolean | not null | `false` |  |
| `ordinal` | integer | not null |  |  |
| `fixed` | boolean | not null | `false` |  |

**Unique**

- `stages_ordinal_uq` — (ordinal)
- `stages_pkey` — (key)

### `talent_pool_members`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `pool_id` | text | not null |  | → `talent_pools.id` *(on delete cascade)* |
| `candidate_id` | text | not null |  | → `candidates.id` *(on delete cascade)* |
| `added_at` | timestamptz | not null | `now()` |  |
| `added_by` | text |  |  |  |

**Unique**

- `talent_pool_members_pkey` — (id)
- `talent_pool_members_uq` — (pool_id, candidate_id)

### `talent_pools`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `name` | text | not null |  |  |
| `filter` | jsonb | not null | `'{}'` |  |
| `owner_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `created_at` | timestamptz | not null | `now()` |  |
| `sort_order` | integer | not null | `1000` |  |

**Unique**

- `talent_pools_pkey` — (id)

**Referenced by** `talent_pool_members`

### `tasks`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `kind` | task_kind *(enum)* | not null |  |  |
| `title` | text | not null |  |  |
| `detail` | text |  |  |  |
| `application_id` | text |  |  |  |
| `job_id` | text |  |  |  |
| `candidate_id` | text |  |  |  |
| `employee_id` | text |  |  |  |
| `offer_id` | text |  |  |  |
| `assignee_id` | text |  |  | → `staff.id` *(on delete set null)* |
| `assignee_account_id` | text |  |  | → `accounts.id` *(on delete set null)* |
| `due_on` | timestamptz |  |  |  |
| `priority` | task_priority *(enum)* | not null | `'normal'` |  |
| `done` | boolean | not null | `false` |  |
| `done_at` | timestamptz |  |  |  |
| `done_by` | text |  |  |  |
| `created_by` | text |  |  |  |
| `created_at` | timestamptz | not null | `now()` |  |
| `dedupe_key` | text |  |  |  |

**Unique**

- `tasks_dedupe_uq` — (dedupe_key) WHERE (done = false)
- `tasks_pkey` — (id)

### `webhook_events`
| Column | Type | | Default | |
| --- | --- | --- | --- | --- |
| `id` | text | not null |  | PK |
| `provider` | text | not null |  |  |
| `event_type` | text | not null |  |  |
| `external_id` | text |  |  |  |
| `signature_valid` | boolean | not null |  |  |
| `payload` | jsonb | not null |  |  |
| `headers` | jsonb | not null | `'{}'` |  |
| `received_at` | timestamptz | not null | `now()` |  |
| `processed_at` | timestamptz |  |  |  |
| `process_result` | text |  |  |  |
| `error` | text |  |  |  |
| `attempts` | integer | not null | `0` |  |

**Unique**

- `webhook_events_external_uq` — (provider, external_id)
- `webhook_events_pkey` — (id)
