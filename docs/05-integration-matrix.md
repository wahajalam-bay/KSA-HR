# Integration matrix

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

Every outside system reaches the product through an adapter behind a contract in
`lib/providers/types.ts`. An adapter returns one of exactly three things:

```ts
notConfigured(what, missing)   // nothing is set up: say so, do not pretend
failed(message, { retryable }) // it was tried and did not work
sent(externalId, detail)       // it worked, and here is the receipt
```

**Nothing fakes success.** A message with no provider is written to the outbox
with status `not_configured` and the settings that are missing named in the
row; the interface shows that, and the recruiter knows to chase the candidate
another way. A file with no scanner is marked `skipped`, never `clean`. The
phone screen is refused outright rather than scheduled, because a call nobody
can place is not a call that is "queued".

## What is configured in this environment

| Integration | What it does | State | Missing |
| --- | --- | --- | --- |
| Email | Every letter, invitation and notice that leaves the building. | **Not configured** | `EMAIL_PROVIDER` |
| WhatsApp | The screening chat, the pitch brief, and candidate replies. | **Not configured** | `WHATSAPP_PROVIDER` |
| SMS | Booking links and call-back links. | **Not configured** | `SMS_PROVIDER` |
| LinkedIn | Publishing a requisition to the company page. | **Not configured** | `LINKEDIN_PROVIDER` |
| Calendar | The interview invitation and the panel’s free/busy. | **Not configured** | `CALENDAR_PROVIDER` |
| E-signature | The offer envelope and the signature on the letter. | **Not configured** | `ESIGN_PROVIDER` |
| Telephony | The AI phone screen — placing the call and the recording. | **Not configured** | `VOICE_PROVIDER` |
| HRIS | Pushing a new joiner into the system of record. | **Not configured** | `HRIS_PROVIDER` |
| Assessments | The behavioural questionnaire and its report. | **Not configured** | `ASSESSMENT_PROVIDER` |
| Model | CV reading, transcript analysis and the interviewer review. | **Not configured** | `AI_PROVIDER` |
| File storage | Where every uploaded file actually lives. | **Configured** — `local` | — |
| oidc |  | **Not configured** | `AUTH_MODE` |
| malware |  | **Not configured** | `MALWARE_SCANNER` |

*The state column is this machine's, at the moment the document was generated.
Settings → Integrations shows the same thing live.*

## Webhooks

Provider callbacks arrive at `/api/webhooks/[provider]` and are handled in
`lib/services/webhooks.ts`, in this order:

1. **Store first.** The raw body and headers are written before anything is
   parsed, so a delivery that cannot be understood is still on the record.
2. **Verify second.** Where the provider signs its callbacks, the signature is
   checked over the raw bytes. An unsigned or mis-signed delivery is kept with
   `signature_valid = false`, marked *refused — the signature did not check
   out*, audited, and **never acted on**.
3. **Act once.** Processing is idempotent on the provider's own event id, so a
   provider that retries does not move an application twice.

Meta's GET verification handshake is answered on the same route.
