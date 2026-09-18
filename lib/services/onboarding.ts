import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  employees, onboardingRecords, onboardingDocuments, probationRecords,
  offers, offerDocuments, applications, jobs, candidates, orgSettings, staff, tasks,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { OFFER_DOCS } from '@/lib/services/offer-letter';
import { queueMessage } from '@/lib/services/messaging';
import { mintLink } from '@/lib/services/links';
import { notify } from '@/lib/services/notify';

/* ═════════════════════════════════════════════════════════════════════════════
   FROM SIGNATURE TO EMPLOYEE

   The signature is the moment somebody stops being a candidate. An employee
   record is created, an employee number is issued, the four documents follow
   them from the offer envelope onto their file, and the probation clock is set
   from the start date.

   Two things make this safe to call twice, which matters because the signature
   can arrive from a webhook and from a person in the same minute:

     · `employees.application_id` and `employees.offer_id` are unique, so the
       database refuses the second record rather than trusting this code;
     · the employee number comes from the reference counter, which hands out
       each number once and survives a restore.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Employee = typeof employees.$inferSelect;

export async function employeeOfApplication(
  applicationId: string, exec: Exec,
): Promise<Employee | null> {
  const [row] = await exec.select().from(employees)
    .where(eq(employees.applicationId, applicationId)).limit(1);
  return row ?? null;
}

/**
 * Make the employee record for a signed offer, or return the one that exists.
 * Idempotent on purpose.
 */
