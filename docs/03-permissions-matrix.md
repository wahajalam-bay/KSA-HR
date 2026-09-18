# Permissions matrix

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

Two questions are answered on the server, in `lib/authz.ts`, and nowhere else:

1. **May this person perform this action at all?** — the capability, below.
2. **May they see this requisition?** — the scope, which is a separate axis and
   is applied to every query and every command. See `jobScopeSql`,
   `requireJob` and `requireApplication` in the same file.

Hiding a button is a courtesy to the person using the product. It is not a
control, and nothing here depends on it: every command passes `require_`
before its schema is parsed, and every query that reads a requisition applies
the scope at the root it is read from.

## How much each role holds

- **Admin** — 77 of 77
- **Recruiter** — 56 of 77
- **Sourcer** — 50 of 77
- **Coordinator** — 28 of 77
- **Onboarding** — 39 of 77
- **Analyst** — 5 of 77
- **Hiring manager** — 9 of 77
- **Participant** — 5 of 77

The Admin — the Head of Talent Acquisition — is written as *everything* rather
than a list, because a capability nobody can reach is a capability nobody has
tested.

## The scope, which is the other half

| Scope | What it means |
| --- | --- |
| `all` | Every requisition. The default for staff accounts. |
| `own` | The requisitions this person is named on as a hiring manager, plus the interviews they sit on. |
| `jobs` | Exactly the requisitions chosen for them; `scope_own` adds their own on top. |

A requisition that closes stays reachable to whoever could already see it, so
nobody's history disappears when a role is filled.

## Every capability, by group

### job

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `job.view` | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `job.create` | ● | ● | ● | · | · | · | · | · | `job.create` |
| `job.edit` | ● | ● | ● | · | · | · | · | · | `hm.lead` `hm.remove` `hm.save` `jd.save` `job.hold` `job.save` `job.sla` `jq.add` `jq.move` `jq.remove` `jq.req` `jq.save` `sk.save` |
| `job.archive` | ● | ● | ● | · | · | · | · | · | `job.archive` `job.reopen` |
| `job.publish` | ● | ● | ● | · | · | · | · | · | `job.post` |
| `job.submit` | ● | ● | ● | · | · | · | · | · | `job.submit` |

### application

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `application.view` | ● | ● | ● | ● | ● | ● | ● | ● | `app.emailSend` `task.assign` `task.create` `task.toggle` |
| `application.create` | ● | ● | ● | · | · | · | · | · | `cand.addToJob` |
| `application.move` | ● | ● | ● | ● | ● | · | · | · | `app.advance` `app.moveTo` |
| `application.disqualify` | ● | ● | ● | · | · | · | · | · | `app.rejectWith` |
| `application.hold` | ● | ● | ● | ● | ● | · | · | · | `app.hold` |
| `application.rate` | ● | ● | ● | · | · | · | · | · | `app.rate` |

### candidate

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `candidate.view` | ● | ● | ● | ● | ● | ● | ● | ● | `resume.download` |
| `candidate.create` | ● | ● | ● | ● | ● | · | · | · | `cand.create` |
| `candidate.edit` | ● | ● | ● | ● | ● | · | · | · | `cand.save` `photo.remove` |
| `candidate.export` | ● | ● | ● | · | · | · | · | · | — |
| `candidate.claim` | ● | ● | ● | · | · | · | · | · | `cand.claimSave` `cand.release` |
| `candidate.tag` | ● | ● | ● | ● | ● | · | · | · | `tag.save` |
| `candidate.pool` | ● | ● | ● | ● | ● | · | · | · | `pool.add` `pool.create` `pool.remove` |

### cv

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `cv.upload` | ● | ● | ● | ● | ● | · | · | · | `cand.stageFile` `cv.drop` `cv.intake` `resume.upload` |
| `cv.parse` | ● | ● | ● | ● | ● | · | · | · | `cv.fit` `cv.read` `cv.sector` |
| `cv.confirm` | ● | ● | ● | ● | ● | · | · | · | `cv.create` |

### screening

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `screening.run` | ● | ● | ● | ● | ● | · | · | · | `scr.invite` `scr.run` |
| `screening.call` | ● | ● | ● | · | · | · | · | · | `scr.callGo` `scr.callNow` `scr.cancelCall` `scr.scheduleAll` |
| `screening.capture` | ● | ● | ● | ● | ● | · | · | · | `scr.capture` `scr.salarySave` |

### interview

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `interview.schedule` | ● | ● | ● | ● | ● | · | · | · | `book.confirm` `ivw.create` |
| `interview.cancel` | ● | ● | ● | ● | ● | · | · | · | `ivw.cancel` |
| `interview.reschedule` | ● | ● | ● | ● | ● | · | · | · | `ivw.moveSave` |

### scorecard

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `scorecard.write` | ● | ● | ● | · | · | ● | ● | ● | `eval.save` |
| `scorecard.nudge` | ● | ● | ● | ● | ● | · | · | · | `eval.nudge` |

### review

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `review.write` | ● | ● | ● | ● | ● | ● | ● | ● | `rev.remove` `rev.save` |

### assessment

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `assessment.invite` | ● | ● | ● | · | · | · | · | · | `asm.remind` `asm.send` |
| `assessment.complete` | ● | ● | ● | · | · | · | · | · | `asm.complete` |

