import * as React from 'react';
import { Card, Li, Chip, Bar, Empty, AvatarStack } from '@/components/ui/primitives';
import { Badge, Icon } from '@/components/ui/icons';
import { BrandLogo } from '@/components/ui/brand';
import { Pie, Legend, Spark, type Picks } from '@/components/charts';
import { applicationsUrl } from '@/lib/charts/drill';
import { RAMP } from '@/lib/charts/palette';
import { fmt, daysBetween } from '@/lib/format';
import * as W from '@/lib/domain/window';
import type { OverviewData } from '@/lib/queries/overview';

/* ─────────────────────────────────────────────────────────────────────────────
   The board: two rows of three cards under the hero.

   Composition, the four headline metrics against the period before, and where
   the applications came from; then what needs a move, who is about to join, and
   the four things somebody starts from a standing start.
   ───────────────────────────────────────────────────────────────────────────*/

const ROLES: Array<[string, string]> = [
  ['recruiter', 'Recruiters'], ['sourcer', 'Sourcers'], ['coordinator', 'Coordinators'],
  ['analyst', 'Analysts'], ['onboarding', 'Onboarding'], ['tal_lead', 'TA lead'],
];

export function TeamComposition({ data, canOpen }: {
  data: OverviewData;
  /* Whether this account may open the team's record at all. A slice that
     leads to a refusal is worse than a slice that simply explains itself. */
  canOpen?: boolean;
}) {
  const team = data.team;
  const segs = ROLES
    .map(([k, label]) => ({ key: k, label, value: team.filter((p) => p.role === k).length }))
    .filter((x) => x.value)
    .sort((a, b) => b.value - a.value);
  const teamTotal = segs.reduce((n, s) => n + s.value, 0) || 1;
  const picks: Picks = segs.map((s) => ({
    ...(canOpen ? { act: 'go', v: `/team?role=${encodeURIComponent(s.key)}` } : {}),
    tip: {
      label: s.label,
      value: fmt.int(s.value),
      rows: [['Share of the desk', fmt.pct(s.value / teamTotal)]],
      ...(canOpen ? { action: `Open the ${s.label.toLowerCase()}` } : {}),
    },
  }));

  const recruiters = team.filter((p) => p.role === 'recruiter' || p.role === 'tal_lead');
  const months = Math.max(1, data.window.days / 30.4);
  const hires = recruiters.reduce((n, r) => n + r.hires, 0);
  const target = recruiters.reduce((n, r) => n + Math.round(r.monthlyTarget * months), 0);

  return (
    <Card
      title="Team composition" icon="users"
      foot={
        <span className="t-foot">
          {fmt.int(team.length)} people on the desk · {fmt.int(hires)} hires against a target of{' '}
          {fmt.int(target)} for {W.phrase(data.window)}.
        </span>
      }
    >
      <div className="pie-row">
        <Pie segments={segs} size={210} picks={picks} />
        <Legend items={segs.map((x, i) => ({
          color: RAMP[i % RAMP.length], label: x.label, value: fmt.int(x.value),
        }))} picks={picks} />
      </div>
      <div className="avrow">
        <AvatarStack people={team} max={6} />
        <Bar p={target ? hires / target : 0} title={`${fmt.int(hires)} of ${fmt.int(target)} target`} />
        <b className="num" style={{ fontSize: 12.5 }}>{target ? fmt.pct(hires / target) : '—'}</b>
      </div>
    </Card>
  );
}

function MetricTile({ icon, label, value, unit, trend, action }: {
  icon: string; label: string; value: React.ReactNode; unit?: string;
  trend: { v: number; good: boolean } | null; action?: string;
}) {
  const inner = (
    <>
      <Badge name={icon} size={16} />
      <span className="tl-l">{label}</span>
      <b className="tl-v">{value}{unit && <small>{unit}</small>}</b>
      {trend ? (
        <span className={`tl-t ${trend.good ? 'up' : 'down'}`}>
          <Icon name={trend.v >= 0 ? 'arrU' : 'arrD'} size={11} sw={2.4} />
          {fmt.pct(Math.abs(trend.v))}
        </span>
      ) : <span className="tl-t" style={{ color: 'var(--ink-4)' }}>no prior period</span>}
    </>
  );
  return action
    ? <button className="tile" data-act="go" data-v={action}>{inner}</button>
    : <div className="tile">{inner}</div>;
}

