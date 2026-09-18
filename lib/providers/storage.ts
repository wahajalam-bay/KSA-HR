import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { env, providers } from '@/lib/env';
import { refuse } from './http';
import {
  notConfigured, sent, failed, type StorageAdapter, type ScannerAdapter,
  type ScanVerdict, type Status,
} from './types';

/* ═════════════════════════════════════════════════════════════════════════════
   WHERE THE FILES GO

   A CV, a photograph, an offer letter, a signed copy, a passport scan, a bank
   letter, a call recording. Two implementations:

     · local — a directory on the machine, for development. Always configured,
       because a folder always exists;
     · s3 — any S3-compatible bucket, signed with SigV4 by hand rather than by
       pulling in the AWS SDK for four operations.

   Keys are opaque and content-addressed by a random id rather than by the
   candidate's name, so a bucket listing is not a list of who applied. Nothing
   here decides who may read a file — that is lib/files, which checks the viewer
   before it ever asks the adapter for bytes.
   ═════════════════════════════════════════════════════════════════════════════*/

const statusOf = (key: 'storage' | 'malware'): Status => {
  const p = providers()[key];
  return { key, provider: p.provider, configured: p.configured, missing: [...p.missing] };
};

const sha256 = (bytes: Uint8Array) =>
  crypto.createHash('sha256').update(bytes).digest('hex');

/* ── Local ───────────────────────────────────────────────────────────────── */

