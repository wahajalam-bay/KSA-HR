import 'server-only';
import * as React from 'react';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Exec } from '@/db/client';
import {
  departments, locations, pipelines, stages, jobStages, jobSkills, jobQuestions,
  jobHiringManagers, questionBank, employees, jobs, staff, pitchProjects,
} from '@/db/schema';
import { Field } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SHARED FORM BLOCKS

   Several sheets ask the same questions — which department, who the hiring
   manager is, what the budget line says, what the description reads, how the
   position gets filled, which stages the loop runs, what the bar is. In the
   prototype each of those was a string helper on Admin, Src or Skills, shared
   between the new-requisition sheet and the editor so the two could never drift.

   Here they are server components with the same field names, which is what
   matters: the command on the other side reads those names, so a block used on
   a new sheet tomorrow writes to the same place without anybody wiring it up.
   ═════════════════════════════════════════════════════════════════════════════*/

/* ── Department ─────────────────────────────────────────────────────────── */

export async function depts(exec: Exec = db()) {
  return exec.select({
    id: departments.id, name: departments.name, head: departments.head,
    headTitle: departments.headTitle,
  }).from(departments).where(isNull(departments.archivedAt))
    .orderBy(asc(departments.sortOrder), asc(departments.name));
}

export async function DeptField({ value, req, help, action = 'hm.dept', className }: {
  value?: string | null; req?: boolean; help?: React.ReactNode; action?: string; className?: string;
}) {
  const ds = await depts();
  const gone = value && !ds.some((d) => d.id === value);
  return (
    <Field label="Department" name="deptId" type="select" req={req} value={value ?? ''}
      action={action} className={className}
      options={[
        { v: '', t: 'Select a department…' },
        ...ds.map((d) => ({ v: d.id, t: `${d.name}${d.head ? ` — ${d.head}` : ''}` })),
        ...(gone ? [{ v: value!, t: 'That department has been archived' }] : []),
      ]}
      help={help ?? 'The team the hire sits in — its members become the hiring-manager list.'} />
  );
}

/* ── Hiring manager ─────────────────────────────────────────────────────── */

/** Who a department can put forward: its head, its people, and anybody already
    named as a hiring manager on one of its requisitions. Ranked the way the
    prototype ranked them — the head, then the seniors, then everybody else. */
export async function membersOf(deptId: string, exec: Exec = db()) {
  if (!deptId) return [] as Array<{ name: string; title: string }>;
  const [dept] = await exec.select().from(departments).where(eq(departments.id, deptId)).limit(1);
  if (!dept) return [];

  const rank = (title: string, name: string) =>
    (name === dept.head ? 0
      : /head|director|chief|general manager/i.test(title) ? 1
        : /manager|lead|supervisor|principal/i.test(title) ? 2 : 3);

  const out: Array<{ name: string; title: string; rank: number }> = [];
  const push = (name: string | null, title: string | null) => {
    if (!name || out.some((x) => x.name === name)) return;
    out.push({ name, title: title ?? '', rank: rank(title ?? '', name) });
  };

  push(dept.head, dept.headTitle ?? `Head of ${dept.name}`);
  const people = await exec.select({ name: employees.name, title: employees.title })
    .from(employees).where(and(eq(employees.deptId, deptId), sql`${employees.status} <> 'left'`));
  for (const e of people) push(e.name, e.title);
  const hms = rowsOf(await exec.execute(sql`
    SELECT h.name, h.title FROM ${jobHiringManagers} h
      JOIN ${jobs} j ON j.id = h.job_id
     WHERE j.dept_id = ${deptId}`)) as Array<{ name: string; title: string | null }>;
  for (const h of hms) push(h.name, h.title);

  return out.sort((a, b) => `${a.rank}|${a.name}`.localeCompare(`${b.rank}|${b.name}`))
    .map(({ name, title }) => ({ name, title }));
}

/** The hiring-manager control: a list of that department's people, and a
    free-text box that appears when the answer is not on the list. */
