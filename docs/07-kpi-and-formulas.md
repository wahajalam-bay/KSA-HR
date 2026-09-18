# KPI and formula catalogue

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

Every number the product shows is computed in one place, so a figure on a chart
and the same figure on a card cannot disagree. This is that list.

## Pipeline

| Figure | How it is computed | Where |
| --- | --- | --- |
| **Time in stage** | Whole days from `stage_entered_at` to now, floored. | `lib/domain/stages.ts` |
| **SLA state** | `ok` under the stage's SLA, `due` on the day, `over` past it. Whole days, so a stage with a three-day SLA is over on day three. | `lib/domain/stages.ts` |
| **Conversion** | Applications that reached stage *n+1* over those that reached stage *n*. A disqualified application counts at the stage it reached — rejection is a status, not a tenth column. | `lib/queries/insights.ts` |
| **Time to hire** | Days from the application to the offer being accepted. | `lib/queries/insights.ts` |
| **Time to fill** | Days from the requisition opening to the offer being accepted. | `lib/queries/insights.ts` |
| **Offer acceptance** | Accepted over (accepted + declined). An offer still out counts in neither. | `lib/queries/offers.ts` |
| **Quality of hire** | Joiners who passed probation over joiners whose probation has been decided. | `lib/queries/insights.ts` |

## Fit against the bar

The skill bar on a requisition is what every candidate is drawn against.

- Each skill is scored 1–5; the candidate's level for it comes from the CV.
- An **essential** skill counts double.
- The score is the weighted mean over the bar, as a percentage.
- A candidate missing an essential skill is **flagged**, not averaged out — the
  panel is told which one rather than shown a slightly lower number.

`lib/domain/cv-fit.ts`, recomputed by `lib/services/fit.ts` whenever the bar
or the CV changes.

## The phone and chat screen

Six knockout questions, in `lib/domain/screening.ts`. Each is scored by the
rules in that file — never by a model — and the verdict is:

| Verdict | When |
| --- | --- |
| `pass` | Every knockout answered acceptably. |
| `review` | One missed, or an answer that needs a person to read it. |
| `fail` | More than one missed. |

## The behavioural questionnaire

Six traits out of ten each, taken from the provider's report. The score is the
six out of sixty as a percentage: **strong** at 75 and over, **mixed** 60–74,
**concern** below. Nothing is inferred — a missing trait is refused rather than
guessed, because the final interview turns on this.

## The sales pitch

Scored against the criteria on the project, each out of its own maximum. The
percentage is the total over the possible total. It is scored by a person or by
the configured model, and the row records which.

## How an interview was run

Six criteria, one to five, meaned onto a hundred. This is coaching for whoever
ran the interview; it says nothing about the candidate.

| Key | Criterion | What it looks at |
| --- | --- | --- |
| `opening` | Opening | introduced themselves and the role, set the agenda, put the candidate at ease |
| `questions` | Questions | covered what the JD asks for, asked for evidence, nothing leading |
| `listening` | Listening | let answers finish, followed up, talked less than the candidate |
| `compliance` | Compliance | consent to record, nothing unlawful — age, marital status, family plans, nationality |
| `closing` | Closing | answered their questions, gave a next step and a date |
| `scorecard` | Scorecard | written up, and written up while it was still fresh |

Bands: 85+ exemplary, 80+ strong, 65+ solid, 50+ needs coaching, below 50 off
standard. A review is **flagged** when compliance scores two or less, or when
the analysis raised a flag. `lib/domain/ivreview.ts`.

## Which industry a candidate came from

Two passes, in order, in `lib/domain/sector.ts`. Both are rules; nothing here
asks a model, and the answer always carries the reason it reached.

1. **The employer.** If the company is one the organisation already knows — the
   table lives in the organisation's own settings, because it is a fact about
   this market rather than about software — that answers it. An exact name
   first, then a loose match, with a floor on the length so a three-letter
   fragment does not match half the table.
2. **The words on the page.** Failing a known employer, the title, the summary
   and the experience are read against the phrases each of the eighteen sectors
   actually uses about itself. First match wins, and the list runs from the most
   specific to the most general.

Failing both, the answer is **Other** — and it says so, rather than guessing.
A recruiter who disagrees can type it in, which is recorded as `recruiter`
rather than `cv`.

## The offer letter's merge fields

Anything in double braces is replaced when the letter is filled. A field that is
not on this list is left in its braces and counted as **unresolved** — and a
letter with an unresolved field cannot be sent.

| Field | Where the value comes from |
| --- | --- |
| `{{company}}` | Settings |
| `{{legal_entity}}` | Settings |
| `{{offer_date}}` | Offer |
| `{{expiry_date}}` | Offer · created + 7 days |
| `{{candidate_name}}` | Candidate |
| `{{first_name}}` | Candidate |
| `{{candidate_email}}` | Candidate |
| `{{job_title}}` | Requisition |
| `{{department}}` | Requisition |
| `{{location}}` | Requisition |
| `{{reporting_to}}` | Requisition · hiring manager |
| `{{recruiter_name}}` | Requisition · owner |
| `{{start_date}}` | Offer |
| `{{contract_type}}` | Requisition |
| `{{work_week}}` | Policy |
| `{{currency}}` | Offer |
| `{{base_monthly}}` | Offer terms |
| `{{housing_allowance}}` | Offer terms |
| `{{transport_allowance}}` | Offer terms |
| `{{total_monthly}}` | Offer terms |
| `{{annual_bonus}}` | Offer terms |
| `{{probation_months}}` | Policy |
| `{{annual_leave_days}}` | Policy · by level |
| `{{notice_period_days}}` | Policy |
| `{{signatory}}` | Settings |
| `{{signatory_title}}` | Settings |
| `{{onboarding_contact}}` | Team |
| `{{commission_plan}}` | Requisition · commercial only |
| `{{ote_annual}}` | Requisition · commercial only |

The salary and date fields follow the offer's terms and are changed through the
terms rather than by hand; the rest can be corrected by Onboarding, and every
correction is kept with what it changed from.
