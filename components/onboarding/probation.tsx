import * as React from 'react';
import {
  Card, Kpi, Seg, Chip, Banner, Avatar, Table, Kvs, Btn, Push, type Column,
} from '@/components/ui/primitives';
import { fmt } from '@/lib/format';
import * as W from '@/lib/domain/window';
import {
  PROBATION_STATES, probationState, probationChip, daysLeft, isDecided, isOverdue, hasStarted,
  type ProbationRow,
} from '@/lib/domain/probation';
import type { Joiner } from '@/lib/queries/onboarding';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   Probation, and quality of hire.

   A hire is not a good hire the day they sign: it counts once the person has
   been here three months and has not been let go. The rate is the passes among
   the hires whose three months are behind them, and the ones still inside are
   reported beside it rather than quietly counted as good.
   ───────────────────────────────────────────────────────────────────────────*/

export function ProbationChip({ p, startDate, now }: {
  p: ProbationRow; startDate: string; now: Date;
}) {
  const c = probationChip(p, startDate, now);
  return <Chip tone={(c.tone || undefined) as any}>{c.text}</Chip>;
}

export function ProbationCard({ e, viewer, now }: { e: Joiner; viewer: Viewer; now: Date }) {
  const p = e.probation;
  const st = probationState(p, now);
  const left = daysLeft(p, now);
  const may = !viewer.isPortal;

  const sub = st === 'passed'
    ? `Confirmed ${fmt.date(p.decidedOn)} by ${p.decidedByName ?? 'the hiring manager'}. This hire counts towards quality of hire.`
    : st === 'failed'
      ? `Not confirmed — ${p.reason ?? ''}. The hire does not count.`
      : st === 'due'
        ? `The three months were up ${fmt.date(p.endsOn)}, ${Math.abs(left)} days ago, and nobody has recorded a decision.`
        : !hasStarted(e.startDate, now)
          ? `They start on ${fmt.date(e.startDate)}; the three months begin then and are up ${fmt.date(p.endsOn)}.`
          : `Started ${fmt.date(e.startDate)}. The review falls on ${fmt.date(p.endsOn)} — ${left} days from now.`;

  return (
    <Card
      title="Probation — the first three months" icon="shield"
      actions={<ProbationChip p={p} startDate={e.startDate} now={now} />}
      sub={sub}
      foot={
        <>
          <span className="t-foot">
            Quality of hire counts a hire only once these three months are behind them.
          </span>
          {may && (
            <>
              <span className="sp" />
              <Btn size="sm" variant={st === 'due' ? 'pri' : 'out'} action="prob.open" v={e.id}
                icon="check" iconSize={13}>
                {isDecided(p) ? 'Change the decision' : 'Record the decision'}
              </Btn>
            </>
          )}
        </>
      }
    >
      <Kvs pairs={[
        ['Started', fmt.date(e.startDate)],
        ['Three months up', fmt.date(p.endsOn)],
        ['Decision', st === 'in_progress' ? <span key="d" className="mut">not due yet</span>
          : st === 'due' ? <span key="d" className="warn-t">overdue</span>
            : `${PROBATION_STATES[st][0]} · ${fmt.date(p.decidedOn)}`],
        ['Recorded by', p.decidedByName ?? '—'],
      ]} />
      {p.note && <p className="t-sub" style={{ marginTop: 9 }}>{p.note}</p>}
    </Card>
  );
}

type Row = Joiner & { _cls?: string };

