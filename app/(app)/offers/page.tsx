import { chrome, q } from '@/lib/queries/chrome';
import { offerBoard, OFFER_TABS, OFFER_STATE, type OfferRow } from '@/lib/queries/offers';
import { db } from '@/db/client';
import { staff } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { TopBar } from '@/components/app/shell';
import {
  Subnav, Card, Kpi, Chip, Empty, Avatar, Table, Li, Btn, Banner, Push, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { QuestionRange } from '@/components/offers/board';
import { fmt, ago } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Row = OfferRow & { _act?: string; _v?: string; _cls?: string };

export default async function OffersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();

  const tab = OFFER_TABS.some((t) => t.v === sp.tab) ? sp.tab : 'live';
  const search = (sp.q ?? '').toLowerCase();
  const dept = sp.dept ?? '';
  const jobId = sp.job ?? '';
  const qf = sp.qf ?? '';
  const qt = sp.qt ?? '';

  const [all, onboarder] = await Promise.all([
    offerBoard(viewer, now),
    db().select({ name: staff.name }).from(staff)
      .where(sql`${staff.role} = 'onboarding' AND ${staff.status} <> 'deleted'`).limit(1),
  ]);

  const inTab = (x: OfferRow, v: string) =>
    (v === 'all' ? true : v === 'live' ? x.bucket !== 'answered' : x.bucket === v);
  const askedIn = (x: OfferRow) =>
    (!qf && !qt ? true : x.askedDays.some((d) => (!qf || d >= qf) && (!qt || d <= qt)));

  const list = all.filter((x) => inTab(x, tab)
    && (!dept || x.job.deptId === dept)
    && (!jobId || x.job.id === jobId)
    && askedIn(x)
    && (!search || `${x.candidate.name} ${x.job.title} ${x.job.deptName}`.toLowerCase().includes(search)));

  const tabCounts = Object.fromEntries(OFFER_TABS.map((t) => [t.v, all.filter((x) => inTab(x, t.v)).length]));
  const openQ = all.filter((x) => x.questions.open);
  const acc = all.filter((x) => x.state === 'accepted').length;
  const dec = all.filter((x) => x.state === 'declined').length;

  const depts = [...new Map(all.map((x) => [x.job.deptId, { id: x.job.deptId, name: x.job.deptName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const jobsInDept = [...new Map(all.filter((x) => !dept || x.job.deptId === dept)
    .map((x) => [x.job.id, { id: x.job.id, title: x.job.title }])).values()]
    .sort((a, b) => a.title.localeCompare(b.title));

  const cols: Array<Column<Row>> = [
    {
      t: 'Candidate', cls: 'wrap',
      f: (x) => (
        <div className="row tight nowrap">
          <Avatar person={x.candidate} size="s" />
          <span>
            <b>{x.candidate.name}</b><br />
            <span className="t-foot">{x.candidate.currentTitle}{x.candidate.sector ? ` · ${x.candidate.sector}` : ''}</span>
          </span>
        </div>
      ),
    },
    {
      t: 'Requisition', cls: 'wrap',
      f: (x) => <>{x.job.title}<br /><span className="t-foot">{x.job.deptName} · {fmt.first(x.job.recruiterName ?? '')}</span></>,
    },
    {
      t: 'Package', n: true,
      f: (x) => (
        <>
          <b>{fmt.sar(x.baseMonthly)}</b><br />
          <span className="t-foot">
            {fmt.sarK(x.total)} total
            {x.candidate.currentSalary ? ` · +${fmt.pct((x.baseMonthly - x.candidate.currentSalary) / x.candidate.currentSalary)}` : ''}
          </span>
        </>
      ),
    },
    { t: 'Start', f: (x) => <>{fmt.date(x.startDate)}<br /><span className="t-foot">{ago(x.startDate, now)}</span></> },
    {
      t: 'Stage of the offer',
      f: (x) => {
        const [label, tone] = OFFER_STATE[x.state] ?? [x.state, ''];
        return (
          <>
            <Chip tone={(tone || undefined) as any}>{label}</Chip>
            {x.sentAt && <><br /><span className="t-foot">sent {ago(x.sentAt, now)}</span></>}
          </>
        );
      },
    },
    {
      t: 'Questions',
      f: (x) => (x.questions.n ? (
        <>
          {x.questions.open ? <Chip tone="warn">Waiting on us</Chip> : <Chip tone="ok">Answered</Chip>}
          <br />
          <span className="t-foot">
            {x.questions.asked} asked
            {x.askedDays.length ? ` · ${fmt.dateShort(x.askedDays[x.askedDays.length - 1] + 'T00:00:00Z')}` : ''}
          </span>
        </>
      ) : <span className="mut">none</span>),
    },
    {
      t: 'Answer', cls: 'wrap',
      f: (x) => (x.response ? (
        <>
          <Chip tone={x.response.state === 'accepted' ? 'ok' : 'bad'}>
            {x.response.state === 'accepted' ? 'Accepted' : 'Declined'}
          </Chip>
          {x.response.reason && <><br /><span className="t-foot">{x.response.reason}</span></>}
        </>
      ) : x.state === 'expired' ? <Chip>Lapsed</Chip> : <span className="mut">waiting</span>),
    },
    {
      t: 'Waiting on', cls: 'wrap',
      f: (x) => (x.todo
        ? <span className={x.todo.tone === 'warn' ? 'warnt' : ''}>{x.todo.t}</span>
        : <span className="mut">—</span>),
    },
  ];

  const tabLabel = OFFER_TABS.find((t) => t.v === tab)!.t
    + (dept ? ` — ${depts.find((d) => d.id === dept)?.name ?? ''}` : '')
    + (jobId ? ` — ${jobsInDept.find((j) => j.id === jobId)?.title ?? ''}` : '');

  const windowNote = qf && qt
    ? `${fmt.date(qf + 'T00:00:00Z')} – ${fmt.date(qt + 'T00:00:00Z')}`
    : qf ? `from ${fmt.date(qf + 'T00:00:00Z')}` : qt ? `up to ${fmt.date(qt + 'T00:00:00Z')}` : '';

  return (
    <>
      <TopBar
        title="Offer stage"
        sub={
          <>
            {tabCounts.approval} in approval · {tabCounts.out} with the candidate ·{' '}
            {openQ.length} question{openQ.length === 1 ? '' : 's'} waiting on an answer · every offer in
            flight, and how each one was answered
          </>
        }
        actions={<Btn variant="out" className="only-wide" action="go" v="/insights?tab=offers" icon="chart">Offer analysis</Btn>}
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <Subnav action="off.tab" active={tab} tabs={OFFER_TABS.map((t) => ({ ...t, n: tabCounts[t.v] }))} />

        {viewer.isPortal && (
          <div style={{ marginBottom: 12 }}>
            <Banner icon="file" title="Offers on your requisitions"
              body={'Where each offer stands. The TA team drafts, approves and sends them; the onboarding '
                + "specialist answers the candidate's questions."} />
          </div>
        )}

        <div className="grid g-kpi" style={{ marginBottom: 14 }}>
          <Kpi label="With the candidate" value={fmt.int(tabCounts.out)} accent sub="sent, opened or signed"
            def="Offers that have left the building and are with the candidate for signature." />
          <Kpi label="In approval" value={fmt.int(tabCounts.approval)}
            sub="draft, in the chain, or approved and ready to send"
            def={'Offers still inside Bayut: being drafted, walking the approval chain, or approved and '
              + 'waiting for the letter to be verified.'} />
          <Kpi label="Questions waiting" value={fmt.int(openQ.length)} inverse
            sub={openQ.length
              ? `oldest ${ago([...openQ].sort((a, b) => String(a.questions.lastAt).localeCompare(String(b.questions.lastAt)))[0].questions.lastAt!, now)}`
              : 'nothing outstanding'}
            def="Offers where the last message is the candidate's — somebody owes them an answer." />
          <Kpi label="Answered" value={`${fmt.int(acc)} / ${fmt.int(acc + dec)}`}
            sub={acc + dec ? `${fmt.pct(acc / (acc + dec))} accepted in the last four months` : 'no answers yet'}
            def={'Accepted against accepted plus declined, for the offers answered in the last 120 days. '
              + 'Every decline carries a reason.'}
            action={{ act: 'go', v: '/insights?tab=offers' }} />
        </div>

        {!!openQ.length && (
          <Card title={`Questions waiting on an answer (${openQ.length})`} icon="msg" flush
            sub={`The candidate asked and nobody has replied yet. ${onboarder[0]?.name ?? 'The onboarding specialist'} answers these.`}>
            <div className="list flush">
              {[...openQ]
                .sort((a, b) => String(a.questions.lastAt).localeCompare(String(b.questions.lastAt)))
                .slice(0, 6)
                .map((x) => (
                  <Li key={x.offerId} avatar={x.candidate}
                    title={<>{x.candidate.name} <span className="mut" style={{ fontWeight: 500 }}>· {x.job.title}</span></>}
                    sub={
                      <>
                        <span className="quote">“{x.questions.lastBody}”</span><br />
                        <span className="t-foot">asked {ago(x.questions.lastAt!, now)}</span>
                      </>
                    }
                    right={<Btn size="xs" variant="pri" action="offer.open" v={x.applicationId} icon="msg" iconSize={12}>Answer</Btn>} />
                ))}
            </div>
          </Card>
        )}

        <div className="filters">
          <input className="inp grow" data-act="off.q" data-live defaultValue={sp.q ?? ''}
            placeholder="Candidate name, requisition or department…" aria-label="Search offers" />
          <label className="fgrp">
            <span>Department</span>
            <select className="inp" data-act="off.dept" defaultValue={dept}>
              <option value="">All</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="fgrp">
            <span>Offered position</span>
            <select className="inp" data-act="off.job" defaultValue={jobId}>
              <option value="">All</option>
              {jobsInDept.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </label>
        </div>

        <div className="filters">
          <QuestionRange from={qf} to={qt} />
          {(qf || qt || jobId || dept || search) && (
            <Btn size="sm" variant="ghost" action="off.clear" icon="x" iconSize={12}>Clear every filter</Btn>
          )}
          <Push />
          <span className="t-foot">
            <Icon name="shield" size={12} />{' '}
            {qf || qt
              ? 'Only offers the candidate asked something on between those dates.'
              : 'Click a row to open the offer. Declines always carry a reason — it is what the analysis counts.'}
          </span>
        </div>

        <Card flush icon="file" className="onbt" title={tabLabel}
          actions={
            <span className="t-foot">
              {list.length} offer{list.length === 1 ? '' : 's'}
              {windowNote ? ` · asked ${windowNote}` : ''}
            </span>
          }>
          {list.length ? (
            <Table cols={cols}
              rows={list.map((x) => ({ ...x, _act: 'off.open', _v: x.applicationId, _cls: x.questions.open ? 'sel' : '' }))} />
          ) : (
            <Empty icon="file"
              title={tab === 'answered' ? 'No offers answered in the last four months' : 'No offers here'}
              sub="Every candidate at the offer stage appears here the moment a letter is drafted." />
          )}
        </Card>
      </main>
    </>
  );
}