function localStore(): StorageAdapter {
  const root = () => path.resolve(process.cwd(), env().STORAGE_LOCAL_ROOT);
  /* A key never escapes the root, whatever it contains. */
  const fileOf = (key: string) => {
    const safe = key.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
    return path.join(root(), ...safe);
  };

  return {
    key: 'storage',
    status: () => statusOf('storage'),
    async put({ key, bytes, contentType }) {
      const file = fileOf(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      await fs.writeFile(`${file}.type`, contentType, 'utf8');
      return sent(key, {
        key, size: bytes.byteLength, contentType, checksum: sha256(bytes),
      });
    },
    async get(key) {
      try {
        const file = fileOf(key);
        const bytes = new Uint8Array(await fs.readFile(file));
        const contentType = await fs.readFile(`${file}.type`, 'utf8')
          .catch(() => 'application/octet-stream');
        return sent(key, { bytes, contentType });
      } catch {
        return failed('That file is not in local storage', { retryable: false });
      }
    },
    async delete(key) {
      const file = fileOf(key);
      await fs.rm(file, { force: true });
      await fs.rm(`${file}.type`, { force: true });
      return sent(key);
    },
    async signedUrl(key, seconds) {
      /* Local files are served by the application's own route, which checks the
         viewer. The signature is the same one the S3 path uses, so the route
         does not care which store is behind it. */
      const expires = Math.floor(Date.now() / 1000) + seconds;
      const sig = crypto.createHmac('sha256', env().FILE_SIGNING_SECRET)
        .update(`${key}:${expires}`).digest('base64url');
      return sent(key, {
        url: `${env().APP_URL}/api/files/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}`,
        expiresAt: new Date(expires * 1000).toISOString(),
      });
    },
  };
}

/** Whether a signed local URL is still good. */
export function checkSignature(key: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  const want = crypto.createHmac('sha256', env().FILE_SIGNING_SECRET)
    .update(`${key}:${expires}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── S3 ──────────────────────────────────────────────────────────────────── */

const hmac = (key: crypto.BinaryLike, data: string) =>
  crypto.createHmac('sha256', key).update(data).digest();

function signedHeaders(input: {
  method: string; host: string; pathname: string; query: string;
  payloadHash: string; contentType?: string;
}): Record<string, string> {
  const e = env();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = e.S3_REGION ?? 'us-east-1';

  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  if (input.contentType) headers['content-type'] = input.contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signed = names.join(';');
  const canonical = [
    input.method, input.pathname, input.query, canonicalHeaders, signed, input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256', amzDate, scope,
    crypto.createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${e.S3_SECRET_ACCESS_KEY}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${e.S3_ACCESS_KEY_ID}/${scope}, `
    + `SignedHeaders=${signed}, Signature=${signature}`;
  return headers;
}

function s3Store(): StorageAdapter {
  const base = () => {
    const e = env();
    const endpoint = (e.S3_ENDPOINT ?? `https://s3.${e.S3_REGION}.amazonaws.com`).replace(/\/$/, '');
    return e.S3_FORCE_PATH_STYLE
      ? { url: `${endpoint}/${e.S3_BUCKET}`, prefix: `/${e.S3_BUCKET}` }
      : { url: endpoint.replace('://', `://${e.S3_BUCKET}.`), prefix: '' };
  };

  return {
    key: 'storage',
    status: () => statusOf('storage'),
    async put({ key, bytes, contentType }) {
      const { url, prefix } = base();
      const target = new URL(`${url}/${key}`);
      const headers = signedHeaders({
        method: 'PUT',
        host: target.host,
        pathname: `${prefix}/${key}`,
        query: '',
        payloadHash: sha256(bytes),
        contentType,
      });
      const res = await fetch(target, {
        method: 'PUT', headers, body: bytes.slice().buffer as ArrayBuffer,
      }).catch(() => null);
      if (!res || !res.ok) {
        return failed(`The bucket refused the upload${res ? ` (${res.status})` : ''}`, {
          retryable: !res || res.status >= 500,
          status: res?.status,
        });
      }
      return sent(key, { key, size: bytes.byteLength, contentType, checksum: sha256(bytes) });
    },
    async get(key) {
      const { url, prefix } = base();
      const target = new URL(`${url}/${key}`);
      const headers = signedHeaders({
        method: 'GET',
        host: target.host,
        pathname: `${prefix}/${key}`,
        query: '',
        payloadHash: crypto.createHash('sha256').update('').digest('hex'),
      });
      const res = await fetch(target, { headers }).catch(() => null);
      if (!res || !res.ok) {
        return failed(`That file could not be read from the bucket${res ? ` (${res.status})` : ''}`, {
          retryable: !res || res.status >= 500,
          status: res?.status,
        });
      }
      return sent(key, {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      });
    },
    async delete(key) {
      const { url, prefix } = base();
      const target = new URL(`${url}/${key}`);
      const headers = signedHeaders({
        method: 'DELETE',
        host: target.host,
        pathname: `${prefix}/${key}`,
        query: '',
        payloadHash: crypto.createHash('sha256').update('').digest('hex'),
      });
      const res = await fetch(target, { method: 'DELETE', headers }).catch(() => null);
      if (!res || (!res.ok && res.status !== 404)) {
        return failed('The bucket refused the delete', { retryable: true, status: res?.status });
      }
      return sent(key);
    },
    async signedUrl(key, seconds) {
      const e = env();
      const { url, prefix } = base();
      const target = new URL(`${url}/${key}`);
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const region = e.S3_REGION ?? 'us-east-1';
      const scope = `${dateStamp}/${region}/s3/aws4_request`;

      const params = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${e.S3_ACCESS_KEY_ID}/${scope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(seconds),
        'X-Amz-SignedHeaders': 'host',
      });
      const canonical = [
        'GET', `${prefix}/${key}`, params.toString(),
        `host:${target.host}\n`, 'host', 'UNSIGNED-PAYLOAD',
      ].join('\n');
      const toSign = [
        'AWS4-HMAC-SHA256', amzDate, scope,
        crypto.createHash('sha256').update(canonical).digest('hex'),
      ].join('\n');
      const signingKey = hmac(hmac(hmac(hmac(`AWS4${e.S3_SECRET_ACCESS_KEY}`, dateStamp), region), 's3'), 'aws4_request');
      params.set('X-Amz-Signature', crypto.createHmac('sha256', signingKey).update(toSign).digest('hex'));

      return sent(key, {
        url: `${target.origin}${prefix}/${key}?${params.toString()}`,
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
      });
    },
  };
}

export function storageAdapter(): StorageAdapter {
  const e = env();
  if (e.STORAGE_DRIVER === 'local') return localStore();
  if (!providers().storage.configured) {
    const no = () => notConfigured('Object storage', statusOf('storage').missing);
    return {
      key: 'storage',
      status: () => statusOf('storage'),
      async put() { return no(); },
      async get() { return no(); },
      async delete() { return no(); },
      async signedUrl() { return no(); },
    };
  }
  return s3Store();
}

/* ── The malware scanner ─────────────────────────────────────────────────── */

/**
 * ClamAV over its own protocol. INSTREAM sends the file in chunks and the
 * daemon answers with one line; anything else is a failure rather than a pass.
 */
function clamav(): ScannerAdapter {
  return {
    key: 'malware',
    status: () => statusOf('malware'),
    scan(bytes) {
      const e = env();
      return new Promise((resolve) => {
        const socket = net.createConnection({ host: e.CLAMAV_HOST, port: e.CLAMAV_PORT });
        let answer = '';
        const done = (r: Parameters<typeof resolve>[0]) => {
          socket.destroy();
          resolve(r);
        };
        socket.setTimeout(30_000, () => done(failed('The scanner did not answer in time')));
        socket.on('error', (err) => done(failed(`The scanner could not be reached: ${err.message}`)));
        socket.on('data', (d) => { answer += d.toString('utf8'); });
        socket.on('end', () => {
          const line = answer.trim();
          if (/OK$/.test(line)) return done(sent(null, { verdict: 'clean' as ScanVerdict }));
          const found = line.match(/:\s*(.+)\s+FOUND$/);
          if (found) {
            return done(sent(null, { verdict: 'infected' as ScanVerdict, signature: found[1] }));
          }
          return done(failed(`The scanner answered "${line || 'nothing'}"`));
        });
        socket.on('connect', () => {
          socket.write('zINSTREAM\0');
          const CHUNK = 64 * 1024;
          for (let at = 0; at < bytes.length; at += CHUNK) {
            const part = bytes.subarray(at, at + CHUNK);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(part.length);
            socket.write(size);
            socket.write(part);
          }
          const zero = Buffer.alloc(4);
          zero.writeUInt32BE(0);
          socket.write(zero);
        });
      });
    },
  };
}

/**
 * No scanner. It says so — it does not say "clean". A file that has not been
 * scanned is recorded as unscanned, the interface shows it, and the deployment
 * decides whether that is acceptable. Reporting a pass here would be the single
 * most dangerous lie in the product.
 */
function noScanner(): ScannerAdapter {
  return {
    key: 'malware',
    status: () => statusOf('malware'),
    async scan() {
      return notConfigured('Malware scanning', statusOf('malware').missing);
    },
  };
}

export function scannerAdapter(): ScannerAdapter {
  return providers().malware.configured ? clamav() : noScanner();
}
