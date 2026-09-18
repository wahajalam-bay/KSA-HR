import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  applications, candidates, jobs, departments, locations, staff, jobStages, stages,
  interviews, interviewPanel, evaluations, evaluationCriteria, comments, reviews,
  offers, offerMessages, offerDocuments, screenings, assessments, pitches, employees,
  candidateSkills, candidateResumes, applicationAnswers, jobQuestions, applicationStageHistory,
  talentPoolMembers, talentPools, messages, messageThreads,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { requireApplication, requireJob } from '@/lib/authz';
import { at } from '@/lib/clock';
import type { Viewer } from '@/lib/auth/session';
import { DEFAULT_NAMES, STAGE_INDEX, type StageKey } from '@/lib/domain/stages';

/* ═════════════════════════════════════════════════════════════════════════════
   THE CANDIDATE PANEL

   One record read once, for the panel the whole product opens: from the board,
   the candidate list, search, a notification, the scheduling view and the offer
   desk. Eight tabs read from this one shape rather than each fetching its own,
   because the panel has to be able to open on a phone in under a second and
   because two tabs disagreeing about the same person is the fastest way to
   lose a recruiter's trust in the whole thing.

   Authorization happens once, at the top: the panel is only ever opened for an
   application the viewer's scope covers, and a candidate with no application
   inside it resolves to their talent-pool record with no pipeline at all.
   ═════════════════════════════════════════════════════════════════════════════*/

export type DrawerStage = { key: StageKey; name: string; sla: number; off: boolean; ordinal: number };

export type DrawerCandidate = {
  id: string; name: string; headline: string | null; email: string; phone: string | null;
  locationCity: string | null; nationality: string | null; gender: string | null;
  photo: string | null; hue: number;
  sector: string | null; sectorSource: string | null;
  noticeDays: number | null; currentSalary: number | null; currentSalarySource: string | null;
  expectedSalary: number | null; currentCompany: string | null; currentTitle: string | null;
  yearsExperience: number | null;
  linkedin: string | null; portfolio: string | null;
  skills: string[]; hashtags: string[];
  claimByName: string | null; claimAt: string | null; claimNote: string | null;
  pools: Array<{ id: string; name: string }>;
};

export type DrawerResume = {
  fileName: string | null; sizeKb: number | null; pages: number | null;
  uploadedAt: string | null; confidence: number | null; summary: string | null;
  text: string | null;
  experience: Array<Record<string, unknown>>;
  education: Array<Record<string, unknown>>;
  languages: string[];
};

export type DrawerApplication = {
  id: string; jobId: string; jobTitle: string; deptName: string; city: string | null;
  stage: StageKey; stageName: string; status: string; source: string | null;
  appliedAt: string; closedAt: string | null; stageEnteredAt: string; sla: number;
  inStage: number; slaState: 'ok' | 'due' | 'over';
  rating: number | null;
  disqualifyReason: string | null;
  recruiterName: string | null;
  fitScore: number | null; fitLabel: string | null; fitModel: string | null;
};

export type DrawerInterview = {
  id: string; at: string; title: string; mode: string; durationMin: number;
  status: string; interviewer: string | null; panel: string[];
  stage: string; location: string | null; meetingUrl: string | null;
};

export type DrawerEvaluation = {
  id: string; evaluatorName: string | null; verdict: string | null; overall: number | null;
  submitted: boolean; submittedAt: string | null; stage: string | null;
  /* What the scorecard said in words. A scorecard is one comment and a set of
     scores — there is no separate strengths-and-concerns pair, because the two
     lists nobody fills in are worse than the one line everybody does. */
  notes: string | null;
  criteria: Array<{ name: string; score: number | null; max: number; weight: number }>;
};

export type DrawerComment = {
  id: string; body: string; authorName: string | null; at: string; pinned: boolean;
};

export type DrawerReview = {
  /** up | down | star — the three the product offers, and nothing else. */
  id: string; kind: string; authorName: string | null; at: string; note: string | null;
};

