import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  offers, offerDocuments, offerSignatures, offerLetterEdits, offerTemplates,
  approvals, approvalSteps, approvalFlows,
  applications, jobs, candidates, staff, departments, tasks, locations, orgSettings,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { buildSteps } from '@/lib/queries/approvals';
import { queueMessage } from '@/lib/services/messaging';
import { mintLink, revokeLinks } from '@/lib/services/links';
import { notify } from '@/lib/services/notify';
import { moveStage } from '@/lib/services/transitions';
import { OFFER_DOCS, offerLetter, sendReadiness, type LetterContext } from '@/lib/services/offer-letter';
import { providers } from '@/lib/env';
import { ensureEmployee } from '@/lib/services/onboarding';

/* ═════════════════════════════════════════════════════════════════════════════
   OFFERS

   The longest state machine in the product, and the one where a mistake costs
   the most:

     draft ──submit──▶ pending_approval ──approve──▶ approved ──send──▶ sent
                             │                           ▲                │
                             └──reject──▶ draft          │              viewed
                                                          verify          │
                                                                        signed
                                                                          │
                                                          accepted ◀──────┴──▶ declined

   Four rules hold it together, and each one is enforced here rather than by
   hiding a button:

     · the chain closes before the letter goes out, and the letter is verified
       by Onboarding before that — sendReadiness says which of the four checks
       is stopping it;
     · a sent letter is immutable. Correcting one means version two, which
       supersedes version one and needs verifying again;
     · a candidate cannot sign until the four documents are on the envelope;
     · acceptance hires exactly once. The employee record has a unique index on
       the application, so two people pressing the button at the same moment
       produce one employee and one clear error.
   ═════════════════════════════════════════════════════════════════════════════*/

export const SENT_STATES = ['sent', 'viewed', 'signed', 'accepted', 'declined', 'expired'] as const;
const isSent = (s: string) => (SENT_STATES as readonly string[]).includes(s);

export type Terms = {
  baseMonthly: number;
  housing: number;
  transport: number;
  annualBonusPct: number;
  startDate: string;
  templateId?: string | null;
};

/** Everything the letter needs, gathered once. */
export async function letterContext(
  offerId: string, exec: Exec,
): Promise<{ letter: LetterContext; offer: typeof offers.$inferSelect; candidateName: string }> {
  const [r] = rowsOf(await exec.execute(sql`
    SELECT o.*, c.name AS candidate_name, c.email AS candidate_email,
           j.title AS job_title, j.family, j.employment_type, j.hiring_manager,
           d.name AS dept_name, l.office, l.city,
           rec.name AS recruiter_name, t.body AS template_body
      FROM ${offers} o
      JOIN ${candidates} c ON c.id = o.candidate_id
      JOIN ${jobs} j ON j.id = o.job_id
      LEFT JOIN ${departments} d ON d.id = j.dept_id
      LEFT JOIN ${locations} l ON l.id = j.location_id
      LEFT JOIN ${staff} rec ON rec.id = j.recruiter_id
      LEFT JOIN ${offerTemplates} t ON t.id = o.template_id
     WHERE o.id = ${offerId}`));
  if (!r) throw new CommandError('That offer no longer exists');

  const [org] = await exec.select().from(orgSettings).limit(1);
  const onb = rowsOf(await exec.execute(sql`
    SELECT name, email FROM ${staff}
     WHERE role = 'onboarding' AND status = 'active' ORDER BY id LIMIT 1`))[0] ?? null;

  const [offer] = await exec.select().from(offers).where(eq(offers.id, offerId)).limit(1);

  return {
    offer,
    candidateName: r.candidate_name as string,
    letter: {
      offer: {
        id: r.id as string,
        createdAt: String(r.created_at),
        startDate: r.start_date as string,
        currency: (r.currency ?? null) as string | null,
        baseMonthly: Number(r.base_monthly),
        housing: Number(r.housing),
        transport: Number(r.transport),
        annualBonusPct: Number(r.annual_bonus_pct),
        fieldOverrides: (r.field_overrides ?? {}) as Record<string, string>,
        letterOverride: (r.letter_override ?? null) as string | null,
        templateName: (r.template_name ?? null) as string | null,
        templateBody: (r.template_body ?? null) as string | null,
      },
      candidate: {
        name: r.candidate_name as string,
        email: (r.candidate_email ?? null) as string | null,
      },
      job: {
        title: r.job_title as string,
        family: (r.family ?? null) as string | null,
        employmentType: (r.employment_type ?? null) as string | null,
        hiringManager: (r.hiring_manager ?? null) as string | null,
        deptName: (r.dept_name ?? '') as string,
        office: (r.office ?? '') as string,
        city: (r.city ?? '') as string,
        recruiterName: (r.recruiter_name ?? null) as string | null,
      },
      org: {
        orgName: String(org?.orgName ?? 'Bayut KSA'),
        legalName: String(org?.legalName ?? 'Bayut Saudi Arabia'),
        signedBy: org?.signedBy ?? null,
        probationMonths: Number(org?.probationMonths ?? 3),
      },
      onboarding: onb ? { name: onb.name as string, email: (onb.email ?? null) as string | null } : null,
    },
  };
}

