import 'server-only';
import { z } from 'zod';

/* ─────────────────────────────────────────────────────────────────────────────
   One place that reads the environment, validates it, and hands the rest of the
   application a typed object. A missing provider credential is not an error: it
   makes that provider `configured: false`, which is what the integrations page
   reports and what every adapter refuses on. A missing *core* secret is an
   error, because a platform with no session secret is not a platform.
   ───────────────────────────────────────────────────────────────────────────*/

const bool = (d: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? d : v === 'true' || v === '1' || v === true), z.boolean());
const int = (d: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? d : Number(v)), z.number().int());
/* An optional setting that is present but blank is not set. Every provider
   credential is written into .env.example with an empty value so it is easy to
   find, and an empty value has to mean "not configured" rather than "invalid". */
const str = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().min(1).optional(),
);

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3400'),
  APP_PORT: int(3400),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: int(10),
  DATABASE_SSL: bool(false),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: int(12),
  SESSION_IDLE_MINUTES: int(120),
  FILE_SIGNING_SECRET: z.string().min(32, 'FILE_SIGNING_SECRET must be at least 32 characters'),

  AUTH_MODE: z.enum(['password', 'oidc', 'both']).default('password'),
  PASSWORD_MIN_LENGTH: int(12),
  LOGIN_MAX_ATTEMPTS: int(8),
  LOGIN_LOCKOUT_MINUTES: int(15),
  OIDC_ISSUER: str, OIDC_CLIENT_ID: str, OIDC_CLIENT_SECRET: str,
  OIDC_REDIRECT_URI: str, OIDC_SCOPES: z.string().default('openid email profile'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./.storage'),
  STORAGE_MAX_UPLOAD_MB: int(25),
  S3_ENDPOINT: str, S3_REGION: str, S3_BUCKET: str,
  S3_ACCESS_KEY_ID: str, S3_SECRET_ACCESS_KEY: str, S3_FORCE_PATH_STYLE: bool(true),

  MALWARE_SCANNER: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: int(3310),

  EMAIL_PROVIDER: z.enum(['none', 'smtp', 'ses', 'sendgrid']).default('none'),
  EMAIL_FROM: z.string().default('Bayut KSA Talent Acquisition <ta@bayut.sa>'),
  SMTP_HOST: str, SMTP_PORT: int(587), SMTP_USER: str, SMTP_PASSWORD: str, SMTP_SECURE: bool(false),
  SENDGRID_API_KEY: str, SES_REGION: str, SES_ACCESS_KEY_ID: str, SES_SECRET_ACCESS_KEY: str,

  WHATSAPP_PROVIDER: z.enum(['none', 'meta_cloud', 'twilio']).default('none'),
  WHATSAPP_PHONE_NUMBER_ID: str, WHATSAPP_ACCESS_TOKEN: str,
  WHATSAPP_WEBHOOK_SECRET: str, WHATSAPP_VERIFY_TOKEN: str,

  SMS_PROVIDER: z.enum(['none', 'twilio', 'unifonic']).default('none'),
  SMS_FROM: z.string().default('Bayut'),
  TWILIO_ACCOUNT_SID: str, TWILIO_AUTH_TOKEN: str, UNIFONIC_APP_SID: str,

  LINKEDIN_PROVIDER: z.enum(['none', 'talent_solutions']).default('none'),
  LINKEDIN_CLIENT_ID: str, LINKEDIN_CLIENT_SECRET: str, LINKEDIN_ORGANIZATION_URN: str,

  CALENDAR_PROVIDER: z.enum(['none', 'google', 'microsoft']).default('none'),
  GOOGLE_CALENDAR_CLIENT_ID: str, GOOGLE_CALENDAR_CLIENT_SECRET: str, GOOGLE_CALENDAR_REFRESH_TOKEN: str,
  MS_GRAPH_TENANT_ID: str, MS_GRAPH_CLIENT_ID: str, MS_GRAPH_CLIENT_SECRET: str,

  ESIGN_PROVIDER: z.enum(['none', 'docusign', 'dropbox_sign']).default('none'),
  DOCUSIGN_BASE_URL: str, DOCUSIGN_ACCOUNT_ID: str, DOCUSIGN_INTEGRATION_KEY: str,
  DOCUSIGN_USER_ID: str, DOCUSIGN_PRIVATE_KEY: str, DOCUSIGN_WEBHOOK_SECRET: str,

  VOICE_PROVIDER: z.enum(['none', 'twilio_voice', 'vapi']).default('none'),
  VOICE_FROM_NUMBER: str, VAPI_API_KEY: str, VAPI_ASSISTANT_ID: str, VOICE_WEBHOOK_SECRET: str,
  VOICE_RECORDING_RETENTION_DAYS: int(30),

  HRIS_PROVIDER: z.enum(['none', 'jisr', 'workday']).default('none'),
  HRIS_BASE_URL: str, HRIS_API_KEY: str, HRIS_WEBHOOK_SECRET: str,

  ASSESSMENT_PROVIDER: z.enum(['none', 'thomas', 'shl', 'hogan', 'predictive_index']).default('none'),
  ASSESSMENT_BASE_URL: str, ASSESSMENT_API_KEY: str, ASSESSMENT_WEBHOOK_SECRET: str,

  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: str,
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  AI_MAX_TOKENS: int(4096),

  WORKER_ENABLED: bool(true),
  WORKER_POLL_MS: int(2000),
  WORKER_BATCH: int(20),
  WORKER_MAX_ATTEMPTS: int(6),

  CANDIDATE_RETENTION_MONTHS: int(24),
  AUDIT_RETENTION_MONTHS: int(84),
  RECORDING_RETENTION_DAYS: int(30),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      'The environment is not valid — the platform will not start:\n' + lines.join('\n') +
      '\n\nSee .env.example and docs/environment.md.',
    );
  }
  cached = parsed.data;
  return cached;
}

