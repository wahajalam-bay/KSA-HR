import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db/client';
import { receive } from '@/lib/services/webhooks';
import { env } from '@/lib/env';

/* ─────────────────────────────────────────────────────────────────────────────
   One route for every provider's callback.

   It is deliberately thin: read the body exactly as it arrived — the signature
   is over the raw bytes, so parsing first would make it unverifiable — hand it
   to the service, and answer.

   The answer is always 200 once the delivery has been stored. A provider that
   sees anything else retries, and retrying a callback we have already recorded
   only costs both sides work. The one exception is an unknown provider, which
   is a misconfiguration rather than a delivery.
   ───────────────────────────────────────────────────────────────────────────*/

const KNOWN = new Set([
  'docusign', 'esign', 'vapi', 'voice', 'whatsapp', 'sms', 'twilio',
  'sendgrid', 'email', 'assessment', 'hris',
]);

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;
  if (!KNOWN.has(provider)) {
    return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
  }

  const raw = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

  const now = new Date();
  const result = await db().transaction(async (tx) => receive(
    { provider, raw, headers },
    {
      viewer: {
        accountId: 'system', sessionId: 'webhook', name: `${provider} webhook`,
        email: null, title: null, role: 'staff', staffRole: null, staffId: null,
        roleLabel: 'Integration', hue: 1, photo: null,
        scope: { kind: 'all', jobIds: [], own: true }, isPortal: false, isAdmin: true,
      } as never,
      requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
      correlationId: provider,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
      tx,
      now,
    },
  ));

  /* A refused signature answers 401 so the provider's own dashboard shows the
     misconfiguration rather than a silent success. */
  if (!result.verified && !result.duplicate) {
    return NextResponse.json({ received: true, acted: false }, { status: 401 });
  }
  return NextResponse.json({
    received: true,
    duplicate: result.duplicate,
    result: result.result,
  });
}

/* Meta verifies a WhatsApp webhook with a GET before it will send anything. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse | Response> {
  const { provider } = await params;
  if (provider !== 'whatsapp') {
    return NextResponse.json({ error: 'not a verification endpoint' }, { status: 404 });
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  const want = env().WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && want && token === want) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'verification failed' }, { status: 403 });
}
