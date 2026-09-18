import 'server-only';
import * as React from 'react';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  candidates, jobs, jobQuestions, applications, hashtags, talentPools, emailTemplates,
  locations, sources, stages, jobStages, staff, files,
} from '@/db/schema';
import { defineSheets, lookupSheet } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Dropzone } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { jobScopeSql, requireApplication } from '@/lib/authz';
import { finalGate } from '@/lib/services/transitions';
import { CLAIM_DEFAULT_DAYS, claimEndsAt, claimIsLive } from '@/lib/domain/claim';
import { fmt } from '@/lib/format';
import { allLocations, qtypeLabel } from './blocks';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   THE CANDIDATE SHEETS

   Adding somebody, putting them on a requisition, the recruiter's tag, the
   tags that drive the pools, a pool of its own — and the three that hang off
   an application in the drawer: moving a stage, disqualifying, and writing to
   the candidate.

   The application questions are the interesting part. They belong to the
   requisition, not to the form, so the sheet re-reads itself when the
   requisition changes and asks exactly what that requisition asks.
   ═════════════════════════════════════════════════════════════════════════════*/

/* The sheets that are another sheet under a different name look it up rather
   than duplicating it, so the form can never drift between them. */
const lookupOwn = (name: string) => lookupSheet(name);

const DISQUALIFY_REASONS = [
  'Salary expectation above band',
  'Failed technical assessment',
  'Better candidate progressed',
  'Insufficient KSA market experience',
  'Communication not at required level',
  'No Arabic — required for the role',
  'Unresponsive after 3 attempts',
  'Notice period too long',
  'Withdrew — accepted another offer',
  'Position closed',
];

/** The requisitions a candidate may be put on, under the viewer's scope. */
async function openJobs(viewer: Viewer, include?: string | null) {
  return rowsOf(await db().execute(sql`
    SELECT id, title, status::text AS status FROM ${jobs}
     WHERE (status = 'open'${include ? sql` OR id = ${include}` : sql``})
       AND id IN (SELECT id FROM ${jobs} WHERE ${jobScopeSql(viewer)})
     ORDER BY status <> 'open', title`)) as Array<{ id: string; title: string; status: string }>;
}

/** What a requisition asks on the careers form, rendered for whoever is
    filling it in on the candidate's behalf. */
async function ApplyFields({ jobId }: { jobId: string }) {
  const qs = await db().select().from(jobQuestions)
    .where(eq(jobQuestions.jobId, jobId)).orderBy(asc(jobQuestions.ordinal));
  if (!qs.length) return null;
  return (
    <>
      <div className="divider"><span className="t-over">Application questions</span></div>
      <p className="t-foot" style={{ margin: '-4px 0 10px' }}>
        {qs.length} question{qs.length === 1 ? '' : 's'} this requisition asks on the careers form.
        A knockout answer is flagged on the application rather than hidden.
      </p>
      <div className="form">
        {qs.map((q) => {
          const name = `ans:${q.id}`;
          if (q.type === 'yesno') {
            return (
              <Field key={q.id} label={q.text} name={name} type="select" req={q.required}
                className="wide" options={[{ v: '', t: '—' }, { v: 'Yes', t: 'Yes' }, { v: 'No', t: 'No' }]}
                help={q.knockout ? `Knockout unless “${q.knockout}”` : undefined} />
            );
          }
          if (q.type === 'choice' || q.type === 'multi') {
            return (
              <Field key={q.id} label={q.text} name={name} type="select" req={q.required}
                className="wide"
                options={[{ v: '', t: '—' }, ...(q.options ?? []).map((o) => ({ v: o, t: o }))]}
                help={q.type === 'multi' ? 'Pick the closest — the rest can be noted on the panel.' : undefined} />
            );
          }
          if (q.type === 'long') {
            return (
              <Field key={q.id} label={q.text} name={name} type="textarea" rows={3}
                req={q.required} className="wide" />
            );
          }
          return (
            <Field key={q.id} label={q.text} name={name} req={q.required} className="wide"
              type={q.type === 'number' ? 'number' : 'text'} />
          );
        })}
      </div>
    </>
  );
}

