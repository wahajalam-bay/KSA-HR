import * as React from 'react';
import {
  Card, Kpi, Chip, Empty, Li, Avatar, Btn, Kvs, Banner, Stars, Verdict, Timeline,
  StagePill, StatusChip, Stepper, Dropzone, Bar, Rate, Field, Sp, Push,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import { STAGE_INDEX, type StageKey } from '@/lib/domain/stages';
import { label as scoreLabel, tone as scoreTone, of as scoreOf } from '@/lib/domain/score';
import type {
  DrawerData, DrawerEvaluation, DrawerInterview, DrawerStage,
} from '@/lib/queries/drawer';

/* ─────────────────────────────────────────────────────────────────────────────
   The candidate panel.

   Eight tabs over one record: who they are, their CV, what the screen found,
   the meetings, the scorecards, the comments, everything that happened, and
   the offer. The head strip above them never changes, so a recruiter reading
   the scorecards can still see the stage, the SLA and the fit without going
   back.

   Every control here carries a data-act. The panel itself is a server
   component: it reads, and the delegated layer does the writing.
   ───────────────────────────────────────────────────────────────────────────*/

export const DRAWER_TABS = (d: DrawerData) => {
  const app = d.application;
  const tabs: Array<{ v: string; t: string; n?: number | string | null }> = [
    { v: 'profile', t: 'Profile' },
    { v: 'resume', t: 'Résumé' },
    {
      v: 'screen',
      t: 'Screening',
      n: d.screening?.status === 'completed'
        ? String(scoreOf({ score: d.screening.score, max: d.screening.max }) ?? '')
        : null,
    },
    { v: 'reach', t: 'Schedule a meeting', n: d.interviews.length },
    { v: 'evals', t: 'Scorecards', n: d.evaluations.length },
    { v: 'notes', t: 'Comments', n: d.comments.length },
    { v: 'timeline', t: 'Timeline' },
  ];
  if (app && (app.stage === 'offer' || app.status === 'hired' || d.offer)) {
    tabs.push({ v: 'offer', t: 'Offer' });
  }
  return tabs;
};

/* ── The strip under the title ───────────────────────────────────────────── */
export function HeadStrip({ d, now }: { d: DrawerData; now: Date }) {
  const app = d.application;
  if (!app) return null;
  const cross = d.applications.filter((x) => x.id !== app.id);
  /* Applied and Sourced are alternative entries: the board shows the one this
     application actually came in through, never both. */
  const steps = d.stages.filter((s) => !s.off
    && !(s.key === 'sourced' && app.stage !== 'sourced')
    && !(s.key === 'applied' && app.stage === 'sourced'));

  return (
    <div className="stack sm" style={{ marginBottom: 14 }}>
      <Stepper stages={steps.map((s) => ({ key: s.key, name: s.name }))}
        current={app.stage} className="compact" />
      <div className="row tight">
        <StagePill name={app.stageName} ordinal={STAGE_INDEX[app.stage] ?? 0} />
        <StatusChip status={app.status} />
        <span className={`chip ${app.slaState === 'over' ? 'bad' : app.slaState === 'due' ? 'warn' : ''}`}>
          <Icon name="clock" size={12} /> {fmt.days(app.inStage)} in stage
          {app.slaState === 'over' ? ' · past SLA' : ''}
        </span>
        {app.source && <Chip>via {app.source}</Chip>}
        {d.candidate.claimByName && (
          <Chip tone="brand">
            <Icon name="pin" size={11} /> {d.candidate.claimByName.split(' ')[0]}
          </Chip>
        )}
        <Push />
        {app.fitScore != null && (
          <button className="fitbtn" data-act="cv.fit" data-v={app.id}
            title="CV fit against the JD — click for the breakdown">
            <span className={`rbadge ${scoreTone(app.fitScore) || 'up'}`}>
              <Icon name="target" size={12} /><span>{app.fitScore}</span>
            </span>
            <span className="t-foot">
              {app.fitLabel}{app.fitModel === 'ai' ? ' · read by the model' : ''}
            </span>
          </button>
        )}
        {!!d.reviews.length && <ReviewBadges reviews={d.reviews} />}
        <Stars n={app.rating} size={13} />
      </div>

      {!!cross.length && (
        <Banner tone="info" icon="link"
          title={`Also in ${cross.length} other pipeline${cross.length > 1 ? 's' : ''}`}
          body={cross.map((x) => `${x.jobTitle} — ${x.stageName} (${x.status})`).join(' · ')}
          action={<Btn size="xs" variant="out" action="drawer.cross" v={d.candidate.id}>View</Btn>} />
      )}

      {app.status === 'rejected' && app.disqualifyReason && (
        <Banner tone="warn" title="Disqualified" body={app.disqualifyReason} />
      )}
    </div>
  );
}

function ReviewBadges({ reviews }: { reviews: DrawerData['reviews'] }) {
  const n = (k: string) => reviews.filter((r) => r.kind === k).length;
  const star = n('star'); const up = n('up'); const down = n('down');
  if (!star && !up && !down) return null;
  return (
    <button className="fitbtn" data-act="drawer.tab" data-v="evals" title="Reviews — click to read">
      {!!star && <span className="rbadge star"><Icon name="star" size={12} /><span>{star}</span></span>}
      {!!up && <span className="rbadge up"><Icon name="thumbUp" size={12} /><span>{up}</span></span>}
      {!!down && <span className="rbadge down"><Icon name="thumbDown" size={12} /><span>{down}</span></span>}
    </button>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────────── */
export function ProfileTab({ d, now }: { d: DrawerData; now: Date }) {
  const c = d.candidate;
  const app = d.application;
  const next = d.interviews
    .filter((i) => i.status !== 'cancelled' && i.at >= now.toISOString())
    .sort((a, b) => a.at.localeCompare(b.at))[0];

  return (
    <div className="stack">
      {next && (
        <Banner tone="info" icon="cal" title={`${next.title} — ${fmt.when(next.at)}`}
          body={`${next.mode} · ${next.durationMin} min · ${fmt.list(next.panel)}`} />
      )}

      <Card title="Contact">
        <Kvs pairs={[
          ['Email', <a key="e" href={`mailto:${c.email}`}>{c.email}</a>],
          ['Phone', <span key="p" className="num">{c.phone ?? '—'}</span>],
          ['Location', c.locationCity ?? '—'],
          ['Nationality', c.nationality ?? '—'],
          ['Sector they come from', (
            <React.Fragment key="s">
              {c.sector ?? 'Other'}
              <span className="mut">
                {' · '}
                {c.sectorSource === 'ai' ? 'read by the model'
                  : c.sectorSource === 'recruiter' ? 'set by the recruiter' : 'from the CV'}
              </span>{' '}
              <Btn size="xs" variant="ghost" action="cv.sector" v={c.id} icon="spark" iconSize={11}
                ariaLabel="Re-read the sector from the CV" square={false} />
            </React.Fragment>
          )],
          ['Notice period', c.noticeDays ? `${c.noticeDays} days` : 'Immediate'],
          ['Current salary', c.currentSalary
            ? (
              <React.Fragment key="cs">
                {fmt.sar(c.currentSalary)} / month
                {c.currentSalarySource && (
                  <span className="mut">
                    {' · '}{c.currentSalarySource === 'ai' ? 'from the call' : 'from the recruiter'}
                  </span>
                )}
              </React.Fragment>
            )
            : <span key="cs" className="mut">not captured yet</span>],
          ['Expected salary', c.expectedSalary ? `${fmt.sar(c.expectedSalary)} / month` : '—'],
          c.linkedin ? ['LinkedIn', (
            <a key="li" href={`https://${c.linkedin}`} target="_blank" rel="noopener">
              {c.linkedin.replace('linkedin.com/in/', '')} <Icon name="ext" size={11} />
            </a>
          )] : null,
          c.portfolio ? ['Portfolio', c.portfolio] : null,
        ]} />
      </Card>

      <Card title="Skills and tags"
        actions={<Btn size="xs" variant="ghost" action="tag.add" v={c.id} icon="plus" iconSize={12}>Tag</Btn>}>
        <div className="wrap">{c.skills.map((s) => <Chip key={s}>{s}</Chip>)}</div>
        <div className="wrap" style={{ marginTop: 10 }}>
          {c.hashtags.length
            ? c.hashtags.map((h) => <span className="tag" key={h}>{h}</span>)
            : <span className="t-sub">No tags yet</span>}
        </div>
      </Card>

      {d.employee && (
        <Banner tone="info" icon="badge"
          title={`Employee ${d.employee.employeeCode} — ${d.employee.title}`}
          body={
            <>
              {d.employee.status === 'active' ? 'Active' : 'Onboarding'} · starts{' '}
              {fmt.date(d.employee.startDate)} · seat{' '}
              <span className="mono">{d.employee.positionCode ?? '—'}</span>
            </>
          }
          action={<Btn size="xs" variant="out" action="emp.open" v={d.employee.id}>Employee record</Btn>} />
      )}

      {!!d.answers.length && <AnswersCard d={d} />}

      <Card title={`Applications (${d.applications.length})`} flush>
        <div className="list flush">
          {d.applications.map((a) => (
            <Li key={a.id} icon="brief" title={a.jobTitle}
              sub={`${a.deptName} · applied ${fmt.date(a.appliedAt)}`}
              right={
                <>
                  <StagePill name={a.stageName} ordinal={STAGE_INDEX[a.stage] ?? 0} />
                  <StatusChip status={a.status} />
                </>
              }
              action="drawer.app" v={a.id} />
          ))}
        </div>
      </Card>

      {d.resume?.summary && (
        <Card title="Parsed from the résumé"
          actions={d.resume.confidence != null
            ? <Chip tone={d.resume.confidence > 0.85 ? 'ok' : 'warn'}>{fmt.pct(d.resume.confidence)} confidence</Chip>
            : null}>
          <p className="lead">{d.resume.summary}</p>
        </Card>
      )}
    </div>
  );
}

function AnswersCard({ d }: { d: DrawerData }) {
  const answered = d.answers.filter((a) => a.answer != null && a.answer !== '');
  const missed = d.answers.filter((a) => a.knockout && a.answer != null && a.answer !== a.knockout);
  return (
    <Card title="Application answers" icon="list"
      actions={answered.length
        ? <Chip tone={missed.length ? 'bad' : 'ok'}>
          {missed.length ? `${missed.length} knockout miss${missed.length === 1 ? '' : 'es'}` : 'All clear'}
        </Chip>
        : <Chip>Not asked</Chip>}
      sub={answered.length
        ? `Answered on the careers form ${d.application ? ago(d.application.appliedAt, new Date()) : ''}.`
        : 'Added by hand — no form answers.'}>
      {d.answers.map((q, i) => {
        const bad = !!q.knockout && q.answer != null && q.answer !== q.knockout;
        return (
          <div className={`ans${bad ? ' bad' : ''}`} key={i}>
            <span className="q">{q.question}</span>
            <span className="a">
              {q.answer == null || q.answer === '' ? <i className="mut">Not answered</i> : q.answer}
              {bad && <span className="chip bad" style={{ marginLeft: 6 }}>Knockout</span>}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

/* ── Résumé ──────────────────────────────────────────────────────────────── */
export function ResumeDoc({ d }: { d: DrawerData }) {
  const c = d.candidate;
  const r = d.resume;
  if (!r) {
    return <Empty icon="file" title="No résumé on file" sub="Upload one and it is parsed on the way in." />;
  }
  return (
    <article className="resume">
      {c.photo && <div className="resume-photo"><Avatar person={c} size="xl" /></div>}
      <h2>{c.name}</h2>
      <div className="meta">
        {[c.currentTitle, c.locationCity, c.email, c.phone].filter(Boolean).join(' · ')}
      </div>
      {r.summary && <><h4>Summary</h4><p>{r.summary}</p></>}
      {!!r.experience.length && (
        <>
          <h4>Experience</h4>
          {r.experience.map((j, i) => (
            <div className="job" key={i}>
              <b>{String(j.title ?? '')}</b> — {String(j.company ?? '')}
              <em>{[j.city, [j.from, j.to].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}</em>
              {Array.isArray(j.bullets) && (
                <ul>{(j.bullets as string[]).map((b, k) => <li key={k}>{b}</li>)}</ul>
              )}
            </div>
          ))}
        </>
      )}
      {!!r.education.length && (
        <>
          <h4>Education</h4>
          {r.education.map((e, i) => (
            <div className="job" key={i}>
              <b>{String(e.degree ?? '')}</b> — {String(e.school ?? '')}
              <em>{String(e.year ?? '')}</em>
            </div>
          ))}
        </>
      )}
      {!!r.languages.length && (
        <>
          <h4>Languages</h4>
          <ul>{r.languages.map((l, i) => <li key={i}>{typeof l === 'string' ? l : JSON.stringify(l)}</li>)}</ul>
        </>
      )}
    </article>
  );
}

export function ResumeTab({ d, now }: { d: DrawerData; now: Date }) {
  const c = d.candidate;
  const r = d.resume;
  return (
    <div className="stack">
      {r && (
        <div className="filebar">
          <span className="ic"><Icon name="file" size={15} /></span>
          <span className="bd">
            <b>{r.fileName ?? 'résumé'}</b>
            <span>
              {r.sizeKb ? fmt.kb(r.sizeKb) : '—'} · {r.pages ?? 1} page{(r.pages ?? 1) > 1 ? 's' : ''}
              {r.uploadedAt ? ` · uploaded ${ago(r.uploadedAt, now)}` : ''}
            </span>
          </span>
          <Btn size="sm" variant="out" action="resume.download" v={c.id} icon="dl" iconSize={13}>
            Download
          </Btn>
        </div>
      )}

      <div className="filebar photo-bar">
        <Avatar person={c} size="xl" />
        <span className="bd">
          <b>{c.photo ? 'Photo taken from the CV' : 'No photo in the CV'}</b>
          <span>
            {c.photo
              ? 'Found on the résumé when it was parsed · shown across the platform'
              : 'The monogram stands in. Upload a CV with a picture and it is taken automatically.'}
          </span>
        </span>
        {c.photo && (
          <Btn size="sm" variant="ghost" action="photo.remove" v={c.id} icon="trash" iconSize={13}>
            Remove
          </Btn>
        )}
      </div>

      <ResumeDoc d={d} />

      <Dropzone action={`resume.upload:${c.id}`} accept=".pdf,.doc,.docx,.txt"
        title="Replace the résumé"
        sub="Drop a file or click to choose — PDFs preview here" />
    </div>
  );
}

/* ── Screening ───────────────────────────────────────────────────────────── */
export function ScreeningTab({ d, now }: { d: DrawerData; now: Date }) {
  const s = d.screening;
  const app = d.application;
  if (!app) return <Empty icon="phone" title="No application" sub="A screen belongs to an application." />;
  if (!s) {
    return (
      <div className="stack">
        <Card title="Phone screen" icon="phone"
          sub="The first conversation: the right to work, the notice period, what they are on now and what they want."
          foot={<span className="t-foot">The screen can be run by a recruiter or placed as an AI call; either way the answers land on the record.</span>}>
          <Empty icon="phone" title="Not screened yet"
            sub="Nothing has been captured for this application."
            action={<Btn variant="pri" action="scr.call" v={app.id} icon="phone">Start the screen</Btn>} />
        </Card>
      </div>
    );
  }
  const score = scoreOf({ score: s.score, max: s.max });
  return (
    <div className="stack">
      <Card title="What the screen captured" icon="phone"
        actions={score == null
          ? <Chip tone="warn">{s.status.replace('_', ' ')}</Chip>
          : <Chip tone={scoreTone(score)}>{scoreLabel(score)}</Chip>}
        sub={
          <>
            {s.channel} · {s.status.replace('_', ' ')}
            {s.completedAt ? ` · completed ${ago(s.completedAt, now)}` : ''}
            {s.verdict ? ` · ${s.verdict}` : ''}
          </>
        }>
        {s.summary && <p className="lead">{s.summary}</p>}
        {!!s.answers.length && (
          <>
            <div className="divider"><span className="t-over">What was asked</span></div>
            {s.answers.map((a, i) => (
              <div className="ans" key={i}>
                <span className="q">{a.question}</span>
                <span className="a">
                  {a.answer ?? <i className="mut">no answer</i>}
                  {a.score != null && a.max != null && (
                    <span className="mut"> · {a.score} of {a.max}</span>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </Card>

      {!!s.turns.length && (
        <Card title="The call, as it ran" icon="msg" flush
          foot={<span className="t-foot">Recorded with the candidate&rsquo;s consent; the transcript is kept with the application.</span>}>
          <div className="chat">
            {s.turns.map((t, i) => (
              <div className={`bub ${t.who === 'bot' || t.who === 'ai' ? '' : 'me'}`} key={i}>
                <p>{t.text}</p>
                {t.at && <time>{fmt.time(t.at)}</time>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {d.pitch && (
        <Card title="Sales pitch" icon="target"
          actions={d.pitch.score == null
            ? <Chip>{d.pitch.status.replace('_', ' ')}</Chip>
            : <Chip tone={scoreTone(d.pitch.score)}>{scoreLabel(d.pitch.score)}</Chip>}
          sub={d.pitch.projectName ? `Pitching ${d.pitch.projectName}.` : undefined}>
          <Kvs pairs={[
            ['Status', d.pitch.status.replace('_', ' ')],
            ['Verdict', d.pitch.verdict ?? '—'],
          ]} />
        </Card>
      )}
    </div>
  );
}

/* ── Schedule a meeting ──────────────────────────────────────────────────── */
export function ReachTab({ d, now }: { d: DrawerData; now: Date }) {
  const app = d.application;
  if (!app) return <Empty icon="cal" title="No application" sub="A meeting belongs to an application." />;
  const ahead = d.interviews.filter((i) => i.at >= now.toISOString() && i.status !== 'cancelled');
  const past = d.interviews.filter((i) => i.at < now.toISOString() || i.status === 'cancelled');

  const row = (i: DrawerInterview) => (
    <Li key={i.id} icon="cal" iconTone={i.status === 'cancelled' ? '' : 'brand'}
      title={i.title}
      sub={
        <>
          {fmt.when(i.at)} · {i.mode} · {i.durationMin} min
          {i.panel.length ? ` · ${fmt.list(i.panel)}` : ''}
          {i.location ? ` · ${i.location}` : ''}
        </>
      }
      right={
        <span className="row tight">
          <Chip tone={i.status === 'cancelled' ? 'bad' : i.status === 'completed' ? 'ok' : 'info'}>
            {i.status}
          </Chip>
          {i.status !== 'cancelled' && i.at >= now.toISOString() && (
            <Btn size="xs" variant="out" action="ivw.reschedule" v={i.id}>Move</Btn>
          )}
        </span>
      } />
  );

  return (
    <div className="stack">
      <Card title="Book a meeting" icon="cal"
        sub="Pick the round, the format and who sits on it. The candidate gets the invitation and the panel gets a scorecard to write."
        foot={<span className="t-foot">Friday and Saturday are the weekend in the Kingdom — the picker skips them.</span>}>
        <div className="row tight">
          <Btn variant="pri" action="ivw.new" v={app.id} icon="cal">Schedule an interview</Btn>
          <Btn variant="out" action="app.email" v={app.id} icon="mail">Email the candidate</Btn>
          <Btn variant="ghost" action="scr.call" v={app.id} icon="phone">Phone screen</Btn>
        </div>
      </Card>

      <Card title={`Booked (${ahead.length})`} flush>
        {ahead.length ? <div className="list flush">{ahead.map(row)}</div>
          : <Empty icon="cal" title="Nothing booked" sub="Schedule the next round above." />}
      </Card>

      {!!past.length && (
        <Card title={`Already held (${past.length})`} flush>
          <div className="list flush">{past.map(row)}</div>
        </Card>
      )}
    </div>
  );
}

/* ── Scorecards ──────────────────────────────────────────────────────────── */
export function EvalsTab({ d, now, me }: { d: DrawerData; now: Date; me: string }) {
  const app = d.application;
  if (!app) return <Empty icon="star" title="No application" sub="Scorecards belong to an application." />;
  const done = d.evaluations.filter((e) => e.submitted);
  const open = d.evaluations.filter((e) => !e.submitted);
  const avg = done.length
    ? done.reduce((n, e) => n + (e.overall ?? 0), 0) / done.filter((e) => e.overall != null).length
    : null;

  return (
    <div className="stack">
      {d.assessment && (
        <Card title="Assessment" icon="brain"
          actions={<Chip tone={d.assessment.status === 'completed' ? 'ok' : 'warn'}>{d.assessment.status}</Chip>}>
          <Kvs pairs={[
            ['Sent', d.assessment.sentAt ? fmt.when(d.assessment.sentAt) : '—'],
            ['Completed', d.assessment.completedAt ? fmt.when(d.assessment.completedAt) : '—'],
            ['Score', d.assessment.score == null ? '—' : `${d.assessment.score} of ${d.assessment.max ?? '—'}`],
          ]} />
        </Card>
      )}

      <ReviewsCard d={d} now={now} me={me} />

      {!!done.length && (
        <Card title={`Submitted (${done.length})`}
          actions={
            <span className="row tight">
              <Stars n={avg} size={13} /><span className="t-foot">average</span>
            </span>
          }>
          {done.map((e) => <Scorecard key={e.id} e={e} now={now} />)}
        </Card>
      )}

      {!!open.length && (
        <Card title="Awaiting feedback">
          {open.map((e) => (
            <div className="row" key={e.id}>
              <span className="ic"><Icon name="clock" size={14} /></span>
              <span>{e.evaluatorName} — {e.stage ?? ''}</span>
              <Push />
              <Btn size="xs" variant="out" action="eval.nudge" v={e.id}>Nudge</Btn>
            </div>
          ))}
        </Card>
      )}

      <Card title="Add a scorecard"
        actions={<Btn size="sm" variant="pri" action="eval.start" v={app.id} icon="plus" iconSize={12}>
          Score this candidate
        </Btn>}>
        <p className="t-sub">
          Scores roll up into the candidate&rsquo;s rating and into quality-of-hire on the
          Insights tab.
        </p>
      </Card>
    </div>
  );
}

function Scorecard({ e, now }: { e: DrawerEvaluation; now: Date }) {
  return (
    <div className="sc">
      <div className="sc-h">
        <Avatar person={e.evaluatorName ?? '—'} size="s" />
        <span className="bd">
          <b>{e.evaluatorName}</b>
          <span>{e.stage ?? ''}{e.submittedAt ? ` · ${ago(e.submittedAt, now)}` : ''}</span>
        </span>
        <Verdict verdict={e.verdict} />
        <Stars n={e.overall} size={12} />
      </div>
      {e.notes && <p>{e.notes}</p>}
      {!!e.criteria.length && (
        <div className="crit">
          {e.criteria.map((k, i) => (
            <React.Fragment key={i}>
              <span className="nm">{k.name}</span>
              <span><Stars n={k.score} size={11} hideNum /></span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

const RATING: Record<string, { icon: 'star' | 'thumbUp' | 'thumbDown'; label: string; text: string }> = {
  star: { icon: 'star', label: 'Outstanding', text: 'would hire on the spot' },
  up: { icon: 'thumbUp', label: 'Yes', text: 'would progress' },
  down: { icon: 'thumbDown', label: 'No', text: 'would not progress' },
};

function ReviewsCard({ d, now, me }: { d: DrawerData; now: Date; me: string }) {
  const rs = d.reviews;
  const mine = rs.find((r) => r.authorName === me);
  const n = (k: string) => rs.filter((r) => r.kind === k).length;
  return (
    <Card title="Reviews" icon="thumbUp"
      actions={rs.length
        ? (
          <span className="row tight">
            {!!n('star') && <span className="rbadge star"><Icon name="star" size={12} /><span>{n('star')}</span></span>}
            {!!n('up') && <span className="rbadge up"><Icon name="thumbUp" size={12} /><span>{n('up')}</span></span>}
            {!!n('down') && <span className="rbadge down"><Icon name="thumbDown" size={12} /><span>{n('down')}</span></span>}
          </span>
        )
        : <Chip tone="warn">No reviews yet</Chip>}
      sub="The quick read after meeting the candidate — a thumbs up, a thumbs down or a star, with a line of feedback. The scorecard below is the detailed version.">
      {!!rs.length && (
        <div className="list flush" style={{ marginBottom: 12 }}>
          {rs.map((r) => (
            <Li key={r.id} avatar={r.authorName ?? '—'} title={r.authorName ?? '—'}
              sub={
                <>
                  {r.note ? <span className="quote">“{r.note}”</span> : null}
                  {r.note ? ' · ' : ''}{ago(r.at, now)}
                </>
              }
              right={
                <span className="row tight">
                  {RATING[r.kind] && (
                    <span className={`rbadge ${r.kind}`} title={RATING[r.kind].label}>
                      <Icon name={RATING[r.kind].icon} size={13} />
                      <span>{RATING[r.kind].text}</span>
                    </span>
                  )}
                </span>
              } />
          ))}
        </div>
      )}
      <form className="fbform">
        <p className="t-foot" style={{ margin: '0 0 8px' }}>
          {mine ? 'Update your review' : `Your review of ${d.candidate.name.split(' ')[0]}`} — pick
          one and add a line.
        </p>
        <div className="rate3" role="radiogroup">
          {Object.entries(RATING).map(([k, r]) => (
            <label className={`rb ${k}`} key={k}>
              <input type="radio" name="rev_rating" value={k} defaultChecked={mine?.kind === k} />
              <Icon name={r.icon} size={16} />
              <b>{r.label}</b>
              <span>{r.text}</span>
            </label>
          ))}
        </div>
        <textarea className="inp" name="rev_text" rows={2} style={{ marginTop: 10, width: '100%' }}
          defaultValue={mine?.note ?? ''}
          placeholder="e.g. Strong on targets, clear on why they are moving — would progress." />
        <div className="row tight" style={{ marginTop: 8 }}>
          <Btn size="sm" variant="pri" action="rev.save" v={d.application?.id} icon="check" iconSize={13}>
            {mine ? 'Update review' : 'Save review'}
          </Btn>
          <span className="t-foot">Saved under your name — {me}.</span>
        </div>
      </form>
    </Card>
  );
}

/* ── Comments ────────────────────────────────────────────────────────────── */
export function NotesTab({ d, now, me }: { d: DrawerData; now: Date; me: string }) {
  const list = d.comments;
  const row = (m: DrawerData['comments'][number]) => (
    <div className={`cmt${m.pinned ? ' pin' : ''}`} key={m.id}>
      <Avatar person={m.authorName ?? '—'} size="s" />
      <div className="bd">
        <div className="hd">
          <b>{m.authorName}</b>
          <time>{ago(m.at, now)}</time>
          <Push />
          <Btn size="sm" variant="ghost" action="cmt.pin" v={m.id} icon="pin" iconSize={12}
            title={m.pinned ? 'Unpin' : 'Pin'} />
          <Btn size="sm" variant="ghost" action="cmt.del" v={m.id} icon="trash" iconSize={12} title="Delete" />
        </div>
        <p>{m.body}</p>
      </div>
    </div>
  );

  return (
    <div className="stack">
      <Card title="Add a comment">
        <div className="composer">
          <textarea className="inp" data-keep="cmt" id="cmtbox" rows={3}
            placeholder="What happened? Mention a colleague with @ — visible to the hiring team." />
          <div className="row">
            <span className="t-foot">Posting as {me}</span>
            <Sp />
            <Btn size="sm" variant="pri" action="cmt.post" v={d.application?.id ?? ''} icon="msg" iconSize={13}>
              Post comment
            </Btn>
          </div>
        </div>
      </Card>
      {list.length
        ? (
          <Card title={`Comments (${list.length})`}>
            {list.filter((m) => m.pinned).map(row)}
            {list.filter((m) => !m.pinned).map(row)}
          </Card>
        )
        : <Empty icon="msg" title="No comments yet" sub="The first comment is usually the screen call." />}
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────────────────────── */
export function TimelineTab({ d, now }: { d: DrawerData; now: Date }) {
  if (!d.timeline.length) return <Empty icon="clock" title="Nothing recorded yet" />;
  const nameOf = (k: string) => d.stages.find((s) => s.key === k)?.name ?? k;
  return (
    <Card title="Everything that happened">
      <Timeline items={d.timeline.map((t) => ({
        at: t.at,
        when: ago(t.at, now),
        byName: t.by,
        on: true,
        text: <>Moved to <b>{nameOf(t.text)}</b></>,
      }))} />
    </Card>
  );
}

/* ── Offer ───────────────────────────────────────────────────────────────── */
const DOC_LABEL: Record<string, string> = {
  national_id: 'National ID or passport',
  education: 'Degree certificate',
  photo: 'Passport photograph',
  iban: 'Bank IBAN letter',
};

export function OfferTab({ d, now }: { d: DrawerData; now: Date }) {
  const o = d.offer;
  const app = d.application;
  if (!o) {
    return (
      <Empty icon="file" title="No offer yet"
        sub="An offer is drafted from the requisition's band and the candidate's expectation."
        action={app ? <Btn variant="pri" action="offer.edit" v={app.id}>Draft an offer</Btn> : undefined} />
    );
  }
  const total = o.baseMonthly + o.housing + o.transport;
  const missing = o.documents.filter((x) => x.status === 'missing');
  const live = ['sent', 'viewed', 'signed'].includes(o.state);

  return (
    <div className="stack">
      <Card title={`Offer v${o.version}`} icon="file"
        actions={<Chip tone={o.state === 'accepted' ? 'ok' : o.state === 'declined' ? 'bad' : 'warn'}>{o.state}</Chip>}
        sub={o.templateName ? `On the ${o.templateName} letter.` : undefined}
        foot={
          <span className="t-foot">
            {o.verifiedAt
              ? `Letter verified by ${o.verifiedByName ?? 'the onboarding specialist'} ${ago(o.verifiedAt, now)}.`
              : 'The filled letter is checked by the onboarding specialist before it can be sent.'}
          </span>
        }>
        <Kvs pairs={[
          ['Monthly basic', fmt.sar(o.baseMonthly)],
          ['Housing', fmt.sar(o.housing)],
          ['Transport', fmt.sar(o.transport)],
          ['Total monthly', <b key="t">{fmt.sar(total)}</b>],
          ['Annual bonus', o.annualBonusPct == null ? '—' : `${o.annualBonusPct}%`],
          ['Start date', o.startDate ? fmt.date(o.startDate) : '—'],
          ['Sent', o.sentAt ? fmt.when(o.sentAt) : 'not sent'],
          o.responseAt ? ['Answered', `${fmt.when(o.responseAt)}${o.responseReason ? ` — ${o.responseReason}` : ''}`] : null,
          o.responseNote ? ['What they said', <span key="n" className="quote">“{o.responseNote}”</span>] : null,
        ]} />
      </Card>

      {!!o.documents.length && (
        <Card title="Documents required before acceptance" icon="lock" flush
          actions={missing.length
            ? <Chip tone="warn">{missing.length} still to come</Chip>
            : <Chip tone="ok">All in</Chip>}
          foot={
            <span className="t-foot">
              {live
                ? 'The candidate cannot sign, and acceptance cannot be recorded, until every document is in.'
                : 'Collected with the signed letter and carried into the joiner file.'}
            </span>
          }>
          <div className="list flush">
            {o.documents.map((doc) => (
              <Li key={doc.kind} icon={doc.status === 'missing' ? 'alert' : 'check'}
                iconTone={doc.status === 'missing' ? '' : 'brand'}
                title={DOC_LABEL[doc.kind] ?? doc.kind}
                sub={doc.fileName ?? (doc.status === 'missing' ? 'Not uploaded' : doc.status)}
                right={<Chip tone={doc.status === 'verified' ? 'ok' : doc.status === 'missing' ? 'warn' : ''}>
                  {doc.status}
                </Chip>} />
            ))}
          </div>
        </Card>
      )}

      {!!o.questions.length && (
        <Card title="The conversation on the offer" icon="msg" flush
          foot={<span className="t-foot">An unanswered question is the cheapest offer risk to remove.</span>}>
          <div className="chat">
            {o.questions.map((q) => (
              <div className={`bub ${q.from === 'candidate' ? '' : 'me'}`} key={q.id}>
                <p>{q.body}</p>
                <time>{ago(q.at, now)}</time>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