### pitch

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `pitch.send` | ● | ● | ● | · | · | · | · | · | `pitch.cancel` `pitch.send` |
| `pitch.run` | ● | ● | ● | · | · | · | · | · | `pitch.run` `pitch.score` |
| `pitch.configure` | ● | · | · | · | · | · | · | · | `pp.cfgSave` `pp.copy` `pp.save` `pp.toggle` |

### ivreview

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `ivreview.analyse` | ● | ● | ● | · | · | · | · | · | `ivr.analyse` `ivr.analyseAll` |
| `ivreview.coach` | ● | ● | ● | · | · | · | · | · | — |

### comment

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `comment.write` | ● | ● | ● | ● | ● | · | ● | · | `cmt.post` |
| `comment.pin` | ● | ● | ● | ● | ● | · | · | · | `cmt.pin` |
| `comment.delete` | ● | ● | ● | · | · | · | · | · | `cmt.del` |

### offer

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `offer.draft` | ● | ● | · | · | · | · | · | · | `offer.draft` |
| `offer.submit` | ● | ● | · | · | · | · | · | · | `offer.submit` |
| `offer.approve` | ● | · | · | · | · | · | · | · | — |
| `offer.verify` | ● | · | · | · | ● | · | · | · | `offer.unverify` `offer.verifyConfirm` |
| `offer.edit` | ● | · | · | · | ● | · | · | · | `offer.editSave` `otpl.scope` |
| `offer.send` | ● | ● | · | · | · | · | · | · | `offer.send` |
| `offer.record_response` | ● | ● | · | · | · | · | · | · | `offer.accept` `offer.declineSave` `offer.recordSigned` `offer.viewed` |
| `offer.answer_question` | ● | · | · | · | ● | · | · | · | — |
| `offer.revise` | ● | ● | · | · | · | · | · | · | `offer.reviseConfirm` |
| `offer.template.manage` | ● | · | · | · | ● | · | · | · | `otpl.upload` |
| `offer.document` | ● | ● | · | · | ● | · | · | · | `offer.doc` |

### onboarding

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `onboarding.view` | ● | ● | ● | ● | ● | · | ● | · | `onb.progress` |
| `onboarding.verify` | ● | · | · | · | ● | · | · | · | `emp.unverify` `emp.verify` `onb.reject` `onb.verify` |
| `onboarding.edit` | ● | · | · | · | ● | · | · | · | `emp.formSave` |
| `onboarding.notify` | ● | · | · | · | ● | · | · | · | `emp.remind` `onb.notifySend` |
| `onboarding.file` | ● | · | · | · | ● | · | · | · | `emp.doc` `onb.doc` `onb.fileSend` |

### reference

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `reference.record` | ● | ● | ● | · | ● | · | · | · | `ref.create` `ref.remove` `ref.save` `ref.status` |

### probation

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `probation.decide` | ● | ● | ● | · | ● | · | · | · | `prob.save` |

### plan

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `plan.view` | ● | ● | ● | ● | ● | · | · | · | `pos.nextCode` |
| `plan.edit` | ● | · | · | · | · | · | · | · | `pos.remove` `pos.save` |
| `plan.import` | ● | · | · | · | · | · | · | · | `mp.importCreate` `mp.importFile` |

### approval

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `approval.act` | ● | · | · | · | · | · | ● | · | `job.approve` `job.reject` `offer.approve` `offer.reject` |
| `approval.act_on_behalf` | ● | · | · | · | · | · | · | · | — |
| `approval.configure` | ● | · | · | · | · | · | · | · | `apf.save` `apf.stepRemove` `apf.stepSave` |

### team

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `team.view` | ● | ● | ● | ● | ● | · | · | · | `staff.owned` |
| `team.manage` | ● | · | · | · | · | · | · | · | `staff.create` `staff.deactivate` `staff.deleteConfirm` `staff.reactivate` `staff.restore` `staff.save` `staff.target` |

### settings

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `settings.view` | ● | ● | ● | ● | ● | · | · | · | — |
| `settings.edit` | ● | · | · | · | · | · | · | · | `apf.channel` `apf.move` `apf.publish` `dept.remove` `dept.save` `etpl.save` `pl.save` `qb.remove` `qb.save` `set.conn` `set.org` `set.sla` `set.slaReset` `tm.primary` `tm.remove` `tm.teamSave` |

### access

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `access.manage` | ● | · | · | · | · | · | · | · | `acc.inviteSave` `acc.remove` `acc.reset` `acc.scopeSave` `acc.toggle` |

### automation

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `automation.manage` | ● | · | · | · | · | · | · | · | `aut.toggle` |

### integration

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `integration.manage` | ● | · | · | · | · | · | · | · | — |

### audit

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `audit.view` | ● | · | · | · | · | · | · | · | — |

### insights

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `insights.view` | ● | ● | ● | ● | ● | · | ● | · | — |

### reports

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `reports.ask` | ● | ● | ● | ● | ● | · | · | · | `ask.csv` |
| `reports.save` | ● | ● | ● | ● | ● | · | · | · | `ask.save` `ask.unsave` |

### data

| Capability | Admin | Recruiter | Sourcer | Coordinator | Onboarding | Analyst | Hiring manager | Participant | Commands |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `data.export` | ● | ● | ● | · | · | · | · | · | `data.export` |
