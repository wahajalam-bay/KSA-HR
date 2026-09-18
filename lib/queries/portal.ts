import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  jobs, applications, candidates, interviews, evaluations, employees, offers, departments,
  locations, staff, approvals, approvalSteps, onboardingRecords, interviewPanel,
  jobHiringManagers,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { jobScopeSql } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { CRIT, isFlagged } from '@/lib/domain/ivreview';

/* ═════════════════════════════════════════════════════════════════════════════
   MY HIRING — the portal a hiring manager or an interview participant sees.

   It is not a cut-down copy of the desk: it is the same records, narrowed to
   what this person is actually named on, and ordered by what needs them. Every
   query below applies the viewer's own scope, so a hiring manager who opens
   somebody else's requisition by guessing the address gets nothing.

   The portal answers four questions and nothing else: what am I hiring for,
   who am I meeting, what is waiting on me, and who is about to join.
   ═════════════════════════════════════════════════════════════════════════════*/

const LIVE = ['open', 'pending_approval', 'on_hold', 'draft'];

export type PortalJob = {
  id: string; title: string; status: string; deptName: string; city: string | null;
  openings: number; filled: number; inPlay: number; atOffer: number;
  recruiterName: string | null;
};

export type PortalInterview = {
  id: string; applicationId: string; at: string; title: string; mode: string;
  durationMin: number; status: string;
  candidateName: string; photo: string | null; hue: number;
  jobTitle: string;
  panel: string[];
  /** Whether this viewer has already written their scorecard for it. */
  scored: boolean;
};

export type PortalApproval = {
  kind: 'Requisition' | 'Offer';
  id: string;
  title: string;
  sub: string;
  act: string;
  v: string;
};

export type PortalJoiner = {
  id: string; name: string; title: string; deptName: string;
  startDate: string; status: string; ready: boolean;
  photo: string | null; hue: number | null;
};

/* The coaching card: how this person's own interviews are read back to them.
   It is their own record and nobody else's — the leaderboard on Insights is a
   different question, asked by somebody with the standing to ask it. */
export type OwnReview = {
  n: number;
  score: number | null;
  trend: number | null;
  ratings: Record<string, number | null>;
  airtime: number | null;
  best: string | null;
  worst: string | null;
  flags: number;
  slips: Array<{ t: string; n: number }>;
  periodLabel: string;
};

export type Portal = {
  coaching: OwnReview;
  jobs: PortalJob[];
  live: PortalJob[];
  ahead: PortalInterview[];
  past: PortalInterview[];
  awaitingScorecard: PortalInterview[];
  approvals: PortalApproval[];
  joiners: PortalJoiner[];
  startingSoon: number;
  onboarding: number;
};

