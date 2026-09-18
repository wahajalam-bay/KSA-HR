import 'server-only';
import { sql, asc } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  orgSettings, departments, functions, staff, jobs, applications, pipelines, stages,
  emailTemplates, interviewKits, offerTemplates, questionBank, automationRules, automationRuns,
  integrations, auditEvents, accounts, approvalFlows, approvalFlowSteps, pitchProjects,
  pitchConfig, locations, sources, hashtags, goals, candidates, employees, offers, interviews,
  evaluations, files, notifications, tasks, domainEvents, jobQueue, webhookEvents,
  notifiedTeams, notifiedTeamContacts, jobHiringManagers,
} from '@/db/schema';
import { rows as rowsOf } from './sql';
import { at } from '@/lib/clock';
import { providers } from '@/lib/env';
import type { Viewer } from '@/lib/auth/session';
import { STAGE_KEYS, DEFAULT_NAMES, type StageKey } from '@/lib/domain/stages';
import { buildSteps, conditionText, APPROVER_TYPE_LABEL } from './approvals';

/* ═════════════════════════════════════════════════════════════════════════════
   SETTINGS

   Twelve panels over one page: the brand, the organisation, the approval
   flows, the accounts, the teams a joiner is announced to, the pipeline
   templates, the sales pitch, the templates, the automations, the
   integrations, the audit trail and an honest account of the data itself.

   Nothing here invents a status. An integration is reported from the row and
   from the environment together — if the credentials are missing the page says
   which ones, by name, rather than showing a green light.
   ═════════════════════════════════════════════════════════════════════════════*/

