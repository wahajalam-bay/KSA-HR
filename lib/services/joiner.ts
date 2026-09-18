import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  employees, onboardingRecords, onboardingDocuments, probationRecords, references,
  joiningNotices, notifiedTeams, notifiedTeamContacts,
  offers, applications, jobs, tasks, orgSettings,
} from '@/db/schema';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { queueMessage } from '@/lib/services/messaging';
import { notify } from '@/lib/services/notify';
import { outstandingDocuments } from '@/lib/services/onboarding';
import { providers } from '@/lib/env';
import { fmt } from '@/lib/format';

/* ═════════════════════════════════════════════════════════════════════════════
   THE JOINER'S FILE

   Four things have to be true before somebody's first day, and each is a
   different person's job:

     · they have filled in their own details;
     · their four documents are on file and a person has checked each one;
     · their referees have been spoken to and rated;
     · the joining date is fixed and the back office has been told.

   When all four hold, onboarding is complete. Nothing here marks it complete on
   anybody's say-so: `settle` reads the record and decides.
   ═════════════════════════════════════════════════════════════════════════════*/

export const RATINGS: Record<string, { label: string; text: string }> = {
  up: { label: 'Thumbs up', text: 'Positive' },
  down: { label: 'Thumbs down', text: 'Concern' },
  star: { label: 'Star', text: 'Outstanding' },
};

export type Progress = {
  verified: number;
  uploaded: number;
  total: number;
  form: boolean;
  references: { n: number; done: number; ok: boolean; outcome: string | null };
  noticeSent: boolean;
  complete: boolean;
};

export async function progress(employeeId: string, exec: Exec): Promise<Progress> {
  const docs = await exec.select().from(onboardingDocuments)
    .where(eq(onboardingDocuments.employeeId, employeeId));
  const refs = await exec.select().from(references)
    .where(eq(references.employeeId, employeeId));
  const [rec] = await exec.select().from(onboardingRecords)
    .where(eq(onboardingRecords.employeeId, employeeId)).limit(1);
  const [emp] = await exec.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  const [notice] = await exec.select({ id: joiningNotices.id }).from(joiningNotices)
    .where(and(eq(joiningNotices.employeeId, employeeId), eq(joiningNotices.kind, 'joining')))
    .limit(1);

  const done = refs.filter((r) => r.status === 'done');
  /* A concern outweighs everything; a star lifts the rest. */
  const outcome = !done.length ? null
    : done.some((r) => r.rating === 'down') ? 'down'
      : done.some((r) => r.rating === 'star') ? 'star' : 'up';
  const needed = emp?.source === 'hire';
  const refsOk = !needed || (refs.length > 0 && refs.every((r) => r.status === 'done'));

  const verified = docs.filter((d) => d.status === 'verified').length;
  const form = !!rec?.formSubmittedAt;
  return {
    verified,
    uploaded: docs.filter((d) => d.status !== 'missing').length,
    total: docs.length,
    form,
    references: { n: refs.length, done: done.length, ok: refsOk, outcome },
    noticeSent: !!notice,
    complete: form && docs.length > 0 && verified === docs.length && refsOk,
  };
}

