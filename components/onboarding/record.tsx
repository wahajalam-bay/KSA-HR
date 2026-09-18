import * as React from 'react';
import { Card, Kvs, Chip, Li, Avatar, Btn, Sp } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import { can } from '@/lib/authz';
import { RATINGS, DOC_HINTS, type Joiner, type Team } from '@/lib/queries/onboarding';
import { ProbationCard, ProbationChip } from './probation';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   One joiner's record: the form, the four documents, the referees, the joining
   date and who was told about it, the file sent on to IT and HR, and the three
   months that decide whether this counts as a good hire.
   ───────────────────────────────────────────────────────────────────────────*/

export function RateBadge({ rating, size = 'sm' }: { rating: string; size?: 'sm' | 'lg' }) {
  const r = RATINGS[rating];
  if (!r) return null;
  return (
    <span className={`rbadge ${rating} ${size}`} title={`${r.label} — ${r.text}`}>
      <Icon name={r.icon as any} size={size === 'lg' ? 18 : 13} />
      <span>{r.text}</span>
    </span>
  );
}

function StatusChipFor({ e }: { e: Joiner }) {
  return e.status === 'active' ? <Chip tone="ok">Started</Chip>
    : e.completedAt ? <Chip tone="ok">Ready for day one</Chip>
      : <Chip tone="warn">In progress</Chip>;
}

function FormKvs({ e }: { e: Joiner }) {
  if (!e.form.submittedAt) {
    return (
      <p className="t-foot">
        <Icon name="clock" size={12} /> The joiner has not submitted the form yet
        {e.form.sentAt ? ` — sent ${ago(e.form.sentAt, new Date())}` : ''}.
      </p>
    );
  }
  return (
    <Kvs pairs={[
      ['National ID / Iqama', <span key="n" className="mono">{e.form.nationalId}</span>],
      ['Nationality', e.form.nationality],
      ['Date of birth', fmt.date(e.form.dob)],
      ['Address', e.form.address],
      ['Emergency contact', e.form.emergencyContact],
      ['Bank', e.form.bank],
      ['IBAN', <span key="i" className="mono">{e.form.iban}</span>],
    ]} />
  );
}

export function DocsList({ e, viewer, compact }: { e: Joiner; viewer: Viewer; compact?: boolean }) {
  const may = can(viewer, 'onboarding.verify');
  const chip = (s: string) => (s === 'verified' ? <Chip tone="ok">Verified</Chip>
    : s === 'uploaded' ? <Chip tone="warn">Uploaded</Chip> : <Chip tone="bad">Missing</Chip>);
  return (
    <div className="list flush">
      {e.documents.map((d) => (
        <Li key={d.key}
          icon={d.status === 'verified' ? 'check' : d.status === 'uploaded' ? 'file' : 'upload'}
          iconTone={d.status === 'verified' ? 'brand' : ''}
          title={d.label}
          sub={d.status === 'missing' ? (DOC_HINTS[d.key] ?? '')
            : `${d.file ?? ''}${d.uploadedAt ? ` · uploaded ${ago(d.uploadedAt, new Date())}` : ''}${d.verifiedAt ? ` · verified by ${d.verifiedByName ?? '—'} ${ago(d.verifiedAt, new Date())}` : ''}`}
          right={
            <span className="row tight">
              {chip(d.status)}
              {!compact && (
                <>
                  <label className="btn xs out dz-inline" data-dz={`emp.doc:${e.id}:${d.key}`}>
                    <Icon name="upload" size={12} /> {d.status === 'missing' ? 'Attach' : 'Replace'}
                    <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png" />
                  </label>
                  {d.status === 'uploaded' && may && (
                    <Btn size="xs" variant="pri" action={`emp.verify:${e.id}`} v={d.key} icon="check" iconSize={12}>Verify</Btn>
                  )}
                  {d.status === 'verified' && may && (
                    <Btn size="xs" variant="ghost" action={`emp.unverify:${e.id}`} v={d.key}>Re-check</Btn>
                  )}
                </>
              )}
            </span>
          } />
      ))}
    </div>
  );
}

/* The joining date, fixed by TA and announced to the departments that prepare
   for day one. Confirming it e-mails everyone ticked. */
