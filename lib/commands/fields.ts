import 'server-only';

/* ═════════════════════════════════════════════════════════════════════════════
   READING A FORM

   A command receives whatever the interface collected off the open sheet, and
   the shapes that arrive are not all strings. In particular:

     · a text input, a select and a date arrive as a string;
     · a ticked checkbox arrives as an array — `['true']` for a bare one,
       `['job_a', 'job_b']` for a group;
     · an UNTICKED checkbox, and a group with nothing ticked, arrive as an empty
       array rather than as nothing at all, which is how "untick every
       application question" reaches the server as an instruction rather than as
       silence (see `collectFields` in components/app/app-client.tsx).

   Reading `['true']` with a helper that only understands strings gives `false`,
   which is the sort of bug that passes every test written with literal strings
   and then quietly does nothing in a browser. So the helpers live here, once,
   and understand all three shapes.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Fields = Record<string, unknown>;

/** The first value under a key, whatever shape it arrived in, trimmed. */
export function str(f: Fields, k: string): string {
  const raw = f[k];
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find((x) => typeof x === 'string' && x.trim() !== '');
    return typeof first === 'string' ? first.trim() : '';
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** A number, with the thousands separators a person types stripped. */
export function num(f: Fields, k: string): number | null {
  const raw = str(f, k);
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** A whole number, rounded, or undefined — for the shapes that want that. */
export function int(f: Fields, k: string): number | undefined {
  const n = num(f, k);
  return n == null ? undefined : Math.round(n);
}

/**
 * Whether a checkbox or a yes/no select is on.
 *
 * `['true']` is a ticked box, `[]` is an unticked one, `'1'` is a select set to
 * yes, and `''` is one set to no.
 */
export function yes(f: Fields, k: string): boolean {
  const raw = f[k];
  if (typeof raw === 'boolean') return raw;
  if (Array.isArray(raw)) {
    return raw.some((x) => ['1', 'true', 'on', 'yes'].includes(String(x).trim().toLowerCase()));
  }
  return ['1', 'true', 'on', 'yes'].includes(str(f, k).toLowerCase());
}

/** Whether the form carried this field at all — an empty array still counts. */
export const present = (f: Fields, k: string): boolean => k in f;

/**
 * A list: a checkbox group, or a comma-separated line somebody typed. An empty
 * array is a real answer — "none of them" — and is returned as such.
 */
export function list(f: Fields, k: string): string[] {
  const raw = f[k];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/** One value per line, for the textareas that collect a list that way. */
export const lines = (f: Fields, k: string): string[] =>
  str(f, k).split('\n').map((x) => x.trim()).filter(Boolean);

/** A prefixed group of keys, for the blocks that number their rows. */
export function carries(f: Fields, prefix: string): boolean {
  return Object.keys(f).some((k) => k.startsWith(prefix));
}