/* A provider is configured when its mode is set AND every credential it needs is
   present. Anything short of that is reported as "not configured" rather than
   silently behaving as if it worked. */
export type ProviderStatus = { configured: boolean; provider: string; missing: string[] };

function need(provider: string, pairs: Array<[string, unknown]>): ProviderStatus {
  const missing = pairs.filter(([, v]) => !v).map(([k]) => k);
  return { configured: missing.length === 0, provider, missing };
}

export function providers() {
  const e = env();
  return {
    email: e.EMAIL_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['EMAIL_PROVIDER'] }
      : e.EMAIL_PROVIDER === 'smtp'
        ? need('smtp', [['SMTP_HOST', e.SMTP_HOST], ['SMTP_USER', e.SMTP_USER], ['SMTP_PASSWORD', e.SMTP_PASSWORD]])
        : e.EMAIL_PROVIDER === 'sendgrid'
          ? need('sendgrid', [['SENDGRID_API_KEY', e.SENDGRID_API_KEY]])
          : need('ses', [['SES_REGION', e.SES_REGION], ['SES_ACCESS_KEY_ID', e.SES_ACCESS_KEY_ID], ['SES_SECRET_ACCESS_KEY', e.SES_SECRET_ACCESS_KEY]]),

    whatsapp: e.WHATSAPP_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['WHATSAPP_PROVIDER'] }
      : e.WHATSAPP_PROVIDER === 'meta_cloud'
        ? need('meta_cloud', [['WHATSAPP_PHONE_NUMBER_ID', e.WHATSAPP_PHONE_NUMBER_ID], ['WHATSAPP_ACCESS_TOKEN', e.WHATSAPP_ACCESS_TOKEN]])
        : need('twilio', [['TWILIO_ACCOUNT_SID', e.TWILIO_ACCOUNT_SID], ['TWILIO_AUTH_TOKEN', e.TWILIO_AUTH_TOKEN]]),

    sms: e.SMS_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['SMS_PROVIDER'] }
      : e.SMS_PROVIDER === 'twilio'
        ? need('twilio', [['TWILIO_ACCOUNT_SID', e.TWILIO_ACCOUNT_SID], ['TWILIO_AUTH_TOKEN', e.TWILIO_AUTH_TOKEN]])
        : need('unifonic', [['UNIFONIC_APP_SID', e.UNIFONIC_APP_SID]]),

    linkedin: e.LINKEDIN_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['LINKEDIN_PROVIDER'] }
      : need('talent_solutions', [['LINKEDIN_CLIENT_ID', e.LINKEDIN_CLIENT_ID], ['LINKEDIN_CLIENT_SECRET', e.LINKEDIN_CLIENT_SECRET], ['LINKEDIN_ORGANIZATION_URN', e.LINKEDIN_ORGANIZATION_URN]]),

    calendar: e.CALENDAR_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['CALENDAR_PROVIDER'] }
      : e.CALENDAR_PROVIDER === 'google'
        ? need('google', [['GOOGLE_CALENDAR_CLIENT_ID', e.GOOGLE_CALENDAR_CLIENT_ID], ['GOOGLE_CALENDAR_CLIENT_SECRET', e.GOOGLE_CALENDAR_CLIENT_SECRET], ['GOOGLE_CALENDAR_REFRESH_TOKEN', e.GOOGLE_CALENDAR_REFRESH_TOKEN]])
        : need('microsoft', [['MS_GRAPH_TENANT_ID', e.MS_GRAPH_TENANT_ID], ['MS_GRAPH_CLIENT_ID', e.MS_GRAPH_CLIENT_ID], ['MS_GRAPH_CLIENT_SECRET', e.MS_GRAPH_CLIENT_SECRET]]),

    esign: e.ESIGN_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['ESIGN_PROVIDER'] }
      : e.ESIGN_PROVIDER === 'docusign'
        ? need('docusign', [['DOCUSIGN_BASE_URL', e.DOCUSIGN_BASE_URL], ['DOCUSIGN_ACCOUNT_ID', e.DOCUSIGN_ACCOUNT_ID], ['DOCUSIGN_INTEGRATION_KEY', e.DOCUSIGN_INTEGRATION_KEY], ['DOCUSIGN_USER_ID', e.DOCUSIGN_USER_ID], ['DOCUSIGN_PRIVATE_KEY', e.DOCUSIGN_PRIVATE_KEY]])
        : need('dropbox_sign', [['DOCUSIGN_INTEGRATION_KEY', e.DOCUSIGN_INTEGRATION_KEY]]),

    voice: e.VOICE_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['VOICE_PROVIDER'] }
      : e.VOICE_PROVIDER === 'vapi'
        ? need('vapi', [['VAPI_API_KEY', e.VAPI_API_KEY], ['VAPI_ASSISTANT_ID', e.VAPI_ASSISTANT_ID], ['VOICE_FROM_NUMBER', e.VOICE_FROM_NUMBER]])
        : need('twilio_voice', [['TWILIO_ACCOUNT_SID', e.TWILIO_ACCOUNT_SID], ['TWILIO_AUTH_TOKEN', e.TWILIO_AUTH_TOKEN], ['VOICE_FROM_NUMBER', e.VOICE_FROM_NUMBER]]),

    hris: e.HRIS_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['HRIS_PROVIDER'] }
      : need(e.HRIS_PROVIDER, [['HRIS_BASE_URL', e.HRIS_BASE_URL], ['HRIS_API_KEY', e.HRIS_API_KEY]]),

    assessment: e.ASSESSMENT_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['ASSESSMENT_PROVIDER'] }
      : need(e.ASSESSMENT_PROVIDER, [['ASSESSMENT_BASE_URL', e.ASSESSMENT_BASE_URL], ['ASSESSMENT_API_KEY', e.ASSESSMENT_API_KEY]]),

    ai: e.AI_PROVIDER === 'none'
      ? { configured: false, provider: 'none', missing: ['AI_PROVIDER'] }
      : need('anthropic', [['ANTHROPIC_API_KEY', e.ANTHROPIC_API_KEY]]),

    storage: e.STORAGE_DRIVER === 'local'
      ? { configured: true, provider: 'local', missing: [] }
      : need('s3', [['S3_BUCKET', e.S3_BUCKET], ['S3_REGION', e.S3_REGION], ['S3_ACCESS_KEY_ID', e.S3_ACCESS_KEY_ID], ['S3_SECRET_ACCESS_KEY', e.S3_SECRET_ACCESS_KEY]]),

    oidc: e.AUTH_MODE === 'password'
      ? { configured: false, provider: 'none', missing: ['AUTH_MODE'] }
      : need('oidc', [['OIDC_ISSUER', e.OIDC_ISSUER], ['OIDC_CLIENT_ID', e.OIDC_CLIENT_ID], ['OIDC_CLIENT_SECRET', e.OIDC_CLIENT_SECRET]]),

    malware: e.MALWARE_SCANNER === 'none'
      ? { configured: false, provider: 'none', missing: ['MALWARE_SCANNER'] }
      : need('clamav', [['CLAMAV_HOST', e.CLAMAV_HOST]]),
  } as const;
}

export type Providers = ReturnType<typeof providers>;
export type ProviderKey = keyof Providers;
