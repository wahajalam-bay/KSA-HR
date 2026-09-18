# Automation and event catalogue

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

## The two kinds of record

`audit_events` and `domain_events` are deliberately separate tables.

- **`audit_events`** answers *who did what to whom, and what it looked like
  before*. It is append-only — a database trigger refuses an `UPDATE` or a
  `DELETE` on it — and nothing in the product can edit a line of it.
- **`domain_events`** is what the automation engine reacts to. It is the
  product telling itself something happened, and it is safe to replay.

Every meaningful write puts a row in the first. A write that other things should
react to also puts one in the second.

## The event vocabulary

Nothing emits a type that is not on this list; `EVENT_TYPES` in
`lib/audit.ts` is the whole of it.

- `candidate.created`
- `candidate.updated`
- `candidate.claimed`
- `candidate.retention_due`
- `application.created`
- `application.stage_changed`
- `application.rejected`
- `application.withdrawn`
- `application.hired`
- `requisition.created`
- `requisition.submitted`
- `requisition.approved`
- `requisition.rejected`
- `requisition.published`
- `requisition.archived`
- `requisition.reopened`
- `seat.requested`
- `seat.approved`
- `seat.withdrawn`
- `plan.imported`
- `screening.invited`
- `screening.completed`
- `screening.no_answer`
- `interview.scheduled`
- `interview.rescheduled`
- `interview.cancelled`
- `interview.completed`
- `interview.reviewed`
- `scorecard.requested`
- `scorecard.submitted`
- `scorecard.overdue`
- `assessment.invited`
- `assessment.completed`
- `pitch.sent`
- `pitch.completed`
- `offer.drafted`
- `offer.submitted`
- `offer.approved`
- `offer.verified`
- `offer.sent`
- `offer.viewed`
- `offer.signed`
- `offer.accepted`
- `offer.declined`
- `offer.revised`
- `employee.created`
- `joining.confirmed`
- `joiner_file.sent`
- `onboarding.document_uploaded`
- `onboarding.document_verified`
- `onboarding.completed`
- `reference.recorded`
- `probation.due`
- `probation.overdue`
- `probation.decided`
- `sla.warning`
- `sla.breached`
- `message.queued`
- `message.sent`
- `message.delivered`
- `message.failed`
- `message.not_configured`
- `message.received`
- `schedule.daily`
- `schedule.weekly`

## The rules

An event is queued, the worker drains the queue, and each enabled rule whose
trigger matches and whose conditions hold runs once. "Once" is enforced by an
idempotency key on the run, inserted before the action is taken — so a worker
that dies half-way does not repeat the half it finished.

| On | Rule | Trigger | Action | What it does | Runs |
| :-: | --- | --- | --- | --- | --: |
| ● | **Post to LinkedIn when a requisition opens** | `requisition.approved` | `publish_job` | Publish to LinkedIn and Bayut Careers | 0 |
| ● | **Acknowledge every application within 5 minutes** | `application.created` | `send_message` | Send "Application received" (auto-detect Arabic/English) | 0 |
| ● | **Nudge the panel after 48h without a scorecard** | `scorecard.overdue` | `notify` `create_task` | Email + in-app reminder to the interviewer | 0 |
| ● | **Flag applications sitting past stage SLA** | `sla.breached` | `notify` `create_task` | Raise a task on the owning recruiter | 0 |
| ● | **Send the assessment when a screen passes** | `application.stage_changed` | `send_message` `create_task` | Send assessment link, 48-hour expiry | 0 |
| ● | **Escalate offers above SAR 30,000 to Finance** | `offer.drafted` | `create_task` `notify` | Insert a Finance approval step | 0 |
| ● | **Open an HRIS onboarding record when an offer is signed** | `offer.signed` | `issue_employee_id` `send_message` `create_task` | Create the joiner in the HRIS and hand off to People Ops | 0 |
| · | **Move silver medallists to the talent pool on rejection** | `application.rejected` | `send_message` | Tag #silver-medallist where the last score was ≥ 4 | 0 |
| ● | **Weekly hiring digest to the leadership team** | `schedule.weekly` | `digest` | Email the pipeline and TAT summary | 0 |
| ● | **Purge candidate data after the consent window** | `schedule.daily` | `sweep` `sweep` `sweep` | Anonymise records past their retention date | 0 |

A failed run is retried with a back-off and its error is kept; the history is on
Settings → Automations, and a rule that keeps failing says so rather than going
quiet.

## The scheduled sweeps

These are not event-driven — they run on a clock, in `lib/services/sweeps.ts`,
and each is idempotent per day so running the worker twice changes nothing.

| Sweep | When | What it does |
| --- | --- | --- |
| SLA | Daily | Raises a task on any application past its stage's SLA, once. |
| Probation | Daily | Reminds the hiring manager a fortnight before three months is up. |
| Scorecard | Daily | Chases a panel member whose scorecard is still outstanding. |
| Retention | Daily | Deletes files past their retention date, and records that it did. |
| Candidate retention | Weekly | Flags candidate records past the consent window. |

## The worker

`npm run worker` drains the outbox, places scheduled calls, dispatches pending
events, retries failed runs, re-scans files whose scan was skipped, and runs the
daily and weekly sweeps. `npm run worker -- --once` does one pass and exits,
printing every provider's configured state on the way — which is the quickest
way to see what this environment can actually do.
