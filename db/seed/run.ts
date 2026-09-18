/* ─────────────────────────────────────────────────────────────────────────────
   Seed the production database from the prototype's dataset.

   The prototype is the acceptance specification, so its data is what the
   production system is verified against: the same 9 functions, 29 departments,
   375 coded seats, 469 colleagues, 49 requisitions, 1,000 people and 1,209
   applications, with every scorecard, screening, interview, pitch, offer and
   probation record that hangs off them.

   Everything keeps its original id, so a record can be followed from the
   prototype to here by eye. Timestamps keep the dataset's own clock
   (meta.asOf = 2026-09-03) rather than being re-based on the wall clock,
   because every relative figure in the product is measured against it.

     npm run db:seed              seed from the prototype dataset
     npm run db:seed -- --blank   just the fixed reference data
     npm run db:seed -- --force   wipe the business data first
   ───────────────────────────────────────────────────────────────────────────*/
import pg from 'pg';
import { loadEnvFiles } from '../env-files';
import {
  protoData, asOf, iso, day, month, int, num, arr, computeShift, setShift, shift, nowIso,
  type Proto,
} from './source';
import { hashPassword } from '../../lib/auth/password';

loadEnvFiles();

const FLAGS = new Set(process.argv.slice(2));
const BLANK = FLAGS.has('--blank');
const FORCE = FLAGS.has('--force');

/* Tables emptied by --force, in dependency order. Reference data the product
   cannot run without (stages) is re-seeded either way. */
const BUSINESS_TABLES = [
  'audit_events', 'report_requests', 'saved_reports', 'pipeline_snapshots',
  'automation_runs', 'domain_events', 'automation_rules', 'job_queue', 'webhook_events',
  'file_access_log', 'files', 'messages', 'message_threads', 'notifications', 'tasks',
  'pitch_scores', 'pitch_turns', 'pitches', 'pitch_config', 'pitch_projects',
  'assessments', 'interview_panel', 'interviews',
  'screening_scores', 'screening_turns', 'screenings',
  'offer_messages', 'offer_signatures', 'offer_documents', 'offer_letter_edits', 'offers',
  'offer_templates', 'approval_steps', 'approvals', 'approval_flow_steps', 'approval_flows',
  'reviews', 'comments', 'evaluation_criteria', 'evaluations',
  'cross_links', 'application_answers', 'application_stage_history', 'applications',
  'talent_pool_members', 'talent_pools', 'candidate_resumes', 'candidate_skills', 'candidates',
  'job_questions', 'job_channels', 'job_skills', 'job_stages', 'job_hiring_managers', 'jobs',
  'question_bank', 'interview_kits', 'email_templates',
  'joining_notices', 'probation_records', 'employee_references', 'onboarding_documents',
  'onboarding_records', 'employees', 'positions',
  'notified_team_contacts', 'notified_teams', 'goals',
  'login_attempts', 'sessions', 'accounts', 'staff',
  'departments', 'functions', 'sources', 'hashtags', 'locations', 'pipelines',
  'integrations', 'reference_counters', 'org_settings',
];

// ── plumbing ────────────────────────────────────────────────────────────────
let client: pg.Client;
const t0 = Date.now();
const counts: Record<string, number> = {};

function log(msg: string) { process.stdout.write(`  ${msg}\n`); }

/* Multi-row INSERT in chunks. Drizzle is the query builder for the application;
   here, where the shape is fixed and the volume is 1,209 rows at a time, raw
   parameterised SQL is both faster and easier to read. */