function JoiningBlock({ e, teams, viewer, now }: {
  e: Joiner; teams: Team[]; viewer: Viewer; now: Date;
}) {
  const n = e.notice;
  const may = !viewer.isPortal;
  const already = n ? n.teams.map((t) => t.key) : null;
  const on = (t: Team) => (already ? already.includes(t.key) : t.onJoining);

  return (
    <div className={`jbox${n ? ' sent' : ''}`}>
      <div className="row tight" style={{ justifyContent: 'space-between' }}>
        <span className="t-over">
          Joining date {n ? <Chip tone="ok">Confirmed</Chip> : <Chip tone="warn">To confirm</Chip>}
        </span>
        {n && (
          <span className="t-foot">
            notice sent {ago(n.at, now)}{n.again ? ` · sent ${n.again + 1}×` : ''} by {fmt.first(n.byName ?? '')}
          </span>
        )}
      </div>

      {may ? (
        <form className="jform" onSubmit={undefined}>
          <div className="row tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <input type="date" className="inp" name="join_date" defaultValue={e.startDate.slice(0, 10)}
              style={{ width: 'auto' }} aria-label="Joining date" />
            <Btn size="sm" variant="pri" action="onb.notify" v={e.id} icon="mail" iconSize={13}>
              {n ? (e.startDate.slice(0, 10) === String(n.startDate).slice(0, 10) ? 'Send again' : 'Confirm new date & notify') : 'Confirm & notify'}
            </Btn>
          </div>
          <div className="t-over" style={{ margin: '10px 0 5px' }}>
            Notify{teams.length ? '' : ' — no teams set up'}
          </div>
          <div className="row tight" style={{ flexWrap: 'wrap' }}>
            {teams.map((t) => (
              <label key={t.key} className={`tchk${on(t) ? ' on' : ''}`}
                title={`${t.purpose ?? ''}${t.contacts.length ? ` — ${t.contacts.map((c) => c.name).join(', ')}` : ''}`}>
                <input type="checkbox" name="notify" value={t.key} defaultChecked={on(t)} />
                <b>{t.short}</b>
                <span>{t.contacts.length ? `${t.contacts.length} ${t.contacts.length === 1 ? 'person' : 'people'}` : 'nobody listed'}</span>
              </label>
            ))}
            <Btn size="xs" variant="ghost" action="go" v="/settings?tab=teams" icon="gear" iconSize={12}
              title="Maintain the teams and their e-mails">Teams</Btn>
          </div>
        </form>
      ) : (
        <p className="t-foot" style={{ marginTop: 6 }}>
          {n ? `Confirmed for ${fmt.date(n.startDate)}.` : 'The TA team confirms the date.'}
        </p>
      )}

      {!!n?.teams.length && (
        <div className="row tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {n.teams.map((t) => (
            <span key={t.key} className="ntag" title={t.head ?? ''}>
              <Icon name="check" size={11} /> {t.short}
            </span>
          ))}
        </div>
      )}

      <p className="t-foot" style={{ margin: '6px 0 0' }}>
        {n
          ? `${fmt.date(n.startDate)} went to ${fmt.list(n.teams.map((t) => t.head ?? t.name))}.`
          : 'Confirming the date e-mails everyone ticked above — each team gets what it needs to have ready for day one.'}
      </p>
    </div>
  );
}

