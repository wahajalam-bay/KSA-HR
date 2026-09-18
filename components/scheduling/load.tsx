import * as React from 'react';
import {
  Card, Kpi, Chip, Empty, Banner, Avatar, Table, Li, Btn, type Column,
} from '@/components/ui/primitives';
import { Pie, Legend, Bars, HBars } from '@/components/charts';
import { RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import { NEXT_D, BACK_D, CAP, dayKey, dowOf, DOWS, isWeekend } from '@/lib/queries/scheduling';
import type { load as loadQuery, LoadRow } from '@/lib/queries/scheduling';

/* Who is carrying how much: interviews booked and held, scorecards outstanding,
   live applications, and the three thresholds that say somebody has too much on.
   Panel members are recorded by name on the interview, so an interviewer who is
   not on the TA team shows no requisition or pipeline figures. */

type Data = Awaited<ReturnType<typeof loadQuery>>;
type Row = LoadRow & { _act?: string; _v?: string };

export function LoadTab({ data, now }: { data: Data; now: Date }) {
  const strain = [...data.rows].sort((a, b) =>
    (b.flags.length * 100 + b.ahead * 4 + b.waiting * 3 + b.live / 10)
    - (a.flags.length * 100 + a.ahead * 4 + a.waiting * 3 + a.live / 10));
  const flagged = data.rows.filter((r) => r.flags.length);
  const interviewers = data.rows.filter((r) => r.held || r.ahead)
    .sort((a, b) => (b.held + b.ahead) - (a.held + a.ahead));
  const waiters = data.rows.filter((r) => r.waiting).sort((a, b) => b.waiting - a.waiting);
  const carriers = data.rows.filter((r) => r.staffId).sort((a, b) => b.live - a.live);

  const modes: Record<string, number> = {};
  for (const i of [...data.held, ...data.ahead]) {
    const k = i.mode || 'Unspecified';
    modes[k] = (modes[k] ?? 0) + 1;
  }
  const segsAll = Object.entries(modes).map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const top = segsAll.slice(0, 4);
  const rest = segsAll.slice(4).reduce((n, x) => n + x.value, 0);
  const use = rest ? [...top, { label: 'Other', value: rest }] : top;
  const tot = use.reduce((n, x) => n + x.value, 0) || 1;

  const weekendAhead = data.ahead.filter((i) => isWeekend(dayKey(i.at)));

  const cols: Array<Column<Row>> = [
    {
      t: 'Person',
      f: (r) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: r.name, photo: r.photo, hue: r.hue }} size="s" />
          <b>{r.name}</b>
        </div>
      ),
    },
    { t: 'Role', f: (r) => (r.roleLabel ? <Chip tone="brand">{r.roleLabel}</Chip> : <Chip>Panel only</Chip>) },
    {
      t: 'Live apps', n: true,
      f: (r) => (r.staffId
        ? <span className={r.live > CAP.live ? 'warn-t' : ''}>{fmt.int(r.live)}</span>
        : <span className="mut">—</span>),
    },
    {
      t: 'Past SLA', n: true,
      f: (r) => (r.staffId
        ? (r.overSla ? <span className="bad-t">{fmt.int(r.overSla)}</span> : <>0</>)
        : <span className="mut">—</span>),
    },
    { t: 'Open reqs', n: true, f: (r) => (r.staffId ? fmt.int(r.reqs) : <span className="mut">—</span>) },
    {
      t: `Booked ${NEXT_D}d`, n: true,
      f: (r) => <span className={r.ahead > CAP.ahead ? 'warn-t' : ''}>{fmt.int(r.ahead)}</span>,
    },
    { t: `Held ${BACK_D}d`, n: true, f: (r) => fmt.int(r.held) },
    {
      t: 'Scorecards due', n: true,
      f: (r) => (r.waiting
        ? <span className={r.waitedMax > CAP.waiting ? 'bad-t' : ''}>
          {fmt.int(r.waiting)}{r.waitedMax ? <> <em className="mut">{Math.round(r.waitedMax)}d</em></> : null}
        </span>
        : <>0</>),
    },
    {
      t: 'Standing',
      f: (r) => (r.flags.length ? <Chip tone="bad">Over capacity</Chip> : <Chip tone="ok">Within capacity</Chip>),
    },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Interviews booked ahead" value={fmt.int(data.ahead.length)} sub={`next ${NEXT_D} days`}
          def={`Interviews with a date between now and ${fmt.date(new Date(now.getTime() + NEXT_D * 86_400_000).toISOString())}, cancellations excluded.`} />
        <Kpi label="Interviews held" value={fmt.int(data.held.length)} sub={`last ${BACK_D} days`}
          def={`Interviews dated in the last ${BACK_D} days, cancellations excluded.`} />
        <Kpi label="Scorecards outstanding" value={fmt.int(data.open.length)}
          sub={`${waiters.length} interviewers waiting`} accent={data.open.length > 10}
          def="Evaluation records created for an interview and not yet submitted." />
        <Kpi label="People over capacity" value={fmt.int(flagged.length)} sub={`of ${data.rows.length} on the board`}
          def={`Flagged above ${CAP.live} live applications, above ${CAP.ahead} interviews in the next fortnight, or a scorecard waiting more than ${CAP.waiting} days.`} />
      </div>

      {!!flagged.length && (
        <Banner tone="warn" icon="alert"
          title={`${flagged.length} ${flagged.length === 1 ? 'person is' : 'people are'} over capacity`}
          body={flagged.slice(0, 4).map((r) => `${r.name} — ${fmt.list(r.flags)}`).join('; ')
            + (flagged.length > 4 ? `; and ${flagged.length - 4} more in the table below.` : '.')} />
      )}

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Interviews by format"
          sub={`Every interview held in the last ${BACK_D} days or booked into the next ${NEXT_D}, by how it runs.`}>
          {use.length ? (
            <div className="pie-row">
              <Pie segments={use} size={200} />
              <Legend items={use.map((x, i) => ({
                color: RAMP[i % RAMP.length], label: x.label,
                value: `${fmt.int(x.value)} · ${fmt.pct(x.value / tot)}`,
              }))} />
            </div>
          ) : <Empty icon="cal" title="No interviews in the window" />}
        </Card>

        <Card title="Interviews a week"
          sub={`Held per week over the last ${BACK_D} days, then what is booked ahead.`}
          foot={<span className="t-foot">The last two bars are bookings, not history.</span>}>
          <Bars data={data.weeks} h={220} labelMax={6} />
        </Card>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Interview load per interviewer"
          sub={`Interviews held in the last ${BACK_D} days. The note is what is already booked into the next ${NEXT_D}.`}>
          {interviewers.length ? (
            <HBars data={interviewers.map((r) => ({
              label: r.name, value: r.held,
              note: r.ahead ? `+${r.ahead} ahead` : 'none ahead',
              color: r.ahead > CAP.ahead ? 'var(--warn)' : 'var(--seq-3)',
            }))} />
          ) : <Empty icon="cal" title="No interviews in either window" />}
        </Card>

        <Card title="Scorecards outstanding per interviewer"
          sub={'Unsubmitted evaluations. The note is how long the oldest one has been waiting, counted '
            + 'from the interview it belongs to.'}>
          {waiters.length ? (
            <HBars data={waiters.map((r) => ({
              label: r.name, value: r.waiting,
              note: r.waitedMax ? `oldest ${Math.round(r.waitedMax)} d` : '',
              color: r.waitedMax > CAP.waiting ? 'var(--bad)' : 'var(--seq-3)',
            }))} />
          ) : <Empty icon="star" title="Every scorecard is in" />}
        </Card>

        <Card title="Live applications carried per recruiter"
          sub={'Active and on-hold applications owned by each recruiter. The note is how many of them '
            + 'are past their stage SLA.'}>
          {carriers.length ? (
            <HBars data={carriers.map((r) => ({
              label: r.name, value: r.live,
              note: r.overSla ? `${r.overSla} past SLA` : 'all inside SLA',
              color: r.live > CAP.live ? 'var(--warn)' : 'var(--seq-3)',
            }))} />
          ) : <Empty icon="users" title="No live applications" />}
        </Card>

        <Card title="Booked into the KSA weekend"
          sub="Friday and Saturday are the weekend in the Kingdom — anything here needs moving.">
          {weekendAhead.length ? (
            <div className="list flush">
              {[...weekendAhead].sort((a, b) => a.at.localeCompare(b.at)).map((i) => (
                <Li key={i.id} avatar={{ name: i.candidateName, photo: i.photo, hue: i.hue }}
                  title={i.candidateName}
                  sub={`${DOWS[dowOf(dayKey(i.at))]} ${fmt.dateShort(i.at)}, ${fmt.time(i.at)} · ${i.mode}`}
                  right={<Btn size="xs" variant="out" action="ivw.reschedule" v={i.id}>Move</Btn>} />
              ))}
            </div>
          ) : (
            <Empty icon="check" title="Nothing booked into a weekend"
              sub={`All ${data.ahead.length} interviews ahead sit on a working day.`} />
          )}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card flush title="Capacity board"
          sub={`Everyone who interviews or recruits, heaviest first. Flagged above ${CAP.live} live
            applications, above ${CAP.ahead} interviews in the next fortnight, or a scorecard waiting
            more than ${CAP.waiting} days.`}
          foot={
            <span className="t-foot">
              Panel members are recorded by name on the interview, so an interviewer who is not on the
              TA team shows no requisition or pipeline figures.
            </span>
          }>
          <Table cols={cols} rows={strain} emptyIcon="users" emptyTitle="Nobody on the board" />
        </Card>
      </div>
    </>
  );
}