/** Mark the file complete when — and only when — everything on it is. */
export async function settle(
  employeeId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<boolean> {
  const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  const [rec] = await ctx.tx.select().from(onboardingRecords)
    .where(eq(onboardingRecords.employeeId, employeeId)).limit(1);
  if (!emp || rec?.completedAt) return false;

  const p = await progress(employeeId, ctx.tx);
  if (!p.complete) return false;

  const started = new Date(`${emp.startDate}T00:00:00Z`).getTime() <= ctx.now.getTime();
  await ctx.tx.update(onboardingRecords)
    .set({ completedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(onboardingRecords.employeeId, employeeId));
  await ctx.tx.update(employees)
    .set({ status: started ? 'active' : 'onboarding', updatedAt: ctx.now })
    .where(eq(employees.id, employeeId));
  await ctx.tx.update(tasks)
    .set({ done: true, doneAt: ctx.now, doneBy: ctx.viewer.staffId ?? null })
    .where(and(
      eq(tasks.employeeId, employeeId),
      eq(tasks.done, false),
      sql`${tasks.kind} IN ('onboarding','reference')`,
    ));

  await audit(ctx, {
    action: 'action',
    summary: `${emp.name}'s onboarding is complete — ${emp.employeeCode} is ready for day one`,
    entityType: 'employee', entityId: employeeId, entityLabel: emp.name,
    after: { completed: true },
  }, ctx.tx);
  await emit(ctx, {
    type: 'onboarding.completed', subjectType: 'employee', subjectId: employeeId,
    payload: { employeeCode: emp.employeeCode, startDate: emp.startDate },
  }, ctx.tx);
  return true;
}

/* ── The joiner's own details ────────────────────────────────────────────── */

export type FormInput = {
  nationalId?: string | null;
  nationality?: string | null;
  dob?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  bank?: string | null;
  iban?: string | null;
};

const IBAN_SA = /^SA\d{22}$/i;

export async function saveForm(
  input: { employeeId: string } & FormInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; submitted: boolean }> {
  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, input.employeeId)).limit(1);
  if (!emp) throw new CommandError('That joiner no longer exists');

  const iban = input.iban?.replace(/\s+/g, '') || null;
  if (iban && !IBAN_SA.test(iban)) {
    throw new CommandError('A Saudi IBAN is SA followed by twenty-two digits');
  }

  const complete = !!(input.nationalId && input.nationality && input.dob && iban);
  const [rec] = await ctx.tx.select().from(onboardingRecords)
    .where(eq(onboardingRecords.employeeId, input.employeeId)).limit(1);
  const submittedAt = complete ? (rec?.formSubmittedAt ?? ctx.now) : null;

  const values = {
    nationalId: input.nationalId ?? null,
    nationality: input.nationality ?? null,
    dob: input.dob ?? null,
    address: input.address ?? null,
    emergencyContact: input.emergencyContact ?? null,
    bank: input.bank ?? null,
    iban,
    formSubmittedAt: submittedAt,
    updatedAt: ctx.now,
  };
  await ctx.tx.insert(onboardingRecords)
    .values({ employeeId: input.employeeId, ...values, createdAt: ctx.now })
    .onConflictDoUpdate({ target: onboardingRecords.employeeId, set: values });

  /* The trail records that the form was filled, never what was in it: the
     national ID, the date of birth and the IBAN are redacted by lib/audit. */
  await audit(ctx, {
    action: 'update',
    summary: complete
      ? `${emp.name} completed their onboarding form`
      : `saved part of ${emp.name}'s onboarding form`,
    entityType: 'employee', entityId: input.employeeId, entityLabel: emp.name,
    after: { formComplete: complete },
  }, ctx.tx);

  if (complete) await settle(input.employeeId, ctx);
  return { name: emp.name, submitted: complete };
}

/* ── Documents ───────────────────────────────────────────────────────────── */

