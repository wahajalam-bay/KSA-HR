import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  offers, offerMessages, offerDocuments, offerTemplates, applications, candidates, jobs,
  departments, locations, staff, approvals, approvalSteps, orgSettings,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { fmt } from '@/lib/format';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { offerLetter, sendReadiness, type Check, type LetterContext } from '@/lib/services/offer-letter';

/* ═════════════════════════════════════════════════════════════════════════════
   THE OFFER STAGE

   The offer is where a hire is won or lost, and it is the one stage that lives
   in three places at once — the letter, the e-signature envelope and the
   conversation with the candidate. This puts all of it in one list: where each
   offer stands, what the candidate asked, what they answered, and what is
   waiting on us.

   The "waiting on" column is the point of the screen. It is computed in one
   place, in the order that actually matters: an unanswered question from the
   candidate beats everything, then the approval chain, then the letter, then
   the signature.
   ═════════════════════════════════════════════════════════════════════════════*/

export const OFFER_TABS = [
  { v: 'live', t: 'In flight' },
  { v: 'approval', t: 'In approval' },
  { v: 'out', t: 'With the candidate' },
  { v: 'answered', t: 'Answered' },
  { v: 'all', t: 'Everyone' },
] as const;

export const OFFER_STATE: Record<string, [string, string]> = {
  draft: ['Draft', ''],
  pending_approval: ['Pending approval', 'warn'],
  approved: ['Approved', 'info'],
  sent: ['Sent', 'info'],
  viewed: ['Viewed', 'info'],
  signed: ['Signed', 'ok'],
  accepted: ['Accepted', 'brand'],
  declined: ['Declined', 'bad'],
  expired: ['Expired', ''],
  withdrawn: ['Withdrawn', ''],
};

const IN_APPROVAL = ['draft', 'pending_approval', 'approved'];

export type OfferRow = {
  applicationId: string;
  offerId: string;
  state: string;
  bucket: 'approval' | 'out' | 'answered';
  candidate: { id: string; name: string; photo: string | null; hue: number; currentTitle: string | null; sector: string | null; currentSalary: number | null };
  job: { id: string; title: string; deptId: string; deptName: string; recruiterName: string | null };
  baseMonthly: number;
  total: number;
  startDate: string;
  sentAt: string | null;
  createdAt: string;
  response: { state: string; reason: string | null } | null;
  questions: { n: number; asked: number; answered: number; open: boolean; lastAt: string | null; lastBody: string | null };
  askedDays: string[];
  docsMissing: number;
  checks: Check[];
  ready: boolean;
  approvalStep: string | null;
  todo: { t: string; tone: string; act: string | null } | null;
};

