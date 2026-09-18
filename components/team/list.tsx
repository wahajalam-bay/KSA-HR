import * as React from 'react';
import { Card, Kpi, Chip, Empty, Seg, Avatar, Btn } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { Pie, Legend, Rings, HBars } from '@/components/charts';
import { RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import { TEAM_ROLES, roleDef, carriesTarget } from '@/lib/domain/team';
import type { TeamList, Person, Stat } from '@/lib/queries/team';
import * as W from '@/lib/domain/window';

/* ─────────────────────────────────────────────────────────────────────────────
   The desk at a glance.

   Four numbers, the shape of the team, attainment as a row of rings, and then
   a card for every person. Sourcers and coordinators carry no hiring target,
   so their card shows what they actually do — applications sourced, interviews
   set, letters checked — rather than a row of zeroes against a target they
   were never given.
   ───────────────────────────────────────────────────────────────────────────*/

export function TeamFilters({ win, role, counts }: {
  win: string; role: string; counts: Map<string, number>;
}) {
  return (
    <div className="filters">
      <Seg action="team.win" active={win}
        options={Object.keys(W.PRESETS).map((k) => ({ v: k, t: W.PRESETS[Number(k)] }))} />
      <select className="inp" data-act="team.role" defaultValue={role}>
        <option value="">Every role</option>
        {TEAM_ROLES.map((x) => (
          <option key={x.v} value={x.v}>{x.t} ({counts.get(x.v) ?? 0})</option>
        ))}
      </select>
    </div>
  );
}

function PersonCard({ person, stat, support }: {
  person: Person;
  stat: Stat | undefined;
  support: { sourced: number; interviews: number; verified: number; corrections: number; openTasks: number } | undefined;
}) {
  const role = roleDef(person);
  const hiring = carriesTarget(person);
  const sup = support ?? { sourced: 0, interviews: 0, verified: 0, corrections: 0, openTasks: 0 };

  const figs: Array<[string, string]> = hiring
    ? [
      [fmt.int(stat?.hires ?? 0), 'hires'],
      [fmt.int(stat?.livePipeline ?? 0), 'in pipeline'],
      [stat?.attainment == null ? '—' : fmt.pct(stat.attainment), 'of target'],
    ]
    : person.role === 'onboarding'
      ? [
        [fmt.int(sup.verified), 'letters verified'],
        [fmt.int(sup.corrections), 'corrections'],
        [fmt.int(sup.openTasks), 'open tasks'],
      ]
      : [
        [fmt.int(sup.sourced), 'sourced'],
        [fmt.int(sup.interviews), person.role === 'coordinator' ? 'interviews set' : 'interviews'],
        [fmt.int(sup.openTasks), 'open tasks'],
      ];

  return (
    <button className="pcard" data-act="go" data-v={`/team/${person.id}`}>
      <div className="hd">
        <Avatar person={person} size="l" />
        <div className="bd"><b>{person.name}</b><span>{person.title}</span></div>
      </div>
      <div className="row tight">
        <Chip tone={role.tone}>{role.t}</Chip>
        {person.locationCity && <Chip>{person.locationCity}</Chip>}
        {person.status !== 'active' && <Chip tone="bad">Inactive</Chip>}
        {!person.name.trim().includes(' ') && <Chip tone="warn">Surname and e-mail to complete</Chip>}
      </div>
      <div className="st">
        {figs.map(([v, l]) => <div key={l}><b className="num">{v}</b><span>{l}</span></div>)}
      </div>
      <div className="row tight t-foot">
        {!hiring ? <span className="mut">No hiring target</span>
          : stat?.slaBreaches
            ? <span className="bad-t"><Icon name="alert" size={12} /> {stat.slaBreaches} past SLA</span>
            : <span className="good"><Icon name="check" size={12} /> nothing past SLA</span>}
        <span className="push" />
        <span>{fmt.int(person.deptIds.length)} {person.deptIds.length === 1 ? 'department' : 'departments'}</span>
      </div>
    </button>
  );
}

export function TeamBoard({ d, role, win }: { d: TeamList; role: string; win: W.Window }) {
  const team = d.people;
  const hiringPeople = team.filter(carriesTarget);
  const shown = team.filter((p) => !role || p.role === role);
  const period = W.label(win).toLowerCase();

  const segs = TEAM_ROLES
    .map((x) => ({ label: x.t, value: d.roleCounts.get(x.v) ?? 0 }))
    .filter((x) => x.value)
    .sort((a, b) => b.value - a.value);

  const ranked = [...hiringPeople]
    .sort((a, b) => (d.stats.get(b.id)?.hires ?? 0) - (d.stats.get(a.id)?.hires ?? 0));
  const withTarget = ranked.filter((p) => (d.stats.get(p.id)?.target ?? 0) > 0);

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 16 }}>
        <Kpi label="Team hires" value={fmt.int(d.hires)} accent
          sub={`of ${fmt.int(d.target)} target · ${d.target ? fmt.pct(d.hires / d.target) : '—'} attainment`}
          def={`Applications owned by a team member that reached Joined with a close date in the ${period}. Target is each person's monthly figure over the same span.`} />
        <Kpi label="Median time to hire" value={fmt.dec(d.timeToHire.median, 0)} unit="days"
          sub={d.timeToHire.n ? `across ${fmt.int(d.timeToHire.n)} hires` : 'no hires in the period'}
          def="Median days from the application arriving to the hire being closed, across every hire in the period." />
        <Kpi label="Live pipeline carried" value={fmt.int(d.livePipeline)}
          sub={`${fmt.dec(d.livePipeline / Math.max(1, hiringPeople.length), 0)} per hiring recruiter`}
          def="Applications still active or on hold that a team member owns right now." />
        <Kpi label="Requisitions covered" value={fmt.int(d.openReqs)}
          sub={`${fmt.int(d.openings)} openings still to fill`}
          def="Open requisitions whose owning recruiter is a member of this team." />
      </div>

      <div className="grid g-2" style={{ marginBottom: 14 }}>
        <Card title="Team composition" sub="Who does what — every role on the desk, with its headcount.">
          <div className="pie-row">
            <Pie segments={segs} size={210} />
            <Legend items={segs.map((x, i) => ({
              color: RAMP[i % RAMP.length], label: x.label, value: fmt.int(x.value),
            }))} />
          </div>
        </Card>

        <Card title="Attainment against target"
          sub={<>Hires in the period as a share of each person&rsquo;s pro-rated target. Click a ring.</>}>
          {withTarget.length ? (
            <Rings items={withTarget.map((p) => {
              const st = d.stats.get(p.id)!;
              const parts = p.name.split(' ');
              return {
                name: `${parts[0]} ${(parts[1] ?? '').slice(0, 1)}.`,
                value: Math.min(1.5, st.attainment ?? 0),
                label: fmt.pct(st.attainment ?? 0),
                sub: `${fmt.int(st.hires)} of ${fmt.int(st.target)}`,
                title: p.name,
                act: 'go', v: `/team/${p.id}`,
              };
            })} />
          ) : <Empty icon="trophy" title="Nobody carries a hiring target yet" />}
        </Card>
      </div>

      <Card title="Hires in the period, by recruiter"
        sub={<>The tick on each bar is the person&rsquo;s pro-rated target. Sourcers and coordinators
          carry none — their contribution shows as sourced applications and interviews scheduled,
          on their own profile.</>}>
        {ranked.length ? (
          <HBars data={ranked.map((p) => {
            const s = d.stats.get(p.id)!;
            const att = s.attainment ?? 0;
            return {
              label: p.name, value: s.hires,
              marker: s.target || null,
              markerLabel: s.target ? `target ${fmt.int(s.target)}` : '',
              note: s.target ? fmt.pct(att) : 'no target',
              color: !s.target ? 'var(--seq-2)'
                : att >= 0.95 ? 'var(--brand-500)'
                  : att >= 0.6 ? 'var(--seq-3)' : 'var(--warn)',
            };
          })} />
        ) : <Empty icon="trophy" title="Nobody carries a hiring target yet" />}
      </Card>

      <div className="row" style={{ margin: '16px 0 9px' }}>
        <span className="t-sub">
          {fmt.int(shown.length)} {shown.length === 1 ? 'person' : 'people'}
          {role ? ` · ${roleDef({ role }).t} only` : ' · every role'}
        </span>
      </div>
      {shown.length ? (
        <div className="grid g-3">
          {shown.map((p) => (
            <PersonCard key={p.id} person={p} stat={d.stats.get(p.id)} support={d.support.get(p.id)} />
          ))}
        </div>
      ) : (
        <Empty icon="users" title="Nobody in that role" sub="Clear the filter or add someone."
          action={<Btn variant="pri" action="staff.new">Add recruiter</Btn>} />
      )}
    </>
  );
}
