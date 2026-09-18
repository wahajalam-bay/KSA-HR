import 'server-only';
import * as React from 'react';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  interviews, interviewPanel, applications, candidates, jobs, jobStages,
  jobHiringManagers, staff, tasks,
} from '@/db/schema';
import { defineSheets, lookupSheet } from './registry';
import { Field, Btn, Sp, Banner } from '@/components/ui/primitives';
import { rows as rowsOf } from '@/lib/queries/sql';
import { jobScopeSql } from '@/lib/authz';
import { finalGate } from '@/lib/services/transitions';
import { IVW_STAGES } from '@/lib/services/interviews';
import { fmt } from '@/lib/format';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   THE SCHEDULING SHEETS

   Booking an interview, moving one, and the task list.

   The booking form does one thing the prototype's did not: it reads the gate
   before it is submitted, so a final interview that cannot be booked says so on
   the stage that is locked rather than after the recruiter has filled the form
   in. The command checks it again — the form is a courtesy, not the guard.
   ═════════════════════════════════════════════════════════════════════════════*/

const MODES = ['Google Meet', 'Microsoft Teams', 'On-site — Olaya', 'On-site — Jeddah', 'Phone'];
const DURATIONS = [30, 45, 60, 90];

/** Applications a sheet may book against: live, on a requisition in scope. */
async function bookable(viewer: Viewer) {
  return rowsOf(await db().execute(sql`
    SELECT a.id, a.stage::text AS stage, c.name AS candidate, j.title, j.id AS job_id
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      JOIN ${jobs} j ON j.id = a.job_id
     WHERE a.status IN ('active','on_hold')
       AND a.job_id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(viewer)})
     ORDER BY c.name`)) as Array<{
       id: string; stage: string; candidate: string; title: string; job_id: string;
     }>;
}

/** The two-days-out slot the form opens on, at ten in the morning, Riyadh. */
function defaultSlot(now: Date) {
  const d = new Date(now.getTime() + 2 * 86_400_000);
  d.setUTCHours(7, 0, 0, 0);
  return { date: d.toISOString().slice(0, 10), time: '10:00' };
}

async function panelFor(jobId: string) {
  const hms = await db().select().from(jobHiringManagers)
    .where(eq(jobHiringManagers.jobId, jobId))
    .orderBy(asc(jobHiringManagers.sortOrder));
  return hms;
}

async function stagesFor(jobId: string) {
  const all = await db().select().from(jobStages)
    .where(eq(jobStages.jobId, jobId))
    .orderBy(asc(jobStages.ordinal));
  const use = all.filter((s) => (IVW_STAGES as readonly string[]).includes(s.stageKey));
  return use.length ? use : all;
}