async function insert(table: string, cols: string[], rows: unknown[][], chunk = 400): Promise<number> {
  if (!rows.length) return 0;
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  let done = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const tuples = slice.map((row) => {
      const ph = row.map((v) => { params.push(v); return `$${params.length}`; });
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `INSERT INTO "${table}" (${quoted}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
    done += slice.length;
  }
  counts[table] = (counts[table] ?? 0) + done;
  return done;
}

const uniq = <T>(a: T[]): T[] => [...new Set(a)];
const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

// ─────────────────────────────────────────────────────────────────────────────
//  Fixed reference data: the stage spine and the two things derived from it.
// ─────────────────────────────────────────────────────────────────────────────
const SPINE = [
  { key: 'applied',    name: 'Applied',        short: 'App',    sla: 3,  kind: 'entry',  optional: false, fixed: true },
  { key: 'sourced',    name: 'Sourced',        short: 'Src',    sla: 4,  kind: 'entry',  optional: false, fixed: true },
  { key: 'screen',     name: 'Phone Screen',   short: 'Screen', sla: 4,  kind: 'screen', optional: false, fixed: false },
  { key: 'assessment', name: 'Assessment',     short: 'Assess', sla: 5,  kind: 'assess', optional: false, fixed: false },
  { key: 'iv1',        name: '1st Interview',  short: 'IV 1',   sla: 6,  kind: 'iv',     optional: false, fixed: false },
  { key: 'iv2',        name: '2nd Interview',  short: 'IV 2',   sla: 6,  kind: 'iv',     optional: false, fixed: false },
  { key: 'pitch',      name: 'Sales Pitch',    short: 'Pitch',  sla: 4,  kind: 'iv',     optional: true,  fixed: false },
  { key: 'ivf',        name: '3rd Interview',  short: 'IV 3',   sla: 5,  kind: 'iv',     optional: false, fixed: false },
  { key: 'offer',      name: 'Offer Stage',    short: 'Offer',  sla: 7,  kind: 'offer',  optional: false, fixed: true },
  { key: 'joined',     name: 'Joined',         short: 'Joined', sla: 30, kind: 'closed', optional: false, fixed: true },
];

async function seedSpine(d: Proto | null) {
  const src = d?.stages?.length ? d.stages : SPINE;
  const rows = SPINE.map((fallback, i) => {
    const s = src.find((x: any) => x.key === fallback.key) ?? fallback;
    return [s.key, s.name, s.short ?? fallback.short, int(s.sla, fallback.sla),
      s.kind ?? fallback.kind, !!s.optional, i, fallback.fixed];
  });
  await insert('stages', ['key', 'name', 'short', 'default_sla', 'kind', 'optional', 'ordinal', 'fixed'], rows);
}

/* The integration register. One row per system the platform can talk to; the
   state is recomputed from the environment on every boot, so a page can say
   "not configured" and name the variable that is missing. */
const INTEGRATIONS: Array<[string, string, string, string]> = [
  ['calendar',   'Calendar',                      'calendar',   'Interview invitations, free/busy and reschedules'],
  ['email',      'Transactional e-mail',          'email',      'Candidate and internal e-mail, with delivery receipts'],
  ['whatsapp',   'WhatsApp Business',             'whatsapp',   'Screening links, pitch briefs and reminders'],
  ['sms',        'SMS',                           'sms',        'Call-back links and booking links'],
  ['esign',      'E-signature',                   'esign',      'The offer envelope, its documents and the signature'],
  ['voice',      'Telephony / voice assistant',   'voice',      'The AI phone screen: the call, the recording, the transcript'],
  ['hris',       'HRIS',                          'hris',       'The joiner handover: employee file, payroll, Qiwa and GOSI'],
  ['assessment', 'Behavioural assessments',       'assessment', 'The manager-and-above questionnaire and its report'],
  ['linkedin',   'LinkedIn Talent Solutions',     'job_board',  'Publishing to the Bayut company page'],
  ['ai',         'Claude',                        'ai',         'CV reading, call and pitch analysis, Ask AI'],
  ['storage',    'Object storage',                'storage',    'CVs, letters, documents, recordings and exports'],
  ['malware',    'Malware scanning',              'storage',    'Every uploaded file, before anybody can download it'],
];

async function seedIntegrations() {
  await insert('integrations',
    ['id', 'key', 'name', 'kind', 'state', 'health', 'detail', 'sort_order'],
    INTEGRATIONS.map(([key, name, kind, detail], i) =>
      [`int_${key}`, key, name, kind, 'not_configured', 'unknown', detail, i]));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Organisation
// ─────────────────────────────────────────────────────────────────────────────
async function seedOrg(d: Proto) {
  const s = d.settings ?? {};
  await insert('org_settings', [
    'id', 'org_name', 'legal_name', 'currency', 'currency_symbol', 'country', 'timezone',
    'fiscal_year_start', 'locale', 'second_locale', 'data_retention_months',
    'brand_primary', 'brand_accent', 'brand_note', 'offer_approval_threshold',
    'leader_name', 'leader_title', 'signed_by', 'ats_owner', 'hris_name', 'extra',
  ], [[
    'org', s.orgName ?? 'Bayut KSA', s.legalName ?? 'Bayut Saudi Arabia',
    s.currency ?? 'SAR', s.currencySymbol ?? 'SAR', s.country ?? 'Saudi Arabia',
    s.timezone ?? 'Asia/Riyadh (AST, UTC+3)', s.fiscalYearStart ?? 'January',
    s.locale ?? 'en-SA', s.secondLocale ?? 'ar-SA', int(s.dataRetentionMonths, 24),
    s.brand?.primary ?? '#0E9E62', s.brand?.accent ?? '#C98A16', s.brand?.note ?? null,
    int(s.offerApprovalThreshold, 30000),
    s.leader?.name ?? null, s.leader?.title ?? null, s.signedBy ?? null,
    s.atsOwner ?? null, s.hrisName ?? null,
    /* The clock the dataset was rebased onto. It is what the prototype calls
       "now", and it is recorded so a test can hold production's clock to the
       same instant the reference captures were taken at. */
    JSON.stringify({ slaDefaults: s.slaDefaults ?? {}, weekend: s.weekend ?? ['Friday', 'Saturday'],
      datasetClock: nowIso(d), datasetAsOf: d.meta?.asOf ?? null, rebasedDays: shift(),
      sectors: d.meta?.sectors ?? [], sectorCompanies: d.meta?.sectorCompanies ?? {} }),
  ]]);

  await insert('locations', ['id', 'city', 'region', 'office', 'is_remote'],
    arr<any>(d.locations).map((l) => [l.id, l.city, l.region, l.office,
      /remote/i.test(l.office ?? '') || /remote/i.test(l.city ?? '')]));

  await insert('functions', ['id', 'name', 'code', 'head', 'head_title', 'hue', 'sort_order', 'created_at'],
    arr<any>(d.functions).map((f, i) => [f.id, f.name, f.code, f.head, f.headTitle, int(f.hue, 1), i, iso(f.createdAt)]));

  await insert('departments',
    ['id', 'name', 'code', 'function_id', 'head', 'head_title', 'sort_order', 'headcount',
      'cost_centre', 'created_at'],
    arr<any>(d.departments).map((x, i) =>
      [x.id, x.name, x.code, x.functionId ?? null, x.head, x.headTitle, i, num(x.headcount),
        x.costCentre, iso(x.createdAt)]));

  await insert('sources', ['id', 'name', 'route', 'sort_order'],
    arr<string>(d.sources).map((name, i) => {
      const route = ['Internal Mobility', 'Referral'].includes(name) ? 'internal'
        : ['Sourced — Outbound', 'Agency', 'Talent Pool'].includes(name) ? 'hunt' : 'linkedin';
      return [`src_${i + 1}`, name, route, i];
    }));

  await insert('hashtags', ['id', 'tag', 'sort_order'],
    arr<string>(d.hashtags).map((tag, i) => [`tag_${i + 1}`, tag, i]));

  await insert('staff', [
    'id', 'name', 'title', 'role', 'role_label', 'email', 'phone', 'gender', 'location_id',
    'dept_ids', 'monthly_target', 'lifetime_hires', 'joined_on', 'hue', 'seniority',
    'placeholder_name', 'photo', 'status', 'created_at',
  ], arr<any>(d.staff).map((p) => [
    p.id, p.name, p.title, p.role, p.roleLabel, p.email, p.phone ?? null, p.gender ?? null,
    p.locationId ?? null, arr<string>(p.deptIds), int(p.monthlyTarget), int(p.lifetimeHires),
    day(p.joinedOn), int(p.hue, 1), p.seniority ?? null, !!p.placeholderName,
    p.photo ?? null, p.status ?? 'active', iso(p.joinedOn) ?? nowIso(d),
  ]));

  /* The plan is keyed by month, so it moves with the rest of the dataset —
     otherwise a shifted set of hires would be measured against last year's
     target and every attainment ring would be wrong. */
  await insert('goals', ['month', 'hires', 'time_to_hire_days', 'cost_per_hire_sar', 'offer_accept_rate', 'quality_of_hire'],
    arr<any>(d.goals).map((g) => [month(g.month) ?? g.month, int(g.hires), num(g.timeToHireDays), num(g.costPerHireSar),
      g.offerAcceptRate == null ? null : String(g.offerAcceptRate),
      g.qualityOfHire == null ? null : String(g.qualityOfHire)]));

  // Notified teams and their people
  const teams = arr<any>(d.teams);
  await insert('notified_teams', ['id', 'key', 'short', 'name', 'dept_id', 'purpose', 'ask', 'on_joining', 'on_file', 'sort_order'],
    teams.map((t, i) => [t.id, t.key, t.short, t.name, t.deptId ?? null, t.purpose ?? null, t.ask ?? null,
      t.onJoining !== false, t.onFile !== false, i]));
  await insert('notified_team_contacts', ['id', 'team_id', 'name', 'email', 'role', 'is_primary', 'sort_order'],
    teams.flatMap((t) => arr<any>(t.contacts).map((c, i) =>
      [c.id ?? `${t.id}_c${i}`, t.id, c.name, c.email, c.role ?? null, !!c.primary, i])));
}

/* Accounts. Every prototype account that had a password gets one here too —
   re-hashed with scrypt, never carried across as the old SHA-256, and only for
   a local development seed. A production import leaves them `invited` so each
   person chooses their own at first sign-in. */
async function seedAccounts(d: Proto) {
  const isProd = process.env.NODE_ENV === 'production';
  const DEMO = process.env.SEED_DEMO_PASSWORD ?? 'Bayut-KSA-2026!demo';
  const demoHash = isProd ? null : await hashPassword(DEMO);

  const rows = arr<any>(d.accounts).map((a) => {
    const hasPassword = !!a.pass && !isProd;
    return [
      a.id, a.kind, a.staffId ?? null, a.name, a.title ?? null, String(a.email).toLowerCase(),
      a.role, hasPassword ? 'active' : (a.status === 'disabled' ? 'disabled' : 'invited'),
      hasPassword ? demoHash : null,
      hasPassword ? iso(a.pass.setAt) ?? nowIso(d) : null,
      iso(a.lastLoginAt), a.scope?.kind ?? (a.role === 'staff' ? 'all' : 'own'),
      arr<string>(a.scope?.jobIds), a.scope?.own !== false,
      a.source ?? null, a.invitedBy ?? null, iso(a.createdAt), iso(a.createdAt),
    ];
  });
  await insert('accounts', [
    'id', 'kind', 'staff_id', 'name', 'title', 'email', 'role', 'status',
    'password_hash', 'password_set_at', 'last_login_at',
    'scope_kind', 'scope_job_ids', 'scope_own', 'source', 'invited_by', 'invited_at', 'created_at',
  ], rows);

  if (!isProd) log(`accounts seeded with the development password "${DEMO}"`);
}

/* The manpower plan. A seat's approved headcount is raised to the number of
   people actually in it, the way the prototype's own selector did — a plan that
   reads fewer seats than it holds is not a plan. */
async function seedPlan(d: Proto) {
  const positions = arr<any>(d.positions);
  const employees = arr<any>(d.employees);
  const held = new Map<string, number>();
  for (const e of employees) {
    if (e.positionCode && e.status !== 'left') held.set(e.positionCode, (held.get(e.positionCode) ?? 0) + 1);
  }

  await insert('positions', [
    'id', 'code', 'title', 'dept_id', 'function_id', 'grade', 'reports_to_id', 'reports_to_function_id',
    'plan_state', 'approved', 'requested', 'job_id', 'location_id', 'kind',
    'holder_name', 'holder_gender', 'created_at',
  ], positions.map((p) => {
    const pending = p.planState === 'pending';
    const filled = held.get(p.code) ?? 0;
    return [
      p.id, p.code, p.title, p.deptId, p.functionId ?? null, p.grade ?? null,
      p.reportsTo ?? null, p.reportsToFunction ?? null,
      pending ? 'pending' : 'approved',
      pending ? 0 : Math.max(int(p.approved), filled),
      pending ? Math.max(1, int(p.requested, 1)) : 0,
      p.jobId ?? null, p.locationId ?? null, p.kind ?? 'role',
      p.holder ?? null, p.holderGender ?? null, iso(p.createdAt),
    ];
  }));

  await insert('employees', [
    'id', 'employee_code', 'name', 'gender', 'candidate_id', 'application_id', 'offer_id', 'job_id',
    'position_code', 'dept_id', 'title', 'location_id', 'start_date', 'status', 'source',
    'left_on', 'left_reason', 'created_at',
  ], employees.map((e) => [
    e.id, e.employeeId, e.name, e.gender ?? null, e.candidateId ?? null, e.appId ?? null,
    e.offerId ?? null, e.jobId ?? null, e.positionCode ?? null, e.deptId, e.title,
    e.locationId ?? null, day(e.startDate), e.status, e.source,
    day(e.leftOn), e.leftReason ?? null, iso(e.createdAt) ?? iso(e.startDate + 'T06:00:00.000Z'),
  ]));

  // Onboarding records, documents and referees
  const onbRows: unknown[][] = [];
  const docRows: unknown[][] = [];
  const refRows: unknown[][] = [];
  const probRows: unknown[][] = [];
  const noticeRows: unknown[][] = [];

  for (const e of employees) {
    const o = e.onboarding ?? {};
    const f = o.form ?? null;
    onbRows.push([`onb_${e.id}`, e.id, iso(o.formSentAt), iso(o.formSubmittedAt),
      f?.nationalId ?? null, f?.nationality ?? null, day(f?.dob), f?.address ?? null,
      f?.emergencyContact ?? null, f?.bank ?? null, f?.iban ?? null, iso(o.completedAt)]);

    arr<any>(o.documents).forEach((doc, i) => {
      docRows.push([`doc_${e.id}_${doc.key}`, e.id, doc.key, doc.label, doc.status,
        doc.file ?? null, iso(doc.uploadedAt), iso(doc.verifiedAt), doc.verifiedBy ?? null, i]);
    });

    arr<any>(o.references).forEach((r, i) => {
      refRows.push([`ref_${e.id}_${i}`, e.id, r.name, r.title ?? null, r.company ?? null,
        r.relationship ?? null, r.contact ?? null, r.status ?? 'pending', r.rating ?? null,
        r.notes ?? null, iso(r.contactedAt), iso(r.answeredAt ?? (r.status === 'done' ? r.at : null)),
        r.by ?? null]);
    });

    if (e.source === 'hire') {
      const p = e.probation ?? null;
      const start = day(e.startDate)!;
      /* The end is recomputed from the shifted start rather than shifted itself.
         Adding three months and adding fourteen days do not commute — March has
         thirty-one days and June has thirty — and the three-month rule is the
         definition, so it is what the record has to satisfy. */
      const months = int(p?.months, 3);
      probRows.push([`prb_${e.id}`, e.id, months, start, addMonthsIso(start, months),
        p?.state ?? 'in_progress', day(p?.decidedOn), null, p?.decidedBy ?? null,
        p?.reason ?? null, p?.note ?? null]);
    }

    const notice = (e.onboarding ?? {}).notice;
    if (notice) {
      arr<any>(notice.to).forEach((t, i) => {
        noticeRows.push([`ntc_${e.id}_${t.key ?? i}`, e.id, 'joining', t.key ?? String(i),
          day(notice.startDate), iso(notice.at), notice.by ?? 'system', t.head ?? t.name ?? null,
          t.email ?? null, arr<string>(t.cc), 0, false, null]);
      });
    }
    arr<any>((e.onboarding ?? {}).sent).forEach((s, i) => {
      noticeRows.push([`fil_${e.id}_${s.key}_${i}`, e.id, 'file', s.key, day(e.startDate),
        iso(s.at), s.by ?? 'system', s.head ?? null, s.to ?? null, [], int(s.docs), !!s.form, null]);
    });
  }

  await insert('onboarding_records', ['id', 'employee_id', 'form_sent_at', 'form_submitted_at',
    'national_id', 'nationality', 'dob', 'address', 'emergency_contact', 'bank', 'iban', 'completed_at'], onbRows);
  await insert('onboarding_documents', ['id', 'employee_id', 'key', 'label', 'status', 'file_id',
    'uploaded_at', 'verified_at', 'verified_by', 'sort_order'], docRows);
  await insert('employee_references', ['id', 'employee_id', 'name', 'title', 'company', 'relationship',
    'contact', 'status', 'rating', 'notes', 'contacted_at', 'answered_at', 'recorded_by'], refRows);
  await insert('probation_records', ['id', 'employee_id', 'months', 'starts_on', 'ends_on', 'state',
    'decided_on', 'decided_by', 'decided_by_name', 'reason', 'note'], probRows);
  await insert('joining_notices', ['id', 'employee_id', 'kind', 'team_key', 'start_date', 'sent_at',
    'sent_by', 'to_name', 'to_email', 'cc_emails', 'document_count', 'form_included', 'message_id'], noticeRows);
}

function addMonthsIso(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  const day0 = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() < day0) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hiring: pipelines, requisitions, candidates, applications
// ─────────────────────────────────────────────────────────────────────────────
async function seedPipelines(d: Proto) {
  await insert('pipelines', ['id', 'name', 'off_stages', 'sells', 'labels', 'sort_order'],
    arr<any>(d.pipelines).map((p, i) =>
      [p.id, p.name, arr<string>(p.off), !!p.sells, JSON.stringify(p.labels ?? {}), i]));

  await insert('interview_kits',
    ['id', 'pipeline_id', 'name', 'criteria', 'questions', 'sort_order'],
    arr<any>(d.interviewKits).map((k, i) => [k.id, k.pipelineId ?? null, k.name,
      JSON.stringify(arr(k.criteria)), arr<string>(k.questions), i]));

  await insert('email_templates',
    ['id', 'name', 'stage', 'lang', 'subject', 'body', 'sort_order'],
    arr<any>(d.emailTemplates).map((t, i) =>
      [t.id, t.name, t.stage ?? null, t.lang ?? 'en', t.subject, t.body, i]));

  await insert('question_bank',
    ['id', 'text', 'type', 'options', 'required', 'knockout', 'families', 'is_standard', 'sort_order'],
    arr<any>(d.questionBank).map((q, i) => [q.id, q.text, q.type, q.options ?? null, !!q.required,
      q.knockout ?? null, arr<string>(q.families), !!q.std, i]));
}

async function seedJobs(d: Proto) {
  const jobs = arr<any>(d.jobs);
  const year = new Date(nowIso(d)).getUTCFullYear();

  await insert('jobs', [
    'id', 'reference', 'title', 'slug', 'dept_id', 'location_id', 'pipeline_id', 'position_code',
    'employment_type', 'status', 'priority', 'openings', 'filled', 'salary_min', 'salary_max',
    'currency', 'family', 'recruiter_id', 'sourcer_id', 'coordinator_id', 'hiring_manager', 'panel',
    'opened_on', 'target_start_on', 'closed_on', 'remote_ok', 'headcount_ref',
    'budgeted', 'budget_note', 'approved_by',
    'sourcing_internal', 'sourcing_hunt', 'sourcing_linkedin', 'sourcing_note',
    'pitch_on', 'pitch_project_id', 'pitch_channels', 'pitch_lead_hours', 'pitch_note',
    'desc_summary', 'desc_responsibilities', 'desc_requirements', 'desc_benefits', 'desc_updated_at',
    'hashtags', 'archived_at', 'created_at',
  ], jobs.map((j, i) => {
    const desc = j.description ?? {};
    const src = j.sourcing ?? {};
    const pitch = j.pitch ?? {};
    const hasRoute = src.internal || src.hunt || src.linkedin;
    return [
      j.id, `REQ-${year}-${String(i + 1).padStart(4, '0')}`, j.title, j.slug,
      j.deptId, j.locationId, j.pipelineId ?? null, j.positionCode ?? null,
      j.employmentType ?? 'full_time', j.status, j.priority, int(j.openings, 1), int(j.filled),
      int(j.salaryMin), int(j.salaryMax), j.currency ?? 'SAR', j.family,
      j.recruiterId ?? null, j.sourcerId ?? null, j.coordinatorId ?? null,
      j.hiringManager ?? null, arr<string>(j.panel),
      day(j.openedOn), day(j.targetStartOn), day(j.closedOn), !!j.remoteOk, j.headcountRef ?? null,
      j.budgeted !== false, j.budgetNote ?? null, j.approvedBy ?? null,
      !!src.internal, !!src.hunt, hasRoute ? !!src.linkedin : true, src.note ?? null,
      !!pitch.on, pitch.projectId ?? null,
      arr<string>(pitch.channels).length ? arr<string>(pitch.channels) : ['whatsapp', 'email'],
      num(pitch.leadHours), pitch.note ?? null,
      desc.summary ?? null, arr<string>(desc.responsibilities), arr<string>(desc.requirements),
      arr<string>(desc.benefits ?? desc.niceToHave), iso(desc.updatedAt),
      arr<string>(j.hashtags), j.archived ? iso(j.closedOn) ?? nowIso(d) : null,
      iso(j.openedOn + 'T06:00:00.000Z'),
    ];
  }));

  await insert('job_hiring_managers', ['id', 'job_id', 'name', 'title', 'email', 'is_lead', 'sort_order'],
    jobs.flatMap((j) => {
      const hms = arr<any>(j.hiringManagers).length ? arr<any>(j.hiringManagers)
        : (j.hiringManager ? [{ name: j.hiringManager, lead: true }] : []);
      /* Exactly one lead: the flagged one, else the first. */
      const leadIdx = Math.max(0, hms.findIndex((h) => h.lead));
      return hms.map((h, i) => [`jhm_${j.id}_${i}`, j.id, h.name, h.title ?? null, h.email ?? null,
        i === leadIdx, i]);
    }));

  const spineIdx = new Map(SPINE.map((s, i) => [s.key, i]));
  await insert('job_stages', ['id', 'job_id', 'stage_key', 'name', 'sla', 'ordinal'],
    jobs.flatMap((j) => arr<any>(j.stages).map((s) =>
      [`jst_${j.id}_${s.key}`, j.id, s.key, s.name, Math.min(60, Math.max(1, int(s.sla, 5))),
        spineIdx.get(s.key) ?? 99])));

  await insert('job_skills', ['id', 'job_id', 'skill', 'level', 'must', 'sort_order'],
    jobs.flatMap((j) => {
      const bar = arr<any>(j.skillBar).length ? arr<any>(j.skillBar)
        : arr<string>(j.skills).map((skill, i) => ({ skill, level: i < 2 ? 4 : 3, must: i < 3 }));
      const seen = new Set<string>();
      return bar.filter((b) => {
        const k = String(b.skill).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).map((b, i) => [`jsk_${j.id}_${i}`, j.id, b.skill,
        Math.min(5, Math.max(1, int(b.level, 3))), !!b.must, i]);
    }));

  await insert('job_channels', ['id', 'job_id', 'channel', 'state'],
    jobs.flatMap((j) => Object.entries(j.channels ?? {}).map(([ch, st], i) =>
      [`jch_${j.id}_${i}`, j.id, ch, st === 'live' ? 'live' : st === 'expired' ? 'expired' : 'not_posted'])));

  await insert('job_questions', ['id', 'job_id', 'bank_id', 'text', 'type', 'options', 'required', 'knockout', 'ordinal'],
    jobs.flatMap((j) => arr<any>(j.applicationQuestions).map((q, i) =>
      [`jq_${j.id}_${i}`, j.id, d.questionBank?.some((b: any) => b.id === q.id) ? q.id : null,
        q.text, q.type, q.options ?? null, !!q.required, q.knockout ?? null, int(q.order, i + 1)])));
}

async function seedCandidates(d: Proto) {
  const cands = arr<any>(d.candidates);

  await insert('candidates', [
    'id', 'name', 'gender', 'email', 'phone', 'location_city', 'nationality', 'family', 'headline',
    'current_title', 'current_company', 'sector', 'sector_source', 'years_experience', 'notice_days',
    'expected_salary', 'current_salary', 'current_salary_source', 'current_salary_at',
    'linkedin', 'portfolio', 'hue', 'photo', 'photo_at', 'consent_until',
    'claim_by', 'claim_by_name', 'claim_at', 'claim_days', 'claim_note', 'hashtags', 'created_at',
  ], cands.map((c) => {
    const cl = c.claim ?? null;
    const ss = c.sectorSource === 'ai' ? 'ai' : c.sectorSource === 'recruiter' ? 'recruiter' : 'cv';
    const cs = c.currentSalarySource === 'ai' ? 'ai' : c.currentSalarySource === 'recruiter' ? 'recruiter' : null;
    return [
      c.id, c.name, c.gender ?? null, c.email ?? null, c.phone ?? null, c.locationCity ?? null,
      c.nationality ?? null, c.family ?? null, c.headline ?? null, c.currentTitle ?? null,
      c.currentCompany ?? null, c.sector ?? null, c.sector ? ss : null,
      num(c.yearsExperience), num(c.noticeDays), num(c.expectedSalary), num(c.currentSalary),
      cs, iso(c.currentSalaryAt), c.linkedin ?? null, c.portfolio ?? null, int(c.hue, 1),
      c.photo ?? null, c.photoAt ? iso(c.photoAt) : null, day(c.consentUntil),
      cl?.by ?? null, cl?.byName ?? null, iso(cl?.at), num(cl?.days), cl?.note ?? null,
      arr<string>(c.hashtags), iso(c.createdAt),
    ];
  }), 250);

  await insert('candidate_skills', ['id', 'candidate_id', 'skill', 'level', 'years', 'source', 'sort_order'],
    cands.flatMap((c) => {
      const seen = new Set<string>();
      return arr<string>(c.skills).filter((s) => {
        const k = s.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).map((skill, i) => [`csk_${c.id}_${i}`, c.id, skill,
        (c.skillLevels ?? {})[skill] != null ? String((c.skillLevels ?? {})[skill]) : null,
        num((c.skillYears ?? {})[skill]), 'cv', i]);
    }), 500);

  await insert('candidate_resumes', [
    'id', 'candidate_id', 'file_name', 'size_kb', 'pages', 'parsed', 'confidence', 'has_text_layer',
    'summary', 'sections', 'experience', 'education', 'languages', 'certs', 'field_sources',
    'photo_found', 'photo_meta', 'parser_version', 'parsed_by', 'is_current', 'uploaded_at',
  ], cands.filter((c) => c.resume).map((c) => {
    const r = c.resume;
    return [
      `res_${c.id}`, c.id, r.file ?? null, num(r.sizeKb), num(r.pages), !!r.parsed,
      r.confidence == null ? null : String(r.confidence), true, r.summary ?? null,
      JSON.stringify(uniq(['profile', 'experience', 'skills', 'education', 'languages'])),
      JSON.stringify(arr(r.experience)), JSON.stringify(arr(r.education)),
      JSON.stringify(arr(r.languages)), arr<string>(r.certs), JSON.stringify({}),
      !!(r.photo && r.photo.found), r.photo ? JSON.stringify(r.photo) : null,
      'seed-1', 'local', true, iso(r.uploadedAt),
    ];
  }), 250);

  await insert('talent_pools', ['id', 'name', 'filter', 'owner_id', 'sort_order', 'created_at'],
    arr<any>(d.talentPools).map((p, i) => [p.id, p.name, JSON.stringify(p.filter ?? {}), p.ownerId ?? null, i, iso(p.createdAt)]));
  await insert('talent_pool_members', ['id', 'pool_id', 'candidate_id', 'added_at'],
    arr<any>(d.talentPools).flatMap((p) => arr<string>(p.memberIds).map((cid, i) =>
      [`tpm_${p.id}_${i}`, p.id, cid, iso(p.createdAt)])), 500);
}

async function seedApplications(d: Proto) {
  const apps = arr<any>(d.applications);
  const year = new Date(nowIso(d)).getUTCFullYear();
  const jobQ = new Map<string, any[]>();
  for (const j of arr<any>(d.jobs)) jobQ.set(j.id, arr<any>(j.applicationQuestions));

  /* One live application per person per requisition: the database enforces it,
     so a dataset that breaks it would fail the insert. Older records are kept
     but the duplicate is closed as withdrawn rather than dropped. */
  const liveSeen = new Set<string>();
  const rows: unknown[][] = [];
  const history: unknown[][] = [];
  const answers: unknown[][] = [];

  /* The generator occasionally stamped a close before the last stage hop — the
     prototype hid it by skipping negative dwell times. An application cannot be
     closed before it reached the stage it was closed from, so the close is
     moved to that moment rather than imported as an impossibility. */
  let clamped = 0;

  apps.forEach((a, i) => {
    const key = `${a.jobId}|${a.candidateId}`;
    const live = ['active', 'on_hold'].includes(a.status);
    const h = arr<any>(a.history);
    const lastHop = h.length ? iso(h[h.length - 1].at) : iso(a.appliedAt);
    let status = a.status;
    let closedAt = iso(a.closedAt);
    if (live) {
      if (liveSeen.has(key)) { status = 'withdrawn'; closedAt = closedAt ?? iso(a.stageEnteredAt); }
      else liveSeen.add(key);
    }
    if (closedAt && lastHop && closedAt < lastHop) { closedAt = lastHop; clamped++; }
    rows.push([
      a.id, `APP-${year}-${String(i + 1).padStart(6, '0')}`, a.jobId, a.candidateId,
      a.recruiterId ?? null, a.sourcerId ?? null, a.stage, status, a.source,
      a.referrer ?? null, iso(a.appliedAt), iso(a.stageEnteredAt),
      a.rating == null ? null : String(a.rating), a.disqualifyReason ?? null, closedAt,
      day(a.startDate), arr<string>(a.hashtags), iso(a.appliedAt),
    ]);

    h.forEach((hop, k) => {
      history.push([
        `ash_${a.id}_${k}`, a.id, k === 0 ? null : h[k - 1].stage, hop.stage,
        null, k === h.length - 1 ? status : 'active', iso(hop.at),
        a.recruiterId ?? null, null, 'seed', hop.note ?? null, null,
        JSON.stringify({}), `seed:${a.id}:${k}`, k + 1,
      ]);
    });
    /* A closed application records the close as its own entry, so the timeline
       reads the way the product's activity feed always did. */
    if (closedAt && !['hired'].includes(status)) {
      history.push([
        `ash_${a.id}_close`, a.id, a.stage, a.stage, 'active', status, closedAt,
        a.recruiterId ?? null, null, 'seed', a.disqualifyReason ?? null, null,
        JSON.stringify({ close: true }), `seed:${a.id}:close`, h.length + 1,
      ]);
    }

    const qs = jobQ.get(a.jobId) ?? [];
    arr<any>(a.answers).forEach((ans, k) => {
      const q = qs.find((x) => x.id === ans.questionId);
      const miss = !!(q && q.knockout && String(ans.answer).trim() &&
        String(ans.answer).trim().toLowerCase() !== String(q.knockout).toLowerCase());
      answers.push([`ans_${a.id}_${k}`, a.id, ans.questionId ?? null,
        q?.text ?? ans.questionId ?? '—', ans.answer ?? null, miss, iso(a.appliedAt)]);
    });
  });

  if (clamped) log(`${clamped} application(s) had a close stamped before their last stage hop — moved to it`);

  await insert('applications', [
    'id', 'reference', 'job_id', 'candidate_id', 'recruiter_id', 'sourcer_id', 'stage', 'status',
    'source', 'referrer', 'applied_at', 'stage_entered_at', 'rating', 'disqualify_reason',
    'closed_at', 'start_date', 'hashtags', 'created_at',
  ], rows, 250);

  await insert('application_stage_history', [
    'id', 'application_id', 'from_stage', 'to_stage', 'from_status', 'to_status', 'at',
    'actor_id', 'actor_name', 'source', 'reason', 'note', 'metadata', 'idempotency_key', 'seq',
  ], history, 400);

  await insert('application_answers',
    ['id', 'application_id', 'question_id', 'question_text', 'answer', 'knockout_miss', 'answered_at'],
    answers, 500);

  await insert('cross_links', ['id', 'candidate_id', 'application_a', 'application_b', 'matched_on', 'detected_at'],
    arr<any>(d.crossLinks).map((l, i) => [`xl_${i}`, l.candidateId, l.a, l.b, arr<string>(l.matchedOn), iso(l.detectedAt)]));
}

async function seedFeedback(d: Proto) {
  const evals = arr<any>(d.evaluations);
  await insert('evaluations', [
    'id', 'application_id', 'job_id', 'candidate_id', 'stage', 'evaluator_id', 'evaluator_name',
    'overall', 'verdict', 'comment', 'submitted', 'at', 'created_at',
  ], evals.map((e) => [e.id, e.appId, e.jobId, e.candidateId, e.stage, e.evaluatorId ?? null,
    e.evaluatorName, e.overall == null ? null : String(e.overall), e.verdict ?? null,
    e.comment ?? null, !!e.submitted, iso(e.at), iso(e.at) ?? nowIso(d)]), 300);

  await insert('evaluation_criteria', ['id', 'evaluation_id', 'name', 'score', 'weight', 'sort_order'],
    evals.flatMap((e) => arr<any>(e.criteria).map((c, i) =>
      [`ec_${e.id}_${i}`, e.id, c.name, num(c.score), String(c.weight ?? 1), i])), 500);

  await insert('reviews', ['id', 'application_id', 'candidate_id', 'job_id', 'rating', 'text',
    'by_id', 'by_name', 'by_email', 'stage', 'at'],
    arr<any>(d.reviews).map((r) => [r.id, r.appId, r.candidateId, r.jobId, r.rating, r.text ?? null,
      r.byId ?? null, r.by, r.byEmail ?? null, r.stage ?? null, iso(r.at)]), 300);

  await insert('comments', ['id', 'application_id', 'candidate_id', 'job_id', 'author_id',
    'author_name', 'body', 'pinned', 'at'],
    arr<any>(d.comments).map((c) => [c.id, c.appId ?? null, c.candidateId, c.jobId ?? null,
      c.authorId ?? null, c.authorName, c.body, !!c.pinned, iso(c.at)]), 300);
}

async function seedInterviews(d: Proto) {
  const ivs = arr<any>(d.interviews);
  await insert('interviews', [
    'id', 'application_id', 'job_id', 'candidate_id', 'stage', 'title', 'at', 'duration_min',
    'mode', 'interviewer', 'organiser_id', 'status', 'recorded', 'recording_ref', 'minutes',
    'analysis', 'reviewer_score', 'reviewer_ratings', 'reviewer_strengths', 'reviewer_improve',
    'reviewer_model', 'reviewed_at', 'flags', 'created_at',
  ], ivs.map((i) => {
    const rv = i.review ?? null;
    const iv = rv?.interviewer ?? null;
    return [
      i.id, i.appId, i.jobId, i.candidateId, i.stage, i.title, iso(i.at),
      Math.min(480, Math.max(5, int(i.durationMin, 45))), i.mode,
      i.interviewer ?? null, i.organiserId ?? null, i.status,
      !!rv?.recorded, rv?.recordingId ?? null, num(rv?.minutes),
      rv?.analysed ? JSON.stringify(rv.analysed) : null,
      num(iv?.score), iv?.ratings ? JSON.stringify(iv.ratings) : null,
      arr<string>(iv?.strengths), arr<string>(iv?.improve), iv?.model ?? null,
      iso(rv?.analysed?.at), arr<string>(rv?.flags), iso(i.at),
    ];
  }), 300);

  await insert('interview_panel', ['id', 'interview_id', 'name', 'email', 'is_hiring_manager', 'sort_order'],
    ivs.flatMap((i) => {
      const seen = new Set<string>();
      return arr<string>(i.panel).filter((n) => {
        const k = n.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).map((name, k) => [`ivp_${i.id}_${k}`, i.id, name, null, name === i.interviewer, k]);
    }), 500);

  await insert('assessments', ['id', 'application_id', 'candidate_id', 'job_id', 'kind', 'provider',
    'status', 'invited_at', 'completed_at', 'score', 'traits', 'verdict', 'summary', 'report_ref'],
    arr<any>(d.assessments).map((a) => [a.id, a.appId, a.candidateId, a.jobId, a.kind ?? 'behavioural',
      a.provider, a.status, iso(a.invitedAt), iso(a.completedAt), num(a.score),
      JSON.stringify(arr(a.traits)), a.verdict ?? null, a.summary ?? null, a.reportId ?? null]));
}

async function seedScreenings(d: Proto) {
  const scr = arr<any>(d.screenings);
  await insert('screenings', [
    'id', 'application_id', 'candidate_id', 'job_id', 'channel', 'status', 'invited_at',
    'started_at', 'completed_at', 'total', 'max', 'score', 'verdict', 'summary',
    'captured_current_salary', 'captured_expected_salary', 'captured_notice_days',
    'captured_source', 'captured_by', 'captured_at', 'captured_quote',
    'call_direction', 'call_phone', 'call_language', 'call_voice', 'call_attempts', 'call_consent',
    'call_scheduled_for', 'call_started_at', 'call_ended_at', 'call_duration_sec', 'call_outcome',
    'call_provider_ref', 'call_transcript_confidence', 'call_clarity', 'call_fluency', 'call_engagement',
    'analysis', 'interviewer_review', 'created_at',
  ], scr.map((s) => {
    const k = s.call ?? null;
    const cap = s.captured ?? null;
    const com = k?.communication ?? null;
    /* Scores stored on the record already read 1–100; recompute where the
       generator left it off so nothing is null that should not be. */
    const score = s.score != null ? int(s.score)
      : (s.max ? Math.max(1, Math.min(100, Math.round((s.total / s.max) * 100))) : null);
    return [
      s.id, s.appId, s.candidateId, s.jobId, s.channel, s.status, iso(s.invitedAt),
      iso(s.startedAt), iso(s.completedAt), num(s.total), num(s.max), score,
      s.verdict ?? null, s.summary ?? null,
      num(cap?.currentSalary), num(cap?.expectedSalary), num(cap?.noticeDays),
      cap?.source ?? null, cap?.by ?? null, iso(cap?.at), cap?.quote ?? null,
      k?.direction ?? null, k?.phone ?? null, k?.language ?? null, k?.voice ?? null,
      int(k?.attempts), k?.consent ?? null, iso(k?.scheduledFor), iso(k?.startedAt), iso(k?.endedAt),
      num(k?.durationSec), k?.outcome ?? null, k?.recordingId ?? null,
      k?.transcriptConfidence == null ? null : String(k.transcriptConfidence),
      num(com?.clarity), num(com?.fluency), num(com?.engagement),
      k?.analysis ? JSON.stringify(k.analysis) : null,
      k?.interviewer ? JSON.stringify(k.interviewer) : null,
      iso(s.invitedAt),
    ];
  }));

  await insert('screening_turns', ['id', 'screening_id', 'who', 'text', 'at', 'seq'],
    scr.flatMap((s) => arr<any>(s.turns).map((t, i) =>
      [`stn_${s.id}_${i}`, s.id, t.who, t.text, iso(t.at), i])), 500);

  await insert('screening_scores', ['id', 'screening_id', 'key', 'question', 'answer', 'score', 'max', 'sort_order'],
    scr.flatMap((s) => arr<any>(s.scores).map((x, i) =>
      [`ssc_${s.id}_${x.key}`, s.id, x.key, x.question, x.answer ?? null, int(x.score), int(x.max, 2), i])), 500);
}

async function seedPitches(d: Proto) {
  await insert('pitch_projects', ['id', 'name', 'who', 'client', 'brief', 'task', 'duration_min',
    'prep_hours', 'criteria', 'active', 'uses', 'created_at', 'updated_at', 'updated_by',
    'sort_order'],
    arr<any>(d.pitchProjects).map((p, i) => [p.id, p.name, p.who ?? null, p.client ?? null, p.brief,
      p.task, int(p.durationMin, 20), int(p.prepHours, 24), JSON.stringify(arr(p.criteria)),
      p.active !== false, int(p.uses), iso(p.createdAt), iso(p.updatedAt), p.updatedBy ?? null, i]));

  const cfg = arr<any>(d.pitchConfig)[0];
  if (cfg) {
    await insert('pitch_config', ['id', 'lead_hours', 'channels', 'gate_final', 'wa_template',
      'email_subject', 'email_body', 'updated_at'],
      [['pitch_cfg', int(cfg.leadHours, 24), arr<string>(cfg.channels), cfg.gateFinal !== false,
        cfg.waTemplate, cfg.emailSubject, cfg.emailBody, iso(cfg.updatedAt)]]);
  }

  const pits = arr<any>(d.pitches);
  /* One pitch per application; the dataset already respects that, and the
     unique index would say so if it stopped being true. */
  const seen = new Set<string>();
  const kept = pits.filter((p) => (seen.has(p.appId) ? false : (seen.add(p.appId), true)));

  await insert('pitches', ['id', 'application_id', 'candidate_id', 'job_id', 'project_id', 'status',
    'sent_at', 'sent_whatsapp', 'sent_email', 'channels', 'due_at', 'started_at', 'completed_at',
    'duration_min', 'total', 'max', 'score', 'verdict', 'summary', 'strengths', 'gaps', 'model',
    'recording_ref', 'created_at'],
    kept.map((p) => {
      const score = p.score != null ? int(p.score)
        : (p.max ? Math.max(1, Math.min(100, Math.round((p.total / p.max) * 100))) : null);
      return [p.id, p.appId, p.candidateId, p.jobId, p.projectId ?? null, p.status,
        iso(p.sentAt), p.sentTo?.whatsapp ?? null, p.sentTo?.email ?? null, arr<string>(p.channels),
        iso(p.dueAt), iso(p.startedAt), iso(p.completedAt), num(p.durationMin), num(p.total),
        num(p.max), score, p.verdict ?? null, p.summary ?? null, arr<string>(p.strengths),
        arr<string>(p.gaps), p.model ?? null, p.recordingId ?? null, iso(p.sentAt ?? p.dueAt)];
    }));

  await insert('pitch_turns', ['id', 'pitch_id', 'who', 'text', 'at', 'seq'],
    kept.flatMap((p) => arr<any>(p.turns).map((t, i) => [`ptn_${p.id}_${i}`, p.id, t.who, t.text, iso(t.at), i])), 500);

  await insert('pitch_scores', ['id', 'pitch_id', 'key', 'name', 'score', 'max', 'sort_order'],
    kept.flatMap((p) => arr<any>(p.scores).map((x, i) =>
      [`psc_${p.id}_${x.key}`, p.id, x.key, x.name, int(x.score), int(x.max, 5), i])), 500);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Approvals and offers
// ─────────────────────────────────────────────────────────────────────────────
async function seedApprovalFlows(d: Proto) {
  const flows = arr<any>(d.approvalFlows);
  await insert('approval_flows', ['id', 'subject', 'name', 'publish_on_approve', 'publish_channels',
    'require_verification', 'is_active', 'updated_by', 'updated_at', 'sort_order'],
    flows.map((f, i) => [f.id, f.kind, f.name, f.publishOnApprove !== false,
      arr<string>(f.channels), !!f.requireVerification, true, f.updatedBy ?? null,
      iso(f.updatedAt), i]));

  await insert('approval_flow_steps', ['id', 'flow_id', 'label', 'approver_type', 'approver_role',
    'approver_staff_id', 'approver_name', 'approver_title', 'cond_field', 'cond_op', 'cond_value',
    'auto', 'ordinal'],
    flows.flatMap((f) => arr<any>(f.steps).map((s, i) => {
      const a = s.approver ?? {};
      return [s.id ?? `${f.id}_s${i}`, f.id, s.label, a.type, a.role ?? null, a.staffId ?? null,
        a.name ?? null, a.title ?? null, s.when?.field ?? null, s.when?.op ?? null,
        num(s.when?.value), !!s.auto, i];
    })));
}

/* A requisition's chain and an offer's chain become approval instances, so the
   one engine answers "what is waiting on whom" for both. */
async function seedApprovals(d: Proto) {
  const approvals: unknown[][] = [];
  const steps: unknown[][] = [];
  /* Resolve the flow by what it is for, not by a guessed id. */
  const flowFor = (kind: string) =>
    arr<any>(d.approvalFlows).find((f) => f.kind === kind)?.id ?? null;
  const reqFlow = flowFor('requisition');
  const offFlow = flowFor('offer');
  /* Only the types the enum knows; anything else is a named approver. */
  const APPROVER = new Set(['role', 'hiring_manager', 'dept_head', 'staff', 'named']);
  const type = (t: unknown) => (APPROVER.has(String(t)) ? String(t) : 'named');
  const stepState = (s: unknown) =>
    (['pending', 'approved', 'rejected', 'skipped'].includes(String(s)) ? String(s) : 'pending');

  for (const j of arr<any>(d.jobs)) {
    const ap = j.approval;
    if (!ap || (ap.state === 'draft' && !arr(ap.steps).length)) continue;
    const apId = `apv_job_${j.id}`;
    approvals.push([apId, 'requisition', j.id, reqFlow, JSON.stringify({ from: 'seed', steps: arr(ap.steps) }),
      ap.state === 'approved' ? 'approved' : ap.state === 'rejected' ? 'rejected'
        : ap.state === 'pending' ? 'pending' : 'draft',
      ap.requestedBy ?? null, null, iso(ap.requestedAt) ?? iso(j.openedOn + 'T06:00:00.000Z'),
      ap.decidedBy ?? null, null, iso(ap.decidedAt), ap.note ?? null, 1, null]);
    arr<any>(ap.steps).forEach((s, i) => {
      steps.push([`aps_job_${j.id}_${i}`, apId, s.id ?? `st${i}`, s.label, type(s.type),
        s.role ?? null, s.staffId ?? null, s.who ?? null, s.title ?? null, s.when ?? null,
        !!s.auto, stepState(s.state), s.by ?? null, null, null, iso(s.at), null, i]);
    });
  }

  for (const o of arr<any>(d.offers)) {
    const aps = arr<any>(o.approvals);
    if (!aps.length) continue;
    const apId = `apv_off_${o.id}`;
    const open = aps.some((a) => a.state === 'pending');
    approvals.push([apId, 'offer', o.id, offFlow, JSON.stringify({ from: 'seed', steps: aps }),
      o.state === 'draft' ? 'draft' : open ? 'pending' : 'approved',
      null, null, iso(o.createdAt), null, null, open ? null : iso(o.createdAt), null, 1, null]);
    aps.forEach((a, i) => {
      steps.push([`aps_off_${o.id}_${i}`, apId, `st${i}`, a.role, a.roleKey ? 'role' : 'named',
        a.roleKey ?? null, a.staffId ?? null, a.who ?? null, a.title ?? null, a.when ?? null,
        !!a.auto, stepState(a.state), a.by ?? null, null, null, iso(a.at), null, i]);
    });
  }

  await insert('approvals', ['id', 'subject', 'subject_id', 'flow_id', 'flow_snapshot', 'state',
    'requested_by', 'requested_by_name', 'requested_at', 'decided_by', 'decided_by_name',
    'decided_at', 'note', 'attempt', 'superseded_by_id'], approvals, 200);
  await insert('approval_steps', ['id', 'approval_id', 'step_key', 'label', 'approver_type',
    'approver_role', 'approver_staff_id', 'approver_name', 'approver_title', 'condition_text',
    'auto', 'state', 'decided_by', 'decided_by_name', 'on_behalf_of', 'decided_at', 'note', 'ordinal'],
    steps, 300);
}

async function seedOffers(d: Proto) {
  const offers = arr<any>(d.offers);
  const year = new Date(nowIso(d)).getUTCFullYear();

  await insert('offer_templates', ['id', 'name', 'family', 'is_default', 'file_name', 'file_type',
    'size_kb', 'lang', 'version', 'body', 'detected_fields', 'note', 'uploaded_by', 'uploaded_at',
    'sort_order'],
    arr<any>(d.offerTemplates).map((t, i) => [t.id, t.name, t.family ?? null, !!t.isDefault,
      t.fileName ?? null, t.fileType ?? null, num(t.sizeKb), t.lang ?? 'en', int(t.version, 1),
      t.body, arr<string>(t.fields), t.note ?? null, t.uploadedBy ?? null, iso(t.uploadedAt), i]));

  await insert('offers', [
    'id', 'reference', 'application_id', 'job_id', 'candidate_id', 'version', 'supersedes_id',
    'base_monthly', 'housing', 'transport', 'annual_bonus_pct', 'currency', 'start_date', 'state',
    'template_id', 'template_name', 'letter_override', 'field_overrides',
    'verified_by', 'verified_at', 'verified_note', 'sent_at', 'signed_at',
    'esign_provider', 'esign_envelope_id',
    'response_state', 'response_at', 'response_by', 'response_reason', 'response_note', 'response_source',
    'created_at',
  ], offers.map((o, i) => {
    const r = o.response ?? null;
    return [
      o.id, `OFF-${year}-${String(i + 1).padStart(4, '0')}`, o.appId, o.jobId, o.candidateId,
      int(o.version, 1), o.supersedesId ?? null,
      int(o.baseMonthly), int(o.housing), int(o.transport), int(o.annualBonusPct),
      o.currency ?? 'SAR', day(o.startDate), o.state,
      o.templateId ?? null, o.template ?? null, o.letterOverride ?? null,
      JSON.stringify(o.fieldOverrides ?? {}),
      o.verified?.by ?? null, iso(o.verified?.at), o.verified?.note ?? null,
      iso(o.sentAt), iso(o.signedAt),
      o.esign?.provider ?? null, o.esign?.envelope ?? null,
      r?.state ?? null, iso(r?.at), r?.by ?? null, r?.reason ?? null, r?.note ?? null, r?.source ?? null,
      iso(o.createdAt),
    ];
  }), 200);

  await insert('offer_letter_edits', ['id', 'offer_id', 'field', 'from_value', 'to_value', 'by_id', 'by_name', 'at'],
    offers.flatMap((o) => arr<any>(o.letterEdits).map((e, i) =>
      [`ole_${o.id}_${i}`, o.id, e.field, String(e.from ?? ''), String(e.to ?? ''), e.by ?? null, null, iso(e.at)])), 300);

  await insert('offer_documents', ['id', 'offer_id', 'key', 'label', 'status', 'uploaded_at', 'sort_order'],
    offers.flatMap((o) => arr<any>(o.documents).map((doc, i) =>
      [`ofd_${o.id}_${doc.key}`, o.id, doc.key, doc.label, doc.status, iso(doc.uploadedAt), i])), 400);

  await insert('offer_signatures', ['id', 'offer_id', 'name', 'role', 'state', 'sort_order'],
    offers.flatMap((o) => arr<any>(o.esign?.signers).map((s, i) =>
      [`ofs_${o.id}_${i}`, o.id, s.name, s.role ?? 'Candidate', s.state ?? 'not_sent', i])), 400);

  await insert('offer_messages', ['id', 'offer_id', 'application_id', 'candidate_id', 'from_party',
    'author_id', 'author_name', 'body', 'read_at', 'at'],
    arr<any>(d.offerMessages).map((m) => [m.id, m.offerId, m.appId, m.candidateId, m.from,
      m.authorId ?? null, m.authorName, m.body, m.read ? iso(m.at) : null, iso(m.at)]), 300);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Platform: messages, tasks, notifications, automations, audit
// ─────────────────────────────────────────────────────────────────────────────
async function seedPlatform(d: Proto) {
  /* Outreach becomes messages: the same rows, with the delivery state a provider
     would have reported. Nothing is marked delivered that the dataset did not
     already say was delivered. */
  const STATUS: Record<string, string> = {
    sent: 'sent', delivered: 'delivered', opened: 'opened', read: 'read',
    received: 'delivered', failed: 'failed', bounced: 'bounced',
  };
  await insert('messages', ['id', 'application_id', 'candidate_id', 'job_id', 'channel', 'direction',
    'internal', 'to_address', 'to_name', 'cc_addresses', 'subject', 'body', 'provider', 'status',
    'author_id', 'sent_at', 'delivered_at', 'opened_at', 'at', 'queued_at'],
    arr<any>(d.outreach).map((o) => {
      const st = STATUS[o.status] ?? 'sent';
      return [o.id, o.appId ?? null, o.candidateId ?? null, o.jobId ?? null,
        o.channel === 'Email' ? 'Email' : o.channel === 'WhatsApp' ? 'WhatsApp'
          : o.channel === 'SMS' ? 'SMS' : o.channel === 'LinkedIn' ? 'LinkedIn' : 'Internal',
        o.direction === 'in' ? 'in' : 'out', !!o.internal,
        o.to ?? null, o.toName ?? null, arr<string>(o.cc), o.subject ?? null, o.body,
        'seed', st, o.authorId === 'bot' ? null : o.authorId ?? null,
        iso(o.at), ['delivered', 'opened', 'read'].includes(st) ? iso(o.at) : null,
        ['opened', 'read'].includes(st) ? iso(o.at) : null, iso(o.at), iso(o.at)];
    }), 300);

  await insert('tasks', ['id', 'kind', 'title', 'application_id', 'job_id', 'candidate_id',
    'assignee_id', 'due_on', 'priority', 'done', 'created_at'],
    arr<any>(d.tasks).map((t) => [t.id, t.kind, t.title, t.appId ?? null, t.jobId ?? null,
      t.candidateId ?? null, t.assigneeId ?? null, t.dueOn ? iso(t.dueOn + 'T09:00:00.000Z') : null,
      t.priority ?? 'normal', !!t.done, iso(t.createdAt)]));

  await insert('notifications', ['id', 'kind', 'text', 'recipient_staff_id', 'application_id',
    'job_id', 'candidate_id', 'employee_id', 'read_at', 'at'],
    arr<any>(d.notifications).map((n) => [n.id, n.kind, n.text, n.staffId ?? null, n.appId ?? null,
      n.jobId ?? null, n.candidateId ?? null, n.empId ?? null, n.read ? iso(n.at) : null, iso(n.at)]));

  /* The prototype's automations were toggles with a name. Here they become real
     rules, with the trigger they always described and the actions they implied.
     They arrive disabled unless the prototype had them on. */
  type Rule = { trigger: string; conditions?: Array<Record<string, unknown>>; actions: Array<Record<string, unknown>> };
  const RULES: Record<string, Rule> = {
    'job.opened': {
      trigger: 'requisition.approved',
      actions: [{ type: 'publish_job', channels: ['LinkedIn', 'Bayut Careers'] }],
    },
    'application.created': {
      trigger: 'application.created',
      actions: [{ type: 'send_message', channel: 'Email', template: 'application_received' }],
    },
    'application.rejected': {
      trigger: 'application.rejected',
      actions: [{ type: 'send_message', channel: 'Email', template: 'regret', delayHours: 24 }],
    },
    'stage.entered:assessment': {
      trigger: 'application.stage_changed',
      conditions: [{ field: 'toStage', op: 'eq', value: 'assessment' }],
      actions: [{ type: 'send_message', channel: 'Email', template: 'assessment_link' },
        { type: 'create_task', kind: 'assessment', assignee: 'recruiter', dueInDays: 5 }],
    },
    'stage.sla_breached': {
      trigger: 'sla.breached',
      actions: [{ type: 'notify', to: 'recruiter' }, { type: 'create_task', kind: 'sla', dueInDays: 1 }],
    },
    'evaluation.overdue': {
      trigger: 'scorecard.overdue',
      actions: [{ type: 'notify', to: 'interviewer' },
        { type: 'create_task', kind: 'chase_feedback', assignee: 'recruiter', dueInDays: 1 }],
    },
    'offer.drafted': {
      trigger: 'offer.drafted',
      actions: [{ type: 'create_task', kind: 'verify_offer', assignee: 'onboarding', dueInDays: 2 },
        { type: 'notify', to: 'onboarding' }],
    },
    'offer.signed': {
      trigger: 'offer.signed',
      actions: [{ type: 'issue_employee_id' },
        { type: 'send_message', channel: 'Email', template: 'onboarding_form' },
        { type: 'create_task', kind: 'joining', assignee: 'recruiter', dueInDays: 2, priority: 'high' }],
    },
    /* The two scheduled ones are not events but sweeps; the worker raises the
       event on the cron, and the rule is what decides what to do about it. */
    'schedule.daily_02': {
      trigger: 'schedule.daily',
      actions: [{ type: 'sweep', what: 'sla' }, { type: 'sweep', what: 'probation_due' },
        { type: 'sweep', what: 'scorecards_overdue' }],
    },
    'schedule.weekly_sun_08': {
      trigger: 'schedule.weekly',
      actions: [{ type: 'digest', to: 'recruiters' }],
    },
  };
  await insert('automation_rules', ['id', 'name', 'description', 'trigger', 'conditions', 'actions',
    'enabled', 'is_system', 'last_run_at', 'runs_30d', 'sort_order'],
    arr<any>(d.automations).map((a, i) => {
      const mapped = RULES[a.trigger];
      if (!mapped) throw new Error(`automation "${a.trigger}" has no production rule — add it to RULES`);
      return [a.id, a.name, a.action ?? null, mapped.trigger, JSON.stringify(mapped.conditions ?? []),
        JSON.stringify(mapped.actions), !!a.enabled, true, iso(a.lastRun), int(a.runs30d), i];
    }));

  await insert('audit_events', ['id', 'at', 'actor_id', 'actor_name', 'action', 'summary',
    'entity_type', 'entity_id', 'entity_label', 'source', 'ip'],
    arr<any>(d.auditLog).map((a) => [a.id, iso(a.at), a.actorId ?? null, a.actorName, 'action',
      a.action, 'legacy', null, a.target ?? null, 'seed', a.ip ?? null]));
}

/* The seat a requisition asked for points back at it; the plan and the
   requisition list must agree about which requisition is on which seat. */
async function reconcile() {
  await client.query(`
    UPDATE positions p SET job_id = NULL
     WHERE p.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = p.job_id)`);
  await client.query(`
    UPDATE employees e SET position_code = NULL
     WHERE e.position_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.code = e.position_code)`);
  /* Reference counters continue where the seed left off, so the next record
     created in the app does not collide with a seeded one. */
  const year = new Date().getUTCFullYear();
  for (const [prefix, table, col] of [['REQ', 'jobs', 'reference'], ['APP', 'applications', 'reference'],
    ['OFF', 'offers', 'reference'], ['BYT', 'employees', 'employee_code']] as const) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT COALESCE(MAX(split_part(${col}, '-', 3)::int), 0) + 1 AS n
         FROM ${table} WHERE ${col} LIKE $1`, [`${prefix}-%`]);
    await client.query(
      `INSERT INTO reference_counters (prefix, year, next) VALUES ($1, $2, $3)
         ON CONFLICT (prefix, year) DO UPDATE SET next = GREATEST(reference_counters.next, EXCLUDED.next)`,
      [prefix, year, Number(rows[0]?.n ?? 1)]);
  }
}

