# Migration and parity matrix

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

The prototype at `Bayut-TA-CRM-v30` is the specification and the visual
acceptance reference. This maps what it did to where that now lives.

## The shape of the translation

| In the prototype | In the product |
| --- | --- |
| `Actions['x.y'] = fn` — one function, called in the browser | A **command** in `lib/commands/`: capability, Zod schema, transaction, handler |
| `Store.patch(...)` — mutating an in-memory object | A **service** in `lib/services/`: the state machine, which validates, persists, audits and emits |
| `UI.Sheet.open({...})` — a string of HTML | A **sheet** in `lib/sheets/`: a server component that reads the database under the viewer's scope |
| `Sel.x(...)` — a selector over the store | A **query** in `lib/queries/`, scope applied at the root |
| `if (!Sel.isAdmin(ME())) return toast(...)` | `require_(viewer, capability)` in the dispatcher, before the schema is parsed |
| `localStorage` | PostgreSQL. The browser is not the system of record. |
| A toast that says something was sent | The outbox, which says whether it was |

## Every command in the product

One write door — `app/actions/dispatch.ts` — and this is everything behind it.
A command that is not registered in `lib/commands/index.ts` is unreachable, by
design.

| Command | Capability |
| --- | --- |
| `acc.inviteSave` | `access.manage` |
| `acc.remove` | `access.manage` |
| `acc.reset` | `access.manage` |
| `acc.scopeSave` | `access.manage` |
| `acc.toggle` | `access.manage` |
| `apf.channel` | `settings.edit` |
| `apf.move` | `settings.edit` |
| `apf.publish` | `settings.edit` |
| `apf.save` | `approval.configure` |
| `apf.stepRemove` | `approval.configure` |
| `apf.stepSave` | `approval.configure` |
| `app.advance` | `application.move` |
| `app.emailSend` | `application.view` |
| `app.hold` | `application.hold` |
| `app.moveTo` | `application.move` |
| `app.rate` | `application.rate` |
| `app.rejectWith` | `application.disqualify` |
| `ask.csv` | `reports.ask` |
| `ask.save` | `reports.save` |
| `ask.unsave` | `reports.save` |
| `asm.complete` | `assessment.complete` |
| `asm.remind` | `assessment.invite` |
| `asm.send` | `assessment.invite` |
| `aut.toggle` | `automation.manage` |
| `auth.signout` | `—` |
| `book.confirm` | `interview.schedule` |
| `cand.addToJob` | `application.create` |
| `cand.claimSave` | `candidate.claim` |
| `cand.create` | `candidate.create` |
| `cand.release` | `candidate.claim` |
| `cand.save` | `candidate.edit` |
| `cand.stageFile` | `cv.upload` |
| `cmt.del` | `comment.delete` |
| `cmt.pin` | `comment.pin` |
| `cmt.post` | `comment.write` |
| `cv.create` | `cv.confirm` |
| `cv.drop` | `cv.upload` |
| `cv.fit` | `cv.parse` |
| `cv.intake` | `cv.upload` |
| `cv.read` | `cv.parse` |
| `cv.sector` | `cv.parse` |
| `data.export` | `data.export` |
| `dept.remove` | `settings.edit` |
| `dept.save` | `settings.edit` |
| `emp.doc` | `onboarding.file` |
| `emp.formSave` | `onboarding.edit` |
| `emp.remind` | `onboarding.notify` |
| `emp.unverify` | `onboarding.verify` |
| `emp.verify` | `onboarding.verify` |
| `etpl.save` | `settings.edit` |
| `eval.nudge` | `scorecard.nudge` |
| `eval.save` | `scorecard.write` |
| `hm.lead` | `job.edit` |
| `hm.remove` | `job.edit` |
| `hm.save` | `job.edit` |
| `ivr.analyse` | `ivreview.analyse` |
| `ivr.analyseAll` | `ivreview.analyse` |
| `ivw.cancel` | `interview.cancel` |
| `ivw.create` | `interview.schedule` |
| `ivw.moveSave` | `interview.reschedule` |
| `jd.save` | `job.edit` |
| `job.approve` | `approval.act` |
| `job.archive` | `job.archive` |
| `job.create` | `job.create` |
| `job.hold` | `job.edit` |
| `job.post` | `job.publish` |
| `job.reject` | `approval.act` |
| `job.reopen` | `job.archive` |
| `job.save` | `job.edit` |
| `job.sla` | `job.edit` |
| `job.submit` | `job.submit` |
| `jq.add` | `job.edit` |
| `jq.move` | `job.edit` |
| `jq.remove` | `job.edit` |
| `jq.req` | `job.edit` |
| `jq.save` | `job.edit` |
| `me.set` | `—` |
| `mp.importCreate` | `plan.import` |
| `mp.importFile` | `plan.import` |
| `notif.go` | `—` |
| `notif.readall` | `—` |
| `offer.accept` | `offer.record_response` |
| `offer.approve` | `approval.act` |
| `offer.declineSave` | `offer.record_response` |
| `offer.doc` | `offer.document` |
| `offer.draft` | `offer.draft` |
| `offer.editSave` | `offer.edit` |
| `offer.recordSigned` | `offer.record_response` |
| `offer.reject` | `approval.act` |
| `offer.reviseConfirm` | `offer.revise` |
| `offer.send` | `offer.send` |
| `offer.submit` | `offer.submit` |
| `offer.unverify` | `offer.verify` |
| `offer.verifyConfirm` | `offer.verify` |
| `offer.viewed` | `offer.record_response` |
| `onb.doc` | `onboarding.file` |
| `onb.fileSend` | `onboarding.file` |
| `onb.notifySend` | `onboarding.notify` |
| `onb.progress` | `onboarding.view` |
| `onb.reject` | `onboarding.verify` |
| `onb.verify` | `onboarding.verify` |
| `otpl.scope` | `offer.edit` |
| `otpl.upload` | `offer.template.manage` |
| `photo.remove` | `candidate.edit` |
| `pitch.cancel` | `pitch.send` |
| `pitch.run` | `pitch.run` |
| `pitch.score` | `pitch.run` |
| `pitch.send` | `pitch.send` |
| `pl.save` | `settings.edit` |
| `pool.add` | `candidate.pool` |
| `pool.create` | `candidate.pool` |
| `pool.remove` | `candidate.pool` |
| `pos.nextCode` | `plan.view` |
| `pos.remove` | `plan.edit` |
| `pos.save` | `plan.edit` |
| `pp.cfgSave` | `pitch.configure` |
| `pp.copy` | `pitch.configure` |
| `pp.save` | `pitch.configure` |
| `pp.toggle` | `pitch.configure` |
| `prob.save` | `probation.decide` |
| `qb.remove` | `settings.edit` |
| `qb.save` | `settings.edit` |
| `ref.create` | `reference.record` |
| `ref.remove` | `reference.record` |
| `ref.save` | `reference.record` |
| `ref.status` | `reference.record` |
| `resume.download` | `candidate.view` |
| `resume.upload` | `cv.upload` |
| `rev.remove` | `review.write` |
| `rev.save` | `review.write` |
| `scr.callGo` | `screening.call` |
| `scr.callNow` | `screening.call` |
| `scr.cancelCall` | `screening.call` |
| `scr.capture` | `screening.capture` |
| `scr.invite` | `screening.run` |
| `scr.run` | `screening.run` |
| `scr.salarySave` | `screening.capture` |
| `scr.scheduleAll` | `screening.call` |
| `set.conn` | `settings.edit` |
| `set.org` | `settings.edit` |
| `set.sla` | `settings.edit` |
| `set.slaReset` | `settings.edit` |
| `sk.save` | `job.edit` |
| `staff.create` | `team.manage` |
| `staff.deactivate` | `team.manage` |
| `staff.deleteConfirm` | `team.manage` |
| `staff.owned` | `team.view` |
| `staff.photo` | `—` |
| `staff.reactivate` | `team.manage` |
| `staff.restore` | `team.manage` |
| `staff.save` | `team.manage` |
| `staff.target` | `team.manage` |
| `tag.save` | `candidate.tag` |
| `task.assign` | `application.view` |
| `task.create` | `application.view` |
| `task.toggle` | `application.view` |
| `tm.primary` | `settings.edit` |
| `tm.remove` | `settings.edit` |
| `tm.teamSave` | `settings.edit` |

