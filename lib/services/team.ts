import 'server-only';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { staff, jobs, applications, tasks, accounts } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, emit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { HIRING_ROLES, TEAM_ROLES, type RoleKey } from '@/lib/domain/team';
import { emailOf } from '@/lib/services/accounts';

/* ═════════════════════════════════════════════════════════════════════════════
   THE TA TEAM

   Adding somebody is easy. The two that matter are the two that take somebody
   away, because a desk with no owner is how candidates go quiet:

     · deactivating keeps everything they own and simply marks them inactive —
       it is reversible and it is what a sabbatical looks like;
     · deleting hands the whole desk over first. Open requisitions, live
       applications and open tasks move to the person who inherits them, in one
       transaction, and the profile is marked deleted rather than removed so
       their name stays on every record they touched.

   History is never rewritten. A closed application keeps the name of whoever
   actually worked it, which is what makes last quarter's numbers stay true.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Person = typeof staff.$inferSelect;

export type PersonInput = {
  name: string;
  title?: string | null;
  role: RoleKey;
  email?: string | null;
  phone?: string | null;
  locationId?: string | null;
  deptIds?: string[];
  monthlyTarget?: number | null;
  gender?: string | null;
};

const hueOf = (name: string): number =>
  ([...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5) + 1;

/** The seniority a title implies — the word in front of it, mostly. */
export function seniorityOf(role: RoleKey, title: string): string {
  const t = title.toLowerCase();
  if (role === 'tal_lead' || /head|director|chief/.test(t)) return 'Lead';
  if (/senior|sr\b|lead/.test(t)) return 'Senior';
  if (/junior|jr\b|associate|graduate|trainee/.test(t)) return 'Junior';
  return 'Mid';
}

function readPerson(input: PersonInput, existing?: Person) {
  const name = input.name?.trim() || existing?.name || '';
  if (!name) throw new CommandError('A full name is required');
  const role = (input.role ?? existing?.role) as RoleKey;
  const def = TEAM_ROLES.find((x) => x.v === role);
  if (!def) throw new CommandError('That is not one of the roles on the team');
  const title = input.title?.trim() || existing?.title || def.label;
  const email = input.email?.trim() || existing?.email || emailOf(name);
  const carriesTarget = (HIRING_ROLES as readonly string[]).includes(role);
  return {
    name,
    title,
    role,
    roleLabel: def.label,
    email,
    phone: input.phone?.trim() || existing?.phone || null,
    locationId: input.locationId ?? existing?.locationId ?? null,
    deptIds: input.deptIds ?? existing?.deptIds ?? [],
    monthlyTarget: carriesTarget ? Math.max(0, Math.round(input.monthlyTarget ?? existing?.monthlyTarget ?? 0)) : 0,
    gender: input.gender ?? existing?.gender ?? null,
    seniority: seniorityOf(role, title),
  };
}

export async function addPerson(
  input: PersonInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ id: string; name: string }> {
  const p = readPerson(input);

  const [clash] = await ctx.tx.select({ id: staff.id }).from(staff)
    .where(sql`lower(${staff.email}) = ${p.email.toLowerCase()} AND ${staff.status} <> 'deleted'`)
    .limit(1);
  if (clash) throw new CommandError(`${p.email} is already somebody's address on the team`);

  const id = `stf_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(staff).values({
    id,
    ...p,
    hue: hueOf(p.name),
    lifetimeHires: 0,
    joinedOn: ctx.now.toISOString().slice(0, 10),
    status: 'active',
    photo: 'profile',
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  await audit(ctx, {
    action: 'create',
    summary: `added ${p.name} to the TA team as ${p.title}`,
    entityType: 'staff', entityId: id, entityLabel: p.name,
    after: { role: p.role, title: p.title, monthlyTarget: p.monthlyTarget },
  }, ctx.tx);

  return { id, name: p.name };
}

export async function savePerson(
  id: string, input: PersonInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string }> {
  const [existing] = await ctx.tx.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!existing || existing.status === 'deleted') throw new CommandError('No such team member');
  const p = readPerson(input, existing);

  await ctx.tx.update(staff).set({ ...p, updatedAt: ctx.now }).where(eq(staff.id, id));

  await audit(ctx, {
    action: 'update',
    summary: `edited ${p.name}'s profile`,
    entityType: 'staff', entityId: id, entityLabel: p.name,
    before: { role: existing.role, title: existing.title, monthlyTarget: existing.monthlyTarget },
    after: { role: p.role, title: p.title, monthlyTarget: p.monthlyTarget },
  }, ctx.tx);

  return { name: p.name };
}

export type Owned = {
  requisitions: Array<{ id: string; title: string }>;
  live: number;
  tasks: number;
  closed: number;
};

