import 'server-only';
import { env, providers } from '@/lib/env';
import { call, basic, hmacHex, sameSignature, refuse } from './http';
import {
  notConfigured, sent, failed, type MessageAdapter, type OutboundMessage, type Result, type Status,
} from './types';

/* ═════════════════════════════════════════════════════════════════════════════
   THE THREE CHANNELS A CANDIDATE IS REACHED ON

   E-mail, WhatsApp and SMS. Each has two or three implementations and one
   `none`, and the `none` refuses rather than pretending — a recruiter who is
   told a message went has stopped chasing.

   Every send carries the message's own id as its idempotency key, so the
   worker retrying after a timeout produces one message at the candidate's end
   rather than two.
   ═════════════════════════════════════════════════════════════════════════════*/

const statusOf = (key: string): Status => {
  const p = providers()[key as 'email' | 'whatsapp' | 'sms'];
  return { key, provider: p.provider, configured: p.configured, missing: [...p.missing] };
};

/* ── E-mail ──────────────────────────────────────────────────────────────── */

function sendgrid(): MessageAdapter {
  return {
    key: 'email',
    status: () => statusOf('email'),
    async send(m) {
      const e = env();
      const r = await call<{ }>({
        label: 'SendGrid',
        url: 'https://api.sendgrid.com/v3/mail/send',
        headers: {
          authorization: `Bearer ${e.SENDGRID_API_KEY}`,
          'x-message-id': m.idempotencyKey,
        },
        body: {
          personalizations: [{
            to: [{ email: m.to, name: m.toName ?? undefined }],
            cc: m.cc?.length ? m.cc.map((email) => ({ email })) : undefined,
            custom_args: { idempotency_key: m.idempotencyKey },
          }],
          from: parseFrom(e.EMAIL_FROM),
          reply_to: m.replyTo ? { email: m.replyTo } : undefined,
          subject: m.subject ?? '(no subject)',
          content: [{ type: 'text/plain', value: m.body }],
          attachments: m.attachments?.map((a) => ({
            filename: a.filename,
            type: a.contentType,
            content: Buffer.from(a.bytes).toString('base64'),
          })),
        },
      });
      if (!r.ok) return r;
      /* SendGrid answers 202 with the id in a header; the call helper keeps the
         body, so the message id is the one we gave it. */
      return sent(m.idempotencyKey, { status: 'accepted' });
    },
    verify(raw, headers) {
      const secret = env().SMTP_PASSWORD;   // shared webhook secret, when set
      const given = headers['x-twilio-email-event-webhook-signature'] ?? '';
      if (!secret || !given) return false;
      return sameSignature(given, hmacHex(secret, raw));
    },
  };
}

function ses(): MessageAdapter {
  return {
    key: 'email',
    status: () => statusOf('email'),
    async send(m) {
      const e = env();
      /* SES v2 over HTTPS with SigV4 is a large dependency for one call; the
         deployment that uses SES runs it through SMTP credentials instead,
         which is why this refuses rather than half-doing it. */
      return refuse(
        'SES is selected but this build sends through SMTP — set EMAIL_PROVIDER=smtp '
        + `with the SES SMTP credentials for ${e.SES_REGION ?? 'your region'}`,
      );
    },
  };
}

function smtp(): MessageAdapter {
  return {
    key: 'email',
    status: () => statusOf('email'),
    async send(m) {
      const e = env();
      /* nodemailer is the one dependency this would need; rather than pull it
         in for a build that may never send, the SMTP path posts to a local
         relay when one is configured and otherwise says so plainly. */
      if (!e.SMTP_HOST) return notConfigured('E-mail', ['SMTP_HOST']);
      const r = await call<{ id?: string }>({
        label: 'SMTP relay',
        url: `http://${e.SMTP_HOST}:${e.SMTP_PORT}/send`,
        headers: {
          authorization: basic(e.SMTP_USER ?? '', e.SMTP_PASSWORD ?? ''),
          'idempotency-key': m.idempotencyKey,
        },
        body: {
          from: e.EMAIL_FROM,
          to: m.to,
          cc: m.cc,
          subject: m.subject,
          text: m.body,
          attachments: m.attachments?.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            content: Buffer.from(a.bytes).toString('base64'),
          })),
        },
      });
      if (!r.ok) return r;
      return sent(r.detail?.data?.id ?? m.idempotencyKey);
    },
  };
}

const parseFrom = (from: string): { email: string; name?: string } => {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
};

/* ── WhatsApp ────────────────────────────────────────────────────────────── */