export async function recordJoinerDocument(
  input: { employeeId: string; key: string; fileId?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ label: string; left: number }> {
  const [doc] = await ctx.tx.select().from(onboardingDocuments)
    .where(and(
      eq(onboardingDocuments.employeeId, input.employeeId),
      eq(onboardingDocuments.key, input.key),
    )).limit(1);
  if (!doc) throw new CommandError('That document is not on this file');

  await ctx.tx.update(onboardingDocuments).set({
    status: 'uploaded',
    fileId: input.fileId ?? null,
    uploadedAt: ctx.now,
    uploadedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
    verifiedAt: null,
    verifiedBy: null,
    rejectedReason: null,
  }).where(eq(onboardingDocuments.id, doc.id));

  const left = (await outstandingDocuments(input.employeeId, ctx.tx)).length;
  await audit(ctx, {
    action: 'update',
    summary: `${doc.label} received on the joiner file`,
    entityType: 'employee', entityId: input.employeeId,
    after: { document: input.key, status: 'uploaded' },
  }, ctx.tx);
  await emit(ctx, {
    type: 'onboarding.document_uploaded', subjectType: 'employee', subjectId: input.employeeId,
    payload: { key: input.key },
  }, ctx.tx);

  return { label: doc.label, left };
}

/** A person looks at the document and says whether it is what it claims to be. */
export async function verifyDocument(
  input: { employeeId: string; key: string; accept: boolean; reason?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ label: string; left: number; completed: boolean }> {
  const [doc] = await ctx.tx.select().from(onboardingDocuments)
    .where(and(
      eq(onboardingDocuments.employeeId, input.employeeId),
      eq(onboardingDocuments.key, input.key),
    )).limit(1);
  if (!doc) throw new CommandError('That document is not on this file');
  if (doc.status === 'missing') {
    throw new CommandError(`${doc.label} has not been uploaded yet`, { tone: 'warn' });
  }
  if (!input.accept && !input.reason?.trim()) {
    throw new CommandError('Say what is wrong with it, so the joiner can send the right one');
  }

  await ctx.tx.update(onboardingDocuments).set({
    status: input.accept ? 'verified' : 'rejected',
    verifiedAt: input.accept ? ctx.now : null,
    verifiedBy: ctx.viewer.staffId ?? null,
    rejectedReason: input.accept ? null : (input.reason?.trim() ?? null),
  }).where(eq(onboardingDocuments.id, doc.id));

  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, input.employeeId)).limit(1);

  await audit(ctx, {
    action: 'action',
    summary: input.accept
      ? `verified ${doc.label} for ${emp?.name ?? 'the joiner'}`
      : `rejected ${doc.label} for ${emp?.name ?? 'the joiner'} — ${input.reason}`,
    entityType: 'employee', entityId: input.employeeId, entityLabel: emp?.name ?? null,
    before: { [input.key]: doc.status },
    after: { [input.key]: input.accept ? 'verified' : 'rejected' },
    reason: input.reason?.trim() ?? null,
  }, ctx.tx);
  if (input.accept) {
    await emit(ctx, {
      type: 'onboarding.document_verified', subjectType: 'employee', subjectId: input.employeeId,
      payload: { key: input.key },
    }, ctx.tx);
  }

  const completed = input.accept ? await settle(input.employeeId, ctx) : false;
  const left = (await outstandingDocuments(input.employeeId, ctx.tx)).length;
  return { label: doc.label, left, completed };
}

/* ── References ──────────────────────────────────────────────────────────── */

