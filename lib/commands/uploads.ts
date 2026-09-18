import 'server-only';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  files, offerTemplates, candidates, staff, employees, onboardingDocuments,
} from '@/db/schema';
import { defineMany, CommandError, type CommandInput } from './registry';
import { str } from './fields';
import { requireJob, can } from '@/lib/authz';
import { upload } from '@/lib/services/files';
import { read, attach, textOfFile } from '@/lib/services/cv';
import { readPlanGrid } from '@/lib/services/manpower';
import { recordJoinerDocument } from '@/lib/services/joiner';
import { readGrid } from '@/lib/domain/sheet';
import { docxText, isDocx, DOCX_TYPE } from '@/lib/domain/docx';
import { mergeFields } from '@/lib/services/offer-letter';
import { audit } from '@/lib/audit';
import { rows as rowsOf } from '@/lib/queries/sql';

/* ═════════════════════════════════════════════════════════════════════════════
   TAKING FILES IN

   Four wells in the product accept a file, and all four come through here:

     · `cv.intake`     — CVs dropped on Candidates or on a requisition;
     · `cand.stageFile`— a résumé attached while somebody is being typed in;
     · `mp.importFile` — the spreadsheet a department head keeps;
     · `otpl.upload`   — the offer letter HR signs off on.

   A dropzone posts the bytes to the command dispatcher, which means an upload
   is a command like any other: the viewer is established, the capability is
   checked, the write happens in one transaction, and an audit event is left
   behind. lib/services/files.ts does the rest — the type is checked against
   the bytes rather than the name, the size against the kind, and the scanner
   against whatever is configured. When nothing is configured the file is
   marked `skipped` rather than clean, and every one of these commands says so
   out loud in the line it hands back.

   Nothing here creates a record on its own. A CV becomes a candidate when a
   person has looked at the reading; a spreadsheet becomes seats when somebody
   has seen the preview. An upload that reached storage and no further leaves a
   file row, an audit event, and nothing anybody has to undo.
   ═════════════════════════════════════════════════════════════════════════════*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

/** Where a staged intake file lives until it belongs to somebody. */
export const INTAKE_OWNER = { ownerType: 'org' as const, ownerId: 'intake' };

/** The files that came with the post, refused politely when there are none. */
function taken(raw: CommandInput, what: string, max = 10): File[] {
  const list = (raw.files ?? []).filter((f) => f && f.size > 0);
  if (!list.length) throw new CommandError(`No ${what} came with that`);
  return list.slice(0, max);
}

const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer());

/* A browser that does not recognise an extension sends the empty type, and a
   Windows machine sometimes sends the wrong one. The name settles it, because
   lib/services/files.ts then checks the bytes against whatever we claim. */
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  html: 'text/html',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

function typeOf(f: File): string {
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  const byName = BY_EXTENSION[ext];
  if (byName) return byName;
  return f.type || 'application/octet-stream';
}

/** The sentence a command adds when nothing scanned the file. */
export function scanNote(state: string, note: string | null): string {
  if (state === 'skipped') return ' — not scanned: no malware scanner is configured';
  if (state === 'error') return ` — the scan failed${note ? ` (${note})` : ''}`;
  return '';
}

