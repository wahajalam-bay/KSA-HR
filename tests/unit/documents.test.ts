import { deflateRawSync, crc32 } from 'node:zlib';
import { unzip, unescapeXml, ZipError } from '@/lib/domain/zip';
import { docxText, textOfBody } from '@/lib/domain/docx';
import {
  csvRows, xlsxRows, readGrid, columnOf, serialDate, delimiterOf, headerIndex,
} from '@/lib/domain/sheet';
import { ok, eq as equals, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   The two file formats the product reads without a library.

   A CV exported from Word and a manpower plan kept in Excel are both zips of
   XML, and both are read here rather than through a document library the
   product would otherwise carry for two screens. That is a reasonable trade
   only if the reading is actually correct, so this suite builds real files —
   a real zip, deflated, with a real central directory — and reads them back.

   The cases are the ones that go wrong in practice: a blank cell in the middle
   of a row, a date that is a number, a string table shared between cells, a
   semicolon-separated export from a European Excel, a quoted field with a
   comma in it, and a Word table.
   ───────────────────────────────────────────────────────────────────────────*/

/* ── Building a zip, so the reader has something real to read ─────────────── */

function zipOf(entries: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  for (const [name, text] of entries) {
    const raw = new TextEncoder().encode(text);
    const deflated = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(Buffer.from(raw));
    const nameBytes = new TextEncoder().encode(name);

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(deflated.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0), ...nameBytes,
    ]);
    parts.push(local, deflated);

    central.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(deflated.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...nameBytes,
    ]));
    offset += local.length + deflated.length;
  }

  const cd = new Uint8Array(central.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of central) { cd.set(c, at); at += c.length; }

  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cd.length), ...u32(offset), ...u16(0),
  ]);

  const total = parts.reduce((n, p) => n + p.length, 0) + cd.length + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  out.set(cd, p); p += cd.length;
  out.set(eocd, p);
  return out;
}

/* ── A worksheet, as Excel writes one ────────────────────────────────────── */

const SHARED = `<?xml version="1.0"?>
<sst count="6" uniqueCount="6">
  <si><t>Position title</t></si>
  <si><t>Reports to</t></si>
  <si><t>Start date</t></si>
  <si><t>Head of Compliance</t></si>
  <si><r><t>Senior </t></r><r><t>Compliance Officer</t></r></si>
  <si><t>Riyadh &amp; Jeddah</t></si>
</sst>`;

/* numFmtId 14 is Excel's built-in short date; style 1 uses it. */
const STYLES = `<?xml version="1.0"?>
<styleSheet>
  <numFmts count="1"><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0"/>
    <xf numFmtId="14" fontId="0" applyNumberFormat="1"/>
    <xf numFmtId="166" fontId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

const SHEET = `<?xml version="1.0"?>
<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Approved headcount</t></is></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" s="1"><v>45352</v></c><c r="D2"><v>1</v></c></row>
  <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>3</v></c><c r="C3" s="2"><v>45717</v></c><c r="D3"><v>2</v></c></row>
  <row r="4"><c r="A4" t="str"><v>Compliance Analyst</v></c><c r="B4" t="s"><v>4</v></c><c r="D4"><v>45352</v></c></row>
</sheetData></worksheet>`;

const workbook = () => zipOf([
  ['[Content_Types].xml', '<Types/>'],
  ['xl/sharedStrings.xml', SHARED],
  ['xl/styles.xml', STYLES],
  ['xl/worksheets/sheet1.xml', SHEET],
]);

const DOCX_BODY = `<?xml version="1.0"?>
<w:document><w:body>
  <w:p><w:r><w:t xml:space="preserve">Dear </w:t></w:r><w:r><w:t>{{candidate_name}}</w:t></w:r></w:p>
  <w:p><w:r><w:t>We are pleased to offer you the position of</w:t></w:r><w:r><w:tab/><w:t>{{job_title}}</w:t></w:r></w:p>
  <w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>Basic</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{base_monthly}}</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>Housing</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{housing_allowance}}</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r><w:t>Bayut &amp; dubizzle KSA</w:t></w:r></w:p>
