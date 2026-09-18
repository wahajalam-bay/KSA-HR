import { chrome, q } from '@/lib/queries/chrome';
import { profile } from '@/lib/queries/team';
import { activityFeed } from '@/lib/queries/job-tabs';
import { describe as describeActivity } from '@/components/jobs/activity';
import { TopBar } from '@/components/app/shell';
import { Card, Empty, Btn, Seg, Timeline } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import {
  StaffHeader, ContributionCard, MonthlyCard, KpiBand, PipelinePie, FunnelCard, TatCard,
  RequisitionsCard, QualityCard, ClaimsCard, ChaseCard, NoTargetBanner,
} from '@/components/team/profile';
import { roleDef } from '@/lib/domain/team';
import { NoAccess } from '@/components/app/no-access';
import { can } from '@/lib/authz';
import { fmt, ago } from '@/lib/format';
import * as W from '@/lib/domain/window';

export const dynamic = 'force-dynamic';

export default async function TeamProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  const w = W.windowFromQuery({ win: sp.win }, 180);

  if (!can(viewer, 'team.view')) {
    return (
      <NoAccess title="Team" what="The TA team's staff records and performance"
        viewer={viewer} counts={counts} theme={theme} />
    );
  }

  const d = await profile(viewer, id, w, now);

  /* A profile that is not there, or was deleted: the same page, saying so. The
     name stays on the records they touched either way. */
  if ('missing' in d) {
    const p = d.person;
    return (
      <>
        <TopBar title={p?.name ?? 'Team member'}
          crumb={
            <div className="crumb">
              <button data-act="go" data-v="/team">Team</button>
              <Icon name="chev" size={11} />
              <span>{p ? roleDef(p).t : ''}</span>
            </div>
          }
          unread={counts.unreadNotifications} viewer={viewer} theme={theme} />
        <main className="view" id="view">
          {p ? (
            <Empty icon="trash" title={`${p.name} was deleted`}
              sub={`Removed ${p.deletedAt ? ago(p.deletedAt, now) : ''}${p.handedOverToName ? `; their work went to ${p.handedOverToName}` : ''}. Their name stays on the records they touched.`}
              action={<Btn variant="out" action="go" v="/team">Back to the team</Btn>} />
          ) : (
            <Empty icon="alert" title="No such team member"
              sub="The profile may have been removed."
              action={<Btn variant="out" action="go" v="/team">Back to the team</Btn>} />
          )}
        </main>
      </>
    );
  }

  const p = d.person;
  /* The last 30 days on their own applications, told as sentences — the same
     feed the requisition shows, narrowed to one recruiter. */
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const acts = await activityFeed({ viewer, recruiterId: p.id, from }, 14);
  const admin = can(viewer, 'team.manage');
  const isSelf = viewer.staffId === p.id;

  return (
    <>
      <TopBar
        title={p.name}
        crumb={
          <div className="crumb">
            <button data-act="go" data-v="/team">Team</button>
            <Icon name="chev" size={11} />
            <span>{roleDef(p).t}</span>
          </div>
        }
        sub={
          <>
            {p.title} · {p.locationCity ?? '—'} · joined {p.joinedOn ? fmt.date(p.joinedOn) : '—'} ·{' '}
            {fmt.int(p.lifetimeHires)} lifetime hires
          </>
        }
        actions={
          <Btn variant="out" className="only-wide" action="staff.edit" v={p.id} icon="pencil">
            Edit profile
          </Btn>
        }
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <div className="filters">
          <Seg action="team.win" active={String(w.days)}
            options={Object.keys(W.PRESETS).map((k) => ({ v: k, t: W.PRESETS[Number(k)] }))} />
        </div>

        <div className="grid g-side" style={{ marginBottom: 14 }}>
          <StaffHeader p={p} canEdit={admin} canDelete={admin} isSelf={isSelf} />
          <ContributionCard d={d} win={w} />
        </div>

        <MonthlyCard d={d} />

        {!d.hiring && <NoTargetBanner d={d} />}

        <div className="grid g-kpi" style={{ margin: '14px 0' }}>
          <KpiBand d={d} win={w} />
        </div>

        <div className="grid g-3" style={{ marginBottom: 14 }}>
          <PipelinePie d={d} />
          <FunnelCard d={d} win={w} />
          <TatCard d={d} />
        </div>

        <RequisitionsCard d={d} />

        <div style={{ marginTop: 14 }}><QualityCard d={d} win={w} /></div>
        <div style={{ marginTop: 14 }}>
          <ClaimsCard d={d} canRelease={admin || isSelf} now={now} />
        </div>

        <div className="grid g-side" style={{ marginTop: 14 }}>
          <ChaseCard d={d} />
          <Card title="Recent activity" sub="The last 30 days, attributed to the owning recruiter.">
            {acts.length ? (
              <Timeline items={acts.map((a) => ({
                at: a.at,
                text: describeActivity(a),
                when: ago(a.at, now),
                byName: a.actorName,
                on: a.kind === 'stage' || a.kind === 'hired',
              }))} />
            ) : (
              <Empty icon="clock" title="Nothing in the last 30 days"
                sub="Moves, comments and offers on their applications appear here." />
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