/** The offer in play on an application — the newest version. */
export async function offerOf(
  applicationId: string, exec: Exec,
): Promise<typeof offers.$inferSelect | null> {
  const [row] = await exec.select().from(offers)
    .where(eq(offers.applicationId, applicationId))
    .orderBy(sql`${offers.version} DESC`)
    .limit(1);
  return row ?? null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/* ── Drafting ────────────────────────────────────────────────────────────── */

export type DraftResult = {
  offerId: string;
  reference: string;
  candidateName: string;
  templateName: string | null;
  verifierName: string | null;
};

export async function draftOffer(
  input: { applicationId: string; terms?: Partial<Terms> },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<DraftResult> {
  const [app] = await ctx.tx.select().from(applications)
    .where(eq(applications.id, input.applicationId)).limit(1);
  if (!app) throw new CommandError('That application no longer exists');
  if (!['active', 'on_hold'].includes(app.status)) {
    throw new CommandError('That application is closed — there is nobody to make an offer to');
  }
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, app.candidateId)).limit(1);
  if (!job || !cand) throw new CommandError('That requisition or candidate no longer exists');

  const live = await offerOf(input.applicationId, ctx.tx);
  if (live && !['declined', 'withdrawn', 'expired'].includes(live.state)) {
    throw new CommandError(
      `${cand.name} already has an offer (${live.reference}) — revise it rather than drafting a second`,
      { tone: 'warn' },
    );
  }

  /* What the recruiter would have typed: their expectation, inside the band,
     to the nearest five hundred. */
  const suggested = Math.round(
    clamp(cand.expectedSalary ?? job.salaryMin ?? 0, job.salaryMin ?? 0, job.salaryMax ?? 0) / 500,
  ) * 500;
  const base = Math.round(input.terms?.baseMonthly ?? suggested);
  if (!base || base <= 0) throw new CommandError('A basic salary, please');

  const housing = Math.round(input.terms?.housing ?? base * 0.25);
  const transport = Math.round(input.terms?.transport ?? 1000);
  const bonus = Math.round(
    input.terms?.annualBonusPct
      ?? (['Sales', 'Integrated Services'].includes(job.family) ? 20 : 10),
  );
  const startDate = input.terms?.startDate
    ?? new Date(ctx.now.getTime() + 45 * 86_400_000).toISOString().slice(0, 10);

  const [tpl] = input.terms?.templateId
    ? await ctx.tx.select().from(offerTemplates)
      .where(eq(offerTemplates.id, input.terms.templateId)).limit(1)
    : await ctx.tx.select().from(offerTemplates)
      .where(sql`${offerTemplates.archivedAt} IS NULL
                 AND (${offerTemplates.family} IS NULL OR ${offerTemplates.family} = ${job.family})`)
      .orderBy(sql`${offerTemplates.family} NULLS LAST`, asc(offerTemplates.sortOrder))
      .limit(1);

  const [{ reference }] = rowsOf(await ctx.tx.execute(sql`
    SELECT next_reference('OFF', 4) AS reference`)) as Array<{ reference: string }>;

  const offerId = `off_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(offers).values({
    id: offerId,
    reference,
    applicationId: app.id,
    jobId: app.jobId,
    candidateId: app.candidateId,
    version: (live?.version ?? 0) + 1,
    supersedesId: live?.id ?? null,
    baseMonthly: base,
    housing,
    transport,
    annualBonusPct: bonus,
    currency: 'SAR',
    startDate,
    state: 'draft',
    templateId: tpl?.id ?? null,
    templateName: tpl?.name ?? null,
    createdAt: ctx.now,
    createdBy: ctx.viewer.staffId ?? null,
    updatedAt: ctx.now,
  });

  /* The candidate signs; the company's signature is printed on the letter. */
  await ctx.tx.insert(offerSignatures).values({
    offerId, name: cand.name, email: cand.email, role: 'Candidate', state: 'not_sent', sortOrder: 0,
  });

  if (app.stage !== 'offer') {
    await moveStage({ applicationId: app.id, toStage: 'offer', source: 'offer' }, ctx);
  }

  const verifier = await onboardingSpecialist(ctx.tx);
  await ctx.tx.insert(tasks).values({
    kind: 'verify_offer',
    title: `Verify offer letter — ${cand.name}`,
    applicationId: app.id,
    jobId: app.jobId,
    candidateId: app.candidateId,
    offerId,
    assigneeId: verifier?.id ?? ctx.viewer.staffId ?? null,
    dueOn: new Date(ctx.now.getTime() + 2 * 86_400_000),
    priority: 'normal',
    done: false,
    createdBy: ctx.viewer.staffId ?? null,
    createdAt: ctx.now,
    dedupeKey: `verify_offer:${offerId}`,
  }).onConflictDoNothing();

  await notify({
    kind: 'offer',
    staffId: verifier?.id ?? null,
    text: `Offer letter for ${cand.name} is filled from ${tpl?.name ?? 'no template'} and waiting for verification`,
    applicationId: app.id,
    jobId: app.jobId,
    candidateId: app.candidateId,
    offerId,
    dedupeKey: `offer.drafted:${offerId}`,
  }, ctx);

  await audit(ctx, {
    action: 'create',
    summary: `drafted ${reference} for ${cand.name} — ${base.toLocaleString('en-US')} basic`,
    entityType: 'offer', entityId: offerId, entityLabel: cand.name,
    after: { baseMonthly: base, housing, transport, annualBonusPct: bonus, startDate },
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.drafted', subjectType: 'offer', subjectId: offerId,
    payload: { applicationId: app.id, baseMonthly: base },
  }, ctx.tx);

  return {
    offerId,
    reference,
    candidateName: cand.name,
    templateName: tpl?.name ?? null,
    verifierName: verifier?.name ?? null,
  };
}

async function onboardingSpecialist(exec: Exec): Promise<{ id: string; name: string } | null> {
  const [row] = await exec.select({ id: staff.id, name: staff.name }).from(staff)
    .where(and(eq(staff.role, 'onboarding'), eq(staff.status, 'active')))
    .orderBy(asc(staff.id))
    .limit(1);
  return row ?? null;
}

/* ── The approval chain ──────────────────────────────────────────────────── */

export type SubmitResult = {
  offerId: string; candidateName: string; steps: number; approvedImmediately: boolean;
};

export async function submitOffer(
  offerId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<SubmitResult> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (o.state !== 'draft') {
    throw new CommandError(
      o.state === 'pending_approval' ? 'That offer is already in the approval chain'
        : 'Only a draft offer can be submitted for approval',
      { tone: 'warn' },
    );
  }

  const [existing] = await ctx.tx.select().from(approvals)
    .where(and(eq(approvals.subject, 'offer'), eq(approvals.subjectId, offerId),
      eq(approvals.state, 'pending'))).limit(1);
  if (existing) throw new CommandError('That offer is already waiting on an approval');

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, o.jobId)).limit(1);
  const [dept] = job?.deptId
    ? await ctx.tx.select().from(departments).where(eq(departments.id, job.deptId)).limit(1)
    : [];

  const built = await buildSteps('offer', {
    openings: job?.openings ?? 0,
    salaryMin: job?.salaryMin ?? 0,
    salaryMax: job?.salaryMax ?? 0,
    baseMonthly: o.baseMonthly,
    totalMonthly: o.baseMonthly + o.housing + o.transport,
    annualBonusPct: o.annualBonusPct,
    hiringManager: job?.hiringManager ?? null,
    deptHead: dept?.head ?? null,
    deptHeadTitle: dept?.headTitle ?? null,
  }, ctx.tx);
  if (!built.length) throw new CommandError('No approval chain is configured for offers');

  const [flow] = await ctx.tx.select().from(approvalFlows)
    .where(and(eq(approvalFlows.subject, 'offer'), eq(approvalFlows.isActive, true))).limit(1);

  const approvalId = `apr_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(approvals).values({
    id: approvalId,
    subject: 'offer',
    subjectId: offerId,
    flowId: flow?.id ?? null,
    state: 'pending',
    requestedBy: ctx.viewer.staffId ?? null,
    requestedByName: ctx.viewer.name,
    requestedAt: ctx.now,
  });
  for (const s of built) {
    await ctx.tx.insert(approvalSteps).values({
      id: `aps_${crypto.randomUUID().slice(0, 12)}`,
      approvalId,
      stepKey: s.stepKey,
      ordinal: s.ordinal,
      label: s.label,
      approverType: s.approverType as 'role',
      approverRole: s.approverRole,
      approverStaffId: s.approverStaffId,
      approverName: s.approverName,
      approverTitle: s.approverTitle,
      approverEmail: s.approverEmail,
      conditionText: s.conditionText,
      auto: s.auto,
      state: 'pending',
    });
  }

  await ctx.tx.update(offers)
    .set({ state: 'pending_approval', updatedAt: ctx.now })
    .where(eq(offers.id, offerId));

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);

  await audit(ctx, {
    action: 'action',
    summary: `sent ${o.reference} for approval — ${built.length} step${built.length === 1 ? '' : 's'}`,
    entityType: 'offer', entityId: offerId, entityLabel: cand?.name ?? null,
    before: { state: 'draft' }, after: { state: 'pending_approval' },
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.submitted', subjectType: 'offer', subjectId: offerId,
    payload: { applicationId: o.applicationId, steps: built.length },
  }, ctx.tx);

  const auto = built.filter((s) => s.auto);
  for (const s of auto) {
    await ctx.tx.update(approvalSteps)
      .set({ state: 'approved', decidedAt: ctx.now, decidedByName: 'Recorded automatically' })
      .where(and(eq(approvalSteps.approvalId, approvalId), eq(approvalSteps.ordinal, s.ordinal)));
  }
  const closed = auto.length === built.length;
  if (closed) await closeOfferChain(approvalId, offerId, ctx);

  return {
    offerId,
    candidateName: cand?.name ?? 'the candidate',
    steps: built.length,
    approvedImmediately: closed,
  };
}