const delta = (a: number | null, b: number | null, inverse?: boolean) =>
  (b ? { v: ((a ?? 0) - b) / b, good: inverse ? (a ?? 0) <= b : (a ?? 0) >= b } : null);

export function KeyMetrics({ data }: { data: OverviewData }) {
  const acceptance = data.offers.rate;
  const q = data.quality.mean;
  return (
    <Card
      title="Key metrics" icon="target"
      foot={
        <span className="t-foot">
          Each tile compares {W.phrase(data.window)} with the same span before it. Click a tile for the
          full report.
        </span>
      }
    >
      <div className="tiles">
        <MetricTile icon="clock" label="Time to fill" value={fmt.dec(data.timeToFill.median, 0)} unit="days"
          trend={delta(data.timeToFill.median, data.timeToFill.prev, true)} action="/insights?tab=tat" />
        <MetricTile icon="file" label="Offer acceptance"
          value={acceptance == null ? '—' : fmt.pct(acceptance)}
          trend={acceptance != null && data.offers.prevRate != null
            ? delta(acceptance, data.offers.prevRate) : null}
          action="/insights" />
        <MetricTile icon="star" label="Quality of hire" value={q ? fmt.dec(q, 2) : '—'} unit={q ? '/ 5' : ''}
          trend={q && data.quality.prev ? delta(q, data.quality.prev) : null} action="/insights" />
        <MetricTile icon="phone" label="First response" value={fmt.dec(data.firstResponse.median, 1)} unit="days"
          trend={delta(data.firstResponse.median, data.firstResponse.prev, true)} action="/insights?tab=tat" />
      </div>
      <div className="miniwave">
        <Spark values={data.buckets.map((b) => b.applications)} w={320} h={56} color="var(--brand-500)" />
      </div>
      <div className="footline">
        <span>Applications a {data.buckets[0]?.unit ?? 'month'}, {W.phrase(data.window)}</span>
      </div>
    </Card>
  );
}

export function SourcesDonut({ data }: { data: OverviewData }) {
  const cols = ['var(--wave-1)', 'var(--wave-2)', 'var(--wave-3)', 'var(--wave-4)'];
  const top = data.sources.slice(0, 4);
  const other = data.sources.slice(4).reduce((n, m) => n + m.applications, 0);
  const segs = [
    ...top.map((m, i) => ({ label: m.source.split(' — ')[0], value: m.applications, color: cols[i] })),
    ...(other ? [{ label: 'Other', value: other, color: 'var(--wave-5)' }] : []),
  ];
  const total = segs.reduce((n, s) => n + s.value, 0) || 1;

  /* A channel's slice is the applications that arrived through it inside the
     period. "Other" is the rest of the ranking, and it lands on all of those
     channels at once rather than on nothing. */
  const rest = data.sources.slice(4).map((m) => m.source);
  const picks: Picks = segs.map((s, i) => {
    const m = top[i];
    const isOther = i >= top.length;
    return {
      act: 'go',
      v: applicationsUrl({
        tab: 'all', apps: true, from: data.from, to: data.to,
        ...(isOther ? { sources: rest } : { source: m.source }),
      }),
      tip: {
        label: isOther ? `Other channels` : m.source,
        value: `${fmt.int(s.value)} application${s.value === 1 ? '' : 's'}`,
        rows: [
          ['Share of the period', fmt.pct(s.value / total)],
          ...(isOther
            ? [['Channels', fmt.int(rest.length)] as [string, string]]
            : [
              ['Hires from it', fmt.int(m.hires)] as [string, string],
              ['Converts to hire', fmt.pct(m.conv)] as [string, string],
            ]),
        ],
        action: `Open ${fmt.int(s.value)} application${s.value === 1 ? '' : 's'}`,
      },
    };
  });
  return (
    <Card
      title="Sourcing channels" icon="search"
      foot={
        <span className="t-foot">
          Share of applications in the period.{' '}
          {top[0] ? `${top[0].source} converts ${fmt.pct(top[0].conv)} to hire.` : ''}
        </span>
      }
    >
      <div className="pie-row">
        <Pie segments={segs} size={210} picks={picks} />
        <Legend picks={picks}
          items={segs.map((s) => ({ color: s.color!, label: s.label, value: fmt.pct(s.value / total) }))} />
      </div>
    </Card>
  );
}

