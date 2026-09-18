import 'server-only';
import { env, providers } from '@/lib/env';
import { call, hmacHex, sameSignature, refuse } from './http';
import {
  notConfigured, sent, type AssessmentAdapter, type AssessmentInvite,
  type HrisAdapter, type JoinerPayload, type JobBoardAdapter, type Posting,
  type AiAdapter, type Status,
} from './types';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SYSTEMS BEHIND THE LOOP

   The assessment house, the HRIS, the job board and the model. None of them is
   in the candidate's path every day, and each of them is the sort of thing that
   quietly stops working — a rotated key, an expired token — so all four report
   what went wrong in the words the integrations page shows, rather than
   swallowing it.
   ═════════════════════════════════════════════════════════════════════════════*/

const statusOf = (key: 'assessment' | 'hris' | 'linkedin' | 'ai'): Status => {
  const p = providers()[key];
  return { key, provider: p.provider, configured: p.configured, missing: [...p.missing] };
};

/* ── Behavioural assessments ─────────────────────────────────────────────── */

function assessmentHouse(): AssessmentAdapter {
  return {
    key: 'assessment',
    status: () => statusOf('assessment'),
    async invite(input) {
      const e = env();
      const r = await call<{ id?: string; link?: string; url?: string }>({
        label: 'The assessment provider',
        url: `${e.ASSESSMENT_BASE_URL}/v1/assessments`,
        headers: {
          authorization: `Bearer ${e.ASSESSMENT_API_KEY}`,
          'idempotency-key': input.idempotencyKey,
        },
        body: {
          candidate: { name: input.candidate.name, email: input.candidate.email },
          assessment: input.kind,
          callback_url: `${e.APP_URL}/api/webhooks/assessment`,
          return_url: input.returnUrl,
        },
      });
      if (!r.ok) return r;
      const id = r.detail?.data?.id ?? null;
      const link = r.detail?.data?.link ?? r.detail?.data?.url ?? null;
      if (!id || !link) return refuse('The assessment provider gave no reference back');
      return sent(id, { assessmentRef: id, link });
    },
    async fetch(ref) {
      const e = env();
      const r = await call<{
        status?: string; score?: number;
        traits?: Array<{ name: string; score: number }>; report_url?: string;
      }>({
        label: 'The assessment provider',
        url: `${e.ASSESSMENT_BASE_URL}/v1/assessments/${encodeURIComponent(ref)}`,
        headers: { authorization: `Bearer ${e.ASSESSMENT_API_KEY}` },
      });
      if (!r.ok) return r;
      const d = r.detail?.data ?? {};
      return sent(ref, {
        status: d.status ?? 'unknown',
        score: d.score,
        traits: d.traits,
        reportUrl: d.report_url,
      });
    },
    verify(raw, headers) {
      const secret = env().ASSESSMENT_WEBHOOK_SECRET;
      const given = headers['x-signature'] ?? headers['x-webhook-signature'] ?? '';
      if (!secret || !given) return false;
      return sameSignature(given.replace(/^sha256=/, ''), hmacHex(secret, raw));
    },
  };
}

function noAssessment(): AssessmentAdapter {
  const no = () => notConfigured('The assessment provider', statusOf('assessment').missing);
  return {
    key: 'assessment',
    status: () => statusOf('assessment'),
    async invite() { return no(); },
    async fetch() { return no(); },
    verify() { return false; },
  };
}

export function assessmentAdapter(): AssessmentAdapter {
  return providers().assessment.configured ? assessmentHouse() : noAssessment();
}

/* ── HRIS ────────────────────────────────────────────────────────────────── */

function hris(): HrisAdapter {
  return {
    key: 'hris',
    status: () => statusOf('hris'),
    async pushJoiner(joiner) {
      const e = env();
      const r = await call<{ id?: string; employee_id?: string }>({
        label: 'The HRIS',
        url: `${e.HRIS_BASE_URL}/v1/employees`,
        headers: {
          authorization: `Bearer ${e.HRIS_API_KEY}`,
          'idempotency-key': joiner.idempotencyKey,
        },
        body: {
          employee_number: joiner.employeeCode,
          full_name: joiner.name,
          job_title: joiner.title,
          department: joiner.department,
          start_date: joiner.startDate,
          location: joiner.locationCity,
        },
      });
      if (!r.ok) return r;
      const id = r.detail?.data?.id ?? r.detail?.data?.employee_id ?? null;
      return id ? sent(id, { hrisId: id }) : refuse('The HRIS gave no employee id back');
    },
    verify(raw, headers) {
      const secret = env().HRIS_WEBHOOK_SECRET;
      const given = headers['x-signature'] ?? '';
      if (!secret || !given) return false;
      return sameSignature(given.replace(/^sha256=/, ''), hmacHex(secret, raw));
    },
  };
}