export async function offerBoard(
  v: Viewer, now: Date, exec: Exec = db(),
): Promise<OfferRow[]> {
  const scope = sql`a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;

  /* Everyone at the offer stage, plus anyone whose offer was answered inside
     the last four months — the row is the offer, the person is the point. */
  const list = rowsOf(await exec.execute(sql`
    SELECT o.id AS offer_id, o.application_id, o.state::text AS state, o.base_monthly, o.housing,
           o.transport, o.annual_bonus_pct, o.currency, o.start_date::text AS start_date,
           o.sent_at, o.created_at, o.template_id, o.template_name, o.letter_override,
           o.field_overrides, o.response_state::text AS response_state, o.response_reason,
           o.verified_at, vb.name AS verified_by_name,
           c.id AS candidate_id, c.name AS candidate_name, c.photo, c.hue, c.current_title,
           c.sector, c.current_salary, c.email AS candidate_email,
           j.id AS job_id, j.title AS job_title, j.dept_id, j.family, j.employment_type,
           j.hiring_manager, d.name AS dept_name, l.office, l.city,
           r.name AS recruiter_name,
           t.body AS template_body
      FROM ${offers} o
      JOIN ${applications} a ON a.id = o.application_id
      JOIN ${candidates} c ON c.id = o.candidate_id
      JOIN ${jobs} j ON j.id = o.job_id
      JOIN ${departments} d ON d.id = j.dept_id
      JOIN ${locations} l ON l.id = j.location_id
      LEFT JOIN ${staff} r ON r.id = j.recruiter_id
      LEFT JOIN ${staff} vb ON vb.id = o.verified_by
      LEFT JOIN ${offerTemplates} t ON t.id = o.template_id
     WHERE ${scope}
       AND (
         (a.stage = 'offer' AND a.status IN ('active','on_hold'))
         OR (a.status NOT IN ('active','on_hold') AND o.state IN ('accepted','declined')
             AND coalesce(o.response_at, a.closed_at) >= ${at(now)} - interval '120 days')
       )`));

  if (!list.length) return [];

  const ids = list.map((r) => r.offer_id);
  const inIds = sql.join(ids.map((i) => sql`${i}`), sql`, `);

  const [msgRows, docRows, stepRows, orgRow, onbRow] = await Promise.all([
    exec.execute(sql`
      SELECT m.offer_id, m.from_party::text AS from_party, m.body, m.at
        FROM ${offerMessages} m WHERE m.offer_id IN (${inIds}) ORDER BY m.at ASC`),
    exec.execute(sql`
      SELECT d.offer_id, count(*) FILTER (WHERE d.status = 'missing')::int AS missing
        FROM ${offerDocuments} d WHERE d.offer_id IN (${inIds}) GROUP BY 1`),
    exec.execute(sql`
      SELECT ap.subject_id, st.approver_name
        FROM ${approvals} ap
        LEFT JOIN LATERAL (
          SELECT * FROM ${approvalSteps} s WHERE s.approval_id = ap.id AND s.state = 'pending'
           ORDER BY s.ordinal LIMIT 1) st ON true
       WHERE ap.subject = 'offer' AND ap.state = 'pending'
         AND ap.subject_id IN (${inIds})`),
    exec.select().from(orgSettings).limit(1),
    exec.execute(sql`
      SELECT name, email FROM ${staff} WHERE role = 'onboarding' AND status <> 'deleted' LIMIT 1`),
  ]);

  const msgs = new Map<string, Array<{ from: string; body: string; at: string }>>();
  for (const m of rowsOf(msgRows)) {
    msgs.set(m.offer_id, [...(msgs.get(m.offer_id) ?? []),
      { from: m.from_party, body: m.body, at: String(m.at) }]);
  }
  const missing = new Map(rowsOf(docRows).map((r) => [r.offer_id, Number(r.missing)]));
  const pendingStep = new Map(rowsOf(stepRows).map((r) => [r.subject_id, r.approver_name as string | null]));
  const org = orgRow[0];
  const onb = rowsOf(onbRow)[0] ?? null;

  const out = list.map((r): OfferRow => {
    const thread = msgs.get(r.offer_id) ?? [];
    const last = thread[thread.length - 1];
    const questions = {
      n: thread.length,
      asked: thread.filter((m) => m.from === 'candidate').length,
      answered: thread.filter((m) => m.from === 'staff').length,
      open: !!last && last.from === 'candidate',
      lastAt: last ? last.at : null,
      lastBody: last ? last.body : null,
    };
    const askedDays = thread.filter((m) => m.from === 'candidate').map((m) => m.at.slice(0, 10));

    const ctx: LetterContext = {
      offer: {
        id: r.offer_id, createdAt: String(r.created_at), startDate: r.start_date,
        currency: r.currency, baseMonthly: Number(r.base_monthly), housing: Number(r.housing),
        transport: Number(r.transport), annualBonusPct: Number(r.annual_bonus_pct),
        fieldOverrides: r.field_overrides ?? {}, letterOverride: r.letter_override,
        templateName: r.template_name, templateBody: r.template_body,
      },
      candidate: { name: r.candidate_name, email: r.candidate_email },
      job: {
        title: r.job_title, family: r.family, employmentType: r.employment_type,
        hiringManager: r.hiring_manager, deptName: r.dept_name, office: r.office, city: r.city,
        recruiterName: r.recruiter_name,
      },
      org: {
        orgName: String(org?.orgName ?? 'Bayut KSA'),
        legalName: String(org?.legalName ?? 'Bayut Saudi Arabia'),
        signedBy: org?.signedBy ?? null,
        probationMonths: Number(org?.probationMonths ?? 3),
      },
      onboarding: onb ? { name: onb.name, email: onb.email } : null,
    };
    const letter = offerLetter(ctx);
    const { checks, ready } = sendReadiness(r.state, letter, r.verified_by_name ?? (r.verified_at ? 'Onboarding' : null));

    const docsMissing = missing.get(r.offer_id) ?? 0;
    const step = r.state === 'pending_approval' ? pendingStep.get(r.offer_id) ?? null : null;
    const first = fmt.first(r.candidate_name);

    /* What is actually waiting on the team, in the order it matters. */
    const todo = questions.open
      ? { t: `Answer ${first}'s question`, tone: 'warn', act: 'offer.qa' }
      : r.state === 'pending_approval' && step
        ? { t: `Approval with ${step}`, tone: 'warn', act: null }
        : r.state === 'approved' && !ready
          ? { t: checks.find((x) => !x.ok)?.t ?? 'Verify the letter', tone: 'warn', act: null }
          : r.state === 'approved'
            ? { t: 'Send for signature', tone: 'ok', act: 'offer.send' }
            : r.state === 'draft'
              ? { t: 'Submit for approval', tone: '', act: 'offer.submit' }
              : ['sent', 'viewed'].includes(r.state) && docsMissing
                ? { t: `${docsMissing} document${docsMissing === 1 ? '' : 's'} outstanding`, tone: 'warn', act: null }
                : r.state === 'viewed'
                  ? { t: 'Waiting on the signature', tone: '', act: null }
                  : r.state === 'sent'
                    ? { t: 'Waiting for them to open it', tone: '', act: null }
                    : r.state === 'signed'
                      ? { t: 'Record the answer', tone: 'ok', act: 'offer.accept' }
                      : null;

    return {
      applicationId: r.application_id,
      offerId: r.offer_id,
      state: r.state,
      bucket: ['accepted', 'declined', 'expired'].includes(r.state) ? 'answered'
        : IN_APPROVAL.includes(r.state) ? 'approval' : 'out',
      candidate: {
        id: r.candidate_id, name: r.candidate_name, photo: r.photo, hue: Number(r.hue ?? 3),
        currentTitle: r.current_title, sector: r.sector,
        currentSalary: r.current_salary == null ? null : Number(r.current_salary),
      },
      job: {
        id: r.job_id, title: r.job_title, deptId: r.dept_id, deptName: r.dept_name,
        recruiterName: r.recruiter_name,
      },
      baseMonthly: Number(r.base_monthly),
      total: Number(r.base_monthly) + Number(r.housing) + Number(r.transport),
      startDate: r.start_date,
      sentAt: r.sent_at ? String(r.sent_at) : null,
      createdAt: String(r.created_at),
      response: r.response_state ? { state: r.response_state, reason: r.response_reason } : null,
      questions,
      askedDays,
      docsMissing,
      checks,
      ready,
      approvalStep: step,
      todo,
    };
  });

  /* An open question first, then oldest first by when the offer went out. */
  return out.sort((a, b) => {
    const ka = (a.questions.open ? '0' : '1') + (a.sentAt ?? a.createdAt);
    const kb = (b.questions.open ? '0' : '1') + (b.sentAt ?? b.createdAt);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