/** What a person is holding, and would have to hand over. */
export async function owned(id: string, exec: Exec): Promise<Owned> {
  const reqs = await exec.select({ id: jobs.id, title: jobs.title }).from(jobs)
    .where(sql`${jobs.status} <> 'closed' AND ${jobs.archivedAt} IS NULL
               AND (${jobs.recruiterId} = ${id} OR ${jobs.sourcerId} = ${id}
                    OR ${jobs.coordinatorId} = ${id})`)
    .orderBy(asc(jobs.id));
  const counts = rowsOf(await exec.execute(sql`
    SELECT count(*) FILTER (WHERE status IN ('active','on_hold'))::int AS live,
           count(*) FILTER (WHERE status NOT IN ('active','on_hold'))::int AS closed
      FROM ${applications}
     WHERE recruiter_id = ${id} OR sourcer_id = ${id}`))[0] as { live: number; closed: number };
  const openTasks = rowsOf(await exec.execute(sql`
    SELECT count(*)::int AS open FROM ${tasks}
     WHERE assignee_id = ${id} AND done = false`))[0] as { open: number };
  return {
    requisitions: reqs,
    live: Number(counts.live),
    tasks: Number(openTasks.open),
    closed: Number(counts.closed),
  };
}

export async function deactivate(
  id: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; openRequisitions: number }> {
  const [p] = await ctx.tx.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!p || p.status === 'deleted') throw new CommandError('No such team member');
  if (p.status === 'inactive') throw new CommandError(`${p.name} is already inactive`, { tone: 'warn' });
  if (id === ctx.viewer.staffId) throw new CommandError('You cannot deactivate your own profile');

  const what = await owned(id, ctx.tx);
  await ctx.tx.update(staff)
    .set({ status: 'inactive', updatedAt: ctx.now })
    .where(eq(staff.id, id));
  /* Their way in goes with them. */
  await ctx.tx.update(accounts)
    .set({ status: 'disabled', updatedAt: ctx.now })
    .where(eq(accounts.staffId, id));

  await audit(ctx, {
    action: 'update',
    summary: `marked ${p.name} inactive`,
    entityType: 'staff', entityId: id, entityLabel: p.name,
    before: { status: p.status }, after: { status: 'inactive' },
  }, ctx.tx);

  return { name: p.name, openRequisitions: what.requisitions.length };
}

export async function reactivate(
  id: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string }> {
  const [p] = await ctx.tx.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!p || p.status === 'deleted') throw new CommandError('No such team member');
  await ctx.tx.update(staff).set({ status: 'active', updatedAt: ctx.now }).where(eq(staff.id, id));
  await ctx.tx.update(accounts)
    .set({ status: 'active', updatedAt: ctx.now })
    .where(and(eq(accounts.staffId, id), eq(accounts.status, 'disabled')));
  await audit(ctx, {
    action: 'update',
    summary: `brought ${p.name} back onto the team`,
    entityType: 'staff', entityId: id, entityLabel: p.name,
    before: { status: p.status }, after: { status: 'active' },
  }, ctx.tx);
  return { name: p.name };
}

export type DeleteResult = {
  name: string;
  heirName: string | null;
  requisitions: number;
  applications: number;
  tasks: number;
};

/**
 * Delete a profile, handing the desk over first. Everything moves in the same
 * transaction as the deletion, so there is no moment at which a live
 * application has an owner who does not exist.
 */