## Every panel

- `acc.invite`
- `acc.scope`
- `apf.stepEdit`
- `app.email`
- `app.emailTpl`
- `app.move`
- `app.reject`
- `asm.complete`
- `asm.invite`
- `audit.open`
- `book.pick`
- `cand.claim`
- `cand.new`
- `cand.newJob`
- `create.open`
- `cv.review`
- `data.schema`
- `dept.edit`
- `dept.new`
- `drawer.app`
- `drawer.cand`
- `drawer.cand:tab`
- `drawer.cross`
- `drawer.open`
- `drawer.open:tab`
- `emp.formEdit`
- `emp.open`
- `eval.start`
- `help.open`
- `hm.add`
- `ivr.open`
- `ivw.new`
- `ivw.pickApp`
- `ivw.reschedule`
- `jd.edit`
- `job.addCand`
- `job.edit`
- `job.new`
- `jq.edit`
- `jq.new`
- `jq.pick`
- `me.switch`
- `mp.import`
- `mp.importPreview`
- `mp.template`
- `notif.open`
- `offer.decline`
- `offer.edit`
- `offer.open`
- `offer.queue`
- `offer.revise`
- `offer.verify`
- `onb.file`
- `onb.notify`
- `otpl.fields`
- `otpl.open`
- `pitch.brief`
- `pool.new`
- `pos.new`
- `pos.open`
- `pos.openReq`
- `pp.cfg`
- `pp.edit`
- `pp.new`
- `prob.open`
- `qb.edit`
- `qb.new`
- `ref.add`
- `ref.rate`
- `scr.call`
- `scr.salary`
- `scr.stageCalls`
- `scr.transcript`
- `sk.jd`
- `staff.delete`
- `staff.edit`
- `staff.new`
- `tag.add`
- `task.new`
- `tm.add`
- `tm.edit`

## Where the product deliberately differs

These are not gaps. Each is a place where doing what the prototype did would
have been dishonest in a system of record.

| The prototype | The product | Why |
| --- | --- | --- |
| A phone screen is "scheduled" with no telephony | Refused, with the missing setting named | A call nobody can place is not a call that is queued, and a recruiter who believes it is stops chasing |
| An assessment result is generated | Typed from the provider's report, or arrives by webhook | The product has no opinion about a person it has never met |
| A pitch is scored by the demo | Scored by a person, or by the configured model, and the row says which | Same |
| A file is "clean" | `skipped` until a scanner is configured | Pretending a file was scanned is worse than saying it was not |
| A seat is added to the plan directly | A seat arrives with the requisition that raised it | Headcount nobody approved is not headcount |
| An offer letter is edited after sending | Refused; version two supersedes it | The candidate holds a document |