/* ── The second row ─────────────────────────────────────────────────────── */
function CountTile({ icon, label, n, action, v, tone }: {
  icon: string; label: string; n: number; action: string; v?: string; tone?: 'up' | 'down';
}) {
  return (
    <button className="tile" data-act={action} data-v={v ?? ''}>
      <Badge name={icon} size={16} />
      <b className="tl-v">{fmt.int(n)}</b>
      <span className="tl-l">{label}</span>
      {tone && (
        <span className={`tl-t ${tone}`}>
          <Icon name={tone === 'down' ? 'alert' : 'check'} size={11} sw={2.2} />{' '}
          {tone === 'down' ? 'needs a move' : 'clear'}
        </span>
      )}
    </button>
  );
}

export function Attention({ data }: { data: OverviewData }) {
  const h = data.health;
  return (
    <Card title="Needs attention" icon="zap">
      <div className="tiles tiles-3">
        <CountTile icon="clock" label="Past their stage SLA" n={h.overCount}
          action="go" v="/candidates?tab=pipeline&sort=stale" tone={h.overCount ? 'down' : 'up'} />
        <CountTile icon="star" label="Scorecards outstanding" n={h.noFeedbackCount}
          action="go" v="/scheduling?tab=load" tone={h.noFeedbackCount ? 'down' : 'up'} />
        <CountTile icon="mail" label="Offers awaiting signature" n={h.offersOutCount}
          action="go" v="/candidates?tab=pipeline&stage=offer" />
        <CountTile icon="brief" label="Requisitions at risk" n={h.atRisk.length}
          action="go" v="/jobs?sort=age" tone={h.atRisk.length ? 'down' : 'up'} />
        <CountTile icon="shield" label="Awaiting approval" n={data.awaitingApproval}
          action="go" v="/jobs?status=pending_approval" tone={data.awaitingApproval ? 'down' : 'up'} />
        <CountTile icon="spark" label="Screened, awaiting a call" n={data.screenedWaiting}
          action="go" v="/candidates?tab=pipeline&stage=applied" tone={data.screenedWaiting ? 'down' : 'up'} />
      </div>
      <div className="footline"><span>Source</span><i /><span>Screen</span><i /><span>Hire</span></div>
    </Card>
  );
}

export function UpcomingJoiners({ data, now }: { data: OverviewData; now: Date }) {
  const soon = data.joiners;
  const q = data.offers.letterQueue;
  return (
    <Card
      title="Upcoming joiners" icon="cal" flush
      foot={
        <div className="col" style={{ gap: 8, flex: 1 }}>
          <button className="btn pri block" data-act="go" data-v="/candidates?tab=pipeline&stage=offer">
            <Icon name="file" size={14} /> {fmt.int(data.offers.inFlight)} offer
            {data.offers.inFlight === 1 ? '' : 's'} in flight
          </button>
          {!!q && (
            <button className="btn out block" data-act="offer.queue">
              <Icon name="shield" size={14} /> {fmt.int(q)} offer letter{q === 1 ? '' : 's'} awaiting verification
            </button>
          )}
        </div>
      }
    >
      {soon.length ? (
        <div className="list">
          {soon.map((a) => {
            const d = Math.max(0, Math.round(daysBetween(now.toISOString(), a.startDate)));
            return (
              <Li key={a.applicationId} avatar={a} title={a.jobTitle}
                sub={`${a.name} · ${a.deptName}`}
                right={<Chip>{d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}</Chip>}
                action="drawer.open" v={a.applicationId} />
            );
          })}
        </div>
      ) : (
        <Empty icon="cal" title="No start dates ahead" sub="Accepted offers with a start date appear here." />
      )}
    </Card>
  );
}

export function QuickActions() {
  const a = (icon: string, label: string, sub: string, act: string) => (
    <button className="ctile" data-act={act} key={act}>
      <Badge name={icon} /><b>{label}</b><span>{sub}</span>
    </button>
  );
  return (
    <Card title="Quick actions" icon="spark">
      <div className="ctiles">
        {a('brief', 'Open a requisition', 'pick a pipeline', 'job.new')}
        {a('uplus', 'Add a candidate', 'with a résumé', 'cand.new')}
        {a('cal', 'Schedule interview', 'against a live application', 'ivw.new')}
        {a('badge', 'Add a recruiter', 'staff profile and target', 'staff.new')}
      </div>
      <div className="mark">
        <BrandLogo variant="chip" className="brand-chip" alt="Bayut" /><i /><span>TA Team</span>
      </div>
    </Card>
  );
}