function ReferencesBlock({ e, viewer, now }: { e: Joiner; viewer: Viewer; now: Date }) {
  const may = !viewer.isPortal;
  return (
    <>
      {e.references.length ? (
        <div className="list flush">
          {e.references.map((r) => (
            <Li key={r.id} avatar={r.name}
              title={<>{r.name} <span className="mut" style={{ fontWeight: 500 }}>· {r.title ?? ''}{r.company ? `, ${r.company}` : ''}</span></>}
              sub={
                <>
                  {r.relationship ?? 'Referee'} · {r.contact ?? '—'}
                  {r.status === 'done' && r.answeredAt
                    ? ` · answered ${ago(r.answeredAt, now)}${r.recordedByName ? ` to ${fmt.first(r.recordedByName)}` : ''}`
                    : r.status === 'contacted' ? ' · contacted, waiting for the reply'
                      : ' · not contacted yet'}
                  {r.notes && <><br /><span className="quote">“{r.notes}”</span></>}
                </>
              }
              right={
                <span className="row tight">
                  {r.status === 'done' && r.rating
                    ? <RateBadge rating={r.rating} />
                    : <Chip tone="warn">{r.status === 'contacted' ? 'Contacted' : 'Pending'}</Chip>}
                  {may && (
                    <>
                      {r.status === 'pending' && (
                        <Btn size="xs" variant="out" action={`ref.status:${e.id}:${r.id}`} v="contacted"
                          icon="phone" iconSize={12}>Contacted</Btn>
                      )}
                      {r.status !== 'done'
                        ? <Btn size="xs" variant="pri" action={`ref.rate:${e.id}`} v={r.id} icon="check" iconSize={12}>Record the reference</Btn>
                        : <Btn size="xs" variant="ghost" action={`ref.rate:${e.id}`} v={r.id}>Edit</Btn>}
                      <Btn size="xs" variant="ghost" className="danger" action={`ref.remove:${e.id}`} v={r.id}
                        ariaLabel="Remove referee" icon="trash" iconSize={12} />
                    </>
                  )}
                </span>
              } />
          ))}
        </div>
      ) : (
        <p className="t-foot">
          No referee on file yet.{' '}
          {may ? 'Add the people the joiner named on their application or CV — two is the norm.'
            : 'The TA team is collecting them.'}
        </p>
      )}
      {may && (
        <div className="row tight" style={{ marginTop: 10 }}>
          <Btn size="sm" variant="out" action="ref.add" v={e.id} icon="uplus" iconSize={13}>Add referee</Btn>
          <span className="t-foot">
            Each reference is rated <b>thumbs up</b> (positive), <b>thumbs down</b> (a concern) or a{' '}
            <b>star</b> (outstanding); the checklist needs every referee answered.
          </span>
        </div>
      )}
    </>
  );
}

function FilesBlock({ e, teams, viewer, now }: { e: Joiner; teams: Team[]; viewer: Viewer; now: Date }) {
  const may = !viewer.isPortal;
  const fileTeams = teams.filter((t) => t.onFile);
  const missing = e.progress.total - e.progress.uploaded;
  return (
    <>
      <div className="list flush">
        {fileTeams.map((t) => {
          const sent = e.fileSent[t.key];
          return (
            <Li key={t.key} icon={sent ? 'check' : 'mail'} iconTone={sent ? 'brand' : ''} title={t.name}
              sub={sent
                ? `Sent ${ago(sent.at, now)} by ${fmt.first(sent.byName ?? '')} to ${sent.to ?? t.name}${sent.people > 1 ? ` and ${sent.people - 1} more` : ''} · ${sent.docs} document${sent.docs === 1 ? '' : 's'} attached`
                : `${t.purpose ?? ''} — ${t.head ?? 'the team'}${t.contacts.length > 1 ? ` and ${t.contacts.length - 1} more` : ''} receive the form, the documents and the joining date`}
              right={
                <span className="row tight">
                  {sent ? <Chip tone="ok">Sent</Chip> : <Chip tone="warn">Not sent</Chip>}
                  {may && (
                    <Btn size="xs" variant={sent ? 'ghost' : 'out'} action={`onb.file:${t.key}`} v={e.id}
                      icon="mail" iconSize={12}>
                      {sent ? 'Send again' : `Send to ${t.short}`}
                    </Btn>
                  )}
                </span>
              } />
          );
        })}
      </div>
      {may ? (
        <div className="row tight" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <Btn size="sm" variant="pri" action="onb.file:both" v={e.id} icon="mail" iconSize={13}>
            Send to {fmt.list(fileTeams.map((t) => t.short))} — one click
          </Btn>
          <span className="t-foot">
            <Icon name="shield" size={12} />{' '}
            {missing > 0
              ? `${missing} document${missing === 1 ? '' : 's'} still missing — they will be sent as soon as they are attached.`
              : `The pack is the onboarding form, ${e.progress.uploaded} document${e.progress.uploaded === 1 ? '' : 's'} and the joining date.`}
          </span>
        </div>
      ) : <p className="t-foot" style={{ marginTop: 8 }}>The TA team sends the file on.</p>}
    </>
  );
}

