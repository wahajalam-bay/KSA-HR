import 'server-only';
import * as React from 'react';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  jobs, jobStages, jobQuestions, jobHiringManagers, positions, departments, applications,
} from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { requireJob } from '@/lib/authz';
import { nextCode } from '@/lib/services/manpower';
import {
  DeptField, HmField, HmExtraField, BudgetFields, JdFields, SourcingBlock, WorkflowBlock,
  SkillBar, QuestionChips, QuestionForm, JumpBar, Divider,
  allLocations, allPipelines, activeProjects, barFor, bank, desk, depts, questionsOf,
  skillSuggestions, qtypeLabel,
} from './blocks';

/* ═════════════════════════════════════════════════════════════════════════════
   THE REQUISITION SHEETS

   Opening one, editing it, and the four smaller sheets that hang off the
   details page: the description, the hiring team, the skill bar and a question
   asked on the careers form.

   The new-requisition sheet and the editor are the same questions in the same
   order, which is deliberate: what you set when the role is opened is what you
   come back and change, and a recruiter who has filled one in has filled in the
   other. The blocks they share live in ./blocks.
   ═════════════════════════════════════════════════════════════════════════════*/

const PRIORITIES = [
  { v: 'critical', t: 'Critical' }, { v: 'high', t: 'High' },
  { v: 'normal', t: 'Normal' }, { v: 'low', t: 'Low' },
];

const EMPLOYMENT = [
  { v: 'full_time', t: 'Full time' }, { v: 'part_time', t: 'Part time' },
  { v: 'contract', t: 'Contract' }, { v: 'intern', t: 'Internship' },
];

/** The vacant seats a new requisition may hire into, plus a new coded one. */
async function seatOptions(deptId: string) {
  if (!deptId) return [{ v: 'new', t: 'Pick a department first' }];
  const rows = rowsOf(await db().execute(sql`
    SELECT p.code, p.title, p.approved,
           p.approved - (SELECT count(*)::int FROM employees e
                          WHERE e.position_code = p.code AND e.status <> 'left') AS vacant
      FROM ${positions} p
     WHERE p.dept_id = ${deptId}
       AND p.retired_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ${jobs} j
          WHERE j.position_code = p.code
            AND j.status IN ('open','pending_approval','draft','on_hold'))
     ORDER BY p.code`)) as Array<{ code: string; title: string; approved: number; vacant: number }>;
  const code = await nextCode(deptId, db());
  return [
    { v: '', t: `New position — next code ${code}` },
    ...rows.filter((p) => Number(p.vacant) > 0)
      .map((p) => ({ v: p.code, t: `${p.code} · ${p.title} (${p.vacant} vacant)` })),
  ];
}

/** How many live candidates are standing on each stage of a requisition. */
async function stageLoad(jobId: string) {
  const rows = rowsOf(await db().execute(sql`
    SELECT stage::text AS stage, count(*)::int AS n FROM ${applications}
     WHERE job_id = ${jobId} AND status IN ('active','on_hold')
     GROUP BY stage`)) as Array<{ stage: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.stage, Number(r.n)]));
}

const JUMP: Array<[string, string]> = [
  ['role', 'The role'], ['own', 'Who owns it'], ['pay', 'Pay and the plan'],
  ['src', 'How it gets filled'], ['wf', 'Interview workflow'], ['sk', 'Skills'],
  ['jd', 'Description'], ['q', 'Questions'],
];