export async function addReference(
  input: {
    employeeId: string; name: string; title?: string | null; company?: string | null;
    relationship?: string | null; contact?: string | null;
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ id: string; name: string }> {
  if (!input.name?.trim()) throw new CommandError('The referee needs a name');
  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, input.employeeId)).limit(1);
  if (!emp) throw new CommandError('That joiner no longer exists');

  const id = `ref_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(references).values({
    id,
    employeeId: input.employeeId,
    name: input.name.trim(),
    title: input.title ?? null,
    company: input.company ?? null,
    relationship: input.relationship ?? null,
    contact: input.contact ?? null,
    status: 'pending',
    createdAt: ctx.now,
  });

  await audit(ctx, {
    action: 'create',
    summary: `added ${input.name.trim()} as a referee for ${emp.name}`,
    entityType: 'employee', entityId: input.employeeId, entityLabel: emp.name,
    after: { referee: input.name.trim(), company: input.company ?? null },
  }, ctx.tx);

  return { id, name: input.name.trim() };
}

export async function recordReference(
  input: {
    referenceId: string; status: 'pending' | 'contacted' | 'done' | 'declined';
    rating?: string | null; notes?: string | null;
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; rating: string | null; completed: boolean }> {
  const [ref] = await ctx.tx.select().from(references)
    .where(eq(references.id, input.referenceId)).limit(1);
  if (!ref) throw new CommandError('That referee is no longer on the file');

  const done = input.status === 'done';
  if (done && !input.rating) {
    throw new CommandError('Rate the reference — thumbs up, thumbs down or a star');
  }
  if (input.rating && !RATINGS[input.rating]) throw new CommandError('That is not one of the ratings');

  await ctx.tx.update(references).set({
    status: input.status,
    rating: done ? input.rating! : null,
    notes: input.notes?.trim() ?? ref.notes,
    contactedAt: input.status === 'contacted' ? (ref.contactedAt ?? ctx.now) : ref.contactedAt,
    answeredAt: done ? (ref.answeredAt ?? ctx.now) : null,
    recordedBy: done ? (ctx.viewer.staffId ?? null) : ref.recordedBy,
  }).where(eq(references.id, input.referenceId));

  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, ref.employeeId)).limit(1);

  if (done) {
    await audit(ctx, {
      action: 'action',
      summary: `recorded a reference for ${emp?.name ?? 'the joiner'} — `
        + `${RATINGS[input.rating!].label.toLowerCase()} from ${ref.name}`,
      entityType: 'employee', entityId: ref.employeeId, entityLabel: emp?.name ?? null,
      after: { referee: ref.name, rating: input.rating },
    }, ctx.tx);
    await emit(ctx, {
      type: 'reference.recorded', subjectType: 'employee', subjectId: ref.employeeId,
      payload: { referenceId: ref.id, rating: input.rating },
    }, ctx.tx);
  }

  const p = await progress(ref.employeeId, ctx.tx);
  if (p.references.ok) {
    await ctx.tx.update(tasks)
      .set({ done: true, doneAt: ctx.now, doneBy: ctx.viewer.staffId ?? null })
      .where(and(
        eq(tasks.employeeId, ref.employeeId),
        eq(tasks.kind, 'reference'),
        eq(tasks.done, false),
      ));
  }
  const completed = done ? await settle(ref.employeeId, ctx) : false;
  return { name: ref.name, rating: done ? input.rating! : null, completed };
}

/* ── The joining date, and telling the back office ───────────────────────── */

const monthsAfter = (day: string, months: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

const teamFilter = (keys: string[] | undefined, column: 'onJoining' | 'onFile') => (
  keys?.length
    ? sql`${notifiedTeams.key} = ANY(ARRAY[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[])`
    : eq(notifiedTeams[column], true)
);

export type NoticeResult = {
  name: string;
  startDate: string;
  teams: string[];
  people: number;
  notConfigured: string | null;
};

/**
 * Fixing the joining date is one action with four consequences: the date moves
 * onto the joiner, the offer, the application and the probation clock together,
 * and the back-office teams are told. Doing it in one transaction is what stops
 * IT setting up a laptop for a day the candidate never agreed to.
 */
export async function sendJoiningNotice(
  input: { employeeId: string; startDate?: string | null; teamKeys?: string[] },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<NoticeResult> {
  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, input.employeeId)).limit(1);
  if (!emp) throw new CommandError('That joiner no longer exists');

  const date = input.startDate?.trim() || emp.startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CommandError('Pick the joining date first');

  const teams = await ctx.tx.select().from(notifiedTeams)
    .where(and(sql`${notifiedTeams.archivedAt} IS NULL`, teamFilter(input.teamKeys, 'onJoining')))
    .orderBy(asc(notifiedTeams.sortOrder));
  if (!teams.length) throw new CommandError('Tick at least one team to notify');

  const [org] = await ctx.tx.select({ months: orgSettings.probationMonths })
    .from(orgSettings).limit(1);

  /* The joiner's record, the application and the probation clock move together.
     The offer does not: the letter the candidate signed says what it says, and
     the database refuses to rewrite it (see 0001_integrity.sql). A date agreed
     afterwards is an operational fact about the joiner, not a correction to a
     document they already hold — if the offer itself has to change, that is a
     new version, which is a different action with its own approvals. */
  await ctx.tx.update(employees)
    .set({ startDate: date, updatedAt: ctx.now })
    .where(eq(employees.id, emp.id));
  if (emp.applicationId) {
    await ctx.tx.update(applications).set({ startDate: date })
      .where(eq(applications.id, emp.applicationId));
  }
  await ctx.tx.update(probationRecords)
    .set({
      startsOn: date,
      endsOn: monthsAfter(date, org?.months ?? 3),
      updatedAt: ctx.now,
    })
    .where(and(eq(probationRecords.employeeId, emp.id), eq(probationRecords.state, 'in_progress')));

  const [job] = emp.jobId
    ? await ctx.tx.select().from(jobs).where(eq(jobs.id, emp.jobId)).limit(1)
    : [];
  const subject = `New joiner ${date} — ${emp.name}, ${emp.title} (${emp.employeeCode})`;

  let people = 0;
  let notConfigured: string | null = null;
  for (const t of teams) {
    const contacts = await ctx.tx.select().from(notifiedTeamContacts)
      .where(eq(notifiedTeamContacts.teamId, t.id))
      .orderBy(asc(notifiedTeamContacts.sortOrder));
    const lead = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
    const cc = contacts.filter((c) => c.id !== lead?.id).map((c) => c.email);

    const q = await queueMessage({
      channel: 'Email',
      internal: true,
      applicationId: emp.applicationId,
      candidateId: emp.candidateId,
      jobId: emp.jobId,
      employeeId: emp.id,
      toName: lead?.name ?? t.name,
      toAddress: lead?.email ?? null,
      subject,
      body: `Hi ${lead?.name?.split(/\s+/)[0] ?? t.short}, ${emp.name} joins as ${emp.title} on `
        + `${date}${job ? ` (requisition ${job.reference ?? job.id})` : ''}. ${t.ask ?? ''} `
        + `Employee number ${emp.employeeCode}. — ${ctx.viewer.name}, Talent Acquisition`,
    }, ctx);
    if (q.reason) notConfigured = q.reason;

    await ctx.tx.insert(joiningNotices).values({
      employeeId: emp.id,
      kind: 'joining',
      teamKey: t.key,
      startDate: date,
      sentAt: ctx.now,
      sentBy: ctx.viewer.staffId ?? ctx.viewer.name,
      toName: lead?.name ?? t.name,
      toEmail: lead?.email ?? null,
      ccEmails: cc,
      messageId: q.messageId,
    });
    await notify({
      kind: 'notice',
      text: `${t.name} notified: ${emp.name} joins as ${emp.title} on ${date}`,
      employeeId: emp.id,
      applicationId: emp.applicationId,
    }, ctx);
    people += Math.max(1, contacts.length);
  }

  await ctx.tx.update(tasks)
    .set({ done: true, doneAt: ctx.now, doneBy: ctx.viewer.staffId ?? null })
    .where(and(eq(tasks.employeeId, emp.id), eq(tasks.kind, 'joining'), eq(tasks.done, false)));

  await audit(ctx, {
    action: 'action',
    summary: `confirmed ${emp.name}'s joining date (${date}) and notified `
      + teams.map((t) => t.short).join(', '),
    entityType: 'employee', entityId: emp.id, entityLabel: emp.name,
    before: { startDate: emp.startDate }, after: { startDate: date, teams: teams.map((t) => t.key) },
  }, ctx.tx);
  await emit(ctx, {
    type: 'joining.confirmed', subjectType: 'employee', subjectId: emp.id,
    payload: { startDate: date, teams: teams.map((t) => t.key) },
  }, ctx.tx);

  return { name: emp.name, startDate: date, teams: teams.map((t) => t.short), people, notConfigured };
}