async function closeOfferChain(
  approvalId: string, offerId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  await ctx.tx.update(approvals)
    .set({ state: 'approved', decidedAt: ctx.now })
    .where(eq(approvals.id, approvalId));
  await ctx.tx.update(offers)
    .set({ state: 'approved', updatedAt: ctx.now })
    .where(eq(offers.id, offerId));
  await emit(ctx, {
    type: 'offer.approved', subjectType: 'offer', subjectId: offerId, payload: {},
  }, ctx.tx);
}

export type DecideResult = {
  offerId: string; candidateName: string; label: string;
  finished: boolean; rejected: boolean; nextWith: string | null; verified: boolean;
};

export async function decideOffer(
  offerId: string,
  decision: 'approve' | 'reject',
  reason: string | null,
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<DecideResult> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (o.state !== 'pending_approval') {
    throw new CommandError('That offer is not waiting on an approval', { tone: 'warn' });
  }

  const [approval] = rowsOf(await ctx.tx.execute(sql`
    SELECT id FROM ${approvals}
     WHERE subject = 'offer' AND subject_id = ${offerId} AND state = 'pending'
     FOR UPDATE`));
  if (!approval) throw new CommandError('That approval has already been decided', { tone: 'warn' });
  const approvalId = approval.id as string;

  const [step] = await ctx.tx.select().from(approvalSteps)
    .where(and(eq(approvalSteps.approvalId, approvalId), eq(approvalSteps.state, 'pending')))
    .orderBy(asc(approvalSteps.ordinal))
    .limit(1);
  if (!step) throw new CommandError('Every step on that offer is already decided', { tone: 'warn' });

  const named = (step.approverName ?? '').toLowerCase() === ctx.viewer.name.toLowerCase();
  if (!named && !ctx.viewer.isAdmin) {
    throw new CommandError(`This step is with ${step.approverName} — only they or an Admin can approve it`);
  }
  if (decision === 'reject' && !reason?.trim()) {
    throw new CommandError('A reason, so the recruiter knows what to change');
  }

  await ctx.tx.update(approvalSteps).set({
    state: decision === 'approve' ? 'approved' : 'rejected',
    decidedAt: ctx.now,
    decidedBy: ctx.viewer.staffId ?? null,
    decidedByName: ctx.viewer.name,
    onBehalfOf: named ? null : step.approverName,
    note: reason,
  }).where(eq(approvalSteps.id, step.id));

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);

  if (decision === 'reject') {
    await ctx.tx.update(approvals)
      .set({ state: 'rejected', decidedAt: ctx.now })
      .where(eq(approvals.id, approvalId));
    await ctx.tx.update(offers)
      .set({ state: 'draft', updatedAt: ctx.now })
      .where(eq(offers.id, offerId));
    await audit(ctx, {
      action: 'action',
      summary: `sent ${o.reference} back at ${step.label} — ${reason}`,
      entityType: 'offer', entityId: offerId, entityLabel: cand?.name ?? null,
      before: { state: 'pending_approval' }, after: { state: 'draft' }, reason,
    }, ctx.tx);
    return {
      offerId, candidateName: cand?.name ?? 'the candidate', label: step.label,
      finished: true, rejected: true, nextWith: null, verified: !!o.verifiedAt,
    };
  }

  await audit(ctx, {
    action: 'action',
    summary: `approved ${step.label} on ${o.reference}`,
    entityType: 'offer', entityId: offerId, entityLabel: cand?.name ?? null,
    reason,
  }, ctx.tx);

  const [next] = await ctx.tx.select().from(approvalSteps)
    .where(and(eq(approvalSteps.approvalId, approvalId), eq(approvalSteps.state, 'pending')))
    .orderBy(asc(approvalSteps.ordinal))
    .limit(1);
  if (!next) {
    await closeOfferChain(approvalId, offerId, ctx);
    return {
      offerId, candidateName: cand?.name ?? 'the candidate', label: step.label,
      finished: true, rejected: false, nextWith: null, verified: !!o.verifiedAt,
    };
  }
  return {
    offerId, candidateName: cand?.name ?? 'the candidate', label: step.label,
    finished: false, rejected: false, nextWith: next.approverName, verified: !!o.verifiedAt,
  };
}