function noHris(): HrisAdapter {
  return {
    key: 'hris',
    status: () => statusOf('hris'),
    async pushJoiner() { return notConfigured('The HRIS', statusOf('hris').missing); },
    verify() { return false; },
  };
}

export function hrisAdapter(): HrisAdapter {
  return providers().hris.configured ? hris() : noHris();
}

/* ── LinkedIn ────────────────────────────────────────────────────────────── */

function linkedin(): JobBoardAdapter {
  return {
    key: 'linkedin',
    status: () => statusOf('linkedin'),
    async publish(posting) {
      const e = env();
      const r = await call<{ id?: string; jobPostingUrl?: string }>({
        label: 'LinkedIn',
        url: 'https://api.linkedin.com/rest/simpleJobPostings',
        headers: {
          authorization: `Bearer ${e.LINKEDIN_CLIENT_SECRET}`,
          'linkedin-version': '202405',
          'x-restli-protocol-version': '2.0.0',
        },
        body: {
          integrationContext: e.LINKEDIN_ORGANIZATION_URN,
          externalJobPostingId: posting.idempotencyKey,
          title: posting.title,
          description: posting.description,
          location: posting.city ?? 'Riyadh, Saudi Arabia',
          employmentStatus: posting.employmentType ?? 'FULL_TIME',
          companyApplyUrl: posting.applyUrl,
          listedAt: Date.now(),
        },
      });
      if (!r.ok) return r;
      const id = r.detail?.data?.id ?? posting.idempotencyKey;
      return sent(id, {
        postingId: id,
        url: r.detail?.data?.jobPostingUrl ?? `https://www.linkedin.com/jobs/view/${id}`,
      });
    },
    async close(postingId) {
      const e = env();
      const r = await call({
        label: 'LinkedIn',
        method: 'POST',
        url: 'https://api.linkedin.com/rest/simpleJobPostings?action=close',
        headers: {
          authorization: `Bearer ${e.LINKEDIN_CLIENT_SECRET}`,
          'linkedin-version': '202405',
        },
        body: { externalJobPostingIds: [postingId] },
      });
      return r.ok ? sent(postingId) : r;
    },
  };
}

function noLinkedIn(): JobBoardAdapter {
  const no = () => notConfigured('LinkedIn', statusOf('linkedin').missing);
  return {
    key: 'linkedin',
    status: () => statusOf('linkedin'),
    async publish() { return no(); },
    async close() { return no(); },
  };
}

export function jobBoardAdapter(): JobBoardAdapter {
  return providers().linkedin.configured ? linkedin() : noLinkedIn();
}

/* ── The model ───────────────────────────────────────────────────────────── */

function anthropic(): AiAdapter {
  return {
    key: 'ai',
    status: () => statusOf('ai'),
    async json<T>(input: { prompt: string; system?: string; maxTokens?: number }) {
      const e = env();
      const r = await call<{
        content?: Array<{ type: string; text?: string }>;
        model?: string;
      }>({
        label: 'Claude',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': e.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
        },
        timeoutMs: 60_000,
        body: {
          model: e.ANTHROPIC_MODEL,
          max_tokens: input.maxTokens ?? e.AI_MAX_TOKENS,
          system: input.system
            ?? 'Reply with JSON only. No preamble, no code fence, no explanation.',
          messages: [{ role: 'user', content: input.prompt }],
        },
      });
      if (!r.ok) return r;

      const text = (r.detail?.data?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
        .trim();
      const body = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        return sent(null, { value: JSON.parse(body) as T, model: r.detail?.data?.model ?? e.ANTHROPIC_MODEL });
      } catch {
        /* A model that did not answer in JSON is a failure worth retrying once,
           not something to half-parse into a record. */
        return refuse('Claude did not answer with JSON');
      }
    },
  };
}

function noAi(): AiAdapter {
  return {
    key: 'ai',
    status: () => statusOf('ai'),
    async json() { return notConfigured('The assistant', statusOf('ai').missing); },
  };
}

export function aiAdapter(): AiAdapter {
  return providers().ai.configured ? anthropic() : noAi();
}
