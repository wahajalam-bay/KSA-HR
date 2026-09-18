import { unzip, entryText, unescapeXml, ZipError } from './zip';

/* ═════════════════════════════════════════════════════════════════════════════
   A SPREADSHEET, AS ROWS

   The manpower plan a department head keeps is a spreadsheet, and the import
   is the only place in the product where a file somebody else maintains
   becomes records. So the reading is deliberately literal: what comes back is
   the grid as typed, in the order it was typed, with blank cells kept as blank
   cells — a row that has skipped a column must not silently shift the rest of
   its values one to the left.

   Two formats, because those are the two Excel offers when somebody saves:

     · CSV — quoted fields, embedded commas, doubled quotes, CRLF, a BOM;
     · XLSX — a zip of SpreadsheetML, with the strings in a shared table and
       the dates as serial numbers that only the number format identifies.

   The dates are the subtle part. A cell holding 45352 is either a headcount or
   the first of March, and only its style says which, so the styles are read.
   Guessing from the magnitude would turn somebody's approved headcount into a
   date the day the plan reached five figures.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Grid = string[][];

/* ── CSV ─────────────────────────────────────────────────────────────────── */

/** Which character separates the fields. Excel in an Arabic or European
    locale writes semicolons, and a plan saved on somebody's laptop is not
    going to be re-saved because the importer only knows one of the two. */
export function delimiterOf(firstLine: string): ',' | ';' | '\t' {
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', (outside.match(/,/g) ?? []).length],
    [';', (outside.match(/;/g) ?? []).length],
    ['\t', (outside.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** A CSV as a grid. Quotes, doubled quotes, newlines inside a field, a BOM. */
export function csvRows(text: string): Grid {
  const s = text.replace(/^﻿/, '');
  const sep = delimiterOf(s.slice(0, s.search(/\r?\n/) + 1 || s.length));
  const rows: Grid = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === sep) { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  /* A trailing blank line is an artefact of how the file ends, not a row. */
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === '')) rows.pop();
  return rows.map((r) => r.map((x) => x.trim()));
}

/* ── XLSX ────────────────────────────────────────────────────────────────── */

/** A1 → 0, B1 → 1, AA1 → 26. */
export function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return Math.max(0, n - 1);
}

/* The built-in number formats Excel treats as dates or times. Anything above
   163 is a format somebody defined, and those are read from the file. */
const BUILTIN_DATE = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

const looksLikeDate = (code: string) =>
  /[dmy]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));

/** Excel's serial day as a date. Day 1 is 1900-01-01; day 60 never existed. */
export function serialDate(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0 || n > 2_958_465) return null;
  const days = Math.floor(n);
  const epoch = days < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Every `<si>` in the shared string table, in order. */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const items = xml.split(/<si(?:\s[^>]*)?>/).slice(1);
  for (const item of items) {
    const body = item.slice(0, item.indexOf('</si>') === -1 ? undefined : item.indexOf('</si>'));
    /* A string with mixed formatting is several runs; a phonetic hint is not
       part of the value and is dropped. */
    const withoutHints = body.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    const parts = [...withoutHints.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    out.push(unescapeXml(parts.join('')));
  }
  return out;
}

/** For each cell style, whether its number format is a date. */
function dateStyles(xml: string | null): Set<number> {
  const out = new Set<number>();
  if (!xml) return out;

  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(m[1]), unescapeXml(m[2]));
  }

  const block = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? '';
  let index = 0;
  for (const m of block.matchAll(/<xf\s[^>]*?>|<xf\s[^>]*?\/>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? '0');
    const code = custom.get(id);
    if (BUILTIN_DATE.has(id) || (code !== undefined && looksLikeDate(code))) out.add(index);
    index++;
  }
  return out;
}

/** The first worksheet of an .xlsx, as a grid. */
export function xlsxRows(bytes: Uint8Array): Grid {
  let zip: Map<string, Uint8Array>;
  try {
    zip = unzip(bytes);
  } catch (e) {
    if (e instanceof ZipError) throw new Error(e.message);
    throw e;
  }

  const sheets = [...zip.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d*\.xml$/.test(k))
    .sort((a, b) => (Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0)));
  if (!sheets.length) throw new Error('That workbook has no worksheet in it');

  const xml = entryText(zip, sheets[0]) ?? '';
  const shared = sharedStrings(entryText(zip, 'xl/sharedStrings.xml'));
  const dated = dateStyles(entryText(zip, 'xl/styles.xml'));

  const grid: Grid = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row\s[^>]*\/>/g)) {
    const body = rowMatch[1] ?? '';
    const cells: string[] = [];
    for (const cm of body.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /r="([A-Za-z]+)\d+"/.exec(attrs)?.[1];
      const at = ref ? columnOf(ref) : cells.length;
      while (cells.length < at) cells.push('');

      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const style = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? '-1');
      let value = '';

      if (type === 's') {
        const i = Number(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '-1');
        value = shared[i] ?? '';
      } else if (type === 'inlineStr') {
        value = unescapeXml(
          [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''),
        );
      } else if (type === 'str' || type === 'e') {
        value = unescapeXml(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      } else if (type === 'b') {
        value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1] === '1' ? 'TRUE' : 'FALSE';
      } else {
        const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (raw === '') value = '';
        else if (dated.has(style)) value = serialDate(Number(raw)) ?? raw;
        else value = raw;
      }
      cells[at] = value.trim();
    }
    grid.push(cells);
  }

  while (grid.length && grid[grid.length - 1].every((x) => x === '')) grid.pop();
  return grid;
}

/* ── Either ──────────────────────────────────────────────────────────────── */

export const XLSX_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

/** A spreadsheet as a grid, whichever of the two shapes it arrived in. */
export function readGrid(name: string, contentType: string, bytes: Uint8Array): Grid {
  const isXlsx = /\.xlsx$/i.test(name)
    || contentType === XLSX_TYPES[0]
    || (contentType === XLSX_TYPES[1] && /^PK/.test(
      new TextDecoder('latin1').decode(bytes.subarray(0, 2)),
    ));
  if (isXlsx) return xlsxRows(bytes);

  if (/\.xls$/i.test(name) && !/\.xlsx$/i.test(name)) {
    /* The old binary format is a different thing entirely, and pretending to
       read it would produce a plan nobody typed. Say so. */
    throw new Error(
      'That is the old .xls format, which cannot be read here — save it as .xlsx or .csv',
    );
  }
  return csvRows(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
}

/** A grid's header row mapped to indices, matched loosely on purpose. */
export function headerIndex(header: string[]): Map<string, number> {
  const out = new Map<string, number>();
  header.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key && !out.has(key)) out.set(key, i);
  });
  return out;
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
