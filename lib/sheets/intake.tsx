import 'server-only';
import * as React from 'react';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { files, jobs, departments, functions } from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Card, Kvs } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { jobScopeSql, can } from '@/lib/authz';
import { fmt } from '@/lib/format';
import { INTAKE_OWNER } from '@/lib/commands/uploads';
import { IMPORT_COLUMNS, type ReadPlan } from '@/lib/services/manpower';
import type { Parsed, Fit } from '@/lib/services/cv';
import type { Viewer } from '@/lib/auth/session';

/* ═════════════════════════════════════════════════════════════════════════════
   WHAT A FILE SAID

   Two panels, and they are the same idea twice: a file has been read, nothing
   has been created, and a person decides.

     · `cv.review` — the reading of a résumé, field by field, each showing
       where it came from. What it could not find says so rather than showing a
       blank that looks like an answer;
     · `mp.importPreview` — a department's seats as the spreadsheet has them,
       with the rows the reader could not place listed before anything is
       written.

   Both read their file back out of the files table rather than holding
   anything in the browser, which is why closing the tab halfway through loses
   nothing and why two people cannot confirm the same import twice.
   ═════════════════════════════════════════════════════════════════════════════*/

type Intake = {
  parsed?: Parsed;
  readBy?: 'local' | 'ai';
  aiNote?: string | null;
  duplicate?: { id: string; name: string; matchedOn: string } | null;
  fit?: Fit | null;
  jobId?: string | null;
  words?: number;
  staged?: boolean;
  forForm?: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  cv: 'the CV',
  experience_section: 'the experience section',
  education_section: 'the education section',
  skills_section: 'the skills section',
  languages_section: 'the languages section',
  personal_section: 'the personal details',
  email_address: 'the e-mail address',
  ai: 'the assistant',
  recruiter: 'the recruiter',
  screening: 'the phone screen',
  not_found: '',
};

/** The fields the panel shows, in the order a person reads a CV. */
const READOUT: Array<{ k: keyof Parsed; label: string; req?: boolean; type?: string }> = [
  { k: 'name', label: 'Full name', req: true },
  { k: 'email', label: 'Email', req: true, type: 'email' },
  { k: 'phone', label: 'Phone' },
  { k: 'locationCity', label: 'City' },
  { k: 'currentTitle', label: 'Current title' },
  { k: 'currentCompany', label: 'Current company' },
  { k: 'yearsExperience', label: 'Years of experience', type: 'number' },
];

/* Two figures a CV essentially never states, asked for here because the
   recruiter usually knows them by the time they are typing this in. */
const EXTRA = [
  { name: 'noticeDays', label: 'Notice period (days)', step: 1 },
  { name: 'expectedSalary', label: 'Expected salary (SAR/month)', step: 500 },
];

/* `cv.create` reads these names; they are the contract between the two. */
const FIELD_NAME: Partial<Record<keyof Parsed, string>> = {
  name: 'name', email: 'email', phone: 'phone', locationCity: 'locationCity',
  currentTitle: 'currentTitle', currentCompany: 'currentCompany',
  yearsExperience: 'yearsExperience',
};

/** Open requisitions this viewer may use, best fit first. */
async function fittable(viewer: Viewer, skills: string[]) {
  const rows = rowsOf(await db().execute(sql`
    SELECT j.id, j.title, d.name AS dept, j.family,
           (SELECT count(*) FROM job_skills s
             WHERE s.job_id = j.id AND lower(s.skill) = ANY(${skills.map((s) => s.toLowerCase())}::text[]))
             AS matched,
           (SELECT count(*) FROM job_skills s WHERE s.job_id = j.id) AS asked
      FROM ${jobs} j
      LEFT JOIN ${departments} d ON d.id = j.dept_id
     WHERE j.status = 'open'
       AND ${jobScopeSql(viewer, 'j')}
     ORDER BY matched DESC, j.opened_on DESC NULLS LAST
     LIMIT 40`)) as Array<{
    id: string; title: string; dept: string | null; family: string | null;
    matched: number; asked: number;
  }>;
  return rows;
}