defineSheets({
  /* Picking a different application re-draws the form against it, so the
     stages, the panel and the gate are the ones that requisition actually has.
     It is the same sheet under another name — see `ivw.new` below. */
  'ivw.pickApp': async (v, ctx) => {
    const sheet = lookupSheet('ivw.new');
    return sheet ? sheet(v, { ...ctx, fields: { ...ctx.fields, appId: v } }) : null;
  },

  /* ── Book one ─────────────────────────────────────────────────────────── */
  'ivw.new': async (v, { viewer, fields }) => {
    const options = await bookable(viewer);
    if (!options.length) {
      return {
        title: 'Schedule an interview',
        aria: 'Schedule an interview',
        body: (
          <Banner tone="info" icon="cal" title="Nothing to book against"
            body="An interview hangs off a live application, and there are none you can reach." />
        ),
      };
    }

    const applicationId = fields.appId || v || options[0].id;
    const app = options.find((o) => o.id === applicationId) ?? options[0];
    const [stages, hms] = await Promise.all([stagesFor(app.job_id), panelFor(app.job_id)]);
    const slot = defaultSlot(new Date());

    /* What the final interview is waiting for, if anything. */
    const gate = await finalGate(app.id, 'ivf', db());
    const lockedFinal = !gate.ok;

    const stage = stages.find((s) => s.stageKey === (fields.stage || app.stage))
      ?? stages[0];

    return {
      title: 'Schedule an interview',
      aria: 'Schedule an interview',
      eyebrow: 'New interview',
      wide: true,
      sub: 'Interviews hang off a live application, so the candidate, the requisition and the '
        + 'stage stay in step. Times are Asia/Riyadh.',
      body: (
        <>
          <div className="form">
            <Field label="Live application" name="appId" type="select" className="wide" req
              value={app.id} action="ivw.pickApp"
              options={options.map((o) => ({ v: o.id, t: `${o.candidate} — ${o.title}` }))}
              help={`${options.length} active or on-hold applications to choose from`} />

            <Field label="Stage" name="stage" type="select" value={stage?.stageKey}
              options={stages.map((s) => ({
                v: s.stageKey,
                t: s.stageKey === 'ivf' && lockedFinal
                  ? `${s.name} — locked, ${gate.senior ? 'behaviour test outstanding' : 'sales pitch outstanding'}`
                  : s.name,
              }))}
              help={lockedFinal
                ? `${gate.senior ? 'Manager-and-above requisition' : 'This requisition runs a sales pitch'}: ${
                  gate.checks.filter((c) => !c.ok).map((c) => c.text).join('; ')}.`
                : `Stages of ${app.title}`} />

            <Field label="Date" name="date" type="date" req value={slot.date}
              help="Sunday to Thursday is the working week" />
            <Field label="Start time (AST)" name="time" type="time" req value={slot.time} />
            <Field label="Duration" name="durationMin" type="select" value={45}
              options={DURATIONS.map((n) => ({ v: String(n), t: `${n} minutes` }))} />
            <Field label="Mode" name="mode" type="select" value={MODES[0]} options={MODES} />

            <Field label="Hiring manager for this interview" name="interviewer" type="select"
              className="wide" value={hms[0]?.name ?? ''}
              options={[
                ...hms.map((h) => ({
                  v: h.name,
                  t: `${h.name}${h.title ? ` — ${h.title}` : ''}${h.isLead ? ' (lead)' : ''}`,
                })),
                { v: '', t: 'No hiring manager — panel only' },
              ]}
              help={`${hms.length} hiring manager${hms.length === 1 ? '' : 's'} on ${app.title}; `
                + 'whoever you pick runs this interview and is added to the panel.'} />

            <Field label="Rest of the panel" name="panel" className="wide"
              placeholder="e.g. Reem Al-Sudairi, Karthik Menon"
              help="Comma separated. Everybody on it can sign in to file a scorecard." />
          </div>
          <div style={{ marginTop: 14 }}>
            <Banner tone="info" icon="users"
              title={`${app.candidate} · ${app.title}`}
              body="Booking it raises a scorecard for everybody on the panel, and invites anybody who
                cannot already sign in." />
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="ivw.create">Book the interview</Btn>
        </>
      ),
    };
  },

  /* ── Move one ─────────────────────────────────────────────────────────── */
  'ivw.reschedule': async (v) => {
    const [iv] = await db().select().from(interviews).where(eq(interviews.id, v)).limit(1);
    if (!iv) return null;
    const [cand] = await db().select().from(candidates)
      .where(eq(candidates.id, iv.candidateId)).limit(1);
    const [job] = await db().select().from(jobs).where(eq(jobs.id, iv.jobId)).limit(1);
    const hms = await panelFor(iv.jobId);
    const panel = await db().select().from(interviewPanel)
      .where(eq(interviewPanel.interviewId, iv.id))
      .orderBy(asc(interviewPanel.sortOrder));

    const riyadh = new Date(iv.at.getTime() + 3 * 3600_000);
    const rest = panel.map((p) => p.name)
      .filter((n) => n.toLowerCase() !== (iv.interviewer ?? '').toLowerCase());

    return {
      title: 'Move this interview',
      aria: 'Reschedule interview',
      eyebrow: 'Reschedule',
      sub: `${cand?.name ?? iv.title}${job ? ` · ${job.title}` : ''} — currently ${fmt.when(iv.at)}.`,
      body: (
        <div className="form">
          <Field label="New date" name="date" type="date" req
            value={riyadh.toISOString().slice(0, 10)}
            help="Sunday to Thursday is the working week" />
          <Field label="New start time (AST)" name="time" type="time" req
            value={riyadh.toISOString().slice(11, 16)} />
          <Field label="Duration" name="durationMin" type="select" value={iv.durationMin}
            options={DURATIONS.map((n) => ({ v: String(n), t: `${n} minutes` }))} />
          <Field label="Mode" name="mode" type="select" value={iv.mode} options={MODES} />
          {!!hms.length && (
            <Field label="Hiring manager for this interview" name="interviewer" type="select"
              className="wide" value={iv.interviewer ?? ''}
              options={[
                ...hms.map((h) => ({
                  v: h.name,
                  t: `${h.name}${h.title ? ` — ${h.title}` : ''}${h.isLead ? ' (lead)' : ''}`,
                })),
                { v: '', t: 'No hiring manager — panel only' },
              ]}
              help="Swap the hiring manager if somebody else takes this one." />
          )}
          <Field label="Rest of the panel" name="panel" className="wide" value={rest.join(', ')}
            help="Comma separated. Anybody taken off stops owing a scorecard." />
          <Field label="Why it is moving" name="reason" className="wide"
            placeholder="Optional — it goes on the record" />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Keep it where it is</Btn>
          <Sp />
          <Btn variant="pri" action="ivw.moveSave" v={v}>Move the interview</Btn>
        </>
      ),
    };
  },

  /* ── A task ───────────────────────────────────────────────────────────── */
  'task.new': async (v, { viewer }) => {
    const [app] = v
      ? rowsOf(await db().execute(sql`
        SELECT a.id, c.name AS candidate, j.id AS job_id, j.title
          FROM ${applications} a
          JOIN ${candidates} c ON c.id = a.candidate_id
          JOIN ${jobs} j ON j.id = a.job_id
         WHERE a.id = ${v}`)) as Array<{ id: string; candidate: string; job_id: string; title: string }>
      : [];

    const desk = await db().select({ id: staff.id, name: staff.name }).from(staff)
      .where(sql`${staff.status} = 'active'`)
      .orderBy(asc(staff.name));
    const open = rowsOf(await db().execute(sql`
      SELECT id, title FROM ${jobs}
       WHERE status = 'open' AND id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(viewer)})
       ORDER BY title`)) as Array<{ id: string; title: string }>;

    const today = new Date().toISOString().slice(0, 10);

    return {
      title: 'New task',
      aria: 'New task',
      eyebrow: 'Chase list',
      sub: 'Tasks sit on the owner’s overview until they are ticked off.',
      body: (
        <div className="form">
          <Field label="What needs doing" name="title" req className="wide"
            value={app ? `Chase feedback — ${app.candidate}` : ''}
            placeholder="e.g. Chase the panel for scorecards — Rana Nabulsi" />
          <Field label="Kind" name="kind" type="select" value="chase_feedback"
            options={[
              { v: 'chase_feedback', t: 'Chase feedback' },
              { v: 'verify_offer', t: 'Verify an offer letter' },
              { v: 'offer_question', t: 'Answer an offer question' },
              { v: 'assessment', t: 'Behaviour test' },
              { v: 'reference', t: 'Reference check' },
              { v: 'joining', t: 'Joining date' },
              { v: 'onboarding', t: 'Onboarding documents' },
              { v: 'sla', t: 'Past the stage SLA' },
              { v: 'probation', t: 'Probation' },
              { v: 'other', t: 'Something else' },
            ]} />
          <Field label="Owner" name="assigneeId" type="select" value={viewer.staffId ?? ''}
            options={desk.map((s) => ({ v: s.id, t: s.name }))} />
          <Field label="Due" name="dueOn" type="date" value={today} />
          <Field label="Priority" name="priority" type="select" value="normal"
            options={[
              { v: 'critical', t: 'Critical' }, { v: 'high', t: 'High' },
              { v: 'normal', t: 'Normal' }, { v: 'low', t: 'Low' },
            ]} />
          <Field label="Against a requisition" name="jobId" type="select"
            value={app?.job_id ?? ''}
            help="Optional — links the task to a pipeline."
            options={[{ v: '', t: 'None' }, ...open.map((j) => ({ v: j.id, t: j.title }))]} />
          <Field label="Detail" name="detail" type="textarea" rows={2} className="wide"
            placeholder="Optional" />
          {app && <input type="hidden" name="applicationId" value={app.id} />}
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="task.create" v={v}>Add the task</Btn>
        </>
      ),
    };
  },
});