defineSheets({
  /* ── Open one ─────────────────────────────────────────────────────────── */
  'job.new': async (v, { fields }) => {
    /* Opened from a vacant seat the department is known; opened from Create it
       is not — and nothing is chosen for you. */
    const [seat] = v
      ? await db().select().from(positions).where(eq(positions.code, v)).limit(1)
      : [];
    const deptId = fields.deptId || seat?.deptId || '';
    const [dept] = deptId
      ? await db().select().from(departments).where(eq(departments.id, deptId)).limit(1)
      : [];

    const [locs, pipes, seats, people, qbank, projects] = await Promise.all([
      allLocations(), allPipelines(), seatOptions(deptId), desk(), bank(), activeProjects(),
    ]);
    const pipelineId = fields.pipelineId || pipes[0]?.id || '';
    const family = dept ? await familyOf(dept.id) : null;
    const suggestions = await skillSuggestions(deptId || null, family);
    const bar = suggestions.slice(0, 6).map((skill, i) => ({
      skill, level: i < 2 ? 4 : 3, must: i < 3,
    }));

    const checked = new Set(
      qbank.filter((q) => q.isStandard || (dept && q.families.includes(dept.name))).map((q) => q.id),
    );

    return {
      title: 'New requisition',
      aria: 'New requisition',
      wide: true,
      sub: 'Pick the pipeline and the board is built from it — the stage spine stays fixed. '
        + 'Every requisition hires into a coded seat in the manpower plan.',
      body: (
        <>
          <div className="form">
            <Field label="Job title" name="title" req className="wide" value={seat?.title ?? ''}
              placeholder="e.g. Senior Property Consultant — Riyadh" />
            <DeptField value={deptId} req
              help="Pick the team this role sits in — the seats, the hiring managers and the suggested questions all follow from it." />
            <Field label="Position in the manpower plan" name="positionCode" type="select"
              value={seat?.code ?? ''} options={seats}
              help="A vacant seat in the department, or a new coded position approved with this requisition." />
            <HmField value={dept?.head ?? ''} deptId={deptId} req
              help="Whoever owns this hire — the department’s members are listed once a department is picked." />
            <HmExtraField />
            <Field label="Location" name="locationId" type="select"
              value={seat?.locationId ?? locs[0]?.id ?? ''}
              options={locs.map((l) => ({ v: l.id, t: l.city }))} />
            <Field label="Pipeline" name="pipelineId" type="select" value={pipelineId}
              action="job.pipeline" options={pipes.map((p) => ({ v: p.id, t: p.name }))} />
            <Field label="Openings" name="openings" type="number" value={1} min={1} />
            <Field label="Priority" name="priority" type="select" value="normal" options={PRIORITIES} />
            <Field label="Owning recruiter" name="recruiterId" type="select"
              options={people.map((s) => ({ v: s.id, t: s.name }))} />
            <Field label="Band minimum (SAR)" name="salaryMin" type="number" value={12000} step={500} />
            <Field label="Band maximum (SAR)" name="salaryMax" type="number" value={18000} step={500} />
            <BudgetFields budgeted />
          </div>

          <Divider>How it gets filled</Divider>
          <SourcingBlock job={null} />

          <Divider>Interview workflow</Divider>
          <WorkflowBlock pipelineId={pipelineId} projects={projects} />

          <Divider>Skills this position needs</Divider>
          <SkillBar rows={bar} suggestions={suggestions} family={family} />

          <Divider>Job description</Divider>
          <div className="form"><JdFields /></div>

          <Divider>Application questions</Divider>
          <p className="t-foot" style={{ margin: '-4px 0 10px' }}>
            Asked on the careers form. The standard questions are attached by default; the rest are
            suggested by the department’s job family. You can add, reorder or write your own on the
            requisition afterwards.
          </p>
          <QuestionChips id="newq" rows={qbank} checked={checked} />

          <p className="t-foot" style={{ marginTop: 8 }}>
            <Icon name="shield" size={12} /> On submission the requisition walks its approval chain.
          </p>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="out" action="job.create" v="draft">Save as draft</Btn>
          <Btn variant="pri" action="job.create" v="submit" icon="shield" iconSize={14}>
            Submit for approval
          </Btn>
        </>
      ),
    };
  },

  /* ── Edit one ─────────────────────────────────────────────────────────── */
  'job.edit': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;

    const [dept] = await db().select().from(departments)
      .where(eq(departments.id, job.deptId)).limit(1);
    const [locs, pipes, people, qbank, own, bar, load, projects, seats] = await Promise.all([
      allLocations(), allPipelines(), desk(), bank(), questionsOf(v), barFor(v),
      stageLoad(v), activeProjects(), seatOptions(job.deptId),
    ]);
    const suggestions = await skillSuggestions(job.deptId, job.family);
    const [{ live }] = rowsOf(await db().execute(sql`
      SELECT count(*)::int AS live FROM ${applications}
       WHERE job_id = ${v} AND status IN ('active','on_hold')`)) as Array<{ live: number }>;

    const checked = new Set(own.map((q) => q.bankId).filter(Boolean) as string[]);
    const mine = own.filter((q) => !q.bankId);
    const city = locs.find((l) => l.id === job.locationId)?.city;

    return {
      title: 'Edit requisition',
      aria: 'Edit requisition',
      wide: true,
      eyebrow: dept?.name,
      sub: `${job.title} — everything on this requisition, in one place. ${Number(live)
        ? `${live} candidate${Number(live) === 1 ? ' is' : 's are'} live on it, so the loop and the `
          + 'questions are changed with that in mind.'
        : 'Nobody is live on it yet.'}`,
      body: (
        <>
          <JumpBar items={JUMP} />

          <Divider id="jsec_role">The role</Divider>
          <div className="form">
            <Field label="Job title" name="title" value={job.title} className="wide" req />
            <DeptField value={job.deptId}
              help="The team this requisition hires into — its members are the hiring-manager list." />
            <Field label="Seat in the manpower plan" name="positionCode" type="select"
              value={job.positionCode ?? ''}
              options={[
                ...(job.positionCode
                  ? [{ v: job.positionCode, t: `${job.positionCode} — the seat it hires into` }]
                  : []),
                ...seats.filter((s) => s.v !== job.positionCode),
              ]}
              help={job.positionCode
                ? `Currently ${job.positionCode}.`
                : 'This requisition is not linked to a coded seat.'} />
            <Field label="Location" name="locationId" type="select" value={job.locationId}
              options={locs.map((l) => ({ v: l.id, t: l.city }))} />
            <Field label="Employment type" name="employmentType" type="select"
              value={job.employmentType} options={EMPLOYMENT} />
            <Field label="Openings" name="openings" type="number" value={job.openings} min={1}
              help={job.filled ? `${job.filled} already filled.` : ''} />
            <Field label="Priority" name="priority" type="select" value={job.priority}
              options={PRIORITIES} />
            <Field label="Pipeline template" name="pipelineId" type="select"
              value={job.pipelineId ?? ''}
              options={pipes.map((p) => ({ v: p.id, t: p.name }))}
              help={Number(live)
                ? `${live} candidate${Number(live) === 1 ? ' is' : 's are'} standing in this pipeline — `
                  + 'the template cannot change under them.'
                : 'Where the loop below came from. Changing it rewrites the loop.'} />
            <Field label="Open to remote" name="remoteOk" type="select"
              value={job.remoteOk ? '1' : '0'}
              options={[{ v: '0', t: 'On site' }, { v: '1', t: 'Remote is fine' }]} />
            <Field label="Job family" name="family" value={job.family} req
              help="What this role is counted as in the plan and in Insights." />
          </div>

          <Divider id="jsec_own">Who owns it</Divider>
          <div className="form">
            <HmField value={job.hiringManager} deptId={job.deptId} req
              help="The lead, picked from that department." />
            <HmExtraField jobId={v} />
            <Field label="Owning recruiter" name="recruiterId" type="select"
              value={job.recruiterId ?? ''}
              options={[{ v: '', t: 'Nobody assigned' }, ...people.map((s) => ({ v: s.id, t: s.name }))]} />
            <Field label="Sourcer" name="sourcerId" type="select" value={job.sourcerId ?? ''}
              options={[
                { v: '', t: 'Nobody assigned' },
                ...people.map((s) => ({ v: s.id, t: `${s.name} · ${s.title ?? ''}`.trim() })),
              ]} />
            <Field label="Coordinator" name="coordinatorId" type="select"
              value={job.coordinatorId ?? ''}
              options={[{ v: '', t: 'Nobody assigned' }, ...people.map((s) => ({ v: s.id, t: s.name }))]}
              help="Who books the interviews on this requisition." />
          </div>

          <Divider id="jsec_pay">Pay and the plan</Divider>
          <div className="form">
            <Field label="Band minimum (SAR)" name="salaryMin" type="number" value={job.salaryMin}
              step={500} />
            <Field label="Band maximum (SAR)" name="salaryMax" type="number" value={job.salaryMax}
              step={500} />
            <BudgetFields budgeted={job.budgeted} budgetNote={job.budgetNote} />
            <Field label="Target start" name="targetStartOn" type="date"
              value={job.targetStartOn ?? ''} />
          </div>

          <Divider id="jsec_src">How it gets filled</Divider>
          <SourcingBlock job={job} />

          <Divider id="jsec_wf">Interview workflow</Divider>
          <WorkflowBlock jobId={v} counts={load} projects={projects}
            pitch={{
              projectId: job.pitchProjectId, channels: job.pitchChannels,
              leadHours: job.pitchLeadHours, note: job.pitchNote,
            }} />
          <p className="t-foot" style={{ marginTop: 8 }}>
            <Icon name="alert" size={12} /> A stage with candidates standing on it is marked.
            Switching it off leaves them where they are — move them on first.
          </p>

          <Divider id="jsec_sk">Skills this position needs</Divider>
          <SkillBar jobId={v} rows={bar} suggestions={suggestions} family={job.family} />

          <Divider id="jsec_jd">Job description</Divider>
          <div className="form">
            <JdFields d={{
              summary: job.descSummary, responsibilities: job.descResponsibilities,
              requirements: job.descRequirements, benefits: job.descBenefits,
            }} />
          </div>

          <Divider id="jsec_q">Application questions</Divider>
          <p className="t-foot" style={{ margin: '-4px 0 10px' }}>
            Asked on the careers form. Untick one and it stops being asked; answers already given
            are kept on the applications that gave them.
          </p>
          <QuestionChips id="editq" rows={qbank} checked={checked} city={city} />
          {!!mine.length && (
            <>
              <div className="t-over" style={{ margin: '12px 0 6px' }}>Written for this requisition</div>
              <div className="wrap">
                {mine.map((q) => (
                  <label className="chip brand" key={q.id}>
                    <input type="checkbox" name="ownq" value={q.id} defaultChecked />
                    {q.text.length > 60 ? `${q.text.slice(0, 60)}…` : q.text}
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="job.save" v={v}>Save requisition</Btn>
        </>
      ),
    };
  },

  /* ── The description on its own ───────────────────────────────────────── */
  'jd.edit': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;
    const [dept] = await db().select().from(departments)
      .where(eq(departments.id, job.deptId)).limit(1);
    const bar = await barFor(v);

    return {
      title: `Job description — ${job.title}`,
      aria: 'Edit job description',
      wide: true,
      eyebrow: dept?.name,
      sub: 'What the careers site shows and what the panel hires against.',
      body: (
        <div className="form">
          <DeptField value={job.deptId} help="The team this requisition hires into." />
          <HmField value={job.hiringManager} deptId={job.deptId} req className="wide"
            help="The lead, picked from that department." />
          <HmExtraField jobId={v} />
          <JdFields d={{
            summary: job.descSummary, responsibilities: job.descResponsibilities,
            requirements: job.descRequirements, benefits: job.descBenefits,
          }} />
          <Field label="Skills (comma-separated)" name="skills" className="wide"
            value={bar.map((b) => b.skill).join(', ')}
            help="The bar itself — levels and essentials — is set on the requisition." />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="jd.save" v={v}>Save description</Btn>
        </>
      ),
    };
  },

  /* ── The hiring team ──────────────────────────────────────────────────── */
  'hm.add': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;

    return {
      title: 'Add a hiring manager',
      aria: 'Add hiring manager',
      eyebrow: job.title,
      sub: 'They join the hiring team and can be picked to run any interview on this requisition.',
      body: (
        <div className="form">
          <DeptField value={job.deptId}
            help="Whose team the new hiring manager sits in — change it to pick someone from another department." />
          <HmField deptId={job.deptId} req className="wide"
            help="The member of that department joining the hiring team — or “Someone else” to type a name." />
          <Field label="Title" name="hm_title" placeholder="e.g. Regional Sales Manager" />
          <Field label="Email" name="hm_email" type="email"
            placeholder="left blank, derived from the name" />
          <Field label="Role on this requisition" name="hm_lead" type="select" value="0"
            options={[
              { v: '0', t: 'Co-hiring manager' },
              { v: '1', t: 'Lead — replaces the current lead' },
            ]} />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="hm.save" v={v}>Add to the hiring team</Btn>
        </>
      ),
    };
  },

  /* ── The skill bar on its own ─────────────────────────────────────────── */
  'sk.jd': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;
    const [bar, suggestions] = await Promise.all([
      barFor(v), skillSuggestions(job.deptId, job.family),
    ]);

    return {
      title: 'The skills this position needs',
      aria: 'Skill bar',
      eyebrow: job.title,
      wide: true,
      sub: 'Every candidate on this requisition is drawn against this bar — it is what the radar on '
        + 'their panel measures, and what the fit percentage means.',
      body: (
        <SkillBar jobId={v} rows={bar.length ? bar : [{ skill: '', level: 3, must: false }]}
          suggestions={suggestions} family={job.family} />
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="sk.save" v={v}>Save the bar</Btn>
        </>
      ),
    };
  },

  /* ── The question bank ─────────────────────────────────── */
  /* Picking questions somebody has already written rather than writing them
     again. The bank is editorial — the ones every requisition asks come first,
     then the ones this function adds — and a question already on the form is
     shown as such rather than offered twice, because adding it twice is the
     mistake this sheet exists to prevent. */
  'jq.pick': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;

    const [all, mine, family] = await Promise.all([
      bank(), questionsOf(v), familyOf(job.deptId),
    ]);
    const already = new Set(mine.map((q) => q.bankId).filter(Boolean) as string[]);
    const fam = (family ?? '').toLowerCase();

    /* Standard first, then this function’s own, then the rest — the order the
       list is useful in, not the order the table happens to be in. */
    const ranked = [...all].sort((a, b) => {
      const rank = (q: typeof a) => (q.isStandard ? 0
        : (q.families ?? []).some((f) => f.toLowerCase() === fam) ? 1 : 2);
      return rank(a) - rank(b) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
    });
    const open = ranked.filter((q) => !already.has(q.id));

    return {
      title: 'From the question bank',
      aria: 'Question bank',
      eyebrow: job.title,
      wide: true,
      sub: `${open.length} question${open.length === 1 ? '' : 's'} you can add to this careers `
        + 'form. Editing the wording of a bank question is done once, under Settings → '
        + 'Templates, so every requisition asking it stays in step.',
      body: (
        <div className="stack">
          {!ranked.length ? (
            <Empty icon="list" title="The bank is empty"
              sub="Questions added under Settings → Templates show up here for every requisition."
              action={<Btn size="sm" variant="out" action="go" v="/settings?tab=templates">
                Open Templates
              </Btn>} />
          ) : (
            <div className="list">
              {ranked.map((q) => {
                const on = already.has(q.id);
                const where = q.isStandard ? 'Asked on every requisition'
                  : (q.families ?? []).length ? `Written for ${(q.families ?? []).join(', ')}`
                    : 'General';
                return (
                  <Li key={q.id}
                    className={on ? 'muted' : undefined}
                    icon={on ? 'check' : 'list'} iconTone={on ? 'ok' : 'brand'}
                    title={q.text.replace('{{city}}', 'the city')}
                    sub={
                      <>
                        {qtypeLabel(q.type)}
                        {q.required && ' · required'}
                        {q.knockout && ' · knocks out'}
                        {` · ${where}`}
                      </>
                    }
                    right={on
                      ? <Chip tone="ok">On the form</Chip>
                      : <Btn size="xs" variant="pri" action="jq.add" v={`${v}|${q.id}`}
                        icon="plus" iconSize={12}>Add</Btn>} />
                );
              })}
            </div>
          )}
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Done</Btn>
          <Sp />
          <Btn variant="out" action="jq.new" v={v} icon="plus" iconSize={13}>
            Write a new one instead
          </Btn>
        </>
      ),
    };
  },

  /* ── A question asked on this requisition only ────────────────────────── */
  'jq.new': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;
    return {
      title: 'Add a question',
      aria: 'Add question',
      eyebrow: job.title,
      sub: 'Asked on the careers form for this requisition only. To reuse it, add it to the bank '
        + 'under Settings → Templates.',
      body: <QuestionForm />,
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="jq.save" v={`${v}|new`}>Add question</Btn>
        </>
      ),
    };
  },

  'jq.edit': async (v, { viewer }) => {
    const [q] = await db().select().from(jobQuestions).where(eq(jobQuestions.id, v)).limit(1);
    if (!q) return null;
    await requireJob(viewer, q.jobId, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, q.jobId)).limit(1);
    return {
      title: 'Edit question',
      aria: 'Edit question',
      eyebrow: job?.title,
      sub: `Currently a ${qtypeLabel(q.type).toLowerCase()} question${q.required ? ', required' : ', optional'}.`,
      body: <QuestionForm q={q} />,
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="jq.save" v={`${q.jobId}|${q.id}`}>Save</Btn>
        </>
      ),
    };
  },
});

/** The function a department belongs to, which is what the product calls the
    job family; it is what the skill suggestions are drawn from. */
async function familyOf(deptId: string): Promise<string | null> {
  const [row] = rowsOf(await db().execute(sql`
    SELECT COALESCE(f.name, d.name) AS family
      FROM ${departments} d LEFT JOIN functions f ON f.id = d.function_id
     WHERE d.id = ${deptId}`)) as Array<{ family: string }>;
  return row?.family ?? null;
}