/**
 * Chase the joiner for what is still outstanding.
 *
 * Names the specific things — the form, and each document by its label — rather
 * than asking in general, because "please complete your onboarding" is a
 * message nobody acts on. Sent on WhatsApp where that is configured, because a
 * joiner between two jobs reads WhatsApp and not their old work e-mail.
 */
export async function chaseJoiner(
  employeeId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; outstanding: string[]; sent: boolean; note: string | null }> {
  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, employeeId)).limit(1);
  if (!emp) throw new CommandError('That joiner no longer exists');

  const [rec] = await ctx.tx.select().from(onboardingRecords)
    .where(eq(onboardingRecords.employeeId, employeeId)).limit(1);
  const missing = await ctx.tx.select().from(onboardingDocuments)
    .where(and(
      eq(onboardingDocuments.employeeId, employeeId),
      sql`${onboardingDocuments.status} IN ('missing', 'rejected')`,
    ))
    .orderBy(asc(onboardingDocuments.sortOrder));

  const outstanding = [
    ...(rec?.formSubmittedAt ? [] : ['the joiner form']),
    ...missing.map((d) => (d.status === 'rejected'
      ? `${d.label} again — ${d.rejectedReason ?? 'the first one could not be read'}`
      : d.label)),
  ];
  if (!outstanding.length) {
    return { name: emp.name, outstanding, sent: false, note: null };
  }

  const first = emp.name.split(/\s+/)[0];
  const body = `Hi ${first}, a reminder from Bayut onboarding: we still need `
    + `${fmt.list(outstanding)} before you start on ${emp.startDate}. `
    + 'Reply here if anything is difficult to get hold of and we will work around it.';

  /* WhatsApp first: a joiner between two jobs reads it and not their old work
     address. E-mail is the fallback, and either way the outbox says whether it
     actually went. */
  const wa = providers().whatsapp;
  const q = await queueMessage({
    channel: wa.configured ? 'WhatsApp' : 'Email',
    body,
    toName: emp.name,
    toAddress: wa.configured ? null : null,
    applicationId: emp.applicationId,
    candidateId: emp.candidateId,
    jobId: emp.jobId,
    employeeId: emp.id,
    thread: { subjectType: 'employee', subjectId: emp.id, title: `${emp.name} — onboarding` },
  }, ctx);

  await audit(ctx, {
    action: 'action',
    summary: `chased ${emp.name} for ${fmt.list(outstanding)}`,
    entityType: 'employee', entityId: emp.id, entityLabel: emp.name,
    after: { outstanding, status: q.status },
  }, ctx.tx);

  return {
    name: emp.name,
    outstanding,
    sent: q.status === 'queued',
    note: q.reason,
  };
}

