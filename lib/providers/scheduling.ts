import 'server-only';
import { env, providers } from '@/lib/env';
import { call, hmacBase64, hmacHex, sameSignature, refuse } from './http';
import {
  notConfigured, sent, type CalendarAdapter, type CalendarEvent,
  type EsignAdapter, type Envelope, type VoiceAdapter, type CallRequest, type Status,
} from './types';

/* ═════════════════════════════════════════════════════════════════════════════
   THE DIARY, THE SIGNATURE AND THE CALL

   Three adapters that each own a piece of the loop the candidate experiences:
   the invitation that lands in their calendar, the envelope they sign, and the
   assistant that telephones them.

   All three verify their callbacks. A webhook that cannot be verified is stored
   and marked invalid rather than acted on — an unsigned "the offer was signed"
   is exactly the message an attacker would send.
   ═════════════════════════════════════════════════════════════════════════════*/

const statusOf = (key: 'calendar' | 'esign' | 'voice'): Status => {
  const p = providers()[key];
  return { key, provider: p.provider, configured: p.configured, missing: [...p.missing] };
};

/* ── Calendar ────────────────────────────────────────────────────────────── */

async function googleToken(): Promise<string | null> {
  const e = env();
  const r = await call<{ access_token?: string }>({
    label: 'Google',
    url: 'https://oauth2.googleapis.com/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    raw: new URLSearchParams({
      client_id: e.GOOGLE_CALENDAR_CLIENT_ID ?? '',
      client_secret: e.GOOGLE_CALENDAR_CLIENT_SECRET ?? '',
      refresh_token: e.GOOGLE_CALENDAR_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }).toString(),
  });
  return r.ok ? (r.detail?.data?.access_token ?? null) : null;
}

const iso = (d: Date) => d.toISOString();
const end = (e: CalendarEvent) => new Date(e.start.getTime() + e.durationMin * 60_000);

