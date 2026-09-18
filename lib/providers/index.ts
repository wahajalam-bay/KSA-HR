import 'server-only';
import { emailAdapter, whatsappAdapter, smsAdapter, channelAdapter } from './messaging';
import { calendarAdapter, esignAdapter, voiceAdapter } from './scheduling';
import { assessmentAdapter, hrisAdapter, jobBoardAdapter, aiAdapter } from './systems';
import { storageAdapter, scannerAdapter, checkSignature } from './storage';
import type { Status } from './types';

/* ═════════════════════════════════════════════════════════════════════════════
   EVERY OUTSIDE SYSTEM, IN ONE PLACE

   Nothing in the application imports an adapter file directly; it asks here.
   That is what makes "which providers is this deployment actually using" a
   question with one answer, and what lets Settings → Integrations report the
   truth rather than a list somebody maintained by hand.
   ═════════════════════════════════════════════════════════════════════════════*/

export {
  emailAdapter, whatsappAdapter, smsAdapter, channelAdapter,
  calendarAdapter, esignAdapter, voiceAdapter,
  assessmentAdapter, hrisAdapter, jobBoardAdapter, aiAdapter,
  storageAdapter, scannerAdapter, checkSignature,
};

export * from './types';

/** What every adapter says about itself, in the order the settings page reads. */
export function allStatuses(): Status[] {
  return [
    calendarAdapter().status(),
    emailAdapter().status(),
    whatsappAdapter().status(),
    smsAdapter().status(),
    esignAdapter().status(),
    voiceAdapter().status(),
    hrisAdapter().status(),
    assessmentAdapter().status(),
    jobBoardAdapter().status(),
    aiAdapter().status(),
    storageAdapter().status(),
    scannerAdapter().status(),
  ];
}

/** The adapter a webhook belongs to, and how to verify it. */
export function verifierFor(provider: string): ((raw: string, headers: Record<string, string>) => boolean) | null {
  switch (provider) {
    case 'whatsapp': return whatsappAdapter().verify?.bind(whatsappAdapter()) ?? null;
    case 'sms':
    case 'twilio': return smsAdapter().verify?.bind(smsAdapter()) ?? null;
    case 'email':
    case 'sendgrid': return emailAdapter().verify?.bind(emailAdapter()) ?? null;
    case 'docusign':
    case 'esign': return esignAdapter().verify.bind(esignAdapter());
    case 'voice':
    case 'vapi': return voiceAdapter().verify.bind(voiceAdapter());
    case 'assessment': return assessmentAdapter().verify.bind(assessmentAdapter());
    case 'hris': return hrisAdapter().verify.bind(hrisAdapter());
    default: return null;
  }
}
