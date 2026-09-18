import { loadEnvFiles } from '@/db/env-files';
loadEnvFiles();

import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import { CAPABILITIES, capabilities, type Capability } from '@/lib/authz';
import { commandNames, lookup } from '@/lib/commands/registry';
import { sheetNames } from '@/lib/sheets/registry';
import { EVENT_TYPES } from '@/lib/audit';
import { providers } from '@/lib/env';
import { MERGE_SOURCE } from '@/lib/services/offer-letter';
import { CRIT } from '@/lib/domain/ivreview';
import { TEAM_ROLES } from '@/lib/domain/team';
import type { Viewer } from '@/lib/auth/session';
import '@/lib/commands';
import '@/lib/sheets';

/* ═════════════════════════════════════════════════════════════════════════════
   THE DOCUMENTS THAT ARE GENERATED

   A permissions matrix somebody types out by hand is wrong within a fortnight.
   These five are written from the code that enforces them — the capability
   table, the command registry, the provider state, the rules in the database
   and the event vocabulary — so a document that disagrees with the product is
   a bug in the generator rather than a stale file nobody noticed.

     npm run docs

   The prose documents beside them are written by hand and reviewed; this only
   writes the ones a machine should.
   ═════════════════════════════════════════════════════════════════════════════*/

const DOCS = path.join(process.cwd(), 'docs');

const write = (name: string, body: string) => {
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, name), `${body.trimEnd()}\n`, 'utf8');
  console.log(`  ${name}`);
};

const stamp = () => {
  const d = new Date();
  return `Generated from the code on ${d.toISOString().slice(0, 10)} by \`npm run docs\`. Do not edit by hand.`;
};

/** A viewer of a given role, for asking the real capability function. */
const asRole = (staffRole: string | null, role = 'staff'): Viewer => ({
  accountId: 'doc', sessionId: 'doc', name: 'doc', email: null, title: null,
  role, staffRole, staffId: null, roleLabel: '', hue: 1, photo: null,
  scope: { kind: 'all', jobIds: [], own: true },
  isPortal: role !== 'staff', isAdmin: staffRole === 'tal_lead',
} as unknown as Viewer);

const ROLES: Array<[string, Viewer]> = [
  ['Admin', asRole('tal_lead')],
  ['Recruiter', asRole('recruiter')],
  ['Sourcer', asRole('sourcer')],
  ['Coordinator', asRole('coordinator')],
  ['Onboarding', asRole('onboarding')],
  ['Analyst', asRole('analyst')],
  ['Hiring manager', asRole(null, 'hiring_manager')],
  ['Participant', asRole(null, 'participant')],
];