defineMany({
  /* ── CVs, in from anywhere ─────────────────────────────────────────────── */
  /* Several at once is the common case: somebody has a folder from an agency.
     Each is stored and read, and the review panel opens on the first — the
     rest wait in the same place, which is the files table, so a browser that
     is closed halfway through has lost nothing. */
  'cv.intake': {
    capability: 'cv.upload',
    schema: base,
    async run({ v, fields }, ctx, raw) {
      const jobId = v || str(fields, 'jobId') || null;
      if (jobId) await requireJob(ctx.viewer, jobId, ctx.tx);

      const list = taken(raw, 'CV');
      const made: Array<{ fileId: string; name: string; scan: string; note: string | null }> = [];
      const refused: string[] = [];

      for (const f of list) {
        const bytes = await bytesOf(f);
        try {
          const r = await upload({
            kind: 'cv',
            ...INTAKE_OWNER,
            originalName: f.name || 'cv',
            contentType: typeOf(f),
            bytes,
            metadata: { staged: true, jobId },
          }, ctx);

          /* Read it while the transaction is open, and keep the reading on the
             file: the panel that shows it is a server component and must not
             write, and a reading nobody kept would be done again on every
             re-render. */
          const { text } = await textOfFile(r.fileId, ctx.tx);
          const intake = await read({ fileId: r.fileId, text, jobId }, ctx);
          await ctx.tx.update(files).set({
            metadata: {
              staged: true,
              jobId,
              parsed: intake.parsed as unknown as Record<string, unknown>,
              readBy: intake.readBy,
              aiNote: intake.aiNote,
              duplicate: intake.duplicate,
              fit: intake.fit,
              words: text.split(/\s+/).filter(Boolean).length,
            },
          }).where(eq(files.id, r.fileId));

          made.push({ fileId: r.fileId, name: f.name, scan: r.scanState, note: r.scanNote });
        } catch (e) {
          refused.push(`${f.name}: ${e instanceof CommandError ? e.message : 'could not be read'}`);
        }
      }

      if (!made.length) {
        throw new CommandError(refused.join('\n') || 'None of those could be taken in');
      }

      const first = made[0];
      const unscanned = made.some((m) => m.scan !== 'clean');
      return {
        toast: made.length === 1
          ? `${first.name} read${scanNote(first.scan, first.note)}`
          : `${made.length} CVs read${refused.length ? `, ${refused.length} refused` : ''}`
            + (unscanned ? ' — nothing scanned them' : ''),
        tone: refused.length || unscanned ? 'warn' : undefined,
        icon: 'spark',
        ms: refused.length ? 6000 : 3600,
        openSheet: { act: 'cv.review', v: `${first.fileId}${jobId ? `|${jobId}` : ''}` },
        data: { fileIds: made.map((m) => m.fileId), refused },
      };
    },
  },

  /* ── A résumé attached while somebody is being typed in ────────────────── */
  /* The prototype held this file in a browser variable until the form was
     saved, which meant a refresh lost it and nothing on the server knew it
     existed. Here it is stored and scanned straight away, and the panel
     re-renders carrying its id — so what is attached on save is a file the
     product can already account for. */
  'cand.stageFile': {
    capability: 'cv.upload',
    schema: base,
    async run({ v, fields }, ctx, raw) {
      const jobId = str(fields, 'jobId') || v || null;
      const [f] = taken(raw, 'résumé', 1);
      const r = await upload({
        kind: 'cv',
        ...INTAKE_OWNER,
        originalName: f.name || 'cv',
        contentType: typeOf(f),
        bytes: await bytesOf(f),
        metadata: { staged: true, jobId, forForm: true },
      }, ctx);

      return {
        refresh: false,
        toast: `${f.name} attached — it is read into the profile when you save`
          + scanNote(r.scanState, r.scanNote),
        tone: r.scanState === 'clean' ? undefined : 'warn',
        icon: 'file',
        ms: 4200,
        /* The panel is drawn again with the file on it, keeping everything
           already typed: openSheet carries the fields of the sheet it
           replaces. */
        openSheet: { act: 'cand.new', v: `${jobId ?? ''}|${r.fileId}`, replace: true },
        data: { fileId: r.fileId },
      };
    },
  },

  /* ── The department spreadsheet ────────────────────────────────────────── */
  /* Read, never written. What comes back is the preview, and a person confirms
     one department at a time — `mp.importCreate` is what writes. */
  'mp.importFile': {
    capability: 'plan.import',
    schema: base,
    async run(_i, ctx, raw) {
      if (!ctx.viewer.isAdmin) throw new CommandError('Only an Admin can import a department');
      const [f] = taken(raw, 'spreadsheet', 1);
      const bytes = await bytesOf(f);

      /* Read it before it is stored, so a file that is not a plan is refused
         with the reason rather than kept as evidence of a failed import. */
      let grid;
      try {
        grid = readGrid(f.name, typeOf(f), bytes);
      } catch (e) {
        throw new CommandError(e instanceof Error ? e.message : 'That file could not be read');
      }
      const plan = readPlanGrid(grid);

      const r = await upload({
        kind: 'import',
        ownerType: 'org', ownerId: 'plan',
        originalName: f.name || 'plan.csv',
        contentType: typeOf(f),
        bytes,
        metadata: {
          departments: plan.departments.map((d) => ({ name: d.name, seats: d.rows.length })),
          rows: plan.rows,
          dropped: plan.dropped,
        },
      }, ctx);

      const seats = plan.departments.reduce((n, d) => n + d.rows.length, 0);
      return {
        refresh: false,
        toast: `${f.name} read — ${seats} seat${seats === 1 ? '' : 's'} in `
          + `${plan.departments.length} department${plan.departments.length === 1 ? '' : 's'}`
          + (plan.dropped.length ? `, ${plan.dropped.length} row${plan.dropped.length === 1 ? '' : 's'} left out` : '')
          + scanNote(r.scanState, r.scanNote),
        tone: plan.dropped.length ? 'warn' : undefined,
        icon: 'upload',
        ms: 5000,
        openSheet: { act: 'mp.importPreview', v: r.fileId, replace: true },
        data: { fileId: r.fileId },
      };
    },
  },

  /* ── The offer letter ──────────────────────────────────────────────────── */
  /* The template is a fixed document, and what makes it a template is the
     merge fields in it. Those are found on upload and shown back, because a
     letter whose fields are misspelt fills with nothing and the person who
     notices is the candidate. */
  'otpl.upload': {
    capability: 'offer.template.manage',
    schema: base,
    async run({ v, fields }, ctx, raw) {
      const [f] = taken(raw, 'template', 1);
      const contentType = typeOf(f);
      const bytes = await bytesOf(f);

      /* The body is what the merge is done against, so a format whose text
         cannot be read here cannot be a template. A PDF is a fixed rendering:
         its fields cannot be filled without a PDF writer the product does not
         carry, and pretending otherwise would send a letter full of braces. */
      let body: string;
      if (isDocx(contentType, f.name)) {
        body = docxText(bytes);
        if (!body.trim()) {
          throw new CommandError('That Word document has no text in it to fill');
        }
      } else if (contentType === 'text/plain' || contentType === 'text/html') {
        body = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } else {
        throw new CommandError(
          'An offer letter template has to be a Word document, HTML, Markdown or plain text — '
          + 'a PDF is a finished rendering and its fields cannot be filled',
        );
      }

      /* A .md is plain text as far as everything downstream is concerned. */
      const letterType = isDocx(contentType, f.name) ? DOCX_TYPE : contentType;

      const found = mergeFields(body);
      const supersedes = v || str(fields, 'supersedes') || null;
      const [old] = supersedes
        ? await ctx.tx.select().from(offerTemplates).where(eq(offerTemplates.id, supersedes)).limit(1)
        : [];
      if (supersedes && !old) throw new CommandError('That template is no longer here');

      const stored = await upload({
        kind: 'offer_template',
        ownerType: 'org', ownerId: 'offers',
        originalName: f.name || 'offer-letter',
        contentType: letterType,
        bytes,
        supersedesId: old?.fileId ?? null,
        metadata: { mergeFields: found },
      }, ctx);

      const name = str(fields, 'name')
        || old?.name
        || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
        || 'Offer letter';

      if (old) {
        await ctx.tx.update(offerTemplates).set({
          name,
          body,
          fileId: stored.fileId,
          fileName: f.name,
          fileType: letterType,
          sizeKb: Math.max(1, Math.round(bytes.byteLength / 1024)),
          detectedFields: found,
          version: old.version + 1,
          uploadedBy: ctx.viewer.staffId ?? null,
          uploadedAt: ctx.now,
        }).where(eq(offerTemplates.id, old.id));

        await audit(ctx, {
          action: 'update',
          summary: `uploaded a new version of the ${name} template`,
          entityType: 'offer_template', entityId: old.id, entityLabel: name,
          before: { version: old.version, file: old.fileName, fields: mergeFields(old.body ?? '').length },
          after: { version: old.version + 1, file: f.name, fields: found.length },
        }, ctx.tx);

        return {
          toast: `${name} replaced — v${old.version + 1}, ${found.length} merge field`
            + `${found.length === 1 ? '' : 's'}${scanNote(stored.scanState, stored.scanNote)}`,
          tone: stored.scanState === 'clean' ? undefined : 'warn',
          icon: 'file',
          ms: 4600,
          openSheet: { act: 'otpl.open', v: old.id },
        };
      }

      /* The first template uploaded is the default, because an offer drafted
         before anybody has chosen one has to have something to fill. */
      const [{ n }] = rowsOf(await ctx.tx.execute(sql`
        SELECT count(*)::int AS n FROM ${offerTemplates} WHERE archived_at IS NULL`)) as
        Array<{ n: number }>;

      const id = `otp_${crypto.randomUUID().slice(0, 12)}`;
      await ctx.tx.insert(offerTemplates).values({
        id,
        name,
        body,
        fileId: stored.fileId,
        fileName: f.name,
        fileType: letterType,
        sizeKb: Math.max(1, Math.round(bytes.byteLength / 1024)),
        detectedFields: found,
        lang: /[؀-ۿ]/.test(body) ? 'en+ar' : 'en',
        isDefault: Number(n) === 0,
        version: 1,
        uploadedBy: ctx.viewer.staffId ?? null,
        uploadedAt: ctx.now,
      });

      await audit(ctx, {
        action: 'create',
        summary: `uploaded the offer letter template "${name}"`,
        entityType: 'offer_template', entityId: id, entityLabel: name,
        after: { file: f.name, fields: found.length, isDefault: Number(n) === 0 },
      }, ctx.tx);

      return {
        toast: `${name} uploaded — ${found.length} merge field${found.length === 1 ? '' : 's'} found`
          + scanNote(stored.scanState, stored.scanNote),
        tone: stored.scanState === 'clean' ? undefined : 'warn',
        icon: 'file',
        ms: 4600,
        openSheet: { act: 'otpl.open', v: id },
        data: { templateId: id, mergeFields: found },
      };
    },
  },

  /* ── A better CV for somebody already on file ──────────────────── */
  /* The panel’s own well. The new file supersedes the old one rather than
     replacing it — the earlier résumé stays readable, because "what did their
     CV say when we hired them" is a question somebody asks a year later. */
  'resume.upload': {
    capability: 'cv.upload',
    schema: base,
    async run({ v, fields, arg }, ctx, raw) {
      const candidateId = v || arg || str(fields, 'candidateId');
      if (!candidateId) throw new CommandError('Whose résumé is it?');
      const [c] = await ctx.tx.select({ id: candidates.id, name: candidates.name })
        .from(candidates).where(eq(candidates.id, candidateId)).limit(1);
      if (!c) throw new CommandError('That candidate is no longer on file');

      const [current] = rowsOf(await ctx.tx.execute(sql`
        SELECT file_id AS "fileId" FROM candidate_resumes
         WHERE candidate_id = ${candidateId} AND is_current LIMIT 1`)) as
        Array<{ fileId: string | null }>;

      const [f] = taken(raw, 'résumé', 1);
      const stored = await upload({
        kind: 'cv',
        ownerType: 'candidate', ownerId: candidateId,
        originalName: f.name || 'cv',
        contentType: typeOf(f),
        bytes: await bytesOf(f),
        supersedesId: current?.fileId ?? null,
      }, ctx);

      const { text } = await textOfFile(stored.fileId, ctx.tx);
      const intake = await read({ fileId: stored.fileId, text }, ctx);
      await attach({
        candidateId,
        fileId: stored.fileId,
        fileName: f.name,
        text,
        parsed: intake.parsed,
        readBy: intake.readBy,
      }, ctx);

      return {
        toast: intake.parsed.hasTextLayer
          ? `${c.name}’s résumé replaced — read with `
            + `${Math.round(intake.parsed.confidence * 100)}% confidence`
            + scanNote(stored.scanState, stored.scanNote)
          : `${c.name}’s résumé replaced — it is a scan, so there was nothing to read`
            + scanNote(stored.scanState, stored.scanNote),
        tone: intake.parsed.hasTextLayer && stored.scanState === 'clean' ? undefined : 'warn',
        icon: 'file',
        ms: 4600,
      };
    },
  },

  /* ── A colleague’s photograph ───────────────────────────────── */
  /* Anybody may change their own; changing somebody else’s is the team
     manager’s. The check is here rather than in the button, because a button
     is a suggestion. */
  'staff.photo': {
    capability: null,
    schema: base,
    async run({ v, arg }, ctx, raw) {
      const staffId = v || arg || '';
      if (!staffId) throw new CommandError('Whose photograph is it?');
      const mine = staffId === (ctx.viewer.actingAsStaffId ?? ctx.viewer.staffId);
      if (!mine && !can(ctx.viewer, 'team.manage')) {
        throw new CommandError('Only you or the team manager can change your photograph');
      }

      const [p] = await ctx.tx.select().from(staff).where(eq(staff.id, staffId)).limit(1);
      if (!p) throw new CommandError('That colleague is not on the team');

      const [f] = taken(raw, 'photograph', 1);
      const stored = await upload({
        kind: 'photo',
        ownerType: 'staff', ownerId: staffId,
        originalName: f.name || 'photo',
        contentType: typeOf(f),
        bytes: await bytesOf(f),
        supersedesId: p.photoFileId,
      }, ctx);

      await ctx.tx.update(staff)
        .set({ photo: 'upload', photoFileId: stored.fileId, updatedAt: ctx.now })
        .where(eq(staff.id, staffId));

      await audit(ctx, {
        action: 'update',
        summary: mine ? 'changed their photograph' : `changed ${p.name}’s photograph`,
        entityType: 'staff', entityId: staffId, entityLabel: p.name,
        before: { photo: p.photo, fileId: p.photoFileId },
        after: { photo: 'upload', fileId: stored.fileId },
      }, ctx.tx);

      return {
        toast: `Photograph updated${scanNote(stored.scanState, stored.scanNote)}`,
        tone: stored.scanState === 'clean' ? undefined : 'warn',
        icon: 'check',
      };
    },
  },

  /* ── A joiner’s paperwork ─────────────────────────────────── */
  /* `emp.doc:<employee>:<document>`. The file lands, the checklist row moves to
     received, and somebody still has to verify it — an uploaded document is
     not a verified one, which is the whole point of the two states. */
  'emp.doc': {
    capability: 'onboarding.file',
    schema: base,
    async run({ v, arg }, ctx, raw) {
      const [employeeId, key] = (arg || v).split(':');
      if (!employeeId || !key) throw new CommandError('That document was not understood');

      const [emp] = await ctx.tx.select({ id: employees.id, name: employees.name })
        .from(employees).where(eq(employees.id, employeeId)).limit(1);
      if (!emp) throw new CommandError('That joiner is no longer on file');

      const [existing] = await ctx.tx.select().from(onboardingDocuments).where(and(
        eq(onboardingDocuments.employeeId, employeeId), eq(onboardingDocuments.key, key),
      )).limit(1);

      const [f] = taken(raw, 'document', 1);
      const stored = await upload({
        kind: 'onboarding_document',
        ownerType: 'employee', ownerId: employeeId,
        originalName: f.name || key,
        contentType: typeOf(f),
        bytes: await bytesOf(f),
        supersedesId: existing?.fileId ?? null,
        metadata: { document: key },
      }, ctx);

      const r = await recordJoinerDocument({
        employeeId, key, fileId: stored.fileId,
      }, ctx);

      return {
        toast: `${r.label} received${scanNote(stored.scanState, stored.scanNote)}`
          + (r.left ? ` — ${r.left} still to verify` : ''),
        tone: stored.scanState === 'clean' ? undefined : 'warn',
        icon: 'upload',
        ms: 4200,
      };
    },
  },

  /* ── Letting a staged CV go ────────────────────────────────────────────── */
  /* The review panel's "not this one" button. The file is removed rather than
     left in the queue for ever, and the trail says who dropped it. */
  'cv.drop': {
    capability: 'cv.upload',
    schema: base,
    async run({ v }, ctx) {
      const [f] = await ctx.tx.select().from(files).where(eq(files.id, v)).limit(1);
      if (!f) throw new CommandError('That file is already gone');
      if (f.ownerType !== INTAKE_OWNER.ownerType || f.ownerId !== INTAKE_OWNER.ownerId) {
        throw new CommandError('That CV already belongs to somebody — remove it from their record');
      }
      await ctx.tx.update(files)
        .set({ deletedAt: ctx.now, deletedBy: ctx.viewer.staffId ?? ctx.viewer.accountId ?? null })
        .where(eq(files.id, v));
      await audit(ctx, {
        action: 'delete',
        summary: `discarded the CV ${f.originalName} without creating anybody`,
        entityType: 'file', entityId: v, entityLabel: f.originalName,
      }, ctx.tx);

      const next = await nextStaged(ctx.viewer.staffId ?? ctx.viewer.accountId ?? '', ctx.tx);
      return {
        toast: `${f.originalName} discarded`,
        icon: 'trash',
        closeSheet: next ? undefined : 'all',
        openSheet: next ? { act: 'cv.review', v: next, replace: true } : undefined,
      };
    },
  },
});

/** The next CV this person uploaded and has not yet dealt with. */
export async function nextStaged(who: string, exec: Exec): Promise<string | null> {
  const [row] = rowsOf(await exec.execute(sql`
    SELECT f.id
      FROM ${files} f
     WHERE f.kind = 'cv'
       AND f.owner_type = ${INTAKE_OWNER.ownerType}
       AND f.owner_id = ${INTAKE_OWNER.ownerId}
       AND f.deleted_at IS NULL
       AND coalesce(f.uploaded_by, '') = ${who}
       AND coalesce(f.metadata ->> 'forForm', '') <> 'true'
       AND NOT EXISTS (SELECT 1 FROM candidate_resumes r WHERE r.file_id = f.id)
     ORDER BY f.uploaded_at
     LIMIT 1`)) as Array<{ id: string }>;
  return row?.id ?? null;
}
