import 'server-only';
import { and, eq, or, sql, inArray } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import { jobs, jobHiringManagers, interviews, interviewPanel, applications } from '@/db/schema';
import { ForbiddenError, type Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   AUTHORIZATION

   Two questions, answered here and nowhere else:

     1. May this person perform this action at all?   — capability
     2. May they see this requisition?                — scope

   Both are answered on the server, at the root the data is read from, so a
   list, a board, a count and a chart can never disagree about what an account
   may see. Hiding a button is a courtesy to the person using the product; it is
   not a control, and nothing here depends on it.
   ═════════════════════════════════════════════════════════════════════════════*/

/* ── Capabilities ───────────────────────────────────────────────────────────
   Named for what they let somebody do, not for the screen they appear on, so a
   capability means the same thing wherever it is checked. */
export const CAPABILITIES = [
  // Hiring
  'job.view', 'job.create', 'job.edit', 'job.archive', 'job.publish', 'job.submit',
  'application.view', 'application.create', 'application.move', 'application.disqualify',
  'application.hold', 'application.rate',
  'candidate.view', 'candidate.create', 'candidate.edit', 'candidate.export',
  'candidate.claim', 'candidate.tag', 'candidate.pool',
  'cv.upload', 'cv.parse', 'cv.confirm',
  // Loop
  'screening.run', 'screening.call', 'screening.capture',
  'interview.schedule', 'interview.cancel', 'interview.reschedule',
  'scorecard.write', 'scorecard.nudge', 'review.write',
  'assessment.invite', 'assessment.complete',
  'pitch.send', 'pitch.run', 'pitch.configure',
  'ivreview.analyse', 'ivreview.coach',
  'comment.write', 'comment.pin', 'comment.delete',
  // Offers
  'offer.draft', 'offer.submit', 'offer.approve', 'offer.verify', 'offer.edit',
  'offer.send', 'offer.record_response', 'offer.answer_question', 'offer.revise',
  'offer.template.manage',
  /* Recording a document that arrived on the envelope. Distinct from editing
     the letter: the recruiter who receives an iqama copy by e-mail may put it
     on the envelope without being allowed to change a figure in the offer. */
  'offer.document',
  // Onboarding
  'onboarding.view', 'onboarding.verify', 'onboarding.edit', 'onboarding.notify',
  'onboarding.file', 'reference.record', 'probation.decide',
  // Plan
  'plan.view', 'plan.edit', 'plan.import',
  // Approvals
  'approval.act', 'approval.act_on_behalf', 'approval.configure',
  // Platform
  'team.view', 'team.manage', 'settings.view', 'settings.edit',
  'access.manage', 'automation.manage', 'integration.manage', 'audit.view',
  'insights.view', 'reports.ask', 'reports.save', 'data.export',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/* What each role can do. A hiring manager is not a lesser recruiter: the set is
   written out so that adding a capability never silently widens somebody. */
const HM_CAPS: Capability[] = [
  'job.view', 'application.view', 'candidate.view',
  'scorecard.write', 'review.write', 'comment.write',
  'approval.act', 'onboarding.view', 'insights.view',
];

const PARTICIPANT_CAPS: Capability[] = [
  'job.view', 'application.view', 'candidate.view', 'scorecard.write', 'review.write',
];

const COORDINATOR_CAPS: Capability[] = [
  'job.view', 'application.view', 'application.move', 'application.hold',
  'candidate.view', 'candidate.create', 'candidate.edit', 'candidate.tag', 'candidate.pool',
  'cv.upload', 'cv.parse', 'cv.confirm',
  'screening.run', 'screening.capture',
  'interview.schedule', 'interview.cancel', 'interview.reschedule',
  'scorecard.nudge', 'review.write', 'comment.write', 'comment.pin',
  'onboarding.view', 'plan.view', 'insights.view', 'team.view', 'settings.view',
  'reports.ask', 'reports.save',
];

const ONBOARDING_CAPS: Capability[] = [
  ...COORDINATOR_CAPS,
  'offer.verify', 'offer.edit', 'offer.answer_question', 'offer.template.manage',
  'offer.document',
  'onboarding.verify', 'onboarding.edit', 'onboarding.notify', 'onboarding.file',
  'reference.record', 'probation.decide',
];

const RECRUITER_CAPS: Capability[] = [
  'job.view', 'job.create', 'job.edit', 'job.archive', 'job.publish', 'job.submit',
  'application.view', 'application.create', 'application.move', 'application.disqualify',
  'application.hold', 'application.rate',
  'candidate.view', 'candidate.create', 'candidate.edit', 'candidate.export',
  'candidate.claim', 'candidate.tag', 'candidate.pool',
  'cv.upload', 'cv.parse', 'cv.confirm',
  'screening.run', 'screening.call', 'screening.capture',
  'interview.schedule', 'interview.cancel', 'interview.reschedule',
  'scorecard.write', 'scorecard.nudge', 'review.write',
  'assessment.invite', 'assessment.complete',
  'pitch.send', 'pitch.run',
  'ivreview.analyse', 'ivreview.coach',
  'comment.write', 'comment.pin', 'comment.delete',
  'offer.draft', 'offer.submit', 'offer.send', 'offer.record_response', 'offer.revise',
  'offer.document',
  'onboarding.view', 'reference.record', 'probation.decide',
  'plan.view',
  'team.view', 'settings.view', 'insights.view', 'reports.ask', 'reports.save', 'data.export',
];

/* The Admin — the Head of Talent Acquisition — has everything. It is written as
   "everything" rather than a list, because a capability nobody can reach is a
   capability nobody has tested. */
const ROLE_CAPS: Record<string, readonly Capability[] | 'all'> = {
  tal_lead: 'all',
  recruiter: RECRUITER_CAPS,
  sourcer: RECRUITER_CAPS.filter((c) => !c.startsWith('offer.')),
  coordinator: COORDINATOR_CAPS,
  onboarding: ONBOARDING_CAPS,
};

export function capabilities(v: Viewer): ReadonlySet<Capability> {
  if (v.role === 'hiring_manager') return new Set(HM_CAPS);
  if (v.role === 'participant') return new Set(PARTICIPANT_CAPS);
  const caps = ROLE_CAPS[v.staffRole ?? ''] ?? PARTICIPANT_CAPS;
  return caps === 'all' ? new Set(CAPABILITIES) : new Set(caps);
}

export function can(v: Viewer, cap: Capability): boolean {
  return capabilities(v).has(cap);
}

/** Throw unless the viewer holds the capability. The one gate every command passes. */
export function require_(v: Viewer, cap: Capability, message?: string): void {
  if (!can(v, cap)) {
    throw new ForbiddenError(message ?? portalMessage(v, cap));
  }
}

/* A hiring manager who tries something the desk handles gets told what their
   access does cover, which is more useful than "forbidden". */
function portalMessage(v: Viewer, cap: Capability): string {
  if (v.isPortal) {
    return 'Your access covers your own requisitions, interviews, approvals and feedback — '
      + 'the TA team handles this step';
  }
  return `Your role does not include ${cap.replace(/\./g, ' ')}. Ask an Admin.`;
}

/* ── Scope: which requisitions an account may see ────────────────────────────
   Three kinds:
     all   every requisition in the company
     own   the ones they are named on — a hiring manager, a panel member, or
           the recruiter, sourcer or coordinator who carries the desk
     jobs  a hand-picked list, optionally plus their own
   ───────────────────────────────────────────────────────────────────────────*/

/** A SQL predicate over `jobs`, for use in any query that reads requisitions. */
/**
 * The predicate, over whichever name the `jobs` table is going by.
 *
 * It names columns, so it has to agree with the query it is dropped into. A
 * query that writes `FROM jobs j` has no range table called `jobs` any more,
 * and PostgreSQL refuses `jobs.recruiter_id` with "invalid reference to
 * FROM-clause entry" — which only happens for an account whose scope is not
 * `all`, so the pages of everybody who could have caught it were fine. Pass
 * the alias when there is one.
 */
export function jobScopeSql(v: Viewer, alias?: string) {
  if (v.scope.kind === 'all') return sql`true`;

  /* `sql.raw` because this is our own identifier, from our own source — never
     anything a person typed. */
  const t = alias ? sql.raw(`"${alias.replace(/"/g, '')}"`) : sql`${jobs}`;

  const named = sql`(
    ${t}.recruiter_id = ${v.staffId ?? null}
    OR ${t}.sourcer_id = ${v.staffId ?? null}
    OR ${t}.coordinator_id = ${v.staffId ?? null}
    OR EXISTS (SELECT 1 FROM ${jobHiringManagers} h
                WHERE h.job_id = ${t}.id
                  AND (lower(h.name) = lower(${v.name}) OR lower(coalesce(h.email,'')) = lower(${v.email})))
    OR ${v.name} = ANY(${t}.panel)
    OR EXISTS (SELECT 1 FROM ${interviews} i
                JOIN ${interviewPanel} p ON p.interview_id = i.id
               WHERE i.job_id = ${t}.id AND i.status <> 'cancelled'
                 AND lower(p.name) = lower(${v.name}))
  )`;

  if (v.scope.kind === 'own') return named;

  const picked = v.scope.jobIds.length
    ? sql`${t}.id IN (${sql.join(v.scope.jobIds.map((id) => sql`${id}`), sql`, `)})`
    : sql`false`;
  return v.scope.own ? sql`(${picked} OR ${named})` : picked;
}

/** The same question about one requisition. */
export async function canSeeJob(v: Viewer, jobId: string, exec: Exec = db()): Promise<boolean> {
  if (!jobId) return false;
  if (v.scope.kind === 'all') return true;
  if (v.scope.kind === 'jobs' && v.scope.jobIds.includes(jobId)) return true;
  const rows = await exec.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.id, jobId), jobScopeSql(v))).limit(1);
  return rows.length > 0;
}