export function JoinerRecord({ e, teams, viewer, now }: {
  e: Joiner; teams: Team[]; viewer: Viewer; now: Date;
}) {
  const pr = e.progress;
  const fileTeams = teams.filter((t) => t.onFile);
  const sentCount = fileTeams.filter((t) => e.fileSent[t.key]).length;

  return (
    <Card
      title={`${e.name} — ${e.employeeCode}`} icon="badge"
      actions={
        <span className="row tight">
          <StatusChipFor e={e} />
          <Btn size="xs" variant="ghost" className="icon" action="onb.close" ariaLabel="Close" icon="x" iconSize={12} />
        </span>
      }
      foot={
        <>
          {/* The prototype had a button here that filled the joiner's form in
              with a fabricated national ID, date of birth and IBAN. Those are
              the joiner's own details and nobody else's to invent, so the
              product chases them for it instead. */}
          {!pr.form && (
            <Btn size="sm" variant="out" action="emp.remind" v={e.id} icon="mail" iconSize={13}>
              Chase the form
            </Btn>
          )}
          {(pr.uploaded < pr.total || !pr.form) && (
            <Btn size="sm" variant="ghost" action="emp.remind" v={e.id} icon="mail" iconSize={13}>Send reminder</Btn>
          )}
          {can(viewer, 'onboarding.verify') && pr.form && (
            <Btn size="sm" variant="ghost" action="emp.formEdit" v={e.id} icon="pencil" iconSize={13}>Edit details</Btn>
          )}
          <Sp />
          <span className="t-foot">
            {e.completedAt
              ? `Checklist completed ${ago(e.completedAt, now)}.`
              : 'Form submitted, every document verified and every referee answered → ready for day one.'}
          </span>
        </>
      }
    >
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Avatar person={e.photo || e.hue != null
          ? { name: e.name, photo: e.photo, hue: e.hue ?? undefined }
          : e.name} size="xl" />
        <div style={{ flex: 1, minWidth: 240 }}>
          <Kvs pairs={[
            ['Employee ID', <span key="i" className="mono">{e.employeeCode}</span>],
            ['Position', <>{e.title}{e.positionCode ? <> · <span className="mono">{e.positionCode}</span></> : null}</>],
            ['Department', e.deptName],
            ['Location', e.city],
            ['Offer accepted', e.acceptedAt ? <>{fmt.date(e.acceptedAt)} <span className="mut">({ago(e.acceptedAt, now)})</span></> : '—'],
            ['Start date', <>{fmt.date(e.startDate)} <span className="mut">({ago(e.startDate, now)})</span>{!e.notice && <> <Chip tone="warn">Not confirmed</Chip></>}</>],
            ['Hiring manager', fmt.list(e.hiringManagers) || '—'],
            ['Recruiter', e.recruiterName ?? '—'],
            ['Application', e.applicationId
              ? <button key="a" className="linkbtn" data-act="drawer.open" data-v={e.applicationId}>open the application</button>
              : '—'],
          ]} />
        </div>
        <div style={{ minWidth: 260, flex: 1 }}>
          <JoiningBlock e={e} teams={teams} viewer={viewer} now={now} />
        </div>
      </div>

      <div className="divider">
        <span className="t-over">
          Onboarding form {pr.form ? <Chip tone="ok">Submitted</Chip> : <Chip tone="warn">Waiting</Chip>}
        </span>
      </div>
      <FormKvs e={e} />

      <div className="divider">
        <span className="t-over">Documents ({pr.verified} of {pr.total} verified)</span>
      </div>
      <DocsList e={e} viewer={viewer} />

      <div className="divider">
        <span className="t-over">
          Reference check{' '}
          {pr.refs.ok && pr.refs.outcome ? <RateBadge rating={pr.refs.outcome} />
            : pr.refs.n ? <Chip tone="warn">{pr.refs.done} of {pr.refs.n} answered</Chip>
              : <Chip tone="bad">No referee yet</Chip>}
        </span>
      </div>
      <ReferencesBlock e={e} viewer={viewer} now={now} />

      <div className="divider">
        <span className="t-over">
          Send the joiner&rsquo;s file{' '}
          {sentCount === fileTeams.length && fileTeams.length
            ? <Chip tone="ok">{fmt.list(fileTeams.map((t) => t.short))} have it</Chip>
            : <Chip tone="warn">{sentCount ? `${sentCount} of ${fileTeams.length} sent` : 'Not sent yet'}</Chip>}
        </span>
      </div>
      <FilesBlock e={e} teams={teams} viewer={viewer} now={now} />

      <div className="divider">
        <span className="t-over">Probation <ProbationChip p={e.probation} startDate={e.startDate} now={now} /></span>
      </div>
      <ProbationCard e={e} viewer={viewer} now={now} />
    </Card>
  );
}
