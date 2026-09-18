# Environment-variable reference

Generated from the code on 2026-09-18 by `npm run docs`. Do not edit by hand.

Read and validated once, at start-up, by `lib/env.ts`. A variable that fails
its schema stops the process rather than producing a subtly wrong system later —
and a provider whose variables are absent is reported as **not configured**
rather than failing at the moment somebody tries to use it.

Files are read in this order, each overriding the last: `.env`,
`.env.local`, `.env.<NODE_ENV>`, `.env.<NODE_ENV>.local`, then the real
environment. A value with an unquoted `#` after it has the comment stripped.

### Core

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `NODE_ENV` | no | development \| test \| production | `'development'` |  |
| `APP_URL` | no | url | `'http://localhost:3400'` |  |
| `APP_PORT` | no | number | `3400` |  |

### Database

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `DATABASE_URL` | **yes** | text | — | PostgreSQL 16+. The local dev cluster is created by scripts/pg-init.ps1. |
| `DATABASE_POOL_MAX` | no | number | `10` |  |
| `DATABASE_SSL` | no | true / false | `false` |  |

### Sessions & secrets

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `SESSION_SECRET` | **yes** | text | — | 32+ random bytes, base64. Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))" |
| `SESSION_TTL_HOURS` | no | number | `12` |  |
| `SESSION_IDLE_MINUTES` | no | number | `120` |  |
| `FILE_SIGNING_SECRET` | **yes** | text | — | Rotating this invalidates every signed file URL immediately. |

### Authentication

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `AUTH_MODE` | no | password \| oidc \| both | `'password'` |  |
| `PASSWORD_MIN_LENGTH` | no | number | `12` |  |
| `LOGIN_MAX_ATTEMPTS` | no | number | `8` |  |
| `LOGIN_LOCKOUT_MINUTES` | no | number | `15` |  |
| `OIDC_ISSUER` | no | text | — | OIDC (AUTH_MODE=oidc|both). Leave blank and the SSO button reports "not configured". |
| `OIDC_CLIENT_ID` | no | text | — |  |
| `OIDC_CLIENT_SECRET` | no | text | — |  |
| `OIDC_REDIRECT_URI` | no | text | `http://localhost:3400/api/auth/oidc/callback` |  |
| `OIDC_SCOPES` | no | text | `'openid email profile'` |  |

### File storage

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `STORAGE_DRIVER` | no | local \| s3 | `'local'` |  |
| `STORAGE_LOCAL_ROOT` | no | text | `'./.storage'` |  |
| `STORAGE_MAX_UPLOAD_MB` | no | number | `25` |  |
| `S3_ENDPOINT` | no | text | — |  |
| `S3_REGION` | no | text | — |  |
| `S3_BUCKET` | no | text | — |  |
| `S3_ACCESS_KEY_ID` | no | text | — |  |
| `S3_SECRET_ACCESS_KEY` | no | text | — |  |
| `S3_FORCE_PATH_STYLE` | no | true / false | `true` |  |

### Malware scanning

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `MALWARE_SCANNER` | no | none \| clamav | `'none'` | clamav | none. With `none`, uploads are accepted and marked scan_skipped, and the UI says so rather than claiming a file is clean. |
| `CLAMAV_HOST` | no | text | `'127.0.0.1'` |  |
| `CLAMAV_PORT` | no | number | `3310` |  |

### Messaging providers

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `EMAIL_PROVIDER` | no | none \| smtp \| ses \| sendgrid | `'none'` | Each adapter reports "not configured" when its credentials are absent; nothing is ever reported as sent when it was not. |
| `EMAIL_FROM` | no | text | `'Bayut KSA Talent Acquisition <ta@bayut.sa>'` |  |
| `SMTP_HOST` | no | text | — |  |
| `SMTP_PORT` | no | number | `587` |  |
| `SMTP_USER` | no | text | — |  |
| `SMTP_PASSWORD` | no | text | — |  |
| `SMTP_SECURE` | no | true / false | `false` |  |
| `SENDGRID_API_KEY` | no | text | — |  |
| `SES_REGION` | no | text | — |  |
| `SES_ACCESS_KEY_ID` | no | text | — |  |
| `SES_SECRET_ACCESS_KEY` | no | text | — |  |
| `WHATSAPP_PROVIDER` | no | none \| meta_cloud \| twilio | `'none'` |  |
| `WHATSAPP_PHONE_NUMBER_ID` | no | text | — |  |
| `WHATSAPP_ACCESS_TOKEN` | no | text | — |  |
| `WHATSAPP_WEBHOOK_SECRET` | no | text | — |  |
| `WHATSAPP_VERIFY_TOKEN` | no | text | — |  |
| `SMS_PROVIDER` | no | none \| twilio \| unifonic | `'none'` |  |
| `SMS_FROM` | no | text | `'Bayut'` |  |
| `TWILIO_ACCOUNT_SID` | no | text | — |  |
| `TWILIO_AUTH_TOKEN` | no | text | — |  |
| `UNIFONIC_APP_SID` | no | text | — |  |
| `LINKEDIN_PROVIDER` | no | none \| talent_solutions | `'none'` |  |
| `LINKEDIN_CLIENT_ID` | no | text | — |  |
| `LINKEDIN_CLIENT_SECRET` | no | text | — |  |
| `LINKEDIN_ORGANIZATION_URN` | no | text | — |  |