export async function requireJob(v: Viewer, jobId: string, exec: Exec = db()): Promise<void> {
  if (!(await canSeeJob(v, jobId, exec))) {
    throw new ForbiddenError('That requisition is outside your access');
  }
}

/** …and about one application, which is the requisition it sits on. */
export async function requireApplication(v: Viewer, applicationId: string, exec: Exec = db()): Promise<string> {
  const rows = await exec.select({ jobId: applications.jobId })
    .from(applications).where(eq(applications.id, applicationId)).limit(1);
  const jobId = rows[0]?.jobId;
  if (!jobId) throw new ForbiddenError('That application no longer exists');
  await requireJob(v, jobId, exec);
  return jobId;
}

/** The ids an account may see, when a query needs a list rather than a predicate. */
export async function visibleJobIds(v: Viewer, exec: Exec = db()): Promise<string[] | 'all'> {
  if (v.scope.kind === 'all') return 'all';
  const rows = await exec.select({ id: jobs.id }).from(jobs).where(jobScopeSql(v));
  return rows.map((r) => r.id);
}

/* ── Views ──────────────────────────────────────────────────────────────────
   Which sections of the product a role may open at all. A hiring manager lands
   on their own hiring and stays there; everything else bounces back. */
const PORTAL_VIEWS = new Set(['my', 'onboarding', 'jobs', 'candidates']);

export function canView(v: Viewer, view: string): boolean {
  if (!v.isPortal) {
    if (view === 'settings') return can(v, 'settings.view');
    if (view === 'team') return can(v, 'team.view');
    if (view === 'insights') return can(v, 'insights.view');
    return true;
  }
  return PORTAL_VIEWS.has(view);
}

/* ── The scope label the access list prints ─────────────────────────────── */
export function scopeLabel(scope: Viewer['scope']): string {
  if (scope.kind === 'all') return 'Every position';
  if (scope.kind === 'own') return 'Their own positions';
  const n = scope.jobIds.length;
  return `${n} position${n === 1 ? '' : 's'}${scope.own ? ' + their own' : ''}`;
}
