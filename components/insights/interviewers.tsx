import * as React from 'react';
import { Card, Kpi, Bar, Table, Avatar, type Column } from '@/components/ui/primitives';
import { Bars } from '@/components/charts';
import { fmt } from '@/lib/format';
import { CRIT, CRIT_LABEL, MIN_N, band } from '@/lib/domain/ivreview';

/* How the interviews themselves were run, read across the whole desk rather
   than one person at a time. The Scheduling board has the same table for the
   coordinator; this one is for the review. */

export type BoardRow = {
  name: string; title: string; n: number; heldN: number; score: number | null; airtime: number | null;
  best: string | null; worst: string | null; flags: number;
  _act?: string; _v?: string; _cls?: string;
};

export type FlaggedRow = {
  id: string; interviewer: string | null; candidateName: string; at: string;
  flag: string; score: number | null; _act?: string; _v?: string;
};

export type InterviewersData = {
  held: number;
  reviewed: number;
  median: number | null;
  medianPrev: number | null;
  bandText: string;
  flagged: FlaggedRow[];
  board: BoardRow[];
  crit: Array<{ k: string; label: string; hint: string; avg: number | null; n: number }>;
  byStage: Array<{ label: string; value: number }>;
  slips: Array<{ t: string; n: number }>;
  airtime: number[];
  periodLabel: string;
  scopedToDept: boolean;
};

export function Interviewers({ d }: { d: InterviewersData }) {
  const overTalk = d.airtime.filter((x) => x > 50).length;
  const medAir = d.airtime.length
    ? Math.round([...d.airtime].sort((a, b) => a - b)[d.airtime.length >> 1]) : 0;
  const weakest = [...d.crit].filter((x) => x.avg != null).sort((a, b) => (a.avg! - b.avg!))[0];
  const trend = d.median != null && d.medianPrev ? (d.median - d.medianPrev) / d.medianPrev : null;

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

  const flagCols: Array<Column<FlaggedRow>> = [
    { t: 'Interviewer', f: (i) => <b>{i.interviewer ?? '—'}</b> },
    { t: 'Candidate', f: (i) => <span className="t-sub">{i.candidateName}</span> },
    { t: 'When', f: (i) => <span className="t-sub">{fmt.date(i.at)}</span> },
    { t: 'What was heard', f: (i) => <span className="t-foot">{i.flag}</span> },
    { t: 'Score', n: true, f: (i) => <span className={`chip ${band(i.score)}`}>{i.score}</span> },
  ];

  const airBands: Array<[string, (x: number) => boolean]> = [
    ['under 35%', (x) => x < 35], ['35 – 45%', (x) => x >= 35 && x < 45],
    ['45 – 55%', (x) => x >= 45 && x < 55], ['over 55%', (x) => x >= 55],
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Interviews reviewed" value={fmt.int(d.reviewed)} accent
          sub={`of ${fmt.int(d.held)} held${d.scopedToDept ? ' in this department' : ''}`}
          def="Interviews held in the period whose recording the assistant has analysed." />
        <Kpi label="Median interviewer score" value={d.median == null ? '—' : d.median}
          unit={d.median == null ? undefined : '/100'}
          sub={d.median == null ? '—' : d.bandText}
          trendValue={trend}
          def={'The median score across every review in the period, out of 100. The trend compares '
            + 'the period before.'} />
        <Kpi label="Interviewers talking too much" value={fmt.int(overTalk)}
          sub={d.airtime.length ? `of ${fmt.int(d.airtime.length)} reviewed · median airtime ${medAir}%` : '—'}
          def={'Reviews where the interviewer spoke more than half the words. The candidate cannot '
            + 'show you much in the time that is left.'} />
        <Kpi label="Flagged" value={fmt.int(d.flagged.length)}
          sub={d.flagged.length ? 'unlawful ground or no notice' : 'nothing flagged'}
          def={'Reviews where something outside the role was asked — family plans, marital status, '
            + 'nationality — or the recording notice was never read out.'} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Card title="Interviewer by interviewer" icon="users" flush
          actions={<span className="t-foot">{d.board.length} people · {d.periodLabel}</span>}
          foot={
            <span className="t-foot">
              Anyone with fewer than {MIN_N} interviews sits at the bottom — too few to judge. Click
              a row for that person&rsquo;s own review and coaching on the Scheduling board.
            </span>
          }>
          <Table cols={boardCols} emptyIcon="users" emptyTitle="No interviews reviewed in this period"
            rows={d.board.map((x) => ({
              ...x, _act: 'go',
              _v: `/scheduling?tab=interviewers&who=${encodeURIComponent(x.name)}`,
              _cls: x.n < MIN_N ? 'thin' : '',
            }))} />
        </Card>
      </div>

      <div className="grid g-side" style={{ marginBottom: 14 }}>
        <Card title="The six things" icon="target"
          sub="Every review scores the same six, 1 to 5. This is the average across the period."
          foot={weakest ? (
            <span className="t-foot">
              Weakest across the board: <b>{weakest.label}</b> at {fmt.dec(weakest.avg!, 1)} of 5.
              That is the training session worth running.
            </span>
          ) : undefined}>
          <div className="stack sm">
            {d.crit.map((x) => (
              <div className="cm" key={x.k}>
                <span>{x.label}</span>
                <Bar p={(x.avg ?? 0) / 5} thin
                  tone={x.avg == null ? undefined : x.avg < 3 ? 'bad' : x.avg < 4 ? 'warn' : undefined} />
                <b className="num">{x.avg == null ? '—' : fmt.dec(x.avg, 1)}</b>
                <i>{x.hint}</i>
              </div>
            ))}
          </div>
        </Card>

        <Card title="By stage" icon="chart"
          foot={
            <span className="t-foot">
              Median interviewer score at each interview stage. Final interviews are usually run by
              the most senior people — and they are not always the best at it.
            </span>
          }>
          {d.byStage.length
            ? <Bars data={d.byStage} h={200} />
            : <p className="t-sub">Nothing analysed in this period.</p>}
        </Card>
      </div>

      <div className="grid g-side">
        <Card title="What the reviews keep saying" icon="spark"
          foot={
            <span className="t-foot">
              The coaching points repeated most often across {fmt.int(d.reviewed)} reviews.
            </span>
          }>
          {d.slips.length ? (
            <div className="stack sm">
              {d.slips.map((x) => (
                <div className="cm" key={x.t}>
                  <span>{x.t}</span>
                  <Bar p={x.n / d.slips[0].n} thin tone="warn" />
                  <b className="num">{x.n}</b>
                </div>
              ))}
            </div>
          ) : <p className="t-sub">Nothing recurring in this period.</p>}
        </Card>

        <Card title="Airtime" icon="chart"
          foot={
            <span className="t-foot">
              The interviewer&rsquo;s share of the words. Under 45% is where candidates get room to
              answer; over 55% and the interview was mostly a monologue.
            </span>
          }>
          <Bars h={200} data={airBands.map(([label, f]) => ({ label, value: d.airtime.filter(f).length }))} />
        </Card>
      </div>

      {!!d.flagged.length && (
        <div style={{ marginTop: 14 }}>
          <Card title={`Flagged for a second look (${d.flagged.length})`} icon="alert" flush
            foot={
              <span className="t-foot">
                These are the recordings to listen to yourself before the next round with that
                interviewer.
              </span>
            }>
            <Table cols={flagCols} emptyIcon="check" emptyTitle="Nothing flagged"
              rows={d.flagged.slice(0, 12).map((i) => ({ ...i, _act: 'ivr.open', _v: i.id }))} />
          </Card>
        </div>
      )}
    </>
  );
}
