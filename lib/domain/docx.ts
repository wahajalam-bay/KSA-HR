import { unzip, entryText, unescapeXml, ZipError } from './zip';

/* ═════════════════════════════════════════════════════════════════════════════
   THE WORDS IN A WORD DOCUMENT

   Two things in the product arrive as .docx: a CV somebody exported from Word,
   and the offer letter HR keeps. Both are wanted for their text — the CV so it
   can be read, the letter so its merge fields can be found and its body shown
   before anybody sends it.

   WordprocessingML is verbose but the part that matters is small: paragraphs
   hold runs, runs hold `<w:t>` text, and a handful of elements are breaks. The
   formatting is deliberately dropped; what comes back is the reading order,
   which is what both callers want.
   ═════════════════════════════════════════════════════════════════════════════*/

export const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function isDocx(contentType: string, name = ''): boolean {
  return contentType === DOCX_TYPE || /\.docx$/i.test(name);
}

/**
 * The text of a .docx, in reading order.
 *
 * Paragraphs become newlines, tabs stay tabs, and a table cell is separated
 * from the next by a tab — so a two-column letter reads as two columns rather
 * than as one run-on sentence.
 */
export function docxText(bytes: Uint8Array): string {
  let xml: string | null = null;
  try {
    const zip = unzip(bytes);
    xml = entryText(zip, 'word/document.xml');
    if (!xml) {
      /* Some writers put the body somewhere else and point at it from the
         relationships part. The main document is the only one worth chasing. */
      for (const [path] of zip) {
        if (/^word\/document\d*\.xml$/.test(path)) { xml = entryText(zip, path); break; }
      }
    }
  } catch (e) {
    if (e instanceof ZipError) return '';
    throw e;
  }
  if (!xml) return '';
  return textOfBody(xml);
}

/** The same reading, from the XML of the body. Exported for the tests. */
export function textOfBody(xml: string): string {
  const out: string[] = [];
  /* One pass over the elements that carry text or break a line. Anything else
     — styles, bookmarks, revision marks — is skipped.

     A table cell is the one place where the usual rule is wrong: every cell
     holds a paragraph, and letting each of those break the line would put a
     two-column table down a single column. So paragraphs inside a cell are
     silent, the cell ends with a tab and the row ends with a newline. */
  let inCell = 0;
  const re = /<(w:t|w:tab|w:br|w:cr|\/w:p|w:tc|\/w:tc|\/w:tr)(\s[^>]*)?\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[1];
    if (tag === 'w:t') {
      /* `<w:t>` may be self-closing, in which case it holds nothing. */
      if (m[0].endsWith('/>')) continue;
      const close = xml.indexOf('</w:t>', re.lastIndex);
      if (close < 0) break;
      out.push(unescapeXml(xml.slice(re.lastIndex, close)));
      re.lastIndex = close + 6;
      continue;
    }
    if (tag === 'w:tab') out.push('\t');
    else if (tag === 'w:br' || tag === 'w:cr') out.push('\n');
    else if (tag === '/w:p') { if (!inCell) out.push('\n'); }
    else if (tag === 'w:tc') inCell += 1;
    else if (tag === '/w:tc') { inCell = Math.max(0, inCell - 1); out.push('\t'); }
    else if (tag === '/w:tr') out.push('\n');
  }
  return out.join('')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
