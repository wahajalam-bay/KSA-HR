import * as React from 'react';
import {
  Card, Kpi, Li, Chip, Empty, Avatar, Table, Timeline, Priority, Btn, Push, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { Funnel, Bars, HBars, Spark, type Picks } from '@/components/charts';
import { applicationsUrl, jobsUrl } from '@/lib/charts/drill';
import { fmt, ago, daysAgo } from '@/lib/format';
import * as W from '@/lib/domain/window';
import { describe } from '@/components/jobs/activity';
import type { OverviewData } from '@/lib/queries/overview';
import type { ActivityItem } from '@/lib/queries/job-tabs';

/* ─────────────────────────────────────────────────────────────────────────────
   The rest of the Overview: the six KPI tiles, what needs you today, the day's
   own list, and the four charts a review actually walks through.
   ───────────────────────────────────────────────────────────────────────────*/

const pl = (n: number, one: string, many?: string) =>
  `${fmt.int(n)} ${n === 1 ? one : (many ?? one + 's')}`;

const delta = (a: number, b: number): number | null => (b > 0 ? (a - b) / b : null);

/* ── The band: pace against plan, and the cost of that pace ─────────────── */
export function Kpis({ data }: { data: OverviewData }) {
  const w = data.window;
  const inLabel = W.inLabel(w);
  const unit = data.buckets[0]?.unit ?? 'month';
  const acc = data.offers.rate;
  const nowish = !W.isRange(w);

  return (
    <>
      <Kpi label="Open requisitions" value={fmt.int(data.open.count)} accent
        sub={`${pl(data.open.openings, 'opening')} · ${fmt.int(data.open.seats)} seats unfilled`}
        def={'Requisitions with the status open, right now. Seats unfilled counts openings not yet '
          + 'filled, requisition by requisition.'}
        action={{ act: 'go', v: '/jobs' }} />

      <Kpi label="Hires" value={fmt.int(data.hires.n)}
        sub={`against a plan of ${fmt.int(data.hires.plan)} · ${fmt.pct(data.hires.plan ? data.hires.n / data.hires.plan : 0)}`}
        trendValue={delta(data.hires.n, data.hires.prev)}
        def={`Applications closed as hired in ${inLabel}, against the sum of the monthly plan for the `
          + `same ${pl(data.hires.months, 'month')}. The trend compares ${W.previousLabel(w)}; the `
          + `sparkline is the period ${unit} by ${unit}.`}
        spark={<Spark values={data.buckets.map((b) => b.hires)} />} />

      <Kpi label="Median time to hire" value={fmt.dec(data.timeToHire.median, 0)} unit="days"
        sub={data.timeToHire.n ? `across ${pl(data.timeToHire.n, 'hire')}` : 'no hires in the period'}
        trendValue={delta(data.timeToHire.median, data.timeToHire.prev)} inverse
        def={'Median days from the application arriving to the hire being closed. Fewer days is better, '
          + 'so the trend is read the other way up.'}
        spark={<Spark values={data.buckets.map((b) => b.timeToHire)} />} />

      <Kpi label="Offer acceptance" value={acc == null ? '—' : fmt.pct(acc)}
        sub={`${fmt.int(data.offers.yes)} signed · ${fmt.int(data.offers.no)} declined`}
        trendValue={acc != null && data.offers.prevRate != null ? delta(acc, data.offers.prevRate) : null}
        def={'Offers sent in the period that were accepted or signed, as a share of those accepted, '
          + 'signed or declined. Offers that lapsed are left out.'}
        spark={<Spark values={data.buckets.map((b) => b.offerAccept)} />} />

      <Kpi label="People in play" value={fmt.int(data.inPlay.total)}
        sub={nowish
          ? `${fmt.int(data.inPlay.live)} still live · ${fmt.int(data.health.overCount)} past SLA`
          : data.inPlay.live ? `${fmt.int(data.inPlay.live)} of them still live today` : 'none of them still live today'}
        def={`Everyone who was in the pipeline at any point in ${inLabel} — they had applied by `
          + `${fmt.date(data.to)} and had not been closed before the period began. Change the dates above `
          + `and this number moves with them; “still live” is how many of them are active or on hold right now.`}
        action={{ act: 'go', v: '/candidates?tab=pipeline' }} />

      <Kpi label="Applications" value={fmt.int(data.applications.n)}
        sub={`${fmt.dec(data.applications.n / Math.max(1, w.days / 7), 0)} a week`}
        trendValue={delta(data.applications.n, data.applications.prev)}
        def={`Applications dated inside ${inLabel}, sourced and inbound together.`}
        spark={<Spark values={data.buckets.map((b) => b.applications)} />} />
    </>
  );
}

/* ── Needs you today ────────────────────────────────────────────────────── */
function Group({ n, tone, label, all, allLabel, shown, children }: {
  n: number; tone?: string; label: string; all?: string; allLabel?: string;
  shown: number; children: React.ReactNode;
}) {
  /* A check can be firing and still have nothing left to show: the stale list
     drops whatever the SLA list is already showing, and if that empties it, the
     heading and the count belong nowhere. The check still counts towards "all
     five have something in them" — it does have something, it is just being
     reported one line up. */
  if (!n || !shown) return null;
  return (
    <div>
      <div className="row tight" style={{ marginBottom: 7 }}>
        <Chip tone={(tone || undefined) as any}>{fmt.int(n)}</Chip>
        <b className="t-head">{label}</b>
        <Push />
        {all && (
          <button className="btn xs ghost" data-act="go" data-v={all}>
            {allLabel}<Icon name="chev" size={11} />
          </button>
        )}
      </div>
      <div className="list flush">{children}</div>
      {n > shown && <p className="t-foot mut" style={{ marginTop: 6 }}>and {fmt.int(n - shown)} more</p>}
    </div>
  );
}

export function Needs({ data, now }: { data: OverviewData; now: Date }) {
  const h = data.health;
  const checks = [h.overCount, h.noFeedbackCount, h.offersOutCount, h.old90Count, h.staleCount];
  const firing = checks.filter((n) => n).length;
  const total = checks.reduce((a, b) => a + b, 0);

  if (!total) {
    return (
      <Card title="Needs you today">
        <Empty icon="shield" title="Nothing is stuck"
          sub={'No SLA breach, no scorecard outstanding, no offer waiting on a signature and no '
            + 'requisition older than 90 days.'} />
      </Card>
    );
  }

  return (
    <Card
      title="Needs you today"
      sub={`${firing === 5 ? 'All five checks have' : `${fmt.int(firing)} of the five checks ${firing === 1 ? 'has' : 'have'}`} `
        + 'something in them. Every row opens the record behind it. This is the state of play now — '
        + 'the period above does not move it.'}
    >
      <div className="stack">
        <Group n={h.overCount} tone="bad" label="Past their stage SLA" shown={h.over.length}
          all="/insights?tab=tat" allLabel="Time in stage">
          {h.over.map((a) => (
            <Li key={a.id} icon="clock" title={a.name}
              sub={`${a.jobTitle} · ${a.stageName} · ${Math.round(a.days)} days in stage against a ${a.sla}-day SLA`}
              right={<span className="bad-t">{Math.round(a.days - a.sla)} d over</span>}
              action="drawer.open" v={a.id} />
          ))}
        </Group>

        <Group n={h.noFeedbackCount} tone="warn" label="Scorecards outstanding" shown={h.noFeedback.length}>
          {h.noFeedback.map((e, i) => (
            <Li key={`${e.applicationId}-${i}`} icon="star" title={e.candidateName}
              sub={`${e.evaluatorName} owes the ${e.stageName} scorecard${e.interviewedAt ? ` · interviewed ${ago(e.interviewedAt, now)}` : ''}`}
              right={<Chip tone="warn">Awaiting</Chip>}
              action="drawer.open" v={e.applicationId} />
          ))}
        </Group>

        <Group n={h.offersOutCount} tone="info" label="Offers awaiting a signature" shown={h.offersOut.length}
          all="/candidates?tab=pipeline&stage=offer" allLabel="Offer stage">
          {h.offersOut.map((o) => (
            <Li key={o.applicationId} icon="file" title={o.name}
              sub={`${o.jobTitle} · sent ${ago(o.sentAt, now)} · ${fmt.sar(o.baseMonthly)} basic`}
              right={<Chip tone="info">{o.state === 'viewed' ? 'Opened' : 'Sent'}</Chip>}
              action="drawer.open" v={o.applicationId} />
          ))}
        </Group>

        <Group n={h.old90Count} tone="warn" label="Open more than 90 days" shown={h.old90.length}
          all="/jobs?status=open" allLabel="All requisitions">
          {h.old90.map((j) => (
            <Li key={j.id} icon="brief" title={j.title}
              sub={`${j.deptName} · open ${fmt.days(j.days)} · ${j.filled >= j.openings ? `all ${pl(j.openings, 'seat')} filled` : `${j.filled} of ${j.openings} filled`} · ${pl(j.live, 'person', 'people')} in play`}
              right={j.recruiter ? <Avatar person={j.recruiter} size="s" /> : undefined}
              action="go" v={`/jobs/${j.id}`} />
          ))}
        </Group>

        <Group n={h.staleCount} label="No movement in a fortnight" shown={h.stale.length}
          all="/candidates?tab=pipeline" allLabel="Live pipeline">
          {h.stale.map((a) => (
            <Li key={a.id} icon="pin" title={a.name}
              sub={`${a.jobTitle} · sitting in ${a.stageName} since ${fmt.date(a.since)}`}
              right={<span className="mut">{fmt.days(a.days)}</span>}
              action="drawer.open" v={a.id} />
          ))}
        </Group>
      </div>
    </Card>
  );
}

/* ── My day ─────────────────────────────────────────────────────────────── */
const KIND: Record<string, string> = {
  send_offer: 'Offer', schedule: 'Scheduling', reject: 'Regrets', reference: 'References',
  screen_call: 'Screening', sourcing: 'Sourcing', review_cv: 'CV review',
  chase_feedback: 'Feedback', verify_offer: 'Offer letter',
};

function TaskRow({ t, today, now }: { t: OverviewData['tasks'][number]; today: string; now: Date }) {
  const over = !t.done && !!t.dueOn && t.dueOn < today;
  const due = !t.done && t.dueOn === today;
  return (
    <div className={`tk${t.done ? ' done' : ''}`}>
      <span className={`box${t.done ? ' on' : ''}`} data-act="task.toggle" data-v={t.id}
        role="button" tabIndex={0} aria-label={`${t.done ? 'Reopen' : 'Tick off'} — ${t.title}`}>
        <Icon name="check" size={13} sw={2.6} />
      </span>
      <span className="bd"
        {...(t.applicationId
          ? { 'data-act': 'drawer.open', 'data-v': t.applicationId, role: 'button', tabIndex: 0, style: { cursor: 'pointer' } }
          : {})}>
        <b>{t.title}</b>
        <span>
          {t.done ? 'Done' : over ? `${pl(Math.round(daysAgo(t.dueOn!, now)), 'day')} overdue`
            : due ? 'Due today' : `Due ${fmt.dateShort(t.dueOn)}`}
          {KIND[t.kind] ? ` · ${KIND[t.kind]}` : ''}
          {t.jobTitle ? ` · ${t.jobTitle}` : ''}
        </span>
      </span>
      <span className="push">
        {over ? <Chip tone="bad">Overdue</Chip>
          : due ? <Chip tone="warn">Today</Chip>
            : t.done ? null : <Priority priority={t.priority} />}
      </span>
    </div>
  );
}

export function Tasks({ data, today, now }: { data: OverviewData; today: string; now: Date }) {
  const all = data.tasks;
  const open = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done).sort((a, b) => String(b.dueOn).localeCompare(String(a.dueOn)));
  const overdue = open.filter((t) => t.dueOn && t.dueOn < today).length;
  return (
    <Card
      title="My tasks"
      actions={<Btn size="xs" variant="out" action="task.new" icon="plus" iconSize={12}>Add</Btn>}
      foot={
        <span className="t-foot">
          {pl(open.length, 'task')} open
          {overdue ? <> · <b className="bad-t">{fmt.int(overdue)} overdue</b></> : null}
          {done.length ? ` · ${fmt.int(done.length)} ticked off` : ''}
        </span>
      }
    >
      {open.length || done.length ? (
        <>
          {open.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} today={today} now={now} />)}
          {open.length > 6 && (
            <p className="t-foot mut" style={{ marginTop: 9 }}>
              and {fmt.int(open.length - 6)} more, due later
            </p>
          )}
          {done.slice(0, 2).map((t) => <TaskRow key={t.id} t={t} today={today} now={now} />)}
        </>
      ) : (
        <Empty icon="check" title="Nothing on your list" sub="Add a task and it appears here."
          action={<Btn variant="pri" size="sm" action="task.new">Add a task</Btn>} />
      )}
    </Card>
  );
}

const WSHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Agenda({ data, today, now }: { data: OverviewData; today: string; now: Date }) {
  const ivs = data.agenda;
  if (!ivs.length) {
    return (
      <Card title="Next interviews">
        <Empty icon="cal" title="Nothing scheduled"
          sub={`No interview sits in the calendar ahead of ${fmt.date(now.toISOString())}.`} />
      </Card>
    );
  }
  const days: Record<string, typeof ivs> = {};
  for (const i of ivs) {
    const k = i.at.slice(0, 10);
    days[k] = [...(days[k] ?? []), i];
  }
  return (
    <Card title="Next interviews" sub={`${pl(ivs.length, 'interview')} ahead, earliest first.`}
      foot={<Btn size="sm" variant="out" action="go" v="/scheduling" icon="cal" iconSize={13}>Open scheduling</Btn>}>
      <div className="agenda">
        {Object.keys(days).sort().map((k) => {
          const d = new Date(k + 'T00:00:00.000Z');
          return (
            <div className="ag-day" key={k}>
              <div className={`ag-d${k === today ? ' today' : ''}`}>
                <b>{d.getUTCDate()}</b><span>{WSHORT[d.getUTCDay()]}</span>
              </div>
              <div className="ag-l">
                {days[k].map((i) => (
                  <button className="slot" data-act="drawer.open" data-v={i.id} key={i.id}>
                    <span className="tm">{fmt.time(i.at)}</span>
                    <span className="bd">
                      <b>{i.title}</b>
                      <span>{i.jobTitle} · {i.mode} · {i.durationMin} min · {fmt.list(i.panel)}</span>
                    </span>
                    {i.status === 'cancelled' && <Chip tone="bad">Cancelled</Chip>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── The four charts ────────────────────────────────────────────────────── */
export function FunnelCard({ data }: { data: OverviewData }) {
  /* A step counts the applications of the period's cohort that reached that
     stage at any point — not the ones sitting in it. The drill says the same
     thing: applied inside the window, and the stage history shows the stage.
     A step nobody reached does not act; there is nothing to open. */
  const picks: Picks = data.funnel.map((r) => (r.n
    ? {
      act: 'go',
      v: applicationsUrl({
        tab: 'all', apps: true, from: data.from, to: data.to, reached: r.key,
      }),
      tip: {
        label: r.name,
        value: fmt.int(r.n),
        rows: [['Of everyone who applied', fmt.pct(r.convFromTop)]],
        action: `Open ${fmt.int(r.n)} application${r.n === 1 ? '' : 's'}`,
      },
    }
    : null));
  return (
    <Card title="The funnel"
      sub={`The ${fmt.int(data.applications.n)} applications that arrived in ${W.inLabel(data.window)}, by the
        furthest stage each one reached. Sourced entrants sit in the first row; Assessment is
        used by only some templates and is left out, so a step can read above 100%.`}>
      {data.applications.n
        ? <Funnel rows={data.funnel} picks={picks} />
        : <Empty icon="filter" title="No applications in this period" />}
    </Card>
  );
}

export function PipelineNow({ data }: { data: OverviewData }) {
  const live = data.distribution.reduce((n, d) => n + d.n, 0);
  const atOffer = data.distribution.find((d) => d.key === 'offer')?.n ?? 0;
  /* Live applications standing in that stage right now — which is exactly what
     the pipeline tab lists when it is filtered to the stage. An empty stage
     explains itself and does nothing. */
  const picks: Picks = data.distribution.map((d) => (d.n
    ? {
      act: 'go',
      v: applicationsUrl({ tab: 'pipeline', stages: [d.key] }),
      tip: {
        label: d.name,
        value: fmt.int(d.n),
        rows: [['Share of the live pipeline', fmt.pct(d.n / (live || 1))]],
        action: `Open ${fmt.int(d.n)} live application${d.n === 1 ? '' : 's'}`,
      },
    }
    : { tip: { label: d.name, value: '0', note: 'Nobody is standing here.' } }));
  return (
    <Card title="Where the pipeline sits now"
      sub={'Live applications by stage, across the nine-stage spine. Joined stays empty here because a '
        + 'hire leaves the live pipeline.'}
      foot={
        <span className="t-foot">
          {pl(live, 'live application')} · {fmt.int(atOffer)} at offer ·{' '}
          <b className="bad-t">{fmt.int(data.health.overCount)}</b> past their stage SLA
        </span>
      }>
      {live
        ? <Bars data={data.distribution.map((d) => ({ label: d.short || d.name, value: d.n, color: `var(--stg-${d.band})` }))}
            h={220} labelMax={8} picks={picks} />
        : <Empty icon="users" title="Nobody in the pipeline" />}
    </Card>
  );
}

export function PlanCard({ data }: { data: OverviewData }) {
  const m = data.buckets;
  const unit = m[0]?.unit ?? 'month';
  const done = m.slice(0, -1), cur = m[m.length - 1];
  const dh = done.reduce((n, x) => n + x.hires, 0), dt = done.reduce((n, x) => n + x.target, 0);
  const all = m.reduce((n, x) => n + x.hires, 0), at = m.reduce((n, x) => n + x.target, 0);
  /* A bar is the hires closed inside that bucket. The bucket is half-open on
     timestamps; the drill is an inclusive pair of dates, and because every
     boundary here is midnight the two describe the same set. */
  const day = (iso: string, shift = 0) =>
    new Date(Date.parse(iso) + shift * 86_400_000).toISOString().slice(0, 10);
  const picks: Picks = m.map((x) => (x.hires
    ? {
      act: 'go',
      v: applicationsUrl({
        tab: 'hired', win: 'closed', from: day(x.start), to: day(x.end, -1),
      }),
      tip: {
        label: x.label,
        value: `${fmt.int(x.hires)} hire${x.hires === 1 ? '' : 's'}`,
        rows: [
          ['Plan', x.unit === 'week' ? fmt.dec(x.target, 1) : fmt.int(x.target)],
          ['Against plan', x.target ? fmt.pct(x.hires / x.target) : '\u2014'],
        ],
        action: `Open ${fmt.int(x.hires)} hire${x.hires === 1 ? '' : 's'}`,
      },
    }
    : {
      tip: {
        label: x.label,
        value: 'no hires',
        rows: [['Plan', x.unit === 'week' ? fmt.dec(x.target, 1) : fmt.int(x.target)]],
      },
    }));
  return (
    <Card title="Hiring against plan"
      sub={unit === 'week'
        ? `Hires closed each week of ${W.inLabel(data.window)} with the plan — the monthly goal spread over its days — as the dashed rule. ${fmt.int(all)} hires against a plan of ${fmt.dec(at, 0)} — ${fmt.pct(at ? all / at : 0)} of it; the week from ${cur?.label} is still in flight.`
        : `Hires closed each month with the monthly plan as the dashed rule. ${done[0]?.label} to ${done[done.length - 1]?.label} delivered ${fmt.int(dh)} hires against a plan of ${fmt.int(dt)} — ${fmt.pct(dt ? dh / dt : 0)} of it — and ${cur?.label} is still in flight.`}
      foot={
        <span className="t-foot">
          Plan comes from the monthly hiring goals in settings{unit === 'week' ? ', pro-rated to the week' : ''}.{' '}
          {pl(cur?.hires ?? 0, 'hire')} so far in {unit === 'week' ? 'the week from ' : ''}{cur?.label} against{' '}
          {unit === 'week' ? fmt.dec(cur?.target ?? 0, 1) : fmt.int(cur?.target ?? 0)}.
        </span>
      }>
      <Bars data={m.map((x) => ({ label: x.label, value: x.hires, target: x.target }))}
        h={250} labelMax={6} padB={32} picks={picks} />
    </Card>
  );
}

type ReqRow = OverviewData['health']['atRisk'][number] & { _act?: string; _v?: string };

export function ReqsCard({ data }: { data: OverviewData }) {
  const rows = data.health.atRisk;
  const cols: Array<Column<ReqRow>> = [
    {
      t: 'Requisition',
      f: (j) => <div><b>{j.title}</b><div className="t-cap">{j.deptName} · {j.city}</div></div>,
    },
    { t: 'Open', n: true, f: (j) => fmt.days(j.days) },
    { t: 'In play', n: true, f: (j) => fmt.int(j.live) },
    { t: 'Filled', n: true, f: (j) => `${j.filled}/${j.openings}` },
    {
      t: 'Why it is here',
      f: (j) => (
        <>
          {j.days > 90 && <Chip tone="warn">Open {Math.round(j.days)} d</Chip>}
          {j.live < j.openings * 2 && <Chip tone="bad">Thin pipeline</Chip>}
          {j.filled >= j.openings && <Chip tone="ok">Seats all filled</Chip>}
        </>
      ),
    },
    { t: 'Owner', f: (j) => (j.recruiter ? <Avatar person={j.recruiter} size="s" /> : null) },
  ];
  return (
    <Card title="Requisitions needing attention" flush
      sub={`Open more than 90 days, or holding fewer than two live candidates for every
        opening. ${fmt.int(rows.length)} of ${fmt.int(data.open.count)} open requisitions meet
        that test; the ${fmt.int(Math.min(8, rows.length))} oldest are here.`}
      foot={<Btn size="sm" variant="out" action="go" v="/jobs?status=open" icon="brief" iconSize={13}>All open requisitions</Btn>}>
      <Table cols={cols} rows={rows.slice(0, 8).map((j) => ({ ...j, _act: 'go', _v: `/jobs/${j.id}` }))}
        emptyIcon="shield" emptyTitle="Every open requisition is on track" />
    </Card>
  );
}

export function DeptsCard({ data }: { data: OverviewData }) {
  const ds = data.depts.filter((d) => d.openReqs);
  /* The bar is openings on that department's open requisitions, so it lands on
     those requisitions — the list adds the same openings up. */
  const picks: Picks = ds.map((d) => ({
    act: 'go',
    v: jobsUrl({ status: 'open', deptId: d.id }),
    tip: {
      label: d.name,
      value: `${fmt.int(d.openings)} opening${d.openings === 1 ? '' : 's'}`,
      rows: [
        ['Open requisitions', fmt.int(d.openReqs)],
        ['People in play', fmt.int(d.live)],
        ...(d.hires ? [['Hired in the period', fmt.int(d.hires)] as [string, string]] : []),
      ],
      action: `Open ${fmt.int(d.openReqs)} requisition${d.openReqs === 1 ? '' : 's'}`,
    },
  }));
  return (
    <Card title="Where the demand sits"
      sub={'Openings on open requisitions, ranked. The note behind each bar is the live pipeline and '
        + 'the hires already made.'}
      foot={
        <span className="t-foot">
          {pl(ds.reduce((n, d) => n + d.openReqs, 0), 'open requisition')} across{' '}
          {pl(ds.length, 'department')}. Hires counted in {W.inLabel(data.window)}.
        </span>
      }>
      {ds.length
        ? <HBars picks={picks} data={ds.map((d) => ({
            label: d.name, value: d.openings,
            note: `${fmt.int(d.live)} in play${d.hires ? ` · ${fmt.int(d.hires)} hired` : ''}`,
          }))} />
        : <Empty icon="brief" title="No open requisitions" />}
    </Card>
  );
}

export function FeedCard({ items, total, label, capped, now }: {
  items: ActivityItem[]; total: number; label: string; capped: boolean; now: Date;
}) {
  return (
    <Card title="Recent activity"
      sub={`${fmt.int(total)} things moved in ${label}${capped ? ' (the feed stops at a quarter)' : ''} — the newest twelve, first.`}>
      {items.length ? (
        <Timeline items={items.map((a) => ({
          at: a.at,
          when: ago(a.at, now),
          byName: a.actorName,
          on: ['hired', 'offer_signed', 'offer_sent'].includes(a.kind),
          text: describe(a),
          extra: a.applicationId ? (
            <button className="btn xs ghost" data-act="drawer.open" data-v={a.applicationId}
              style={{ marginTop: 4 }}>
              {a.candidateName ?? 'Open'}{a.jobTitle ? ` · ${a.jobTitle}` : ''}
            </button>
          ) : undefined,
        }))} />
      ) : <Empty icon="spark" title={`Nothing moved in ${label}`} />}
    </Card>
  );
}
