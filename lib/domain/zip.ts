import { inflateRawSync } from 'node:zlib';

/* ═════════════════════════════════════════════════════════════════════════════
   THE INSIDE OF A ZIP

   A .docx and a .xlsx are both ZIP archives full of XML, which is why a CV
   somebody exported from Word and a manpower plan somebody keeps in Excel can
   be read here without carrying two document libraries for two screens.

   Only what those two formats use is implemented: stored and deflated entries,
   read through the central directory rather than by walking local headers —
   because a local header written by a streaming writer may say the size is
   nought and leave it in a descriptor afterwards, and the central directory
   always has the real figures.

   What is deliberately not implemented is ZIP64 and encryption. Both are said
   out loud rather than guessed at: a plan or a CV big enough to need ZIP64 is
   not a plan or a CV, and an encrypted one cannot be read without the password
   nobody has given us.
   ═════════════════════════════════════════════════════════════════════════════*/

const EOCD = 0x06054b50;
const CEN = 0x02014b50;

const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) =>
  (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000;

export class ZipError extends Error {}

/** Where the end-of-central-directory record starts, or −1. */
function findEocd(b: Uint8Array): number {
  /* The record is 22 bytes plus a comment of at most 65535. */
  const from = Math.max(0, b.length - 22 - 0xffff);
  for (let p = b.length - 22; p >= from; p--) if (u32(b, p) === EOCD) return p;
  return -1;
}

/**
 * Every entry in the archive, by its path. Directory entries are left out.
 *
 * The whole archive is held in memory, which is the right trade for the two
 * things this reads: a résumé and a department's seats. Both are measured in
 * hundreds of kilobytes, and the upload limit is enforced before this is ever
 * called.
 */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new ZipError('That file is not a Word or Excel document — it is not a zip at all');

  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  if (count === 0xffff || p === 0xffffffff) {
    throw new ZipError('That file uses ZIP64, which cannot be read here');
  }

  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== CEN) {
      throw new ZipError('That archive’s index is damaged');
    }
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new ZipError('That file is password-protected, so it cannot be read');
    if (compSize === 0xffffffff || localOff === 0xffffffff) {
      throw new ZipError('That file uses ZIP64, which cannot be read here');
    }

    /* The local header again, because the data begins after its own copy of
       the name and of however much extra field the writer chose to put there. */
    if (localOff + 30 > bytes.length) throw new ZipError('That archive is truncated');
    const dataAt = localOff + 30 + u16(bytes, localOff + 26) + u16(bytes, localOff + 28);
    const raw = bytes.subarray(dataAt, dataAt + compSize);
    if (raw.length < compSize) throw new ZipError('That archive is truncated');

    if (method === 0) out.set(name, raw);
    else if (method === 8) {
      try {
        out.set(name, new Uint8Array(inflateRawSync(raw)));
      } catch {
        throw new ZipError(`${name} inside that file could not be decompressed`);
      }
    } else {
      throw new ZipError(`${name} is compressed in a way that cannot be read here`);
    }
  }
  return out;
}

/** One entry, as text. */
export function entryText(zip: Map<string, Uint8Array>, path: string): string | null {
  const b = zip.get(path);
  return b ? new TextDecoder('utf-8', { fatal: false }).decode(b) : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** XML text content, with the five entities and numeric references resolved. */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const n = Number.parseInt(ref.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (ref.startsWith('#')) {
      const n = Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}
