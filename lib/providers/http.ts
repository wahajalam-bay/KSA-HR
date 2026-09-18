import 'server-only';
import crypto from 'node:crypto';
import { failed, type Failed, type Result } from './types';

/* ═════════════════════════════════════════════════════════════════════════════
   TALKING TO SOMEBODY ELSE'S SERVER

   One place that makes an HTTP call, so every adapter times out the same way,
   reads a failure the same way, and never logs a credential.

   The retryable/not-retryable split is the one that matters to the worker: a
   429 or a 503 will work later and the job goes back on the queue; a 400 means
   the request was wrong and trying it again a hundred times only makes the
   provider angry.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Call = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  /** Sent raw rather than as JSON — a form post, an XML body. */
  raw?: string | Uint8Array;
  timeoutMs?: number;
  /** What to call it in a failure message: "SendGrid", "DocuSign". */
  label: string;
};

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export async function call<T = unknown>(input: Call): Promise<Result<{ status: number; data: T }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20_000);
  try {
    const headers: Record<string, string> = { ...input.headers };
    let body: BodyInit | undefined;
    if (input.raw !== undefined) {
      body = input.raw as BodyInit;
    } else if (input.body !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(input.body);
    }

    const res = await fetch(input.url, {
      method: input.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown = text;
    if (text && (res.headers.get('content-type') ?? '').includes('json')) {
      try { data = JSON.parse(text); } catch { /* keep the text */ }
    }

    if (!res.ok) {
      return failed(
        `${input.label} returned ${res.status}`,
        { retryable: RETRYABLE.has(res.status), status: res.status, detail: trim(data) },
      );
    }
    return { ok: true, externalId: null, detail: { status: res.status, data: data as T } };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const aborted = message.includes('abort');
    return failed(
      aborted ? `${input.label} did not answer in time` : `${input.label} could not be reached: ${message}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Keep a failure readable in the queue without carrying a whole page of HTML. */
const trim = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  return data.length > 500 ? `${data.slice(0, 500)}…` : data;
};

/** Basic auth, without writing the credential anywhere but the header. */
export const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/**
 * Compare two signatures without leaking how much of one matched. Every webhook
 * verifier goes through this rather than using `===`.
 */
export function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function hmacHex(secret: string, payload: string, algo = 'sha256'): string {
  return crypto.createHmac(algo, secret).update(payload).digest('hex');
}

export function hmacBase64(secret: string, payload: string, algo = 'sha256'): string {
  return crypto.createHmac(algo, secret).update(payload).digest('base64');
}

/** A `Failed` for something the adapter itself refuses before any call. */
export const refuse = (message: string): Failed =>
  failed(message, { retryable: false });
