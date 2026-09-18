import 'server-only';
import { sql, type SQL } from 'drizzle-orm';

/* node-postgres hands back a QueryResult, Drizzle sometimes hands back the rows
   themselves, and the type it declares is looser than either. One helper
   settles it, so every query file reads the same and nothing downstream is
   typed `unknown`. */
export function rows<T = Record<string, any>>(res: unknown): T[] {
  const r = res as { rows?: T[] };
  return Array.isArray(res) ? (res as T[]) : (r.rows ?? []);
}

/** The first row, or undefined. */
export function row<T = Record<string, any>>(res: unknown): T | undefined {
  return rows<T>(res)[0];
}

/** A count query's single number. */
export function count(res: unknown): number {
  const r = row<Record<string, unknown>>(res);
  if (!r) return 0;
  const v = Object.values(r)[0];
  return Number(v ?? 0);
}

/**
 * `column IN (a, b, c)` — and `false` when the list is empty.
 *
 * `IN ()` is a syntax error in PostgreSQL, not an empty set, so a query built
 * by interpolating a list has to know whether the list had anything in it.
 * Writing that check at each of the eleven places it was needed meant some of
 * them had it and some did not, and the ones that did not only failed for
 * somebody whose access reached nothing — a hiring manager on their first day,
 * a recruiter whose picked list is empty, a panel member between interviews.
 * So it is one helper, and an empty list means "nothing matches", which is what
 * the caller meant.
 */
export function inList(column: SQL | unknown, ids: readonly string[]): SQL {
  if (!ids.length) return sql`false`;
  return sql`${column} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}
