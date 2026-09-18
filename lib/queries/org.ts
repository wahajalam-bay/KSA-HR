import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import { departments, functions, locations, staff } from '@/db/schema';

/* ─────────────────────────────────────────────────────────────────────────────
   The organisation's own lists.

   Departments, functions and locations are read in the order the organisation
   keeps them — Management, then the sales line, then the support functions —
   not in the order the alphabet keeps them. Every filter that offers a
   department reads it from here, so the same list appears in the same order on
   every screen, and a rename does not reshuffle it.
   ───────────────────────────────────────────────────────────────────────────*/

export type Dept = { id: string; name: string; head: string | null };

export async function orgDepartments(exec: Exec = db()): Promise<Dept[]> {
  return exec
    .select({ id: departments.id, name: departments.name, head: departments.head })
    .from(departments)
    .where(sql`archived_at IS NULL`)
    .orderBy(departments.sortOrder, departments.name);
}

export type Fn = { id: string; name: string };

export async function orgFunctions(exec: Exec = db()): Promise<Fn[]> {
  return exec
    .select({ id: functions.id, name: functions.name })
    .from(functions)
    .orderBy(functions.sortOrder, functions.name);
}

export type Loc = { id: string; city: string };

export async function orgLocations(exec: Exec = db()): Promise<Loc[]> {
  return exec
    .select({ id: locations.id, city: locations.city })
    .from(locations)
    .orderBy(locations.id);
}

/** The onboarding specialist — the person who verifies a joiner's documents. */
export async function onboardingSpecialist(exec: Exec = db()): Promise<string | null> {
  const [row] = await exec
    .select({ name: staff.name })
    .from(staff)
    .where(sql`role = 'onboarding' AND status <> 'deleted'`)
    .orderBy(staff.id)
    .limit(1);
  return row?.name ?? null;
}