export async function portal(v: Viewer, now: Date, exec: Exec = db()): Promise<Portal> {
  const me = v.name;
  const scope = sql`j.id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})`;

  const [jobRows, ivRows, evalRows, joinerRows, reqApprovals, offerApprovals] = await Promise.all([
    exec.execute(sql`
      SELECT j.id, j.title, j.status::text AS status, j.openings, j.filled,
             d.name AS dept_name, l.city, s.name AS recruiter_name,
             (SELECT count(*)::int FROM ${applications} a
               WHERE a.job_id = j.id AND a.status IN ('active', 'on_hold')) AS in_play,
             (SELECT count(*)::int FROM ${applications} a
               WHERE a.job_id = j.id AND a.status IN ('active', 'on_hold') AND a.stage = 'offer') AS at_offer
        FROM ${jobs} j
        JOIN ${departments} d ON d.id = j.dept_id
        LEFT JOIN ${locations} l ON l.id = j.location_id
        LEFT JOIN ${staff} s ON s.id = j.recruiter_id
       WHERE ${scope} AND j.archived_at IS NULL
       ORDER BY j.opened_on DESC NULLS LAST, j.id`),

    /* Interviews this person sits on — as the named interviewer or on the
       panel. The panel is stored by name, which is how a participant who has
       no staff record is recognised at all. */
    exec.execute(sql`
      SELECT i.id, i.application_id, i.at, i.title, i.mode, i.duration_min,
             i.status::text AS status, i.interviewer,
             coalesce((SELECT array_agg(pn.name ORDER BY pn.sort_order)
                         FROM ${interviewPanel} pn WHERE pn.interview_id = i.id),
                      '{}'::text[]) AS panel,
             c.name AS candidate_name, c.photo, c.hue, j.title AS job_title
        FROM ${interviews} i
        JOIN ${applications} a ON a.id = i.application_id
        JOIN ${jobs} j ON j.id = a.job_id
        JOIN ${candidates} c ON c.id = a.candidate_id
       WHERE ${scope} AND i.status <> 'cancelled'
         AND (i.interviewer = ${me}
              OR EXISTS (SELECT 1 FROM ${interviewPanel} pn
                          WHERE pn.interview_id = i.id AND pn.name = ${me}))
       ORDER BY i.at`),

    exec.execute(sql`
      SELECT e.application_id FROM ${evaluations} e
        JOIN ${jobs} j ON j.id = e.job_id
       WHERE ${scope} AND e.submitted
         AND (e.evaluator_name = ${me} OR e.evaluator_id = ${v.staffId ?? ''})`),

    /* "Your" joiners means the ones hired onto a requisition this person is a
       named hiring manager on — not everything their access happens to cover.
       An Admin looking at the portal would otherwise see the whole company. */
    exec.execute(sql`
      SELECT e.id, e.name, e.title, e.start_date::text AS start_date, e.status::text AS status,
             d.name AS dept_name, c.photo, c.hue,
             ob.completed_at
        FROM ${employees} e
        JOIN ${departments} d ON d.id = e.dept_id
        LEFT JOIN ${candidates} c ON c.id = e.candidate_id
        LEFT JOIN ${onboardingRecords} ob ON ob.employee_id = e.id
       WHERE e.source = 'hire' AND e.status <> 'left'
         AND e.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})
         AND EXISTS (SELECT 1 FROM ${jobHiringManagers} h
                      WHERE h.job_id = e.job_id
                        AND (h.name = ${me}
                             OR (h.email IS NOT NULL AND lower(h.email) = lower(${v.email}))))
       ORDER BY e.start_date`),

    /* What is sitting on this person's own step, requisition and offer. */
    exec.execute(sql`
      SELECT ap.id, ap.subject_id, ap.requested_at, j.title, j.openings, d.name AS dept_name,
             st.label
        FROM ${approvals} ap
        JOIN ${jobs} j ON j.id = ap.subject_id
        JOIN ${departments} d ON d.id = j.dept_id
        JOIN LATERAL (
          SELECT s.label, s.approver_name FROM ${approvalSteps} s
           WHERE s.approval_id = ap.id AND s.state = 'pending'
           ORDER BY s.ordinal LIMIT 1) st ON true
       WHERE ap.subject = 'requisition' AND ap.state = 'pending'
         AND st.approver_name = ${me} AND ${scope}`),

    exec.execute(sql`
      SELECT ap.id, ap.subject_id, o.application_id, o.base_monthly,
             o.start_date::text AS start_date, c.name AS candidate_name, j.title AS job_title
        FROM ${approvals} ap
        JOIN ${offers} o ON o.id = ap.subject_id
        JOIN ${jobs} j ON j.id = o.job_id
        JOIN ${candidates} c ON c.id = o.candidate_id
        JOIN LATERAL (
          SELECT s.approver_name FROM ${approvalSteps} s
           WHERE s.approval_id = ap.id AND s.state = 'pending'
           ORDER BY s.ordinal LIMIT 1) st ON true
       WHERE ap.subject = 'offer' AND ap.state = 'pending'
         AND st.approver_name = ${me} AND ${scope}`),
  ]);

  const jobsOut: PortalJob[] = rowsOf(jobRows).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    status: r.status as string,
    deptName: r.dept_name as string,
    city: (r.city ?? null) as string | null,
    openings: Number(r.openings ?? 0),
    filled: Number(r.filled ?? 0),
    inPlay: Number(r.in_play ?? 0),
    atOffer: Number(r.at_offer ?? 0),
    recruiterName: (r.recruiter_name ?? null) as string | null,
  }));

  const scoredApps = new Set(rowsOf(evalRows).map((r) => r.application_id as string));
  const nowIso = now.toISOString();
  const ivs: PortalInterview[] = rowsOf(ivRows).map((r) => ({
    id: r.id as string,
    applicationId: r.application_id as string,
    at: new Date(r.at as string).toISOString(),
    title: r.title as string,
    mode: r.mode as string,
    durationMin: Number(r.duration_min ?? 0),
    status: r.status as string,
    candidateName: r.candidate_name as string,
    photo: (r.photo ?? null) as string | null,
    hue: Number(r.hue ?? 1),
    jobTitle: r.job_title as string,
    panel: (r.panel ?? []) as string[],
    scored: scoredApps.has(r.application_id as string),
  }));

  const ahead = ivs.filter((i) => i.at >= nowIso);
  const past = ivs.filter((i) => i.at < nowIso).slice(-8).reverse();

  const joiners: PortalJoiner[] = rowsOf(joinerRows).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    title: r.title as string,
    deptName: r.dept_name as string,
    startDate: r.start_date as string,
    status: r.status as string,
    ready: !!r.completed_at,
    photo: (r.photo ?? null) as string | null,
    hue: r.hue == null ? null : Number(r.hue),
  }));

  const approvalsOut: PortalApproval[] = [
    ...rowsOf(reqApprovals).map((r): PortalApproval => ({
      kind: 'Requisition',
      id: r.id as string,
      title: r.title as string,
      sub: `${r.dept_name} · ${r.openings} opening${Number(r.openings) === 1 ? '' : 's'}`,
      act: 'go',
      v: `/jobs/${r.subject_id}`,
    })),
    ...rowsOf(offerApprovals).map((r): PortalApproval => ({
      kind: 'Offer',
      id: r.id as string,
      title: `${r.candidate_name} — ${r.job_title}`,
      sub: `${Number(r.base_monthly).toLocaleString('en-US')} basic · starts ${r.start_date}`,
      act: 'drawer.open',
      v: r.application_id as string,
    })),
  ];

  const today = nowIso.slice(0, 10);
  return {
    coaching: await ownReview(v, now, exec),
    jobs: jobsOut,
    live: jobsOut.filter((j) => LIVE.includes(j.status)),
    ahead,
    past,
    awaitingScorecard: past.filter((i) => !i.scored),
    approvals: approvalsOut,
    joiners,
    startingSoon: joiners.filter((e) => e.status !== 'active' && e.startDate >= today).length,
    onboarding: joiners.filter((e) => e.status === 'onboarding').length,
  };
}