export async function HmField({ value, deptId, req, help, className }: {
  value?: string | null; deptId?: string | null; req?: boolean;
  help?: React.ReactNode; className?: string;
}) {
  const ms = await membersOf(deptId ?? '');
  const known = !value || ms.some((m) => m.name === value);
  return (
    <div className={`field ${className ?? ''}`} data-hm>
      <label htmlFor="f_hmPick">Hiring manager{req && ' *'}</label>
      <select className="inp" id="f_hmPick" name="hmPick" data-act="hm.pick"
        defaultValue={known ? (value ?? '') : '__other'}>
        <option value="">
          {deptId ? (ms.length ? 'Select a member…' : 'Nobody on the books here yet') : 'Pick a department first'}
        </option>
        {ms.map((m) => (
          <option key={m.name} value={m.name}>{m.name}{m.title ? ` — ${m.title}` : ''}</option>
        ))}
        <option value="__other">Someone else — type a name</option>
      </select>
      <input className="inp" id="f_hiringManager" name="hiringManager" placeholder="Full name"
        defaultValue={value ?? ''} hidden={known} style={{ marginTop: 8 }} />
      <span className="help">
        {help ?? 'Pick a department above, then the person in it who owns this hire — or “Someone else” to type a name.'}
      </span>
    </div>
  );
}

export async function HmExtraField({ jobId }: { jobId?: string | null }) {
  const rows = jobId
    ? await db().select().from(jobHiringManagers)
      .where(and(eq(jobHiringManagers.jobId, jobId), eq(jobHiringManagers.isLead, false)))
      .orderBy(asc(jobHiringManagers.sortOrder))
    : [];
  return (
    <Field label="More hiring managers (one per line, “Name — Title”)" name="hiringManagersExtra"
      type="textarea" rows={3} className="wide"
      value={rows.map((h) => (h.title ? `${h.name} — ${h.title}` : h.name)).join('\n')}
      placeholder="e.g. Saud Al-Harbi — Regional Sales Manager"
      help="Anyone here can be picked to run an interview when it is arranged." />
  );
}

/* ── Budget ─────────────────────────────────────────────────────────────── */

export function BudgetFields({ budgeted, budgetNote }: {
  budgeted?: boolean | null; budgetNote?: string | null;
}) {
  return (
    <>
      <Field label="Budget" name="budgeted" type="select" value={budgeted === false ? '0' : '1'}
        action="job.budget"
        options={[
          { v: '1', t: 'Budgeted — in the approved headcount plan' },
          { v: '0', t: 'Not budgeted — an addition to the plan' },
        ]}
        help="Whether the seat is already funded in this year’s plan." />
      <Field label="Justification" name="budgetNote" type="textarea" rows={3} className="wide"
        value={budgetNote ?? ''}
        placeholder="Why this hire is needed outside the plan — the business case, the cost and where it is funded from."
        help="Required when the requisition is not budgeted; Finance and the GM read it on the approval." />
    </>
  );
}

/* ── Job description ────────────────────────────────────────────────────── */

export type Jd = {
  summary?: string | null; responsibilities?: string[] | null;
  requirements?: string[] | null; benefits?: string[] | null;
};

export function JdFields({ d }: { d?: Jd }) {
  return (
    <>
      <Field label="Summary" name="desc_summary" type="textarea" rows={3} className="wide"
        value={d?.summary ?? ''}
        placeholder="Two or three sentences on the role and the team." />
      <Field label="Responsibilities (one per line)" name="desc_responsibilities" type="textarea"
        rows={6} className="wide" value={(d?.responsibilities ?? []).join('\n')} />
      <Field label="Requirements (one per line)" name="desc_requirements" type="textarea"
        rows={5} className="wide" value={(d?.requirements ?? []).join('\n')} />
      <Field label="Benefits (one per line)" name="desc_benefits" type="textarea" rows={4}
        className="wide" value={(d?.benefits ?? []).join('\n')}
        placeholder="e.g. Medical insurance for you and your dependants" />
    </>
  );
}

/* ── How the position gets filled ───────────────────────────────────────── */

export const SOURCE_ROUTES = [
  {
    key: 'internal', name: 'Internal hiring', icon: 'users' as const,
    blurb: 'Bayut people first — the internal board and referrals from the team.',
    sources: ['Internal Mobility', 'Referral'],
  },
  {
    key: 'hunt', name: 'Private hunting', icon: 'search' as const,
    blurb: 'Not advertised anywhere. The desk goes and finds them — outbound, an agency brief, the talent pool.',
    sources: ['Sourced — Outbound', 'Agency', 'Talent Pool'],
  },
  {
    key: 'linkedin', name: 'LinkedIn company page', icon: 'ext' as const,
    blurb: 'Published on the Bayut page and open to everybody; the careers site and the boards ride with it.',
    sources: ['LinkedIn', 'Bayut Careers', 'Bayt.com', 'Job Fair'],
  },
] as const;

