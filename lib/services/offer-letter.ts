import 'server-only';
import { fmt } from '@/lib/format';

/* ═════════════════════════════════════════════════════════════════════════════
   THE OFFER LETTER

   HR uploads a fixed letter once. When an offer is drafted the platform fills
   that letter from the offer, the candidate, the requisition and the
   organisation's own settings; the onboarding specialist reads the result,
   corrects any field, and marks it verified. Nothing goes to e-signature before
   that, and nothing is sent while a merge field is still unresolved.

   Every field says where its value came from, because the person checking the
   letter is checking exactly that: "reporting to" is the requisition's hiring
   manager, "annual leave" is policy by level, and if one of them is wrong the
   fix belongs upstream rather than in the letter.
   ═════════════════════════════════════════════════════════════════════════════*/

export type LetterContext = {
  offer: {
    id: string;
    createdAt: string;
    startDate: string;
    currency: string | null;
    baseMonthly: number;
    housing: number;
    transport: number;
    annualBonusPct: number;
    fieldOverrides: Record<string, string>;
    letterOverride: string | null;
    templateName: string | null;
    templateBody: string | null;
  };
  candidate: { name: string; email: string | null };
  job: {
    title: string;
    family: string | null;
    employmentType: string | null;
    hiringManager: string | null;
    deptName: string;
    office: string;
    city: string;
    recruiterName: string | null;
  };
  org: {
    orgName: string;
    legalName: string;
    signedBy: string | null;
    probationMonths: number;
  };
  onboarding: { name: string; email: string | null } | null;
};

type Field = [key: string, source: string, value: (x: LetterContext) => string | number | null];

const DAY = 86_400_000;
const COMMERCIAL = ['Sales', 'Integrated Services', 'Projects & Advisory'];

/** Every merge field, what fills it, and where a reader should go to change it. */
export const MERGE: Field[] = [
  ['company', 'Settings', (x) => x.org.orgName],
  ['legal_entity', 'Settings', (x) => x.org.legalName],
  ['offer_date', 'Offer', (x) => fmt.date(x.offer.createdAt)],
  ['expiry_date', 'Offer · created + 7 days', (x) => fmt.date(new Date(Date.parse(x.offer.createdAt) + 7 * DAY).toISOString())],
  ['candidate_name', 'Candidate', (x) => x.candidate.name],
  ['first_name', 'Candidate', (x) => fmt.first(x.candidate.name)],
  ['candidate_email', 'Candidate', (x) => x.candidate.email],
  ['job_title', 'Requisition', (x) => x.job.title],
  ['department', 'Requisition', (x) => x.job.deptName],
  ['location', 'Requisition', (x) => (x.job.office === 'Remote'
    ? 'your home office (remote, Kingdom-wide)' : `${x.job.office}, ${x.job.city}`)],
  ['reporting_to', 'Requisition · hiring manager', (x) => x.job.hiringManager],
  ['recruiter_name', 'Requisition · owner', (x) => x.job.recruiterName],
  ['start_date', 'Offer', (x) => fmt.date(x.offer.startDate)],
  ['contract_type', 'Requisition', (x) => ({
    full_time: 'Full-time employment on an indefinite-term contract',
    part_time: 'Part-time employment',
    contract: 'Employment on a fixed-term contract',
    intern: 'A paid internship',
  }[x.job.employmentType ?? 'full_time'] ?? 'Full-time employment')],
  ['work_week', 'Policy', () => 'Sunday to Thursday, 09:00 to 18:00 (AST)'],
  ['currency', 'Offer', (x) => x.offer.currency || 'SAR'],
  ['base_monthly', 'Offer terms', (x) => fmt.int(x.offer.baseMonthly)],
  ['housing_allowance', 'Offer terms', (x) => fmt.int(x.offer.housing)],
  ['transport_allowance', 'Offer terms', (x) => fmt.int(x.offer.transport)],
  ['total_monthly', 'Offer terms', (x) => fmt.int(x.offer.baseMonthly + x.offer.housing + x.offer.transport)],
  ['annual_bonus', 'Offer terms', (x) => (x.offer.annualBonusPct
    ? `up to ${x.offer.annualBonusPct}% of annual basic salary` : 'nil for this role')],
  ['probation_months', 'Policy', (x) => String(x.org.probationMonths)],
  ['annual_leave_days', 'Policy · by level',
    (x) => (/Senior|Head|Lead|Manager|Director|Principal|Staff/.test(x.job.title) ? '30' : '21')],
  ['notice_period_days', 'Policy', () => '60'],
  ['signatory', 'Settings', (x) => (x.org.signedBy ?? '').split(',')[0].trim() || null],
  ['signatory_title', 'Settings', (x) => ((x.org.signedBy ?? '').split(',')[1] ?? '').trim() || null],
  ['onboarding_contact', 'Team', (x) => (x.onboarding ? `${x.onboarding.name} (${x.onboarding.email ?? ''})` : null)],
  ['commission_plan', 'Requisition · commercial only',
    (x) => (COMMERCIAL.includes(x.job.family ?? '') ? 'Bayut KSA Commercial Incentive Plan (CIP)' : null)],
  ['ote_annual', 'Requisition · commercial only',
    (x) => (COMMERCIAL.includes(x.job.family ?? '')
      ? fmt.int((x.offer.baseMonthly + x.offer.housing + x.offer.transport) * 12 * 1.5) : null)],
];

