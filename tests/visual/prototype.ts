import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

/* ─────────────────────────────────────────────────────────────────────────────
   The reference, on the same calendar as production.

   The prototype pins "now" to its dataset — meta.asOf, a fixed day — so every
   relative figure in it agrees with the data it ships. The seed does the
   opposite for the same reason: it shifts the whole dataset forward onto the day
   it runs, preserving every interval, so that "now" means now and the Scheduling
   agenda is not empty.

   Both are right, and together they mean the two applications show the same
   product on two different calendars: identical "3 days ago", absolute dates a
   fortnight apart. Comparing them pixel by pixel would then report a difference
   on every screen that prints a date, and hide the real ones underneath.

   So the reference is opened on production's calendar. A copy of the file is
   written to a temporary directory with one statement inserted between the
   dataset and the line that reads its clock: walk the dataset, add the same
   number of days to every ISO timestamp, and move meta.asOf with them. The
   prototype itself is never written to — it is the specification.
   ───────────────────────────────────────────────────────────────────────────*/

const ANCHOR = 'const NOW = new Date(DATA.meta.asOf);';

/** The shift the seed applied, in whole days, read from the database. */
export async function datasetShift(): Promise<number> {
  try {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(
      `SELECT (extra->>'rebasedDays')::int AS days FROM org_settings WHERE id = 'org'`,
    );
    await c.end();
    return Number(r.rows[0]?.days ?? 0);
  } catch {
    return 0;
  }
}

const REBASE = (days: number) => `
/* Inserted by tests/visual/prototype.ts — the reference on production's
   calendar. Every ISO timestamp in the dataset moves ${days} whole days, which
   is what the seed did to the same data, so the two are comparable. */
;(function rebasePrototypeDataset() {
  var DAYS = ${days};
  if (!DAYS) return;
  var MS = DAYS * 86400000;
  var ISO = /^\\d{4}-\\d{2}-\\d{2}(T[\\d:.]+Z?)?$/;
  var MONTH = /^\\d{4}-\\d{2}$/;
  var seen = new WeakSet();
  function shiftString(s) {
    if (MONTH.test(s)) {
      /* A month key moves with the middle of its month, so a shift that crosses
         a boundary lands where the seed put it. */
      var mid = new Date(s + '-15T00:00:00.000Z').getTime() + MS;
      return new Date(mid).toISOString().slice(0, 7);
    }
    if (!ISO.test(s)) return s;
    var d = new Date(s.length === 10 ? s + 'T00:00:00.000Z' : s);
    if (isNaN(d.getTime())) return s;
    var out = new Date(d.getTime() + MS).toISOString();
    return s.length === 10 ? out.slice(0, 10) : out;
  }
  function walk(o) {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length; i++) {
        if (typeof o[i] === 'string') o[i] = shiftString(o[i]);
        else walk(o[i]);
      }
      return;
    }
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      if (typeof v === 'string') o[k] = shiftString(v);
      else walk(v);
    }
  }
  walk(DATA);
})();
`;

/**
 * A copy of the prototype whose dataset sits on production's calendar.
 * Returns a file:// URL. The copy is cached for the process.
 */
let cached: { days: number; url: string } | null = null;

export async function prototypeUrl(source: string, days?: number): Promise<string> {
  const shift = days ?? await datasetShift();
  if (cached && cached.days === shift) return cached.url;
  if (!shift) {
    cached = { days: 0, url: pathToFileURL(source).href };
    return cached.url;
  }

  const html = fs.readFileSync(source, 'utf8');
  const i = html.indexOf(ANCHOR);
  if (i < 0) {
    throw new Error('Could not find the prototype\'s clock line — it may have changed shape.');
  }
  const patched = html.slice(0, i) + REBASE(shift) + html.slice(i);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bayut-proto-'));
  const file = path.join(dir, path.basename(source));
  fs.writeFileSync(file, patched);
  cached = { days: shift, url: pathToFileURL(file).href };
  return cached.url;
}