export const SETTINGS_TABS = [
  { v: 'org', t: 'Organisation' },
  { v: 'approvals', t: 'Approvals' },
  { v: 'access', t: 'Access' },
  { v: 'teams', t: 'Notified teams' },
  { v: 'pipelines', t: 'Pipelines' },
  { v: 'pitch', t: 'Sales pitch' },
  { v: 'templates', t: 'Templates' },
  { v: 'automations', t: 'Automations' },
  { v: 'integrations', t: 'Integrations' },
  { v: 'audit', t: 'Audit trail' },
  { v: 'data', t: 'Data' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['v'];

export type Org = typeof orgSettings.$inferSelect;

export async function org(exec: Exec = db()): Promise<Org> {
  const [row] = await exec.select().from(orgSettings).where(sql`id = 'org'`).limit(1);
  return row;
}

/** The number on each tab, so the subnav says how much is behind it. */
export async function tabCounts(exec: Exec = db()): Promise<Record<string, number>> {
  const r = rowsOf(await exec.execute(sql`
    SELECT
      (SELECT count(*)::int FROM ${departments} WHERE archived_at IS NULL) AS org,
      (SELECT count(*)::int FROM ${approvalFlowSteps}) AS approvals,
      (SELECT count(*)::int FROM ${accounts} WHERE removed_at IS NULL) AS access,
      (SELECT count(*)::int FROM ${pipelines}) AS pipelines,
      (SELECT count(*)::int FROM ${pitchProjects} WHERE active) AS pitch,
      (SELECT count(*)::int FROM ${emailTemplates})
        + (SELECT count(*)::int FROM ${interviewKits})
        + (SELECT count(*)::int FROM ${offerTemplates})
        + (SELECT count(*)::int FROM ${questionBank}) AS templates,
      (SELECT count(*)::int FROM ${automationRules} WHERE enabled) AS automations,
      (SELECT count(*)::int FROM ${integrations} WHERE state = 'connected') AS integrations,
      (SELECT count(*)::int FROM ${auditEvents}) AS audit`))[0];
  return {
    org: Number(r.org ?? 0),
    approvals: Number(r.approvals ?? 0),
    access: Number(r.access ?? 0),
    pipelines: Number(r.pipelines ?? 0),
    pitch: Number(r.pitch ?? 0),
    templates: Number(r.templates ?? 0),
    automations: Number(r.automations ?? 0),
    integrations: Number(r.integrations ?? 0),
    audit: Number(r.audit ?? 0),
  };
}

/* ── Organisation ────────────────────────────────────────────────────────── */
export type DeptRow = {
  id: string; name: string; code: string; functionId: string | null;
  head: string | null; headTitle: string | null; headcount: number | null;
  costCentre: string | null;
  jobs: number; live: number; pipeline: number; hires: number;
  colleagues: number; joining: number;
  recruiters: string[];
};

export type HiringManagerRow = {
  name: string; title: string; deptName: string | null;
  requisitions: number; interviews: number;
};

export type OrgPanel = {
  functions: Array<{ id: string; name: string; head: string | null; headTitle: string | null }>;
  departments: DeptRow[];
  hiringManagers: HiringManagerRow[];
};

const LIVE_JOB = ['open', 'pending_approval', 'on_hold', 'draft'];

export async function orgPanel(exec: Exec = db()): Promise<OrgPanel> {
  const [fnRows, deptRows, jobRows, appRows, empRows, staffRows, hmRows, ivRows, headRows] =
    await Promise.all([
    exec.select({ id: functions.id, name: functions.name, head: functions.head, headTitle: functions.headTitle })
      .from(functions).orderBy(functions.sortOrder, functions.name),
    exec.select().from(departments).where(sql`archived_at IS NULL`)
      .orderBy(departments.sortOrder, departments.name),
    exec.execute(sql`
      SELECT dept_id, status::text AS status, filled FROM ${jobs} WHERE archived_at IS NULL`),
    exec.execute(sql`
      SELECT j.dept_id, count(*)::int AS n FROM ${applications} a
        JOIN ${jobs} j ON j.id = a.job_id
       WHERE a.status IN ('active', 'on_hold') GROUP BY 1`),
    exec.execute(sql`
      SELECT dept_id, status::text AS status, count(*)::int AS n FROM ${employees}
       WHERE status <> 'left' GROUP BY 1, 2`),
    exec.select({ id: staff.id, name: staff.name, deptIds: staff.deptIds })
      .from(staff).where(sql`status = 'active'`).orderBy(staff.id),
    /* Every hiring manager named on a live requisition, with what they are
       carrying and how many interviews they have actually taken. */
    exec.execute(sql`
      SELECT h.name,
             max(coalesce(h.title, '')) AS title,
             max(coalesce(d.name, '')) AS dept_name,
             count(DISTINCT j.id)::int AS requisitions
        FROM ${jobHiringManagers} h
        JOIN ${jobs} j ON j.id = h.job_id
        LEFT JOIN ${departments} d ON d.id = j.dept_id
       WHERE j.status IN ('open', 'pending_approval', 'on_hold', 'draft')
       GROUP BY h.name ORDER BY h.name`),
    exec.execute(sql`
      SELECT interviewer AS name, count(*)::int AS n FROM interviews
       WHERE status <> 'cancelled' AND interviewer IS NOT NULL GROUP BY 1`),
    exec.execute(sql`
      SELECT head, max(coalesce(head_title, '')) AS head_title, max(name) AS dept_name
        FROM ${departments} WHERE head IS NOT NULL AND archived_at IS NULL GROUP BY head`),
  ]);

  const jobsBy = new Map<string, { n: number; live: number; hires: number }>();
  for (const j of rowsOf(jobRows)) {
    const k = j.dept_id as string;
    const cur = jobsBy.get(k) ?? { n: 0, live: 0, hires: 0 };
    cur.n += 1;
    if (LIVE_JOB.includes(j.status as string)) cur.live += 1;
    cur.hires += Number(j.filled ?? 0);
    jobsBy.set(k, cur);
  }
  const pipeBy = new Map(rowsOf(appRows).map((r) => [r.dept_id as string, Number(r.n)]));
  const colleaguesBy = new Map<string, number>();
  const joiningBy = new Map<string, number>();
  for (const e of rowsOf(empRows)) {
    const k = e.dept_id as string;
    if (e.status === 'onboarding') joiningBy.set(k, (joiningBy.get(k) ?? 0) + Number(e.n));
    else colleaguesBy.set(k, (colleaguesBy.get(k) ?? 0) + Number(e.n));
  }

  /* A department head is a hiring manager by default, so their title comes
     from the department when the requisition did not carry one. */
  const headBy = new Map(rowsOf(headRows).map((r) => [r.head as string, {
    title: (r.head_title as string) || '',
    deptName: r.dept_name as string,
  }]));
  const ivBy = new Map(rowsOf(ivRows).map((r) => [r.name as string, Number(r.n)]));

  return {
    functions: fnRows,
    hiringManagers: rowsOf(hmRows).map((r) => {
      const name = r.name as string;
      const head = headBy.get(name);
      return {
        name,
        title: (r.title as string) || head?.title || (head ? `Head of ${head.deptName}` : 'Hiring manager'),
        deptName: head?.deptName ?? ((r.dept_name as string) || null),
        requisitions: Number(r.requisitions ?? 0),
        interviews: ivBy.get(name) ?? 0,
      };
    }),
    departments: deptRows.map((d) => {
      const js = jobsBy.get(d.id) ?? { n: 0, live: 0, hires: 0 };
      return {
        id: d.id, name: d.name, code: d.code, functionId: d.functionId,
        head: d.head, headTitle: d.headTitle, headcount: d.headcount, costCentre: d.costCentre,
        jobs: js.n, live: js.live, hires: js.hires,
        pipeline: pipeBy.get(d.id) ?? 0,
        colleagues: colleaguesBy.get(d.id) ?? 0,
        joining: joiningBy.get(d.id) ?? 0,
        recruiters: staffRows.filter((s) => (s.deptIds ?? []).includes(d.id)).map((s) => s.name),
      };
    }),
  };
}

/* ── Pipelines ───────────────────────────────────────────────────────────── */
export type PipelineRow = {
  id: string; name: string;
  /** Every spine stage, in order, as this template treats it. */
  stages: Array<{ key: StageKey; spineName: string; name: string; off: boolean; sla: number; defaultSla: number }>;
  jobs: number;
  endToEnd: number;
  renamed: number;
};

export async function pipelinesPanel(exec: Exec = db()): Promise<{
  pipelines: PipelineRow[]; stageCount: number; jobs: number; overrides: number;
}> {
  const [spineRows, pipeRows, jobRows] = await Promise.all([
    exec.select().from(stages).orderBy(asc(stages.ordinal)),
    exec.execute(sql`
      SELECT p.id, p.name, p.labels, p.off_stages, p.sla_overrides FROM ${pipelines} p
       ORDER BY p.sort_order, p.id`),
    exec.execute(sql`SELECT pipeline_id, count(*)::int AS n FROM ${jobs} GROUP BY 1`),
  ]);
  const spine = spineRows.filter((s) => STAGE_KEYS.includes(s.key as StageKey));
  const jobsBy = new Map(rowsOf(jobRows).map((r) => [r.pipeline_id as string, Number(r.n)]));

  let overrides = 0;
  const list = rowsOf(pipeRows).map((p): PipelineRow => {
    const labels = (p.labels ?? {}) as Record<string, string>;
    const off = new Set((p.off_stages ?? []) as string[]);
    const slaOver = (p.sla_overrides ?? {}) as Record<string, number>;
    const rows = spine.map((s) => {
      const key = s.key as StageKey;
      const over = slaOver[key];
      if (over != null) overrides += 1;
      return {
        key,
        spineName: s.name,
        name: labels[key] || s.name,
        off: off.has(key),
        sla: Number(over ?? s.defaultSla),
        defaultSla: Number(s.defaultSla),
      };
    });
    const used = rows.filter((r) => !r.off);
    return {
      id: p.id as string,
      name: p.name as string,
      stages: rows,
      jobs: jobsBy.get(p.id as string) ?? 0,
      endToEnd: used.reduce((n, r) => n + r.sla, 0),
      renamed: used.filter((r) => r.name !== r.spineName).length,
    };
  });

  return {
    pipelines: list,
    stageCount: spine.length,
    jobs: [...jobsBy.values()].reduce((n, x) => n + x, 0),
    overrides,
  };
}

/* ── Templates ───────────────────────────────────────────────────────────── */
export async function templatesPanel(exec: Exec = db()) {
  const [emails, kits, letters, bank, usesRows, uploaderRows, offerUseRows] =
    await Promise.all([
    exec.select().from(emailTemplates).orderBy(emailTemplates.sortOrder, emailTemplates.id),
    exec.select().from(interviewKits).orderBy(interviewKits.sortOrder, interviewKits.id),
    exec.select().from(offerTemplates).orderBy(offerTemplates.sortOrder, offerTemplates.id),
    exec.select().from(questionBank).orderBy(questionBank.sortOrder, questionBank.id),
    /* A bank question is attached to a requisition by copy, with bank_id
       pointing back at the original — so "used on" counts the copies. */
    exec.execute(sql`
      SELECT bank_id, count(DISTINCT job_id)::int AS n
        FROM job_questions WHERE bank_id IS NOT NULL GROUP BY 1`),
    exec.select({ id: staff.id, name: staff.name }).from(staff),
    exec.execute(sql`
      SELECT template_id, count(*)::int AS n FROM ${offers}
       WHERE template_id IS NOT NULL GROUP BY 1`),
  ]);
  const usesBy = new Map(rowsOf(usesRows).map((r) => [r.bank_id as string, Number(r.n)]));
  const offersBy = new Map(rowsOf(offerUseRows).map((r) => [r.template_id as string, Number(r.n)]));
  const nameBy = new Map(uploaderRows.map((r) => [r.id, r.name]));
  return {
    emails,
    kits,
    letters: letters.map((t) => ({
      ...t,
      uploadedByName: t.uploadedBy ? (nameBy.get(t.uploadedBy) ?? null) : null,
      uploadedAtIso: t.uploadedAt ? t.uploadedAt.toISOString() : null,
      offers: offersBy.get(t.id) ?? 0,
    })),
    bank: bank.map((q) => ({ ...q, uses: usesBy.get(q.id) ?? 0 })),
  };
}

/* ── Automations ─────────────────────────────────────────────────────────── */
export async function automationsPanel(now: Date, exec: Exec = db()) {
  const [ruleRows, runRows] = await Promise.all([
    exec.select().from(automationRules).orderBy(automationRules.sortOrder, automationRules.id),
    exec.execute(sql`
      SELECT rule_id, count(*)::int AS runs,
             count(*) FILTER (WHERE state = 'failed')::int AS failed,
             max(at) AS last_at
        FROM ${automationRuns}
       WHERE at >= ${at(now)} - interval '30 days'
       GROUP BY 1`),
  ]);
  const runsBy = new Map(rowsOf(runRows).map((r) => [r.rule_id as string, {
    runs: Number(r.runs ?? 0),
    failed: Number(r.failed ?? 0),
    lastAt: r.last_at ? new Date(r.last_at as string).toISOString() : null,
  }]));
  return {
    rules: ruleRows.map((r) => ({
      ...r,
      lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      stats: runsBy.get(r.id) ?? { runs: 0, failed: 0, lastAt: null },
    })),
  };
}

/* ── Integrations ────────────────────────────────────────────────────────── */
export type IntegrationRow = {
  id: string; key: string; name: string; kind: string;
  provider: string | null; state: string; health: string; detail: string | null;
  missingConfig: string[];
  lastSyncAt: string | null; lastCheckAt: string | null; lastError: string | null;
  /** What the environment says, which is what actually decides. */
  envConfigured: boolean;
  envProvider: string;
  envMissing: string[];
};

/* The row in the table is what the organisation intends; the environment is
   what the process can actually do. When the two disagree the environment
   wins, because a green light over a missing key is the one thing an
   integrations page must never show. */
const ENV_KEY: Record<string, keyof ReturnType<typeof providers>> = {
  email: 'email', whatsapp: 'whatsapp', sms: 'sms', linkedin: 'linkedin',
  calendar: 'calendar', esign: 'esign', voice: 'voice', hris: 'hris',
  assessment: 'assessment', ai: 'ai', storage: 'storage', malware: 'malware',
};

export async function integrationsPanel(exec: Exec = db()): Promise<{
  rows: IntegrationRow[]; connected: number; configuredInEnv: number;
}> {
  const rows = await exec.select().from(integrations).orderBy(integrations.sortOrder, integrations.key);
  const p = providers() as Record<string, { configured: boolean; provider: string; missing: string[] }>;
  const out = rows.map((r): IntegrationRow => {
    const envKey = ENV_KEY[r.key] ?? r.key;
    const e = p[envKey as string];
    return {
      id: r.id, key: r.key, name: r.name, kind: r.kind,
      provider: r.provider, state: r.state, health: r.health, detail: r.detail,
      missingConfig: r.missingConfig ?? [],
      lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
      lastCheckAt: r.lastCheckAt ? r.lastCheckAt.toISOString() : null,
      lastError: r.lastError,
      envConfigured: !!e?.configured,
      envProvider: e?.provider ?? 'none',
      envMissing: e?.missing ?? [],
    };
  });
  return {
    rows: out,
    connected: out.filter((r) => r.envConfigured).length,
    configuredInEnv: out.filter((r) => r.envProvider !== 'none').length,
  };
}

/* ── Audit trail ─────────────────────────────────────────────────────────── */
export type AuditRow = {
  id: string; at: string; actorName: string | null; actorRole: string | null;
  action: string; entity: string; entityId: string | null;
  summary: string | null; reason: string | null; source: string | null;
  correlationId: string | null;
  before: unknown; after: unknown;
};

export async function auditPanel(
  opts: { q?: string; action?: string; entity?: string; limit?: number },
  exec: Exec = db(),
): Promise<{ rows: AuditRow[]; total: number; actions: string[]; entities: string[] }> {
  const limit = Math.min(300, Math.max(20, opts.limit ?? 120));
  const where: ReturnType<typeof sql>[] = [];
  if (opts.action) where.push(sql`e.action = ${opts.action}`);
  if (opts.entity) where.push(sql`e.entity_type = ${opts.entity}`);
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(sql`(e.summary ILIKE ${like} OR e.actor_name ILIKE ${like} OR e.entity_id ILIKE ${like})`);
  }
  const clause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const [list, totalRow, actionRows, entityRows] = await Promise.all([
    exec.execute(sql`
      SELECT e.id, e.at, e.actor_name, e.actor_role, e.action::text AS action,
             e.entity_type, e.entity_id, e.entity_label,
             e.summary, e.reason, e.source, e.correlation_id, e.before, e.after
        FROM ${auditEvents} e ${clause}
       ORDER BY e.at DESC, e.id DESC LIMIT ${limit}`),
    exec.execute(sql`SELECT count(*)::int AS n FROM ${auditEvents} e ${clause}`),
    exec.execute(sql`SELECT DISTINCT action::text AS action FROM ${auditEvents} ORDER BY 1`),
    exec.execute(sql`SELECT DISTINCT entity_type FROM ${auditEvents} ORDER BY 1`),
  ]);

  return {
    rows: rowsOf(list).map((r) => ({
      id: r.id as string,
      at: new Date(r.at as string).toISOString(),
      actorName: r.actor_name ?? null,
      actorRole: r.actor_role ?? null,
      action: r.action as string,
      entity: r.entity_type as string,
      entityId: (r.entity_label ?? r.entity_id) ?? null,
      summary: r.summary ?? null,
      reason: r.reason ?? null,
      source: r.source ?? null,
      correlationId: r.correlation_id ?? null,
      before: r.before ?? null,
      after: r.after ?? null,
    })),
    total: Number(rowsOf(totalRow)[0]?.n ?? 0),
    actions: rowsOf(actionRows).map((r) => r.action as string),
    entities: rowsOf(entityRows).map((r) => r.entity_type as string),
  };
}

/* ── Notified teams ───────────────────────────────────────────── */
/* The onboarding board reads the same teams, but only needs who to write to.
   Settings maintains them, so it reads the row itself — every contact with its
   id, so a person can be edited, promoted to primary or removed. */
export async function notifiedTeamsPanel(exec: Exec = db()) {
  const rows = rowsOf(await exec.execute(sql`
    SELECT t.id, t.key, t.short, t.name, t.dept_id, t.purpose, t.ask,
           t.on_joining, t.on_file, d.name AS dept_name,
           coalesce((SELECT json_agg(json_build_object(
                       'id', c.id, 'name', c.name, 'email', c.email,
                       'role', c.role, 'isPrimary', c.is_primary)
                     ORDER BY c.is_primary DESC, c.sort_order)
                       FROM ${notifiedTeamContacts} c WHERE c.team_id = t.id), '[]'::json) AS contacts
      FROM ${notifiedTeams} t
      LEFT JOIN ${departments} d ON d.id = t.dept_id
     WHERE t.archived_at IS NULL
     ORDER BY t.sort_order, t.key`));
  return rows.map((r) => ({
    id: r.id as string,
    key: r.key as string,
    short: r.short as string,
    name: r.name as string,
    deptId: (r.dept_id ?? null) as string | null,
    deptName: (r.dept_name ?? null) as string | null,
    purpose: (r.purpose ?? '') as string,
    ask: (r.ask ?? '') as string,
    onJoining: r.on_joining !== false,
    onFile: r.on_file !== false,
    contacts: (r.contacts ?? []) as Array<{
      id: string; name: string; email: string; role: string | null; isPrimary: boolean;
    }>,
  }));
}

/* ── Access ───────────────────────────────────────────────────── */
export async function accessPanel(exec: Exec = db()) {
  /* The photograph comes from the staff row when the account is one of the
     team; a hiring manager has no staff record, so their avatar falls back to
     the initials the name resolves to. */
  const rows = rowsOf(await exec.execute(sql`
    SELECT a.id, a.kind::text AS kind, a.name, a.title, a.email, a.role::text AS role,
           a.status::text AS status, a.password_hash IS NOT NULL AS has_password,
           a.last_login_at, a.source, a.scope_kind::text AS scope_kind,
           a.scope_job_ids, a.scope_own, s.hue,
           /* Everybody on this list is drawn. A member of the team may have a
              photograph; a hiring manager never does, and gets the same drawn
              portrait here as on the interview they are sitting on — rather
              than falling back to initials on this one screen. */
           coalesce(s.photo, 'profile') AS photo,
           /* The drawn portrait is seeded from whoever this account IS, not
              from the account row: a member of the team is the same face on
              their profile, on a scorecard and here, and that only holds if
              every surface seeds on the staff id. */
           coalesce(a.staff_id, a.id) AS portrait_id, s.gender
      FROM ${accounts} a
      LEFT JOIN ${staff} s ON s.id = a.staff_id
     /* A removed account keeps its row so the audit trail still resolves its
        name; it simply drops out of the list. */
     WHERE a.removed_at IS NULL
     ORDER BY a.role, a.name`));
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    name: r.name as string,
    title: (r.title ?? null) as string | null,
    email: r.email as string,
    role: r.role as string,
    status: r.status as string,
    hasPassword: !!r.has_password,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string).toISOString() : null,
    source: (r.source ?? null) as string | null,
    scopeKind: r.scope_kind as string,
    scopeJobIds: (r.scope_job_ids ?? []) as string[],
    scopeOwn: !!r.scope_own,
    photo: (r.photo ?? null) as string | null,
    hue: r.hue == null ? null : Number(r.hue),
    portraitId: r.portrait_id as string,
    gender: (r.gender ?? null) as string | null,
  }));
}