function google(): CalendarAdapter {
  const body = (e: CalendarEvent) => ({
    summary: e.title,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    start: { dateTime: iso(e.start), timeZone: 'Asia/Riyadh' },
    end: { dateTime: iso(end(e)), timeZone: 'Asia/Riyadh' },
    attendees: e.attendees.map((a) => ({
      email: a.email, displayName: a.name, optional: a.optional ?? false,
    })),
    conferenceData: {
      createRequest: { requestId: e.idempotencyKey, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  });

  return {
    key: 'calendar',
    status: () => statusOf('calendar'),
    async create(event) {
      const token = await googleToken();
      if (!token) return refuse('Google would not issue a token — check the refresh token');
      const r = await call<{ id?: string; hangoutLink?: string }>({
        label: 'Google Calendar',
        url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
        headers: { authorization: `Bearer ${token}` },
        body: body(event),
      });
      if (!r.ok) return r;
      return sent(r.detail?.data?.id ?? null, { meetingUrl: r.detail?.data?.hangoutLink ?? null });
    },
    async update(eventId, event) {
      const token = await googleToken();
      if (!token) return refuse('Google would not issue a token — check the refresh token');
      const r = await call<{ id?: string; hangoutLink?: string }>({
        label: 'Google Calendar',
        method: 'PATCH',
        url: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        headers: { authorization: `Bearer ${token}` },
        body: body(event),
      });
      if (!r.ok) return r;
      return sent(eventId, { meetingUrl: r.detail?.data?.hangoutLink ?? null });
    },
    async cancel(eventId) {
      const token = await googleToken();
      if (!token) return refuse('Google would not issue a token — check the refresh token');
      const r = await call({
        label: 'Google Calendar',
        method: 'DELETE',
        url: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        headers: { authorization: `Bearer ${token}` },
      });
      return r.ok ? sent(eventId) : r;
    },
    async busy(emails, from, to) {
      const token = await googleToken();
      if (!token) return refuse('Google would not issue a token — check the refresh token');
      const r = await call<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>({
        label: 'Google Calendar',
        url: 'https://www.googleapis.com/calendar/v3/freeBusy',
        headers: { authorization: `Bearer ${token}` },
        body: { timeMin: iso(from), timeMax: iso(to), items: emails.map((id) => ({ id })) },
      });
      if (!r.ok) return r;
      const out: Array<{ email: string; from: string; to: string }> = [];
      for (const [email, cal] of Object.entries(r.detail?.data?.calendars ?? {})) {
        for (const slot of cal.busy ?? []) out.push({ email, from: slot.start, to: slot.end });
      }
      return sent(null, { busy: out });
    },
  };
}

async function graphToken(): Promise<string | null> {
  const e = env();
  const r = await call<{ access_token?: string }>({
    label: 'Microsoft Graph',
    url: `https://login.microsoftonline.com/${e.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    raw: new URLSearchParams({
      client_id: e.MS_GRAPH_CLIENT_ID ?? '',
      client_secret: e.MS_GRAPH_CLIENT_SECRET ?? '',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });
  return r.ok ? (r.detail?.data?.access_token ?? null) : null;
}

function microsoft(): CalendarAdapter {
  const body = (e: CalendarEvent) => ({
    subject: e.title,
    body: { contentType: 'text', content: e.description ?? '' },
    start: { dateTime: iso(e.start), timeZone: 'Asia/Riyadh' },
    end: { dateTime: iso(end(e)), timeZone: 'Asia/Riyadh' },
    location: e.location ? { displayName: e.location } : undefined,
    attendees: e.attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name },
      type: a.optional ? 'optional' : 'required',
    })),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    transactionId: e.idempotencyKey,
  });

  return {
    key: 'calendar',
    status: () => statusOf('calendar'),
    async create(event) {
      const token = await graphToken();
      if (!token) return refuse('Microsoft would not issue a token — check the app registration');
      const organiser = event.attendees[0]?.email;
      if (!organiser) return refuse('An event needs somebody to organise it');
      const r = await call<{ id?: string; onlineMeeting?: { joinUrl?: string } }>({
        label: 'Microsoft Graph',
        url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiser)}/events`,
        headers: { authorization: `Bearer ${token}` },
        body: body(event),
      });
      if (!r.ok) return r;
      return sent(r.detail?.data?.id ?? null, {
        meetingUrl: r.detail?.data?.onlineMeeting?.joinUrl ?? null,
      });
    },
    async update(eventId, event) {
      const token = await graphToken();
      if (!token) return refuse('Microsoft would not issue a token — check the app registration');
      const organiser = event.attendees[0]?.email;
      const r = await call<{ onlineMeeting?: { joinUrl?: string } }>({
        label: 'Microsoft Graph',
        method: 'PATCH',
        url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiser ?? '')}/events/${encodeURIComponent(eventId)}`,
        headers: { authorization: `Bearer ${token}` },
        body: body(event),
      });
      if (!r.ok) return r;
      return sent(eventId, { meetingUrl: r.detail?.data?.onlineMeeting?.joinUrl ?? null });
    },
    async cancel(eventId, reason) {
      const token = await graphToken();
      if (!token) return refuse('Microsoft would not issue a token — check the app registration');
      const r = await call({
        label: 'Microsoft Graph',
        url: `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}/cancel`,
        headers: { authorization: `Bearer ${token}` },
        body: { comment: reason ?? 'Cancelled' },
      });
      return r.ok ? sent(eventId) : r;
    },
  };
}

function noCalendar(): CalendarAdapter {
  const no = () => notConfigured('The calendar', statusOf('calendar').missing);
  return {
    key: 'calendar',
    status: () => statusOf('calendar'),
    async create() { return no(); },
    async update() { return no(); },
    async cancel() { return no(); },
    async busy() { return no(); },
  };
}

export function calendarAdapter(): CalendarAdapter {
  if (!providers().calendar.configured) return noCalendar();
  return env().CALENDAR_PROVIDER === 'microsoft' ? microsoft() : google();
}

/* ── E-signature ─────────────────────────────────────────────────────────── */

async function docusignToken(): Promise<string | null> {
  const e = env();
  if (!e.DOCUSIGN_PRIVATE_KEY || !e.DOCUSIGN_INTEGRATION_KEY || !e.DOCUSIGN_USER_ID) return null;
  const crypto = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: e.DOCUSIGN_INTEGRATION_KEY,
    sub: e.DOCUSIGN_USER_ID,
    aud: (e.DOCUSIGN_BASE_URL ?? '').includes('demo') ? 'account-d.docusign.com' : 'account.docusign.com',
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  })).toString('base64url');
  const signature = crypto.createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(e.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n'), 'base64url');

  const r = await call<{ access_token?: string }>({
    label: 'DocuSign',
    url: `https://${(e.DOCUSIGN_BASE_URL ?? '').includes('demo') ? 'account-d' : 'account'}.docusign.com/oauth/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    raw: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }).toString(),
  });
  return r.ok ? (r.detail?.data?.access_token ?? null) : null;
}