/** The pack IT and HR Operations act on. */
export async function sendJoinerFile(
  input: { employeeId: string; teamKeys?: string[] },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; teams: string[]; documents: number; notConfigured: string | null }> {
  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, input.employeeId)).limit(1);
  if (!emp) throw new CommandError('That joiner no longer exists');

  const teams = await ctx.tx.select().from(notifiedTeams)
    .where(and(sql`${notifiedTeams.archivedAt} IS NULL`, teamFilter(input.teamKeys, 'onFile')))
    .orderBy(asc(notifiedTeams.sortOrder));
  if (!teams.length) {
    throw new CommandError('No team is set to receive the joiner file — set one in Settings');
  }

  const p = await progress(emp.id, ctx.tx);
  const docs = await ctx.tx.select().from(onboardingDocuments)
    .where(and(
      eq(onboardingDocuments.employeeId, emp.id),
      sql`${onboardingDocuments.status} <> 'missing'`,
    ));

  let notConfigured: string | null = null;
  for (const t of teams) {
    const contacts = await ctx.tx.select().from(notifiedTeamContacts)
      .where(eq(notifiedTeamContacts.teamId, t.id))
      .orderBy(asc(notifiedTeamContacts.sortOrder));
    const lead = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
    const cc = contacts.filter((c) => c.id !== lead?.id).map((c) => c.email);

    const q = await queueMessage({
      channel: 'Email',
      internal: true,
      applicationId: emp.applicationId,
      candidateId: emp.candidateId,
      jobId: emp.jobId,
      employeeId: emp.id,
      toName: lead?.name ?? t.name,
      toAddress: lead?.email ?? null,
      subject: `Joiner file — ${emp.name}, ${emp.title} (${emp.employeeCode}), starts ${emp.startDate}`,
      body: `Hi ${lead?.name?.split(/\s+/)[0] ?? t.short}, please find the file for ${emp.name} `
        + `(${emp.employeeCode}), joining as ${emp.title} on ${emp.startDate}`
        + `${p.noticeSent ? '' : ' (date still to be confirmed)'}. ${t.ask ?? ''} `
        + `Attached: the onboarding form${p.form ? '' : ' (not submitted yet)'}`
        + `${docs.length ? ` and ${docs.length} document${docs.length === 1 ? '' : 's'}` : ' — no documents attached yet'}. `
        + `— ${ctx.viewer.name}, Talent Acquisition`,
    }, ctx);
    if (q.reason) notConfigured = q.reason;

    await ctx.tx.insert(joiningNotices).values({
      employeeId: emp.id,
      kind: 'file',
      teamKey: t.key,
      startDate: emp.startDate,
      sentAt: ctx.now,
      sentBy: ctx.viewer.staffId ?? ctx.viewer.name,
      toName: lead?.name ?? t.name,
      toEmail: lead?.email ?? null,
      ccEmails: cc,
      documentCount: docs.length,
      formIncluded: p.form,
      messageId: q.messageId,
    });
    await notify({
      kind: 'file',
      text: `${emp.name}'s file sent to ${t.name} — ${docs.length} document${docs.length === 1 ? '' : 's'} attached`,
      employeeId: emp.id,
      applicationId: emp.applicationId,
    }, ctx);
  }

  await audit(ctx, {
    action: 'action',
    summary: `sent ${emp.name}'s joiner file to ${teams.map((t) => t.short).join(', ')}`,
    entityType: 'employee', entityId: emp.id, entityLabel: emp.name,
    after: { teams: teams.map((t) => t.key), documents: docs.length, form: p.form },
  }, ctx.tx);
  await emit(ctx, {
    type: 'joiner_file.sent', subjectType: 'employee', subjectId: emp.id,
    payload: { teams: teams.map((t) => t.key), documents: docs.length },
  }, ctx.tx);

  return { name: emp.name, teams: teams.map((t) => t.short), documents: docs.length, notConfigured };
}