/* ── Approvals ───────────────────────────────────────────────── */
export async function approvalsPanel(exec: Exec = db()) {
  const [flowRows, stepRows, pendingRows, sampleJobRows, sampleOfferRows, updaterRows, queueRows] =
    await Promise.all([
      exec.select().from(approvalFlows).orderBy(approvalFlows.sortOrder, approvalFlows.name),
      exec.select().from(approvalFlowSteps).orderBy(approvalFlowSteps.flowId, approvalFlowSteps.ordinal),
      exec.execute(sql`
        SELECT subject::text AS subject, count(*)::int AS n
          FROM approvals WHERE state = 'pending' GROUP BY 1`),
      /* The preview is worked against something real: the requisition waiting
         on approval right now, or failing that the first open one. */
      exec.execute(sql`
        SELECT j.id, j.title, j.openings, j.salary_min, j.salary_max, j.hiring_manager,
               d.name AS dept_name, d.head AS dept_head, d.head_title AS dept_head_title
          FROM ${jobs} j JOIN ${departments} d ON d.id = j.dept_id
         WHERE j.archived_at IS NULL
         ORDER BY (j.status = 'pending_approval') DESC, (j.status = 'open') DESC, j.id
         LIMIT 1`),
      exec.execute(sql`
        SELECT o.id, o.base_monthly, o.housing, o.transport, c.name AS candidate_name,
               j.title AS job_title, j.hiring_manager,
               d.name AS dept_name, d.head AS dept_head, d.head_title AS dept_head_title
          FROM ${offers} o
          JOIN ${jobs} j ON j.id = o.job_id
          JOIN ${departments} d ON d.id = j.dept_id
          JOIN ${candidates} c ON c.id = o.candidate_id
         ORDER BY (o.state = 'pending_approval') DESC, (o.state = 'draft') DESC, o.id
         LIMIT 1`),
      exec.select({ id: staff.id, name: staff.name, title: staff.title, role: staff.role })
        .from(staff).orderBy(staff.id),
      exec.execute(sql`
        SELECT count(*)::int AS n FROM ${offers}
         WHERE state = 'approved' AND verified_at IS NULL`),
    ]);

  const pendingBy = new Map(rowsOf(pendingRows).map((r) => [r.subject as string, Number(r.n)]));
  const nameBy = new Map(updaterRows.map((r) => [r.id, r.name]));
  const staffBy = new Map(updaterRows.map((r) => [r.id, r]));
  const admin = updaterRows.find((r) => r.role === 'tal_lead') ?? null;
  const job = rowsOf(sampleJobRows)[0];
  const offer = rowsOf(sampleOfferRows)[0];

  const flows = [];
  for (const f of flowRows) {
    const ctx = f.subject === 'requisition'
      ? (job && {
        openings: Number(job.openings ?? 0),
        salaryMin: Number(job.salary_min ?? 0),
        salaryMax: Number(job.salary_max ?? 0),
        hiringManager: (job.hiring_manager ?? null) as string | null,
        deptHead: (job.dept_head ?? null) as string | null,
        deptHeadTitle: (job.dept_head_title ?? null) as string | null,
      })
      : (offer && {
        baseMonthly: Number(offer.base_monthly ?? 0),
        totalMonthly: Number(offer.base_monthly ?? 0) + Number(offer.housing ?? 0) + Number(offer.transport ?? 0),
        hiringManager: (offer.hiring_manager ?? null) as string | null,
        deptHead: (offer.dept_head ?? null) as string | null,
        deptHeadTitle: (offer.dept_head_title ?? null) as string | null,
      });

    flows.push({
      id: f.id,
      subject: f.subject,
      name: f.name,
      isActive: f.isActive,
      publishOnApprove: f.publishOnApprove,
      publishChannels: f.publishChannels ?? [],
      requireVerification: f.requireVerification,
      updatedAt: f.updatedAt ? f.updatedAt.toISOString() : null,
      updatedByName: f.updatedBy ? (nameBy.get(f.updatedBy) ?? f.updatedBy) : null,
      /* Every configured step, with its approver resolved the way the chain
         will resolve it: a role step names the Admin who holds it, a hiring
         manager step names the record's, a named step names the person. */
      steps: stepRows.filter((s) => s.flowId === f.id).map((s) => {
        const who = s.approverType === 'role' ? (admin?.name ?? 'Admin')
          : s.approverType === 'hiring_manager' ? (ctx?.hiringManager ?? null)
            : s.approverType === 'dept_head' ? (ctx?.deptHead ?? null)
              : s.approverType === 'staff' ? (staffBy.get(s.approverStaffId ?? '')?.name ?? s.approverName)
                : s.approverName;
        const title = s.approverType === 'role' ? 'Any Admin'
          : s.approverType === 'hiring_manager' ? 'Hiring manager'
            : s.approverType === 'dept_head' ? (ctx?.deptHeadTitle ?? 'Department head')
              : s.approverType === 'staff' ? (staffBy.get(s.approverStaffId ?? '')?.title ?? s.approverTitle)
                : s.approverTitle;
        return {
          id: s.id,
          label: s.label,
          approverType: s.approverType,
          typeLabel: APPROVER_TYPE_LABEL[s.approverType] ?? 'Approver',
          who: who ?? null,
          title: title ?? null,
          conditionText: conditionText(s.condField, s.condOp, s.condValue),
          auto: s.auto,
          ordinal: s.ordinal,
        };
      }),
      pending: f.isActive ? (pendingBy.get(f.subject) ?? 0) : 0,
      /* What the chain comes out as for that sample, conditions applied. */
      preview: f.isActive && ctx
        ? (await buildSteps(f.subject as 'requisition' | 'offer', ctx as never, exec))
          .map((x) => ({ label: x.label, who: x.approverName ?? '—', auto: x.auto }))
        : [],
      previewOf: f.subject === 'requisition'
        ? (job?.title as string) ?? null
        : offer ? `${offer.candidate_name} — ${Number(offer.base_monthly).toLocaleString('en-US')} basic` : null,
    });
  }

  return {
    flows,
    pendingRequisitions: pendingBy.get('requisition') ?? 0,
    pendingOffers: pendingBy.get('offer') ?? 0,
    lettersAwaitingVerification: Number(rowsOf(queueRows)[0]?.n ?? 0),
  };
}

