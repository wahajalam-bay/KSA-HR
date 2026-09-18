import { chrome, q } from '@/lib/queries/chrome';
import { agenda, taskBoard, interviewerPanel, load, pendingReviewCount, dayKey } from '@/lib/queries/scheduling';
import { TopBar } from '@/components/app/shell';
import { Subnav, Btn } from '@/components/ui/primitives';
import { AgendaTab } from '@/components/scheduling/agenda';
import { TasksTab } from '@/components/scheduling/tasks';
import { InterviewersTab } from '@/components/scheduling/interviewers';
import { LoadTab } from '@/components/scheduling/load';
import * as W from '@/lib/domain/window';
import { can } from '@/lib/authz';
import { DrillChips, interviewChips } from '@/components/charts/chips';

export const dynamic = 'force-dynamic';

export default async function SchedulingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  const tab = sp.tab ?? 'agenda';
  const today = dayKey(now);

  /* The subnav counts come from the same reads the tabs use, so a tab that says
     three and then shows nothing cannot happen. */
  const iw = W.preset(Number(sp.iw) || 90);
  const [ag, tasks, pendingReviews] = await Promise.all([
    agenda(viewer, {
      range: sp.range, owner: sp.owner, mode: sp.mode,
      after: sp.after, fromAt: sp.fromAt, toAt: sp.toAt, panel: sp.panel,
    }, now),
    taskBoard(viewer, sp.who && tab === 'tasks' ? sp.who : undefined),
    pendingReviewCount(viewer, now),
  ]);

  const reviews = tab === 'interviewers' ? await interviewerPanel(viewer, iw, now) : null;
  const loadData = tab === 'load' ? await load(viewer, now) : null;

  const openTasks = tasks.all.filter((t) => !t.done).length;
  const lateTasks = tasks.all.filter((t) => !t.done && t.dueOn && t.dueOn < today).length;

  return (
    <>
      <TopBar
        title="Scheduling"
        sub={
          <>
            {ag.counts.up} interview{ag.counts.up === 1 ? '' : 's'} on today&rsquo;s agenda and beyond,{' '}
            {ag.stillToCome} still to come · {openTasks} open tasks, {lateTasks} of them overdue · the working
            week runs Sunday to Thursday
          </>
        }
        actions={can(viewer, 'interview.schedule')
          ? <Btn variant="out" className="only-wide" action="ivw.new" icon="plus">Schedule interview</Btn>
          : undefined}
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <Subnav action="sch.tab" active={tab} tabs={[
          { v: 'agenda', t: 'Agenda', n: ag.counts.up },
          { v: 'tasks', t: 'Tasks', n: openTasks },
          { v: 'interviewers', t: 'Interviewers', n: pendingReviews },
          { v: 'load', t: 'Load' },
        ]} />

        {/* A span given in instants has no control on the page showing it, so
            without this the agenda would hold a window nobody can see. */}
        <DrillChips sp={sp} path="/scheduling" chips={interviewChips(sp)} />

        {tab === 'tasks' ? (
          <TasksTab kept={tasks.kept} owners={tasks.owners} who={sp.who ?? ''} today={today} now={now} />
        ) : tab === 'load' && loadData ? (
          <LoadTab data={loadData} now={now} />
        ) : tab === 'interviewers' && reviews ? (
          <InterviewersTab data={reviews} w={iw} sel={sp.who ?? ''} now={now} />
        ) : (
          <AgendaTab data={ag} now={now} />
        )}
      </main>
    </>
  );
}
