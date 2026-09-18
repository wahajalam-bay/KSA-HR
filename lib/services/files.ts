import 'server-only';
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import { files, fileAccessLog, applications, candidates, employees, offers, jobs } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { env } from '@/lib/env';
import { storageAdapter, scannerAdapter } from '@/lib/providers';
import { requireApplication, requireJob, can } from '@/lib/authz';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   FILES

   A CV, a photograph, an offer letter, a signed copy, an iqama scan, a bank
   letter, a call recording. Four rules, and all four are enforced here rather
   than by the page that happens to show an upload box:

     · what may be uploaded is a short list of types and a size limit, checked
       against the bytes rather than against the name;
     · every file is scanned before anybody can download it. If no scanner is
       configured the file is marked `skipped`, never `clean`, and the interface
       says so — a product that reports an unscanned file as safe is worse than
       one with no scanner at all;
     · who may read a file is decided by what it hangs off. A CV belongs to an
       application, so the application's access scope decides;
     · a file is superseded rather than overwritten, and deleted on a schedule
       rather than when somebody remembers.
   ═════════════════════════════════════════════════════════════════════════════*/

export type FileKind =
  | 'cv' | 'photo' | 'offer_template' | 'offer_letter' | 'signed_offer'
  | 'candidate_document' | 'onboarding_document' | 'recording' | 'transcript'
  | 'import' | 'export' | 'other';

/* What each kind is allowed to be. A CV is a document; a photograph is an
   image; a recording is audio. Anything else is refused by type, not by
   extension, because an extension is whatever somebody typed. */