### Calendar

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `CALENDAR_PROVIDER` | no | none \| google \| microsoft | `'none'` |  |
| `GOOGLE_CALENDAR_CLIENT_ID` | no | text | — |  |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | no | text | — |  |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | no | text | — |  |
| `MS_GRAPH_TENANT_ID` | no | text | — |  |
| `MS_GRAPH_CLIENT_ID` | no | text | — |  |
| `MS_GRAPH_CLIENT_SECRET` | no | text | — |  |

### E-signature

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `ESIGN_PROVIDER` | no | none \| docusign \| dropbox_sign | `'none'` |  |
| `DOCUSIGN_BASE_URL` | no | text | — |  |
| `DOCUSIGN_ACCOUNT_ID` | no | text | — |  |
| `DOCUSIGN_INTEGRATION_KEY` | no | text | — |  |
| `DOCUSIGN_USER_ID` | no | text | — |  |
| `DOCUSIGN_PRIVATE_KEY` | no | text | — |  |
| `DOCUSIGN_WEBHOOK_SECRET` | no | text | — |  |

### Telephony / voice (AI phone screening)

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `VOICE_PROVIDER` | no | none \| twilio_voice \| vapi | `'none'` |  |
| `VOICE_FROM_NUMBER` | no | text | — |  |
| `VAPI_API_KEY` | no | text | — |  |
| `VAPI_ASSISTANT_ID` | no | text | — |  |
| `VOICE_WEBHOOK_SECRET` | no | text | — |  |
| `VOICE_RECORDING_RETENTION_DAYS` | no | number | `30` |  |

### HRIS

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `HRIS_PROVIDER` | no | none \| jisr \| workday | `'none'` |  |
| `HRIS_BASE_URL` | no | text | — |  |
| `HRIS_API_KEY` | no | text | — |  |
| `HRIS_WEBHOOK_SECRET` | no | text | — |  |

### Assessments

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `ASSESSMENT_PROVIDER` | no | none \| thomas \| shl \| hogan \| predictive_index | `'none'` |  |
| `ASSESSMENT_BASE_URL` | no | text | — |  |
| `ASSESSMENT_API_KEY` | no | text | — |  |
| `ASSESSMENT_WEBHOOK_SECRET` | no | text | — |  |

### AI (CV reading, Ask AI, call/pitch analysis)

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `AI_PROVIDER` | no | none \| anthropic | `'none'` | With no key the platform falls back to its own deterministic local engines and labels every result "local rules" rather than pretending Claude read it. |
| `ANTHROPIC_API_KEY` | no | text | — |  |
| `ANTHROPIC_MODEL` | no | text | `'claude-sonnet-5'` |  |
| `AI_MAX_TOKENS` | no | number | `4096` |  |

### Automation engine / workers

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `WORKER_ENABLED` | no | true / false | `true` |  |
| `WORKER_POLL_MS` | no | number | `2000` |  |
| `WORKER_BATCH` | no | number | `20` |  |
| `WORKER_MAX_ATTEMPTS` | no | number | `6` |  |

### Data retention

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `CANDIDATE_RETENTION_MONTHS` | no | number | `24` |  |
| `AUDIT_RETENTION_MONTHS` | no | number | `84` |  |
| `RECORDING_RETENTION_DAYS` | no | number | `30` |  |

### Observability

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `LOG_LEVEL` | no | debug \| info \| warn \| error | `'info'` |  |
| `LOG_FORMAT` | no | pretty \| json | `'pretty'` |  |

### Test clock

| Variable | Required | Type | Default | What it is |
| --- | :-: | --- | --- | --- |
| `ALLOW_TEST_CLOCK` | no | text | `1` | Lets a request take its "now" from the bayut_ta_clock cookie instead of the wall clock, so the visual comparison can hold production still while it photographs it. Refused outright when NODE_ENV is production, and never used for session expiry. Leave it unset anywhere real. |

## How the provider switches work

Each integration has a `*_PROVIDER` variable whose value picks the adapter,
and `none` is always a legitimate answer. A provider set to something other
than `none` whose credentials are missing is reported as not configured, with
the exact variables named — in the product, in `npm run worker -- --once`, and
in the integration matrix.