/* ── Verification ────────────────────────────────────────────────────────── */

/** Only Onboarding or an Admin checks a letter — never the person who wrote it. */
export function mayVerify(v: Ctx['viewer']): boolean {
  return v.isAdmin || v.staffRole === 'onboarding' || v.staffRole === 'tal_lead';
}

export async function verifyLetter(
  input: { offerId: string; note?: string | null }, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; readyToSend: boolean }> {
  if (!mayVerify(ctx.viewer)) {
    throw new CommandError('Only Onboarding or an Admin can verify an offer');
  }
  const x = await letterContext(input.offerId, ctx.tx);
  const o = x.offer;
  if (isSent(o.state)) throw new CommandError('That letter has already gone out', { tone: 'warn' });

  const letter = offerLetter(x.letter);
  const { checks } = sendReadiness(o.state, letter, null);
  const blocking = checks.find((c) => !c.ok && c.k !== 'approved' && c.k !== 'verified');
  if (blocking) throw new CommandError(`${blocking.t} — fix it before verifying`);

  await ctx.tx.update(offers).set({
    verifiedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
    verifiedAt: ctx.now,
    verifiedNote: input.note?.trim() || null,
    updatedAt: ctx.now,
  }).where(eq(offers.id, input.offerId));

  await ctx.tx.update(tasks).set({ done: true, doneAt: ctx.now, doneBy: ctx.viewer.staffId ?? null })
    .where(and(eq(tasks.offerId, input.offerId), eq(tasks.kind, 'verify_offer'), eq(tasks.done, false)));

  await notify({
    kind: 'offer',
    text: `${ctx.viewer.name} verified the offer letter for ${x.candidateName}`
      + (o.state === 'approved' ? ' — ready to send' : ''),
    applicationId: o.applicationId,
    jobId: o.jobId,
    candidateId: o.candidateId,
    offerId: o.id,
    dedupeKey: `offer.verified:${o.id}`,
  }, ctx);

  await audit(ctx, {
    action: 'action',
    summary: `verified the offer letter for ${x.candidateName}`,
    entityType: 'offer', entityId: input.offerId, entityLabel: x.candidateName,
    after: { verified: true }, reason: input.note?.trim() || null,
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.verified', subjectType: 'offer', subjectId: input.offerId,
    payload: { applicationId: o.applicationId },
  }, ctx.tx);

  return { candidateName: x.candidateName, readyToSend: o.state === 'approved' };
}