const ALLOWED: Record<FileKind, string[]> = {
  cv: ['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  /* A template is filled in, so its text has to be readable: a Word document,
     HTML, Markdown or plain text. A PDF is a finished rendering and is refused
     with the reason rather than accepted and then found to be unfillable. */
  offer_template: ['application/msword', 'text/plain', 'text/html',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  offer_letter: ['application/pdf'],
  signed_offer: ['application/pdf'],
  candidate_document: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  onboarding_document: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  recording: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg'],
  transcript: ['text/plain', 'text/vtt', 'application/json'],
  import: ['text/csv', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  export: ['text/csv', 'application/json', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  other: ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'],
};

/* Smaller limits where a bigger file means somebody has attached the wrong
   thing: nobody needs an eight-megabyte passport photograph. */
const LIMIT_MB: Partial<Record<FileKind, number>> = {
  photo: 5, candidate_document: 8, onboarding_document: 8, cv: 10, recording: 100,
};

/** What the first bytes say the file is, which is harder to lie about. */
export function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  /* A .docx and a .xlsx are both zips; the caller's declared type decides
     between them, which is why this returns the container rather than a guess. */
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) return 'application/zip';
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  return null;
}

const ZIP_BACKED = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export type UploadInput = {
  kind: FileKind;
  ownerType: 'application' | 'candidate' | 'employee' | 'offer' | 'job' | 'staff' | 'org';
  ownerId: string;
  originalName: string;
  contentType: string;
  bytes: Uint8Array;
  /** Replaces an earlier file of the same kind on the same owner. */
  supersedesId?: string | null;
  metadata?: Record<string, unknown>;
  retainUntil?: Date | null;
};

export type Uploaded = {
  fileId: string;
  scanState: 'pending' | 'clean' | 'infected' | 'skipped' | 'error';
  scanNote: string | null;
  version: number;
};

/**
 * Take a file in: check it, store it, scan it, record it. The scan happens
 * before the row is readable, so there is no window in which an infected file
 * can be downloaded.
 */
export async function upload(
  input: UploadInput, ctx: Ctx & { tx: Exec; now: Date },
): Promise<Uploaded> {
  const e = env();
  const allowed = ALLOWED[input.kind] ?? ALLOWED.other;
  if (!allowed.includes(input.contentType)) {
    throw new CommandError(
      `A ${input.kind.replace(/_/g, ' ')} has to be ${describe(allowed)} — that one is ${input.contentType}`,
    );
  }

  const maxMb = LIMIT_MB[input.kind] ?? e.STORAGE_MAX_UPLOAD_MB;
  if (input.bytes.byteLength > maxMb * 1024 * 1024) {
    throw new CommandError(`Keep it under ${maxMb} MB — that one is ${Math.ceil(input.bytes.byteLength / 1024 / 1024)} MB`);
  }
  if (!input.bytes.byteLength) throw new CommandError('That file is empty');

  /* What it says it is, against what it looks like. */
  const looks = sniff(input.bytes);
  if (looks && looks !== input.contentType) {
    const excused = looks === 'application/zip' && ZIP_BACKED.has(input.contentType);
    if (!excused) {
      throw new CommandError(
        `That file says it is ${input.contentType} but its contents are ${looks}`,
      );
    }
  }

  const sha = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const fileId = `fil_${crypto.randomUUID().slice(0, 12)}`;
  /* The key says nothing about who the file belongs to. */
  const storageKey = `${input.kind}/${ctx.now.getUTCFullYear()}/${fileId}`;

  const store = storageAdapter();
  const put = await store.put({
    key: storageKey, bytes: input.bytes, contentType: input.contentType,
  });
  if (!put.ok) {
    throw new CommandError(
      put.reason === 'not_configured'
        ? put.message
        : `The file could not be stored: ${put.message}`,
    );
  }

  /* Scan before it is readable. */
  const scanner = scannerAdapter();
  const scan = await scanner.scan(input.bytes);
  let scanState: Uploaded['scanState'];
  let scanNote: string | null = null;
  if (scan.ok) {
    const verdict = scan.detail?.verdict ?? 'unknown';
    scanState = verdict === 'clean' ? 'clean' : verdict === 'infected' ? 'infected' : 'error';
    scanNote = scan.detail?.signature ?? null;
  } else if (scan.reason === 'not_configured') {
    /* Not clean. Not scanned. */
    scanState = 'skipped';
    scanNote = scan.message;
  } else {
    scanState = 'error';
    scanNote = scan.message;
  }

  if (scanState === 'infected') {
    await store.delete(storageKey);
    await audit(ctx, {
      action: 'action',
      summary: `refused an infected upload (${input.originalName})`,
      entityType: 'file', entityId: fileId, entityLabel: input.originalName,
      after: { scan: 'infected', signature: scanNote, owner: `${input.ownerType}:${input.ownerId}` },
    }, ctx.tx);
    throw new CommandError(
      `${input.originalName} is infected${scanNote ? ` (${scanNote})` : ''} and has not been kept`,
    );
  }

  let version = 1;
  if (input.supersedesId) {
    const [old] = await ctx.tx.select().from(files)
      .where(eq(files.id, input.supersedesId)).limit(1);
    if (old) version = old.version + 1;
  }

  await ctx.tx.insert(files).values({
    id: fileId,
    kind: input.kind,
    storageKey,
    storageDriver: e.STORAGE_DRIVER,
    originalName: input.originalName.slice(0, 250),
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
    sha256: sha,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    supersedesId: input.supersedesId ?? null,
    version,
    scanState,
    scanResult: scanNote,
    scannedAt: scanState === 'skipped' ? null : ctx.now,
    uploadedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null,
    uploadedAt: ctx.now,
    retainUntil: input.retainUntil ?? retentionFor(input.kind, ctx.now),
    metadata: input.metadata ?? {},
  });

  await audit(ctx, {
    action: 'create',
    summary: `uploaded ${input.originalName}`,
    entityType: 'file', entityId: fileId, entityLabel: input.originalName,
    after: {
      kind: input.kind,
      owner: `${input.ownerType}:${input.ownerId}`,
      size: input.bytes.byteLength,
      scan: scanState,
    },
  }, ctx.tx);

  return { fileId, scanState, scanNote, version };
}

function retentionFor(kind: FileKind, now: Date): Date | null {
  const e = env();
  if (kind === 'recording') {
    return new Date(now.getTime() + e.RECORDING_RETENTION_DAYS * 86_400_000);
  }
  if (kind === 'cv' || kind === 'candidate_document' || kind === 'photo') {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() + e.CANDIDATE_RETENTION_MONTHS);
    return d;
  }
  /* An offer letter, a signed copy and an employee document are kept for as
     long as the employment record is. Those are deleted by decision, not by a
     clock. */
  return null;
}

const describe = (types: string[]): string => {
  const names = types.map((t) => (
    t === 'application/pdf' ? 'a PDF'
      : t.startsWith('image/') ? 'an image'
        : t.startsWith('audio/') ? 'an audio file'
          : t.includes('wordprocessing') || t === 'application/msword' ? 'a Word document'
            : t.includes('spreadsheet') || t === 'application/vnd.ms-excel' ? 'a spreadsheet'
              : t === 'text/csv' ? 'a CSV'
                : 'a text file'
  ));
  const unique = [...new Set(names)];
  return unique.length > 1
    ? `${unique.slice(0, -1).join(', ')} or ${unique[unique.length - 1]}`
    : unique[0];
};

/* ── Reading one ─────────────────────────────────────────────────────────── */

export type Readable =
  | { ok: true; file: typeof files.$inferSelect }
  | { ok: false; why: 'missing' | 'deleted' | 'unscanned' | 'infected' | 'forbidden'; message: string };

/**
 * Whether this viewer may read this file, and whether the file is safe to hand
 * over. Both questions, in one place, so no route can answer only one of them.
 */
export async function readable(
  fileId: string, viewer: Viewer, exec: Exec,
): Promise<Readable> {
  const [f] = await exec.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f) return { ok: false, why: 'missing', message: 'That file does not exist' };
  if (f.deletedAt) return { ok: false, why: 'deleted', message: 'That file has been deleted' };

  if (f.scanState === 'infected') {
    return { ok: false, why: 'infected', message: 'That file was found to be infected' };
  }
  if (f.scanState === 'pending') {
    return { ok: false, why: 'unscanned', message: 'That file has not been scanned yet' };
  }

  const allowed = await mayRead(f, viewer, exec);
  if (!allowed) {
    return { ok: false, why: 'forbidden', message: 'That file is not yours to open' };
  }
  return { ok: true, file: f };
}