function docusign(): EsignAdapter {
  return {
    key: 'esign',
    status: () => statusOf('esign'),
    async create(envelope) {
      const e = env();
      const token = await docusignToken();
      if (!token) return refuse('DocuSign would not issue a token — check the integration key');
      const r = await call<{ envelopeId?: string }>({
        label: 'DocuSign',
        url: `${e.DOCUSIGN_BASE_URL}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes`,
        headers: { authorization: `Bearer ${token}` },
        body: {
          emailSubject: envelope.subject,
          emailBlurb: envelope.message,
          status: 'sent',
          documents: [{
            documentBase64: Buffer.from(envelope.documentPdf).toString('base64'),
            name: envelope.documentName,
            fileExtension: 'pdf',
            documentId: '1',
          }],
          recipients: {
            signers: envelope.signers.map((s, i) => ({
              email: s.email,
              name: s.name,
              recipientId: String(i + 1),
              routingOrder: String(i + 1),
              roleName: s.role,
              tabs: {
                signHereTabs: [{ anchorString: '/sig1/', anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '0' }],
                dateSignedTabs: [{ anchorString: '/date1/', anchorUnits: 'pixels' }],
              },
            })),
          },
          eventNotification: e.DOCUSIGN_WEBHOOK_SECRET ? {
            url: `${e.APP_URL}/api/webhooks/docusign`,
            requireAcknowledgment: 'true',
            includeDocuments: 'false',
            envelopeEvents: [
              { envelopeEventStatusCode: 'sent' },
              { envelopeEventStatusCode: 'delivered' },
              { envelopeEventStatusCode: 'completed' },
              { envelopeEventStatusCode: 'declined' },
              { envelopeEventStatusCode: 'voided' },
            ],
          } : undefined,
        },
      });
      if (!r.ok) return r;
      const id = r.detail?.data?.envelopeId ?? null;
      if (!id) return refuse('DocuSign accepted the envelope but gave no id back');
      return sent(id, { envelopeId: id });
    },
    async void(envelopeId, reason) {
      const e = env();
      const token = await docusignToken();
      if (!token) return refuse('DocuSign would not issue a token');
      const r = await call({
        label: 'DocuSign',
        method: 'PUT',
        url: `${e.DOCUSIGN_BASE_URL}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}`,
        headers: { authorization: `Bearer ${token}` },
        body: { status: 'voided', voidedReason: reason },
      });
      return r.ok ? sent(envelopeId) : r;
    },
    async fetchSigned(envelopeId) {
      const e = env();
      const token = await docusignToken();
      if (!token) return refuse('DocuSign would not issue a token');
      const res = await fetch(
        `${e.DOCUSIGN_BASE_URL}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`,
        { headers: { authorization: `Bearer ${token}` } },
      ).catch(() => null);
      if (!res || !res.ok) return refuse('The signed copy could not be fetched from DocuSign');
      const bytes = new Uint8Array(await res.arrayBuffer());
      return sent(envelopeId, { bytes, contentType: 'application/pdf' });
    },
    verify(raw, headers) {
      const secret = env().DOCUSIGN_WEBHOOK_SECRET;
      const given = headers['x-docusign-signature-1'] ?? '';
      if (!secret || !given) return false;
      return sameSignature(given, hmacBase64(secret, raw));
    },
  };
}

function noEsign(): EsignAdapter {
  const no = () => notConfigured('E-signature', statusOf('esign').missing);
  return {
    key: 'esign',
    status: () => statusOf('esign'),
    async create() { return no(); },
    async void() { return no(); },
    async fetchSigned() { return no(); },
    verify() { return false; },
  };
}

export function esignAdapter(): EsignAdapter {
  return providers().esign.configured ? docusign() : noEsign();
}

/* ── The phone assistant ─────────────────────────────────────────────────── */

