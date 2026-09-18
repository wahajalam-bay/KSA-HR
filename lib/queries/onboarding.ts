import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  employees, onboardingRecords, onboardingDocuments, references, joiningNotices,
  probationRecords, notifiedTeams, notifiedTeamContacts, departments, locations, jobs,
  jobHiringManagers, staff, offers, applications, candidates,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import {
  PROBATION_MONTHS, addMonths, type ProbationRow,
} from '@/lib/domain/probation';
import { inWindow, type Window } from '@/lib/domain/window';

/* ═════════════════════════════════════════════════════════════════════════════
   ONBOARDING

   Every accepted offer becomes a joiner here the moment the employee ID is
   issued, with the checklist to complete before day one: the form, the four
   documents, the reference check, the joining date confirmed to the departments
   that prepare for day one, and the joiner's file sent on to IT and HR
   Operations.

   The checklist is three things, not one — form, documents, references — and the
   record is only "ready for day one" when all three are in. Nothing here marks
   itself complete on a guess.
   ═════════════════════════════════════════════════════════════════════════════*/

export const ONB_TABS = [
  { v: 'progress', t: 'In progress' },
  { v: 'ready', t: 'Ready for day one' },
  { v: 'started', t: 'Started' },
  { v: 'probation', t: 'Probation' },
  { v: 'all', t: 'All joiners' },
] as const;

export const RATINGS: Record<string, { label: string; icon: string; tone: string; text: string }> = {
  up: { label: 'Thumbs up', icon: 'thumbUp', tone: 'ok', text: 'Positive' },
  down: { label: 'Thumbs down', icon: 'thumbDown', tone: 'bad', text: 'Concern' },
  star: { label: 'Star', icon: 'star', tone: 'brand', text: 'Outstanding' },
};

export const DOC_HINTS: Record<string, string> = {
  national_id: 'A clear copy, both sides',
  education: 'Highest degree, attested if issued abroad',
  photo: 'Passport style, plain background',
  iban: "Stamped by the bank, in the joiner's name",
};

export type JoinerDoc = {
  key: string; label: string; status: string; file: string | null;
  uploadedAt: string | null; verifiedAt: string | null; verifiedByName: string | null;
};

export type JoinerRef = {
  id: string; name: string; title: string | null; company: string | null;
  relationship: string | null; contact: string | null; status: string;
  rating: string | null; notes: string | null; answeredAt: string | null;
  recordedByName: string | null;
};

export type Joiner = {
  id: string;
  employeeCode: string;
  name: string;
  /* From the candidate record, and null when the joiner never was one. The
     onboarding board and the joiner's own record show it; the probation table
     and the quality report show the employee row, which carries no portrait. */
  photo: string | null;
  hue: number | null;
  candidateId: string | null;
  applicationId: string | null;
  offerId: string | null;
  jobId: string | null;
  positionCode: string | null;
  deptId: string;
  deptName: string;
  title: string;
  city: string | null;
  startDate: string;
  status: string;
  acceptedAt: string | null;
  recruiterName: string | null;
  /** How the application that became this hire arrived. */
  sourceLabel: string | null;
  hiringManagers: string[];
  form: {
    sentAt: string | null; submittedAt: string | null;
    nationalId: string | null; nationality: string | null; dob: string | null;
    address: string | null; emergencyContact: string | null; bank: string | null; iban: string | null;
  };
  completedAt: string | null;
  documents: JoinerDoc[];
  references: JoinerRef[];
  notice: { at: string; byName: string | null; startDate: string | null; teams: Array<{ key: string; short: string; name: string; head: string | null }>; again: number } | null;
  fileSent: Record<string, { at: string; byName: string | null; to: string | null; docs: number; people: number }>;
  probation: ProbationRow;
  bucket: 'progress' | 'ready' | 'started';
  progress: {
    verified: number; uploaded: number; total: number; form: boolean;
    refs: { n: number; done: number; ok: boolean; outcome: string | null };
  };
};