const listOf = (xs: string[]) =>
  (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function SourcingBlock({ job, counts }: {
  job?: {
    id?: string; sourcingInternal?: boolean; sourcingHunt?: boolean;
    sourcingLinkedin?: boolean; sourcingNote?: string | null;
  } | null;
  counts?: Record<string, { n: number; live: number }>;
}) {
  const on: Record<string, boolean> = job
    ? {
      internal: !!job.sourcingInternal, hunt: !!job.sourcingHunt,
      linkedin: !!job.sourcingLinkedin,
    }
    : { internal: false, hunt: false, linkedin: true };
  const picked = SOURCE_ROUTES.filter((r) => on[r.key]);

  return (
    <div className="srcbox" id="srcbox" data-job={job?.id ?? ''}>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <span className="t-foot">
          How this position gets filled. More than one is fine — internal first and LinkedIn a
          fortnight later is a normal way to run it. Everyone who applies by any of them lands on
          the same board.
        </span>
      </div>
      <div className="srcrows">
        {SOURCE_ROUTES.map((r) => {
          const c = counts?.[r.key];
          return (
            <label key={r.key} className={`srcrow${on[r.key] ? ' on' : ''}`} data-k={r.key}>
              <input type="checkbox" name={`src_${r.key}`} defaultChecked={on[r.key]}
                data-act="job.srcToggle" data-v={r.key} />
              <span className="srcic"><Icon name={r.icon} size={15} /></span>
              <span className="srcbd"><b>{r.name}</b><em>{r.blurb}</em></span>
              {!!c?.n && (
                <span className={`chip${c.live ? ' info' : ''}`}>
                  {c.n} applied{c.live ? ` · ${c.live} live` : ''}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <Field label="Note for the desk" name="srcNote" className="wide"
        value={job?.sourcingNote ?? ''}
        placeholder="e.g. Do not post — the incumbent does not know yet."
        help="Shown on the requisition and on the board, so nobody advertises something they should not." />
      <div className="srcwarn" id="srcwarn">
        {!picked.length ? (
          <span className="bad-t t-foot">
            <Icon name="alert" size={12} /> Pick at least one — a requisition nobody is filling is
            not a requisition.
          </span>
        ) : picked.length === 1 && picked[0].key === 'hunt' ? (
          <span className="t-foot">
            <Icon name="shield" size={12} /> Confidential: this requisition is not advertised
            anywhere. It is marked on the board and cannot be posted to LinkedIn.
          </span>
        ) : (
          <span className="t-foot">
            <Icon name="check" size={12} /> Candidates will arrive from{' '}
            {listOf(picked.flatMap((r) => [...r.sources]))}.
          </span>
        )}
      </div>
    </div>
  );
}

/* ── The interview workflow ─────────────────────────────────────────────── */

/* The spine never reorders. These six are the recruiter's to pick; the other
   four — applied, sourced, offer, joined — are on every requisition there is. */
export const PICKABLE = ['screen', 'assessment', 'iv1', 'iv2', 'pitch', 'ivf'] as const;

const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
const IV_KEYS = ['iv1', 'iv2', 'ivf'];
const isOrdinal = (n: string) => /^\s*(1st|2nd|3rd|4th|5th)\s+Interview\s*$/i.test(n);

/** The rows the workflow block shows: the spine's six optional stages, each
    ticked or not, named, and with the days it is allowed. Interview rounds are
    numbered by where they fall in *this* loop — drop the middle one and what
    was the third becomes the second — unless somebody typed a name of their
    own, which is left exactly as typed. */
export async function workflowRows(
  jobId: string | null, pipelineId: string | null, exec: Exec = db(),
) {
  const spine = await exec.select().from(stages).orderBy(asc(stages.ordinal));
  const spineOf = Object.fromEntries(spine.map((s) => [s.key, s]));

  let on = new Set<string>(PICKABLE);
  const names: Record<string, string> = {};
  const slas: Record<string, number> = {};

  if (jobId) {
    const own = await exec.select().from(jobStages).where(eq(jobStages.jobId, jobId));
    on = new Set(own.map((s) => s.stageKey));
    for (const s of own) { names[s.stageKey] = s.name; slas[s.stageKey] = s.sla; }
  } else if (pipelineId) {
    const [pipe] = await exec.select().from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);
    if (pipe) {
      on = new Set(PICKABLE.filter((k) => !pipe.offStages.includes(k)));
      Object.assign(names, pipe.labels);
      Object.assign(slas, pipe.slaOverrides);
    }
  }

  let n = 0;
  return PICKABLE.map((key) => {
    const st = spineOf[key];
    const isOn = on.has(key);
    let name = names[key] || st?.name || key;
    if (IV_KEYS.includes(key)) {
      if (isOn) n += 1;
      if (isOrdinal(name)) name = `${ORD[n - 1] ?? `${n}th`} Interview`;
    }
    return { key, spine: st?.name ?? key, name, sla: slas[key] ?? st?.defaultSla ?? 3, on: isOn };
  });
}

export async function WorkflowBlock({ jobId, pipelineId, counts, projects, pitch }: {
  jobId?: string | null; pipelineId?: string | null;
  counts?: Record<string, number>;
  projects?: Array<{ id: string; name: string }>;
  pitch?: { projectId?: string | null; channels?: string[]; leadHours?: number | null; note?: string | null };
}) {
  const rows = await workflowRows(jobId ?? null, pipelineId ?? null);
  const pitchOn = rows.find((r) => r.key === 'pitch')?.on;

  return (
    <div className="wfbox wide" id="wfbox" data-job={jobId ?? ''}>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <span className="t-foot">
          The spine never reorders. Tick the stages this position runs, rename them to what the
          panel calls them, and set how many days each may take.
        </span>
        <span className="push" />
        {(jobId || pipelineId) && (
          <button className="btn xs ghost" type="button" data-act="job.wfTemplate"
            data-v={pipelineId ?? ''} title="Put the template’s stages back">
            <Icon name="refresh" size={11} /> Reset to the template
          </button>
        )}
      </div>
      <div className="wfrows">
        {rows.map((r) => (
          <React.Fragment key={r.key}>
            <div className={`wfrow${r.on ? ' on' : ''}`} data-k={r.key}>
              <label className="tchk">
                <input type="checkbox" name={`wf_on_${r.key}`} defaultChecked={r.on}
                  data-act="job.wfToggle" data-v={r.key} />
                <b>{r.spine}</b>
              </label>
              <input className="inp sm" name={`wf_name_${r.key}`} defaultValue={r.name}
                placeholder={r.spine} aria-label="What this stage is called" />
              <span className="wfsla">
                <input className="inp sm" type="number" min={1} max={30} name={`wf_sla_${r.key}`}
                  defaultValue={r.sla} aria-label="Days allowed" />
                <em>days</em>
              </span>
              {!!counts?.[r.key] && (
                <span className="chip warn" title="Live candidates on this stage">
                  {counts[r.key]} on it
                </span>
              )}
            </div>
            {r.key === 'pitch' && (
              <div className="wfsub" id="wfsub_pitch" hidden={!pitchOn}>
                <div className="form">
                  <Field label="Project the candidate pitches" name="pitchProjectId" type="select"
                    className="wide" value={pitch?.projectId ?? ''}
                    options={[
                      { v: '', t: 'Pick a project…' },
                      ...(projects ?? []).map((p) => ({ v: p.id, t: p.name })),
                    ]}
                    help="Set under Settings → Sales pitch. The brief goes out with the invitation." />
                  <Field label="Preparation time" name="pitchLeadHours" type="number" min={1} max={168}
                    value={pitch?.leadHours ?? 24}
                    help="Hours between the brief going out and the pitch." />
                  <Field label="How the brief is sent" name="pitchChannels" type="select"
                    value={(pitch?.channels ?? ['whatsapp', 'email']).join(',')}
                    options={[
                      { v: 'whatsapp,email', t: 'WhatsApp and email' },
                      { v: 'email', t: 'Email only' },
                      { v: 'whatsapp', t: 'WhatsApp only' },
                    ]} />
                  <Field label="Note for the candidate" name="pitchNote" className="wide"
                    value={pitch?.note ?? ''} placeholder="Optional — goes out with the brief" />
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="wfprev" id="wfprev">
        <span className="t-foot">
          Applied → {rows.filter((r) => r.on).map((r) => r.name).join(' → ')} → Offer → Joined
        </span>
      </div>
    </div>
  );
}

/* ── The skill bar ──────────────────────────────────────────────────────── */

const LVL_SHORT = ['Exposure', 'Working knowledge', 'Unsupervised', 'Strong', 'Sets the standard'];
const LVL_OPTS = LVL_SHORT.map((t, i) => ({ v: String(i + 1), t: `${i + 1} — ${t}` }));

export type BarRow = { skill: string; level: number; must: boolean };

/** What this family of roles usually asks for. Nothing is invented: it is what
    the requisitions in the same family have actually asked for, most-asked
    first, and with no department picked there is nothing honest to suggest. */
export async function skillSuggestions(deptId: string | null, family: string | null, exec: Exec = db()) {
  if (!deptId && !family) return [] as string[];
  const rows = rowsOf(await exec.execute(sql`
    SELECT s.skill, count(*)::int AS n
      FROM ${jobSkills} s JOIN ${jobs} j ON j.id = s.job_id
     WHERE ${family ? sql`j.family = ${family}` : sql`j.dept_id = ${deptId}`}
     GROUP BY s.skill ORDER BY n DESC, s.skill LIMIT 24`)) as Array<{ skill: string; n: number }>;
  if (rows.length || !deptId) return rows.map((r) => r.skill);
  const byDept = rowsOf(await exec.execute(sql`
    SELECT s.skill, count(*)::int AS n
      FROM ${jobSkills} s JOIN ${jobs} j ON j.id = s.job_id
     WHERE j.dept_id = ${deptId}
     GROUP BY s.skill ORDER BY n DESC, s.skill LIMIT 24`)) as Array<{ skill: string; n: number }>;
  return byDept.map((r) => r.skill);
}

export async function barFor(jobId: string, exec: Exec = db()): Promise<BarRow[]> {
  const rows = await exec.select().from(jobSkills).where(eq(jobSkills.jobId, jobId))
    .orderBy(asc(jobSkills.sortOrder));
  return rows.map((r) => ({ skill: r.skill, level: r.level, must: r.must }));
}

export function SkillBar({ jobId, rows, suggestions, family }: {
  jobId?: string | null; rows: BarRow[]; suggestions: string[]; family?: string | null;
}) {
  if (!jobId && !rows.length) {
    return (
      <div className="skbox" id="skbox" data-job="">
        <div className="skrowsedit" id="skrowsedit" />
        <p className="t-foot">
          <Icon name="target" size={12} /> Pick the department above and this fills in with what that
          family of roles usually asks for — then adjust it, or write your own. Every candidate on the
          requisition is drawn against it, so a requisition cannot be opened without at least one
          skill here.
        </p>
        <div className="row tight" style={{ marginTop: 8 }}>
          <button className="btn xs out" type="button" data-act="sk.barAdd">
            <Icon name="plus" size={11} /> Add a skill
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="skbox" id="skbox" data-job={jobId ?? ''}>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <span className="t-foot">
          The skills this position actually needs, and how strongly. Every candidate on the
          requisition is drawn against this — mark one essential and it counts double, and anybody
          missing it is flagged rather than averaged out.
        </span>
      </div>
      <datalist id="skopts">
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      <div className="skrowsedit" id="skrowsedit">
        {rows.map((r, i) => (
          <div className="skedit" data-i={i} key={i}>
            <label className="tchk"
              title="Essential skills count double and a candidate who misses one is flagged">
              <input type="checkbox" name={`sk_must_${i}`} defaultChecked={r.must}
                data-act="sk.barChange" />
              <b>Essential</b>
            </label>
            <input className="inp sm" name={`sk_name_${i}`} defaultValue={r.skill} list="skopts"
              placeholder="Name the skill" aria-label="Skill" data-act="sk.barChange" data-live />
            <select className="inp sm" name={`sk_lvl_${i}`} defaultValue={String(r.level)}
              aria-label="Level the description asks for" data-act="sk.barChange">
              {LVL_OPTS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
            <button className="btn xs ghost" type="button" data-act="sk.barDrop" data-v={String(i)}
              aria-label="Remove this skill"><Icon name="x" size={12} /></button>
          </div>
        ))}
      </div>
      <div className="row tight" style={{ marginTop: 8 }}>
        <button className="btn xs out" type="button" data-act="sk.barAdd">
          <Icon name="plus" size={11} /> Add a skill
        </button>
        {!!suggestions.length && (
          <>
            <span className="t-foot">Common in {family || 'this family'}:</span>
            {suggestions.slice(0, 6).map((s) => (
              <button key={s} className="btn xs ghost" type="button" data-act="sk.barAdd" data-v={s}>
                + {s}
              </button>
            ))}
          </>
        )}
      </div>
      <p className="t-foot" style={{ marginTop: 8 }}>
        1 exposure · 2 working knowledge · 3 does it unsupervised · 4 strong · 5 sets the standard.
      </p>
    </div>
  );
}

/* ── Application questions ──────────────────────────────────────────────── */

export const QTYPES: Array<[string, string]> = [
  ['yesno', 'Yes / No'], ['choice', 'Single choice'], ['multi', 'Multiple choice'],
  ['short', 'Short answer'], ['long', 'Long answer'], ['number', 'Number'],
];
export const qtypeLabel = (t: string) => (QTYPES.find((x) => x[0] === t) ?? [t, t])[1];

export async function bank(exec: Exec = db()) {
  return exec.select().from(questionBank).where(isNull(questionBank.archivedAt))
    .orderBy(asc(questionBank.sortOrder), asc(questionBank.id));
}

const shorten = (s: string) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

/** The bank as a row of tick-chips. A requisition's own questions come back
    from job_questions; the bank ones are matched by their bank id. */
export function QuestionChips({ rows, checked, city, id }: {
  rows: Array<{ id: string; text: string; isStandard?: boolean; families?: string[] }>;
  checked: Set<string>; city?: string; id?: string;
}) {
  return (
    <div className="wrap" id={id}>
      {rows.map((q) => (
        <label className="chip" key={q.id}>
          <input type="checkbox" name="qids" value={q.id} defaultChecked={checked.has(q.id)}
            data-fams={(q.families ?? []).join('|')} />
          {shorten(q.text.replace('{{city}}', city ?? 'the city'))}
        </label>
      ))}
    </div>
  );
}

export async function questionsOf(jobId: string, exec: Exec = db()) {
  return exec.select().from(jobQuestions).where(eq(jobQuestions.jobId, jobId))
    .orderBy(asc(jobQuestions.ordinal));
}

/** The question form, shared by the bank editor and the per-requisition one. */
export function QuestionForm({ q }: {
  q?: {
    text?: string; type?: string; required?: boolean | null;
    options?: string[] | null; knockout?: string | null;
  } | null;
}) {
  return (
    <div className="form">
      <Field label="Question" name="text" value={q?.text ?? ''} req className="wide"
        placeholder="e.g. Do you hold a valid Saudi driving licence?" />
      <Field label="Answer type" name="type" type="select" value={q?.type ?? 'yesno'}
        options={QTYPES.map(([v, t]) => ({ v, t }))} />
      <Field label="Required" name="required" type="select" value={q?.required === false ? '0' : '1'}
        options={[{ v: '1', t: 'Required' }, { v: '0', t: 'Optional' }]} />
      <Field label="Options (one per line, for choice types)" name="options" type="textarea" rows={3}
        className="wide" value={(q?.options ?? []).join('\n')} />
      <Field label="Knockout — flag unless the answer is" name="knockout" value={q?.knockout ?? ''}
        placeholder="e.g. Yes (leave empty for none)" />
    </div>
  );
}

/* ── Odds and ends several sheets want ──────────────────────────────────── */

export async function allLocations(exec: Exec = db()) {
  return exec.select({ id: locations.id, city: locations.city }).from(locations).orderBy(asc(locations.city));
}

export async function allPipelines(exec: Exec = db()) {
  return exec.select({ id: pipelines.id, name: pipelines.name }).from(pipelines)
    .where(isNull(pipelines.archivedAt))
    .orderBy(asc(pipelines.sortOrder), asc(pipelines.name));
}

export async function desk(exec: Exec = db()) {
  return exec.select({ id: staff.id, name: staff.name, title: staff.title, role: staff.role })
    .from(staff).where(sql`${staff.status} = 'active'`).orderBy(asc(staff.name));
}

export async function activeProjects(exec: Exec = db()) {
  return exec.select({ id: pitchProjects.id, name: pitchProjects.name }).from(pitchProjects)
    .where(eq(pitchProjects.active, true)).orderBy(asc(pitchProjects.name));
}

/** The jump bar at the top of a long sheet. */
export function JumpBar({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="jumpbar">
      {items.map(([id, t]) => (
        <button key={id} className="btn xs ghost" type="button" data-act="job.jump" data-v={id}>{t}</button>
      ))}
    </div>
  );
}

export function Divider({ id, children }: { id?: string; children: React.ReactNode }) {
  return <div className="divider" id={id}><span className="t-over">{children}</span></div>;
}