/* ── 2 · The database ────────────────────────────────────────────────────── */
async function database(): Promise<string> {
  const cols = rowsOf(await db().execute(sql`
    SELECT c.table_name, c.column_name, c.ordinal_position,
           c.data_type, c.udt_name, c.is_nullable, c.column_default
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`)) as Array<{
       table_name: string; column_name: string; ordinal_position: number;
       data_type: string; udt_name: string; is_nullable: string; column_default: string | null;
     }>;

  const keys = rowsOf(await db().execute(sql`
    SELECT tc.table_name, tc.constraint_type, kcu.column_name,
           ccu.table_name AS ref_table, ccu.column_name AS ref_column, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
      LEFT JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
     ORDER BY tc.table_name, tc.constraint_type, kcu.ordinal_position`)) as Array<{
       table_name: string; constraint_type: string; column_name: string;
       ref_table: string | null; ref_column: string | null; delete_rule: string | null;
     }>;

  const uniques = rowsOf(await db().execute(sql`
    SELECT tablename AS table_name, indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'public' AND indexdef ILIKE '%UNIQUE%'
     ORDER BY tablename, indexname`)) as Array<{
       table_name: string; indexname: string; indexdef: string;
     }>;

  const checks = rowsOf(await db().execute(sql`
    SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND con.contype = 'c'
     ORDER BY rel.relname, con.conname`)) as Array<{
       table_name: string; conname: string; def: string;
     }>;

  const triggers = rowsOf(await db().execute(sql`
    SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY c.relname, t.tgname`)) as Array<{
       table_name: string; tgname: string; def: string;
     }>;

  const enums = rowsOf(await db().execute(sql`
    SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     GROUP BY t.typname ORDER BY t.typname`)) as Array<{ typname: string; labels: string }>;

  const tables = [...new Set(cols.map((c) => c.table_name))];
  const pk = new Map<string, string[]>();
  const fk = new Map<string, Array<{ col: string; to: string; onDelete: string }>>();
  const refs = new Map<string, string[]>();
  for (const k of keys) {
    if (k.constraint_type === 'PRIMARY KEY') {
      pk.set(k.table_name, [...(pk.get(k.table_name) ?? []), k.column_name]);
    } else if (k.ref_table) {
      fk.set(k.table_name, [...(fk.get(k.table_name) ?? []), {
        col: k.column_name, to: `${k.ref_table}.${k.ref_column}`,
        onDelete: (k.delete_rule ?? 'NO ACTION').toLowerCase(),
      }]);
      refs.set(k.ref_table, [...new Set([...(refs.get(k.ref_table) ?? []), k.table_name])]);
    }
  }

  const type = (c: typeof cols[number]) =>
    (c.data_type === 'USER-DEFINED' ? `${c.udt_name} *(enum)*`
      : c.data_type === 'ARRAY' ? `${c.udt_name.replace(/^_/, '')}[]`
        : c.data_type === 'timestamp with time zone' ? 'timestamptz'
          : c.data_type === 'character varying' ? 'varchar'
            : c.data_type);

  const sections = tables.map((t) => {
    const mine = cols.filter((c) => c.table_name === t);
    const primary = new Set(pk.get(t) ?? []);
    const foreign = new Map((fk.get(t) ?? []).map((f) => [f.col, f]));
    const rows = mine.map((c) => {
      const marks = [
        primary.has(c.column_name) ? 'PK' : '',
        foreign.has(c.column_name) ? `→ \`${foreign.get(c.column_name)!.to}\` *(on delete ${foreign.get(c.column_name)!.onDelete})*` : '',
      ].filter(Boolean).join(' ');
      const def = c.column_default
        ? `\`${c.column_default.replace(/::[a-z_ ]+(\[\])?/gi, '').slice(0, 40)}\``
        : '';
      return `| \`${c.column_name}\` | ${type(c)} | ${c.is_nullable === 'NO' ? 'not null' : ''} | ${def} | ${marks} |`;
    }).join('\n');

    const uq = uniques.filter((u) => u.table_name === t)
      .map((u) => `- \`${u.indexname}\` — ${u.indexdef.replace(/^CREATE UNIQUE INDEX \S+ ON \S+ USING \w+ /, '')}`)
      .join('\n');
    const ck = checks.filter((c) => c.table_name === t)
      .map((c) => `- \`${c.conname}\` — ${c.def}`).join('\n');
    const tg = triggers.filter((x) => x.table_name === t)
      .map((x) => `- \`${x.tgname}\``).join('\n');
    const referenced = refs.get(t) ?? [];

    return [
      `### \`${t}\``,
      '',
      '| Column | Type | | Default | |',
      '| --- | --- | --- | --- | --- |',
      rows,
      uq ? `\n**Unique**\n\n${uq}` : '',
      ck ? `\n**Checks**\n\n${ck}` : '',
      tg ? `\n**Triggers**\n\n${tg}` : '',
      referenced.length ? `\n**Referenced by** ${referenced.map((r) => `\`${r}\``).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const enumRows = enums.map((e) => `| \`${e.typname}\` | ${e.labels.split(', ').map((l) => `\`${l}\``).join(' ')} |`).join('\n');

  return `# Database

${stamp()}

PostgreSQL 16. ${tables.length} tables, ${enums.length} enumerated types,
${uniques.length} unique indexes, ${checks.length} check constraints and
${triggers.length} triggers — read out of the live schema, so this is what the
database actually holds rather than what anybody believes it holds.

## The rules the database itself enforces

The product checks these, and so does the database. Anything that can corrupt
the record if it happens twice is stopped in both places, because a race the
application loses is still a race.

| Rule | How |
| --- | --- |
| One candidate per human | Unique on the normalised e-mail key, and on the last nine digits of the phone |
| One application per candidate per requisition | Unique on \`(candidate_id, job_id)\` |
| One employee per accepted offer | Unique on \`offer_id\` in \`employees\` |
| One employee number, ever | Unique on \`employee_code\` |
| One lead hiring manager per requisition | Partial unique index on \`job_hiring_managers\` |
| One live claim per candidate | The claim lives on the candidate row |
| One scorecard per reviewer per application | Unique on \`(application_id, coalesce(by_id, lower(by_name)))\` |
| Nobody signs the same offer twice | Unique on the signature, and the state machine refuses |
| The audit trail is append-only | A trigger that raises on \`UPDATE\` and \`DELETE\` |
| Two people cannot be hired into one seat | Seat arithmetic checked against \`positions.approved\` |

## Enumerated types

An enum is a closed vocabulary. A value the product invents that is not on this
list is refused by the database, which is the point.

| Type | Values |
| --- | --- |
${enumRows}

## Every table

${sections}
`;
}

/* ── 3 · The permissions matrix ──────────────────────────────────────────── */
function permissions(): string {
  const caps = ROLES.map(([name, v]) => [name, capabilities(v)] as const);
  const groups = new Map<string, Capability[]>();
  for (const c of CAPABILITIES) {
    const head = c.split('.')[0];
    groups.set(head, [...(groups.get(head) ?? []), c]);
  }

  /* Which commands each capability guards — a capability with no command is
     read-only, and worth being able to see as such. */
  const byCap = new Map<string, string[]>();
  for (const n of commandNames()) {
    const cap = (lookup(n) as { capability?: string } | undefined)?.capability;
    if (!cap) continue;
    byCap.set(cap, [...(byCap.get(cap) ?? []), n]);
  }

  const head = `| Capability | ${caps.map(([n]) => n).join(' | ')} | Commands |`;
  const rule = `| --- | ${caps.map(() => ':-:').join(' | ')} | --- |`;

  const sections = [...groups.entries()].map(([g, list]) => {
    const body = list.map((c) => {
      const cells = caps.map(([, set]) => (set.has(c) ? '●' : '·'));
      const cmds = (byCap.get(c) ?? []).map((x) => `\`${x}\``).join(' ');
      return `| \`${c}\` | ${cells.join(' | ')} | ${cmds || '—'} |`;
    }).join('\n');
    return `### ${g}\n\n${head}\n${rule}\n${body}`;
  }).join('\n\n');

  const counts = caps.map(([n, set]) => `- **${n}** — ${set.size} of ${CAPABILITIES.length}`).join('\n');

  return `# Permissions matrix

${stamp()}

Two questions are answered on the server, in \`lib/authz.ts\`, and nowhere else:

1. **May this person perform this action at all?** — the capability, below.
2. **May they see this requisition?** — the scope, which is a separate axis and
   is applied to every query and every command. See \`jobScopeSql\`,
   \`requireJob\` and \`requireApplication\` in the same file.

Hiding a button is a courtesy to the person using the product. It is not a
control, and nothing here depends on it: every command passes \`require_\`
before its schema is parsed, and every query that reads a requisition applies
the scope at the root it is read from.

## How much each role holds

${counts}

The Admin — the Head of Talent Acquisition — is written as *everything* rather
than a list, because a capability nobody can reach is a capability nobody has
tested.

## The scope, which is the other half

| Scope | What it means |
| --- | --- |
| \`all\` | Every requisition. The default for staff accounts. |
| \`own\` | The requisitions this person is named on as a hiring manager, plus the interviews they sit on. |
| \`jobs\` | Exactly the requisitions chosen for them; \`scope_own\` adds their own on top. |

A requisition that closes stays reachable to whoever could already see it, so
nobody's history disappears when a role is filled.

## Every capability, by group

${sections}
`;
}

/* ── 5 · The integration matrix ──────────────────────────────────────────── */
function integrations(): string {
  const p = providers() as Record<string, { configured: boolean; provider: string; missing: string[] }>;
  const WHAT: Record<string, [string, string]> = {
    email: ['Email', 'Every letter, invitation and notice that leaves the building.'],
    whatsapp: ['WhatsApp', 'The screening chat, the pitch brief, and candidate replies.'],
    sms: ['SMS', 'Booking links and call-back links.'],
    linkedin: ['LinkedIn', 'Publishing a requisition to the company page.'],
    calendar: ['Calendar', 'The interview invitation and the panel’s free/busy.'],
    esign: ['E-signature', 'The offer envelope and the signature on the letter.'],
    voice: ['Telephony', 'The AI phone screen — placing the call and the recording.'],
    assessment: ['Assessments', 'The behavioural questionnaire and its report.'],
    hris: ['HRIS', 'Pushing a new joiner into the system of record.'],
    ai: ['Model', 'CV reading, transcript analysis and the interviewer review.'],
    storage: ['File storage', 'Where every uploaded file actually lives.'],
    scanner: ['Malware scanning', 'Every uploaded file before it is readable.'],
  };

  const rows = Object.entries(p).map(([key, s]) => {
    const [name, what] = WHAT[key] ?? [key, ''];
    const state = s.configured ? `**Configured** — \`${s.provider}\`` : '**Not configured**';
    const missing = s.configured ? '—' : s.missing.map((m) => `\`${m}\``).join(', ');
    return `| ${name} | ${what} | ${state} | ${missing} |`;
  }).join('\n');

  return `# Integration matrix

${stamp()}

Every outside system reaches the product through an adapter behind a contract in
\`lib/providers/types.ts\`. An adapter returns one of exactly three things:

\`\`\`ts
notConfigured(what, missing)   // nothing is set up: say so, do not pretend
failed(message, { retryable }) // it was tried and did not work
sent(externalId, detail)       // it worked, and here is the receipt
\`\`\`

**Nothing fakes success.** A message with no provider is written to the outbox
with status \`not_configured\` and the settings that are missing named in the
row; the interface shows that, and the recruiter knows to chase the candidate
another way. A file with no scanner is marked \`skipped\`, never \`clean\`. The
phone screen is refused outright rather than scheduled, because a call nobody
can place is not a call that is "queued".

## What is configured in this environment

| Integration | What it does | State | Missing |
| --- | --- | --- | --- |
${rows}

*The state column is this machine's, at the moment the document was generated.
Settings → Integrations shows the same thing live.*

## Webhooks

Provider callbacks arrive at \`/api/webhooks/[provider]\` and are handled in
\`lib/services/webhooks.ts\`, in this order:

1. **Store first.** The raw body and headers are written before anything is
   parsed, so a delivery that cannot be understood is still on the record.
2. **Verify second.** Where the provider signs its callbacks, the signature is
   checked over the raw bytes. An unsigned or mis-signed delivery is kept with
   \`signature_valid = false\`, marked *refused — the signature did not check
   out*, audited, and **never acted on**.
3. **Act once.** Processing is idempotent on the provider's own event id, so a
   provider that retries does not move an application twice.

Meta's GET verification handshake is answered on the same route.
`;
}

/* ── 6 · The automation and event catalogue ──────────────────────────────── */
async function automations(): Promise<string> {
  const rules = rowsOf(await db().execute(sql`
    SELECT r.id, r.name, r.description, r.trigger::text AS trigger, r.enabled, r.is_system,
           r.actions, r.conditions,
           (SELECT count(*)::int FROM automation_runs ar WHERE ar.rule_id = r.id) AS runs
      FROM automation_rules r ORDER BY r.sort_order, r.name`)) as Array<{
        id: string; name: string; description: string | null; trigger: string;
        enabled: boolean; is_system: boolean;
        actions: Array<{ type?: string }> | null; conditions: unknown; runs: number;
      }>;

  const ruleRows = rules.map((r) => {
    const acts = (r.actions ?? []).map((a) => `\`${a.type ?? '?'}\``).join(' ') || '—';
    return `| ${r.enabled ? '●' : '·'} | **${r.name}** | \`${r.trigger}\` | ${acts} | ${
      r.description ?? '—'} | ${r.runs} |`;
  }).join('\n');

  const events = EVENT_TYPES.map((t) => `- \`${t}\``).join('\n');

  return `# Automation and event catalogue

${stamp()}

## The two kinds of record

\`audit_events\` and \`domain_events\` are deliberately separate tables.

- **\`audit_events\`** answers *who did what to whom, and what it looked like
  before*. It is append-only — a database trigger refuses an \`UPDATE\` or a
  \`DELETE\` on it — and nothing in the product can edit a line of it.
- **\`domain_events\`** is what the automation engine reacts to. It is the
  product telling itself something happened, and it is safe to replay.

Every meaningful write puts a row in the first. A write that other things should
react to also puts one in the second.

## The event vocabulary

Nothing emits a type that is not on this list; \`EVENT_TYPES\` in
\`lib/audit.ts\` is the whole of it.

${events}

## The rules

An event is queued, the worker drains the queue, and each enabled rule whose
trigger matches and whose conditions hold runs once. "Once" is enforced by an
idempotency key on the run, inserted before the action is taken — so a worker
that dies half-way does not repeat the half it finished.

| On | Rule | Trigger | Action | What it does | Runs |
| :-: | --- | --- | --- | --- | --: |
${ruleRows}

A failed run is retried with a back-off and its error is kept; the history is on
Settings → Automations, and a rule that keeps failing says so rather than going
quiet.

## The scheduled sweeps

These are not event-driven — they run on a clock, in \`lib/services/sweeps.ts\`,
and each is idempotent per day so running the worker twice changes nothing.

| Sweep | When | What it does |
| --- | --- | --- |
| SLA | Daily | Raises a task on any application past its stage's SLA, once. |
| Probation | Daily | Reminds the hiring manager a fortnight before three months is up. |
| Scorecard | Daily | Chases a panel member whose scorecard is still outstanding. |
| Retention | Daily | Deletes files past their retention date, and records that it did. |
| Candidate retention | Weekly | Flags candidate records past the consent window. |

## The worker

\`npm run worker\` drains the outbox, places scheduled calls, dispatches pending
events, retries failed runs, re-scans files whose scan was skipped, and runs the
daily and weekly sweeps. \`npm run worker -- --once\` does one pass and exits,
printing every provider's configured state on the way — which is the quickest
way to see what this environment can actually do.
`;
}

/* ── 7 · The KPI and formula catalogue ───────────────────────────────────── */
function formulas(): string {
  const crit = CRIT.map(([k, label, hint]) => `| \`${k}\` | ${label} | ${hint} |`).join('\n');
  const merge = Object.entries(MERGE_SOURCE)
    .map(([k, src]) => `| \`{{${k}}}\` | ${src} |`).join('\n');

  return `# KPI and formula catalogue

${stamp()}

Every number the product shows is computed in one place, so a figure on a chart
and the same figure on a card cannot disagree. This is that list.

## Pipeline

| Figure | How it is computed | Where |
| --- | --- | --- |
| **Time in stage** | Whole days from \`stage_entered_at\` to now, floored. | \`lib/domain/stages.ts\` |
| **SLA state** | \`ok\` under the stage's SLA, \`due\` on the day, \`over\` past it. Whole days, so a stage with a three-day SLA is over on day three. | \`lib/domain/stages.ts\` |
| **Conversion** | Applications that reached stage *n+1* over those that reached stage *n*. A disqualified application counts at the stage it reached — rejection is a status, not a tenth column. | \`lib/queries/insights.ts\` |
| **Time to hire** | Days from the application to the offer being accepted. | \`lib/queries/insights.ts\` |
| **Time to fill** | Days from the requisition opening to the offer being accepted. | \`lib/queries/insights.ts\` |
| **Offer acceptance** | Accepted over (accepted + declined). An offer still out counts in neither. | \`lib/queries/offers.ts\` |
| **Quality of hire** | Joiners who passed probation over joiners whose probation has been decided. | \`lib/queries/insights.ts\` |

## Fit against the bar

The skill bar on a requisition is what every candidate is drawn against.

- Each skill is scored 1–5; the candidate's level for it comes from the CV.
- An **essential** skill counts double.
- The score is the weighted mean over the bar, as a percentage.
- A candidate missing an essential skill is **flagged**, not averaged out — the
  panel is told which one rather than shown a slightly lower number.

\`lib/domain/cv-fit.ts\`, recomputed by \`lib/services/fit.ts\` whenever the bar
or the CV changes.

## The phone and chat screen

Six knockout questions, in \`lib/domain/screening.ts\`. Each is scored by the
rules in that file — never by a model — and the verdict is:

| Verdict | When |
| --- | --- |
| \`pass\` | Every knockout answered acceptably. |
| \`review\` | One missed, or an answer that needs a person to read it. |
| \`fail\` | More than one missed. |

## The behavioural questionnaire

Six traits out of ten each, taken from the provider's report. The score is the
six out of sixty as a percentage: **strong** at 75 and over, **mixed** 60–74,
**concern** below. Nothing is inferred — a missing trait is refused rather than
guessed, because the final interview turns on this.

## The sales pitch

Scored against the criteria on the project, each out of its own maximum. The
percentage is the total over the possible total. It is scored by a person or by
the configured model, and the row records which.

## How an interview was run

Six criteria, one to five, meaned onto a hundred. This is coaching for whoever
ran the interview; it says nothing about the candidate.

| Key | Criterion | What it looks at |
| --- | --- | --- |
${crit}

Bands: 85+ exemplary, 80+ strong, 65+ solid, 50+ needs coaching, below 50 off
standard. A review is **flagged** when compliance scores two or less, or when
the analysis raised a flag. \`lib/domain/ivreview.ts\`.

## Which industry a candidate came from

Two passes, in order, in \`lib/domain/sector.ts\`. Both are rules; nothing here
asks a model, and the answer always carries the reason it reached.

1. **The employer.** If the company is one the organisation already knows — the
   table lives in the organisation's own settings, because it is a fact about
   this market rather than about software — that answers it. An exact name
   first, then a loose match, with a floor on the length so a three-letter
   fragment does not match half the table.
2. **The words on the page.** Failing a known employer, the title, the summary
   and the experience are read against the phrases each of the eighteen sectors
   actually uses about itself. First match wins, and the list runs from the most
   specific to the most general.

Failing both, the answer is **Other** — and it says so, rather than guessing.
A recruiter who disagrees can type it in, which is recorded as \`recruiter\`
rather than \`cv\`.

## The offer letter's merge fields

Anything in double braces is replaced when the letter is filled. A field that is
not on this list is left in its braces and counted as **unresolved** — and a
letter with an unresolved field cannot be sent.

| Field | Where the value comes from |
| --- | --- |
${merge}

The salary and date fields follow the offer's terms and are changed through the
terms rather than by hand; the rest can be corrected by Onboarding, and every
correction is kept with what it changed from.
`;
}

/* ── 8 · The migration and parity matrix ─────────────────────────────────── */
function parity(): string {
  const cmds = commandNames().map((n) => {
    const c = lookup(n) as { capability?: string } | undefined;
    return `| \`${n}\` | \`${c?.capability ?? '—'}\` |`;
  }).join('\n');

  const sheets = sheetNames().map((n) => `- \`${n}\``).join('\n');

  return `# Migration and parity matrix

${stamp()}

The prototype at \`Bayut-TA-CRM-v30\` is the specification and the visual
acceptance reference. This maps what it did to where that now lives.

## The shape of the translation

| In the prototype | In the product |
| --- | --- |
| \`Actions['x.y'] = fn\` — one function, called in the browser | A **command** in \`lib/commands/\`: capability, Zod schema, transaction, handler |
| \`Store.patch(...)\` — mutating an in-memory object | A **service** in \`lib/services/\`: the state machine, which validates, persists, audits and emits |
| \`UI.Sheet.open({...})\` — a string of HTML | A **sheet** in \`lib/sheets/\`: a server component that reads the database under the viewer's scope |
| \`Sel.x(...)\` — a selector over the store | A **query** in \`lib/queries/\`, scope applied at the root |
| \`if (!Sel.isAdmin(ME())) return toast(...)\` | \`require_(viewer, capability)\` in the dispatcher, before the schema is parsed |
| \`localStorage\` | PostgreSQL. The browser is not the system of record. |
| A toast that says something was sent | The outbox, which says whether it was |

## Every command in the product

One write door — \`app/actions/dispatch.ts\` — and this is everything behind it.
A command that is not registered in \`lib/commands/index.ts\` is unreachable, by
design.

| Command | Capability |
| --- | --- |
${cmds}

## Every panel

${sheets}

## Where the product deliberately differs

These are not gaps. Each is a place where doing what the prototype did would
have been dishonest in a system of record.

| The prototype | The product | Why |
| --- | --- | --- |
| A phone screen is "scheduled" with no telephony | Refused, with the missing setting named | A call nobody can place is not a call that is queued, and a recruiter who believes it is stops chasing |
| An assessment result is generated | Typed from the provider's report, or arrives by webhook | The product has no opinion about a person it has never met |
| A pitch is scored by the demo | Scored by a person, or by the configured model, and the row says which | Same |
| A file is "clean" | \`skipped\` until a scanner is configured | Pretending a file was scanned is worse than saying it was not |
| A seat is added to the plan directly | A seat arrives with the requisition that raised it | Headcount nobody approved is not headcount |
| An offer letter is edited after sending | Refused; version two supersedes it | The candidate holds a document |
`;
}

/* ── 9 · The test report ─────────────────────────────────────────────────── */
function testReport(): string {
  const file = path.join(process.cwd(), 'tests', 'reports', 'commands.json');
  if (!fs.existsSync(file)) {
    return `# Test report\n\nNo run recorded. \`npm test\` writes one, then \`npm run docs\`.\n`;
  }
  const r = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    at: string; filters: string[]; seconds: number;
    pass: number; fail: number; skipped: number;
    failures: Array<{ suite: string; test: string; error: string }>;
    suites: Array<{ name: string; file: string; tests: Array<{ name: string; state: string; ms: number }> }>;
  };

  const partial = (r.filters ?? []).length
    ? `\n> ⚠ This run was filtered to \`${r.filters.join(' ')}\`. Run \`npm test\` with no filter before publishing.\n`
    : '';

  const summary = r.suites.map((s) => {
    const p = s.tests.filter((t) => t.state === 'pass').length;
    const f = s.tests.filter((t) => t.state === 'fail').length;
    const k = s.tests.filter((t) => t.state === 'skip').length;
    return `| [\`${s.name}\`](../${s.file}) | ${p} | ${f || '—'} | ${k || '—'} |`;
  }).join('\n');

  const detail = r.suites.map((s) => {
    const lines = s.tests.map((t) => {
      const mark = t.state === 'pass' ? '✓' : t.state === 'fail' ? '✗' : '—';
      return `- ${mark} ${t.name}`;
    }).join('\n');
    return `### ${s.name}\n\n\`${s.file}\`\n\n${lines}`;
  }).join('\n\n');

  const failures = r.failures.length
    ? `## Failures\n\n${r.failures.map((f) => `### ${f.suite} — ${f.test}\n\n\`\`\`\n${f.error}\n\`\`\``).join('\n\n')}\n`
    : '## Failures\n\nNone.\n';

  /* The visual comparison writes its own report beside this one. */
  const visualFile = path.join(process.cwd(), 'tests', 'reports', 'visual.json');
  let visual = '';
  if (fs.existsSync(visualFile)) {
    const v = JSON.parse(fs.readFileSync(visualFile, 'utf8')) as {
      at: string; tolerance: number; matched: number; total: number;
      routes: Array<{
        id: string; worst: number | null; where: string;
        note: string | null; known: string | null; ok: boolean;
      }>;
      missing: string[];
      consoleErrors: Array<{ id: string }>;
    };
    const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);
    const over = v.routes.filter((r) => !r.ok).sort((a, b) => (b.worst ?? 0) - (a.worst ?? 0));
    const rows = (over.length ? over : v.routes.slice().sort((a, b) => (b.worst ?? 0) - (a.worst ?? 0)).slice(0, 8))
      .map((r) => `| \`${r.id}\` | ${pct(r.worst)} | ${r.where} | ${r.known ?? r.note ?? ''} |`)
      .join('\n');

    visual = `

## Visual parity

The prototype is the acceptance reference, photographed at 390, 900 and 1440
pixels in both themes and compared pixel for pixel.
Run on ${new Date(v.at).toISOString().replace('T', ' ').slice(0, 16)} UTC.

**${v.matched} of ${v.total} routes within ${(v.tolerance * 100).toFixed(0)}% of the
prototype**, measured on each route's worst capture.
${v.consoleErrors.length ? `\n${v.consoleErrors.length} capture(s) logged a console error.\n` : ''}${
  v.missing.length ? `\n${v.missing.length} capture(s) had no baseline.\n` : ''}
${over.length
  ? (v.matched === v.total
    ? 'The routes whose remaining difference is recorded and expected — each shows '
      + 'something real that the prototype faked:'
    : 'The routes over tolerance:')
  : 'The eight furthest from the reference:'}

| Route | Worst capture | Where | Recorded reason |
| --- | --: | --- | --- |
${rows}

A route with a recorded reason shows something real that the prototype faked and
does not fail the run; see [known limitations](10-known-limitations.md).
`;
  }

  /* The route walk writes its own report too. */
  const walkFile = path.join(process.cwd(), 'tests', 'reports', 'walk.json');
  let walk = '';
  if (fs.existsSync(walkFile)) {
    const w = JSON.parse(fs.readFileSync(walkFile, 'utf8')) as {
      at: string; base: string; routes: number; roles: string[]; walked: number;
      findings: Array<{ role: string; id: string; why: string; detail?: string }>;
    };
    const rows = w.findings.length
      ? w.findings.map((f) => `| \`${f.id}\` | ${f.role} | ${f.why} |`).join('\n')
      : '';
    walk = `

## The route walk

Every route loaded for real, as each kind of person who uses it, and failed on
anything that should never reach somebody: an error boundary, a stack trace,
\`[object Object]\`, \`NaN\`, the word "undefined", an unreplaced merge field, a
console error, or a status that is not 200. \`npm run walk\`.

Run on ${new Date(w.at).toISOString().replace('T', ' ').slice(0, 16)} UTC
against ${w.base}.

**${w.walked} page loads** — ${w.routes} routes as ${w.roles.length} roles
(${w.roles.join(', ')}) — **${w.findings.length ? `${w.findings.length} finding${w.findings.length === 1 ? '' : 's'}` : 'nothing on any of them that should not be'}**.

${rows ? `| Route | As | What |\n| --- | --- | --- |\n${rows}\n` : ''}
This is the check that catches what a unit suite structurally cannot: a
predicate that composes wrongly only for an account whose access is not
everything, and therefore works for everybody who writes the queries. It found
two — six page queries that qualified a column with a table name the query had
aliased away, and an \`IN ()\` for a scope that reached nothing.
`;
  }

  return `# Test report

${stamp()}

Run on **${new Date(r.at).toISOString().replace('T', ' ').slice(0, 16)} UTC**,
in **${r.seconds}s**.
${partial}
## ${r.pass} passed · ${r.fail} failed${r.skipped ? ` · ${r.skipped} skipped` : ''}

Every suite below runs against the **real PostgreSQL database**, with the real
constraints and the real triggers, inside a transaction that is rolled back at
the end. There is no mocking framework and no in-memory double, because an
in-memory double would not have the append-only trigger on \`audit_events\`, the
unique index that stops two people being hired into one seat, or the foreign key
that refuses an orphan — and those are exactly the things worth testing.

A write test drives the **real command through the real dispatcher**: the
capability is checked, the Zod schema is parsed, the transaction is opened. A
test that skipped any of those would be testing something the product does not
do.

| Suite | Passed | Failed | Skipped |
| --- | --: | --: | --: |
${summary}
${visual}
${walk}
${failures}
## Every test

${detail}
`;
}