function vapi(): VoiceAdapter {
  return {
    key: 'voice',
    status: () => statusOf('voice'),
    async place(c) {
      const e = env();
      const r = await call<{ id?: string }>({
        label: 'Vapi',
        url: 'https://api.vapi.ai/call',
        headers: { authorization: `Bearer ${e.VAPI_API_KEY}` },
        body: {
          assistantId: e.VAPI_ASSISTANT_ID,
          phoneNumberId: e.VOICE_FROM_NUMBER,
          customer: { number: c.to },
          assistantOverrides: {
            firstMessage: c.recordingNotice,
            variableValues: {
              language: c.language,
              voice: c.voice,
              questions: c.script.map((q) => q.question),
            },
            serverUrl: c.webhookUrl,
          },
          metadata: { idempotencyKey: c.idempotencyKey },
        },
      });
      if (!r.ok) return r;
      const id = r.detail?.data?.id ?? null;
      return id ? sent(id, { callId: id }) : refuse('Vapi accepted the call but gave no id back');
    },
    async cancel(callId) {
      const e = env();
      const r = await call({
        label: 'Vapi',
        method: 'DELETE',
        url: `https://api.vapi.ai/call/${callId}`,
        headers: { authorization: `Bearer ${e.VAPI_API_KEY}` },
      });
      return r.ok ? sent(callId) : r;
    },
    async recording(callId) {
      const e = env();
      const r = await call<{ recordingUrl?: string }>({
        label: 'Vapi',
        url: `https://api.vapi.ai/call/${callId}`,
        headers: { authorization: `Bearer ${e.VAPI_API_KEY}` },
      });
      if (!r.ok) return r;
      const url = r.detail?.data?.recordingUrl;
      if (!url) return refuse('That call has no recording');
      return sent(callId, {
        url,
        expiresAt: new Date(Date.now() + e.VOICE_RECORDING_RETENTION_DAYS * 86_400_000).toISOString(),
      });
    },
    verify(raw, headers) {
      const secret = env().VOICE_WEBHOOK_SECRET;
      const given = headers['x-vapi-signature'] ?? '';
      if (!secret || !given) return false;
      return sameSignature(given, hmacHex(secret, raw));
    },
  };
}

function twilioVoice(): VoiceAdapter {
  return {
    key: 'voice',
    status: () => statusOf('voice'),
    async place(c) {
      const e = env();
      const r = await call<{ sid?: string }>({
        label: 'Twilio Voice',
        url: `https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Calls.json`,
        headers: {
          authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          'i-twilio-idempotency-token': c.idempotencyKey,
        },
        raw: new URLSearchParams({
          To: c.to,
          From: e.VOICE_FROM_NUMBER ?? '',
          Url: c.webhookUrl,
          Record: 'true',
          StatusCallback: c.webhookUrl,
        }).toString(),
      });
      if (!r.ok) return r;
      const id = r.detail?.data?.sid ?? null;
      return id ? sent(id, { callId: id }) : refuse('Twilio accepted the call but gave no id back');
    },
    async cancel(callId) {
      const e = env();
      const r = await call({
        label: 'Twilio Voice',
        url: `https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Calls/${callId}.json`,
        headers: {
          authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        raw: new URLSearchParams({ Status: 'completed' }).toString(),
      });
      return r.ok ? sent(callId) : r;
    },
    async recording(callId) {
      return refuse('Twilio recordings are fetched from the recording resource, not the call');
    },
    verify(raw, headers) {
      const token = env().TWILIO_AUTH_TOKEN;
      const given = headers['x-twilio-signature'] ?? '';
      if (!token || !given) return false;
      return sameSignature(given, Buffer.from(hmacHex(token, raw), 'hex').toString('base64'));
    },
  };
}

function noVoice(): VoiceAdapter {
  const no = () => notConfigured('The phone assistant', statusOf('voice').missing);
  return {
    key: 'voice',
    status: () => statusOf('voice'),
    async place() { return no(); },
    async cancel() { return no(); },
    async recording() { return no(); },
    verify() { return false; },
  };
}

export function voiceAdapter(): VoiceAdapter {
  if (!providers().voice.configured) return noVoice();
  return env().VOICE_PROVIDER === 'vapi' ? vapi() : twilioVoice();
}