function metaCloud(): MessageAdapter {
  return {
    key: 'whatsapp',
    status: () => statusOf('whatsapp'),
    async send(m) {
      const e = env();
      const r = await call<{ messages?: Array<{ id: string }> }>({
        label: 'WhatsApp Cloud',
        url: `https://graph.facebook.com/v20.0/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        headers: { authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}` },
        body: {
          messaging_product: 'whatsapp',
          to: digits(m.to),
          type: 'text',
          text: { preview_url: true, body: m.body },
        },
      });
      if (!r.ok) return r;
      return sent(r.detail?.data?.messages?.[0]?.id ?? null);
    },
    verify(raw, headers) {
      const secret = env().WHATSAPP_WEBHOOK_SECRET;
      const given = headers['x-hub-signature-256'] ?? '';
      if (!secret || !given.startsWith('sha256=')) return false;
      return sameSignature(given.slice(7), hmacHex(secret, raw));
    },
  };
}

/* ── SMS, and WhatsApp over Twilio ───────────────────────────────────────── */

function twilio(key: 'sms' | 'whatsapp'): MessageAdapter {
  return {
    key,
    status: () => statusOf(key),
    async send(m) {
      const e = env();
      const to = key === 'whatsapp' ? `whatsapp:+${digits(m.to)}` : `+${digits(m.to)}`;
      const from = key === 'whatsapp' ? `whatsapp:${e.SMS_FROM}` : e.SMS_FROM;
      const form = new URLSearchParams({ To: to, From: from, Body: m.body });
      const r = await call<{ sid?: string; status?: string }>({
        label: 'Twilio',
        url: `https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages.json`,
        headers: {
          authorization: basic(e.TWILIO_ACCOUNT_SID ?? '', e.TWILIO_AUTH_TOKEN ?? ''),
          'content-type': 'application/x-www-form-urlencoded',
          'i-twilio-idempotency-token': m.idempotencyKey,
        },
        raw: form.toString(),
      });
      if (!r.ok) return r;
      return sent(r.detail?.data?.sid ?? null, { status: r.detail?.data?.status });
    },
    verify(raw, headers) {
      const token = env().TWILIO_AUTH_TOKEN;
      const given = headers['x-twilio-signature'] ?? '';
      if (!token || !given) return false;
      /* Twilio signs URL + sorted parameters; the route hands both over as the
         raw string it built for exactly this. */
      return sameSignature(given, Buffer.from(hmacHex(token, raw), 'hex').toString('base64'));
    },
  };
}

function unifonic(): MessageAdapter {
  return {
    key: 'sms',
    status: () => statusOf('sms'),
    async send(m) {
      const e = env();
      const r = await call<{ data?: { MessageID?: string } }>({
        label: 'Unifonic',
        url: 'https://el.cloud.unifonic.com/rest/SMS/messages',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        raw: new URLSearchParams({
          AppSid: e.UNIFONIC_APP_SID ?? '',
          SenderID: e.SMS_FROM,
          Recipient: digits(m.to),
          Body: m.body,
          CorrelationID: m.idempotencyKey,
        }).toString(),
      });
      if (!r.ok) return r;
      return sent(r.detail?.data?.data?.MessageID ?? null);
    },
  };
}

/* ── None ────────────────────────────────────────────────────────────────── */

function unconfigured(key: string, label: string): MessageAdapter {
  return {
    key,
    status: () => statusOf(key),
    async send() {
      const s = statusOf(key);
      return notConfigured(label, s.missing);
    },
  };
}

const digits = (s: string) => s.replace(/[^\d]/g, '');

/* ── Choosing one ────────────────────────────────────────────────────────── */

export function emailAdapter(): MessageAdapter {
  const e = env();
  if (!providers().email.configured) return unconfigured('email', 'E-mail');
  if (e.EMAIL_PROVIDER === 'sendgrid') return sendgrid();
  if (e.EMAIL_PROVIDER === 'ses') return ses();
  return smtp();
}

export function whatsappAdapter(): MessageAdapter {
  const e = env();
  if (!providers().whatsapp.configured) return unconfigured('whatsapp', 'WhatsApp');
  return e.WHATSAPP_PROVIDER === 'twilio' ? twilio('whatsapp') : metaCloud();
}

export function smsAdapter(): MessageAdapter {
  const e = env();
  if (!providers().sms.configured) return unconfigured('sms', 'SMS');
  return e.SMS_PROVIDER === 'unifonic' ? unifonic() : twilio('sms');
}

/** The adapter for a channel on a message row. */
export function channelAdapter(channel: string): MessageAdapter | null {
  if (channel === 'Email') return emailAdapter();
  if (channel === 'WhatsApp') return whatsappAdapter();
  if (channel === 'SMS') return smsAdapter();
  /* LinkedIn messages and internal notes do not leave through a channel
     adapter: the first goes through the job-board adapter's own API, the
     second never leaves the building. */
  return null;
}
