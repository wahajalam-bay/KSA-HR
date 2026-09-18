import * as React from 'react';
import {
  Card, Kpi, Seg, Chip, Empty, Banner, Avatar, Table, Bar, Kvs, Btn, Push, StagePill,
  type Column,
} from '@/components/ui/primitives';
import { Donut, Legend } from '@/components/charts';
import { fmt } from '@/lib/format';
import * as W from '@/lib/domain/window';
import { CRIT, CRIT_LABEL, MIN_N, BANDS, band, bandText } from '@/lib/domain/ivreview';
import { ReviewChip } from './agenda';
import type { interviewerPanel } from '@/lib/queries/scheduling';

/* ─────────────────────────────────────────────────────────────────────────────
   Interviewers.

   The scorecard says whether the candidate is any good. This panel says whether
   the interview was any good: every recording analysed, the person who ran it
   scored out of a hundred, and the coaching that comes out of it.

   Somebody with one or two interviews is not ranked against somebody with
   fifty, so the thin records sit at the bottom and the table says why.
   ───────────────────────────────────────────────────────────────────────────*/

type Data = Awaited<ReturnType<typeof interviewerPanel>>;
type BoardRow = Data['board'][number] & { _act?: string; _v?: string; _cls?: string };
type IvRow = Data['list'][number] & { _act?: string; _v?: string };

/* The panel's average across everybody: a mean below three is a problem and
   below four is worth a word, so the bands are read on the mean. */
function CritMean({ label, v, hint }: { label: string; v: number | null; hint: string }) {
  return (
    <div className="cm">
      <span>{label}</span>
      <Bar p={(v ?? 0) / 5} thin tone={v == null ? undefined : v < 3 ? 'bad' : v < 4 ? 'warn' : undefined} />
      <b className="num">{v == null ? '—' : fmt.dec(v, 1)}</b>
      <i>{hint}</i>
    </div>
  );
}

/* One person's own line, where the rating is a whole mark out of five. */
function CritOwn({ label, v, hint }: { label: string; v: number | null; hint: string }) {
  return (
    <div className="cm">
      <span>{label}</span>
      <Bar p={(v ?? 0) / 5} thin tone={v == null ? undefined : v <= 2 ? 'bad' : v === 3 ? 'warn' : undefined} />
      <b className="num">{v == null ? '—' : v}/5</b>
      <i>{hint}</i>
    </div>
  );
}