export async function ensureEmployee(
  offerId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ employee: Employee; created: boolean }> {
  const [o] = await ctx.tx.select().from(offers).where(eq(offers.id, offerId)).limit(1);
  if (!o) throw new CommandError('That offer no longer exists');

  const [existing] = await ctx.tx.select().from(employees)
    .where(eq(employees.offerId, offerId)).limit(1);
  if (existing) return { employee: existing, created: false };

  const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, o.jobId)).limit(1);
  const [cand] = await ctx.tx.select().from(candidates)
    .where(eq(candidates.id, o.candidateId)).limit(1);
  if (!job || !cand) throw new CommandError('That requisition or candidate no longer exists');

  const [{ code }] = rowsOf(await ctx.tx.execute(sql`
    SELECT next_reference('BYT', 4) AS code`)) as Array<{ code: string }>;

  const employeeId = `emp_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(employees).values({
    id: employeeId,
    employeeCode: code,
    name: cand.name,
    gender: cand.gender,
    candidateId: cand.id,
    applicationId: o.applicationId,
    offerId: o.id,
    jobId: o.jobId,
    positionCode: job.positionCode,
    deptId: job.deptId,
    title: job.title,
    locationId: job.locationId,
    startDate: o.startDate,
    status: 'onboarding',
    source: 'hire',
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  await ctx.tx.insert(onboardingRecords).values({
    employeeId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }).onConflictDoNothing();

  /* The four documents follow them from the envelope. One already uploaded on
     the offer arrives uploaded here; it still has to be verified by a person. */
  const fromEnvelope = await ctx.tx.select().from(offerDocuments)
    .where(eq(offerDocuments.offerId, offerId));
  for (const [n, [key, label]] of OFFER_DOCS.entries()) {
    const had = fromEnvelope.find((d) => d.key === key);
    await ctx.tx.insert(onboardingDocuments).values({
      employeeId,
      key,
      label,
      status: had?.status === 'uploaded' || had?.status === 'verified' ? 'uploaded' : 'missing',
      fileId: had?.fileId ?? null,
      uploadedAt: had?.uploadedAt ?? null,
      uploadedBy: had?.uploadedBy ?? null,
      sortOrder: n,
    }).onConflictDoNothing();
  }

  /* Probation runs from the start date, for however long the organisation says. */
  const [org] = await ctx.tx.select({ months: orgSettings.probationMonths }).from(orgSettings).limit(1);
  const months = org?.months ?? 3;
  const starts = new Date(`${o.startDate}T00:00:00Z`);
  const ends = new Date(starts);
  ends.setUTCMonth(ends.getUTCMonth() + months);
  await ctx.tx.insert(probationRecords).values({
    employeeId,
    months,
    startsOn: o.startDate,
    endsOn: ends.toISOString().slice(0, 10),
    state: 'in_progress',
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }).onConflictDoNothing();

  /* Three things are owed from here, and each is somebody's job rather than a
     note in a comment: the references, the joining date, and the documents. */
  const recruiterId = job.recruiterId ?? ctx.viewer.staffId ?? null;
  const [onb] = await ctx.tx.select({ id: staff.id, name: staff.name }).from(staff)
    .where(and(eq(staff.role, 'onboarding'), eq(staff.status, 'active')))
    .orderBy(asc(staff.id)).limit(1);
  const startAt = new Date(`${o.startDate}T00:00:00Z`);

  await ctx.tx.insert(tasks).values([
    {
      kind: 'reference',
      title: `Reference check — ${cand.name} (${code})`,
      applicationId: o.applicationId, jobId: o.jobId, candidateId: cand.id, employeeId,
      assigneeId: recruiterId,
      dueOn: new Date(Math.max(ctx.now.getTime() + 3 * 86_400_000, startAt.getTime() - 7 * 86_400_000)),
      priority: 'normal', done: false, createdAt: ctx.now,
      dedupeKey: `reference:${employeeId}`,
    },
    {
      kind: 'joining',
      title: `Confirm the joining date and notify the back office — ${cand.name}`,
      applicationId: o.applicationId, jobId: o.jobId, candidateId: cand.id, employeeId,
      assigneeId: recruiterId,
      dueOn: new Date(ctx.now.getTime() + 2 * 86_400_000),
      priority: 'high', done: false, createdAt: ctx.now,
      dedupeKey: `joining:${employeeId}`,
    },
    {
      kind: 'onboarding',
      title: `Verify onboarding documents — ${cand.name} (${code})`,
      applicationId: o.applicationId, jobId: o.jobId, candidateId: cand.id, employeeId,
      assigneeId: onb?.id ?? recruiterId,
      dueOn: startAt,
      priority: 'normal', done: false, createdAt: ctx.now,
      dedupeKey: `onboarding:${employeeId}`,
    },
  ]).onConflictDoNothing();

  /* The joiner's own form. The link is a credential like every other. */
  const form = await mintLink({
    purpose: 'reference',
    subjectType: 'employee',
    subjectId: employeeId,
    candidateId: cand.id,
    applicationId: o.applicationId,
    days: 60,
    replace: true,
  }, ctx);
  await ctx.tx.update(onboardingRecords)
    .set({ formSentAt: ctx.now, updatedAt: ctx.now })
    .where(eq(onboardingRecords.employeeId, employeeId));

  await queueMessage({
    channel: 'Email',
    applicationId: o.applicationId,
    candidateId: cand.id,
    jobId: o.jobId,
    employeeId,
    toName: cand.name,
    toAddress: cand.email,
    subject: `Welcome to Bayut KSA — your onboarding form (${code})`,
    body: `Hi ${cand.name.split(/\s+/)[0]}, congratulations on signing. Your employee number is `
      + `${code}. Before ${o.startDate} please complete your details here: ${form.url} — we already `
      + 'have the documents you attached to the offer.',
    authorId: null,
    thread: { subjectType: 'application', subjectId: o.applicationId, title: job.title },
  }, ctx);

  await notify({
    kind: 'joiner',
    text: `${cand.name} accepted the offer — ${job.title}. Employee number ${code} issued; `
      + `the joining date (${o.startDate}) is still to be confirmed with the back office.`,
    applicationId: o.applicationId,
    jobId: o.jobId,
    candidateId: cand.id,
    employeeId,
    dedupeKey: `joiner.accepted:${employeeId}`,
  }, ctx);

  await audit(ctx, {
    action: 'create',
    summary: `created ${cand.name}'s employee record — ${code}, starting ${o.startDate}`,
    entityType: 'employee', entityId: employeeId, entityLabel: cand.name,
    after: { employeeCode: code, startDate: o.startDate, title: job.title },
  }, ctx.tx);
  await emit(ctx, {
    type: 'employee.created', subjectType: 'employee', subjectId: employeeId,
    payload: {
      applicationId: o.applicationId, offerId: o.id, employeeCode: code, startDate: o.startDate,
    },
  }, ctx.tx);

  const [made] = await ctx.tx.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  return { employee: made, created: true };
}

/** What is still outstanding on a joiner's file. */
export async function outstandingDocuments(
  employeeId: string, exec: Exec,
): Promise<Array<{ key: string; label: string; status: string }>> {
  return (await exec.select({
    key: onboardingDocuments.key,
    label: onboardingDocuments.label,
    status: onboardingDocuments.status,
  }).from(onboardingDocuments)
    .where(and(
      eq(onboardingDocuments.employeeId, employeeId),
      sql`${onboardingDocuments.status} <> 'verified'`,
    ))
    .orderBy(asc(onboardingDocuments.sortOrder))) as Array<{ key: string; label: string; status: string }>;
}
