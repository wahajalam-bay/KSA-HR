import { chrome, q } from '@/lib/queries/chrome';
import { joiners, teams as teamsQuery, ONB_TABS, type Joiner } from '@/lib/queries/onboarding';
import { orgDepartments, onboardingSpecialist } from '@/lib/queries/org';
import { TopBar } from '@/components/app/shell';
import {
  Subnav, Card, Chip, Empty, Avatar, Table, Btn, Banner, Push, type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { JoinerRecord } from '@/components/onboarding/record';
import { ProbationPanel } from '@/components/onboarding/probation';
import { fmt, ago } from '@/lib/format';
import * as W from '@/lib/domain/window';
import { hasStarted, isDecided } from '@/lib/domain/probation';

export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['dept', 'pos', 'sf', 'st', 'af', 'at', 'done', 'q'] as const;
type Row = Joiner & { _act?: string; _v?: string; _cls?: string };

const inRange = (iso: string | null, from: string, to: string) => {
  const d = iso ? String(iso).slice(0, 10) : '';
  if (!d) return !from && !to;
  return (!from || d >= from) && (!to || d <= to);
};

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  const tab = ONB_TABS.some((t) => t.v === sp.tab) ? sp.tab : 'progress';

  const [all, hires, teams, orgDepts, verifier] = await Promise.all([
    joiners(viewer, now),
    joiners(viewer, now, { includeLeft: true }),
    teamsQuery(),
    orgDepartments(),
    onboardingSpecialist(),
  ]);

  const F = {
    dept: sp.dept ?? '', pos: sp.pos ?? '', sf: sp.sf ?? '', st: sp.st ?? '',
    af: sp.af ?? '', at: sp.at ?? '', done: sp.done ?? '', q: (sp.q ?? '').toLowerCase(),
  };
  const active = FILTER_KEYS.filter((k) => F[k]).length;

  const insideProbation = hires.filter((e) => hasStarted(e.startDate, now) && !isDecided(e.probation)).length;
  const tabCounts = Object.fromEntries(ONB_TABS.map((t) => [t.v,
    t.v === 'all' ? all.length
      : t.v === 'probation' ? insideProbation
        : all.filter((e) => e.bucket === t.v).length]));

  let rows = all.filter((e) => (tab === 'all' || e.bucket === tab)
    && (!F.dept || e.deptId === F.dept)
    && (!F.pos || e.title === F.pos)
    && inRange(e.startDate, F.sf, F.st)
    && inRange(e.acceptedAt, F.af, F.at)
    && (!F.done || (F.done === 'yes' ? !!e.completedAt : !e.completedAt))
    && (!F.q || `${e.name} ${e.title} ${e.employeeCode} ${e.deptName} ${e.hiringManagers.join(' ')}`.toLowerCase().includes(F.q)));
  rows = [...rows].sort((a, b) => (tab === 'started'
    ? b.startDate.localeCompare(a.startDate)
    : a.startDate.localeCompare(b.startDate)));

  const open = sp.emp ? all.find((e) => e.id === sp.emp) ?? null : null;
  /* The departments that actually have a joiner, in the organisation's order. */
  const present = new Set(all.map((e) => e.deptId));
  const depts = orgDepts.filter((d) => present.has(d.id));
  const positions = [...new Set(all.map((e) => e.title))].sort();
  const noDate = all.filter((e) => !e.notice).length;
  const fileTeams = teams.filter((t) => t.onFile);

  const cols: Array<Column<Row>> = [
    {
      t: 'Joiner', cls: 'wrap',
      f: (e) => (
        <div className="row tight nowrap">
          <Avatar person={e.photo || e.hue != null
            ? { name: e.name, photo: e.photo, hue: e.hue ?? undefined }
            : e.name} size="s" />
          <span><b>{e.name}</b><br /><span className="mono t-foot">{e.employeeCode}</span></span>
        </div>
      ),
    },
    {
      t: 'Position', cls: 'wrap',
      f: (e) => <>{e.title}<br /><span className="t-foot"><span className="mono">{e.positionCode ?? '—'}</span> · {e.deptName}</span></>,
    },
    {
      t: 'Accepted → start',
      f: (e) => (
        <>
          <span className="t-foot">{e.acceptedAt ? `Accepted ${fmt.date(e.acceptedAt)}` : 'Accepted —'}</span><br />
          <b>{fmt.date(e.startDate)}</b> <span className="t-foot">{ago(e.startDate, now)}</span>
          {!e.notice && <><br /><span className="warnt t-foot">date not confirmed</span></>}
        </>
      ),
    },
    {
      t: 'Hiring manager', cls: 'hm',
      f: (e) => <>{e.hiringManagers[0] ?? '—'}{e.hiringManagers.length > 1 && <> <span className="t-foot">+{e.hiringManagers.length - 1} more</span></>}</>,
    },
    {
      t: 'Checklist',
      f: (e) => {
        const pr = e.progress;
        const done = (pr.form ? 1 : 0) + pr.verified + (pr.refs.ok ? 1 : 0);
        const total = pr.total + 2;
        return e.completedAt ? <Chip tone="ok">Completed</Chip> : (
          <span title={`Form ${pr.form ? 'submitted' : 'waiting'} · ${pr.verified} of ${pr.total} documents verified · references ${pr.refs.ok ? 'done' : pr.refs.n ? `${pr.refs.done} of ${pr.refs.n}` : 'no referee'}`}>
            <Chip tone="warn">{done} of {total}</Chip>
          </span>
        );
      },
    },
    {
      t: 'File sent',
      f: (e) => (
        <span className="row tight">
          {fileTeams.map((t) => {
            const sent = e.fileSent[t.key];
            return (
              <span key={t.key} className={`ntag${sent ? '' : ' off'}`}
                title={`${t.name}${sent ? ` — sent ${ago(sent.at, now)}` : ' — not sent yet'}`}>
                <Icon name={sent ? 'check' : 'mail'} size={11} /> {t.short}
              </span>
            );
          })}
        </span>
      ),
    },
    {
      t: 'Status',
      f: (e) => (e.status === 'active' ? <Chip tone="ok">Started</Chip>
        : e.completedAt ? <Chip tone="ok">Ready for day one</Chip> : <Chip tone="warn">In progress</Chip>),
    },
  ];

  const tabLabel = ONB_TABS.find((t) => t.v === tab)!.t
    + (F.dept ? ` — ${depts.find((d) => d.id === F.dept)?.name ?? ''}` : '')
    + (F.pos ? ` — ${F.pos}` : '');

  const record = open
    ? <div style={{ margin: '12px 0 14px' }}><JoinerRecord e={open} teams={teams} viewer={viewer} now={now} /></div>
    : null;

  return (
    <>
      <TopBar
        title="Onboarding"
        sub={
          <>
            {tabCounts.progress} in progress · {tabCounts.ready} ready for day one · {noDate} still waiting
            on a confirmed joining date · every accepted offer lands here the moment the ID is issued
          </>
        }
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <Subnav action="onb.tab" active={tab} tabs={ONB_TABS.map((t) => ({ ...t, n: tabCounts[t.v] }))} />

        {tab === 'probation' ? (
          <>
            {record}
            <ProbationPanel hires={hires} w={W.preset(Number(sp.pw) || 365)} viewer={viewer} now={now} />
          </>
        ) : (
          <>
            {viewer.isPortal && (
              <div style={{ marginBottom: 12 }}>
                <Banner icon="users" title="Your new joiners"
                  body={'People hired on requisitions where you are a hiring manager, with their start date '
                    + 'and how far the paperwork has got. The TA team handles documents, references and the '
                    + 'notices to IT, HR, Training and Facilities.'} />
              </div>
            )}

            <div className="filters onbf">
              <input className="inp grow" data-act="onb.q" defaultValue={sp.q ?? ''}
                placeholder="Search joiners, positions, hiring managers…" aria-label="Search joiners" />
              <label className="fgrp">
                <span>Department</span>
                <select className="inp" data-act="onb.f:dept" defaultValue={F.dept}>
                  <option value="">All</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="fgrp">
                <span>Position</span>
                <select className="inp" data-act="onb.f:pos" defaultValue={F.pos}>
                  <option value="">All</option>
                  {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="fgrp">
                <span>Status</span>
                <select className="inp" data-act="onb.tab" defaultValue={tab}>
                  {ONB_TABS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
                </select>
              </label>
              <label className="fgrp">
                <span>Checklist</span>
                <select className="inp" data-act="onb.f:done" defaultValue={F.done}>
                  <option value="">Any</option>
                  <option value="yes">Completed</option>
                  <option value="no">Not completed</option>
                </select>
              </label>
            </div>

            <div className="filters onbf dates">
              <span className="fgrp-l"><Icon name="cal" size={13} /> Start date</span>
              <label className="fgrp"><span>from</span>
                <input type="date" className="inp" data-act="onb.f:sf" defaultValue={F.sf} /></label>
              <label className="fgrp"><span>to</span>
                <input type="date" className="inp" data-act="onb.f:st" defaultValue={F.st} /></label>
              <span className="fgrp-l" style={{ marginLeft: 10 }}><Icon name="check" size={13} /> Offer accepted</span>
              <label className="fgrp"><span>from</span>
                <input type="date" className="inp" data-act="onb.f:af" defaultValue={F.af} /></label>
              <label className="fgrp"><span>to</span>
                <input type="date" className="inp" data-act="onb.f:at" defaultValue={F.at} /></label>
              {!!active && (
                <Btn size="sm" variant="ghost" action="onb.clear" icon="x" iconSize={12}>
                  Clear {active} filter{active > 1 ? 's' : ''}
                </Btn>
              )}
              <Push />
              <span className="t-foot">
                <Icon name="shield" size={12} /> Documents verified by{' '}
                {verifier ?? 'the Onboarding Specialist'}; references and the joining date by the
                recruiter.
              </span>
            </div>

            {record}

            <Card flush icon="badge" className="onbt" title={tabLabel}
              actions={<span className="t-foot">{rows.length} joiner{rows.length === 1 ? '' : 's'} · click a row to open the record</span>}>
              {rows.length ? (
                <Table cols={cols}
                  rows={rows.map((e) => ({ ...e, _act: 'onb.open', _v: e.id, _cls: open?.id === e.id ? 'sel' : '' }))} />
              ) : (
                <Empty icon="badge"
                  title={active ? 'No joiner matches these filters' : tab === 'progress' ? 'Nobody is mid-way' : 'Nobody here'}
                  sub={active ? 'Clear a filter or two.'
                    : 'Accepted offers appear as joiners the moment the employee ID is issued.'} />
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}