async function mayRead(
  f: typeof files.$inferSelect, viewer: Viewer, exec: Exec,
): Promise<boolean> {
  if (viewer.isAdmin) return true;

  switch (f.ownerType) {
    case 'application':
      return scoped(() => requireApplication(viewer, f.ownerId, exec));
    case 'job':
      return scoped(() => requireJob(viewer, f.ownerId, exec));
    case 'offer': {
      const [o] = await exec.select({ applicationId: offers.applicationId }).from(offers)
        .where(eq(offers.id, f.ownerId)).limit(1);
      if (!o) return false;
      return scoped(() => requireApplication(viewer, o.applicationId, exec));
    }
    case 'candidate': {
      /* A candidate's file is readable by anybody who can reach one of their
         applications. A candidate with no application is visible to the desk. */
      const apps = await exec.select({ id: applications.id }).from(applications)
        .where(eq(applications.candidateId, f.ownerId));
      if (!apps.length) return can(viewer, 'candidate.view') && !viewer.isPortal;
      for (const a of apps) {
        if (await scoped(() => requireApplication(viewer, a.id, exec))) return true;
      }
      return false;
    }
    case 'employee': {
      /* An employee file is the onboarding desk's, not the pipeline's. */
      return can(viewer, 'onboarding.view') && !viewer.isPortal;
    }
    case 'staff':
      return f.ownerId === viewer.staffId || can(viewer, 'team.manage');
    case 'org':
      return can(viewer, 'settings.view');
    default:
      return false;
  }
}

const scoped = async (check: () => Promise<unknown>): Promise<boolean> => {
  try { await check(); return true; } catch { return false; }
};

/** A URL that works for a few minutes, after the viewer has been checked. */
export async function signedUrlFor(
  fileId: string, viewer: Viewer, exec: Exec, seconds = 300,
): Promise<{ url: string; expiresAt: string; name: string } | Readable> {
  const r = await readable(fileId, viewer, exec);
  if (!r.ok) return r;
  const signed = await storageAdapter().signedUrl(r.file.storageKey, seconds);
  if (!signed.ok) {
    return { ok: false, why: 'missing', message: signed.message };
  }
  return {
    url: signed.detail!.url,
    expiresAt: signed.detail!.expiresAt,
    name: r.file.originalName,
  };
}

