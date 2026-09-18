import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { files } from '@/db/schema';
import { storageAdapter, checkSignature } from '@/lib/providers';
import { readable, logAccess } from '@/lib/services/files';
import { currentViewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   Serving a file.

   Two ways in, and both end at the same check:

     · a signed URL, which the application minted for somebody it had already
       checked. The signature proves that, and expires;
     · a signed-in request, which is checked here against the record the file
       hangs off.

   Either way the download is recorded. A CV is somebody's personal data and
   "who has read this" is a question they are entitled to ask.
   ───────────────────────────────────────────────────────────────────────────*/

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse | Response> {
  const { key } = await params;
  const storageKey = decodeURIComponent(key);
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get('expires') ?? 0);
  const sig = url.searchParams.get('sig') ?? '';

  const [record] = await db().select().from(files)
    .where(eq(files.storageKey, storageKey)).limit(1);
  if (!record || record.deletedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  /* A signed link is its own authorisation — the application checked the
     person before it minted one. */
  const signed = sig ? checkSignature(storageKey, expires, sig) : false;

  let actorName = 'signed link';
  let accountId: string | null = null;
  if (!signed) {
    const viewer = await currentViewer();
    if (!viewer) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
    const allowed = await readable(record.id, viewer, db());
    if (!allowed.ok) {
      return NextResponse.json(
        { error: allowed.message },
        { status: allowed.why === 'forbidden' ? 403 : 409 },
      );
    }
    actorName = viewer.name;
    accountId = viewer.accountId;
  } else if (record.scanState === 'infected' || record.scanState === 'pending') {
    return NextResponse.json({ error: 'that file cannot be served' }, { status: 409 });
  }

  const got = await storageAdapter().get(storageKey);
  if (!got.ok) return NextResponse.json({ error: got.message }, { status: 502 });

  await db().transaction(async (tx) => {
    await logAccess({ fileId: record.id, action: signed ? 'signed_url' : 'download' }, {
      viewer: { accountId, name: actorName, staffId: null } as never,
      requestId: crypto.randomUUID(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
      tx,
      now: new Date(),
    });
  });

  const body = got.detail!.bytes;
  return new Response(body.slice().buffer as ArrayBuffer, {
    headers: {
      'content-type': got.detail!.contentType,
      'content-length': String(body.byteLength),
      'content-disposition':
        `${record.kind === 'photo' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(record.originalName)}"`,
      /* Never cached by a shared cache: the next viewer may not be allowed it. */
      'cache-control': 'private, max-age=60, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
