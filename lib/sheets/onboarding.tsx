import 'server-only';
import * as React from 'react';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  employees, onboardingRecords, references as employeeReferences, onboardingDocuments, probationRecords,
  notifiedTeams, notifiedTeamContacts, departments, jobs, orgSettings,
} from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Card, Kvs } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { progress, RATINGS } from '@/lib/services/joiner';
import { PROBATION_REASONS } from '@/lib/domain/probation';
import { fmt } from '@/lib/format';
import { allLocations, desk } from './blocks';

/* ═════════════════════════════════════════════════════════════════════════════
   THE JOINER SHEETS

   The joiner's own record, the details they filled in, their referees, the
   joining notice, the file to IT and HR, and the probation review.

   The joining notice is the one to read twice. Fixing the date has four
   consequences — the joiner, the application, the probation clock and the
   back-office teams — and the service does all four in one transaction. The
   offer is deliberately not among them: the letter the candidate signed says
   what it says.
   ═════════════════════════════════════════════════════════════════════════════*/

const RELATIONSHIPS = [
  'Former line manager', 'Former manager', 'Team lead', 'HR business partner',
  'Client', 'Colleague', 'Academic referee',
];

async function joinerOf(employeeId: string) {
  const [row] = rowsOf(await db().execute(sql`
    SELECT e.id, e.name, e.employee_code, e.title, e.start_date, e.dept_id, e.job_id,
           e.status::text AS status, d.name AS dept, j.title AS job_title, j.hiring_manager
      FROM ${employees} e
      LEFT JOIN ${departments} d ON d.id = e.dept_id
      LEFT JOIN ${jobs} j ON j.id = e.job_id
     WHERE e.id = ${employeeId}`)) as Array<{
       id: string; name: string; employee_code: string; title: string; start_date: string;
       dept_id: string; job_id: string | null; status: string; dept: string | null;
       job_title: string | null; hiring_manager: string | null;
     }>;
  return row ?? null;
}

