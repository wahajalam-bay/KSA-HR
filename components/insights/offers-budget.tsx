import * as React from 'react';
import {
  Card, Kpi, Empty, Chip, Table, Avatar, Btn, JobStatus, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { Pie, Legend, HBars } from '@/components/charts';
import { RAMP } from '@/lib/charts/palette';
import { fmt, ago } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   Offers, and the budget.

   The decline reasons are the only honest read on why offers fall over: a run
   of counter-offers means something different from a run of package declines,
   and only one of the two is fixed by a band review.
   ───────────────────────────────────────────────────────────────────────────*/

export type DeclineRow = {
  applicationId: string; name: string; photo: string | null; hue: number; sector: string | null;
  jobTitle: string; deptName: string; baseMonthly: number; premium: number | null;
  days: number | null; reason: string; note: string | null;
};

export type ThreadRow = {
  applicationId: string; candidateName: string; jobTitle: string;
  asked: number; answered: number; open: boolean; lastAt: string | null;
};

export type OffersData = {
  sent: number;
  accepted: number;
  declined: number;
  lapsed: number;
  live: number;
  atOffer: number;
  rate: number | null;
  medianDays: number;
  answered: number;
  reasons: Array<{ reason: string; n: number }>;
  byDept: Array<{ name: string; n: number; a: number; d: number; rate: number | null }>;
  declines: DeclineRow[];
  threads: ThreadRow[];
  openQuestions: number;
  deptName: string;
  periodLabel: string;
  scopedToDept: boolean;
};

export function Offers({ d, now }: { d: OffersData; now: Date }) {
  if (!d.sent) {
    return (
      <Empty icon="file" title="No offers went out in this period"
        sub={`Nothing to analyse for ${d.deptName} inside ${d.periodLabel}.`} />
    );
  }

  const segs = [
    { label: 'Accepted', value: d.accepted },
    { label: 'Declined', value: d.declined },
    { label: 'Still out', value: d.live },
    { label: 'Lapsed', value: d.lapsed },
  ].filter((x) => x.value);

  const deptCols: Array<Column<OffersData['byDept'][number]>> = [
    { t: 'Department', cls: 'wrap', f: (x) => x.name },
    { t: 'Sent', n: true, f: (x) => fmt.int(x.n) },
    { t: 'Accepted', n: true, f: (x) => fmt.int(x.a) },
    { t: 'Declined', n: true, f: (x) => fmt.int(x.d) },
    {
      t: 'Acceptance', n: true,
      f: (x) => (x.rate == null ? <span className="mut">—</span>
        : <span className={x.rate < 0.6 ? 'bad-t' : ''}>{fmt.pct(x.rate)}</span>),
    },
  ];

  const declineCols: Array<Column<DeclineRow>> = [
    {
      t: 'Candidate', cls: 'wrap',
      f: (x) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: x.name, photo: x.photo, hue: x.hue }} size="s" />
          <span><b>{x.name}</b><br /><span className="t-foot">{x.sector ?? ''}</span></span>
        </div>
      ),
    },
    { t: 'Requisition', cls: 'wrap', f: (x) => <>{x.jobTitle}<br /><span className="t-foot">{x.deptName}</span></> },
    {
      t: 'Offered', n: true,
      f: (x) => (
        <>
          {fmt.sar(x.baseMonthly)}
          {x.premium != null && <><br /><span className="t-foot">{fmt.pct(x.premium)} over their pay</span></>}
        </>
      ),
    },
    { t: 'Days to answer', n: true, f: (x) => (x.days == null ? '—' : fmt.days(x.days)) },
    {
      t: 'Reason', cls: 'wrap',
      f: (x) => <><b>{x.reason}</b>{x.note && <><br /><span className="t-foot">“{x.note}”</span></>}</>,
    },
    { t: '', f: (x) => <Btn size="xs" variant="out" action="drawer.open" v={x.applicationId}>Open</Btn> },
  ];

  const threadCols: Array<Column<ThreadRow>> = [
    { t: 'Candidate', cls: 'wrap', f: (x) => x.candidateName },
    { t: 'Requisition', cls: 'wrap', f: (x) => x.jobTitle },
    { t: 'Asked', n: true, f: (x) => fmt.int(x.asked) },
    { t: 'Answered', n: true, f: (x) => fmt.int(x.answered) },
    { t: 'Last word', f: (x) => (x.open ? <Chip tone="warn">The candidate</Chip> : <Chip tone="ok">Us</Chip>) },
    { t: 'When', f: (x) => (x.lastAt ? ago(x.lastAt, now) : '—') },
    { t: '', f: (x) => <Btn size="xs" variant="out" action="offer.open" v={x.applicationId}>Open</Btn> },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Offers sent" value={fmt.int(d.sent)} accent
          sub={`${fmt.int(d.live)} still with the candidate · ${fmt.int(d.atOffer)} at the offer stage now`}
          def="Offers whose letter left the building inside the period, by the date it was sent."
          action={{ act: 'go', v: '/offers' }} />
        <Kpi label="Acceptance rate" value={d.rate == null ? '—' : fmt.pct(d.rate)}
          sub={`${fmt.int(d.accepted)} accepted · ${fmt.int(d.declined)} declined`}
          def={'Accepted as a share of accepted plus declined. Offers still out and offers that '
            + 'lapsed are left out of the ratio.'} />
        <Kpi label="Median days to an answer" value={fmt.dec(d.medianDays, 0)} unit="days" inverse
          sub={d.answered ? `across ${fmt.int(d.answered)} answered offers` : 'nothing answered yet'}
          def="Days from the letter going out to the candidate answering, accepted or declined." />
        <Kpi label="Questions asked" value={fmt.int(d.threads.length)}
          sub={d.openQuestions ? `${fmt.int(d.openQuestions)} still waiting on an answer` : 'all answered'}
          def={'Offers where the candidate came back with a question. An unanswered question is the '
            + 'cheapest offer risk to remove.'}
          action={{ act: 'go', v: '/offers' }} />
      </div>

      <div className="grid g-2">
        <Card title="Why offers were declined" icon="x"
          sub={`Recorded by the recruiter when the candidate said no — ${fmt.int(d.declined)} decline${d.declined === 1 ? '' : 's'} in ${d.periodLabel}${d.scopedToDept ? `, ${d.deptName} only` : ''}.`}>
          {d.reasons.length ? (
            <>
              <HBars color="var(--bad)"
                data={d.reasons.map((x) => ({
                  label: x.reason, value: x.n, note: fmt.pct(x.n / (d.declined || 1)),
                }))} />
              <p className="t-foot" style={{ marginTop: 10 }}>
                <Icon name="shield" size={12} /> {d.reasons[0].reason} is the most common —{' '}
                {fmt.pct(d.reasons[0].n / (d.declined || 1))} of declines.
                {d.reasons.some((x) => /package|commission/i.test(x.reason))
                  ? ' Package and commission declines are the ones a band review can fix.' : ''}
              </p>
            </>
          ) : <Empty icon="check" title="Nothing declined in this period" />}
        </Card>

        <Card title="What came back" icon="chart" sub="Every offer sent in the period by what happened to it.">
          {segs.length ? (
            <div className="pie-row">
              <Pie segments={segs} size={200} />
              <Legend items={segs.map((x, i) => ({
                color: RAMP[i % RAMP.length], label: x.label,
                value: `${fmt.int(x.value)} · ${fmt.pct(x.value / d.sent)}`,
              }))} />
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="Acceptance by department" flush>
        <Table cols={deptCols} rows={d.byDept} />
      </Card>

      {!!d.declines.length && (
        <Card title={`The declines, one by one (${d.declines.length})`} flush
          sub={'What each person said, and what the offer was worth to them — the two together are '
            + 'what a band review needs.'}>
          <Table cols={declineCols} rows={d.declines} />
        </Card>
      )}

      {!!d.threads.length && (
        <Card title="The conversation on the offer" icon="msg" flush
          sub={`${fmt.int(d.threads.reduce((n, x) => n + x.asked, 0))} questions across ${fmt.int(d.threads.length)} offers${d.openQuestions ? `, ${fmt.int(d.openQuestions)} still waiting on us` : ' — all answered'}.`}>
          <Table cols={threadCols} rows={d.threads} />
        </Card>
      )}
    </>
  );
}

/* ── The budget view ────────────────────────────────────────────────────── */
export type BudgetJob = {
  id: string; title: string; status: string; deptName: string; city: string | null;
  hiringManager: string | null; openings: number; salaryMin: number; salaryMax: number;
  budgetNote: string | null;
};

export type BudgetData = {
  live: number;
  openings: number;
  inPlan: number;
  out: BudgetJob[];
  withJustification: number;
  outCost: number;
  hiresOut: number;
  byDept: Array<{ name: string; n: number; out: number; openings: number; outCost: number }>;
  deptName: string | null;
};

export const annualCost = (j: { salaryMin: number; salaryMax: number; openings: number }): number =>
  Math.round(((j.salaryMin + j.salaryMax) / 2) * 12 * 1.25 * (j.openings || 1));

export function Budget({ d }: { d: BudgetData }) {
  const segs = [
    { label: 'Budgeted', value: d.inPlan },
    { label: 'Not budgeted', value: d.out.length },
  ].filter((x) => x.value);

  const cols: Array<Column<BudgetJob>> = [
    {
      t: 'Requisition', cls: 'wrap',
      f: (j) => (
        <>
          <b>{j.title}</b><br />
          <span className="t-foot">{j.deptName} · {j.city} · {j.hiringManager}</span>
        </>
      ),
    },
    { t: 'Status', f: (j) => <JobStatus status={j.status} /> },
    { t: 'Openings', n: true, f: (j) => fmt.int(j.openings) },
    { t: 'Band', n: true, f: (j) => `${fmt.sarK(j.salaryMin)} – ${fmt.sarK(j.salaryMax)}` },
    { t: 'Annual cost', n: true, f: (j) => fmt.sarK(annualCost(j)) },
    {
      t: 'Justification', cls: 'wrap',
      f: (j) => (j.budgetNote ? j.budgetNote : <span className="bad-t">none recorded</span>),
    },
    { t: '', f: (j) => <Btn size="xs" variant="out" action="go" v={`/jobs/${j.id}`}>Open</Btn> },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Live requisitions" value={fmt.int(d.live)} accent
          sub={`${fmt.int(d.openings)} openings${d.deptName ? ` in ${d.deptName}` : ''}`}
          def="Open, on hold, awaiting approval or draft — everything still to be filled." />
        <Kpi label="Inside the plan" value={fmt.int(d.inPlan)}
          sub={d.live ? `${fmt.pct(d.inPlan / d.live)} of the live book` : ''}
          def="Requisitions whose seat is funded in the approved headcount plan." />
        <Kpi label="Additions to the plan" value={fmt.int(d.out.length)}
          sub={d.out.length ? `${fmt.int(d.withJustification)} with a justification on file` : 'none'}
          def={'Requisitions marked not budgeted. Each one needs a written justification, which '
            + 'Finance and the GM read on the approval.'} />
        <Kpi label="Annual cost of the additions" value={fmt.sarK(d.outCost)} unit="/ year"
          sub={`at band midpoint, +25% for allowances${d.hiresOut ? ` · ${d.hiresOut} already hired in the period` : ''}`}
          def={'Midpoint of the band × 12 × 1.25 × openings, for the requisitions outside the plan. '
            + 'A planning figure, not payroll.'} />
      </div>

      <div className="grid g-2">
        <Card title="Budgeted against additions" icon="coin"
          sub="The live requisition book, split by whether the seat is funded in the plan.">
          {segs.length ? (
            <div className="pie-row">
              <Pie segments={segs} size={200} />
              <Legend items={segs.map((x, i) => ({
                color: RAMP[i % RAMP.length], label: x.label,
                value: `${fmt.int(x.value)} · ${fmt.pct(x.value / (d.live || 1))}`,
              }))} />
            </div>
          ) : <Empty icon="coin" title="No live requisitions" />}
        </Card>

        <Card title="Additions by department" icon="grid"
          sub="Where hiring is running ahead of the approved plan.">
          {d.byDept.some((x) => x.out) ? (
            <HBars color="var(--warn)"
              data={d.byDept.filter((x) => x.out).map((x) => ({
                label: x.name, value: x.out, note: `${fmt.sarK(x.outCost)}/yr`,
              }))} />
          ) : <Empty icon="check" title="Everything live is inside the plan" />}
        </Card>
      </div>

      <Card title={`Requisitions outside the plan (${d.out.length})`} flush
        sub="Each one carries the justification the department wrote when it was raised.">
        {d.out.length
          ? <Table cols={cols} rows={d.out} />
          : <Empty icon="check" title="Every live requisition is budgeted"
            sub="Nothing has been added to the plan in this scope." />}
      </Card>
    </>
  );
}