export function ProbationPanel({ hires, w, viewer, now }: {
  hires: Joiner[]; w: W.Window; viewer: Viewer; now: Date;
}) {
  const may = !viewer.isPortal;
  const inWin = hires.filter((e) => W.inWindow(e.startDate, w, now));
  const decided = inWin.filter((e) => isDecided(e.probation));
  const passed = decided.filter((e) => e.probation.state === 'passed');
  const failed = decided.filter((e) => e.probation.state === 'failed');
  const rate = decided.length ? passed.length / decided.length : null;

  const started = hires.filter((e) => hasStarted(e.startDate, now));
  const inside = started.filter((e) => !isDecided(e.probation));
  const late = inside.filter((e) => isOverdue(e.probation, now));
  const dueSoon = inside.filter((e) => daysLeft(e.probation, now) <= 14);
  const ahead = hires.filter((e) => !hasStarted(e.startDate, now)).length;

  const reasons: Record<string, number> = {};
  for (const e of failed) {
    const k = e.probation.reason ?? 'Not given';
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];

  const rows = [...inWin].sort((a, b) => {
    const ka = (isDecided(a.probation) ? '1' : '0') + a.probation.endsOn;
    const kb = (isDecided(b.probation) ? '1' : '0') + b.probation.endsOn;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const cols: Array<Column<Row>> = [
    {
      t: 'Joiner', cls: 'wrap',
      f: (e) => (
        <div className="row tight nowrap">
          <Avatar person={e.name} size="s" />
          <span className="ivwho"><b>{e.name}</b><em>{e.title}</em></span>
        </div>
      ),
    },
    { t: 'Department', f: (e) => <span className="t-sub">{e.deptName}</span> },
    { t: 'Source', cls: 'only-wide', f: (e) => <span className="t-sub">{e.sourceLabel ?? '—'}</span> },
    { t: 'Recruiter', cls: 'only-wide', f: (e) => <span className="t-sub">{fmt.first(e.recruiterName ?? '—')}</span> },
    { t: 'Started', n: true, f: (e) => fmt.date(e.startDate) },
    {
      t: 'Three months up', n: true,
      f: (e) => (
        <>
          {fmt.date(e.probation.endsOn)}
          {!isDecided(e.probation) && (
            <><br />
              <span className={`t-foot ${isOverdue(e.probation, now) ? 'warn-t' : ''}`}>
                {isOverdue(e.probation, now)
                  ? `${Math.abs(daysLeft(e.probation, now))} days overdue`
                  : `${daysLeft(e.probation, now)} days`}
              </span>
            </>
          )}
        </>
      ),
    },
    {
      t: 'Outcome', cls: 'wrap',
      f: (e) => (
        <>
          <ProbationChip p={e.probation} startDate={e.startDate} now={now} />
          {e.probation.state === 'failed' && e.probation.reason && (
            <><br /><span className="t-foot">{e.probation.reason}</span></>
          )}
        </>
      ),
    },
    {
      t: '',
      f: (e) => (may
        ? <Btn size="xs" variant={isOverdue(e.probation, now) ? 'pri' : 'ghost'} action="prob.open" v={e.id}>
          {isDecided(e.probation) ? 'Change' : 'Decide'}
        </Btn>
        : null),
    },
  ];

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Seg action="prob.win" active={String(w.days)} options={[
          { v: '30', t: 'Last 30 days' }, { v: '90', t: 'Last quarter' },
          { v: '180', t: 'Last 6 months' }, { v: '365', t: 'Last 12 months' },
        ]} />
        <Push />
        <span className="t-foot">Hires by their start date — the last 12 months</span>
      </div>

      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Quality of hire" value={rate == null ? '—' : fmt.pct(rate)} accent
          sub={`${fmt.int(passed.length)} of ${fmt.int(decided.length)} decided hires`}
          def={'A hire counts as a good hire when the person has been here three months and has not been '
            + 'let go. The rate is the passes among the hires whose three months are behind them; the '
            + 'ones still inside are counted separately.'} />
        <Kpi label="Still inside their three months" value={fmt.int(inWin.length - decided.length)}
          sub={dueSoon.length ? `${fmt.int(dueSoon.length)} reviewed in the next fortnight` : 'none due in the next fortnight'}
          def={'Hires who have started and whose three months are not up yet. They are not counted either '
            + `way. ${ahead ? `A further ${ahead} have accepted and have not started — their three months begin on their first day.` : ''}`} />
        <Kpi label="Reviews overdue" value={fmt.int(late.length)} inverse
          sub={late.length ? 'three months up, no decision' : 'nothing outstanding'}
          def={'The three months are behind them and nobody has recorded a decision. Until somebody does, '
            + 'the hire is not counted.'} />
        <Kpi label="Not confirmed" value={fmt.int(failed.length)}
          sub={topReason ? `most often: ${topReason[0].toLowerCase()}` : 'nobody'}
          def="Hires let go, or who resigned, inside the first three months." />
      </div>

      {!!late.length && (
        <Banner tone="warn" icon="alert"
          title={`${late.length} probation review${late.length === 1 ? '' : 's'} overdue`}
          body={late.slice(0, 4).map((e) => `${e.name} — ${Math.abs(daysLeft(e.probation, now))} days`).join(' · ')
            + (late.length > 4 ? ` and ${late.length - 4} more.` : '.')}
          action={<Btn size="xs" variant="pri" action="prob.open" v={late[0].id}>Review the first</Btn>} />
      )}

      <Card flush title="Every hire and their three months" icon="shield"
        actions={
          <span className="t-foot">
            {rows.length} hire{rows.length === 1 ? '' : 's'} · {fmt.int(inWin.length - decided.length)} still inside
          </span>
        }
        foot={
          <span className="t-foot">
            Quality of hire is the passes among the decided —{' '}
            {rate == null ? 'nothing decided yet' : `${fmt.pct(rate)} over ${W.phrase(w)}`}. The people
            still inside their three months are left out of the rate on purpose.
          </span>
        }>
        <Table cols={cols} emptyIcon="shield" emptyTitle="No hires in this window"
          rows={rows.map((e) => ({ ...e, _cls: isOverdue(e.probation, now) ? 'sel' : '' }))} />
      </Card>
    </>
  );
}