defineSheets({
  /* ── The joiner's record ──────────────────────────────────────────────── */
  'emp.open': async (v) => {
    const e = await joinerOf(v);
    if (!e) return null;
    const [p, docs, refs, prob] = await Promise.all([
      progress(v, db()),
      db().select().from(onboardingDocuments).where(eq(onboardingDocuments.employeeId, v))
        .orderBy(asc(onboardingDocuments.sortOrder)),
      db().select().from(employeeReferences).where(eq(employeeReferences.employeeId, v))
        .orderBy(asc(employeeReferences.createdAt)),
      db().select().from(probationRecords).where(eq(probationRecords.employeeId, v)).limit(1),
    ]);

    return {
      title: e.name,
      aria: `Joiner — ${e.name}`,
      eyebrow: e.employee_code,
      wide: true,
      sub: `${e.title}${e.dept ? ` · ${e.dept}` : ''} — starts ${fmt.date(e.start_date)}.`,
      body: (
        <div className="stack">
          <Card title="The hire" icon="badge">
            <Kvs pairs={[
              ['Employee number', e.employee_code],
              ['Requisition', e.job_title ?? '—'],
              ['Hiring manager', e.hiring_manager ?? '—'],
              ['Department', e.dept ?? '—'],
              ['Starts', fmt.date(e.start_date)],
              ['Status', e.status.replace('_', ' ')],
            ]} />
          </Card>

          <Card title="Onboarding" icon="check"
            sub={`${p.verified} of ${p.total} document${p.total === 1 ? '' : 's'} verified`
              + `${p.uploaded ? `, ${p.uploaded} waiting to be checked` : ''}.`}>
            <div className="list flush">
              {docs.map((d) => (
                <Li key={d.id} icon={d.status === 'verified' ? 'check' : d.status === 'rejected' ? 'x' : 'upload'}
                  iconTone={d.status === 'verified' ? 'ok' : d.status === 'rejected' ? 'bad' : ''}
                  title={d.label}
                  sub={d.status === 'missing' ? 'Not uploaded yet'
                    : d.status === 'uploaded' ? 'Waiting to be checked'
                      : d.status === 'rejected' ? (d.rejectedReason ?? 'Sent back')
                        : `Verified ${d.verifiedAt ? fmt.date(d.verifiedAt) : ''}`} />
              ))}
            </div>
          </Card>

          <Card title="References" icon="users"
            sub={refs.length ? `${refs.filter((r) => r.status === 'done').length} of ${refs.length} back.`
              : 'Nobody named yet.'}
            actions={<Btn size="xs" variant="pri" action="ref.add" v={v} icon="plus" iconSize={12}>
              Add a referee
            </Btn>}>
            {refs.length ? (
              <div className="list flush">
                {refs.map((r) => (
                  <Li key={r.id} icon={r.rating === 'up' ? 'thumbUp' : r.rating === 'down' ? 'thumbDown' : r.rating === 'star' ? 'star' : 'users'}
                    iconTone={r.rating === 'up' || r.rating === 'star' ? 'ok' : r.rating === 'down' ? 'bad' : ''}
                    title={r.name}
                    sub={`${r.relationship ?? 'Referee'}${r.company ? ` · ${r.company}` : ''} · ${
                      r.status === 'done' ? (r.rating ? RATINGS[r.rating]?.label ?? 'Answered' : 'Answered')
                        : r.status === 'contacted' ? 'Contacted — waiting' : 'Not contacted yet'}`}
                    action="ref.rate" v={r.id} />
                ))}
              </div>
            ) : (
              <Empty icon="users" title="No referees yet"
                sub="Two former managers is the usual ask." />
            )}
          </Card>

          {!!prob.length && (
            <Card title="Probation" icon="shield"
              sub={`${prob[0].state.replace('_', ' ')} — ends ${fmt.date(prob[0].endsOn)}.`}
              foot={prob[0].state === 'in_progress'
                ? <Btn size="sm" variant="out" action="prob.open" v={v}>Record the decision</Btn>
                : undefined}>
              <Kvs pairs={[
                ['Started', fmt.date(prob[0].startsOn)],
                ['Three months up', fmt.date(prob[0].endsOn)],
                ['Decision', prob[0].state === 'in_progress' ? 'Not taken yet' : prob[0].state],
                prob[0].reason ? ['Why', prob[0].reason] : null,
              ]} />
            </Card>
          )}
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="emp.formEdit" v={v} icon="pencil" iconSize={13}>
            Joiner details
          </Btn>
          <Sp />
          <Btn variant="out" action="onb.notify" v={v} icon="cal" iconSize={13}>Joining notice</Btn>
          <Btn variant="pri" action="onb.file" v={v} icon="mail" iconSize={13}>Send the file</Btn>
        </>
      ),
    };
  },

  /* ── What the joiner filled in ────────────────────────────────────────── */
  'emp.formEdit': async (v, { viewer }) => {
    const e = await joinerOf(v);
    if (!e) return null;
    const [form] = await db().select().from(onboardingRecords)
      .where(eq(onboardingRecords.employeeId, v)).limit(1);

    const may = viewer.isAdmin || viewer.staffRole === 'onboarding';
    if (!may) {
      return {
        title: `Joiner details — ${e.name}`,
        aria: 'Joiner details',
        eyebrow: e.employee_code,
        body: (
          <Banner tone="warn" icon="lock"
            title="Only the Onboarding Specialist or an Admin edits joiner details"
            body="These are the figures payroll and government relations work from, so corrections
              go through one desk." />
        ),
      };
    }

    return {
      title: `Joiner details — ${e.name}`,
      aria: 'Edit joiner details',
      eyebrow: e.employee_code,
      sub: form?.formSubmittedAt
        ? `Filled in by ${e.name.split(/\s+/)[0]} on ${fmt.date(form.formSubmittedAt!)}. Corrections are `
          + 'recorded against your name.'
        : 'Not filled in yet — the joiner has a link, and you can type what you have in the meantime.',
      body: (
        <div className="form">
          <Field label="National ID / Iqama number" name="nationalId" value={form?.nationalId ?? ''} />
          <Field label="Nationality" name="nationality" value={form?.nationality ?? ''} />
          <Field label="Date of birth" name="dob" type="date" value={form?.dob ?? ''} />
          <Field label="Bank" name="bank" value={form?.bank ?? ''} />
          <Field label="IBAN" name="iban" value={form?.iban ?? ''} className="wide"
            help="Saudi IBANs are SA followed by twenty-two digits; it is checked before it is saved." />
          <Field label="Address" name="address" value={form?.address ?? ''} className="wide" />
          <Field label="Emergency contact" name="emergency" value={form?.emergencyContact ?? ''}
            className="wide" placeholder="Name, relationship and a number" />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="emp.formSave" v={v}>Save</Btn>
        </>
      ),
    };
  },

  /* ── A referee ────────────────────────────────────────────────────────── */
  'ref.add': async (v) => {
    const e = await joinerOf(v);
    if (!e) return null;
    return {
      title: 'Add a referee',
      aria: 'Referee',
      eyebrow: e.name,
      sub: 'Who did the joiner name? Former managers carry the most weight.',
      body: (
        <div className="form">
          <Field label="Referee" name="r_name" req placeholder="Full name" />
          <Field label="Title" name="r_title" placeholder="e.g. Sales Manager" />
          <Field label="Company" name="r_company" placeholder="e.g. Property Finder" />
          <Field label="Relationship" name="r_rel" type="select" value={RELATIONSHIPS[0]}
            options={RELATIONSHIPS.map((x) => ({ v: x, t: x }))} />
          <Field label="Phone or e-mail" name="r_contact" placeholder="+9665… or name@company.com" />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="ref.create" v={v} icon="check" iconSize={14}>Add referee</Btn>
        </>
      ),
    };
  },

  /* ── What the referee said ────────────────────────────────────────────── */
  'ref.rate': async (v) => {
    const [r] = await db().select().from(employeeReferences)
      .where(eq(employeeReferences.id, v)).limit(1);
    if (!r) return null;
    const e = await joinerOf(r.employeeId);

    return {
      title: `Reference — ${r.name}`,
      aria: 'Referee',
      eyebrow: e?.name,
      sub: 'Record what the referee said and rate the reference — thumbs up, thumbs down or a star.',
      body: (
        <>
          <div className="form">
            <Field label="Referee" name="r_name" value={r.name} req placeholder="Full name" />
            <Field label="Title" name="r_title" value={r.title ?? ''} placeholder="e.g. Sales Manager" />
            <Field label="Company" name="r_company" value={r.company ?? ''} />
            <Field label="Relationship" name="r_rel" type="select"
              value={r.relationship ?? RELATIONSHIPS[0]}
              options={RELATIONSHIPS.map((x) => ({ v: x, t: x }))} />
            <Field label="Phone or e-mail" name="r_contact" value={r.contact ?? ''} />
            <Field label="Status" name="r_status" type="select" value={r.status}
              options={[
                { v: 'pending', t: 'Not contacted yet' },
                { v: 'contacted', t: 'Contacted — waiting' },
                { v: 'done', t: 'Answered — record the outcome' },
                { v: 'declined', t: 'Would not give a reference' },
              ]}
              help="A referee who declines is an outcome, not a gap — recording it is what
                stops the file waiting on somebody who is never going to answer." />
          </div>

          <div className="divider"><span className="t-over">Outcome</span></div>
          <div className="ratepick">
            {(['up', 'star', 'down'] as const).map((k) => (
              <label className={`rateopt${r.rating === k ? ' on' : ''}`} key={k}>
                <input type="radio" name="r_rating" value={k} defaultChecked={r.rating === k} />
                <Icon name={k === 'up' ? 'thumbUp' : k === 'star' ? 'star' : 'thumbDown'} size={15} />
                <b>{RATINGS[k]?.label ?? k}</b>
                <em>{RATINGS[k]?.text ?? ''}</em>
              </label>
            ))}
          </div>

          <div className="form" style={{ marginTop: 10 }}>
            <Field label="What they said" name="r_notes" type="textarea" rows={4} className="wide"
              value={r.notes ?? ''}
              placeholder="Dates and title confirmed? Would they rehire? Anything to watch for?" />
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="ref.save" v={v} icon="check" iconSize={14}>Save reference</Btn>
        </>
      ),
    };
  },

  /* ── The joining notice ───────────────────────────────────────────────── */
  'onb.notify': async (v) => {
    const e = await joinerOf(v);
    if (!e) return null;
    const teams = await db().select().from(notifiedTeams)
      .where(and(isNull(notifiedTeams.archivedAt), eq(notifiedTeams.onJoining, true)))
      .orderBy(asc(notifiedTeams.sortOrder));
    const counts = rowsOf(await db().execute(sql`
      SELECT team_id, count(*)::int AS n FROM ${notifiedTeamContacts} GROUP BY team_id`)) as
      Array<{ team_id: string; n: number }>;
    const per = Object.fromEntries(counts.map((c) => [c.team_id, Number(c.n)]));

    return {
      title: 'Confirm the joining date',
      aria: 'Joining notice',
      eyebrow: `${e.name} · ${e.employee_code}`,
      sub: 'Fixing the date moves the joiner, the application and the probation clock together, and '
        + 'tells the back office. The signed offer letter is deliberately left alone — if the offer '
        + 'itself has to change, that is a new version.',
      body: (
        <>
          <div className="form">
            <Field label="Joining date" name="join_date" type="date" req className="wide"
              value={e.start_date}
              help="Sunday to Thursday is the working week." />
          </div>
          <div className="divider"><span className="t-over">Who is told</span></div>
          {teams.length ? (
            <div className="list flush">
              {teams.map((t) => (
                <label className="li" key={t.id}>
                  <span className="ic"><Icon name="users" size={15} /></span>
                  <span className="bd">
                    <b>{t.name}</b>
                    <span>
                      {per[t.id] ?? 0} contact{(per[t.id] ?? 0) === 1 ? '' : 's'}
                      {t.purpose ? ` · ${t.purpose}` : ''}
                    </span>
                  </span>
                  <span className="tr">
                    <input type="checkbox" name="notify" value={t.key} defaultChecked />
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <Banner tone="warn" icon="alert" title="No team is set to be told"
              body="Add one under Settings → Notified teams — otherwise nobody hears about a joiner." />
          )}
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="onb.notifySend" v={v} icon="mail" iconSize={14}>
            Confirm and notify
          </Btn>
        </>
      ),
    };
  },

  /* ── The file to IT and HR ────────────────────────────────────────────── */
  'onb.file': async (v) => {
    const e = await joinerOf(v);
    if (!e) return null;
    const teams = await db().select().from(notifiedTeams)
      .where(and(isNull(notifiedTeams.archivedAt), eq(notifiedTeams.onFile, true)))
      .orderBy(asc(notifiedTeams.sortOrder));
    const docs = await db().select().from(onboardingDocuments)
      .where(and(eq(onboardingDocuments.employeeId, v), sql`status <> 'missing'`));
    const missing = await db().select().from(onboardingDocuments)
      .where(and(eq(onboardingDocuments.employeeId, v), sql`status = 'missing'`));

    return {
      title: 'Send the joiner file',
      aria: 'Send joiner file',
      eyebrow: `${e.name} · ${e.employee_code}`,
      sub: `${docs.length} document${docs.length === 1 ? '' : 's'} on file`
        + `${missing.length ? `, ${missing.length} still outstanding` : ''}. The file goes to `
        + 'whichever teams you tick, with what is there today.',
      body: (
        <>
          {!!missing.length && (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="warn" icon="alert"
                title={`${missing.length} document${missing.length === 1 ? '' : 's'} not in yet`}
                body={`${missing.map((d) => d.label).join(', ')}. Sending now is fine — the file says
                  what is missing — but the back office will ask.`} />
            </div>
          )}
          {teams.length ? (
            <div className="list flush">
              {teams.map((t) => (
                <label className="li" key={t.id}>
                  <span className="ic"><Icon name="mail" size={15} /></span>
                  <span className="bd"><b>{t.name}</b><span>{t.purpose ?? 'Receives the joiner file'}</span></span>
                  <span className="tr">
                    <input type="checkbox" name="teams" value={t.key} defaultChecked />
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <Banner tone="warn" icon="alert" title="Nobody is set to receive the joiner file"
              body="Add a team under Settings → Notified teams." />
          )}
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="onb.fileSend" v={v} icon="mail" iconSize={14}>Send the file</Btn>
        </>
      ),
    };
  },

  /* ── The probation review ─────────────────────────────────────────────── */
  'prob.open': async (v) => {
    const e = await joinerOf(v);
    if (!e) return null;
    const [p] = await db().select().from(probationRecords)
      .where(eq(probationRecords.employeeId, v)).limit(1);
    if (!p) return null;

    const now = new Date();
    const left = Math.ceil(
      (new Date(p.endsOn).getTime() - now.getTime()) / 86_400_000,
    );

    return {
      title: `Probation review — ${e.name}`,
      aria: 'Probation review',
      wide: true,
      eyebrow: e.title,
      sub: `Started ${fmt.date(e.start_date)}, three months up ${fmt.date(p.endsOn)}`
        + `${left < 0 ? ` — ${Math.abs(left)} days ago` : ` — ${left} days from now`}. Confirming is `
        + 'what makes this hire count towards quality of hire; not confirming records why.',
      body: (
        <div className="stack">
          <Card title="The hire" icon="badge">
            <Kvs pairs={[
              ['Joiner', `${e.name} · ${e.title}`],
              ['Requisition', e.job_title ?? '—'],
              ['Department', e.dept ?? '—'],
              ['Hiring manager', e.hiring_manager ?? '—'],
              ['Started', fmt.date(e.start_date)],
              ['Three months up', fmt.date(p.endsOn)],
            ]} />
          </Card>
          <div className="form">
            <Field label="The decision" name="outcome" type="select"
              value={p.state === 'failed' ? 'fail' : 'pass'} action="prob.pick"
              options={[
                { v: 'pass', t: 'Confirmed — they passed the three months' },
                { v: 'fail', t: 'Not confirmed — they are leaving' },
              ]} />
            <div id="pbwhy" hidden={p.state !== 'failed'}>
              <Field label="Why" name="reason" type="select"
                value={p.reason ?? PROBATION_REASONS[0]}
                options={PROBATION_REASONS.map((x) => ({ v: x, t: x }))} />
            </div>
            <Field label="Note" name="note" type="textarea" rows={3} className="wide"
              value={p.note ?? ''}
              placeholder="What the hiring manager said at the review."
              help="Kept on the record and read back in the quality-of-hire analysis." />
          </div>
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="prob.save" v={v} icon="check" iconSize={14}>
            Record the decision
          </Btn>
        </>
      ),
    };
  },
});
