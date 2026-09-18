import {
  pgTable, text, integer, boolean, timestamp, date, uniqueIndex, index,
  jsonb, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';
import {
  staffRole, staffStatus, accountRole, accountStatus, accountKind, scopeKind,
  positionPlanState, positionKind, employeeStatus, employeeSource, probationState,
  referenceStatus, documentStatus,
} from './enums';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const now = () => timestamp('', { withTimezone: true, mode: 'string' });

/* ─────────────────────────────────────────────────────────────────────────────
   Tenancy-lite: one organisation per deployment, but its settings are a row
   rather than a constant, because Settings → Branding edits them at runtime.
   ───────────────────────────────────────────────────────────────────────────*/
export const orgSettings = pgTable('org_settings', {
  id: text('id').primaryKey().default('org'),
  orgName: text('org_name').notNull(),
  legalName: text('legal_name').notNull(),
  currency: text('currency').notNull().default('SAR'),
  currencySymbol: text('currency_symbol').notNull().default('SAR'),
  country: text('country').notNull().default('Saudi Arabia'),
  timezone: text('timezone').notNull().default('Asia/Riyadh'),
  /* Friday and Saturday in KSA. Stored as ISO weekday numbers, 0 = Sunday. */
  weekendDays: integer('weekend_days').array().notNull().default(sql`ARRAY[5,6]`),
  workdayStartMin: integer('workday_start_min').notNull().default(540),   // 09:00
  workdayEndMin: integer('workday_end_min').notNull().default(1080),      // 18:00
  fiscalYearStart: text('fiscal_year_start').notNull().default('January'),
  locale: text('locale').notNull().default('en-SA'),
  secondLocale: text('second_locale').notNull().default('ar-SA'),
  dataRetentionMonths: integer('data_retention_months').notNull().default(24),
  brandPrimary: text('brand_primary').notNull().default('#0E9E62'),
  brandAccent: text('brand_accent').notNull().default('#C98A16'),
  brandNote: text('brand_note'),
  offerApprovalThreshold: integer('offer_approval_threshold').notNull().default(30000),
  leaderName: text('leader_name'),
  leaderTitle: text('leader_title'),
  signedBy: text('signed_by'),
  atsOwner: text('ats_owner'),
  hrisName: text('hris_name'),
  probationMonths: integer('probation_months').notNull().default(3),
  /* Anything the UI edits that has no column of its own yet. */
  extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/* Locations — the five offices. */
export const locations = pgTable('locations', {
  id: id(),
  city: text('city').notNull(),
  region: text('region').notNull(),
  office: text('office').notNull(),
  timezone: text('timezone').notNull().default('Asia/Riyadh'),
  isRemote: boolean('is_remote').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cityIdx: uniqueIndex('locations_city_office_uq').on(t.city, t.office),
}));

/* Functions group departments — nine of them on the company chart. */
export const functions = pgTable('functions', {
  id: id(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  head: text('head'),
  headTitle: text('head_title'),
  hue: integer('hue').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUq: uniqueIndex('functions_code_uq').on(t.code),
  nameUq: uniqueIndex('functions_name_uq').on(t.name),
}));

export const departments = pgTable('departments', {
  id: id(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  functionId: text('function_id').references(() => functions.id, { onDelete: 'set null' }),
  head: text('head'),
  headTitle: text('head_title'),
  /* The organisation's own sequence, which is what every list of departments
     is shown in and what any ranking falls back on when two of them tie. */
  sortOrder: integer('sort_order').notNull().default(1000),
  /* The establishment figure from the HR headcount report; null when unknown. */
  headcount: integer('headcount'),
  costCentre: text('cost_centre'),
  /* A removed department still resolves by name on the closed requisitions that
     mention it — so it is archived, never deleted. */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
}, (t) => ({
  codeUq: uniqueIndex('departments_code_uq').on(t.code),
  nameUq: uniqueIndex('departments_name_uq').on(t.name),
  fnIdx: index('departments_function_idx').on(t.functionId),
  orderIdx: index('departments_order_idx').on(t.sortOrder, t.name),
}));

/* ── The TA team ────────────────────────────────────────────────────────────*/
export const staff = pgTable('staff', {
  id: id(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  role: staffRole('role').notNull(),
  roleLabel: text('role_label').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  gender: text('gender'),
  locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
  deptIds: text('dept_ids').array().notNull().default(sql`'{}'::text[]`),
  monthlyTarget: integer('monthly_target').notNull().default(0),
  lifetimeHires: integer('lifetime_hires').notNull().default(0),
  joinedOn: date('joined_on'),
  hue: integer('hue').notNull().default(1),
  seniority: text('seniority'),
  placeholderName: boolean('placeholder_name').notNull().default(false),
  /* `photo` says where the picture comes from; photoFileId points at the real
     image when one has been uploaded. The drawn portrait is the fallback. */
  photo: text('photo'),
  photoFileId: text('photo_file_id'),
  portraitStyle: text('portrait_style'),
  status: staffStatus('status').notNull().default('active'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  handedOverTo: text('handed_over_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUq: uniqueIndex('staff_email_uq').on(sql`lower(${t.email})`),
  roleIdx: index('staff_role_idx').on(t.role),
}));

/* ── Accounts: who can sign in ──────────────────────────────────────────────
   The prototype checked a salted SHA-256 in the browser. Here the hash is
   scrypt, checked on the server, and the row carries the lockout counters and
   the access scope that every selector filters through. ──────────────────── */
export const accounts = pgTable('accounts', {
  id: id(),
  kind: accountKind('kind').notNull(),
  staffId: text('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title'),
  email: text('email').notNull(),
  role: accountRole('role').notNull(),
  status: accountStatus('status').notNull().default('invited'),
  /* scrypt: {N,r,p,salt,hash} as a single encoded string. Null until the first
     sign-in, which is what "invited" means. */
  passwordHash: text('password_hash'),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  /* SSO subject, when the account signs in through OIDC instead. */
  oidcSubject: text('oidc_subject'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginIp: text('last_login_ip'),
  /* Access by position. */
  scopeKind: scopeKind('scope_kind').notNull().default('own'),
  scopeJobIds: text('scope_job_ids').array().notNull().default(sql`'{}'::text[]`),
  scopeOwn: boolean('scope_own').notNull().default(true),
  source: text('source'),
  invitedBy: text('invited_by'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUq: uniqueIndex('accounts_email_uq').on(sql`lower(${t.email})`),
  oidcUq: uniqueIndex('accounts_oidc_uq').on(t.oidcSubject),
  staffIdx: index('accounts_staff_idx').on(t.staffId),
  roleIdx: index('accounts_role_idx').on(t.role, t.status),
}));

/* Server-side sessions. A token is a random id; the cookie carries a signed
   reference to it, so revoking is a delete rather than a hope. */
export const sessions = pgTable('sessions', {
  id: id(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  /* sha256 of the opaque token; the token itself never touches the database. */
  tokenHash: text('token_hash').notNull(),
  /* The demo user switcher: an Admin may act as a colleague. Recorded so the
     audit trail says who really did it. */
  actingStaffId: text('acting_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
}, (t) => ({
  tokenUq: uniqueIndex('sessions_token_uq').on(t.tokenHash),
  accountIdx: index('sessions_account_idx').on(t.accountId, t.expiresAt),
}));

/* Brute-force protection is per (email, ip) rather than per account, so an
   attacker cannot enumerate accounts by watching which ones lock. */
export const loginAttempts = pgTable('login_attempts', {
  id: id(),
  email: text('email').notNull(),
  ip: text('ip').notNull(),
  succeeded: boolean('succeeded').notNull(),
  reason: text('reason'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  lookupIdx: index('login_attempts_lookup_idx').on(sql`lower(${t.email})`, t.ip, t.at),
}));

/* ── The manpower plan ──────────────────────────────────────────────────────*/
export const positions = pgTable('positions', {
  id: id(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  deptId: text('dept_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  functionId: text('function_id').references(() => functions.id, { onDelete: 'set null' }),
  grade: text('grade'),
  reportsToId: text('reports_to_id'),
  reportsToFunctionId: text('reports_to_function_id').references(() => functions.id, { onDelete: 'set null' }),
  /* A seat only becomes approved headcount when the requisition that raised it
     clears its chain. Until then planState is 'pending' and approved is 0. */
  planState: positionPlanState('plan_state').notNull().default('approved'),
  approved: integer('approved').notNull().default(0),
  requested: integer('requested').notNull().default(0),
  /* The requisition currently on this seat, if any. */
  jobId: text('job_id'),
  locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
  kind: positionKind('kind').notNull().default('role'),
  /* Kept for imported rows whose holder is a name, not an employee record yet. */
  holderName: text('holder_name'),
  holderGender: text('holder_gender'),
  importedFrom: text('imported_from'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
}, (t) => ({
  codeUq: uniqueIndex('positions_code_uq').on(t.code),
  deptIdx: index('positions_dept_idx').on(t.deptId),
  reportsIdx: index('positions_reports_idx').on(t.reportsToId),
  jobIdx: index('positions_job_idx').on(t.jobId),
  planIdx: index('positions_plan_idx').on(t.planState),
}));

export const employees = pgTable('employees', {
  id: id(),
  employeeCode: text('employee_code').notNull(),     // BYT-YYYY-NNNN
  name: text('name').notNull(),
  gender: text('gender'),
  candidateId: text('candidate_id'),
  applicationId: text('application_id'),
  offerId: text('offer_id'),
  jobId: text('job_id'),
  positionCode: text('position_code'),
  deptId: text('dept_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
  startDate: date('start_date').notNull(),
  status: employeeStatus('status').notNull().default('onboarding'),
  source: employeeSource('source').notNull(),
  leftOn: date('left_on'),
  leftReason: text('left_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUq: uniqueIndex('employees_code_uq').on(t.employeeCode),
  /* One employee record per accepted application: the guard against a double
     hire when two people press Record acceptance at once. */
  appUq: uniqueIndex('employees_application_uq').on(t.applicationId),
  offerUq: uniqueIndex('employees_offer_uq').on(t.offerId),
  deptIdx: index('employees_dept_idx').on(t.deptId, t.status),
  posIdx: index('employees_position_idx').on(t.positionCode),
  candIdx: index('employees_candidate_idx').on(t.candidateId),
  startIdx: index('employees_start_idx').on(t.startDate),
}));

/* The onboarding record hangs off the employee one-to-one. */
export const onboardingRecords = pgTable('onboarding_records', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  formSentAt: timestamp('form_sent_at', { withTimezone: true }),
  formSubmittedAt: timestamp('form_submitted_at', { withTimezone: true }),
  /* The joiner's own details, as the form collects them. Encrypted at rest in
     deployments that enable it; see lib/crypto/field.ts. */
  nationalId: text('national_id'),
  nationality: text('nationality'),
  dob: date('dob'),
  address: text('address'),
  emergencyContact: text('emergency_contact'),
  bank: text('bank'),
  iban: text('iban'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  empUq: uniqueIndex('onboarding_records_employee_uq').on(t.employeeId),
}));

export const onboardingDocuments = pgTable('onboarding_documents', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),           // national_id | education | photo | iban
  label: text('label').notNull(),
  status: documentStatus('status').notNull().default('missing'),
  fileId: text('file_id'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  uploadedBy: text('uploaded_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: text('verified_by'),
  rejectedReason: text('rejected_reason'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  uq: uniqueIndex('onboarding_documents_uq').on(t.employeeId, t.key),
}));

export const references = pgTable('employee_references', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title'),
  company: text('company'),
  relationship: text('relationship'),
  contact: text('contact'),
  status: referenceStatus('status').notNull().default('pending'),
  rating: text('rating'),              // up | down | star, null until answered
  notes: text('notes'),
  contactedAt: timestamp('contacted_at', { withTimezone: true }),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  recordedBy: text('recorded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  empIdx: index('employee_references_emp_idx').on(t.employeeId),
}));

/* The joining notice and the joiner file: who was told what, and when. */
export const joiningNotices = pgTable('joining_notices', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),        // 'joining' | 'file'
  teamKey: text('team_key').notNull(),
  startDate: date('start_date'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  sentBy: text('sent_by').notNull(),
  toName: text('to_name'),
  toEmail: text('to_email'),
  ccEmails: text('cc_emails').array().notNull().default(sql`'{}'::text[]`),
  documentCount: integer('document_count').notNull().default(0),
  formIncluded: boolean('form_included').notNull().default(false),
  messageId: text('message_id'),
}, (t) => ({
  empIdx: index('joining_notices_emp_idx').on(t.employeeId, t.kind),
}));

export const probationRecords = pgTable('probation_records', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  months: integer('months').notNull().default(3),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  state: probationState('state').notNull().default('in_progress'),
  decidedOn: date('decided_on'),
  decidedBy: text('decided_by'),
  decidedByName: text('decided_by_name'),
  reason: text('reason'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  empUq: uniqueIndex('probation_records_employee_uq').on(t.employeeId),
  endsIdx: index('probation_records_ends_idx').on(t.endsOn, t.state),
}));

/* The back-office teams a joiner is announced to. */
export const notifiedTeams = pgTable('notified_teams', {
  id: id(),
  key: text('key').notNull(),
  short: text('short').notNull(),
  name: text('name').notNull(),
  deptId: text('dept_id').references(() => departments.id, { onDelete: 'set null' }),
  purpose: text('purpose'),
  ask: text('ask'),
  onJoining: boolean('on_joining').notNull().default(true),
  onFile: boolean('on_file').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => ({
  keyUq: uniqueIndex('notified_teams_key_uq').on(t.key),
}));

export const notifiedTeamContacts = pgTable('notified_team_contacts', {
  id: id(),
  teamId: text('team_id').notNull().references(() => notifiedTeams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  isPrimary: boolean('is_primary').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  teamIdx: index('notified_team_contacts_team_idx').on(t.teamId),
}));

/* Monthly hiring plan — the targets the attainment rings are drawn against. */
export const goals = pgTable('goals', {
  month: text('month').primaryKey(),   // YYYY-MM
  hires: integer('hires').notNull().default(0),
  timeToHireDays: integer('time_to_hire_days'),
  costPerHireSar: integer('cost_per_hire_sar'),
  offerAcceptRate: text('offer_accept_rate'),   // numeric as text to avoid float drift
  qualityOfHire: text('quality_of_hire'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const functionsRelations = relations(functions, ({ many }) => ({
  departments: many(departments),
}));
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  function: one(functions, { fields: [departments.functionId], references: [functions.id] }),
  positions: many(positions),
}));
export const positionsRelations = relations(positions, ({ one }) => ({
  department: one(departments, { fields: [positions.deptId], references: [departments.id] }),
  location: one(locations, { fields: [positions.locationId], references: [locations.id] }),
}));
export const employeesRelations = relations(employees, ({ one, many }) => ({
  department: one(departments, { fields: [employees.deptId], references: [departments.id] }),
  onboarding: one(onboardingRecords, { fields: [employees.id], references: [onboardingRecords.employeeId] }),
  probation: one(probationRecords, { fields: [employees.id], references: [probationRecords.employeeId] }),
  documents: many(onboardingDocuments),
  references: many(references),
}));
export const accountsRelations = relations(accounts, ({ one, many }) => ({
  staff: one(staff, { fields: [accounts.staffId], references: [staff.id] }),
  sessions: many(sessions),
}));