export async function deletePerson(
  input: { id: string; heirId?: string | null }, ctx: Ctx & { tx: Exec; now: Date },
): Promise<DeleteResult> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can delete a team member');
  if (input.id === ctx.viewer.staffId) throw new CommandError('You cannot delete your own profile');

  const [p] = await ctx.tx.select().from(staff).where(eq(staff.id, input.id)).limit(1);
  if (!p || p.status === 'deleted') throw new CommandError('No such team member');

  const what = await owned(input.id, ctx.tx);
  const needsHeir = what.requisitions.length + what.live + what.tasks > 0;

  let heir: Person | null = null;
  if (needsHeir) {
    if (!input.heirId) throw new CommandError('Choose who inherits their work');
    const [h] = await ctx.tx.select().from(staff).where(eq(staff.id, input.heirId)).limit(1);
    if (!h || h.status !== 'active') throw new CommandError('That person cannot inherit a desk');
    if (h.id === p.id) throw new CommandError('Somebody else has to inherit the work');
    heir = h;
  }

  let movedApplications = 0;
  let movedTasks = 0;
  if (heir) {
    await ctx.tx.execute(sql`
      UPDATE ${jobs}
         SET recruiter_id  = CASE WHEN recruiter_id  = ${p.id} THEN ${heir.id} ELSE recruiter_id END,
             sourcer_id    = CASE WHEN sourcer_id    = ${p.id} THEN ${heir.id} ELSE sourcer_id END,
             coordinator_id= CASE WHEN coordinator_id= ${p.id} THEN ${heir.id} ELSE coordinator_id END,
             updated_at    = ${ctx.now}
       WHERE status <> 'closed' AND archived_at IS NULL
         AND (recruiter_id = ${p.id} OR sourcer_id = ${p.id} OR coordinator_id = ${p.id})`);

    /* Only live applications move. A closed one keeps the name of whoever
       actually worked it, or last quarter's numbers stop being true. */
    const apps = rowsOf(await ctx.tx.execute(sql`
      UPDATE ${applications}
         SET recruiter_id = CASE WHEN recruiter_id = ${p.id} THEN ${heir.id} ELSE recruiter_id END,
             sourcer_id   = CASE WHEN sourcer_id   = ${p.id} THEN ${heir.id} ELSE sourcer_id END
       WHERE status IN ('active','on_hold')
         AND (recruiter_id = ${p.id} OR sourcer_id = ${p.id})
       RETURNING id`));
    movedApplications = apps.length;

    const moved = await ctx.tx.update(tasks)
      .set({ assigneeId: heir.id })
      .where(and(eq(tasks.assigneeId, p.id), eq(tasks.done, false)))
      .returning({ id: tasks.id });
    movedTasks = moved.length;
  }

  await ctx.tx.update(staff).set({
    status: 'deleted',
    deletedAt: ctx.now,
    handedOverTo: heir?.id ?? null,
    updatedAt: ctx.now,
  }).where(eq(staff.id, p.id));
  await ctx.tx.update(accounts)
    .set({ status: 'disabled', removedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(accounts.staffId, p.id));

  await audit(ctx, {
    action: 'delete',
    summary: `deleted ${p.name}'s profile${heir ? ` and handed their desk to ${heir.name}` : ''}`,
    entityType: 'staff', entityId: p.id, entityLabel: p.name,
    before: { status: p.status },
    after: {
      status: 'deleted',
      handedTo: heir?.name ?? null,
      requisitions: what.requisitions.length,
      applications: movedApplications,
      tasks: movedTasks,
    },
  }, ctx.tx);

  return {
    name: p.name,
    heirName: heir?.name ?? null,
    requisitions: what.requisitions.length,
    applications: movedApplications,
    tasks: movedTasks,
  };
}

/** Restore a deleted profile. The desk does not come back with it. */
export async function restorePerson(
  id: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string }> {
  if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can restore a team member');
  const [p] = await ctx.tx.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!p) throw new CommandError('No such team member');
  if (p.status !== 'deleted') throw new CommandError(`${p.name} is not deleted`, { tone: 'warn' });

  await ctx.tx.update(staff).set({
    status: 'active', deletedAt: null, handedOverTo: null, updatedAt: ctx.now,
  }).where(eq(staff.id, id));

  await audit(ctx, {
    action: 'update',
    summary: `restored ${p.name}'s profile — their desk stays where it was handed`,
    entityType: 'staff', entityId: id, entityLabel: p.name,
    before: { status: 'deleted' }, after: { status: 'active' },
  }, ctx.tx);

  return { name: p.name };
}

/** Somebody's monthly hiring target. Only the roles that carry one. */
export async function setTarget(
  input: { id: string; monthlyTarget: number }, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string; monthlyTarget: number }> {
  const [p] = await ctx.tx.select().from(staff).where(eq(staff.id, input.id)).limit(1);
  if (!p || p.status === 'deleted') throw new CommandError('No such team member');
  if (!(HIRING_ROLES as readonly string[]).includes(p.role)) {
    const label = TEAM_ROLES.find((x) => x.v === p.role)?.label ?? p.role;
    throw new CommandError(`A ${label.toLowerCase()} does not carry a hiring target`);
  }
  const target = Math.max(0, Math.round(input.monthlyTarget));
  await ctx.tx.update(staff)
    .set({ monthlyTarget: target, updatedAt: ctx.now })
    .where(eq(staff.id, input.id));

  await audit(ctx, {
    action: 'update',
    summary: `set ${p.name}'s monthly target to ${target}`,
    entityType: 'staff', entityId: input.id, entityLabel: p.name,
    before: { monthlyTarget: p.monthlyTarget }, after: { monthlyTarget: target },
  }, ctx.tx);

  return { name: p.name, monthlyTarget: target };
}

/** Who could take a desk over — active people whose role owns requisitions. */
export async function heirs(exceptId: string, exec: Exec): Promise<Array<{ id: string; name: string; title: string | null; open: number }>> {
  const rows = rowsOf(await exec.execute(sql`
    SELECT s.id, s.name, s.title,
           (SELECT count(*)::int FROM ${jobs} j
             WHERE j.recruiter_id = s.id AND j.status = 'open') AS open
      FROM ${staff} s
     WHERE s.id <> ${exceptId} AND s.status = 'active'
       AND s.role IN ('recruiter','tal_lead')
     ORDER BY open ASC, s.id`));
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    title: (r.title ?? null) as string | null,
    open: Number(r.open),
  }));
}