/* ── Probation ───────────────────────────────────────────────────────────── */

export async function decideProbation(
  input: { employeeId: string; pass: boolean; reason?: string | null; note?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; state: 'passed' | 'failed' }> {
  const [rec] = await ctx.tx.select().from(probationRecords)
    .where(eq(probationRecords.employeeId, input.employeeId)).limit(1);
  if (!rec) throw new CommandError('That person has no probation on record');
  if (rec.state !== 'in_progress') {
    throw new CommandError('That probation has already been decided', { tone: 'warn' });
  }
  if (!input.pass && !input.reason?.trim()) {
    throw new CommandError('A reason — a failed probation is a decision somebody has to stand behind');
  }

  const [emp] = await ctx.tx.select().from(employees)
    .where(eq(employees.id, input.employeeId)).limit(1);
  const state = input.pass ? 'passed' : 'failed';

  await ctx.tx.update(probationRecords).set({
    state,
    decidedOn: ctx.now.toISOString().slice(0, 10),
    decidedBy: ctx.viewer.staffId ?? null,
    decidedByName: ctx.viewer.name,
    reason: input.reason?.trim() ?? null,
    note: input.note?.trim() ?? null,
    updatedAt: ctx.now,
  }).where(eq(probationRecords.employeeId, input.employeeId));

  await ctx.tx.update(employees).set({
    status: input.pass ? 'active' : 'left',
    leftOn: input.pass ? null : ctx.now.toISOString().slice(0, 10),
    leftReason: input.pass ? null : (input.reason?.trim() ?? 'Did not pass probation'),
    updatedAt: ctx.now,
  }).where(eq(employees.id, input.employeeId));

  await audit(ctx, {
    action: 'action',
    summary: input.pass
      ? `${emp?.name ?? 'The employee'} passed probation`
      : `${emp?.name ?? 'The employee'} did not pass probation — ${input.reason}`,
    entityType: 'employee', entityId: input.employeeId, entityLabel: emp?.name ?? null,
    before: { probation: 'in_progress' }, after: { probation: state },
    reason: input.reason?.trim() ?? null,
  }, ctx.tx);
  await emit(ctx, {
    type: 'probation.decided', subjectType: 'employee', subjectId: input.employeeId,
    payload: { state, reason: input.reason?.trim() ?? null },
  }, ctx.tx);

  return { name: emp?.name ?? 'The employee', state };
}