/* ── 12 · The environment-variable reference ─────────────────────────────── */
function environment(): string {
  /* Two sources, each for what it is good at: the schema in `lib/env.ts` says
     whether a variable is required and what it falls back to, and
     `.env.example` says what it is for and which group it belongs in. A
     variable in one and not the other is reported rather than dropped. */
  const schemaFile = fs.readFileSync(path.join(process.cwd(), 'lib', 'env.ts'), 'utf8');
  const body = schemaFile.slice(schemaFile.indexOf('const Schema = z.object({'));

  /* A property's value runs to the comma that is not inside brackets — an enum
     is a list of commas, so counting depth is the only way to find the end. */
  const spec = new Map<string, string>();
  for (const m of body.matchAll(/\b([A-Z][A-Z0-9_]{2,}):\s*/g)) {
    if (spec.has(m[1])) continue;
    let depth = 0;
    let i = m.index! + m[0].length;
    const from = i;
    for (; i < body.length; i += 1) {
      const ch = body[i];
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth -= 1; }
      else if (ch === ',' && depth === 0) break;
      else if (ch === '\n' && depth === 0 && /,\s*$/.test(body.slice(from, i))) break;
    }
    spec.set(m[1], body.slice(from, i).replace(/\s+/g, ' ').trim());
  }

  const shape = (detail: string): { required: boolean; def: string; kind: string } => {
    const int_ = detail.match(/^int\(([^)]*)\)/);
    if (int_) return { required: false, def: int_[1], kind: 'number' };
    const bool_ = detail.match(/^bool\(([^)]*)\)/);
    if (bool_) return { required: false, def: bool_[1], kind: 'true / false' };
    if (/^str\b/.test(detail)) return { required: false, def: '', kind: 'text' };
    const def = detail.match(/\.default\((.*?)\)\s*$/)?.[1]
      ?? detail.match(/\.default\(([^)]*)\)/)?.[1] ?? '';
    const en = detail.match(/z\.enum\(\[([^\]]*)\]\)/);
    const kind = en ? en[1].replace(/'/g, '').replace(/,\s*/g, ' \\| ')
      : /z\.number|\.int\(\)/.test(detail) ? 'number'
        : /z\.boolean/.test(detail) ? 'true / false'
          : /\.url\(\)/.test(detail) ? 'url' : 'text';
    return { required: !def && !/\.optional\(\)/.test(detail), def, kind };
  };

  /* The example file gives the grouping and the prose. */
  const example = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
  type Row = { name: string; note: string; sample: string };
  const groups: Array<{ title: string; rows: Row[] }> = [];
  let current: { title: string; rows: Row[] } | null = null;
  let note = '';
  for (const raw of example.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const head = line.match(/^#\s*[─-]+\s*(.+?)\s*[─-]+\s*$/);
    if (head) { current = { title: head[1], rows: [] }; groups.push(current); note = ''; continue; }
    const comment = line.match(/^#\s?(.*)$/);
    if (comment) { note = note ? `${note} ${comment[1]}`.trim() : comment[1].trim(); continue; }
    const v = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (v) {
      if (!current) { current = { title: 'Core', rows: [] }; groups.push(current); }
      const sample = v[2].replace(/\s+#.*$/, '').trim();
      current.rows.push({ name: v[1], note, sample });
      note = '';
      continue;
    }
    if (!line.trim()) note = '';
  }

  const seen = new Set<string>();
  const sections = groups.filter((g) => g.rows.length).map((g) => {
    const rows = g.rows.map((r) => {
      seen.add(r.name);
      const d = spec.get(r.name);
      const s = d ? shape(d) : { required: false, def: '', kind: 'text' };
      const def = s.def || (r.sample && !s.required ? `\`${r.sample}\`` : '');
      return `| \`${r.name}\` | ${s.required ? '**yes**' : 'no'} | ${s.kind} | ${
        def ? (def.startsWith('`') ? def : `\`${def}\``) : '—'} | ${r.note || ''} |`;
    }).join('\n');
    return `### ${g.title}\n\n| Variable | Required | Type | Default | What it is |\n| --- | :-: | --- | --- | --- |\n${rows}`;
  }).join('\n\n');

  const orphans = [...spec.keys()].filter((k) => !seen.has(k));
  const orphanNote = orphans.length
    ? `\n## In the schema but not in \`.env.example\`\n\n${
      orphans.map((o) => `- \`${o}\``).join('\n')}\n\nAdd them to the example file so they are easy to find.\n`
    : '';

  const rows = sections + orphanNote;

  return `# Environment-variable reference

${stamp()}

Read and validated once, at start-up, by \`lib/env.ts\`. A variable that fails
its schema stops the process rather than producing a subtly wrong system later —
and a provider whose variables are absent is reported as **not configured**
rather than failing at the moment somebody tries to use it.

Files are read in this order, each overriding the last: \`.env\`,
\`.env.local\`, \`.env.<NODE_ENV>\`, \`.env.<NODE_ENV>.local\`, then the real
environment. A value with an unquoted \`#\` after it has the comment stripped.

${rows}

## How the provider switches work

Each integration has a \`*_PROVIDER\` variable whose value picks the adapter,
and \`none\` is always a legitimate answer. A provider set to something other
than \`none\` whose credentials are missing is reported as not configured, with
the exact variables named — in the product, in \`npm run worker -- --once\`, and
in the integration matrix.
`;
}

/* ── Run ─────────────────────────────────────────────────────────────────── */
async function main() {
  console.log('Writing the generated documents:');
  write('02-database.md', await database());
  write('03-permissions-matrix.md', permissions());
  write('05-integration-matrix.md', integrations());
  write('06-automation-and-events.md', await automations());
  write('07-kpi-and-formulas.md', formulas());
  write('08-migration-parity-matrix.md', parity());
  write('09-test-report.md', testReport());
  write('12-environment-variables.md', environment());
  console.log('Done.');
  process.exit(0);
}

main();