</w:body></w:document>`;

const suite: Suite = {
  name: 'unit · reading a document nobody here wrote',
  tests: [
    {
      name: 'a zip built byte by byte reads back as what went in',
      fn() {
        const zip = unzip(zipOf([['a/one.txt', 'hello'], ['b/two.xml', '<x>y</x>']]));
        equals(zip.size, 2);
        equals(new TextDecoder().decode(zip.get('a/one.txt')!), 'hello');
        equals(new TextDecoder().decode(zip.get('b/two.xml')!), '<x>y</x>');
      },
    },

    {
      name: 'something that is not a zip is refused in words, not a stack trace',
      fn() {
        let message = '';
        try { unzip(new TextEncoder().encode('This is a plain text CV, not a docx')); }
        catch (e) { message = e instanceof ZipError ? e.message : String(e); }
        includes(message, 'not a zip');
      },
    },

    {
      name: 'the five XML entities and a numeric reference come back as characters',
      fn() {
        equals(unescapeXml('Bayut &amp; dubizzle &lt;KSA&gt;'), 'Bayut & dubizzle <KSA>');
        equals(unescapeXml('&#1575;&#1604;&#1585;&#1610;&#1575;&#1590;'), 'الرياض');
        equals(unescapeXml('&#x41;&#x42;'), 'AB');
        /* Something that is not an entity is left exactly as it was. */
        equals(unescapeXml('5 &widget; 6'), '5 &widget; 6');
      },
    },

    /* ── Word ──────────────────────────────────────────────────────────── */
    {
      name: 'a Word document reads as its text, in reading order',
      fn() {
        const text = docxText(zipOf([
          ['[Content_Types].xml', '<Types/>'],
          ['word/document.xml', DOCX_BODY],
        ]));
        includes(text, 'Dear {{candidate_name}}');
        includes(text, 'Bayut & dubizzle KSA');
        /* Two runs inside one paragraph are one line, not two. */
        ok(!/Dear\n/.test(text), 'a run break is not a line break');
      },
    },

    {
      name: 'a table in a letter keeps its rows and columns apart',
      fn() {
        const text = textOfBody(DOCX_BODY);
        const line = text.split('\n').find((l) => l.startsWith('Basic'));
        ok(line, 'the table row is a line of its own');
        includes(line!, '\t');
        includes(line!, '{{base_monthly}}');
        ok(!line!.includes('Housing'), 'and the next row is a different line');
      },
    },

    {
      name: 'a file that is not a Word document reads as nothing rather than as noise',
      fn() {
        equals(docxText(new TextEncoder().encode('not a docx at all')), '');
      },
    },

    /* ── CSV ───────────────────────────────────────────────────────────── */
    {
      name: 'a CSV keeps a quoted comma, a doubled quote and a blank cell in place',
      fn() {
        const grid = csvRows(
          '﻿Position title,Reports to,Location\r\n'
          + '"Head of Compliance, KSA",,Riyadh\r\n'
          + 'Analyst,"He said ""yes""",\r\n',
        );
        equals(grid.length, 3);
        equals(grid[1][0], 'Head of Compliance, KSA');
        equals(grid[1][1], '');
        equals(grid[1][2], 'Riyadh');
        equals(grid[2][1], 'He said "yes"');
        equals(grid[2][2], '');
      },
    },

    {
      name: 'an Excel that writes semicolons is read as an Excel that writes semicolons',
      fn() {
        equals(delimiterOf('a;b;c'), ';');
        equals(delimiterOf('a,b,c'), ',');
        /* A comma inside a quoted field does not make it a comma file. */
        equals(delimiterOf('"Riyadh, KSA";b;c'), ';');
        const grid = csvRows('Title;Grade\r\nHead of Compliance;D1\r\n');
        equals(grid[1][0], 'Head of Compliance');
        equals(grid[1][1], 'D1');
      },
    },

    {
      name: 'a trailing newline is not a row of nothing',
      fn() {
        equals(csvRows('a,b\n1,2\n\n').length, 2);
      },
    },

    /* ── XLSX ──────────────────────────────────────────────────────────── */
    {
      name: 'a column reference is a column number',
      fn() {
        equals(columnOf('A1'), 0);
        equals(columnOf('B12'), 1);
        equals(columnOf('Z3'), 25);
        equals(columnOf('AA1'), 26);
        equals(columnOf('AB100'), 27);
      },
    },

    {
      name: 'a serial day is the day Excel means by it, either side of the 1900 bug',
      fn() {
        equals(serialDate(1), '1900-01-01');
        equals(serialDate(59), '1900-02-28');
        /* Day 60 is Excel's 29 February 1900, which never happened. Everything
           after it is one day out unless the epoch shifts, which is what this
           checks: 61 is the first of March. */
        equals(serialDate(61), '1900-03-01');
        equals(serialDate(45351), '2024-02-29');
        equals(serialDate(45352), '2024-03-01');
        equals(serialDate(0), null);
      },
    },

    {
      name: 'a worksheet reads as the grid that was typed, blanks and all',
      fn() {
        const grid = xlsxRows(workbook());
        equals(grid.length, 4);
        equals(grid[0].join('|'), 'Position title|Reports to|Start date|Approved headcount');

        /* A row that skips column B keeps the blank rather than shifting. */
        equals(grid[1][0], 'Head of Compliance');
        equals(grid[1][1], '');
        equals(grid[1][3], '1');

        /* A string built from two formatted runs is one value. */
        equals(grid[2][0], 'Senior Compliance Officer');
        /* A formula that produced a string. */
        equals(grid[3][0], 'Compliance Analyst');
      },
    },

    {
      name: 'a date is a date and a headcount is a number, decided by the style',
      fn() {
        const grid = xlsxRows(workbook());
        /* Style 1 is the built-in short date; style 2 is a custom dd/mm/yyyy. */
        equals(grid[1][2], '2024-03-01');
        equals(grid[2][2], '2025-03-01');
        /* The same magnitude in an unstyled cell stays the number it is —
           guessing from the size would turn a headcount into a date. */
        equals(grid[3][3], '45352');
      },
    },

    {
      name: 'the old .xls is refused by name rather than read as gibberish',
      fn() {
        let message = '';
        try { readGrid('plan.xls', 'application/vnd.ms-excel', new TextEncoder().encode('\xd0\xcf')); }
        catch (e) { message = e instanceof Error ? e.message : String(e); }
        includes(message, '.xlsx or .csv');
      },
    },

    {
      name: 'either format arrives as the same grid',
      fn() {
        const fromXlsx = readGrid('plan.xlsx', '', workbook());
        const fromCsv = readGrid('plan.csv', 'text/csv', new TextEncoder().encode(
          'Position title,Reports to,Start date,Approved headcount\n'
          + 'Head of Compliance,,2024-03-01,1\n',
        ));
        equals(fromXlsx[0].join('|'), fromCsv[0].join('|'));
        equals(fromXlsx[1].join('|'), fromCsv[1].join('|'));
      },
    },

    {
      name: 'a header is matched however somebody has capitalised or spaced it',
      fn() {
        const i = headerIndex(['Position Title', 'reports_to', 'APPROVED  HEADCOUNT']);
        equals(i.get('positiontitle'), 0);
        equals(i.get('reportsto'), 1);
        equals(i.get('approvedheadcount'), 2);
      },
    },
  ],
};

export default suite;
