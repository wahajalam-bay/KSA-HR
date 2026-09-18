import * as React from 'react';
import { Icon } from '@/components/ui/icons';
import { Avatar, Chip, Seg, Stars, Btn, Push } from '@/components/ui/primitives';
import { SourceMark } from './source-mark';
import { fmt } from '@/lib/format';
import { routeMeta } from '@/lib/domain/sourcing';
import { can } from '@/lib/authz';
import { band as scoreBand } from '@/lib/domain/score';
import type { getBoard } from '@/lib/queries/jobs';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   The board.

   One column per stage this requisition actually runs, in spine order, with the
   SLA and the median time in stage under each heading. Cards are draggable; the
   drop calls the transition state machine on the server, which is what decides
   whether the move is allowed — the board never does.

   Everyone who applied is here whatever route brought them. The filter above
   narrows the view and says so — "3 of 16 in play" — rather than hiding anybody
   by default.
   ───────────────────────────────────────────────────────────────────────────*/

type Board = Awaited<ReturnType<typeof getBoard>>;

export function BoardTab({ job, board, route, viewer }: {
  job: any; board: Board; route: string | null; viewer: Viewer;
}) {
  const mayMove = can(viewer, 'application.move');
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="t-sub">
          {board.shown}{route ? ` of ${board.total}` : ''} in play across {board.columns.length} stages ·{' '}
          {mayMove ? 'drag a card to move it · ' : ''}
          Applied and Sourced rank by CV fit{' '}
          <span className="fitb strong" style={{ verticalAlign: 'middle' }}>
            <Icon name="target" size={10} />0–100
          </span>
        </span>
        <Push />
        <Seg action="job.route" active={route ?? 'all'} options={[
          { v: 'all', t: `Every route · ${board.total}` },
          ...board.routeCounts.filter((c) => c.live).map((c) => ({
            v: c.key, t: `${routeMeta(c.key).name.replace(' company page', '')} · ${c.live}`,
          })),
        ]} />
        {can(viewer, 'application.create') && (
          <Btn size="sm" variant="out" action="job.addCand" v={job.id} icon="uplus">Add candidate</Btn>
        )}
      </div>

      <div className="board" id="board">
        {board.columns.map((col, i) => (
          <section className="bcol" data-stage={col.key} key={col.key}>
            <header className="bcol-h">
              <div className="tt">
                <span className="ord" style={{ background: `var(--stg-${col.band})`, color: 'var(--stg-fg)' }}>
                  {i + 1}
                </span>
                <span className="nm">{col.name}</span>
                <span className="ct">{col.cards.length}</span>
              </div>
              <div className="mt">
                <span>SLA {col.sla}d</span>
                {col.overSla > 0 && <span className="bad-t">· {col.overSla} past</span>}
                {col.cards.length > 0 && <span>· median {Math.round(col.medianDays)}d in stage</span>}
              </div>
              {col.key === 'screen' && can(viewer, 'screening.call') && (
                <button className={`btn xs ${col.unscreened ? 'pri' : 'ghost'} colact`}
                  data-act="scr.stageCalls" data-v={job.id}>
                  <Icon name="phone" size={12} /> AI phone screen{col.unscreened ? ` · ${col.unscreened} to call` : 's'}
                </button>
              )}
            </header>
            <div className="bcol-b" data-drop={col.key}>
              {col.cards.length
                ? col.cards.map((c) => <BoardCard key={c.id} c={c} draggable={mayMove} />)
                : <div className="t-foot mut" style={{ padding: '10px 4px' }}>Empty</div>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function BoardCard({ c, draggable }: { c: Board['columns'][number]['cards'][number]; draggable: boolean }) {
  const ageCls = c.sla.state === 'over' ? ' age-over' : c.sla.state === 'due' ? ' age-due' : '';
  return (
    <article
      className={`bcard${ageCls}`} draggable={draggable} data-app={c.id}
      data-act="drawer.open" data-v={c.id} tabIndex={0}
    >
      <div className="hd">
        <Avatar person={c} size="s" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="nm trunc">{c.name}</div>
          <div className="rl trunc">{c.currentTitle} · {c.currentCompany}</div>
        </div>
      </div>
      <div className="ft">
        {c.fitScore != null && <FitBadge score={c.fitScore} band={c.fitBand} />}
        <span title="Days in stage"><Icon name="clock" size={11} /> {Math.round(c.sla.days)}d</span>
        {c.reviews.n > 0 && (
          <span className="revmk" title={`${c.reviews.n} review${c.reviews.n === 1 ? '' : 's'}: ${c.reviews.star} star · ${c.reviews.up} up · ${c.reviews.down} down`}>
            {c.reviews.star > 0 && <i className="star"><Icon name="star" size={10} />{c.reviews.star > 1 ? c.reviews.star : ''}</i>}
            {c.reviews.up > 0 && <i className="up"><Icon name="thumbUp" size={10} />{c.reviews.up > 1 ? c.reviews.up : ''}</i>}
            {c.reviews.down > 0 && <i className="down"><Icon name="thumbDown" size={10} />{c.reviews.down > 1 ? c.reviews.down : ''}</i>}
          </span>
        )}
        {c.scorecards.mean != null && <Stars n={c.scorecards.mean} size={10} hideNum />}
        {c.scorecards.pending > 0 && (
          <span title="Awaiting a scorecard" className="warn-t"><Icon name="star" size={11} /></span>
        )}
        {c.crossApplications > 0 && (
          <span title="Also in another pipeline"><Icon name="link" size={11} /></span>
        )}
        <ScreeningMark s={c.screening} />
        {c.status === 'on_hold' && <Chip tone="warn">Hold</Chip>}
        {c.claimedBy && (
          <span className="clm" title={`Tagged to ${c.claimedBy}`}>
            <Icon name="pin" size={10} />{fmt.first(c.claimedBy)}
          </span>
        )}
        <Push />
        <SourceMark route={c.route} source={c.source} />
        <span className="t-cap trunc" title={c.source}>{c.source.split(' — ')[0]}</span>
      </div>
    </article>
  );
}

function FitBadge({ score, band }: { score: number; band: string | null }) {
  const cls = score >= 75 ? 'strong' : score >= 60 ? 'fair' : score >= 40 ? 'weak' : 'poor';
  return (
    <span className={`fitb ${cls}`} title={`CV fit against the job description — ${band ?? scoreBand(score)[0]}`}>
      <Icon name="target" size={10} />{score}
    </span>
  );
}

function ScreeningMark({ s }: { s: { status: string; channel: string; verdict: string | null; score: number | null } | null }) {
  if (!s) return null;
  const phone = s.channel === 'AI phone';
  if (s.status === 'completed') {
    return (
      <span className={`scr-mk ${s.verdict ?? ''}`}
        title={`${phone ? 'AI phone screen' : 'Screening bot'}: ${s.score ?? '—'} of 100`}>
        <Icon name={phone ? 'phone' : 'spark'} size={11} />
      </span>
    );
  }
  if (phone && ['scheduled', 'calling'].includes(s.status)) {
    return (
      <span className="scr-mk sched" title={`AI phone screen ${s.status === 'calling' ? 'in progress' : 'scheduled'}`}>
        <Icon name="phone" size={11} />
      </span>
    );
  }
  if (phone && s.status === 'no_answer') {
    return (
      <span className="scr-mk review" title="AI phone screen: no answer, retry scheduled">
        <Icon name="phone" size={11} />
      </span>
    );
  }
  return null;
}