defineSheets({
  /* ── The reading of a résumé ───────────────────────────────────────────── */
  'cv.review': async (v, { viewer }) => {
    const [fileId, droppedOn] = v.split('|');
    const [f] = await db().select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!f || f.deletedAt) {
      return {
        title: 'That CV is gone',
        aria: 'CV intake',
        body: (
          <Banner tone="warn" icon="alert" title="Nothing to review"
            body="The file has been removed since it was uploaded." />
        ),
      };
    }

    const meta = (f.metadata ?? {}) as Intake;
    const p = meta.parsed;
    if (!p) {
      return {
        title: f.originalName,
        aria: 'CV intake',
        eyebrow: 'CV intake',
        body: (
          <Banner tone="warn" icon="alert" title="That file was stored but not read"
            body="Upload it again — the reading is done as the file arrives, and this one has none." />
        ),
      };
    }

    const jobId = droppedOn || meta.jobId || '';
    const kb = Math.max(1, Math.round(f.sizeBytes / 1024));
    const found = READOUT.filter((x) => p.fieldSources[x.k as string] !== 'not_found').length;
    const missingRequired = READOUT.filter(
      (x) => x.req && p.fieldSources[x.k as string] === 'not_found',
    );

    const [queue, matches] = await Promise.all([
      rowsOf(await db().execute(sql`
        SELECT count(*)::int AS n FROM ${files}
         WHERE kind = 'cv' AND owner_type = ${INTAKE_OWNER.ownerType}
           AND owner_id = ${INTAKE_OWNER.ownerId} AND deleted_at IS NULL
           AND coalesce(uploaded_by, '') = ${viewer.staffId ?? viewer.accountId ?? ''}
           AND coalesce(metadata ->> 'forForm', '') <> 'true'
           AND id <> ${fileId}
           AND NOT EXISTS (SELECT 1 FROM candidate_resumes r WHERE r.file_id = ${files.id})`)) as
        Array<{ n: number }>,
      fittable(viewer, p.skills),
    ]);
    const waiting = Number(queue[0]?.n ?? 0);

    return {
      title: 'New candidate from a CV',
      aria: 'CV intake',
      eyebrow: 'CV intake',
      wide: true,
      sub: 'Everything below was read off the file. Where it says the CV did not say, it did not — '
        + 'type it in. Then pick the requisitions this person should be considered for.',
      body: (
        <section className="cvitem">
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <span className="ibadge"><Icon name="file" size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{f.originalName}</b>
              <span className="t-foot">
                {' · '}{kb} KB{' · '}
                {p.hasTextLayer
                  ? `${fmt.int(meta.words ?? 0)} words · ${found} of ${READOUT.length} details found · `
                    + `read with ${Math.round(p.confidence * 100)}% confidence`
                  : 'no text layer — nothing to read'}
                {meta.readBy === 'ai' && ' · the assistant read it'}
                {f.scanState !== 'clean' && ` · ${f.scanState === 'skipped' ? 'not scanned' : `scan ${f.scanState}`}`}
              </span>
            </div>
            <Btn size="xs" variant="ghost" className="danger" action="cv.drop" v={fileId}
              icon="trash" iconSize={12}>Discard</Btn>
          </div>

          {!p.hasTextLayer && (
            <Banner tone="warn" icon="alert" title="This file has no text in it"
              body={`${f.originalName} is a scan or an exported image, so there is nothing to read `
                + 'automatically. Type the name and email below — the file is still kept against '
                + 'the record.'} />
          )}
          {p.hasTextLayer && missingRequired.length > 0 && (
            <Banner tone="warn" icon="alert"
              title={`${missingRequired.map((x) => x.label.toLowerCase()).join(' and ')} could not be read`}
              body="Type it in below. Everything else came off the CV as shown." />
          )}
          {meta.aiNote && (
            <Banner tone="info" icon="spark" title="How it was read" body={meta.aiNote} />
          )}
          {meta.duplicate && (
            <Banner tone="warn" icon="link"
              title={`Already on file as ${meta.duplicate.name}`}
              body={`Matched on ${meta.duplicate.matchedOn}. Adding will update their record and `
                + 'keep this CV as the current one rather than create a second person.'} />
          )}

          <div className="divider"><span className="t-over">
            What was read{p.sections.length ? ` · sections found: ${p.sections.join(', ')}` : ''}
          </span></div>
          <div className="form cvform">
            {READOUT.map((x) => {
              const src = p.fieldSources[x.k as string] ?? 'not_found';
              const raw = p[x.k];
              const name = FIELD_NAME[x.k] ?? String(x.k);
              const none = src === 'not_found';
              return (
                <div className={`field cvf${none ? ' none' : ''}`} key={name}>
                  <label htmlFor={`f_${name}`}>
                    {x.label}{x.req && ' *'}
                    <em className="cvsrc">{none ? 'not found' : `from ${SOURCE_LABEL[src] ?? src}`}</em>
                  </label>
                  <input className="inp" id={`f_${name}`} name={name}
                    type={x.type ?? 'text'} min={x.type === 'number' ? 0 : undefined}
                    defaultValue={raw == null ? '' : String(raw)}
                    placeholder={none ? 'the CV does not say' : ''} />
                </div>
              );
            })}
            {EXTRA.map((x) => (
              <div className="field cvf none" key={x.name}>
                <label htmlFor={`f_${x.name}`}>
                  {x.label}
                  <em className="cvsrc">not found</em>
                </label>
                <input className="inp" id={`f_${x.name}`} name={x.name} type="number" min={0}
                  step={x.step} placeholder="the CV does not say" />
              </div>
            ))}
          </div>

          <div className="divider"><span className="t-over">Skills found ({p.skills.length})</span></div>
          <div className="wrap">
            {p.skills.length
              ? p.skills.map((s) => (
                <label className="chip" key={s}>
                  <input type="checkbox" name="skills" value={s} defaultChecked />
                  {s}
                </label>
              ))
              : <span className="t-foot">None of the known skills appeared in the text.</span>}
          </div>

          {p.experience.length > 0 && (
            <>
              <div className="divider"><span className="t-over">
                Work history read off the CV ({p.experience.length})
              </span></div>
              <div className="list flush">
                {p.experience.slice(0, 5).map((e, i) => (
                  <Li key={i} icon="brief" title={`${e.title}${e.company ? ` · ${e.company}` : ''}`}
                    sub={`${e.from ?? '—'} – ${e.to ?? 'Present'}`
                      + (e.bullets[0] ? ` · ${e.bullets[0].slice(0, 90)}` : '')} />
                ))}
              </div>
            </>
          )}

          {p.education.length > 0 && (
            <>
              <div className="divider"><span className="t-over">Education</span></div>
              <div className="wrap">
                {p.education.map((e, i) => (
                  <Chip key={i}>
                    {e.degree}{e.school ? ` — ${e.school}` : ''}{e.year ? `, ${e.year}` : ''}
                  </Chip>
                ))}
              </div>
            </>
          )}

          <div className="divider"><span className="t-over">
            Requisitions this CV fits <Icon name="target" size={12} />
          </span></div>
          {matches.length ? (
            <div>
              {matches.slice(0, 8).map((m) => {
                const on = m.id === jobId;
                const pct = m.asked ? Math.round((Number(m.matched) / Number(m.asked)) * 100) : null;
                return (
                  <label className="cvmatch" key={m.id}>
                    <input type="checkbox" name="jobIds" value={m.id} defaultChecked={on} />
                    <span>
                      <b>{m.title}</b>
                      <span className="t-foot">
                        {m.dept ?? '—'}
                        {on ? ' · dropped on this requisition'
                          : pct == null ? ' · no skill bar to score against'
                            : ` · ${m.matched} of ${m.asked} skills asked for (${pct}%)`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="t-foot">
              No open requisition you can see is asking for these skills — they can still join the
              talent pool.
            </p>
          )}

          {/* What the command needs that the person does not type. */}
          <input type="hidden" name="fileId" value={fileId} />
          <input type="hidden" name="parsed" value={JSON.stringify(p)} />
          <input type="hidden" name="readBy" value={meta.readBy ?? 'local'} />
          {meta.duplicate && (
            <div className="field wide" style={{ marginTop: 10 }}>
              <label htmlFor="f_useExisting">Is this the same person?</label>
              <select className="inp" id="f_useExisting" name="useExisting"
                defaultValue={meta.duplicate.id}>
                <option value={meta.duplicate.id}>
                  Yes — update {meta.duplicate.name} and keep this CV
                </option>
                <option value="">No — this is somebody else</option>
              </select>
              <span className="help">
                Choosing “somebody else” creates a second record with the same email, which the
                duplicate rule will refuse unless you mean it.
              </span>
            </div>
          )}
        </section>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <span className="t-foot">
            {waiting ? `${waiting} more waiting` : 'the last one'}
          </span>
          <Btn variant="pri" action="cv.create" v={fileId} icon="uplus" iconSize={14}>
            Add candidate
          </Btn>
        </>
      ),
    };
  },

  /* ── The department spreadsheet, before anything is written ────────────── */
  'mp.importPreview': async (v, { viewer }) => {
    if (!can(viewer, 'plan.import')) {
      return {
        title: 'Import a department',
        aria: 'Import preview',
        body: (
          <Banner tone="warn" icon="lock" title="Only an Admin imports a department"
            body="An import creates seats, and seats are headcount." />
        ),
      };
    }

    const [f] = await db().select().from(files).where(eq(files.id, v)).limit(1);
    if (!f || f.deletedAt) {
      return {
        title: 'That file is gone',
        aria: 'Import preview',
        body: <Banner tone="warn" icon="alert" title="Nothing to import"
          body="Drop the spreadsheet again." />,
      };
    }

    /* The reading is done again from the stored bytes rather than trusted from
       the browser: what is imported is what is in the file. */
    const { readGrid } = await import('@/lib/domain/sheet');
    const { readPlanGrid } = await import('@/lib/services/manpower');
    const { storageAdapter } = await import('@/lib/providers');
    const got = await storageAdapter().get(f.storageKey);
    if (!got.ok) {
      return {
        title: f.originalName,
        aria: 'Import preview',
        body: <Banner tone="bad" icon="alert" title="The file could not be read back"
          body={got.message} />,
      };
    }

    let plan: ReadPlan;
    try {
      plan = readPlanGrid(readGrid(f.originalName, f.contentType, got.detail!.bytes));
    } catch (e) {
      return {
        title: f.originalName,
        aria: 'Import preview',
        body: (
          <Banner tone="bad" icon="alert" title="That sheet could not be read"
            body={e instanceof Error ? e.message : 'The columns were not understood'} />
        ),
        foot: <><Sp /><Btn variant="out" action="mp.import">Try another file</Btn></>,
      };
    }

    const [fns, existing] = await Promise.all([
      db().select({ id: functions.id, name: functions.name })
        .from(functions).orderBy(asc(functions.sortOrder)),
      db().select({ name: departments.name }).from(departments)
        .where(isNull(departments.archivedAt)),
    ]);
    const have = new Set(existing.map((d) => d.name.toLowerCase()));
    const seats = plan.departments.reduce((n, d) => n + d.rows.length, 0);

    return {
      title: `${f.originalName} — ${seats} seat${seats === 1 ? '' : 's'}`,
      aria: 'Import preview',
      eyebrow: 'Manpower plan',
      wide: true,
      sub: 'Nothing has been written yet. Each department is imported on its own, so a file with '
        + 'three in it is three decisions — and a seat arrives as requested headcount, not as '
        + 'budget.',
      body: (
        <div className="stack">
          {plan.unknownColumns.length > 0 && (
            <Banner tone="info" icon="alert"
              title={`${plan.unknownColumns.length} column${plan.unknownColumns.length === 1 ? '' : 's'} `
                + 'not used'}
              body={`${plan.unknownColumns.join(', ')} — the importer reads `
                + `${IMPORT_COLUMNS.map((c) => c.key).join(', ')}.`} />
          )}
          {plan.dropped.length > 0 && (
            <Banner tone="warn" icon="alert"
              title={`${plan.dropped.length} row${plan.dropped.length === 1 ? '' : 's'} left out`}
              body={plan.dropped.slice(0, 6).map((d) => `row ${d.row}: ${d.why}`).join('; ')
                + (plan.dropped.length > 6 ? ` and ${plan.dropped.length - 6} more` : '')} />
          )}

          {plan.departments.map((d, i) => {
            const filled = d.rows.filter((r) => r.holder).length;
            const known = d.name && have.has(d.name.toLowerCase());
            return (
              <Card key={i} title={d.name || 'The department in this file'} icon="grid"
                actions={<Chip tone={known ? 'info' : 'brand'}>
                  {known ? 'Exists — seats are added' : 'New department'}
                </Chip>}>
                <div className="form">
                  <Field label="Department name" name={`deptName_${i}`} value={d.name} req
                    className="wide" placeholder="e.g. Compliance"
                    help={known ? 'A department of this name already exists; its seats are added to.'
                      : 'Created as part of the import.'} />
                  <Field label="Short code" name={`deptCode_${i}`} value=""
                    placeholder="e.g. CMP" help="Position codes are issued from it." />
                  <Field label="Function" name={`functionId_${i}`} type="select" value=""
                    options={[{ v: '', t: 'Not on the company chart yet' },
                      ...fns.map((x) => ({ v: x.id, t: x.name }))]}
                    help={d.functionName ? `The sheet says "${d.functionName}".` : undefined} />
                </div>

                <Kvs pairs={[
                  ['Seats', String(d.rows.length)],
                  ['Already filled', filled ? `${filled} — the holders are created as employees` : 'None'],
                  ['Reporting lines', d.orphans.length
                    ? `${d.orphans.length} point at a seat this file does not have: ${d.orphans.slice(0, 3).join(', ')}`
                    : 'All resolve inside the file'],
                ]} />

                <div className="tw" style={{ marginTop: 10 }}>
                  <table className="t" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Position</th><th>Reports to</th><th>Grade</th>
                        <th>Heads</th><th>Holder</th><th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.slice(0, 25).map((r, k) => (
                        <tr key={k}>
                          <td>{r.title}</td>
                          <td className="mut">{r.reportsTo || '— top of the chart'}</td>
                          <td>{r.grade || 'P3'}</td>
                          <td>{r.approved ?? 1}</td>
                          <td className="mut">{r.holder || 'vacant'}</td>
                          <td className="mut">{r.location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.rows.length > 25 && (
                  <p className="t-foot">and {d.rows.length - 25} more, all of which are imported.</p>
                )}

                <input type="hidden" name={`rows_${i}`} value={JSON.stringify(d.rows)} />
                <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                  <Btn variant="pri" size="sm" action="mp.importCreate" v={`${v}|${i}`}
                    icon="upload" iconSize={13}>
                    Import {d.name || 'this department'}
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Close</Btn>
          <Sp />
          <span className="t-foot">
            {plan.rows} row{plan.rows === 1 ? '' : 's'} read · nothing is written until you import
          </span>
        </>
      ),
    };
  },
});