/* ── Sales pitch ────────────────────────────────────────────── */
export async function pitchPanel(exec: Exec = db()) {
  const [projectRows, cfgRows, jobRows, pitchRows] = await Promise.all([
    exec.select().from(pitchProjects).orderBy(pitchProjects.sortOrder, pitchProjects.id),
    exec.select().from(pitchConfig).where(sql`id = 'pitch_cfg'`).limit(1),
    exec.execute(sql`
      SELECT j.id, j.title, d.name AS dept_name, j.pitch_on, j.pitch_project_id,
             j.pitch_lead_hours, j.pitch_channels,
             (SELECT count(*)::int FROM ${applications} a
               WHERE a.job_id = j.id AND a.stage = 'pitch' AND a.status IN ('active','on_hold')) AS on_stage
        FROM ${jobs} j JOIN ${departments} d ON d.id = j.dept_id
       ORDER BY j.id`),
    exec.execute(sql`
      SELECT p.job_id, p.project_id, p.status::text AS status, p.score
        FROM pitches p`),
  ]);

  const pitches = rowsOf(pitchRows);
  const done = pitches.filter((p) => p.status === 'completed');
  const runsByProject = new Map<string, number>();
  for (const p of pitches) {
    const k = p.project_id as string;
    runsByProject.set(k, (runsByProject.get(k) ?? 0) + 1);
  }

  const allJobs = rowsOf(jobRows);
  const onJobsByProject = new Map<string, number>();
  for (const j of allJobs) {
    if (!j.pitch_on || !j.pitch_project_id) continue;
    const k = j.pitch_project_id as string;
    onJobsByProject.set(k, (onJobsByProject.get(k) ?? 0) + 1);
  }

  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  return {
    projects: projectRows.map((p) => ({
      id: p.id, name: p.name, who: p.who, client: p.client,
      durationMin: p.durationMin, prepHours: p.prepHours,
      criteria: p.criteria ?? [],
      active: p.active,
      onJobs: onJobsByProject.get(p.id) ?? 0,
      runs: runsByProject.get(p.id) ?? 0,
    })),
    config: cfgRows[0]
      ? {
        leadHours: cfgRows[0].leadHours,
        channels: cfgRows[0].channels ?? [],
        gateFinal: cfgRows[0].gateFinal,
        waTemplate: cfgRows[0].waTemplate,
        emailSubject: cfgRows[0].emailSubject,
        emailBody: cfgRows[0].emailBody,
        updatedAt: cfgRows[0].updatedAt ? cfgRows[0].updatedAt.toISOString() : null,
      }
      : null,
    jobs: allJobs.filter((j) => j.pitch_on).map((j) => {
      const mine = done.filter((p) => p.job_id === j.id);
      return {
        id: j.id as string,
        title: j.title as string,
        deptName: j.dept_name as string,
        projectName: j.pitch_project_id ? (projectName.get(j.pitch_project_id as string) ?? null) : null,
        leadHours: Number(j.pitch_lead_hours ?? cfgRows[0]?.leadHours ?? 24),
        channels: (j.pitch_channels ?? cfgRows[0]?.channels ?? []) as string[],
        onStage: Number(j.on_stage ?? 0),
        pitched: mine.length,
        medianScore: median(mine.map((p) => Number(p.score)).filter((n) => !Number.isNaN(n))),
      };
    }),
    jobsTotal: allJobs.length,
    runs: pitches.length,
  };
}

