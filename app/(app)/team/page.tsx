import { chrome, q } from '@/lib/queries/chrome';
import { teamList } from '@/lib/queries/team';
import { TopBar } from '@/components/app/shell';
import { Btn } from '@/components/ui/primitives';
import { TeamFilters, TeamBoard } from '@/components/team/list';
import { NoAccess } from '@/components/app/no-access';
import { can } from '@/lib/authz';
import { carriesTarget } from '@/lib/domain/team';
import { fmt } from '@/lib/format';
import * as W from '@/lib/domain/window';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  /* The prototype opens the desk on six months rather than the reports'
     quarter — a recruiter's target only reads sensibly over a longer span. */
  const w = W.windowFromQuery({ win: sp.win }, 180);
  const role = sp.role ?? '';

  /* Checked before the read, not around the link: the desk's performance record
     is not something a hiring manager's account may open. */
  if (!can(viewer, 'team.view')) {
    return (
      <NoAccess title="Team" what="The TA team's staff records and performance"
        viewer={viewer} counts={counts} theme={theme} />
    );
  }

  const d = await teamList(viewer, w, now);
  const targeted = d.people.filter(carriesTarget);
  const target = targeted.reduce((n, p) => n + p.monthlyTarget, 0);

  return (
    <>
      <TopBar
        title="Team"
        sub={
          <>
            {fmt.int(d.people.length)} people · {fmt.int(targeted.length)} carry a hiring target of{' '}
            {fmt.int(target)} a month between them · {W.label(w).toLowerCase()}
          </>
        }
        actions={
          <Btn variant="out" className="only-wide" action="staff.new" icon="uplus">Add recruiter</Btn>
        }
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <TeamFilters win={String(w.days)} role={role} counts={d.roleCounts} />
        <TeamBoard d={d} role={role} win={w} />
      </main>
    </>
  );
}
