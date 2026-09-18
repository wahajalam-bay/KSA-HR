import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db/client';
import { upload, type FileKind } from '@/lib/services/files';
import { currentViewer } from '@/lib/auth/session';
import { require_, requireApplication, requireJob, type Capability } from '@/lib/authz';
import { ForbiddenError } from '@/lib/auth/session';
import { CommandError } from '@/lib/commands/registry';
import { env } from '@/lib/env';

/* ─────────────────────────────────────────────────────────────────────────────
   Taking a file in.

   The wells in the interface post to the command dispatcher — `cv.intake`,
   `cand.stageFile`, `mp.importFile`, `otpl.upload`, `emp.doc`, `staff.photo`
   and `resume.upload` in lib/commands/uploads.ts — because an upload that
   creates or changes a record is a write like any other, and there is one
   door for those.

   This route is the second entry point, for a body too large to want in a
   server action: a call recording, or a bulk load from a script. It creates
   nothing on its own. What it takes is decided by the same table the commands
   use, enforced by the same service, and the file it stores has to be attached
   to something by a command before anybody can read it back.

   Everything else is the same: the viewer is checked before the bytes are read,
   the capability is checked against what the file is for, and the record it
   hangs off is checked against the viewer's access scope — a recruiter cannot
   attach a CV to a requisition they cannot see.
   ───────────────────────────────────────────────────────────────────────────*/

export const dynamic = 'force-dynamic';

/** What each kind of upload needs, and what it hangs off. */
const RULES: Record<FileKind, { capability: Capability; owner: 'application' | 'candidate' | 'employee' | 'offer' | 'job' | 'staff' | 'org' }> = {
  cv: { capability: 'cv.upload', owner: 'candidate' },
  photo: { capability: 'candidate.edit', owner: 'candidate' },
  candidate_document: { capability: 'offer.document', owner: 'offer' },
  onboarding_document: { capability: 'onboarding.file', owner: 'employee' },
  offer_template: { capability: 'offer.template.manage', owner: 'org' },
  offer_letter: { capability: 'offer.edit', owner: 'offer' },
  signed_offer: { capability: 'offer.record_response', owner: 'offer' },
  recording: { capability: 'screening.call', owner: 'application' },
  transcript: { capability: 'screening.call', owner: 'application' },
  import: { capability: 'plan.import', owner: 'org' },
  export: { capability: 'data.export', owner: 'org' },
  other: { capability: 'settings.edit', owner: 'org' },
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: 'sign in first' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'that was not a file upload' }, { status: 400 });

  const kind = String(form.get('kind') ?? '') as FileKind;
  const rule = RULES[kind];
  if (!rule) return NextResponse.json({ error: 'that is not a kind of file' }, { status: 400 });

  const ownerId = String(form.get('ownerId') ?? '');
  if (!ownerId && rule.owner !== 'org') {
    return NextResponse.json({ error: 'that upload names no record' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file came with that' }, { status: 400 });
  }
  /* A cheap guard before the bytes are read into memory. */
  if (file.size > env().STORAGE_MAX_UPLOAD_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Keep it under ${env().STORAGE_MAX_UPLOAD_MB} MB` },
      { status: 413 },
    );
  }

  try {
    require_(viewer, rule.capability);
    /* Scope: the record it is being attached to has to be one they can reach. */
    if (rule.owner === 'application') await requireApplication(viewer, ownerId, db());
    if (rule.owner === 'job') await requireJob(viewer, ownerId, db());

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await db().transaction(async (tx) => upload({
      kind,
      ownerType: rule.owner,
      ownerId: ownerId || 'org',
      originalName: file.name || 'upload',
      contentType: file.type || 'application/octet-stream',
      bytes,
      supersedesId: String(form.get('supersedes') ?? '') || null,
      metadata: { uploadedFrom: request.headers.get('referer') ?? null },
    }, {
      viewer,
      requestId: crypto.randomUUID(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
      tx,
      now: new Date(),
    }));

    return NextResponse.json({
      fileId: result.fileId,
      version: result.version,
      scan: result.scanState,
      /* The interface says plainly when nothing scanned it. */
      note: result.scanState === 'skipped' ? result.scanNote : null,
    });
  } catch (e: unknown) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof CommandError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
}
