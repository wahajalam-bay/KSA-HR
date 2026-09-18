import { chrome, q } from '@/lib/queries/chrome';
import { listJobs, searchApplicants } from '@/lib/queries/jobs';
import { departments, staff } from '@/db/schema';
import { db } from '@/db/client';
import { asc, sql } from 'drizzle-orm';
import { TopBar } from '@/components/app/shell';
import {
  Subnav, Card, Table, Empty, Btn, Chip, Avatar, StagePill, StatusChip, JobStatus, Priority,
  Push, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { Stack, type Picks } from '@/components/charts';
import { applicationsUrl } from '@/lib/charts/drill';
import { fmt, daysAgo, ago, dateWindowLabel } from '@/lib/format';
import { routeMeta } from '@/lib/domain/sourcing';
import { can } from '@/lib/authz';
import { ApplicationSearchBar } from '@/components/jobs/search-bar';
import { ApprovalQueue } from '@/components/approvals/queue';
import { requisitionQueue } from '@/lib/queries/approvals';
import { SourceMark } from '@/components/jobs/source-mark';
import { DrillChips, jobChips } from '@/components/charts/chips';

export const dynamic = 'force-dynamic';

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();

  const status = sp.status ?? 'open';
  const filters = {
    status, deptId: sp.dept, recruiterId: sp.owner, q: sp.q,
    from: sp.from, to: sp.to, sort: sp.sort,
  };

  const [{ rows, counts: statusCounts, openOpenings, totalInScope, totalAll }, depts, recruiters] = await Promise.all([
    listJobs(viewer, filters, now),
    db().select().from(departments).where(sql`archived_at IS NULL`).orderBy(asc(departments.name)),
    db().select().from(staff).where(sql`role IN ('recruiter','tal_lead') AND status <> 'deleted'`).orderBy(asc(staff.name)),
  ]);

  const searching = !!(sp.q || sp.from || sp.to);
  const hits = searching ? await searchApplicants(viewer, filters) : null;

  const queue = status === 'pending_approval' ? await requisitionQueue(viewer) : [];
  const scoped = viewer.scope.kind !== 'all';

  return (
    <>
      <TopBar
        title="Jobs"
        sub={
          <>
            {statusCounts.open ?? 0} open · {openOpenings} openings · {fmt.int(counts.livePipeline)} people in play
            {scoped && <> · {totalInScope} of {totalAll} requisitions inside your access</>}
          </>
        }
        actions={can(viewer, 'job.create')
          ? <Btn variant="out" className="only-wide" action="job.new" icon="plus">New requisition</Btn>
          : undefined}
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <Subnav action="job.status" active={status} tabs={[
          { v: 'open', t: 'Open', n: statusCounts.open ?? 0 },
          { v: 'pending_approval', t: 'Awaiting approval', n: statusCounts.pending_approval ?? 0 },
          { v: 'draft', t: 'Draft', n: statusCounts.draft ?? 0 },
          { v: 'on_hold', t: 'On hold', n: statusCounts.on_hold ?? 0 },
          { v: 'closed', t: 'Archive', n: statusCounts.closed ?? 0 },
          { v: 'all', t: 'All', n: totalInScope },
        ]} />

        {status === 'pending_approval' && !!queue.length && (
          <div style={{ marginBottom: 14 }}>
            <ApprovalQueue rows={queue} viewer={viewer} now={now} />
          </div>
        )}

        <DrillChips sp={sp} path="/jobs" chips={jobChips(sp, {
          dept: (id) => depts.find((x) => x.id === id)?.name ?? id,
          owner: (id) => recruiters.find((x) => x.id === id)?.name ?? id,
        })} />

        <div className="filters">
          <ApplicationSearchBar q={sp.q ?? ''} from={sp.from ?? ''} to={sp.to ?? ''} />
          <select className="inp" data-act="job.dept" defaultValue={sp.dept ?? ''} aria-label="Department">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="inp" data-act="job.owner" defaultValue={sp.owner ?? ''} aria-label="Recruiter">
            <option value="">All recruiters</option>
            {recruiters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="inp" data-act="job.sort" defaultValue={sp.sort ?? 'age'} aria-label="Order">
            <option value="age">Newest first</option>
            <option value="pipeline">Biggest pipeline</option>
            <option value="openings">Most openings</option>
            <option value="progress">Least filled</option>
            <option value="title">A–Z</option>
          </select>
        </div>

        {hits && (
          <div style={{ marginBottom: 14 }}>
            <PeopleHits hits={hits} qText={sp.q ?? ''} windowLabel={dateWindowLabel(sp.from, sp.to)} now={now} />
          </div>
        )}

        {rows.length ? (
          <div className="stack sm">
            {rows.map((j) => <JobRow key={j.id} j={j} now={now} />)}
          </div>
        ) : (
          <Empty
            icon="brief"
            title={searching ? 'Nothing matches that search' : 'No requisitions match'}
            sub={searching
              ? <>No requisition and nobody who applied matches{sp.q ? ` “${sp.q}”` : ''}
                {dateWindowLabel(sp.from, sp.to) ? ` in ${dateWindowLabel(sp.from, sp.to)}` : ''}.
                Try a wider search, or clear the dates.</>
              : 'Try a wider filter.'}
            action={searching
              ? <Btn variant="out" action="job.clearq">Clear the search</Btn>
              : can(viewer, 'job.create') ? <Btn variant="pri" action="job.new">New requisition</Btn> : undefined}
          />
        )}
      </main>
    </>
  );
}

function JobRow({ j, now }: { j: Awaited<ReturnType<typeof listJobs>>['rows'][number]; now: Date }) {
  const age = j.openedOn ? daysAgo(j.openedOn, now) : 0;
  return (
    <article className="card" style={{ padding: 0 }}>
      <button className="li" data-act="go" data-v={`/jobs/${j.id}`} style={{ borderBottom: 0 }}>
        <span className="ic brand"><Icon name="brief" size={15} /></span>
        <span className="bd">
          <b>{j.title}</b>
          <span>
            {j.positionCode && <><span className="mono">{j.positionCode}</span> · </>}
            {j.deptName} · {j.city} · HM {j.hiringManager ?? '—'}
            {j.pipelineName && <> · {j.pipelineName}</>}
          </span>
        </span>
        <span className="tr only-wide"><JobStatus status={j.status} /><Priority priority={j.priority} /></span>
        <span className="chev"><Icon name="chev" size={15} /></span>
      </button>
      <div className="card-b" style={{ paddingTop: 0 }}>
        <div className="row" style={{ gap: 18, marginBottom: 9 }}>
          <span className="t-foot"><Icon name="users" size={12} /> <b>{j.live}</b> in pipeline</span>
          <span className="t-foot"><Icon name="target" size={12} /> <b>{j.filled}</b>/{j.openings} filled</span>
          <span className="t-foot"><Icon name="clock" size={12} /> open <b>{Math.round(age)}</b> d</span>
          {j.overSla > 0 && (
            <span className="t-foot bad-t"><Icon name="alert" size={12} /> <b>{j.overSla}</b> past SLA</span>
          )}
          {j.matched != null && j.matched > 0 && (
            <Chip tone="brand" title="Applicants on this requisition that match the search">
              {j.matched} match{j.matched === 1 ? '' : 'es'}
            </Chip>
          )}
          <Push />
          <Avatar person={{ name: j.recruiterName ?? '', photo: j.recruiterPhoto, hue: j.recruiterHue }} size="s" />
        </div>
        {j.distribution.length ? (
          <Stack
            segments={j.distribution.map((d) => ({
              label: d.name, value: d.n, color: `var(--stg-${d.band})`,
            }))}
            /* A segment of the rail is the live applications standing in that
               stage on this requisition. It sits inside a card that is itself a
               link, and the dispatcher takes the innermost action, so picking a
               segment opens the segment rather than the requisition. */
            picks={j.distribution.map((d) => ({
              act: 'go',
              v: applicationsUrl({ tab: 'pipeline', jobId: j.id, stages: [d.key] }),
              tip: {
                label: d.name,
                value: fmt.int(d.n),
                rows: [['On this requisition', j.title]],
                action: `Open ${fmt.int(d.n)} live application${d.n === 1 ? '' : 's'}`,
              },
            })) satisfies Picks}
          />
        ) : <div className="t-foot mut">Nobody in the pipeline yet</div>}
      </div>
    </article>
  );
}

type Hit = NonNullable<Awaited<ReturnType<typeof searchApplicants>>>['rows'][number] & { _act?: string; _v?: string };

function PeopleHits({ hits, qText, windowLabel, now }: {
  hits: Awaited<ReturnType<typeof searchApplicants>>; qText: string; windowLabel: string; now: Date;
}) {
  const cols: Array<Column<Hit>> = [
    {
      t: 'Applicant',
      f: (a) => (
        <div className="row tight nowrap">
          <Avatar person={a.candidate} size="s" />
          <span className="ivwho">
            <b>{a.candidate.name}</b>
            <em>{a.candidate.currentTitle}{a.candidate.currentCompany ? ` · ${a.candidate.currentCompany}` : ''}</em>
          </span>
        </div>
      ),
    },
    { t: 'Requisition', cls: 'wrap', f: (a) => <>{a.job.title}<br /><span className="t-foot">{a.job.deptName}</span></> },
    { t: 'Stage', f: (a) => <StagePill name={a.stageName} ordinal={a.stageOrdinal} /> },
    { t: 'Status', f: (a) => <StatusChip status={a.status} /> },
    { t: 'Applied', n: true, f: (a) => <>{fmt.date(a.appliedAt)}<br /><span className="t-foot">{ago(a.appliedAt, now)}</span></> },
    {
      t: 'How they came', cls: 'wrap',
      f: (a) => <span className="row tight nowrap"><SourceMark route={a.route} source={a.source} /><span className="t-sub">{a.source}</span></span>,
    },
  ];
  return (
    <Card
      icon="users" flush
      title={`${hits.total} ${hits.total === 1 ? 'applicant matches' : 'applicants match'}${qText ? ` “${qText}”` : ''}${windowLabel ? ` · ${windowLabel}` : ''}`}
      actions={<Btn size="xs" variant="ghost" action="job.clearq" icon="x" iconSize={11}>Clear the search</Btn>}
      foot={
        <span className="t-foot">
          Click a row to open the person.{' '}
          {hits.total > hits.rows.length && `Showing the ${hits.rows.length} most recent of ${fmt.int(hits.total)}. `}
          People are searched across every requisition whatever its status; the list below is narrowed to
          the requisitions they applied to, inside the tab you are on.
        </span>
      }
    >
      <Table cols={cols} emptyIcon="search" emptyTitle="Nobody matches"
        rows={hits.rows.map((a) => ({ ...a, _act: 'drawer.open', _v: a.id }))} />
    </Card>
  );
}