export type DrawerTimelineItem = {
  at: string; kind: string; text: string; by: string | null;
};

export type DrawerOffer = {
  id: string; state: string; version: number; baseMonthly: number; housing: number;
  transport: number; annualBonusPct: number | null; startDate: string | null;
  sentAt: string | null; responseAt: string | null; responseReason: string | null;
  responseNote: string | null; verifiedAt: string | null; verifiedByName: string | null;
  templateName: string | null;
  documents: Array<{ kind: string; status: string; fileName: string | null }>;
  questions: Array<{ id: string; from: string; body: string; at: string }>;
};

export type DrawerScreening = {
  id: string; status: string; channel: string; score: number | null; max: number | null;
  verdict: string | null; startedAt: string | null; completedAt: string | null;
  summary: string | null;
  turns: Array<{ who: string; text: string; at: string | null }>;
  answers: Array<{ question: string; answer: string | null; score: number | null; max: number | null }>;
};

export type DrawerData = {
  candidate: DrawerCandidate;
  resume: DrawerResume | null;
  application: DrawerApplication | null;
  /** Every application this person has, for the cross-pipeline banner. */
  applications: Array<{
    id: string; jobId: string; jobTitle: string; deptName: string;
    stage: StageKey; stageName: string; status: string; appliedAt: string;
  }>;
  stages: DrawerStage[];
  interviews: DrawerInterview[];
  evaluations: DrawerEvaluation[];
  comments: DrawerComment[];
  reviews: DrawerReview[];
  timeline: DrawerTimelineItem[];
  offer: DrawerOffer | null;
  screening: DrawerScreening | null;
  assessment: { id: string; status: string; score: number | null; max: number | null; sentAt: string | null; completedAt: string | null } | null;
  pitch: { id: string; status: string; score: number | null; verdict: string | null; projectName: string | null } | null;
  employee: { id: string; employeeCode: string; title: string; startDate: string; status: string; positionCode: string | null } | null;
  answers: Array<{ question: string; type: string; knockout: string | null; answer: string | null }>;
  nextStage: { key: StageKey; name: string } | null;
};

const SLA_STATE = (days: number, sla: number): 'ok' | 'due' | 'over' =>
  (days > sla ? 'over' : days >= sla - 1 ? 'due' : 'ok');

/** The stage a requisition advances to from here, skipping the alternative entries. */
export function nextStage(list: DrawerStage[], from: StageKey): { key: StageKey; name: string } | null {
  const live = list.filter((s) => !s.off);
  let i = live.findIndex((s) => s.key === from);
  if (i < 0) return null;
  i += 1;
  while (i < live.length && (live[i].key === 'applied' || live[i].key === 'sourced')) i += 1;
  return i < live.length ? { key: live[i].key, name: live[i].name } : null;
}

