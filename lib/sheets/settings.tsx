import 'server-only';
import * as React from 'react';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  departments, functions, questionBank, pitchProjects, pitchConfig, notifiedTeams,
  notifiedTeamContacts, approvalFlows, approvalFlowSteps, accounts, staff, jobs,
} from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Card, Kvs } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { TEAM_ROLES } from '@/lib/domain/team';
import { QTYPES, QuestionForm, depts } from './blocks';
import { fmt } from '@/lib/format';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SETTINGS SHEETS

   A department, a question in the bank, a pitch project and the wording that
   goes out with it, a notified team, a step on an approval chain, and the two
   that govern who can sign in and what they see.

   The access sheets are the ones that matter most. What an account may see is
   stored on the account and applied to every query and every command — the
   scope picker here is a way of writing that down, not a way of hiding buttons.
   ═════════════════════════════════════════════════════════════════════════════*/

const APPROVER_ROLES = [
  { v: 'hiring_manager', t: 'The hiring manager on the requisition' },
  { v: 'tal_lead', t: 'Head of TA' },
  { v: 'finance', t: 'Finance' },
  { v: 'gm', t: 'General Manager' },
  { v: 'onboarding', t: 'Onboarding Specialist' },
];

defineSheets({
  /* ── A department ─────────────────────────────────────────────────────── */
  'dept.new': async () => {
    const fns = await db().select().from(functions).orderBy(asc(functions.sortOrder));
    return {
      title: 'New department',
      aria: 'New department',
      eyebrow: 'Organisation',
      sub: 'A department is what a requisition hires into, what the manpower plan is grouped by, '
        + 'and where the hiring-manager list comes from.',
      body: (
        <div className="form">
          <Field label="Name" name="name" req className="wide" placeholder="e.g. Commercial — Riyadh" />
          <Field label="Code" name="code"
            placeholder="e.g. COM"
            help="The prefix every position code in it carries. Left blank, it is taken from the name." />
          <Field label="Function" name="functionId" type="select"
            options={[
              { v: '', t: 'Other (no function)' },
              ...fns.map((f) => ({ v: f.id, t: f.name })),
            ]}
            help="Where it sits on the company chart, and what the job family is called." />
          <Field label="Head" name="head" placeholder="Full name"
            help="Their name appears first on the hiring-manager list for this department." />
          <Field label="Head’s title" name="headTitle" placeholder="e.g. Head of Commercial" />
          <Field label="Establishment headcount" name="headcount" type="number" min={0}
            help="From the HR headcount report. Leave blank when it is not known." />
          <Field label="Cost centre" name="costCentre" placeholder="e.g. CC-4120" />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="dept.save">Add the department</Btn>
        </>
      ),
    };
  },

  'dept.edit': async (v) => {
    const [d] = await db().select().from(departments).where(eq(departments.id, v)).limit(1);
    if (!d) return null;
    const fns = await db().select().from(functions).orderBy(asc(functions.sortOrder));
    const [{ live, seats }] = rowsOf(await db().execute(sql`
      SELECT (SELECT count(*)::int FROM ${jobs}
               WHERE dept_id = ${v} AND status IN ('open','pending_approval','draft','on_hold')) AS live,
             (SELECT count(*)::int FROM positions
               WHERE dept_id = ${v} AND retired_at IS NULL) AS seats`)) as
      Array<{ live: number; seats: number }>;

    return {
      title: d.name,
      aria: 'Edit department',
      eyebrow: 'Organisation',
      sub: `${seats} seat${Number(seats) === 1 ? '' : 's'} on the plan · `
        + `${live} live requisition${Number(live) === 1 ? '' : 's'}. Changing the head moves the live `
        + 'requisitions onto them; the closed ones keep the name they were run under.',
      body: (
        <div className="form">
          <Field label="Name" name="name" value={d.name} req className="wide" />
          <Field label="Code" name="code" value={d.code}
            help="The prefix every position code in it carries." />
          <Field label="Function" name="functionId" type="select" value={d.functionId ?? ''}
            options={[
              { v: '', t: 'Other (no function)' },
              ...fns.map((f) => ({ v: f.id, t: f.name })),
            ]} />
          <Field label="Head" name="head" value={d.head ?? ''} placeholder="Full name" />
          <Field label="Head’s title" name="headTitle" value={d.headTitle ?? ''} />
          <Field label="Establishment headcount" name="headcount" type="number" min={0}
            value={d.headcount ?? ''} />
          <Field label="Cost centre" name="costCentre" value={d.costCentre ?? ''} />
        </div>
      ),
      foot: (
        <>
          <Btn variant="danger" action="dept.remove" v={v} icon="trash" iconSize={13}>Archive</Btn>
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="dept.save" v={v}>Save</Btn>
        </>
      ),
    };
  },

  /* ── The question bank ────────────────────────────────────────────────── */
  'qb.new': async () => {
    const fams = (await db().select({ name: functions.name }).from(functions)
      .orderBy(asc(functions.sortOrder))).map((f) => f.name);
    return {
      title: 'Add a question to the bank',
      aria: 'New question',
      eyebrow: 'Templates',
      sub: 'Bank questions can be attached to any requisition. A standard one attaches itself to '
        + 'every new requisition; the rest are suggested by job family.',
      body: (
        <>
          <QuestionForm />
          <div className="divider"><span className="t-over">Where it is offered</span></div>
          <div className="form">
            <Field label="Standard" name="isStandard" type="select" value="0"
              options={[
                { v: '0', t: 'Offered — picked per requisition' },
                { v: '1', t: 'Standard — attached to every new requisition' },
              ]} />
          </div>
          <div className="field wide">
            <label>Suggested for these families</label>
            <div className="wrap">
              {fams.map((f) => (
                <label className="chip" key={f}>
                  <input type="checkbox" name="families" value={f} />{f}
                </label>
              ))}
            </div>
            <span className="help">
              Leave every box clear for a question that suits any role.
            </span>
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="qb.save">Add the question</Btn>
        </>
      ),
    };
  },

  'qb.edit': async (v) => {
    const [q] = await db().select().from(questionBank).where(eq(questionBank.id, v)).limit(1);
    if (!q) return null;
    const fams = (await db().select({ name: functions.name }).from(functions)
      .orderBy(asc(functions.sortOrder))).map((f) => f.name);
    const on = new Set(q.families);
    const [{ uses }] = rowsOf(await db().execute(sql`
      SELECT count(*)::int AS uses FROM job_questions WHERE bank_id = ${v}`)) as Array<{ uses: number }>;

    return {
      title: 'Edit question',
      aria: 'Edit question',
      eyebrow: 'Templates',
      sub: `Used on ${uses} requisition${Number(uses) === 1 ? '' : 's'}. Editing it here does not `
        + 'rewrite the copies already on them — a requisition asks what it asked.',
      body: (
        <>
          <QuestionForm q={q} />
          <div className="divider"><span className="t-over">Where it is offered</span></div>
          <div className="form">
            <Field label="Standard" name="isStandard" type="select" value={q.isStandard ? '1' : '0'}
              options={[
                { v: '0', t: 'Offered — picked per requisition' },
                { v: '1', t: 'Standard — attached to every new requisition' },
              ]} />
          </div>
          <div className="field wide">
            <label>Suggested for these families</label>
            <div className="wrap">
              {fams.map((f) => (
                <label className="chip" key={f}>
                  <input type="checkbox" name="families" value={f} defaultChecked={on.has(f)} />{f}
                </label>
              ))}
            </div>
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="danger" action="qb.remove" v={v} icon="trash" iconSize={13}>Retire</Btn>
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="qb.save" v={v}>Save</Btn>
        </>
      ),
    };
  },

  /* ── A sales-pitch project ────────────────────────────────────────────── */
  'pp.new': async () => ({
    title: 'New pitch project',
    aria: 'New pitch project',
    eyebrow: 'Sales pitch',
    wide: true,
    sub: 'A real Bayut project the candidate is asked to pitch. The brief goes out ahead of the '
      + 'call; the criteria are what the panel scores against.',
    body: <ProjectForm />,
    foot: (
      <>
        <Btn variant="ghost" action="sheet.close">Cancel</Btn>
        <Sp />
        <Btn variant="pri" action="pp.save">Add the project</Btn>
      </>
    ),
  }),

  'pp.edit': async (v) => {
    const [p] = await db().select().from(pitchProjects).where(eq(pitchProjects.id, v)).limit(1);
    if (!p) return null;
    return {
      title: p.name,
      aria: 'Edit pitch project',
      eyebrow: 'Sales pitch',
      wide: true,
      sub: `Used on ${p.uses} pitch${p.uses === 1 ? '' : 'es'}${p.active ? '' : ' — currently retired'}.`,
      body: <ProjectForm p={p} />,
      foot: (
        <>
          <Btn variant="ghost" action="pp.toggle" v={v}>
            {p.active ? 'Retire it' : 'Bring it back'}
          </Btn>
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="pp.save" v={v}>Save</Btn>
        </>
      ),
    };
  },

  /* ── What the brief says ──────────────────────────────────────────────── */
  'pp.cfg': async () => {
    const [c] = await db().select().from(pitchConfig).limit(1);
    return {
      title: 'The pitch brief',
      aria: 'Pitch brief wording',
      eyebrow: 'Sales pitch',
      wide: true,
      sub: 'What the candidate receives, and how long before the call. Anything in double braces is '
        + 'filled from the record: first_name, job_title, project_name, client, brief, task, '
        + 'duration, when, recruiter_name and lead_hours.',
      body: (
        <>
          <div className="form">
            <Field label="Send the brief this many hours ahead" name="leadHours" type="number"
              min={1} max={168} value={c?.leadHours ?? 24} />
            <Field label="How it is sent" name="channels" type="select"
              value={(c?.channels ?? ['whatsapp', 'email']).join(',')}
              options={[
                { v: 'whatsapp,email', t: 'WhatsApp and email' },
                { v: 'email', t: 'Email only' },
                { v: 'whatsapp', t: 'WhatsApp only' },
              ]} />
            <Field label="The final interview waits for the pitch" name="gateFinal" type="select"
              value={c?.gateFinal === false ? '0' : '1'} className="wide"
              options={[
                { v: '1', t: 'Yes — a requisition that runs a pitch cannot book its final until it is scored' },
                { v: '0', t: 'No — the final can be booked either way' },
              ]}
              help="This is the rule that stops a panel meeting somebody nobody has seen sell." />
          </div>

          <div className="divider"><span className="t-over">WhatsApp</span></div>
          <div className="form">
            <Field label="Message" name="waTemplate" type="textarea" rows={6} className="wide"
              value={c?.waTemplate ?? ''} />
          </div>

          <div className="divider"><span className="t-over">E-mail</span></div>
          <div className="form">
            <Field label="Subject" name="emailSubject" className="wide" value={c?.emailSubject ?? ''} />
            <Field label="Body" name="emailBody" type="textarea" rows={12} className="wide"
              value={c?.emailBody ?? ''} />
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="pp.cfgSave">Save the wording</Btn>
        </>
      ),
    };
  },

  /* ── A notified team ──────────────────────────────────────────────────── */
  'tm.add': async () => {
    const ds = await depts();
    return {
      title: 'A team to tell',
      aria: 'New notified team',
      eyebrow: 'Onboarding',
      sub: 'Who hears when somebody joins, and who receives the joiner file. A team with no '
        + 'contacts is a team nobody actually tells, so add at least one address.',
      body: <TeamNotifyForm ds={ds} />,
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="tm.teamSave">Add the team</Btn>
        </>
      ),
    };
  },

  'tm.edit': async (v) => {
    const [t] = await db().select().from(notifiedTeams).where(eq(notifiedTeams.id, v)).limit(1);
    if (!t) return null;
    const [ds, contacts] = await Promise.all([
      depts(),
      db().select().from(notifiedTeamContacts)
        .where(eq(notifiedTeamContacts.teamId, v))
        .orderBy(asc(notifiedTeamContacts.sortOrder)),
    ]);
    return {
      title: t.name,
      aria: 'Edit notified team',
      eyebrow: 'Onboarding',
      sub: `${contacts.length} contact${contacts.length === 1 ? '' : 's'}${
        contacts.length ? ` — ${(contacts.find((c) => c.isPrimary) ?? contacts[0]).name} leads` : ''}.`,
      body: <TeamNotifyForm t={t} ds={ds} contacts={contacts} />,
      foot: (
        <>
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="tm.teamSave" v={v}>Save</Btn>
        </>
      ),
    };
  },

  /* ── A step on an approval chain ──────────────────────────────────────── */
  'apf.stepEdit': async (v) => {
    /* `flowId` on its own opens a new step; `flowId|stepId` edits one. */
    const [flowId, stepId] = v.split('|');
    const [flow] = await db().select().from(approvalFlows)
      .where(eq(approvalFlows.id, flowId)).limit(1);
    if (!flow) return null;
    const [step] = stepId
      ? await db().select().from(approvalFlowSteps).where(eq(approvalFlowSteps.id, stepId)).limit(1)
      : [];
    const people = await db().select({ id: staff.id, name: staff.name, title: staff.title })
      .from(staff).where(sql`${staff.status} = 'active'`).orderBy(asc(staff.name));

    return {
      title: step ? 'Edit the step' : 'Add a step',
      aria: 'Approval step',
      eyebrow: flow.name,
      sub: 'Each step names one approver. A conditional step only appears when the condition holds — '
        + 'which is how Finance joins the chain on a big package and stays off a small one.',
      body: (
        <div className="form">
          <Field label="What this step is called" name="label" req className="wide"
            value={step?.label ?? ''} placeholder="e.g. Head of TA" />
          <Field label="Who approves it" name="approverType" type="select"
            value={step?.approverType ?? 'role'}
            options={[
              { v: 'role', t: 'Whoever holds a role' },
              { v: 'staff', t: 'A named member of the TA team' },
              { v: 'person', t: 'Somebody outside the team, by name' },
            ]} />
          <Field label="The role" name="approverRole" type="select"
            value={step?.approverRole ?? 'tal_lead'} options={APPROVER_ROLES}
            help="Used when the step is approved by a role." />
          <Field label="The person" name="approverStaffId" type="select"
            value={step?.approverStaffId ?? ''}
            options={[
              { v: '', t: 'Nobody in particular' },
              ...people.map((p) => ({ v: p.id, t: `${p.name}${p.title ? ` — ${p.title}` : ''}` })),
            ]} />
          <Field label="Name" name="approverName" value={step?.approverName ?? ''}
            placeholder="For somebody outside the TA team" />
          <Field label="Title" name="approverTitle" value={step?.approverTitle ?? ''} />
          <Field label="Email" name="approverEmail" type="email" value={step?.approverEmail ?? ''}
            help="Where the approval request is sent." />

          <div className="divider wide"><span className="t-over">Only when</span></div>
          <Field label="Condition" name="condField" type="select" value={step?.condField ?? ''}
            options={[
              { v: '', t: 'Always — this step is on every chain' },
              { v: 'totalMonthly', t: 'The total monthly package is over…' },
              { v: 'baseMonthly', t: 'The basic is over…' },
              { v: 'openings', t: 'The requisition has more openings than…' },
              { v: 'budgeted', t: 'The requisition is outside the plan' },
            ]} />
          <Field label="Threshold" name="condValue" type="number" min={0} step={500}
            value={step?.condValue ?? ''}
            help="In SAR for a package, a count for openings, ignored otherwise." />
          <Field label="Recorded automatically" name="auto" type="select"
            value={step?.auto ? '1' : '0'} className="wide"
            options={[
              { v: '0', t: 'No — somebody has to approve it' },
              { v: '1', t: 'Yes — the person who raised it has already agreed' },
            ]}
            help="The hiring manager’s own step on their own requisition is the usual case." />
        </div>
      ),
      foot: (
        <>
          {step && (
            <Btn variant="danger" action="apf.stepRemove" v={step.id} icon="trash" iconSize={13}>
              Remove
            </Btn>
          )}
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="apf.stepSave" v={step ? `${flowId}|${step.id}` : flowId}>
            Save the step
          </Btn>
        </>
      ),
    };
  },

  /* ── Who can sign in ──────────────────────────────────────────────────── */
  'acc.invite': async (_v, { viewer }) => {
    if (!viewer.isAdmin) {
      return {
        title: 'Invite somebody',
        aria: 'Invite an account',
        body: (
          <Banner tone="warn" icon="lock" title="Only an Admin invites an account"
            body="Access is what everything else is checked against, so it is one desk’s decision." />
        ),
      };
    }
    return {
      title: 'Invite somebody to sign in',
      aria: 'Invite an account',
      eyebrow: 'Access',
      sub: 'A hiring manager sees their own requisitions and the candidates on them. A participant '
        + 'sees only what they are asked to do — a scorecard, an approval — and nothing else.',
      body: (
        <div className="form">
          <Field label="Full name" name="name" req className="wide" placeholder="e.g. Saud Al-Harbi" />
          <Field label="Work email" name="email" type="email" className="wide"
            placeholder="first.last@bayut.sa"
            help="Left blank, it is derived from the name. This is where the invitation goes." />
          <Field label="Title" name="title" placeholder="e.g. Regional Sales Manager" />
          <Field label="What they are" name="role" type="select" value="hiring_manager"
            options={[
              { v: 'hiring_manager', t: 'Hiring manager' },
              { v: 'participant', t: 'Participant — panel member or approver only' },
            ]} />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="acc.inviteSave" icon="uplus" iconSize={14}>Send the invitation</Btn>
        </>
      ),
    };
  },

  /* ── What that account may see ────────────────────────────────────────── */
  'acc.scope': async (v, { viewer }) => {
    const [a] = await db().select().from(accounts).where(eq(accounts.id, v)).limit(1);
    if (!a) return null;
    if (!viewer.isAdmin) {
      return {
        title: 'Access',
        aria: 'Account scope',
        body: (
          <Banner tone="warn" icon="lock" title="Only an Admin changes what an account sees"
            body="This is the rule every query and every command is checked against." />
        ),
      };
    }

    const open = rowsOf(await db().execute(sql`
      SELECT id, title, status::text AS status FROM ${jobs}
       WHERE status IN ('open','pending_approval','on_hold') ORDER BY title`)) as
      Array<{ id: string; title: string; status: string }>;
    const chosen = new Set(a.scopeJobIds ?? []);

    return {
      title: `What ${a.name} sees`,
      aria: 'Account scope',
      eyebrow: a.email ?? 'Access',
      wide: true,
      sub: 'This is applied to every query and every command on the server. It is not a matter of '
        + 'which buttons are drawn — an account outside a requisition cannot reach it by knowing '
        + 'its address either.',
      body: (
        <>
          <div className="form">
            <Field label="Scope" name="kind" type="select" value={a.scopeKind ?? 'own'}
              className="wide" action="acc.scopeKind"
              options={[
                { v: 'all', t: 'Every requisition' },
                { v: 'own', t: 'The requisitions they are the hiring manager on' },
                { v: 'jobs', t: 'Only the requisitions picked below' },
              ]} />
            <Field label="And the ones they are named on" name="own" type="select"
              value={a.scopeOwn === false ? '0' : '1'} className="wide"
              options={[
                { v: '1', t: 'Yes — the ones picked below, and their own' },
                { v: '0', t: 'No — only what is picked below' },
              ]}
              help="Only applies when the scope is a picked list." />
          </div>
          <div className="divider"><span className="t-over">Requisitions</span></div>
          <div className="wrap">
            {open.map((j) => (
              <label className="chip" key={j.id}>
                <input type="checkbox" name="jobIds" value={j.id} defaultChecked={chosen.has(j.id)} />
                {j.title}
              </label>
            ))}
          </div>
          <p className="t-foot" style={{ marginTop: 8 }}>
            <Icon name="shield" size={12} /> A requisition that closes stays reachable to whoever
            could already see it, so their history does not vanish.
          </p>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="acc.reset" v={v} icon="key" iconSize={13}>
            Reset their password
          </Btn>
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="acc.scopeSave" v={v}>Save the scope</Btn>
        </>
      ),
    };
  },
});