/* ── One interviewer's own review record ─────────────────────────────────── */
const REVIEW_DAYS = 180;

export async function ownReview(
  v: Viewer, now: Date, exec: Exec = db(),
): Promise<OwnReview> {
  const me = v.name;
  const rows = rowsOf(await exec.execute(sql`
    SELECT i.at, i.reviewer_score, i.reviewer_ratings, i.reviewer_improve, i.flags,
           (i.analysis->>'talkRatio')::int AS talk_ratio
      FROM ${interviews} i
      JOIN ${jobs} j ON j.id = i.job_id
     WHERE i.status = 'completed' AND i.at < ${at(now)}
       AND j.id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(v)})
       /* The person who ran it: the named interviewer, or the first on the
          panel when nobody was named. Sitting on a panel somebody else ran is
          not the same thing, and coaching the wrong person is worse than not
          coaching at all. */
       AND coalesce(i.interviewer, (SELECT pn.name FROM ${interviewPanel} pn
                                     WHERE pn.interview_id = i.id
                                     ORDER BY pn.sort_order LIMIT 1)) = ${me}
     ORDER BY i.at`));

  const cut = new Date(now.getTime() - REVIEW_DAYS * 86_400_000).toISOString();
  const parsed = rows.map((r) => ({
    at: new Date(r.at as string).toISOString(),
    score: r.reviewer_score == null ? null : Number(r.reviewer_score),
    ratings: (r.reviewer_ratings ?? null) as Record<string, number> | null,
    improve: (r.reviewer_improve ?? []) as string[],
    flags: (r.flags ?? []) as string[],
    talkRatio: r.talk_ratio == null ? null : Number(r.talk_ratio),
  }));

  const mine = parsed.filter((x) => x.at >= cut && x.score != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
  };

  const ratings: Record<string, number | null> = {};
  for (const [k] of CRIT) {
    const vals = mine.map((x) => x.ratings?.[k]).filter((n): n is number => n != null);
    ratings[k] = vals.length ? Math.round((mean(vals) as number) * 10) / 10 : null;
  }
  const ranked = CRIT.map(([k]) => k).filter((k) => ratings[k] != null)
    .sort((a, b) => (ratings[a] as number) - (ratings[b] as number));

  const slipCount: Record<string, number> = {};
  for (const x of mine) for (const t of x.improve) slipCount[t] = (slipCount[t] ?? 0) + 1;

  const score = med(mine.map((x) => x.score!));
  /* The trend is inside the window, not against the one before it: the older
     half of these interviews against the newer half, and only once there are
     four to split. Two interviews do not have a direction.
     (The reference computes the same split but subtracts the newer from the
      older, so a person who improved was told they had slipped. The sign is
      corrected here and the difference is recorded in the parity matrix.) */
  const half = Math.floor(mine.length / 2);
  const ordered = mine.map((x) => x.score!);
  const trend = mine.length >= 4
    ? (med(ordered.slice(half)) as number) - (med(ordered.slice(0, half)) as number)
    : null;
  const airs = mine.map((x) => x.talkRatio).filter((n): n is number => n != null);

  return {
    n: mine.length,
    score,
    trend,
    ratings,
    airtime: airs.length ? Math.round(mean(airs) as number) : null,
    best: ranked[ranked.length - 1] ?? null,
    worst: ranked[0] ?? null,
    flags: mine.filter((x) => isFlagged({ ratings: x.ratings, flags: x.flags })).length,
    slips: Object.entries(slipCount).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n),
    periodLabel: 'last 6 months',
  };
}
