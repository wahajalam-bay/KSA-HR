import * as React from 'react';
import { Card, Seg, Chip, Empty, Avatar, Btn, Push } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt } from '@/lib/format';
import { band as reviewBand, bandText } from '@/lib/domain/ivreview';
import { dayKey, dowOf, DOWS, isWeekend } from '@/lib/queries/scheduling';
import type { agenda as agendaQuery, Slot } from '@/lib/queries/scheduling';

/* ─────────────────────────────────────────────────────────────────────────────
   The agenda: what is booked, day by day.

   The week view lays out all seven days so the two-day weekend reads as part of
   the shape of the week rather than as a gap; the other two windows stay sparse
   and only show days that have something on them.
   ───────────────────────────────────────────────────────────────────────────*/

type Data = Awaited<ReturnType<typeof agendaQuery>>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key: string) => `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;

/* The chip that says how the interview itself was run, and offers to analyse
   the recording when nobody has yet.

   "Held" and "held" are two different things. An interview can be marked
   completed while its slot is still ahead — somebody closes it off early, or
   the board is looked at in the morning for a meeting at three — and there is
   no recording to listen back to until it has actually happened. So the chip
   waits for the clock as well as the status. */
export function ReviewChip({ i, now }: { i: Slot; now: Date }) {
  if (i.status !== 'completed' || new Date(i.at) >= now) return null;
  if (i.reviewScore == null) {
    return (
      <button className="btn xs ghost" data-act="ivr.analyse" data-v={i.id}
        title="The recording has not been analysed yet">
        <Icon name="spark" size={11} /> Analyse
      </button>
    );
  }
  return (
    <button className={`ivchip ${reviewBand(i.reviewScore)}`} data-act="ivr.open" data-v={i.id}
      title={`How ${i.interviewer ?? 'the interviewer'} ran it — ${bandText(i.reviewScore)}. Click for the review.`}>
      <Icon name="target" size={11} /><b>{i.reviewScore}</b>
      {i.reviewFlagged && <Icon name="alert" size={11} />}
    </button>
  );
}

export function SlotRow({ i, now }: { i: Slot; now: Date }) {
  const future = new Date(i.at) >= now;
  const others = i.panel.filter((p) => p !== i.interviewer);
  return (
    <div className="slot" data-act="drawer.open" data-v={i.applicationId}
      role="button" tabIndex={0} title={`Open ${i.candidateName}`}>
      <span className="tm">{fmt.time(i.at)}</span>
      <Avatar person={{ name: i.candidateName, photo: i.photo, hue: i.hue }} size="s" />
      <span className="bd">
        <b>{i.candidateName}{i.jobTitle ? ` · ${i.jobTitle}` : ''}</b>
        <span>
          {i.stageName} · {i.mode} · {i.durationMin} min ·{' '}
          {i.interviewer
            ? <>HM <b>{i.interviewer}</b>{others.length ? ` · panel ${fmt.list(others)}` : ''}</>
            : `panel ${i.panel.length ? fmt.list(i.panel) : 'to be confirmed'}`}
        </span>
      </span>
      <span className="wrap" style={{ flex: '0 0 auto', justifyContent: 'flex-end' }}>
        {i.status === 'no_show' ? <Chip tone="bad">No show</Chip>
          : i.status === 'completed' ? <Chip>Held</Chip>
            : future ? <Chip tone="ok">Scheduled</Chip> : <Chip tone="warn">Awaiting outcome</Chip>}
        <ReviewChip i={i} now={now} />
        {future && i.status === 'scheduled' && (
          <>
            <Btn size="xs" variant="ghost" action="ivw.reschedule" v={i.id}>Move</Btn>
            <Btn size="xs" variant="ghost" action="ivw.cancel" v={i.id}>Cancel</Btn>
          </>
        )}
      </span>
    </div>
  );
}

export function AgendaTab({ data, now }: { data: Data; now: Date }) {
  const { counts, range, today, weekStart, shown } = data;

  const byDay: Record<string, Slot[]> = {};
  for (const i of shown) {
    const k = dayKey(i.at);
    byDay[k] = [...(byDay[k] ?? []), i];
  }

  const desc = range === 'past';
  const keys = range === 'week'
    ? Array.from({ length: 7 }, (_, n) =>
      new Date(Date.parse(weekStart + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10))
    : (() => { const ks = Object.keys(byDay).sort(); if (desc) ks.reverse(); return ks; })();

  let month: string | null = null;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Seg action="sch.range" active={range} options={[
          { v: 'up', t: `Upcoming (${counts.up})` },
          { v: 'week', t: `This week (${counts.week})` },
          { v: 'past', t: `Past (${counts.past})` },
        ]} />
        <Push />
        <Btn size="sm" variant="pri" action="ivw.new" icon="plus" iconSize={13}>Schedule interview</Btn>
      </div>

      <div className="filters">
        <select className="inp" data-act="sch.owner" defaultValue="" aria-label="Recruiter">
          <option value="">All recruiters</option>
          {data.owners.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="inp" data-act="sch.mode" defaultValue="" aria-label="Mode">
          <option value="">Every mode</option>
          {data.modes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <Push />
        <span className="t-foot">
          {shown.length} of {data.keptTotal} shown
          {data.weekendBooked ? (
            <> · <span className="warn-t">{data.weekendBooked} booked into the Friday–Saturday weekend</span></>
          ) : null}
        </span>
      </div>

      {shown.length ? (
        <Card flush className="pad">
          <div className="agenda">
            {keys.map((k) => {
              const head = monthLabel(k) !== month
                ? <div className="divider" key={`m-${k}`}><span className="t-over">{monthLabel(k)}</span></div>
                : null;
              month = monthLabel(k);
              const items = byDay[k] ?? [];
              const wk = isWeekend(k);
              return (
                <React.Fragment key={k}>
                  {head}
                  <div className="ag-day">
                    <div className={`ag-d${k === today ? ' today' : ''}`}>
                      <b>{+k.slice(8)}</b><span>{DOWS[dowOf(k)]}</span>
                    </div>
                    <div className="ag-l">
                      <div className="row tight" style={{ marginBottom: 1 }}>
                        <span className={`t-cap${wk ? ' mut' : ''}`}>
                          {k === today ? 'Today' : fmt.date(k + 'T00:00:00Z')} · {items.length} booked
                        </span>
                        {wk && <Chip tone="warn">KSA weekend</Chip>}
                      </div>
                      {items.length
                        ? [...items]
                          .sort((a, b) => (desc ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)))
                          .map((i) => <SlotRow key={i.id} i={i} now={now} />)
                        : <span className="t-foot mut">
                          {wk ? 'Weekend — nothing should be booked here' : 'Nothing booked'}
                        </span>}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </Card>
      ) : (
        <Empty
          icon="cal"
          title={range === 'up' ? 'Nothing booked ahead'
            : range === 'week' ? 'Nothing this week' : 'No interviews in the past window'}
          sub={range === 'up'
            ? `${counts.past} interviews have already been held. Book the next one, or look back over what happened.`
            : 'Widen the filters, or pick another window.'}
          action={
            <>
              <Btn variant="pri" action="ivw.new">Schedule an interview</Btn>
              <Btn variant="out" action="sch.range" v="past">Show past interviews</Btn>
            </>
          }
        />
      )}
    </>
  );
}