export const MERGE_SOURCE: Record<string, string> = Object.fromEntries(MERGE.map(([k, s]) => [k, s]));

/** Fields that follow the offer terms; edit them through the terms, not by hand. */
export const TERM_FIELDS = [
  'base_monthly', 'housing_allowance', 'transport_allowance', 'total_monthly',
  'annual_bonus', 'currency', 'start_date', 'offer_date', 'expiry_date',
];

/** The merge fields a body actually contains, without their braces. What an
    uploaded template is checked against: a field nobody can fill is a brace
    the candidate reads. */
export function mergeFields(body: string | null): string[] {
  return [...new Set(
    [...String(body ?? '').matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]),
  )];
}

export function mergeValues(x: LetterContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, , fn] of MERGE) {
    let v: string | number | null = null;
    try { v = fn(x); } catch { v = null; }
    if (v != null && v !== '') out[k] = String(v);
  }
  /* A correction the specialist typed wins over the computed value, and is
     recorded as an edit so the letter's history says who changed what. */
  for (const [k, v] of Object.entries(x.offer.fieldOverrides ?? {})) {
    if (v != null && String(v).trim() !== '') out[k] = String(v);
  }
  return out;
}

export function fill(body: string | null, vals: Record<string, string>): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = String(body ?? '').replace(/\{\{([a-z0-9_]+)\}\}/g, (m, k: string) => {
    if (vals[k] != null) return vals[k];
    if (!unresolved.includes(k)) unresolved.push(k);
    return m;
  });
  return { text, unresolved };
}

export type Letter = {
  text: string;
  unresolved: string[];
  src: string;
  vals: Record<string, string>;
  templateName: string | null;
  edited: boolean;
  missing: boolean;
};

/** The letter as it stands: the hand-edited wording if there is one, otherwise
    the template filled fresh from today's data. */
export function offerLetter(x: LetterContext): Letter {
  const vals = mergeValues(x);
  const src = x.offer.letterOverride != null ? x.offer.letterOverride : (x.offer.templateBody ?? '');
  return {
    ...fill(src, vals),
    src,
    vals,
    templateName: x.offer.templateName,
    edited: x.offer.letterOverride != null,
    missing: !x.offer.templateBody && x.offer.letterOverride == null,
  };
}

export type Check = { k: string; ok: boolean; t: string };

/** Whether this offer may leave the building, and what is stopping it. */
export function sendReadiness(
  state: string, letter: Letter, verifiedByName: string | null,
): { checks: Check[]; ready: boolean } {
  const n = letter.unresolved.length;
  const checks: Check[] = [
    {
      k: 'approved',
      ok: state !== 'draft' && state !== 'pending_approval',
      t: state === 'draft' ? 'Not yet submitted for approval'
        : state === 'pending_approval' ? 'Approval chain still open' : 'Approved by the chain',
    },
    {
      k: 'template',
      ok: !letter.missing,
      t: letter.missing ? 'No letter template attached'
        : `Letter: ${letter.templateName ?? 'edited wording'}`,
    },
    {
      k: 'fields',
      ok: !n,
      t: n ? `${n} merge field${n === 1 ? '' : 's'} unresolved` : 'Every merge field resolved',
    },
    {
      k: 'verified',
      ok: !!verifiedByName,
      t: verifiedByName ? `Verified by ${verifiedByName}` : 'Not yet verified by Onboarding',
    },
  ];
  return { checks, ready: checks.every((c) => c.ok) };
}

/* The four documents the envelope collects before the signature page. The list
   is created when the offer goes out and travels with the joiner into
   onboarding, where each one is verified. */
export const OFFER_DOCS: Array<[key: string, label: string, hint: string]> = [
  ['national_id', 'National ID / Iqama', 'A clear copy, both sides'],
  ['education', 'Education certificate', 'Highest degree, attested if issued abroad'],
  ['photo', 'Personal photo', 'Passport style, plain background'],
  ['iban', 'Bank IBAN letter', "Stamped by the bank, in the joiner's name"],
];