export type Team = {
  key: string; short: string; name: string; deptId: string | null;
  purpose: string | null; ask: string | null; onJoining: boolean; onFile: boolean;
  contacts: Array<{ name: string; email: string; isPrimary: boolean }>;
  head: string | null; email: string | null;
};

export async function teams(exec: Exec = db()): Promise<Team[]> {
  const rows = rowsOf(await exec.execute(sql`
    SELECT t.id, t.key, t.short, t.name, t.dept_id, t.purpose, t.ask, t.on_joining, t.on_file,
           d.name AS dept_name, d.head AS dept_head,
           coalesce((SELECT json_agg(json_build_object('name', c.name, 'email', c.email, 'isPrimary', c.is_primary)
                                     ORDER BY c.is_primary DESC, c.sort_order)
                       FROM ${notifiedTeamContacts} c WHERE c.team_id = t.id), '[]'::json) AS contacts
      FROM ${notifiedTeams} t
      LEFT JOIN ${departments} d ON d.id = t.dept_id
     WHERE t.archived_at IS NULL
     ORDER BY t.sort_order, t.key`));
  return rows.map((r) => {
    const contacts = (r.contacts ?? []) as Team['contacts'];
    const lead = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
    return {
      key: r.key, short: r.short, name: r.dept_name ?? r.name, deptId: r.dept_id,
      purpose: r.purpose, ask: r.ask, onJoining: r.on_joining, onFile: r.on_file,
      contacts,
      head: lead ? lead.name : r.dept_head ?? null,
      email: lead ? lead.email : null,
    };
  });
}

/** Every joiner this account may see, with their whole checklist.

    Onboarding lists the people still here; probation and quality of hire have to
    count the ones who were let go as well, or the rate only ever measures the
    hires that went well. */