defineSheets({
  /* ── Add somebody ─────────────────────────────────────────────────────── */
  /* `v` is the requisition, and after a résumé has been attached it is the
     requisition and the file: `cand.stageFile` re-opens this panel carrying
     the id of what it stored, and everything already typed comes with it
     because the panel is redrawn from the fields the sheet still holds. */
  'cand.new': async (v, { viewer, fields }) => {
    const [vJob, stagedId] = (v ?? '').split('|');
    const jobId = fields.jobId ?? vJob ?? '';
    const staged = stagedId || fields.resumeFileId || '';
    const [jobs_, locs, srcs, file] = await Promise.all([
      openJobs(viewer, jobId || null),
      allLocations(),
      db().select({ name: sources.name }).from(sources).orderBy(asc(sources.sortOrder)),
      staged
        ? db().select().from(files).where(eq(files.id, staged)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    return {
      title: 'Add a candidate',
      aria: 'Add candidate',
      wide: true,
      sub: 'Identity is resolved on write — a matching email or phone links this person to their '
        + 'other applications straight away.',
      body: (
        <>
          <div className="form">
            <Field label="Full name" name="name" req className="wide"
              placeholder="e.g. Noura Al-Harbi" />
            <Field label="Email" name="email" type="email" req />
            <Field label="Phone" name="phone" value="+9665" help="E.164 format" />
            <Field label="Current title" name="currentTitle" />
            <Field label="Current company" name="currentCompany" />
            <Field label="City" name="locationCity" type="select"
              options={locs.map((l) => ({ v: l.city, t: l.city }))} />
            <Field label="Years of experience" name="yearsExperience" type="number" value={5} min={0} />
            <Field label="Expected salary (SAR/month)" name="expectedSalary" type="number"
              value={12000} step={500} />
            <Field label="Apply to" name="jobId" type="select" className="wide" value={jobId}
              action="cand.newJob"
              options={[
                { v: '', t: 'Talent pool only — no application yet' },
                ...jobs_.map((j) => ({
                  v: j.id, t: j.status === 'open' ? j.title : `${j.title} (${j.status.replace('_', ' ')})`,
                })),
              ]} />
            <Field label="Source" name="source" type="select"
              options={srcs.map((s) => ({ v: s.name, t: s.name }))} />
          </div>

          <div id="applyq">{jobId ? <ApplyFields jobId={jobId} /> : null}</div>

          <div style={{ marginTop: 14 }}>
            {file && !file.deletedAt ? (
              <>
                <div className="filebar">
                  <span className="ic"><Icon name="file" size={15} /></span>
                  <span className="bd">
                    <b>{file.originalName}</b>
                    <span>
                      {fmt.int(Math.max(1, Math.round(file.sizeBytes / 1024)))} KB · read into the
                      profile when you save
                      {file.scanState !== 'clean'
                        && ` · ${file.scanState === 'skipped' ? 'not scanned' : `scan ${file.scanState}`}`}
                    </span>
                  </span>
                  <Chip tone={file.scanState === 'clean' ? 'ok' : 'warn'}>
                    {file.scanState === 'clean' ? 'Ready' : 'Unscanned'}
                  </Chip>
                </div>
                <input type="hidden" name="resumeFileId" value={file.id} />
              </>
            ) : (
              <Dropzone action="cand.stageFile" accept=".pdf,.doc,.docx,.txt"
                title="Attach a résumé"
                sub="Optional — it is read into the profile on save" />
            )}
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="cand.create" v={jobId}>Add candidate</Btn>
        </>
      ),
    };
  },

  /* The requisition picker re-renders the sheet so the questions follow it. */
  'cand.newJob': async (v, ctx) => {
    const sheet = lookupOwn('cand.new');
    return sheet ? sheet(v, { ...ctx, fields: { ...ctx.fields, jobId: v } }) : null;
  },

  'job.addCand': async (v, ctx) => {
    const sheet = lookupOwn('cand.new');
    return sheet ? sheet(v, { ...ctx, fields: { ...ctx.fields, jobId: v } }) : null;
  },

  /* ── The recruiter's tag ──────────────────────────────────────────────── */
  'cand.claim': async (v, { viewer }) => {
    const [cand] = await db().select().from(candidates).where(eq(candidates.id, v)).limit(1);
    if (!cand) return null;

    const live = claimIsLive(cand.claimAt, cand.claimDays, new Date());
    const held = live && cand.claimBy && cand.claimBy !== viewer.staffId;
    const until = live && cand.claimAt ? claimEndsAt(cand.claimAt, cand.claimDays) : null;

    return {
      title: `Put your name on ${cand.name}`,
      aria: 'Claim candidate',
      eyebrow: 'Recruiter tag',
      sub: 'A tag says this person is yours to work for a while. It does not lock anybody out — it '
        + 'tells the rest of the desk to talk to you first.',
      body: (
        <>
          {held && (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="warn" icon="pin"
                title={`${cand.claimByName ?? 'Somebody else'} already has their name on this person`}
                body={`Their tag runs to ${until ? fmt.date(until) : 'an unknown date'}${
                  cand.claimNote ? ` — “${cand.claimNote}”` : ''}. Taking it over is recorded and `
                  + 'they are told.'} />
            </div>
          )}
          <div className="form">
            <Field label="Why you are tagging them" name="note" className="wide"
              value={cand.claimBy === viewer.staffId ? (cand.claimNote ?? '') : ''}
              placeholder="e.g. Spoke at the Riyadh property fair — following up on Sunday"
              help="The rest of the desk reads this before they call." />
            <Field label="For how long" name="days" type="select"
              value={String(cand.claimDays ?? CLAIM_DEFAULT_DAYS)}
              options={[
                { v: '7', t: 'A week' }, { v: '14', t: 'A fortnight' },
                { v: '30', t: 'A month' }, { v: '60', t: 'Two months' },
                { v: '90', t: 'A quarter' },
              ]}
              help="When it runs out the person goes back to the desk automatically." />
            {held && (
              <Field label="This is somebody else’s tag" name="takeover" type="select" value="0"
                className="wide"
                options={[
                  { v: '0', t: 'Do not take it over' },
                  { v: '1', t: `Take it over from ${cand.claimByName ?? 'them'} — they will be told` },
                ]} />
            )}
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          {cand.claimBy === viewer.staffId && (
            <Btn variant="out" action="cand.release" v={v}>Release the tag</Btn>
          )}
          <Btn variant="pri" action="cand.claimSave" v={v} icon="pin" iconSize={14}>
            {held ? 'Take the tag over' : 'Put my name on them'}
          </Btn>
        </>
      ),
    };
  },

  /* ── Tags ─────────────────────────────────────────────────────────────── */
  'tag.add': async (v) => {
    const [cand] = await db().select().from(candidates).where(eq(candidates.id, v)).limit(1);
    if (!cand) return null;
    const all = await db().select().from(hashtags).orderBy(asc(hashtags.sortOrder), asc(hashtags.tag));
    const on = new Set(cand.hashtags);

    return {
      title: `Tags for ${cand.name}`,
      aria: 'Tags',
      sub: 'Tags are how you find people again — they drive the talent pools.',
      body: (
        <>
          <div className="chipbar">
            {all.map((h) => (
              <label className={`tag${on.has(h.tag) ? ' on' : ''}`} key={h.tag}>
                <input type="checkbox" name="hashtags" value={h.tag} defaultChecked={on.has(h.tag)} />
                {h.tag}
              </label>
            ))}
          </div>
          <div className="form" style={{ marginTop: 14 }}>
            <Field label="A tag that is not on the list" name="hashtags" className="wide"
              placeholder="e.g. #off-plan"
              help="Anything you add here joins the list, so the next person picks it rather than
                inventing a near-miss." />
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="tag.save" v={v}>Save tags</Btn>
        </>
      ),
    };
  },

  /* ── A pool ───────────────────────────────────────────────────────────── */
  'pool.new': async () => {
    const [tags, fams, locs] = await Promise.all([
      db().select().from(hashtags).orderBy(asc(hashtags.sortOrder), asc(hashtags.tag)),
      db().execute(sql`SELECT DISTINCT family FROM ${candidates} WHERE family IS NOT NULL ORDER BY family`),
      allLocations(),
    ]);
    const families = (rowsOf(fams) as Array<{ family: string }>).map((r) => r.family);

    return {
      title: 'New talent pool',
      aria: 'New pool',
      sub: 'A pool is a list of people you keep coming back to. Add somebody to it from their '
        + 'profile, or from the board.',
      body: (
        <div className="stack">
          <div className="form">
            <Field label="Pool name" name="name" req className="wide"
              placeholder="e.g. Arabic-speaking sales, Jeddah" />
            <Field label="Function" name="family" type="select"
              options={[{ v: '', t: 'Any' }, ...families.map((f) => ({ v: f, t: f }))]} />
            <Field label="City" name="city" type="select"
              options={[{ v: '', t: 'Any' }, ...locs.map((l) => ({ v: l.city, t: l.city }))]} />
            <Field label="Minimum years" name="minYears" type="number" value={0} min={0} />
          </div>
          <div>
            <label className="t-cap">Tags the people in it tend to carry</label>
            <div className="chipbar" style={{ marginTop: 6 }}>
              {tags.map((h) => (
                <label className="tag" key={h.tag}>
                  <input type="checkbox" name="hashtags" value={h.tag} />{h.tag}
                </label>
              ))}
            </div>
          </div>
          <p className="t-foot">
            These describe the pool; they do not filter it behind your back. A pool holds the people
            somebody put in it, so it cannot change underneath a shortlist.
          </p>
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="pool.create">Create pool</Btn>
        </>
      ),
    };
  },

  /* ── Moving a stage ───────────────────────────────────────────────────── */
  'app.move': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const [app] = rowsOf(await db().execute(sql`
      SELECT a.id, a.stage::text AS stage, a.job_id, c.name AS candidate, j.title
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
       WHERE a.id = ${v}`)) as Array<{
         id: string; stage: string; job_id: string; candidate: string; title: string;
       }>;
    if (!app) return null;

    const loop = await db().select().from(jobStages)
      .where(eq(jobStages.jobId, app.job_id)).orderBy(asc(jobStages.ordinal));
    const gate = await finalGate(v, 'ivf', db());

    return {
      title: `Move ${app.candidate}`,
      aria: 'Move stage',
      eyebrow: app.title,
      sub: 'The spine is fixed — a template may rename or skip a stage, never reorder it. Moving '
        + 'somebody starts that stage’s clock.',
      body: (
        <div className="list">
          {loop.map((s) => {
            const here = s.stageKey === app.stage;
            const locked = s.stageKey === 'ivf' && !gate.ok;
            return (
              <Li key={s.stageKey}
                icon={here ? 'check' : locked ? 'lock' : 'arrR'}
                iconTone={here ? 'brand' : locked ? 'warn' : ''}
                title={s.name}
                sub={here ? 'Current stage'
                  : locked
                    ? `Locked — ${gate.checks.filter((c) => !c.ok).map((c) => c.text.toLowerCase()).join('; ')}`
                    : `SLA ${s.sla} day${s.sla === 1 ? '' : 's'}`}
                action={here || locked ? undefined : 'app.moveTo'}
                v={`${v}|${s.stageKey}`} />
            );
          })}
        </div>
      ),
    };
  },

  /* ── Disqualifying ────────────────────────────────────────────────────── */
  'app.reject': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const [app] = rowsOf(await db().execute(sql`
      SELECT c.name AS candidate, j.title, a.stage::text AS stage
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
       WHERE a.id = ${v}`)) as Array<{ candidate: string; title: string; stage: string }>;
    if (!app) return null;

    return {
      title: 'Disqualify',
      aria: 'Disqualify',
      eyebrow: `${app.candidate} · ${app.title}`,
      sub: 'Rejection is a status, not a tenth column — the application keeps the stage it reached, '
        + 'so the conversion maths stays honest.',
      body: (
        <div className="list">
          {DISQUALIFY_REASONS.map((r) => (
            <Li key={r} icon={r.startsWith('Withdrew') ? 'arrR' : 'x'} title={r}
              action="app.rejectWith" v={`${v}|${r}`} />
          ))}
        </div>
      ),
    };
  },

  /* ── Writing to the candidate ─────────────────────────────────────────── */
  'app.email': async (v, { viewer, fields }) => {
    await requireApplication(viewer, v, db());
    const [app] = rowsOf(await db().execute(sql`
      SELECT a.id, a.stage::text AS stage, c.name AS candidate, c.email, c.current_company,
             j.title, j.salary_min, l.city
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
        LEFT JOIN ${locations} l ON l.id = j.location_id
       WHERE a.id = ${v}`)) as Array<{
         id: string; stage: string; candidate: string; email: string | null;
         current_company: string | null; title: string; salary_min: number; city: string | null;
       }>;
    if (!app) return null;

    const templates = await db().select().from(emailTemplates)
      .where(isNull(emailTemplates.archivedAt)).orderBy(asc(emailTemplates.sortOrder));
    const chosen = templates.find((t) => t.id === fields.tpl)
      ?? templates.find((t) => t.stage === app.stage)
      ?? templates.find((t) => t.lang === 'en')
      ?? templates[0];

    if (!chosen) {
      return {
        title: `Email ${app.candidate}`,
        aria: 'Email',
        body: <Empty icon="mail" title="No templates yet"
          sub="Write one under Settings → Templates and it will appear here." />,
      };
    }

    /* Merge fields are filled from the record, never guessed; anything the
       record cannot answer is left as an ellipsis for a person to finish. */
    const fill = (s: string) => s
      .replace(/\{\{first_name\}\}/g, app.candidate.split(/\s+/)[0])
      .replace(/\{\{job_title\}\}/g, app.title)
      .replace(/\{\{recruiter_name\}\}/g, viewer.name)
      .replace(/\{\{current_company\}\}/g, app.current_company ?? '—')
      .replace(/\{\{location\}\}/g, app.city ?? '—')
      .replace(/\{\{base_monthly\}\}/g, String(app.salary_min))
      .replace(/\{\{[a-z_]+\}\}/g, '…');

    return {
      title: `Email ${app.candidate}`,
      aria: 'Email',
      eyebrow: chosen.name,
      wide: true,
      sub: app.email
        ? undefined
        : 'This candidate has no address on file — add one on their profile before sending.',
      body: (
        <div className="stack">
          <div className="form">
            <Field label="To" name="to" value={app.email ?? ''} className="wide" req />
            <Field label="Template" name="tpl" type="select" className="wide" value={chosen.id}
              action="app.emailTpl" v={v}
              options={templates.map((t) => ({ v: t.id, t: t.name }))} />
            <Field label="Subject" name="subject" value={fill(chosen.subject)} className="wide" req />
            <Field label="Message" name="body" type="textarea" rows={12} className="wide"
              value={fill(chosen.body)} />
          </div>
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="app.emailSend" v={v} icon="mail" iconSize={14}>Send</Btn>
        </>
      ),
    };
  },

  /* Switching template re-renders the sheet with that template filled in. */
  'app.emailTpl': async (v, ctx) => {
    const sheet = lookupOwn('app.email');
    return sheet ? sheet(v, ctx) : null;
  },

  /* ── Confirming a slot from the scheduling board ──────────────────────── */
  'book.pick': async (v, { viewer }) => {
    const [appId, at] = v.split('|');
    if (!appId || !at) return null;
    await requireApplication(viewer, appId, db());

    const [app] = rowsOf(await db().execute(sql`
      SELECT a.id, a.stage::text AS stage, a.job_id, c.name AS candidate, j.title
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        JOIN ${jobs} j ON j.id = a.job_id
       WHERE a.id = ${appId}`)) as Array<{
         id: string; stage: string; job_id: string; candidate: string; title: string;
       }>;
    if (!app) return null;

    const loop = await db().select().from(jobStages)
      .where(eq(jobStages.jobId, app.job_id)).orderBy(asc(jobStages.ordinal));
    const hms = rowsOf(await db().execute(sql`
      SELECT name, title, is_lead FROM job_hiring_managers WHERE job_id = ${app.job_id}
       ORDER BY sort_order`)) as Array<{ name: string; title: string | null; is_lead: boolean }>;
    const gate = await finalGate(appId, 'ivf', db());
    const stage = app.stage === 'ivf' && !gate.ok ? 'iv1' : app.stage;

    return {
      title: 'Confirm the slot',
      aria: 'Book interview',
      eyebrow: app.candidate,
      sub: `${fmt.dateShort(at)} at ${fmt.time(at)} Riyadh time.`,
      body: (
        <div className="form">
          <Field label="Stage" name="stage" type="select" value={stage}
            options={loop.map((s) => ({
              v: s.stageKey,
              t: s.stageKey === 'ivf' && !gate.ok
                ? `${s.name} — locked until ${gate.senior ? 'the behaviour test is back' : 'the sales pitch is scored'}`
                : s.name,
            }))}
            help={gate.senior
              ? (gate.ok
                ? 'Manager-and-above: the behaviour test is back and every scorecard is in, so the final is open.'
                : 'Manager-and-above: the final interview needs the behaviour test and every earlier scorecard first.')
              : undefined} />
          <Field label="Format" name="mode" type="select" value="Google Meet"
            options={['Google Meet', 'Microsoft Teams', 'On-site — Olaya', 'Phone']} />
          <Field label="Duration" name="durationMin" type="select" value="45"
            options={[
              { v: '30', t: '30 min' }, { v: '45', t: '45 min' },
              { v: '60', t: '60 min' }, { v: '90', t: '90 min' },
            ]} />
          <Field label="Hiring manager for this interview" name="interviewer" type="select"
            className="wide" value={hms[0]?.name ?? ''}
            options={[
              ...hms.map((h) => ({
                v: h.name,
                t: `${h.name}${h.title ? ` — ${h.title}` : ''}${h.is_lead ? ' (lead)' : ''}`,
              })),
              { v: '', t: 'No hiring manager — panel only' },
            ]}
            help={`${hms.length} hiring manager${hms.length === 1 ? '' : 's'} on this requisition; `
              + 'the one you pick is added to the panel and invited.'} />
          <Field label="Rest of the panel" name="panel" className="wide" help="Comma separated" />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="book.confirm" v={v} icon="cal" iconSize={14}>
            Book and invite
          </Btn>
        </>
      ),
    };
  },
});