export function InterviewersTab({ data, w, sel, now }: {
  data: Data; w: W.Window; sel: string; now: Date;
}) {
  const { done, pending, flagged, scores, median, board } = data;
  const phrase = W.phrase(w);
  const mine = sel ? board.find((b) => b.name === sel) : null;

  const boardCols: Array<Column<BoardRow>> = [
    {
      t: 'Interviewer',
      f: (x) => (
        <div className="row tight nowrap">
          <Avatar person={x.name} size="s" />
          <span className="ivwho"><b>{x.name}</b><em>{x.title}</em></span>
        </div>
      ),
    },
    {
      t: 'Interviews', n: true,
      f: (x) => <>{fmt.int(x.n)}{x.heldN > x.n ? <> <span className="mut">+{x.heldN - x.n} waiting</span></> : null}</>,
    },
    { t: 'Score', n: true, f: (x) => <span className={`chip ${band(x.score)}`}>{x.score ?? '—'}</span> },
    {
      t: 'Airtime', n: true,
      f: (x) => (x.airtime == null ? <>—</> : <span className={x.airtime > 50 ? 'warn-t' : ''}>{x.airtime}%</span>),
    },
    { t: 'Strongest', f: (x) => <span className="t-sub">{x.best ? CRIT_LABEL[x.best] : '—'}</span> },
    { t: 'Weakest', f: (x) => <span className="t-sub">{x.worst ? CRIT_LABEL[x.worst] : '—'}</span> },
    { t: 'Flagged', n: true, f: (x) => (x.flags ? <span className="bad-t">{x.flags}</span> : <>—</>) },
  ];

  const ivCols: Array<Column<IvRow>> = [
    {
      t: 'Candidate',
      f: (i) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: i.candidateName, photo: i.photo, hue: i.hue }} size="s" />
          <b>{i.candidateName}</b>
        </div>
      ),
    },
    { t: 'Stage', f: (i) => <StagePill name={i.stageName} ordinal={i.stageOrdinal} /> },
    { t: 'Interviewer', f: (i) => <span className="t-sub">{i.interviewer || i.panel[0] || '—'}</span> },
    { t: 'When', f: (i) => <span className="t-sub">{fmt.date(i.at)}</span> },
    {
      t: 'Airtime', n: true,
      f: (i) => (i.talkRatio == null ? <>—</> : <span className={i.talkRatio > 50 ? 'warn-t' : ''}>{i.talkRatio}%</span>),
    },
    {
      t: 'Score', n: true,
      f: (i) => (i.reviewScore == null
        ? <span className="mut">—</span>
        : <span className={`chip ${band(i.reviewScore)}`}>{i.reviewScore}</span>),
    },
    { t: '', f: (i) => <ReviewChip i={i} now={now} /> },
  ];

  const list = sel ? data.list.filter((i) => (i.interviewer || i.panel[0]) === sel) : data.list;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Seg action="sch.iw" active={String(w.days)} options={[
          { v: '30', t: 'Last 30 days' }, { v: '90', t: 'Last quarter' },
          { v: '180', t: 'Last 6 months' }, { v: '365', t: 'Last 12 months' },
        ]} />
        <Push />
        {!!pending.length && (
          <Btn size="sm" variant="pri" action="ivr.analyseAll" v={String(w.days)} icon="spark" iconSize={13}>
            Analyse {pending.length} recording{pending.length === 1 ? '' : 's'}
          </Btn>
        )}
      </div>

      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Interviews reviewed" value={fmt.int(done.length)} accent
          sub={`of ${fmt.int(data.list.length)} held in ${phrase}`}
          def={'Every interview is recorded. The assistant reviews how it was run — the opening, the '
            + 'questions against the JD, listening, compliance, the close, and how quickly the '
            + 'scorecard followed — and scores the interviewer out of 100.'} />
        <Kpi label="Median interviewer score" value={median == null ? '—' : median}
          unit={median == null ? undefined : '/100'}
          sub={median == null ? 'nothing analysed yet' : bandText(median)}
          def={'The median of every interviewer score in the period. 80 and above is strong; below 50 '
            + 'needs a conversation.'} />
        <Kpi label="Flagged for a second look" value={fmt.int(flagged.length)}
          sub={flagged.length ? 'unlawful ground or no recording notice' : 'nothing flagged'}
          def={'Reviews where the assistant heard something outside the role — family plans, marital '
            + 'status, nationality — or where the recording notice was never read out.'} />
        <Kpi label="Recordings waiting" value={fmt.int(pending.length)}
          sub={pending.length ? 'not analysed yet' : 'all caught up'}
          def="Interviews held in the period whose recording has not been analysed." />
      </div>

      {!!flagged.length && (() => {
        const names = [...new Set(flagged.map((i) => i.interviewer || i.panel[0]).filter(Boolean))] as string[];
        return (
          <Banner tone="bad" icon="alert"
            title={`${flagged.length} interview${flagged.length === 1 ? '' : 's'} flagged in ${phrase}`}
            body={`${names.slice(0, 5).join(', ')}${names.length > 5 ? ' and others' : ''} — the reviews below say what was heard. Worth a quiet word before the next round.`}
            action={<Btn size="xs" variant="out" action="sch.who" v={names[0] ?? ''}>Open the first</Btn>} />
        );
      })()}

      <div className="grid g-side" style={{ marginBottom: 14 }}>
        <Card title="The six things every interview should do" icon="target"
          sub={`Every review scores the same six, 1 to 5 — this is the average across ${phrase}.`}
          foot={<span className="t-foot">The lowest of the six is the training session worth running.</span>}>
          <div className="stack sm">
            {CRIT.map(([k, label, hint]) => {
              const m = data.critMeans.find((c) => c.key === k)?.mean ?? null;
              return <CritMean key={k} label={label} hint={hint} v={m} />;
            })}
          </div>
        </Card>

        <Card title="How the scores sit" icon="chart"
          foot={<span className="t-foot">{fmt.int(scores.length)} reviews in {phrase}.</span>}>
          <Donut size={170} centre={median == null ? '—' : String(median)} centreSub="median"
            segments={BANDS.map(([label, f, color]) => ({ label, color, value: scores.filter(f).length }))
              .filter((x) => x.value)} />
          <Legend items={BANDS.map(([label, f, color]) => ({
            color, label, value: fmt.int(scores.filter(f).length),
          }))} />
        </Card>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Card title="Every interviewer, best first" icon="users" flush
          actions={<span className="t-foot">{board.length} people ran interviews in {phrase}</span>}
          foot={
            <span className="t-foot">
              Airtime is the interviewer&rsquo;s share of the words — above 50% and the candidate never
              got going. Anyone with fewer than {MIN_N} interviews sits at the bottom: too few to judge.
              Click a row for that person&rsquo;s own review and coaching.
            </span>
          }>
          <Table cols={boardCols} emptyIcon="users"
            emptyTitle="Nobody has run an interview in this window"
            rows={board.map((x) => ({
              ...x, _act: 'sch.who', _v: x.name,
              _cls: x.name === sel ? 'sel' : (x.n < MIN_N ? 'thin' : ''),
            }))} />
        </Card>
      </div>

      {mine && (
        <div style={{ marginBottom: 14 }}>
          <Card title="How your interviews are going" icon="target"
            actions={<Chip tone={band(mine.score) || undefined}>{mine.score} of 100</Chip>}
            sub={`${mine.n} interview${mine.n === 1 ? '' : 's'} in ${phrase} · ${bandText(mine.score)}. `
              + 'Coaching from the recordings, not a judgement on your candidates.'}
            foot={
              <span className="t-foot">
                Scored on {CRIT.length} things every interview should do. Your own interviews only —
                nobody else sees your coaching notes unless they are an Admin.
              </span>
            }>
            <div className="grid g-2" style={{ gap: 14 }}>
              <div>
                {CRIT.map(([k, label, hint]) => (
                  <CritOwn key={k} label={label} hint={hint}
                    v={mine.ratings[k] == null ? null : Math.round((mine.ratings[k] as number) * 10) / 10} />
                ))}
              </div>
              <div>
                {mine.airtime != null && (
                  <Kvs pairs={[
                    ['Your airtime', `${mine.airtime}% of the words — ${mine.airtime <= 40 ? 'about right' : 'try to talk less'}`],
                    ['Strongest', mine.best ? CRIT_LABEL[mine.best] : '—'],
                    ['Weakest', mine.worst ? CRIT_LABEL[mine.worst] : '—'],
                    ['Flagged', mine.flags ? `${mine.flags} interview${mine.flags === 1 ? '' : 's'}` : 'none'],
                  ]} />
                )}
                {!!mine.slips.length && (
                  <>
                    <div className="t-over" style={{ margin: '10px 0 6px' }}>What comes up most</div>
                    <ul className="bullets warn">
                      {mine.slips.slice(0, 3).map((x) => (
                        <li key={x.t}>{x.t}{x.n > 1 ? <span className="mut"> · {x.n} times</span> : null}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="grid g-side">
        <Card title={sel ? `${fmt.first(sel)}'s interviews` : 'The interviews themselves'} icon="cal" flush
          actions={sel ? <Btn size="xs" variant="ghost" action="sch.who" v="">Show everyone</Btn> : undefined}
          foot={
            <span className="t-foot">
              Click any row for the full review — the recording, the airtime, what was done well and
              what to change next time.
            </span>
          }>
          <Table cols={ivCols} emptyIcon="cal" emptyTitle="No interviews in this window"
            rows={list.slice(0, 40).map((i) => ({ ...i, _act: 'ivr.open', _v: i.id }))} />
        </Card>

        <Card title="What comes up most" icon="target"
          foot={
            <span className="t-foot">
              The coaching points the assistant repeated most across {fmt.int(done.length)} reviews.
              Two or three of these are usually a training session, not a performance conversation.
            </span>
          }>
          {data.worst.length ? (
            <div className="stack sm">
              {data.worst.map((x) => (
                <div className="cm" key={x.t}>
                  <span>{x.t}</span>
                  <Bar p={x.n / data.worst[0].n} thin tone="warn" />
                  <b className="num">{x.n}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="t-sub">Nothing recurring — the interviews in this window were run cleanly.</p>
          )}
        </Card>
      </div>
    </>
  );
}
