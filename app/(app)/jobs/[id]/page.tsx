import { notFound } from 'next/navigation';
import { chrome, q } from '@/lib/queries/chrome';
import { getJob, getBoard } from '@/lib/queries/jobs';
import { jobApplicants, jobInsights, activityFeed, jobDetailExtras } from '@/lib/queries/job-tabs';
import { TopBar } from '@/components/app/shell';
import { Subnav, Btn, Chip } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { can } from '@/lib/authz';
import { ForbiddenError } from '@/lib/auth/session';
import { OutOfScope } from '@/components/app/no-access';
import { fmt, daysAgo } from '@/lib/format';
import { BoardTab } from '@/components/jobs/board';
import { DetailsTab } from '@/components/jobs/details';
import { ApplicantsTab } from '@/components/jobs/applicants';
import { ActivityTab } from '@/components/jobs/activity';
import { InsightsTab } from '@/components/jobs/insights';
import { ApprovalBanner, hasApprovalBanner } from '@/components/approvals/banner';
import { getApproval } from '@/lib/queries/approvals';
import { jobPitchInsight } from '@/lib/queries/pitch';
import { jobRanking } from '@/lib/queries/feedback';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();

  /* A requisition outside this account's scope is a refusal, not a failure:
     somebody has followed a link to a requisition they are not on. The page
     says so and keeps their navigation, rather than throwing — which is what
     made every such link a 500 for every hiring manager. */
  let job: Awaited<ReturnType<typeof getJob>>;
  try {
    job = await getJob(viewer, id);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <OutOfScope title="Requisition" message={e.message}
          viewer={viewer} counts={counts} theme={theme}
          back={viewer.isPortal
            ? { href: '/my', label: 'Back to my hiring' }
            : { href: '/jobs', label: 'Back to the requisitions' }} />
      );
    }
    throw e;
  }
  if (!job) notFound();

  const tab = sp.tab ?? 'pipeline';
  const approval = await getApproval('requisition', id);

  return (
    <>
      <TopBar
        title={job.title}
        crumb={
          <div className="crumb">
            <button data-act="go" data-v="/jobs">Jobs</button>
            <Icon name="chev" size={11} />
            <span>{job.pipeline?.name ?? 'No template'}</span>
          </div>
        }
        sub={
          <>
            {job.dept?.name} · {job.loc?.city} · hiring manager {job.hiringManager ?? '—'} ·{' '}
            {job.filled}/{job.openings} filled · open {fmt.days(job.openedOn ? daysAgo(job.openedOn, now) : 0)}
          </>
        }
        actions={
          <>
            {job.budgeted === false && (
              <span className="chip warn only-wide" title="Not in the approved headcount plan — see the justification on Details">
                <Icon name="coin" size={12} /> Not budgeted
              </span>
            )}
            {!viewer.isPortal && can(viewer, 'job.archive') && (
              job.status === 'closed'
                ? <Btn variant="out" className="only-wide" action="job.reopen" v={job.id} icon="refresh">Reopen</Btn>
                : <Btn variant="out" className="only-wide" action="job.archive" v={job.id} icon="inbox">Archive</Btn>
            )}
            {!viewer.isPortal && can(viewer, 'cv.upload') && (
              <label className="btn out only-wide dz-inline" data-dz={`cv.intake:${job.id}`}
                title="Attach a CV to this requisition — read, scored against its JD and placed in Applied">
                <Icon name="upload" size={14} /> Attach CV
                <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.txt" multiple />
              </label>
            )}
            {can(viewer, 'job.edit') && (
              <Btn variant="out" className="only-wide" action="job.edit" v={job.id} icon="pencil">Edit</Btn>
            )}
          </>
        }
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        {approval && hasApprovalBanner(job) && (
          <div style={{ marginBottom: 14 }}>
            <ApprovalBanner approval={approval} job={job} viewer={viewer} now={now} />
          </div>
        )}

        <Subnav action="job.tab" active={tab} tabs={[
          { v: 'pipeline', t: 'Pipeline', n: job.counts.live },
          { v: 'details', t: 'Details' },
          { v: 'people', t: 'All applicants', n: job.counts.total },
          { v: 'activity', t: 'Activity' },
          { v: 'insights', t: 'Insights' },
        ]} />

        {tab === 'pipeline' && <BoardPane viewer={viewer} job={job} route={sp.route ?? null} now={now} />}
        {tab === 'details' && <DetailsPane viewer={viewer} job={job} approval={approval} now={now} />}
        {tab === 'people' && <ApplicantsPane viewer={viewer} job={job} sp={sp} now={now} />}
        {tab === 'activity' && <ActivityPane jobId={job.id} now={now} />}
        {tab === 'insights' && <InsightsPane viewer={viewer} job={job} now={now} />}
      </main>
    </>
  );
}

async function DetailsPane({ viewer, job, approval, now }: { viewer: any; job: any; approval: any; now: Date }) {
  const extras = await jobDetailExtras(viewer, job.id);
  return <DetailsTab job={job} viewer={viewer} approval={approval} extras={extras} now={now} />;
}

async function BoardPane({ viewer, job, route, now }: { viewer: any; job: any; route: string | null; now: Date }) {
  const board = await getBoard(viewer, job.id, route, now);
  return <BoardTab job={job} board={board} route={route} viewer={viewer} />;
}

async function ApplicantsPane({ viewer, job, sp, now }: { viewer: any; job: any; sp: Record<string, string>; now: Date }) {
  const data = await jobApplicants(viewer, job.id, {
    q: sp.q, from: sp.from, to: sp.to, route: sp.route, sort: sp.sort,
  }, now);
  return <ApplicantsTab job={job} data={data} sp={sp} now={now} />;
}

async function ActivityPane({ jobId, now }: { jobId: string; now: Date }) {
  /* Two hundred days back, and no upper bound. A requisition's record carries
     things that are already agreed but dated ahead — a scorecard booked for the
     interview on Thursday, a signature date the candidate has accepted — and
     they belong at the top of the feed rather than out of it. */
  const from = new Date(now.getTime() - 200 * 86_400_000).toISOString().slice(0, 10);
  const items = await activityFeed({ jobId, from }, 60);
  return <ActivityTab items={items} now={now} />;
}

async function InsightsPane({ viewer, job, now }: { viewer: any; job: any; now: Date }) {
  const [data, pitch, ranking] = await Promise.all([
    jobInsights(viewer, job.id, now),
    jobPitchInsight(job),
    jobRanking(viewer, job.id),
  ]);
  return <InsightsTab job={job} data={data} pitch={pitch} ranking={ranking} />;
}
