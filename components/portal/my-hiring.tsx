import * as React from 'react';
import {
  Card, Chip, Empty, Li, Avatar, Btn, Kvs, Bar, jobStatusText,
} from '@/components/ui/primitives';
import { Badge, Icon } from '@/components/ui/icons';
import { fmt } from '@/lib/format';
import type { Portal, PortalInterview, OwnReview } from '@/lib/queries/portal';
import { CRIT, CRIT_LABEL, band, bandText } from '@/lib/domain/ivreview';

/* ─────────────────────────────────────────────────────────────────────────────
   My hiring: what needs this person, and only that.

   A hiring manager or an interview participant sees the same records the desk
   does, narrowed on the server to the ones they are named on. Six tiles across
   the top say what is outstanding; under them the requisitions they own, the
   interviews they sit on, and the people about to join because of them.
   ───────────────────────────────────────────────────────────────────────────*/

function Tile({ icon, n, label, action, v, tone }: {
  icon: string; n: number; label: string; action: string; v?: string; tone?: 'up' | 'down';
}) {
  return (
    <button className="tile" data-act={action} data-v={v ?? ''}>
      <Badge name={icon as never} size={16} />
      <b className="tl-v">{fmt.int(n)}</b>
      <span className="tl-l">{label}</span>
      {tone && (
        <span className={`tl-t ${tone}`}>
          <Icon name={tone === 'down' ? 'alert' : 'check'} size={11} sw={2.2} />{' '}
          {tone === 'down' ? 'needs you' : 'clear'}
        </span>
      )}
    </button>
  );
}

function InterviewRow({ i, me, now }: { i: PortalInterview; me: string; now: Date }) {
  const isPast = i.at < now.toISOString();
  const others = i.panel.filter((p) => p !== me);
  return (
    <Li key={i.id}
      avatar={{ name: i.candidateName, photo: i.photo, hue: i.hue }}
      title={<>{i.candidateName} <span className="mut" style={{ fontWeight: 500 }}>· {i.jobTitle}</span></>}
      sub={
        <>
          {fmt.when(i.at)} · {i.title} · {i.mode} · {i.durationMin} min
          {others.length ? ` · with ${fmt.list(others)}` : ''}
        </>
      }
      right={isPast
        ? (i.scored
          ? <Chip tone="ok">Scorecard in</Chip>
          : <Btn size="xs" variant="pri" action="drawer.open" v={i.applicationId} icon="star" iconSize={12}>Scorecard</Btn>)
        : <Chip tone="info">{i.status === 'confirmed' ? 'Confirmed' : 'Scheduled'}</Chip>}
      action="drawer.open" v={i.applicationId} />
  );
}