/* The values that are cached on a record so a list can be drawn without
   recomputing them — the CV fit on every application. The seeded dataset has
   none, because the prototype computed them lazily in the browser. */
async function derive() {
  const { recomputeFit } = await import('../../lib/services/fit');
  const n = await recomputeFit({ all: true });
  log(`CV fit computed on ${n.toLocaleString('en-US')} applications`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  client = new pg.Client({ connectionString: url, application_name: 'bayut-ta-seed' });
  await client.connect();

  try {
    if (FORCE) {
      log('clearing business data');
      /* One TRUNCATE for the lot: CASCADE resolves the dependency order, and a
         single statement means the database is never half-empty. Disabling
         replication triggers would need superuser, which the application role
         deliberately does not have. */
      const present = (await client.query<{ t: string }>(
        `SELECT table_name AS t FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.t);
      const list = BUSINESS_TABLES.filter((t) => present.includes(t)).map((t) => `"${t}"`);
      if (list.length) await client.query(`TRUNCATE TABLE ${list.join(', ')} CASCADE`);
    }

    const existing = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM jobs');
    if (Number(existing.rows[0].n) > 0 && !FORCE) {
      log(`${existing.rows[0].n} requisitions are already here — pass --force to reseed`);
      return;
    }

    if (BLANK) {
      log('blank seed: the stage spine and the integration register only');
      await seedSpine(null);
      await seedIntegrations();
      return;
    }

    const d = protoData();
    setShift(computeShift(d));
    log(`reading the prototype dataset (${d.meta.dataset}, as of ${String(d.meta.asOf).slice(0, 10)})`);
    if (shift()) {
      log(`rebasing it ${shift()} day(s) forward, so its "today" is ${nowIso(d).slice(0, 10)} — every`);
      log('  interval is preserved; only "now" changes');
    } else {
      log('no rebase — the dataset keeps its own clock');
    }

    /* The triggers that keep the plan honest are exactly what a bulk import must
       not fight: the data is already consistent, and re-checking 469 employees
       one row at a time doubles the seed. They are re-enabled before the
       reconciliation pass, which is what proves the result is consistent. */
    await client.query('ALTER TABLE employees DISABLE TRIGGER employees_seat_capacity');
    await client.query('ALTER TABLE offers DISABLE TRIGGER offers_immutable_after_send');

    await seedSpine(d);
    await seedIntegrations();
    await seedOrg(d);
    await seedAccounts(d);
    await seedPlan(d);
    await seedPipelines(d);
    await seedJobs(d);
    await seedCandidates(d);
    await seedApplications(d);
    await seedFeedback(d);
    await seedInterviews(d);
    await seedScreenings(d);
    await seedPitches(d);
    await seedApprovalFlows(d);
    await seedApprovals(d);
    await seedOffers(d);
    await seedPlatform(d);

    await client.query('ALTER TABLE employees ENABLE TRIGGER employees_seat_capacity');
    await client.query('ALTER TABLE offers ENABLE TRIGGER offers_immutable_after_send');
    await reconcile();
    await derive();
  } finally {
    await client.end();
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  log('');
  for (const [t, n] of shown) log(`${String(n).padStart(6)}  ${t}`);
  log('');
  log(`${total.toLocaleString('en-US')} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\nseed failed:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