/* ── Data ────────────────────────────────────────────────────────────────── */
export type TableCount = { table: string; label: string; n: number };

/** What is actually in the database, counted rather than described. */
export async function dataPanel(exec: Exec = db()): Promise<{
  counts: TableCount[];
  org: Org;
  seed: { datasetClock: string | null; datasetAsOf: string | null; rebasedDays: number | null };
}> {
  const r = rowsOf(await exec.execute(sql`
    SELECT
      (SELECT count(*)::int FROM ${departments}) AS departments,
      (SELECT count(*)::int FROM ${functions}) AS functions,
      (SELECT count(*)::int FROM ${locations}) AS locations,
      (SELECT count(*)::int FROM ${staff}) AS staff,
      (SELECT count(*)::int FROM ${accounts}) AS accounts,
      (SELECT count(*)::int FROM ${jobs}) AS jobs,
      (SELECT count(*)::int FROM ${candidates}) AS candidates,
      (SELECT count(*)::int FROM ${applications}) AS applications,
      (SELECT count(*)::int FROM ${interviews}) AS interviews,
      (SELECT count(*)::int FROM ${evaluations}) AS evaluations,
      (SELECT count(*)::int FROM ${offers}) AS offers,
      (SELECT count(*)::int FROM ${employees}) AS employees,
      (SELECT count(*)::int FROM ${files}) AS files,
      (SELECT count(*)::int FROM ${tasks}) AS tasks,
      (SELECT count(*)::int FROM ${notifications}) AS notifications,
      (SELECT count(*)::int FROM ${auditEvents}) AS audit_events,
      (SELECT count(*)::int FROM ${domainEvents}) AS domain_events,
      (SELECT count(*)::int FROM ${jobQueue}) AS job_queue,
      (SELECT count(*)::int FROM ${webhookEvents}) AS webhook_events,
      (SELECT count(*)::int FROM ${goals}) AS goals,
      (SELECT count(*)::int FROM ${sources}) AS sources,
      (SELECT count(*)::int FROM ${hashtags}) AS hashtags`))[0];

  const LABELS: Array<[string, string]> = [
    ['departments', 'Departments'], ['functions', 'Functions'], ['locations', 'Locations'],
    ['staff', 'Staff'], ['accounts', 'Accounts'], ['jobs', 'Requisitions'],
    ['candidates', 'Candidates'], ['applications', 'Applications'], ['interviews', 'Interviews'],
    ['evaluations', 'Scorecards'], ['offers', 'Offers'], ['employees', 'Employees'],
    ['files', 'Files'], ['tasks', 'Tasks'], ['notifications', 'Notifications'],
    ['audit_events', 'Audit events'], ['domain_events', 'Domain events'],
    ['job_queue', 'Queued jobs'], ['webhook_events', 'Webhook deliveries'],
    ['goals', 'Monthly goals'], ['sources', 'Sources'], ['hashtags', 'Hashtags'],
  ];

  const o = await org(exec);
  const extra = (o.extra ?? {}) as Record<string, unknown>;
  return {
    counts: LABELS.map(([table, label]) => ({ table, label, n: Number(r[table] ?? 0) })),
    org: o,
    seed: {
      datasetClock: (extra.datasetClock as string) ?? null,
      datasetAsOf: (extra.datasetAsOf as string) ?? null,
      rebasedDays: extra.rebasedDays == null ? null : Number(extra.rebasedDays),
    },
  };
}