export function MyHiring({ d, me, now }: { d: Portal; me: string; now: Date }) {
  const live = [...d.live].sort((a, b) =>
    (a.status === 'pending_approval' ? 0 : 1) - (b.status === 'pending_approval' ? 0 : 1));

  return (
    <div className="stack">
      <div className="tiles tiles-3">
        <Tile icon="brief" n={d.live.length} label="Your live requisitions" action="go" v="/my?f=reqs" />
        <Tile icon="cal" n={d.ahead.length} label="Interviews ahead" action="go" v="/my?f=ivs" />
        <Tile icon="star" n={d.awaitingScorecard.length} label="Scorecards to write" action="go" v="/my?f=ivs"
          tone={d.awaitingScorecard.length ? 'down' : 'up'} />
        <Tile icon="shield" n={d.approvals.length} label="Approvals waiting on you" action="go" v="/my?f=appr"
          tone={d.approvals.length ? 'down' : 'up'} />
        <Tile icon="badge" n={d.startingSoon} label="Joiners starting soon" action="go" v="/onboarding?tab=progress"
          tone="up" />
        <Tile icon="users" n={d.onboarding} label="Joiners on their way" action="go" v="/onboarding" />
      </div>

      <OwnReviewCard r={d.coaching} />

      {!!d.approvals.length && (
        <Card title="Approvals waiting on you" icon="shield" flush>
          <div className="list flush">
            {d.approvals.map((x) => (
              <Li key={`${x.kind}-${x.id}`} icon="shield" iconTone="brand"
                title={`${x.kind} — ${x.title}`} sub={x.sub}
                right={<Chip tone="warn">Your step</Chip>}
                action={x.act} v={x.v} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid g-2">
        <Card title="Your requisitions" icon="brief" flush
          sub={`${d.live.length} live · ${d.jobs.length - d.live.length} closed. Open one for its pipeline, interviews and offers.`}>
          {live.length ? (
            <div className="list flush">
              {live.map((j) => (
                <Li key={j.id} icon="brief" title={j.title}
                  sub={
                    <>
                      {j.deptName}{j.city ? ` · ${j.city}` : ''} · {j.filled}/{j.openings} filled ·{' '}
                      {j.inPlay} in play{j.atOffer ? ` · ${j.atOffer} at offer` : ''}
                      {j.recruiterName ? ` · recruiter ${j.recruiterName.split(' ')[0]}` : ''}
                    </>
                  }
                  right={<Chip tone={j.status === 'open' ? 'ok' : 'warn'}>{jobStatusText(j.status)}</Chip>}
                  action="go" v={`/jobs/${j.id}`} />
              ))}
            </div>
          ) : <Empty icon="brief" title="No live requisition names you as hiring manager" />}
        </Card>

        <Card title="Your interviews" icon="cal" flush
          sub={`${d.ahead.length} ahead · ${d.awaitingScorecard.length} past interview${d.awaitingScorecard.length === 1 ? '' : 's'} still without your scorecard.`}>
          {d.ahead.length || d.past.length ? (
            <div className="list flush">
              {d.ahead.slice(0, 6).map((i) => <InterviewRow key={i.id} i={i} me={me} now={now} />)}
              {!!d.past.length && (
                <div className="divider" style={{ margin: 0 }}><span className="t-over">Recent</span></div>
              )}
              {d.past.slice(0, 6).map((i) => <InterviewRow key={i.id} i={i} me={me} now={now} />)}
            </div>
          ) : <Empty icon="cal" title="No interviews on your calendar" />}
        </Card>
      </div>

      <Card title="Your new joiners" icon="badge" flush
        sub="People hired on your requisitions, with their start date and where the paperwork has got to. Your read on the candidate lives on their profile, under Reviews.">
        {d.joiners.length ? (
          <div className="list flush">
            {[...d.joiners]
              .sort((a, b) => ((a.status === 'active' ? '1' : '0') + a.startDate)
                .localeCompare((b.status === 'active' ? '1' : '0') + b.startDate))
              .slice(0, 8)
              .map((e) => (
                <Li key={e.id}
                  avatar={e.photo || e.hue != null
                    ? { name: e.name, photo: e.photo, hue: e.hue ?? undefined }
                    : e.name}
                  title={e.name}
                  sub={<>{e.title} · {e.deptName} · {e.status === 'active' ? 'started ' : 'starts '}{fmt.date(e.startDate)}</>}
                  right={e.status === 'active'
                    ? <Chip tone="ok">Started</Chip>
                    : e.ready ? <Chip tone="ok">Ready for day one</Chip> : <Chip tone="warn">Onboarding</Chip>}
                  action="onb.open" v={e.id} />
              ))}
          </div>
        ) : <Empty icon="badge" title="No joiners yet on your requisitions" />}
      </Card>
    </div>
  );
}

/* ── How this person's own interviews are going ──────────────────────────────
   Their record, read back to them: the six things every interview should do,
   how much of the talking they did, and what comes up most often. It is
   coaching from the recordings, not a judgement on their candidates — the
   card says so, because a number without that sentence reads as a mark. */
function OwnReviewCard({ r }: { r: OwnReview }) {
  if (!r.n) {
    return (
      <Card title="How your interviews are going" icon="target">
        <p className="t-sub">
          Nothing analysed in {r.periodLabel}. Every interview you run is recorded and reviewed —
          opening, the questions against the JD, listening, compliance, the close and how quickly
          the scorecard follows — so you can see how you come across.
        </p>
      </Card>
    );
  }
  return (
    <Card title="How your interviews are going" icon="target"
      actions={<Chip tone={band(r.score)}>{r.score} of 100</Chip>}
      sub={
        <>
          {r.n} interview{r.n === 1 ? '' : 's'} in {r.periodLabel} · {bandText(r.score)}
          {r.trend != null && r.trend !== 0
            ? ` · ${r.trend > 0 ? 'up' : 'down'} ${Math.abs(r.trend)} points on your earlier ones`
            : ''}
          . Coaching from the recordings, not a judgement on your candidates.
        </>
      }
      foot={
        <span className="t-foot">
          Scored on {CRIT.length} things every interview should do. Your own interviews only —
          nobody else sees your coaching notes unless they are an Admin.
        </span>
      }>
      <div className="grid g-2" style={{ gap: 14 }}>
        <div>
          {CRIT.map(([k, label, hint]) => {
            const v = r.ratings[k];
            return (
              <div className="cm" key={k}>
                <span>{label}</span>
                <Bar p={(v ?? 0) / 5} thin
                  tone={v == null ? '' : v <= 2 ? 'bad' : v === 3 ? 'warn' : ''} />
                <b className="num">{v == null ? '—' : v}/5</b>
                <i>{hint}</i>
              </div>
            );
          })}
        </div>
        <div>
          {r.airtime != null && (
            <Kvs pairs={[
              ['Your airtime', `${r.airtime}% of the words — ${r.airtime <= 40 ? 'about right' : 'try to talk less'}`],
              ['Strongest', r.best ? CRIT_LABEL[r.best] : '—'],
              ['Weakest', r.worst ? CRIT_LABEL[r.worst] : '—'],
              ['Flagged', r.flags ? `${r.flags} interview${r.flags === 1 ? '' : 's'}` : 'none'],
            ]} />
          )}
          {!!r.slips.length && (
            <>
              <div className="t-over" style={{ margin: '10px 0 6px' }}>What comes up most</div>
              <ul className="bullets warn">
                {r.slips.slice(0, 3).map((x) => (
                  <li key={x.t}>{x.t}{x.n > 1 ? <span className="mut"> · {x.n} times</span> : null}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