/** Every download is recorded. A CV is somebody's personal data. */
export async function logAccess(
  input: { fileId: string; action: 'view' | 'download' | 'signed_url' },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<void> {
  await ctx.tx.insert(fileAccessLog).values({
    fileId: input.fileId,
    action: input.action,
    accountId: ctx.viewer.accountId ?? null,
    actorName: ctx.viewer.name,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    at: ctx.now,
  });
}

/** Delete a file: gone from the store, marked in the record. */
export async function remove(
  input: { fileId: string; reason?: string | null }, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ name: string }> {
  const [f] = await ctx.tx.select().from(files).where(eq(files.id, input.fileId)).limit(1);
  if (!f) throw new CommandError('That file does not exist');
  if (f.deletedAt) throw new CommandError('That file is already deleted', { tone: 'warn' });

  const gone = await storageAdapter().delete(f.storageKey);
  if (!gone.ok && gone.reason === 'failed') {
    throw new CommandError(`The file could not be removed from storage: ${gone.message}`);
  }

  await ctx.tx.update(files)
    .set({ deletedAt: ctx.now, deletedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null })
    .where(eq(files.id, input.fileId));

  await audit(ctx, {
    action: 'delete',
    summary: `deleted ${f.originalName}`,
    entityType: 'file', entityId: f.id, entityLabel: f.originalName,
    before: { kind: f.kind, owner: `${f.ownerType}:${f.ownerId}` },
    reason: input.reason ?? null,
  }, ctx.tx);

  return { name: f.originalName };
}

/** Files past their retention date — what the nightly sweep deletes. */
export async function expired(now: Date, exec: Exec, limit = 200) {
  return rowsOf(await exec.execute(sql`
    SELECT id, original_name, kind, storage_key FROM ${files}
     WHERE deleted_at IS NULL AND retain_until IS NOT NULL AND retain_until < ${now}
     ORDER BY retain_until
     LIMIT ${limit}`)) as Array<{
       id: string; original_name: string; kind: string; storage_key: string;
     }>;
}

/** Files that were stored while no scanner was configured. */
export async function unscanned(exec: Exec, limit = 200) {
  return rowsOf(await exec.execute(sql`
    SELECT id, original_name, storage_key FROM ${files}
     WHERE deleted_at IS NULL AND scan_state IN ('skipped','pending','error')
     ORDER BY uploaded_at
     LIMIT ${limit}`)) as Array<{ id: string; original_name: string; storage_key: string }>;
}

/** Re-scan a file — after a scanner is configured, or on a schedule. */
export async function rescan(
  fileId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ state: string; note: string | null }> {
  const [f] = await ctx.tx.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.deletedAt) throw new CommandError('That file does not exist');

  const got = await storageAdapter().get(f.storageKey);
  if (!got.ok) throw new CommandError(`That file could not be read back: ${got.message}`);

  const scan = await scannerAdapter().scan(got.detail!.bytes);
  let state: string;
  let note: string | null = null;
  if (scan.ok) {
    const verdict = scan.detail?.verdict ?? 'unknown';
    state = verdict === 'clean' ? 'clean' : verdict === 'infected' ? 'infected' : 'error';
    note = scan.detail?.signature ?? null;
  } else if (scan.reason === 'not_configured') {
    state = 'skipped';
    note = scan.message;
  } else {
    state = 'error';
    note = scan.message;
  }

  await ctx.tx.update(files).set({
    scanState: state as never,
    scanResult: note,
    scannedAt: state === 'skipped' ? null : ctx.now,
  }).where(eq(files.id, fileId));

  if (state === 'infected') {
    await storageAdapter().delete(f.storageKey);
    await ctx.tx.update(files)
      .set({ deletedAt: ctx.now, deletedBy: 'scanner' })
      .where(eq(files.id, fileId));
    await audit(ctx, {
      action: 'action',
      summary: `removed ${f.originalName} — the scanner found ${note ?? 'malware'}`,
      entityType: 'file', entityId: fileId, entityLabel: f.originalName,
      after: { scan: 'infected' },
      source: 'worker',
    }, ctx.tx);
  }

  return { state, note };
}
