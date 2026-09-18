import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  approvals, approvalSteps, approvalFlows, approvalFlowSteps, staff, departments, jobs,
} from '@/db/schema';
import { rows as rowsOf, inList } from './sql';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   THE APPROVAL ENGINE

   One engine, two subjects: a requisition and an offer. A flow is the
   configured chain; submitting a record snapshots the steps that apply onto an
   instance, so editing the chain afterwards never rewrites a decision already
   taken. Approvers act on their own step; an Admin may act on anyone's behalf,
   and it is recorded that they did.
   ═════════════════════════════════════════════════════════════════════════════*/

export type ApprovalStep = {
  id: string;
  stepKey: string;
  label: string;
  approverType: string;
  approverRole: string | null;
  approverStaffId: string | null;
  approverName: string | null;
  approverTitle: string | null;
  conditionText: string | null;
  auto: boolean;
  state: 'pending' | 'approved' | 'rejected' | 'skipped';
  decidedBy: string | null;
  decidedByName: string | null;
  onBehalfOf: string | null;
  decidedAt: string | null;
  note: string | null;
  ordinal: number;
};

export type Approval = {
  id: string;
  subject: 'requisition' | 'offer';
  subjectId: string;
  state: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  attempt: number;
  steps: ApprovalStep[];
  /** The step everybody is waiting on, or null when the chain is closed. */
  current: ApprovalStep | null;
  done: number;
  total: number;
};

export async function getApproval(
  subject: 'requisition' | 'offer', subjectId: string, exec: Exec = db(),
): Promise<Approval | null> {
  const [a] = await exec.select().from(approvals)
    .where(and(eq(approvals.subject, subject), eq(approvals.subjectId, subjectId)))
    .orderBy(desc(approvals.requestedAt)).limit(1);
  if (!a) return null;

  const steps = (await exec.select().from(approvalSteps)
    .where(eq(approvalSteps.approvalId, a.id)).orderBy(asc(approvalSteps.ordinal))) as unknown as ApprovalStep[];

  const names = await resolveNames(steps, a.decidedBy, exec);
  const decorated = steps.map((s) => ({ ...s, decidedByName: s.decidedBy ? names.get(s.decidedBy) ?? null : null }));

  return {
    id: a.id,
    subject: a.subject as 'requisition' | 'offer',
    subjectId: a.subjectId,
    state: a.state as Approval['state'],
    requestedBy: a.requestedBy,
    requestedByName: a.requestedBy ? names.get(a.requestedBy) ?? a.requestedByName : a.requestedByName,
    requestedAt: String(a.requestedAt),
    decidedBy: a.decidedBy,
    decidedByName: a.decidedBy ? names.get(a.decidedBy) ?? null : null,
    decidedAt: a.decidedAt ? String(a.decidedAt) : null,
    note: a.note,
    attempt: a.attempt,
    steps: decorated,
    current: decorated.find((s) => s.state === 'pending') ?? null,
    done: decorated.filter((s) => s.state === 'approved').length,
    total: decorated.length,
  };
}