export async function drawer(
  v: Viewer,
  opts: { applicationId?: string; candidateId?: string },
  now: Date,
  exec: Exec = db(),
): Promise<DrawerData | null> {
  /* Resolve which application the panel is about. Opening by candidate picks
     the one still moving; a person with nothing live opens on their most
     recent, and somebody who only ever sat in a pool opens with no pipeline. */
  let applicationId = opts.applicationId ?? null;
  let candidateId = opts.candidateId ?? null;

  if (applicationId) {
    const jobId = await requireApplication(v, applicationId, exec);
    void jobId;
    const [row] = rowsOf(await exec.execute(sql`
      SELECT candidate_id FROM ${applications} WHERE id = ${applicationId} LIMIT 1`));
    if (!row) return null;
    candidateId = row.candidate_id as string;
  }

  if (!candidateId) return null;

  const appRows = rowsOf(await exec.execute(sql`
    SELECT a.id, a.job_id, a.stage::text AS stage, a.status::text AS status, a.source,
           a.applied_at, a.closed_at, a.stage_entered_at, a.rating, a.disqualify_reason,
           a.fit_score, a.fit_band, a.fit_model,
           j.title AS job_title, d.name AS dept_name, l.city, s.name AS recruiter_name,
           coalesce(js.name, st.name) AS stage_name, coalesce(js.sla, st.default_sla) AS sla
      FROM ${applications} a
      JOIN ${jobs} j ON j.id = a.job_id
      JOIN ${departments} d ON d.id = j.dept_id
      LEFT JOIN ${locations} l ON l.id = j.location_id
      LEFT JOIN ${staff} s ON s.id = a.recruiter_id
      LEFT JOIN ${jobStages} js ON js.job_id = a.job_id AND js.stage_key = a.stage
      LEFT JOIN ${stages} st ON st.key = a.stage
     WHERE a.candidate_id = ${candidateId}
     ORDER BY a.applied_at DESC`));

  /* Only the ones this account may see — a candidate can sit on a requisition
     the viewer has no business reading. */
  const visible: typeof appRows = [];
  for (const r of appRows) {
    try {
      await requireJob(v, r.job_id as string, exec);
      visible.push(r);
    } catch { /* outside their scope: not shown, not counted */ }
  }

  const LIVE = ['active', 'on_hold'];
  const chosen = applicationId
    ? visible.find((r) => r.id === applicationId)
    : (visible.find((r) => LIVE.includes(r.status as string)) ?? visible[0]);
  applicationId = (chosen?.id as string) ?? null;

  const [candRow] = rowsOf(await exec.execute(sql`
    SELECT c.*, s.name AS claim_by_name
      FROM ${candidates} c
      LEFT JOIN ${staff} s ON s.id = c.claim_by
     WHERE c.id = ${candidateId} LIMIT 1`));
  if (!candRow) return null;

  const [skillRows, poolRows, resumeRows] = await Promise.all([
    exec.execute(sql`
      SELECT skill AS name FROM ${candidateSkills} WHERE candidate_id = ${candidateId}
       ORDER BY sort_order, skill`),
    exec.execute(sql`
      SELECT p.id, p.name FROM ${talentPoolMembers} m
        JOIN ${talentPools} p ON p.id = m.pool_id
       WHERE m.candidate_id = ${candidateId} ORDER BY p.sort_order, p.name`),
    exec.execute(sql`
      SELECT * FROM ${candidateResumes} WHERE candidate_id = ${candidateId}
       ORDER BY uploaded_at DESC NULLS LAST LIMIT 1`),
  ]);

  const candidate: DrawerCandidate = {
    id: candRow.id as string,
    name: candRow.name as string,
    headline: (candRow.headline ?? null) as string | null,
    email: candRow.email as string,
    phone: (candRow.phone ?? null) as string | null,
    locationCity: (candRow.location_city ?? null) as string | null,
    nationality: (candRow.nationality ?? null) as string | null,
    gender: (candRow.gender ?? null) as string | null,
    photo: (candRow.photo ?? null) as string | null,
    hue: Number(candRow.hue ?? 1),
    sector: (candRow.sector ?? null) as string | null,
    sectorSource: (candRow.sector_source ?? null) as string | null,
    noticeDays: candRow.notice_days == null ? null : Number(candRow.notice_days),
    currentSalary: candRow.current_salary == null ? null : Number(candRow.current_salary),
    currentSalarySource: (candRow.current_salary_source ?? null) as string | null,
    expectedSalary: candRow.expected_salary == null ? null : Number(candRow.expected_salary),
    currentCompany: (candRow.current_company ?? null) as string | null,
    currentTitle: (candRow.current_title ?? null) as string | null,
    yearsExperience: candRow.years_experience == null ? null : Number(candRow.years_experience),
    linkedin: (candRow.linkedin ?? null) as string | null,
    portfolio: (candRow.portfolio ?? null) as string | null,
    skills: rowsOf(skillRows).map((r) => r.name as string),
    hashtags: (candRow.hashtags ?? []) as string[],
    claimByName: (candRow.claim_by_name ?? candRow.claim_by_name ?? null) as string | null,
    claimAt: candRow.claim_at ? new Date(candRow.claim_at as string).toISOString() : null,
    claimNote: (candRow.claim_note ?? null) as string | null,
    pools: rowsOf(poolRows).map((r) => ({ id: r.id as string, name: r.name as string })),
  };

  const rr = rowsOf(resumeRows)[0] ?? null;
  const resume: DrawerResume | null = rr && {
    fileName: (rr.file_name ?? null) as string | null,
    sizeKb: rr.size_kb == null ? null : Number(rr.size_kb),
    pages: rr.pages == null ? null : Number(rr.pages),
    uploadedAt: rr.uploaded_at ? new Date(rr.uploaded_at as string).toISOString() : null,
    confidence: rr.confidence == null ? null : Number(rr.confidence),
    summary: (rr.summary ?? null) as string | null,
    text: (rr.text ?? null) as string | null,
    experience: (rr.experience ?? []) as Array<Record<string, unknown>>,
    education: (rr.education ?? []) as Array<Record<string, unknown>>,
    languages: (rr.languages ?? []) as string[],
  };

  const applicationsOut = visible.map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    jobTitle: r.job_title as string,
    deptName: r.dept_name as string,
    stage: r.stage as StageKey,
    stageName: (r.stage_name ?? DEFAULT_NAMES[r.stage as StageKey]) as string,
    status: r.status as string,
    appliedAt: new Date(r.applied_at as string).toISOString(),
  }));

  if (!chosen) {
    return {
      candidate, resume, application: null, applications: applicationsOut,
      stages: [], interviews: [], evaluations: [], comments: [], reviews: [], timeline: [],
      offer: null, screening: null, assessment: null, pitch: null, employee: null,
      answers: [], nextStage: null,
    };
  }

  const jobId = chosen.job_id as string;
  const inStage = Math.max(0,
    (now.getTime() - new Date(chosen.stage_entered_at as string).getTime()) / 86_400_000);
  const sla = Number(chosen.sla ?? 0);

  const application: DrawerApplication = {
    id: chosen.id as string,
    jobId,
    jobTitle: chosen.job_title as string,
    deptName: chosen.dept_name as string,
    city: (chosen.city ?? null) as string | null,
    stage: chosen.stage as StageKey,
    stageName: (chosen.stage_name ?? DEFAULT_NAMES[chosen.stage as StageKey]) as string,
    status: chosen.status as string,
    source: (chosen.source ?? null) as string | null,
    appliedAt: new Date(chosen.applied_at as string).toISOString(),
    closedAt: chosen.closed_at ? new Date(chosen.closed_at as string).toISOString() : null,
    stageEnteredAt: new Date(chosen.stage_entered_at as string).toISOString(),
    sla,
    inStage,
    slaState: SLA_STATE(inStage, sla),
    rating: chosen.rating == null ? null : Number(chosen.rating),
    disqualifyReason: (chosen.disqualify_reason ?? null) as string | null,
    recruiterName: (chosen.recruiter_name ?? null) as string | null,
    fitScore: chosen.fit_score == null ? null : Number(chosen.fit_score),
    fitLabel: (chosen.fit_band ?? null) as string | null,
    fitModel: (chosen.fit_model ?? null) as string | null,
  };

  const [
    stageRows, ivRows, evalRows, critRows, commentRows, reviewRows, historyRows,
    offerRows, screenRows, asmRows, pitchRows, empRows, answerRows,
  ] = await Promise.all([
    exec.execute(sql`
      SELECT st.key::text AS key, st.ordinal,
             coalesce(js.name, st.name) AS name,
             coalesce(js.sla, st.default_sla) AS sla,
             /* A stage this requisition does not run has no row of its own —
                that is what "off" means here, and why the board can read the
                loop without also knowing which rows to ignore. */
             js.job_id IS NULL AND NOT st.fixed AS off
        FROM ${stages} st
        LEFT JOIN ${jobStages} js ON js.job_id = ${jobId} AND js.stage_key = st.key
       ORDER BY st.ordinal`),
    exec.execute(sql`
      SELECT i.id, i.at, i.title, i.mode, i.duration_min, i.status::text AS status,
             i.interviewer, i.stage::text AS stage, i.location, i.meeting_url,
             coalesce((SELECT array_agg(p.name ORDER BY p.sort_order)
                         FROM ${interviewPanel} p WHERE p.interview_id = i.id), '{}'::text[]) AS panel
        FROM ${interviews} i WHERE i.application_id = ${applicationId} ORDER BY i.at`),
    exec.execute(sql`
      SELECT e.id, e.evaluator_name, e.verdict::text AS verdict, e.overall, e.submitted,
             e.at AS submitted_at, e.stage::text AS stage, e.comment AS notes
        FROM ${evaluations} e WHERE e.application_id = ${applicationId}
       ORDER BY e.at NULLS LAST, e.id`),
    exec.execute(sql`
      SELECT c.evaluation_id, c.name, c.score, c.weight
        FROM ${evaluationCriteria} c
        JOIN ${evaluations} e ON e.id = c.evaluation_id
       WHERE e.application_id = ${applicationId} ORDER BY c.sort_order, c.id`),
    exec.execute(sql`
      SELECT id, body, author_name, at, pinned FROM ${comments}
       WHERE application_id = ${applicationId} ORDER BY pinned DESC, at DESC`),
    exec.execute(sql`
      SELECT id, rating::text AS kind, by_name AS author_name, at, text AS note
        FROM ${reviews}
       WHERE application_id = ${applicationId} ORDER BY at DESC`),
    exec.execute(sql`
      SELECT to_stage::text AS to_stage, at, actor_name AS by_name, reason, metadata
        FROM ${applicationStageHistory}
       WHERE application_id = ${applicationId} ORDER BY seq`),
    exec.execute(sql`
      SELECT o.*, s.name AS verified_by_name FROM ${offers} o
        LEFT JOIN ${staff} s ON s.id = o.verified_by
       WHERE o.application_id = ${applicationId}
       ORDER BY o.version DESC LIMIT 1`),
    exec.execute(sql`
      SELECT s.*, s.call_duration_sec, s.call_voice
        FROM ${screenings} s WHERE s.application_id = ${applicationId}
       ORDER BY s.created_at DESC LIMIT 1`),
    exec.execute(sql`
      SELECT id, status::text AS status, score, 100 AS max,
             invited_at AS sent_at, completed_at
        FROM ${assessments} WHERE application_id = ${applicationId}
       ORDER BY invited_at DESC NULLS LAST, id DESC LIMIT 1`),
    exec.execute(sql`
      SELECT p.id, p.status::text AS status, p.score, p.verdict::text AS verdict,
             pr.name AS project_name
        FROM ${pitches} p
        LEFT JOIN pitch_projects pr ON pr.id = p.project_id
       WHERE p.application_id = ${applicationId} ORDER BY p.id DESC LIMIT 1`),
    exec.execute(sql`
      SELECT id, employee_code, title, start_date::text AS start_date, status::text AS status,
             position_code
        FROM ${employees} WHERE candidate_id = ${candidateId} ORDER BY id LIMIT 1`),
    exec.execute(sql`
      SELECT q.text AS question, q.type::text AS type, q.knockout, a.answer
        FROM ${jobQuestions} q
        LEFT JOIN ${applicationAnswers} a
               ON a.question_id = q.id AND a.application_id = ${applicationId}
       WHERE q.job_id = ${jobId} ORDER BY q.ordinal, q.id`),
  ]);

  const stageList: DrawerStage[] = rowsOf(stageRows).map((r) => ({
    key: r.key as StageKey,
    name: r.name as string,
    sla: Number(r.sla ?? 0),
    off: !!r.off,
    ordinal: Number(r.ordinal ?? 0),
  }));

  const critBy = new Map<string, DrawerEvaluation['criteria']>();
  for (const c of rowsOf(critRows)) {
    const k = c.evaluation_id as string;
    critBy.set(k, [...(critBy.get(k) ?? []), {
      name: c.name as string,
      score: c.score == null ? null : Number(c.score),
      /* Every criterion on a scorecard is out of five; the weight is what
         changes between them. */
      max: 5,
      weight: Number(c.weight ?? 1),
    }]);
  }

  const offerRow = rowsOf(offerRows)[0] ?? null;
  let offer: DrawerOffer | null = null;
  if (offerRow) {
    const [docRows, qRows] = await Promise.all([
      exec.execute(sql`
        SELECT d.key AS kind, d.status::text AS status, f.original_name AS file_name
          FROM ${offerDocuments} d
          LEFT JOIN files f ON f.id = d.file_id
         WHERE d.offer_id = ${offerRow.id} ORDER BY d.sort_order, d.key`),
      exec.execute(sql`
        SELECT id, from_party::text AS from_party, body, at FROM ${offerMessages}
         WHERE offer_id = ${offerRow.id} ORDER BY at`),
    ]);
    offer = {
      id: offerRow.id as string,
      state: offerRow.state as string,
      version: Number(offerRow.version ?? 1),
      baseMonthly: Number(offerRow.base_monthly ?? 0),
      housing: Number(offerRow.housing ?? 0),
      transport: Number(offerRow.transport ?? 0),
      annualBonusPct: offerRow.annual_bonus_pct == null ? null : Number(offerRow.annual_bonus_pct),
      startDate: (offerRow.start_date ?? null) as string | null,
      sentAt: offerRow.sent_at ? new Date(offerRow.sent_at as string).toISOString() : null,
      responseAt: offerRow.response_at ? new Date(offerRow.response_at as string).toISOString() : null,
      responseReason: (offerRow.response_reason ?? null) as string | null,
      responseNote: (offerRow.response_note ?? null) as string | null,
      verifiedAt: offerRow.verified_at ? new Date(offerRow.verified_at as string).toISOString() : null,
      verifiedByName: (offerRow.verified_by_name ?? null) as string | null,
      templateName: (offerRow.template_name ?? null) as string | null,
      documents: rowsOf(docRows).map((r) => ({
        kind: r.kind as string, status: r.status as string,
        fileName: (r.file_name ?? null) as string | null,
      })),
      questions: rowsOf(qRows).map((r) => ({
        id: r.id as string,
        from: r.from_party as string,
        body: r.body as string,
        at: new Date(r.at as string).toISOString(),
      })),
    };
  }

  const screenRow = rowsOf(screenRows)[0] ?? null;
  let screening: DrawerScreening | null = null;
  if (screenRow) {
    const [turnRows, scoreRows] = await Promise.all([
      exec.execute(sql`
        SELECT who::text AS who, text, at FROM screening_turns
         WHERE screening_id = ${screenRow.id} ORDER BY seq, id`),
      exec.execute(sql`
        SELECT question, answer, score, max FROM screening_scores
         WHERE screening_id = ${screenRow.id} ORDER BY sort_order, id`),
    ]);
    screening = {
      id: screenRow.id as string,
      status: screenRow.status as string,
      channel: screenRow.channel as string,
      score: screenRow.score == null ? null : Number(screenRow.score),
      max: screenRow.max == null ? null : Number(screenRow.max),
      verdict: (screenRow.verdict ?? null) as string | null,
      startedAt: screenRow.started_at ? new Date(screenRow.started_at as string).toISOString() : null,
      completedAt: screenRow.completed_at ? new Date(screenRow.completed_at as string).toISOString() : null,
      summary: (screenRow.summary ?? null) as string | null,
      turns: rowsOf(turnRows).map((r) => ({
        who: r.who as string,
        text: r.text as string,
        at: r.at ? new Date(r.at as string).toISOString() : null,
      })),
      answers: rowsOf(scoreRows).map((r) => ({
        question: r.question as string,
        answer: (r.answer ?? null) as string | null,
        score: r.score == null ? null : Number(r.score),
        max: r.max == null ? null : Number(r.max),
      })),
    };
  }

  const asmRow = rowsOf(asmRows)[0] ?? null;
  const pitchRow = rowsOf(pitchRows)[0] ?? null;
  const empRow = rowsOf(empRows)[0] ?? null;

  return {
    candidate,
    resume,
    application,
    applications: applicationsOut,
    stages: stageList,
    interviews: rowsOf(ivRows).map((r) => ({
      id: r.id as string,
      at: new Date(r.at as string).toISOString(),
      title: r.title as string,
      mode: r.mode as string,
      durationMin: Number(r.duration_min ?? 0),
      status: r.status as string,
      interviewer: (r.interviewer ?? null) as string | null,
      panel: (r.panel ?? []) as string[],
      stage: r.stage as string,
      location: (r.location ?? null) as string | null,
      meetingUrl: (r.meeting_url ?? null) as string | null,
    })),
    evaluations: rowsOf(evalRows).map((r) => ({
      id: r.id as string,
      evaluatorName: (r.evaluator_name ?? null) as string | null,
      verdict: (r.verdict ?? null) as string | null,
      overall: r.overall == null ? null : Number(r.overall),
      submitted: !!r.submitted,
      submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
      stage: (r.stage ?? null) as string | null,
      notes: (r.notes ?? null) as string | null,
      criteria: critBy.get(r.id as string) ?? [],
    })),
    comments: rowsOf(commentRows).map((r) => ({
      id: r.id as string,
      body: r.body as string,
      authorName: (r.author_name ?? null) as string | null,
      at: new Date(r.at as string).toISOString(),
      pinned: !!r.pinned,
    })),
    reviews: rowsOf(reviewRows).map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      authorName: (r.author_name ?? null) as string | null,
      at: new Date(r.at as string).toISOString(),
      note: (r.note ?? null) as string | null,
    })),
    timeline: rowsOf(historyRows).map((r) => ({
      at: new Date(r.at as string).toISOString(),
      kind: 'stage',
      text: (r.to_stage as string),
      by: (r.by_name ?? null) as string | null,
    })),
    offer,
    screening,
    assessment: asmRow && {
      id: asmRow.id as string,
      status: asmRow.status as string,
      score: asmRow.score == null ? null : Number(asmRow.score),
      max: asmRow.max == null ? null : Number(asmRow.max),
      sentAt: asmRow.sent_at ? new Date(asmRow.sent_at as string).toISOString() : null,
      completedAt: asmRow.completed_at ? new Date(asmRow.completed_at as string).toISOString() : null,
    },
    pitch: pitchRow && {
      id: pitchRow.id as string,
      status: pitchRow.status as string,
      score: pitchRow.score == null ? null : Number(pitchRow.score),
      verdict: (pitchRow.verdict ?? null) as string | null,
      projectName: (pitchRow.project_name ?? null) as string | null,
    },
    employee: empRow && {
      id: empRow.id as string,
      employeeCode: empRow.employee_code as string,
      title: empRow.title as string,
      startDate: empRow.start_date as string,
      status: empRow.status as string,
      positionCode: (empRow.position_code ?? null) as string | null,
    },
    answers: rowsOf(answerRows).map((r) => ({
      question: r.question as string,
      type: r.type as string,
      knockout: (r.knockout ?? null) as string | null,
      answer: (r.answer ?? null) as string | null,
    })),
    nextStage: nextStage(stageList, chosen.stage as StageKey),
  };
}