export async function unverifyLetter(
  offerId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string }> {
  if (!mayVerify(ctx.viewer)) {
    throw new CommandError('Only Onboarding or an Admin can re-open an offer letter');
  }
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (isSent(o.state)) throw new CommandError('That letter has already gone out', { tone: 'warn' });

  await ctx.tx.update(offers)
    .set({ verifiedBy: null, verifiedAt: null, verifiedNote: null, updatedAt: ctx.now })
    .where(eq(offers.id, offerId));

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);
  await audit(ctx, {
    action: 'action',
    summary: `re-opened the offer letter for ${cand?.name ?? 'the candidate'} for corrections`,
    entityType: 'offer', entityId: offerId, entityLabel: cand?.name ?? null,
    after: { verified: false },
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate' };
}

/**
 * The terms on an offer that has not gone out. Changing any of them clears the
 * verification, because a verified letter is a statement about figures that are
 * no longer the figures.
 */
export async function editTerms(
  input: { offerId: string; terms: Partial<Terms> },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; changed: string[] }> {
  if (!mayVerify(ctx.viewer)) {
    throw new CommandError('Only Onboarding or an Admin can change the terms on a drafted offer');
  }
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, input.offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (isSent(o.state)) {
    throw new CommandError('That letter has gone out — make version two rather than editing it', { tone: 'warn' });
  }

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, o.jobId)).limit(1);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);

  const next: Record<string, unknown> = {};
  const changed: string[] = [];
  const set = (k: keyof typeof o, value: unknown, label: string) => {
    if (value === undefined || value === null) return;
    if (String(o[k]) === String(value)) return;
    next[k] = value;
    changed.push(label);
  };

  if (input.terms.baseMonthly != null) {
    const base = Math.round(input.terms.baseMonthly);
    if (base <= 0) throw new CommandError('A basic salary, please');
    /* The band is a guard rail, not a wall: a basic outside it is allowed but
       has to be said out loud, because the approval chain reads this figure. */
    if (job && (base < job.salaryMin || base > job.salaryMax)) {
      throw new CommandError(
        `${fmtSar(base)} is outside the band for ${job.title} (${fmtSar(job.salaryMin)} – ${fmtSar(job.salaryMax)})`
        + ' — change the band on the requisition, or bring the basic inside it',
      );
    }
    set('baseMonthly', base, 'basic');
  }
  if (input.terms.housing != null) set('housing', Math.round(input.terms.housing), 'housing');
  if (input.terms.transport != null) set('transport', Math.round(input.terms.transport), 'transport');
  if (input.terms.annualBonusPct != null) {
    set('annualBonusPct', Math.round(input.terms.annualBonusPct), 'bonus');
  }
  if (input.terms.startDate) set('startDate', input.terms.startDate, 'start date');
  if (input.terms.templateId) {
    const [tpl] = await ctx.tx.select().from(offerTemplates)
      .where(eq(offerTemplates.id, input.terms.templateId)).limit(1);
    if (!tpl) throw new CommandError('That letter template no longer exists');
    if (tpl.id !== o.templateId) {
      next.templateId = tpl.id;
      next.templateName = tpl.name;
      /* A different template is a different letter: any wording typed against
         the old one no longer belongs to it. */
      next.letterOverride = null;
      changed.push('template');
    }
  }

  if (!changed.length) return { candidateName: cand?.name ?? 'the candidate', changed };

  await ctx.tx.update(offers).set({
    ...next,
    verifiedBy: null, verifiedAt: null, verifiedNote: null,
    updatedAt: ctx.now,
  }).where(eq(offers.id, input.offerId));

  await audit(ctx, {
    action: 'update',
    summary: `changed the ${changed.join(', ')} on the offer for ${cand?.name ?? 'the candidate'}`,
    entityType: 'offer', entityId: input.offerId, entityLabel: cand?.name ?? null,
    before: {
      baseMonthly: o.baseMonthly, housing: o.housing, transport: o.transport,
      annualBonusPct: o.annualBonusPct, startDate: o.startDate, templateId: o.templateId,
    },
    after: next,
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate', changed };
}

const fmtSar = (n: number) => `SAR ${n.toLocaleString('en-US')}`;

/** A correction to one field, or to the wording. Every one is on the record. */
export async function editLetter(
  input: { offerId: string; field: string; value: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; field: string }> {
  if (!mayVerify(ctx.viewer)) {
    throw new CommandError('Only Onboarding or an Admin can correct an offer letter');
  }
  const x = await letterContext(input.offerId, ctx.tx);
  const o = x.offer;
  if (isSent(o.state)) {
    throw new CommandError('That letter has gone out — make version two rather than editing it', { tone: 'warn' });
  }

  const from = input.field === 'wording'
    ? (o.letterOverride ?? null)
    : (o.fieldOverrides[input.field] ?? null);
  const to = input.value?.trim() || null;
  if (from === to) return { candidateName: x.candidateName, field: input.field };

  if (input.field === 'wording') {
    await ctx.tx.update(offers)
      .set({ letterOverride: to, verifiedBy: null, verifiedAt: null, updatedAt: ctx.now })
      .where(eq(offers.id, input.offerId));
  } else {
    const next = { ...o.fieldOverrides };
    if (to == null) delete next[input.field]; else next[input.field] = to;
    await ctx.tx.update(offers)
      .set({ fieldOverrides: next, verifiedBy: null, verifiedAt: null, updatedAt: ctx.now })
      .where(eq(offers.id, input.offerId));
  }

  await ctx.tx.insert(offerLetterEdits).values({
    offerId: input.offerId,
    field: input.field,
    fromValue: from,
    toValue: to,
    byId: ctx.viewer.staffId ?? null,
    byName: ctx.viewer.name,
    at: ctx.now,
  });

  await audit(ctx, {
    action: 'update',
    summary: `corrected ${input.field} on the offer letter for ${x.candidateName}`,
    entityType: 'offer', entityId: input.offerId, entityLabel: x.candidateName,
    before: { [input.field]: from }, after: { [input.field]: to },
  }, ctx.tx);

  return { candidateName: x.candidateName, field: input.field };
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

export type SendResult = {
  candidateName: string;
  reference: string;
  /** True when an e-signature envelope was created rather than a plain letter. */
  envelope: boolean;
  note: string | null;
};

export async function sendOffer(
  offerId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<SendResult> {
  const x = await letterContext(offerId, ctx.tx);
  const o = x.offer;
  if (isSent(o.state)) throw new CommandError('That offer has already gone out', { tone: 'warn' });

  const [verifier] = o.verifiedBy
    ? await ctx.tx.select({ name: staff.name }).from(staff).where(eq(staff.id, o.verifiedBy)).limit(1)
    : [];
  const letter = offerLetter(x.letter);
  const { checks, ready } = sendReadiness(o.state, letter, o.verifiedAt ? (verifier?.name ?? 'Onboarding') : null);
  if (!ready) {
    const why = checks.find((c) => !c.ok)!;
    throw new CommandError(
      `Cannot send yet — ${why.t.charAt(0).toLowerCase()}${why.t.slice(1)}`,
      { code: 'not_ready' },
    );
  }

  /* The four documents the envelope collects before the signature page. */
  for (const [n, [key, label]] of OFFER_DOCS.entries()) {
    await ctx.tx.insert(offerDocuments)
      .values({ offerId, key, label, status: 'missing', sortOrder: n })
      .onConflictDoNothing();
  }

  const esign = providers().esign;
  await ctx.tx.update(offers).set({
    state: 'sent',
    sentAt: ctx.now,
    sentBy: ctx.viewer.staffId ?? null,
    expiresAt: new Date(ctx.now.getTime() + 14 * 86_400_000),
    esignProvider: esign.configured ? esign.provider : null,
    esignStatus: esign.configured ? 'pending' : null,
    updatedAt: ctx.now,
  }).where(eq(offers.id, offerId));

  await ctx.tx.update(offerSignatures)
    .set({ state: 'sent', sentAt: ctx.now })
    .where(eq(offerSignatures.offerId, offerId));

  const link = await mintLink({
    purpose: 'offer',
    subjectType: 'offer',
    subjectId: offerId,
    candidateId: o.candidateId,
    applicationId: o.applicationId,
    replace: true,
  }, ctx);

  const first = x.candidateName.split(/\s+/)[0];
  const queued = await queueMessage({
    channel: 'Email',
    applicationId: o.applicationId,
    candidateId: o.candidateId,
    jobId: o.jobId,
    toName: x.candidateName,
    toAddress: x.letter.candidate.email,
    subject: `Your offer from Bayut KSA — ${x.letter.job.title}`,
    body: `Dear ${first},\n\nYour offer is attached and waiting for you here: ${link.url}\n\n`
      + 'Please upload the four documents the page asks for, then sign. '
      + 'The offer is open for fourteen days.\n\nTalent Acquisition — Bayut KSA',
    thread: { subjectType: 'application', subjectId: o.applicationId, title: x.letter.job.title },
  }, ctx);

  await audit(ctx, {
    action: 'action',
    summary: esign.configured
      ? `sent ${o.reference} to ${x.candidateName} for e-signature`
      : `sent ${o.reference} to ${x.candidateName}`,
    entityType: 'offer', entityId: offerId, entityLabel: x.candidateName,
    before: { state: o.state }, after: { state: 'sent', esign: esign.configured ? esign.provider : null },
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.sent', subjectType: 'offer', subjectId: offerId,
    payload: { applicationId: o.applicationId, baseMonthly: o.baseMonthly },
  }, ctx.tx);

  return {
    candidateName: x.candidateName,
    reference: o.reference,
    envelope: esign.configured,
    note: esign.configured
      ? queued.reason
      : 'No e-signature provider is configured — the signed copy is recorded by hand when it comes back',
  };
}

/* ── The envelope ────────────────────────────────────────────────────────── */

export async function recordDocument(
  input: { offerId: string; key: string; fileId?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ label: string; left: number }> {
  const [doc] = await ctx.tx.select().from(offerDocuments)
    .where(and(eq(offerDocuments.offerId, input.offerId), eq(offerDocuments.key, input.key)))
    .limit(1);
  if (!doc) throw new CommandError('That document is not on this envelope');

  await ctx.tx.update(offerDocuments).set({
    status: 'uploaded',
    fileId: input.fileId ?? null,
    uploadedAt: ctx.now,
    uploadedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
  }).where(eq(offerDocuments.id, doc.id));

  const left = (await ctx.tx.select().from(offerDocuments)
    .where(and(eq(offerDocuments.offerId, input.offerId), eq(offerDocuments.status, 'missing')))).length;

  await audit(ctx, {
    action: 'update',
    summary: `${doc.label} received on the offer envelope`,
    entityType: 'offer', entityId: input.offerId,
    after: { document: input.key, status: 'uploaded' },
  }, ctx.tx);

  return { label: doc.label, left };
}

/** What is still missing before anybody can sign. */
export async function missingDocuments(
  offerId: string, exec: Exec,
): Promise<Array<{ key: string; label: string }>> {
  return (await exec.select({ key: offerDocuments.key, label: offerDocuments.label })
    .from(offerDocuments)
    .where(and(eq(offerDocuments.offerId, offerId), eq(offerDocuments.status, 'missing')))
    .orderBy(asc(offerDocuments.sortOrder)));
}

export async function markViewed(
  offerId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
  if (!o || o.state !== 'sent') return;
  await ctx.tx.update(offers)
    .set({ state: 'viewed', viewedAt: o.viewedAt ?? ctx.now, updatedAt: ctx.now })
    .where(eq(offers.id, offerId));
  await ctx.tx.update(offerSignatures)
    .set({ state: 'viewed', viewedAt: ctx.now })
    .where(and(eq(offerSignatures.offerId, offerId), eq(offerSignatures.state, 'sent')));
  await emit(ctx, {
    type: 'offer.viewed', subjectType: 'offer', subjectId: offerId,
    payload: { applicationId: o.applicationId },
  }, ctx.tx);
}

export type SignResult = { candidateName: string; reference: string };

/**
 * The signature. It arrives from the e-signature provider's webhook, or is
 * recorded by a person when a signed copy comes back by e-mail — the second is
 * the only route when no provider is configured, and the record says which.
 */
export async function recordSignature(
  input: { offerId: string; source: 'provider' | 'manual'; ip?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<SignResult> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, input.offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (!['sent', 'viewed'].includes(o.state)) {
    throw new CommandError(
      o.state === 'signed' || o.state === 'accepted'
        ? 'That offer is already signed'
        : 'That offer is not out for signature',
      { tone: 'warn' },
    );
  }

  const missing = await missingDocuments(input.offerId, ctx.tx);
  if (missing.length) {
    throw new CommandError(
      `Cannot sign yet — ${missing.length === 1
        ? `${missing[0].label} is`
        : `${missing.length} documents are`} still missing on the envelope`,
      { code: 'documents' },
    );
  }

  await ctx.tx.update(offers).set({
    state: 'signed',
    signedAt: ctx.now,
    esignStatus: input.source === 'provider' ? 'completed' : null,
    updatedAt: ctx.now,
  }).where(eq(offers.id, input.offerId));
  await ctx.tx.update(offerSignatures)
    .set({ state: 'signed', signedAt: ctx.now, ipAddress: input.ip ?? null })
    .where(eq(offerSignatures.offerId, input.offerId));

  await revokeLinks({ purpose: 'offer', subjectType: 'offer', subjectId: input.offerId }, ctx);

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);

  await audit(ctx, {
    action: 'action',
    summary: `${cand?.name ?? 'the candidate'} signed ${o.reference}`,
    entityType: 'offer', entityId: input.offerId, entityLabel: cand?.name ?? null,
    before: { state: o.state }, after: { state: 'signed', source: input.source },
    source: input.source === 'provider' ? 'webhook' : 'ui',
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.signed', subjectType: 'offer', subjectId: input.offerId,
    payload: { applicationId: o.applicationId },
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate', reference: o.reference };
}

/* ── The answer ──────────────────────────────────────────────────────────── */

export const DECLINE_REASONS = [
  'Counter-offer from their employer',
  'Another offer — better package',
  'Another offer — better role',
  'Package below expectation',
  'Location or commute',
  'Start date could not be agreed',
  'Personal circumstances',
  'No reason given',
] as const;

export type AcceptResult = {
  candidateName: string;
  employeeCode: string;
  startDate: string;
  jobTitle: string;
};

/**
 * Record the acceptance. This is the moment the requisition fills a seat and
 * the candidate becomes an employee, so it happens once and in one transaction:
 * the application is hired, the offer is accepted, the employee record is
 * created with its number, and the probation clock starts.
 */
export async function acceptOffer(
  input: { offerId: string; source?: string; note?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<AcceptResult> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, input.offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (o.state === 'accepted') throw new CommandError('That offer is already accepted', { tone: 'warn' });
  if (['declined', 'withdrawn', 'expired'].includes(o.state)) {
    throw new CommandError('That offer is closed', { tone: 'warn' });
  }
  if (!isSent(o.state)) {
    throw new CommandError('That offer has not been sent yet');
  }

  const missing = await missingDocuments(input.offerId, ctx.tx);
  if (missing.length) {
    throw new CommandError(
      `Cannot record acceptance — ${missing.length === 1
        ? `${missing[0].label} has`
        : `${missing.length} documents have`} not been uploaded`,
      { code: 'documents' },
    );
  }

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);
  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, o.jobId)).limit(1);

  const signed = (await ctx.tx.select().from(offerSignatures)
    .where(and(eq(offerSignatures.offerId, o.id), eq(offerSignatures.state, 'signed')))).length > 0;

  await ctx.tx.update(offers).set({
    state: 'accepted',
    responseState: 'accepted',
    responseAt: ctx.now,
    responseBy: ctx.viewer.staffId ?? null,
    responseNote: input.note?.trim() || null,
    responseSource: input.source ?? (signed ? 'e-signature' : 'call'),
    updatedAt: ctx.now,
  }).where(eq(offers.id, input.offerId));

  /* The start date comes off the offer rather than from a default, and it has
     to be on the application before the hire so the transition machine keeps it. */
  await ctx.tx.update(applications)
    .set({ startDate: o.startDate })
    .where(eq(applications.id, o.applicationId));

  /* Hire the application through the transition machine, so the stage history,
     the closed date and the requisition's filled count all follow the same
     path a drag onto Joined would take. */
  await moveStage({
    applicationId: o.applicationId,
    toStage: 'joined',
    source: 'offer',
    bypassGate: true,
  }, ctx);

  const { employee, created } = await ensureEmployee(input.offerId, ctx);

  await revokeLinks({ purpose: 'offer', subjectType: 'offer', subjectId: input.offerId }, ctx);

  await audit(ctx, {
    action: 'action',
    summary: `${cand?.name ?? 'the candidate'} accepted ${o.reference} — joining ${o.startDate} as ${employee.employeeCode}`,
    entityType: 'offer', entityId: input.offerId, entityLabel: cand?.name ?? null,
    before: { state: o.state }, after: { state: 'accepted', employeeCode: employee.employeeCode },
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.accepted', subjectType: 'offer', subjectId: input.offerId,
    payload: {
      applicationId: o.applicationId, employeeId: employee.id,
      employeeCode: employee.employeeCode, startDate: o.startDate, newEmployee: created,
    },
  }, ctx.tx);

  return {
    candidateName: cand?.name ?? 'the candidate',
    employeeCode: employee.employeeCode,
    startDate: o.startDate,
    jobTitle: job?.title ?? '',
  };
}

export async function declineOffer(
  input: { offerId: string; reason: string; note?: string | null; source?: string },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ candidateName: string; reason: string }> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, input.offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (['accepted', 'declined', 'withdrawn'].includes(o.state)) {
    throw new CommandError('That offer already has an answer', { tone: 'warn' });
  }
  if (!input.reason?.trim()) {
    throw new CommandError('The reason is what makes this useful later — pick one');
  }

  await ctx.tx.update(offers).set({
    state: 'declined',
    responseState: 'declined',
    responseAt: ctx.now,
    responseBy: ctx.viewer.staffId ?? null,
    responseReason: input.reason,
    responseNote: input.note?.trim() || null,
    responseSource: input.source ?? 'call',
    updatedAt: ctx.now,
  }).where(eq(offers.id, input.offerId));

  await revokeLinks({ purpose: 'offer', subjectType: 'offer', subjectId: input.offerId }, ctx);

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);

  await audit(ctx, {
    action: 'action',
    summary: `${cand?.name ?? 'the candidate'} declined ${o.reference} — ${input.reason}`,
    entityType: 'offer', entityId: input.offerId, entityLabel: cand?.name ?? null,
    before: { state: o.state }, after: { state: 'declined' },
    reason: input.note?.trim() || input.reason,
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.declined', subjectType: 'offer', subjectId: input.offerId,
    payload: { applicationId: o.applicationId, reason: input.reason },
  }, ctx.tx);

  return { candidateName: cand?.name ?? 'the candidate', reason: input.reason };
}

/** Revise a sent offer. The old one stays exactly as it was sent. */
export async function reviseOffer(
  input: { offerId: string; terms?: Partial<Terms> },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ offerId: string; reference: string; version: number; candidateName: string }> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, input.offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');
  if (o.state === 'accepted') {
    throw new CommandError('That offer has been accepted — it cannot be revised', { tone: 'warn' });
  }

  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);
  const [{ reference }] = rowsOf(await ctx.tx.execute(sql`
    SELECT next_reference('OFF', 4) AS reference`)) as Array<{ reference: string }>;

  const offerId = `off_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(offers).values({
    id: offerId,
    reference,
    applicationId: o.applicationId,
    jobId: o.jobId,
    candidateId: o.candidateId,
    version: o.version + 1,
    supersedesId: o.id,
    baseMonthly: Math.round(input.terms?.baseMonthly ?? o.baseMonthly),
    housing: Math.round(input.terms?.housing ?? o.housing),
    transport: Math.round(input.terms?.transport ?? o.transport),
    annualBonusPct: Math.round(input.terms?.annualBonusPct ?? o.annualBonusPct),
    currency: o.currency,
    startDate: input.terms?.startDate ?? o.startDate,
    state: 'draft',
    templateId: o.templateId,
    templateName: o.templateName,
    createdAt: ctx.now,
    createdBy: ctx.viewer.staffId ?? null,
    updatedAt: ctx.now,
  });
  await ctx.tx.insert(offerSignatures).values({
    offerId, name: cand?.name ?? 'Candidate', email: cand?.email ?? null,
    role: 'Candidate', state: 'not_sent', sortOrder: 0,
  });

  /* The superseded one is withdrawn rather than left looking live. */
  if (isSent(o.state)) {
    await ctx.tx.update(offers)
      .set({ state: 'withdrawn', updatedAt: ctx.now })
      .where(eq(offers.id, o.id));
    await revokeLinks({ purpose: 'offer', subjectType: 'offer', subjectId: o.id }, ctx);
  }

  const verifier = await onboardingSpecialist(ctx.tx);
  await ctx.tx.insert(tasks).values({
    kind: 'verify_offer',
    title: `Verify offer letter v${o.version + 1} — ${cand?.name ?? 'the candidate'}`,
    applicationId: o.applicationId,
    jobId: o.jobId,
    candidateId: o.candidateId,
    offerId,
    assigneeId: verifier?.id ?? ctx.viewer.staffId ?? null,
    dueOn: new Date(ctx.now.getTime() + 2 * 86_400_000),
    priority: 'normal',
    done: false,
    createdAt: ctx.now,
    dedupeKey: `verify_offer:${offerId}`,
  }).onConflictDoNothing();

  await audit(ctx, {
    action: 'create',
    summary: `made version ${o.version + 1} of the offer for ${cand?.name ?? 'the candidate'}`,
    entityType: 'offer', entityId: offerId, entityLabel: cand?.name ?? null,
    before: { reference: o.reference, version: o.version },
    after: { reference, version: o.version + 1 },
  }, ctx.tx);
  await emit(ctx, {
    type: 'offer.revised', subjectType: 'offer', subjectId: offerId,
    payload: { applicationId: o.applicationId, supersedes: o.id, version: o.version + 1 },
  }, ctx.tx);

  return { offerId, reference, version: o.version + 1, candidateName: cand?.name ?? 'the candidate' };
}
