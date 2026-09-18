import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db/client';
import { search } from '@/lib/queries/search';
import { currentViewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   The command palette's box.

   Signed in, scoped, and short: the palette fires on every keystroke, so the
   query is capped and the answer is small. Nothing here is cached publicly —
   two people typing the same three letters are entitled to different answers.
   ───────────────────────────────────────────────────────────────────────────*/

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json([], { status: 401 });

  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 80);
  const hits = await search(viewer, q, 12, db());

  return NextResponse.json(hits, {
    headers: { 'cache-control': 'private, no-store' },
  });
}