export async function joiners(
  v: Viewer, now: Date, opts: { includeLeft?: boolean } = {}, exec: Exec = db(),
): Promise<Joiner[]> {
  const scope = v.scope.kind === 'all'
    ? sql`true`
    : sql`(e.job_id IS NULL OR e.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)}))`;

  const rows = rowsOf(await exec.execute(sql`
    SELECT e.id, e.employee_code, e.name, e.candidate_id, e.application_id, e.offer_id, e.job_id,
           e.position_code, e.dept_id, e.title, e.start_date::text AS start_date, e.status::text AS status,
           d.name AS dept_name, l.city, c.photo, c.hue,
           r.name AS recruiter_name,
           coalesce(o.signed_at, a.closed_at, e.created_at) AS accepted_at, a.source AS app_source,
           ob.form_sent_at, ob.form_submitted_at, ob.national_id, ob.nationality, ob.dob::text AS dob,
           ob.address, ob.emergency_contact, ob.bank, ob.iban, ob.completed_at,
           p.starts_on::text AS p_starts, p.ends_on::text AS p_ends, p.state::text AS p_state,
           p.decided_on::text AS p_decided, p.decided_by_name AS p_by, p.reason AS p_reason, p.note AS p_note,
           coalesce((SELECT json_agg(json_build_object(
                       'name', h.name, 'isLead', h.is_lead) ORDER BY h.is_lead DESC, h.sort_order)
                       FROM ${jobHiringManagers} h WHERE h.job_id = e.job_id), '[]'::json) AS hms
      FROM ${employees} e
      JOIN ${departments} d ON d.id = e.dept_id
      LEFT JOIN ${locations} l ON l.id = e.location_id
      LEFT JOIN ${candidates} c ON c.id = e.candidate_id
      LEFT JOIN ${jobs} j ON j.id = e.job_id
      LEFT JOIN ${staff} r ON r.id = j.recruiter_id
      LEFT JOIN ${offers} o ON o.id = e.offer_id
      LEFT JOIN ${applications} a ON a.id = e.application_id
      LEFT JOIN ${onboardingRecords} ob ON ob.employee_id = e.id
      LEFT JOIN ${probationRecords} p ON p.employee_id = e.id
     WHERE e.source = 'hire' AND ${opts.includeLeft ? sql`true` : sql`e.status <> 'left'`} AND ${scope}
     /* In the order they were hired. The board sorts by start date on top
        of this, and two people starting the same day then keep the order
        they were hired in rather than whatever the planner returns. */
     ORDER BY a.closed_at, e.id`));

  if (!rows.length) return [];
  const ids = sql.join(rows.map((r) => sql`${r.id}`), sql`, `);

  const [docRows, refRows, noticeRows] = await Promise.all([
    exec.execute(sql`
      SELECT d.employee_id, d.key, d.label, d.status::text AS status, d.file_id, d.uploaded_at,
             d.verified_at, s.name AS verified_by_name
        FROM ${onboardingDocuments} d
        LEFT JOIN ${staff} s ON s.id = d.verified_by
       WHERE d.employee_id IN (${ids}) ORDER BY d.sort_order`),
    exec.execute(sql`
      SELECT r.id, r.employee_id, r.name, r.title, r.company, r.relationship, r.contact,
             r.status::text AS status, r.rating, r.notes, r.answered_at, s.name AS recorded_by_name
        FROM ${references} r
        LEFT JOIN ${staff} s ON s.id = r.recorded_by
       WHERE r.employee_id IN (${ids}) ORDER BY r.created_at`),
    exec.execute(sql`
      SELECT n.employee_id, n.kind, n.team_key, n.start_date::text AS start_date, n.sent_at,
             n.to_name, n.document_count, n.cc_emails, s.name AS sent_by_name,
             t.short, t.name AS team_name
        FROM ${joiningNotices} n
        LEFT JOIN ${staff} s ON s.id = n.sent_by
        LEFT JOIN ${notifiedTeams} t ON t.key = n.team_key
       WHERE n.employee_id IN (${ids}) ORDER BY n.sent_at ASC`),
  ]);

  const docs = new Map<string, JoinerDoc[]>();
  for (const d of rowsOf(docRows)) {
    docs.set(d.employee_id, [...(docs.get(d.employee_id) ?? []), {
      key: d.key, label: d.label, status: d.status, file: d.file_id,
      uploadedAt: d.uploaded_at ? String(d.uploaded_at) : null,
      verifiedAt: d.verified_at ? String(d.verified_at) : null,
      verifiedByName: d.verified_by_name,
    }]);
  }
  const refs = new Map<string, JoinerRef[]>();
  for (const r of rowsOf(refRows)) {
    refs.set(r.employee_id, [...(refs.get(r.employee_id) ?? []), {
      id: r.id, name: r.name, title: r.title, company: r.company, relationship: r.relationship,
      contact: r.contact, status: r.status, rating: r.rating, notes: r.notes,
      answeredAt: r.answered_at ? String(r.answered_at) : null,
      recordedByName: r.recorded_by_name,
    }]);
  }
  const notices = new Map<string, any[]>();
  for (const n of rowsOf(noticeRows)) {
    notices.set(n.employee_id, [...(notices.get(n.employee_id) ?? []), n]);
  }

  return rows.map((r): Joiner => {
    const d = docs.get(r.id) ?? [];
    const rs = refs.get(r.id) ?? [];
    const ns = notices.get(r.id) ?? [];

    const joining = ns.filter((n) => n.kind === 'joining');
    const files = ns.filter((n) => n.kind === 'file');
    const lastJoining = joining[joining.length - 1] ?? null;
    /* One notice row per team; they were sent together, so the batch is the
       rows that share the last send's timestamp. */
    const batch = lastJoining
      ? joining.filter((n) => String(n.sent_at) === String(lastJoining.sent_at))
      : [];

    const fileSent: Joiner['fileSent'] = {};
    for (const f of files) {
      fileSent[f.team_key] = {
        at: String(f.sent_at), byName: f.sent_by_name, to: f.to_name,
        docs: Number(f.document_count), people: 1 + (f.cc_emails ?? []).length,
      };
    }

    const done = rs.filter((x) => x.status === 'done');
    const outcome = done.length
      ? (done.some((x) => x.rating === 'down') ? 'down' : done.some((x) => x.rating === 'star') ? 'star' : 'up')
      : null;
    const refsOk = rs.length > 0 && rs.every((x) => x.status === 'done');
    const verified = d.filter((x) => x.status === 'verified').length;

    const probation: ProbationRow = {
      startsOn: r.p_starts ?? r.start_date,
      endsOn: r.p_ends ?? addMonths(r.start_date, PROBATION_MONTHS),
      state: (r.p_state ?? 'in_progress') as ProbationRow['state'],
      decidedOn: r.p_decided ?? null,
      decidedByName: r.p_by ?? null,
      reason: r.p_reason ?? null,
      note: r.p_note ?? null,
    };

    return {
      id: r.id,
      employeeCode: r.employee_code,
      name: r.name,
      photo: r.photo ?? null,
      hue: r.hue == null ? null : Number(r.hue),
      candidateId: r.candidate_id,
      applicationId: r.application_id,
      offerId: r.offer_id,
      jobId: r.job_id,
      positionCode: r.position_code,
      deptId: r.dept_id,
      deptName: r.dept_name,
      title: r.title,
      city: r.city,
      startDate: r.start_date,
      status: r.status,
      acceptedAt: r.accepted_at ? String(r.accepted_at) : null,
      recruiterName: r.recruiter_name,
      sourceLabel: r.app_source ?? null,
      hiringManagers: ((r.hms ?? []) as Array<{ name: string }>).map((h) => h.name),
      form: {
        sentAt: r.form_sent_at ? String(r.form_sent_at) : null,
        submittedAt: r.form_submitted_at ? String(r.form_submitted_at) : null,
        nationalId: r.national_id, nationality: r.nationality, dob: r.dob, address: r.address,
        emergencyContact: r.emergency_contact, bank: r.bank, iban: r.iban,
      },
      completedAt: r.completed_at ? String(r.completed_at) : null,
      documents: d,
      references: rs,
      notice: lastJoining ? {
        at: String(lastJoining.sent_at),
        byName: lastJoining.sent_by_name,
        startDate: lastJoining.start_date,
        teams: batch.map((n) => ({
          key: n.team_key, short: n.short ?? n.team_key, name: n.team_name ?? n.team_key,
          head: n.to_name,
        })),
        again: Math.max(0, new Set(joining.map((n) => String(n.sent_at))).size - 1),
      } : null,
      fileSent,
      probation,
      bucket: r.status === 'active' ? 'started' : r.completed_at ? 'ready' : 'progress',
      progress: {
        verified,
        uploaded: d.filter((x) => x.status !== 'missing').length,
        total: d.length,
        form: !!r.form_submitted_at,
        refs: { n: rs.length, done: done.length, ok: refsOk, outcome },
      },
    };
  });
}

/* ── Quality of hire ────────────────────────────────────────────────────────
   The hires of a period, by their start date, and what became of them. Only the
   decided ones count towards the rate; the rest are still inside their three
   months and are reported separately. */
export function qualityOfHire(list: Joiner[], w: Window, now: Date) {
  const all = list.filter((e) => inWindow(e.startDate, w, now));
  const dec = all.filter((e) => e.probation.state === 'passed' || e.probation.state === 'failed');
  const passed = dec.filter((e) => e.probation.state === 'passed');
  const failed = dec.filter((e) => e.probation.state === 'failed');
  const reasons: Record<string, number> = {};
  for (const e of failed) {
    const k = e.probation.reason ?? 'Not given';
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  return {
    hired: all.length,
    decided: dec.length,
    passed: passed.length,
    failed: failed.length,
    inside: all.length - dec.length,
    rate: dec.length ? passed.length / dec.length : null,
    reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    all,
  };
}
