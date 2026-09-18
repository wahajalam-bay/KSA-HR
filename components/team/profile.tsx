import * as React from 'react';
import {
  Card, Kpi, Chip, Empty, Avatar, Table, Btn, Banner, Kvs, Ring, Bar,
  StagePill, JobStatus, Priority, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import {
  Bars, Grouped, Legend, Pie, HBars, Funnel, type Pick, type Picks, type Picks2,
} from '@/components/charts';
import { applicationsUrl } from '@/lib/charts/drill';

/* The stage keys behind each group on this page's pipeline ring, in the order
   the query builds them. They have to agree, or the ring lands on the wrong
   people — so they are written once, here, and read from both ends. */
/** The last day of a calendar month, as a date. */
const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const PIPELINE_GROUPS: Record<string, string[]> = {
  Applied: ['applied', 'sourced'],
  Screening: ['screen', 'assessment'],
  Interviewing: ['iv1', 'iv2', 'ivf'],
  Offer: ['offer'],
};
import { CAT, RAMP } from '@/lib/charts/palette';
import { fmt, ago, daysBetween } from '@/lib/format';
import { roleDef, axisInt } from '@/lib/domain/team';
import { STAGE_INDEX, type StageKey } from '@/lib/domain/stages';
import * as W from '@/lib/domain/window';
import type { Profile, ProfileReq, ProfileClaim, ProfileChase } from '@/lib/queries/team';

/* ─────────────────────────────────────────────────────────────────────────────
   One person's record.

   The header and the period band read the same numbers as the Insights
   leaderboard; below them sit the things only a profile can say — the
   requisitions on their name, the candidates they have tagged, what is past
   SLA on their desk, and whether the people they hired were still here three
   months later.
   ───────────────────────────────────────────────────────────────────────────*/

export function StaffHeader({ p, canEdit, canDelete, isSelf }: {
  p: Profile['person']; canEdit: boolean; canDelete: boolean; isSelf: boolean;
}) {
  const role = roleDef(p);
  return (
    <Card title="Staff profile"
      actions={
        <>
          {(canEdit || isSelf) && (
            <label className="btn sm ghost dz-inline" data-dz={`staff.photo:${p.id}`}>
              <Icon name="upload" size={13} /> Change photo
              <input type="file" hidden accept="image/*" />
            </label>
          )}
          <Btn size="sm" variant="out" action="staff.edit" v={p.id} icon="pencil" iconSize={13}>
            Edit profile
          </Btn>
          {p.status === 'active' && (
            <Btn size="sm" variant="ghost" action="staff.deactivate" v={p.id}>Deactivate</Btn>
          )}
          {canDelete && !isSelf && (
            <Btn size="sm" variant="danger" action="staff.delete" v={p.id} icon="trash" iconSize={13}>
              Delete
            </Btn>
          )}
        </>
      }>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        <Avatar person={p} size="xl" />
        <div className="col" style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <div className="t-2">{p.name}</div>
          <div className="t-sub">{p.title}</div>
          <div className="row tight">
            <Chip tone={role.tone}>{role.t}</Chip>
            <Chip>{p.seniority ?? 'Mid'}</Chip>
            {p.status !== 'active' && <Chip tone="bad">Inactive</Chip>}
          </div>
        </div>
      </div>
      <Kvs pairs={[
        ['Email', <a key="e" href={`mailto:${p.email}`}>{p.email}</a>],
        ['Mobile', <span key="m" className="mono">{p.phone ?? '—'}</span>],
        ['Based in', p.locationOffice ? `${p.locationOffice}, ${p.locationCity}` : (p.locationCity ?? '—')],
        ['Joined Bayut', p.joinedOn
          ? `${fmt.date(p.joinedOn)} · ${fmt.dec(daysBetween(p.joinedOn, new Date().toISOString()) / 365, 1)} years`
          : '—'],
        ['Lifetime hires', <b key="l" className="num">{fmt.int(p.lifetimeHires)}</b>],
        ['Monthly target', p.monthlyTarget ? `${fmt.int(p.monthlyTarget)} hires a month` : 'No hiring target'],
      ]} />
      <div style={{ marginTop: 14 }}>
        <div className="t-over" style={{ marginBottom: 6 }}>Departments covered</div>
        {p.deptNames.length ? (
          <div className="wrap">{p.deptNames.map((d) => <Chip key={d}>{d}</Chip>)}</div>
        ) : (
          <p className="t-foot">No department split — this role works across the whole team.</p>
        )}
      </div>
    </Card>
  );
}

/* ── The period card: attainment for the two roles that carry a target, and
   the real contribution for the four that do not. ───────────────────────── */
export function ContributionCard({ d, win }: { d: Profile; win: W.Window }) {
  const { person: p, stat, support: sup, hiring } = d;
  const period = W.label(win).toLowerCase();

  if (!hiring) {
    const tasks = (
      <Kpi key="t" label="Open tasks" value={fmt.int(sup.openTasks)}
        def="Tasks assigned to them that are not yet ticked off." />
    );
    const figs = p.role === 'coordinator' ? [
      <Kpi key="i" label="Interviews scheduled" value={fmt.int(sup.interviews)} accent
        sub={`${fmt.int(sup.interviewsHeld)} already held`}
        def="Interviews they organised in the period, cancellations excluded." />,
      <Kpi key="r" label="Requisitions supported" value={fmt.int(sup.coordinatorReqs)}
        def="Open requisitions on which they are the named coordinator." />,
      tasks,
    ] : p.role === 'onboarding' ? [
      <Kpi key="v" label="Offer letters verified" value={fmt.int(sup.verified)} accent
        sub={`${fmt.int(sup.verifiedAllTime)} all time`}
        def="Offers whose filled letter they checked and marked verified in the period." />,
      <Kpi key="c" label="Corrections made" value={fmt.int(sup.corrections)}
        def="Fields, terms or wording they changed on a filled letter before it went out." />,
      <Kpi key="j" label="Joiners ahead" value={fmt.int(sup.joinersAhead)}
        def="Accepted offers they verified whose start date is still to come." />,
      tasks,
    ] : p.role === 'sourcer' ? [
      <Kpi key="s" label="Applications sourced" value={fmt.int(sup.sourced)} accent
        def="Applications on which they are recorded as the sourcer, by application date." />,
      <Kpi key="i" label="Interviews on those applications" value={fmt.int(sup.interviews)}
        sub={`${fmt.int(sup.interviewsHeld)} already held`}
        def="Interviews booked in the period on applications they sourced, cancellations excluded." />,
      tasks,
    ] : [
      tasks,
      <Kpi key="sc" label="Scorecards submitted" value={fmt.int(stat.scorecards)}
        def="Scorecards they filled in and submitted themselves, all time." />,
    ];
    return (
      <Card title="Contribution in the period"
        sub={`${period.replace(/^last/, 'The last')} — measured on ${p.role === 'onboarding'
          ? 'offer letters checked, corrected and sent'
          : 'sourcing, scheduling and follow-up'} rather than hires.`}>
        <div className="grid g-4">{figs}</div>
      </Card>
    );
  }

  const frac = stat.attainment ?? 0;
  const months = win.days / 30.4;
  return (
    <Card title="Attainment">
      <div className="row" style={{ gap: 18, alignItems: 'center' }}>
        <Ring p={frac} label={fmt.pct(frac)}
          title={`${fmt.int(stat.hires)} hires against a target of ${fmt.int(stat.target)}`} />
        <div className="col" style={{ gap: 4, flex: 1, minWidth: 130 }}>
          <div className="t-1 num">
            {fmt.int(stat.hires)}{' '}
            <span className="mut" style={{ fontSize: 17, fontWeight: 600 }}>of {fmt.int(stat.target)}</span>
          </div>
          <div className="t-foot">{fmt.int(p.monthlyTarget)} a month over {fmt.dec(months, 1)} months</div>
          <div className="t-foot">{fmt.dec(stat.hiresPerMonth, 1)} hires a month at the current rate</div>
          <div className={`t-foot ${frac >= 0.95 ? 'good' : frac >= 0.7 ? '' : 'warn-t'}`}>
            {stat.hires === stat.target ? 'exactly on target'
              : stat.hires > stat.target
                ? `${fmt.int(stat.hires - stat.target)} ahead of target`
                : `${fmt.int(stat.target - stat.hires)} short of target`}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function MonthlyCard({ d }: { d: Profile }) {
  const { person: p, support: sup, hiring } = d;
  if (hiring) {
    const ms = d.monthly;
    const tgt = p.monthlyTarget;
    const met = ms.filter((m) => tgt && m.hires >= tgt).length;
    const keys = [
      { key: 'hires', name: 'Hires', color: CAT[0] },
      { key: 'target', name: 'Own monthly target', color: CAT[1] },
    ];
    return (
      <Card title="Hires against their own monthly target"
        sub={`Twelve months to ${ms[ms.length - 1]?.label ?? ''}. Target ${fmt.int(tgt)} a month — met or beaten in ${met} of the 12.`}>
        <Grouped h={250} format="plain"
          data={ms.map((m) => ({ label: m.label, hires: m.hires, target: tgt }))}
          keys={keys}
          /* [month][series]. The hires bar is a set of applications — the ones
             they closed as hired inside that calendar month, which is exactly
             how the series was counted. The target bar is a goal, not a set of
             records, so it explains itself and does nothing. */
          picks={ms.map((m): Picks => [
            m.hires
              ? {
                act: 'go',
                v: applicationsUrl({
                  tab: 'hired', win: 'closed',
                  from: `${m.month}-01`, to: monthEnd(m.month),
                  ownerId: p.id,
                }),
                tip: {
                  label: m.label,
                  value: `${fmt.int(m.hires)} hire${m.hires === 1 ? '' : 's'}`,
                  rows: [['Their monthly target', fmt.int(tgt)]],
                  action: `Open ${fmt.int(m.hires)} hire${m.hires === 1 ? '' : 's'}`,
                },
              }
              : { tip: { label: m.label, value: 'no hires', rows: [['Their monthly target', fmt.int(tgt)]] } },
            { tip: { label: `${m.label} · target`, value: fmt.int(tgt), note: 'The goal for the month, not a set of records.' } },
          ]) satisfies Picks2} />
        <Legend items={keys.map((k) => ({ color: k.color, label: k.name }))} />
      </Card>
    );
  }
  if (!sup.monthly.length) {
    return (
      <Card title="Monthly record">
        <Empty icon="chart" title="No monthly series for this role"
          sub="An analyst carries no requisitions, sourcing quota or interview diary." />
      </Card>
    );
  }
  return (
    <Card title={sup.monthlyTitle} sub={sup.monthlySub}>
      {/* What this series counts depends on the role — applications sourced,
          letters verified, interviews scheduled — and the product has no one
          list that answers all three. The bars say what they are and lead
          nowhere rather than somewhere near. */}
      <Bars data={sup.monthly} h={230} labelMax={6} format="plain"
        picks={sup.monthly.map((m): Pick => ({
          tip: { label: m.label, value: fmt.int(m.value), note: sup.monthlySub },
        }))} />
    </Card>
  );
}

export function KpiBand({ d, win }: { d: Profile; win: W.Window }) {
  const s = d.stat;
  const period = W.label(win).toLowerCase();
  return (
    <>
      <Kpi label="Hires" value={fmt.int(s.hires)} accent sub={`of ${fmt.int(s.target)} target`}
        def={`Applications they own that reached Joined with a close date in the ${period}.`} />
      <Kpi label="Live pipeline" value={fmt.int(s.livePipeline)}
        sub={`${fmt.int(s.advanced)} moved past the entry stage`}
        def="Applications they own that are still active or on hold right now." />
      <Kpi label="Interviews" value={fmt.int(s.interviews)}
        def={`Interviews scheduled on their applications in the ${period}.`} />
      <Kpi label="Offers sent" value={fmt.int(s.offersSent)}
        def={`Offer letters sent on their applications in the ${period}.`} />
      <Kpi label="Offer acceptance" value={s.offerAccept == null ? '—' : fmt.pct(s.offerAccept)}
        sub={s.offersSent ? `on ${fmt.int(s.offersSent)} offers` : 'no offers sent'}
        def="Accepted offers as a share of accepted plus declined. Offers still out are excluded." />
      <Kpi label="Median time to hire" value={fmt.dec(s.timeToHire, 0)} unit="days"
        def="Median days from the application arriving to the hire being closed, across their hires in the period." />
      <Kpi label="Median first response" value={fmt.dec(s.responseDays, 1)} unit="days"
        def="Median days from an application arriving to its first move out of the entry stage." />
      <Kpi label="Scorecards submitted" value={fmt.int(s.scorecards)}
        def="Scorecards they filled in and submitted themselves, all time." />
      <Kpi label="SLA adherence" value={s.slaRate == null ? '—' : fmt.pct(s.slaRate)}
        sub={s.slaBreaches ? `${fmt.int(s.slaBreaches)} past SLA now` : 'nothing past SLA'}
        def="Share of the live applications they own that are still inside the stage SLA." />
      <Kpi label="Applications sourced" value={fmt.int(s.sourced)}
        def={`Applications they own whose source is outbound sourcing, in the ${period}.`} />
    </>
  );
}

export function PipelinePie({ d }: { d: Profile }) {
  if (!d.liveOwned) return null;
  const tot = d.pipelineGroups.reduce((n, x) => n + x.value, 0) || 1;
  /* These are the live applications they own OR sourced — a sourcer's pipeline
     is the work they brought in — grouped by stage. The list behind a slice is
     filtered the same way. */
  const groupPicks: Picks = d.pipelineGroups.map((x) => ({
    act: 'go',
    v: applicationsUrl({
      tab: 'pipeline', touchedBy: d.person.id, stages: PIPELINE_GROUPS[x.label] ?? [],
    }),
    tip: {
      label: x.label,
      value: `${fmt.int(x.value)} live application${x.value === 1 ? '' : 's'}`,
      rows: [['Share of their pipeline', fmt.pct(x.value / tot)]],
      action: `Open ${fmt.int(x.value)} live application${x.value === 1 ? '' : 's'}`,
    },
  }));
  return (
    <Card title="Their live pipeline"
      sub={`${fmt.int(d.liveOwned)} applications they own or sourced, by stage group.`}
      foot={
        <span className="t-foot">
          {fmt.int(d.pipelineOverSla)} of them past their stage SLA — named in the list below.
        </span>
      }>
      <div className="pie-row">
        <Pie segments={d.pipelineGroups} size={200} picks={groupPicks} />
        <Legend picks={groupPicks} items={d.pipelineGroups.map((x, i) => ({
          color: RAMP[i % RAMP.length], label: x.label,
          value: `${fmt.int(x.value)} · ${fmt.pct(x.value / tot)}`,
        }))} />
      </div>
    </Card>
  );
}

export function FunnelCard({ d, win, now }: { d: Profile; win: W.Window; now: Date }) {
  const own = d.stat.funnelOwn[0]?.n ?? 0;
  const rows = own ? d.stat.funnelOwn : d.sourcedFunnel;
  const fromAt = new Date(now.getTime() - win.days * 86_400_000).toISOString();
  const toAt = now.toISOString();
  if (!rows?.length) {
    return (
      <Card title="Their funnel">
        <Empty icon="filter" title="No applications attributed to them"
          sub="This role neither owns nor sources applications." />
      </Card>
    );
  }
  return (
    <Card title="Their funnel"
      sub={own
        ? `Applications they own, touched in the ${W.label(win).toLowerCase()}.`
        : 'Applications they sourced in the period.'}>
      <Funnel rows={rows} picks={rows.map((r): Pick | null => (r.n
        ? {
          act: 'go',
          v: applicationsUrl({
            tab: 'all', apps: true, reached: r.key,
            ...(own
              ? { ownerId: d.person.id, win: 'touched', fromAt, toAt }
              : { touchedBy: d.person.id, win: 'applied', fromAt, toAt }),
          }),
          tip: {
            label: r.name,
            value: fmt.int(r.n),
            rows: [['Of everyone at the top', fmt.pct(r.convFromTop)]],
            action: `Open ${fmt.int(r.n)} application${r.n === 1 ? '' : 's'}`,
          },
        }
        : null))} />
    </Card>
  );
}

export function TatCard({ d }: { d: Profile }) {
  const own = d.stat.tatOwn.length > 0;
  const rows = own ? d.stat.tatOwn : d.sourcedTat;
  if (!rows?.length) {
    return (
      <Card title="Time in stage against SLA">
        <Empty icon="clock" title="Nothing to measure yet"
          sub="Time in stage is measured on the applications a person owns or sourced." />
      </Card>
    );
  }
  return (
    <Card title="Time in stage against SLA"
      sub={`Median days on the applications they ${own ? 'own' : 'sourced'}. Red where the median is already past the stage SLA.`}>
      <HBars format="days"
        /* A median is not a set. These say what they measured — how many
           spells, how many of them broke the SLA — and lead nowhere, because
           "the applications behind this median" is not a list the product
           keeps. */
        picks={rows.map((x): Pick => ({
          tip: {
            label: x.name,
            value: `${fmt.dec(x.median, 1)} days`,
            rows: [
              ['Stage SLA', `${x.sla} days`],
              ['Spells measured', fmt.int(x.n)],
              ...(x.breaches ? [['Past the SLA', fmt.int(x.breaches)] as [string, string]] : []),
            ],
            ...(x.median > x.sla ? { note: 'The median is already past the SLA.' } : {}),
          },
        }))}
        data={rows.map((x) => ({
        label: x.name,
        value: Math.round(x.median * 10) / 10,
        marker: x.sla,
        markerLabel: `SLA ${x.sla} days`,
        scaleHint: x.sla <= 10 ? x.sla : 0,
        note: x.breaches ? `${x.breaches} past SLA of ${x.n}` : `SLA ${x.sla}d`,
        color: x.median > x.sla ? 'var(--bad)' : 'var(--seq-3)',
      }))} />
    </Card>
  );
}

export function RequisitionsCard({ d }: { d: Profile }) {
  const open = d.requisitions.filter((j) => j.status === 'open');
  const cols: Array<Column<ProfileReq & { _act?: string; _v?: string }>> = [
    { t: 'Requisition', f: (j) => <b>{j.title}</b> },
    { t: 'Department', f: (j) => <span className="t-sub">{j.deptName}{j.city ? ` · ${j.city}` : ''}</span> },
    { t: 'Status', f: (j) => <><JobStatus status={j.status} /><Priority priority={j.priority} /></> },
    { t: 'Pipeline', n: true, f: (j) => fmt.int(j.live) },
    { t: 'Filled', n: true, f: (j) => `${j.filled}/${j.openings}` },
    {
      t: 'Days open', n: true,
      f: (j) => {
        if (j.status !== 'open') return <span className="mut">closed</span>;
        const n = j.openedOn ? Math.round(daysBetween(j.openedOn, new Date().toISOString())) : 0;
        return <span className={n > 90 ? 'warn-t' : ''}>{fmt.int(n)}</span>;
      },
    },
  ];
  return (
    <Card flush title={d.hiring ? 'The requisitions they own' : 'The requisitions they support'}
      actions={
        <span className="t-foot">
          {fmt.int(open.length)} open of {fmt.int(d.requisitions.length)} ·{' '}
          {fmt.int(open.reduce((n, j) => n + Math.max(0, j.openings - j.filled), 0))} openings left
        </span>
      }>
      <Table cols={cols} rows={d.requisitions.map((j) => ({ ...j, _act: 'go', _v: `/jobs/${j.id}` }))}
        emptyIcon="brief" emptyTitle="No requisitions on their name"
        emptySub="Assign one from the requisition record." />
    </Card>
  );
}

export function QualityCard({ d, win }: { d: Profile; win: W.Window }) {
  const q = d.quality;
  if (!q.hired) return null;
  const first = d.person.name.split(' ')[0];
  return (
    <Card title="Quality of hire" icon="shield"
      actions={q.rate == null
        ? <Chip>Nothing decided yet</Chip>
        : <Chip tone={q.rate >= 0.9 ? 'ok' : q.rate >= 0.75 ? 'warn' : 'bad'}>{fmt.pct(q.rate)}</Chip>}
      sub={`A hire counts once the person has been here three months and has not been let go. ${first} made ${fmt.int(q.hired)} hire${q.hired === 1 ? '' : 's'} in ${W.phrase(win)}${q.inside ? `, ${fmt.int(q.inside)} still inside their three months` : ''}.`}
      foot={
        <span className="t-foot">
          The hires still inside their three months are left out of the rate — counting them
          would flatter it.
        </span>
      }>
      <Kvs pairs={[
        ['Hires', fmt.int(q.hired)],
        ['Three months behind them', fmt.int(q.decided)],
        ['Passed', <b key="p">{fmt.int(q.passed)}</b>],
        ['Left inside three months', q.failed
          ? <span key="f" className="bad-t">{fmt.int(q.failed)}</span> : '—'],
      ]} />
      {!!q.reasons.length && (
        <>
          <div className="t-over" style={{ margin: '10px 0 6px' }}>Why</div>
          <ul className="bullets warn">
            {q.reasons.map((x) => (
              <li key={x.reason}>{x.reason}{x.n > 1 ? ` · ${x.n}` : ''}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function ClaimsCard({ d, canRelease, now }: {
  d: Profile; canRelease: boolean; now: Date;
}) {
  const first = d.person.name.split(' ')[0];
  const cols: Array<Column<ProfileClaim & { _act?: string; _v?: string }>> = [
    {
      t: 'Candidate',
      f: (c) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: c.name, photo: c.photo, hue: c.hue }} size="s" />
          <b>{c.name}</b>
        </div>
      ),
    },
    {
      t: 'Where they are',
      f: (c) => (
        <span className="t-sub trunc" style={{ maxWidth: 190, display: 'inline-block', verticalAlign: 'middle' }}
          title={c.where}>{c.where}</span>
      ),
    },
    {
      t: 'Stage',
      f: (c) => (c.stageName && c.stage
        ? <StagePill name={c.stageName} ordinal={STAGE_INDEX[c.stage as StageKey] ?? 0} />
        : null),
    },
    { t: 'Tagged', f: (c) => <span className="t-sub">{ago(c.at, now)}</span> },
    { t: 'Left', n: true, f: (c) => <span className={c.daysLeft <= 3 ? 'warn-t' : ''}>{c.daysLeft} d</span> },
    {
      t: 'Note for the desk',
      f: (c) => {
        const n = c.note ?? '';
        const shown = n ? (n.length > 30 ? `${n.slice(0, 28).trim()}…` : n) : '—';
        return (
          <span className="t-foot mut trunc" style={{ maxWidth: 150, display: 'inline-block', verticalAlign: 'middle' }}
            title={n}>{shown}</span>
        );
      },
    },
    ...(canRelease ? [{
      t: '',
      f: (c: ProfileClaim) => <Btn size="xs" variant="ghost" action="cand.release" v={c.candidateId}>Release</Btn>,
    }] : []),
  ];
  return (
    <Card flush title="Candidates tagged to them" icon="pin"
      actions={
        <span className="t-foot">
          {fmt.int(d.claims.length)} held{d.claimsLapsed ? ` · ${fmt.int(d.claimsLapsed)} lapsed` : ''}
        </span>
      }
      foot={
        <span className="t-foot">
          A tag warns the rest of the desk before they email, call, screen or book the candidate —
          and lapses on its own so nobody sits on a name.
          {d.claims.length > 20 ? ` Showing the 20 closest to lapsing of ${fmt.int(d.claims.length)}.` : ''}
        </span>
      }>
      <Table cols={cols}
        rows={d.claims.slice(0, 20).map((c) => ({ ...c, _act: 'drawer.cand', _v: c.candidateId }))}
        emptyIcon="pin" emptyTitle="Nothing tagged"
        emptySub={`${first} has not put their name on anybody, so every candidate they touch is open to the rest of the desk.`} />
    </Card>
  );
}

export function ChaseCard({ d }: { d: Profile }) {
  const cols: Array<Column<ProfileChase & { _act?: string; _v?: string }>> = [
    {
      t: 'Candidate',
      f: (a) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: a.name, photo: a.photo, hue: a.hue }} size="s" />
          <b>{a.name}</b>
        </div>
      ),
    },
    { t: 'Requisition', f: (a) => <span className="t-sub">{a.jobTitle}</span> },
    { t: 'Stage', f: (a) => <StagePill name={a.stageName} ordinal={STAGE_INDEX[a.stage as StageKey] ?? 0} /> },
    { t: 'In stage', n: true, f: (a) => fmt.days(a.inStage) },
    { t: 'Over by', n: true, f: (a) => <span className="bad-t">{fmt.days(a.overBy)}</span> },
  ];
  return (
    <Card flush title="What needs chasing"
      actions={d.liveOwned
        ? (
          <span className="t-foot">
            {fmt.int(d.chase.length)} of {fmt.int(d.liveOwned)} live applications are past their stage SLA
          </span>
        )
        : null}
      foot={d.chase.length > 20
        ? <span className="t-foot">Showing the 20 furthest past SLA of {fmt.int(d.chase.length)}.</span>
        : null}>
      <Table cols={cols}
        rows={d.chase.slice(0, 20).map((a) => ({ ...a, _act: 'drawer.open', _v: a.applicationId }))}
        emptyIcon="check" emptyTitle={d.liveOwned ? 'Nothing past SLA' : 'No live applications'}
        emptySub={d.liveOwned
          ? 'Every live application they own or sourced is inside its stage SLA.'
          : 'This role neither owns nor sources applications, so there is nothing to chase here.'} />
    </Card>
  );
}

export function NoTargetBanner({ d }: { d: Profile }) {
  const first = d.person.name.split(' ')[0];
  return (
    <Banner tone="info" icon="spark" title={`${first} carries no hiring target`}
      body={d.person.role === 'onboarding'
        ? 'An onboarding specialist does not own applications, so the performance band below reads close to zero. Their contribution is the offer letters verified and corrected above.'
        : `A ${roleDef(d.person).t.toLowerCase()} does not own applications, so the performance band below reads close to zero. Their contribution is the sourcing and scheduling figures above.`} />
  );
}