async function resolveNames(
  steps: ApprovalStep[], also: string | null, exec: Exec,
): Promise<Map<string, string>> {
  const ids = [...new Set([...steps.map((s) => s.decidedBy), also].filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await exec.select({ id: staff.id, name: staff.name }).from(staff)
    .where(sql`${staff.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* ── May this person decide this step? ──────────────────────────────────────
   Their own step, or an Admin acting for somebody outside the platform — a
   hiring manager who does not use it, Finance. The Admin is always the last
   word on a requisition. */
export function mayDecide(v: Viewer, step: ApprovalStep | null): boolean {
  if (!step) return false;
  if (v.isAdmin) return true;
  if (step.approverStaffId && step.approverStaffId === v.staffId) return true;
  if (step.approverRole && step.approverRole === v.staffRole) return true;
  if (step.approverName && step.approverName.toLowerCase() === v.name.toLowerCase()) return true;
  return false;
}

/** Whether pressing Approve is acting for themselves or for somebody else. */
export function approveLabel(v: Viewer, step: ApprovalStep): string {
  const own = (step.approverStaffId && step.approverStaffId === v.staffId)
    || (step.approverRole && step.approverRole === v.staffRole)
    || (step.approverName && step.approverName.toLowerCase() === v.name.toLowerCase());
  return own ? 'Approve' : `Approve on behalf of ${(step.approverName ?? '').split(' ')[0]}`;
}

/* ── Building the chain ─────────────────────────────────────────────────────
   Which of the configured steps apply to this record, and who each one resolves
   to. A condition is evaluated against the record as it stands at submission —
   an offer above the threshold picks up Finance, a requisition for four or more
   openings picks up the GM. */
export type FlowContext = {
  openings?: number;
  salaryMin?: number;
  salaryMax?: number;
  baseMonthly?: number;
  totalMonthly?: number;
  annualBonusPct?: number;
  hiringManager?: string | null;
  deptHead?: string | null;
  deptHeadTitle?: string | null;
};

const OPS: Record<string, (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b, gte: (a, b) => a >= b,
  lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b,
};

const COND_LABEL: Record<string, string> = {
  openings: 'openings', salaryMax: 'band maximum (SAR)', salaryMin: 'band minimum (SAR)',
  baseMonthly: 'monthly basic (SAR)', totalMonthly: 'total monthly (SAR)', annualBonusPct: 'bonus %',
};
const OP_LABEL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

/* How each kind of approver is described on the settings page and in the
   approval trail. The words are the product's, not the enum's. */
export const APPROVER_TYPE_LABEL: Record<string, string> = {
  role: 'Any Admin (TA lead)',
  hiring_manager: "The requisition's hiring manager",
  dept_head: 'The department head',
  staff: 'A specific team member',
  named: 'A named approver outside TA',
};

export const conditionText = (field: string | null, op: string | null, value: number | null): string | null =>
  (!field || !op || value == null ? null
    : `When ${COND_LABEL[field] ?? field} ${OP_LABEL[op] ?? op} ${value.toLocaleString('en-US')}`);

export type BuiltStep = {
  stepKey: string;
  label: string;
  approverType: string;
  approverRole: string | null;
  approverStaffId: string | null;
  approverName: string | null;
  approverTitle: string | null;
  approverEmail: string | null;
  conditionText: string | null;
  auto: boolean;
  ordinal: number;
};

export async function buildSteps(
  subject: 'requisition' | 'offer', ctx: FlowContext, exec: Exec = db(),
): Promise<BuiltStep[]> {
  const [flow] = await exec.select().from(approvalFlows)
    .where(and(eq(approvalFlows.subject, subject), eq(approvalFlows.isActive, true))).limit(1);
  const configured = flow
    ? await exec.select().from(approvalFlowSteps)
      .where(eq(approvalFlowSteps.flowId, flow.id)).orderBy(asc(approvalFlowSteps.ordinal))
    : [];

  const applies = configured.filter((s) => {
    if (!s.condField || !s.condOp || s.condValue == null) return true;
    const v = (ctx as Record<string, number | undefined>)[s.condField];
    if (v == null) return false;
    return OPS[s.condOp]?.(v, s.condValue) ?? true;
  });

  const admin = (await exec.select({ id: staff.id, name: staff.name, title: staff.title })
    .from(staff).where(eq(staff.role, 'tal_lead')).limit(1))[0];

  const out: BuiltStep[] = [];
  for (const s of applies) {
    let name = s.approverName, title = s.approverTitle, staffId = s.approverStaffId, email = s.approverEmail;
    if (s.approverType === 'role') {
      name = admin?.name ?? 'Admin'; title = 'Any Admin'; staffId = null;
    } else if (s.approverType === 'hiring_manager') {
      name = ctx.hiringManager ?? '—'; title = 'Hiring manager'; staffId = null;
    } else if (s.approverType === 'dept_head') {
      name = ctx.deptHead ?? '—'; title = ctx.deptHeadTitle ?? 'Department head'; staffId = null;
    } else if (s.approverType === 'staff' && s.approverStaffId) {
      const [p] = await exec.select({ name: staff.name, title: staff.title })
        .from(staff).where(eq(staff.id, s.approverStaffId)).limit(1);
      name = p?.name ?? name; title = p?.title ?? title;
    }
    out.push({
      stepKey: s.id, label: s.label, approverType: s.approverType,
      approverRole: s.approverRole, approverStaffId: staffId, approverName: name,
      approverTitle: title, approverEmail: email,
      conditionText: conditionText(s.condField, s.condOp, s.condValue),
      auto: s.auto, ordinal: out.length,
    });
  }

  /* The Admin always has the last word on a requisition — a chain that could
     close without them is not the chain this organisation runs. */
  if (subject === 'requisition' && !out.some((x) => x.approverRole === 'tal_lead')) {
    out.push({
      stepKey: 'st_admin', label: 'Admin (Head of TA)', approverType: 'role', approverRole: 'tal_lead',
      approverStaffId: null, approverName: admin?.name ?? 'Admin', approverTitle: 'Any Admin',
      approverEmail: null, conditionText: null, auto: false, ordinal: out.length,
    });
  }
  return out;
}

/** Everything awaiting a decision, for the queue on the Jobs page. */
export async function pendingApprovals(
  subject: 'requisition' | 'offer', jobIds: string[] | 'all', exec: Exec = db(),
) {
  if (jobIds !== 'all' && !jobIds.length) return [];
  const scope = jobIds === 'all' ? sql`true`
    : sql`${approvals.subjectId} IN (${sql.join(jobIds.map((i) => sql`${i}`), sql`, `)})`;
  return rowsOf(await exec.execute(sql`
    SELECT ap.id, ap.subject_id, ap.requested_at, ap.requested_by,
           st.label, st.approver_name, st.ordinal,
           (SELECT count(*) FROM ${approvalSteps} s2
             WHERE s2.approval_id = ap.id AND s2.state = 'approved')::int AS done,
           (SELECT count(*) FROM ${approvalSteps} s2 WHERE s2.approval_id = ap.id)::int AS total
      FROM ${approvals} ap
      LEFT JOIN LATERAL (
        SELECT * FROM ${approvalSteps} s WHERE s.approval_id = ap.id AND s.state = 'pending'
         ORDER BY s.ordinal LIMIT 1) st ON true
     WHERE ap.subject = ${subject} AND ap.state = 'pending' AND ${scope}
     ORDER BY ap.requested_at ASC`));
}

/* ── The queue on Jobs → Awaiting approval ──────────────────────────────────
   Driven by the requisitions rather than by the approval records, because that
   is the list somebody is looking at: every requisition in this account's scope
   that is waiting on somebody, with the step it is on and who has it. */
export type QueueRow = {
  jobId: string;
  title: string;
  deptName: string;
  openings: number;
  salaryMin: number;
  salaryMax: number;
  done: number;
  total: number;
  current: ApprovalStep | null;
  requestedByName: string | null;
  requestedAt: string | null;
  mine: boolean;
};

export async function requisitionQueue(v: Viewer, exec: Exec = db()): Promise<QueueRow[]> {
  const { jobScopeSql } = await import('@/lib/authz');
  const list = rowsOf(await exec.execute(sql`
    SELECT j.id, j.title, j.openings, j.salary_min, j.salary_max, d.name AS dept_name,
           ap.id AS approval_id, ap.requested_at, ap.requested_by, rq.name AS requested_by_name,
           (SELECT count(*) FROM ${approvalSteps} s
             WHERE s.approval_id = ap.id AND s.state = 'approved')::int AS done,
           (SELECT count(*) FROM ${approvalSteps} s WHERE s.approval_id = ap.id)::int AS total
      FROM ${jobs} j
      JOIN ${departments} d ON d.id = j.dept_id
      LEFT JOIN LATERAL (
        SELECT * FROM ${approvals} a
         WHERE a.subject = 'requisition' AND a.subject_id = j.id
         ORDER BY a.requested_at DESC LIMIT 1) ap ON true
      LEFT JOIN ${staff} rq ON rq.id = ap.requested_by
     WHERE j.status = 'pending_approval' AND ${jobScopeSql(v, 'j')}
     ORDER BY j.id ASC`));

  if (!list.length) return [];

  const stepRows = (await exec.select().from(approvalSteps)
    .where(sql`${inList(
      approvalSteps.approvalId,
      list.filter((r) => r.approval_id).map((r) => String(r.approval_id)),
    )}
      AND ${approvalSteps.state} = 'pending'`)
    .orderBy(asc(approvalSteps.ordinal))) as unknown as ApprovalStep[];

  const firstPending = new Map<string, ApprovalStep>();
  for (const s of stepRows) {
    if (!firstPending.has((s as any).approvalId)) firstPending.set((s as any).approvalId, s);
  }

  return list.map((r) => {
    const current = r.approval_id ? firstPending.get(r.approval_id) ?? null : null;
    return {
      jobId: r.id,
      title: r.title,
      deptName: r.dept_name,
      openings: Number(r.openings),
      salaryMin: Number(r.salary_min),
      salaryMax: Number(r.salary_max),
      done: Number(r.done ?? 0),
      total: Number(r.total ?? 0),
      current,
      requestedByName: r.requested_by_name,
      requestedAt: r.requested_at ? String(r.requested_at) : null,
      mine: mayDecide(v, current),
    };
  });
}