/* ── The two forms shared between a new one and an edit ─────────────────── */

function ProjectForm({ p }: {
  p?: {
    name: string; who: string | null; client: string | null; brief: string; task: string;
    durationMin: number; prepHours: number;
    criteria: Array<{ key: string; name: string; hint?: string; max: number }>;
  } | null;
}) {
  const criteria = p?.criteria?.length ? p.criteria : [
    { key: 'c1', name: '', hint: '', max: 5 },
    { key: 'c2', name: '', hint: '', max: 5 },
    { key: 'c3', name: '', hint: '', max: 5 },
    { key: 'c4', name: '', hint: '', max: 5 },
  ];
  return (
    <>
      <div className="form">
        <Field label="Project" name="pp_name" req className="wide" value={p?.name ?? ''}
          placeholder="e.g. Sedra — Phase 4, Riyadh" />
        <Field label="Who they pitch to" name="pp_who" value={p?.who ?? ''}
          placeholder="e.g. A family buying their first home" />
        <Field label="Client" name="pp_client" value={p?.client ?? ''}
          placeholder="e.g. Roshn" />
        <Field label="How long" name="pp_dur" type="number" min={5} max={120}
          value={p?.durationMin ?? 20} help="Minutes." />
        <Field label="Preparation time" name="pp_prep" type="number" min={1} max={168}
          value={p?.prepHours ?? 24} help="Hours between the brief and the pitch." />
        <Field label="The brief" name="pp_brief" type="textarea" rows={5} req className="wide"
          value={p?.brief ?? ''}
          placeholder="What the candidate is told about the project — location, price, what is selling." />
        <Field label="The task" name="pp_task" type="textarea" rows={3} req className="wide"
          value={p?.task ?? ''}
          placeholder="What they are asked to do in the call." />
      </div>
      <div className="divider"><span className="t-over">What it is scored on</span></div>
      <p className="t-foot" style={{ margin: '-4px 0 10px' }}>
        Four criteria is usual. Each is scored out of the maximum you set, and the total is what the
        panel reads.
      </p>
      <div className="form">
        {criteria.map((c, i) => (
          <React.Fragment key={i}>
            <Field label={`Criterion ${i + 1}`} name={`pp_c${i}`} value={c.name}
              placeholder={i === 0 ? 'e.g. Product knowledge' : ''} />
            <Field label="What good looks like" name={`pp_h${i}`} value={c.hint ?? ''}
              placeholder="A line for whoever scores it" />
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

function TeamNotifyForm({ t, ds, contacts }: {
  t?: {
    key: string; short: string; name: string; deptId: string | null;
    purpose: string | null; ask: string | null; onJoining: boolean; onFile: boolean;
  } | null;
  ds: Array<{ id: string; name: string }>;
  contacts?: Array<{ id: string; name: string; email: string; isPrimary: boolean }>;
}) {
  return (
    <>
      <div className="form">
        <Field label="Team" name="name" req className="wide" value={t?.name ?? ''}
          placeholder="e.g. IT — Service Desk" />
        <Field label="Short name" name="short" req value={t?.short ?? ''} placeholder="e.g. IT" />
        <Field label="Key" name="key" value={t?.key ?? ''} placeholder="e.g. it"
          help="Used by the automations; left blank it is taken from the short name." />
        <Field label="Department" name="deptId" type="select" value={t?.deptId ?? ''}
          options={[{ v: '', t: 'Not a department on the plan' }, ...ds.map((d) => ({ v: d.id, t: d.name }))]} />
        <Field label="What they do with it" name="purpose" className="wide" value={t?.purpose ?? ''}
          placeholder="e.g. Laptop, accounts and the desk phone" />
        <Field label="What they need from us" name="ask" className="wide" value={t?.ask ?? ''}
          placeholder="e.g. Start date, title and location, five working days ahead" />
      </div>
      <div className="divider"><span className="t-over">When they hear</span></div>
      <div className="form">
        <Field label="On the joining notice" name="onJoining" type="select"
          value={t?.onJoining === false ? '0' : '1'}
          options={[
            { v: '1', t: 'Yes — told when the joining date is confirmed' },
            { v: '0', t: 'No' },
          ]} />
        <Field label="Receives the joiner file" name="onFile" type="select"
          value={t?.onFile ? '1' : '0'}
          options={[
            { v: '1', t: 'Yes — the documents and the details, once they are in' },
            { v: '0', t: 'No' },
          ]} />
      </div>
      {!!contacts?.length && (
        <>
          <div className="divider"><span className="t-over">Who is written to</span></div>
          <div className="list flush">
            {contacts.map((c) => (
              <Li key={c.id} icon="mail" title={c.name} sub={c.email}
                right={c.isPrimary ? <Chip tone="brand">Lead</Chip> : undefined} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
