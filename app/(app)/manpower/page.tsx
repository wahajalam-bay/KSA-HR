import { chrome, q } from '@/lib/queries/chrome';
import { plan, summarise, seatAction, type Position, type Summary } from '@/lib/queries/manpower';
import { TopBar } from '@/components/app/shell';
import {
  Subnav, Card, Chip, Empty, Avatar, Table, Btn, Seg, JobStatus, Push, type Column,
} from '@/components/ui/primitives';
import { Badge, Icon } from '@/components/ui/icons';
import { OrgCanvas } from '@/components/manpower/org-canvas';
import {
  OrgNode, DeptChart, DeptPill, FnPill, OrgLegend, ALL,
} from '@/components/manpower/org-chart';
import { fmt, ago } from '@/lib/format';
import { can } from '@/lib/authz';
import { db } from '@/db/client';
import { employees, candidates } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { rows as rowsOf } from '@/lib/queries/sql';

export const dynamic = 'force-dynamic';

const TABS = [
  { v: 'structure', t: 'Structure' },
  { v: 'positions', t: 'Positions' },
  { v: 'employees', t: 'Employees & onboarding' },
] as const;

export default async function ManpowerPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();
  const tab = TABS.some((t) => t.v === sp.tab) ? sp.tab : 'structure';

  const data = await plan(viewer);
  const { positions, departments, functions, org } = data;

  /* How many joiners are still onboarding, by seat and by department — the
     "joining" half of every summary. */
  const onbRows = rowsOf(await db().execute(sql`
    SELECT position_code, dept_id, count(*)::int AS n FROM ${employees}
     WHERE status = 'onboarding' GROUP BY 1, 2`));
  const onbByCode = new Map<string, number>();
  const onbByDept = new Map<string, number>();
  for (const r of onbRows) {
    if (r.position_code) onbByCode.set(r.position_code, Number(r.n));
    onbByDept.set(r.dept_id, (onbByDept.get(r.dept_id) ?? 0) + Number(r.n));
  }

  const orgName = String(org?.orgName ?? 'Bayut KSA');
  const all = summarise(positions, onbByCode);

  const deptSummary = (id: string): Summary =>
    summarise(positions.filter((p) => p.deptId === id), onbByCode);
  const deptsOf = (fnId: string | null) => departments.filter((d) => (d.functionId ?? null) === fnId);
  const fnSummary = (fnId: string | null): Summary => {
    const ids = new Set(deptsOf(fnId).map((d) => d.id));
    return summarise(positions.filter((p) => ids.has(p.deptId)), onbByCode);
  };

  const subtitle = (
    <>
      {positions.length} coded positions across {departments.length} departments · {all.approved} approved
      seats · {all.filled} filled · {all.vacant} vacant · {data.employeesOnboarding} onboarding
    </>
  );

  const head = (
    <TopBar
      title="Manpower plan" sub={subtitle}
      actions={can(viewer, 'plan.edit')
        ? <Btn variant="out" className="only-wide" action="pos.new" icon="plus">Add position</Btn>
        : undefined}
      unread={counts.unreadNotifications} viewer={viewer} theme={theme}
    />
  );

  const nav = (
    <Subnav action="mp.tab" active={tab} tabs={[
      { v: 'structure', t: 'Structure', n: departments.length },
      { v: 'positions', t: 'Positions', n: positions.length },
      { v: 'employees', t: 'Employees & onboarding', n: data.employeeCount },
    ]} />
  );

  if (tab === 'positions') {
    const dept = sp.dept ?? '';
    const rows = positions.filter((p) => !dept || p.deptId === dept);
    return (
      <>
        {head}
        <main className="view" id="view">
          {nav}
          <PositionsPanel rows={rows} departments={departments} dept={dept} />
        </main>
      </>
    );
  }

  if (tab === 'employees') {
    const f = sp.f ?? 'onboarding';
    const people = rowsOf(await db().execute(sql`
      SELECT e.id, e.employee_code, e.name, e.position_code, e.dept_id, e.title,
             e.start_date::text AS start_date, e.status::text AS status, e.source::text AS source,
             d.name AS dept_name, c.photo, c.hue,
             ob.form_submitted_at, ob.completed_at,
             coalesce((SELECT json_agg(json_build_object('key', x.key, 'label', x.label, 'status', x.status)
                                       ORDER BY x.sort_order)
                         FROM onboarding_documents x WHERE x.employee_id = e.id), '[]'::json) AS docs
        FROM ${employees} e
        JOIN departments d ON d.id = e.dept_id
        LEFT JOIN ${candidates} c ON c.id = e.candidate_id
        LEFT JOIN onboarding_records ob ON ob.employee_id = e.id
       WHERE e.status <> 'left'
       ORDER BY e.start_date ${f === 'onboarding' ? sql`ASC` : sql`DESC`}, e.id`));
    const counts2 = {
      onboarding: people.filter((e) => e.status === 'onboarding').length,
      active: people.filter((e) => e.status === 'active').length,
    };
    const rows = people.filter((e) =>
      (f === 'onboarding' ? e.status === 'onboarding' : f === 'active' ? e.status === 'active' : true));
    return (
      <>
        {head}
        <main className="view" id="view">
          {nav}
          <EmployeesPanel rows={rows} f={f} counts={counts2} now={now}
            verifier={data.onboardingSpecialist} />
        </main>
      </>
    );
  }

  /* ── Structure ─────────────────────────────────────────────────────────── */
  const key = sp.dept || ALL;
  const isFn = key.startsWith('fn:');
  const fnId = isFn ? (key.slice(3) === 'other' ? null : key.slice(3)) : null;
  const dept = !isFn && key !== ALL ? departments.find((d) => d.id === key) ?? null : null;
  const fn = isFn ? functions.find((f) => f.id === fnId) ?? { id: null, name: 'Other', head: null, headTitle: null } : null;
  const fnOfDept = dept ? functions.find((f) => f.id === dept.functionId) ?? null : null;

  const sm = dept ? deptSummary(dept.id) : isFn ? fnSummary(fnId) : all;

  const title = dept ? `${dept.name} — hierarchy`
    : isFn ? `${fn!.name} — ${deptsOf(fnId).length} departments`
      : `${orgName} — company hierarchy`;

  const tiles: Array<[string, string, number]> = [
    ['grid', 'Positions', sm.positions], ['users', 'Approved seats', sm.approved],
    ['check', 'Filled', sm.filled], ['brief', 'In recruitment', sm.recruiting],
    ['alert', 'Vacant', sm.vacant], ['shield', 'Requested', sm.requested],
    ['badge', 'Onboarding', sm.onboarding],
  ];

  return (
    <>
      {head}
      <main className="view" id="view">
        {nav}

        <div className="filters">
          <select className="inp" data-act="mp.dept" aria-label="Show" defaultValue={key}>
            <option value={ALL}>{orgName} — every function</option>
            {functions.map((f) => {
              const ds = deptsOf(f.id);
              return (
                <optgroup key={f.id} label={f.name}>
                  {f.id !== 'fn_mgmt' && (
                    <option value={`fn:${f.id}`}>
                      {f.name} — all {ds.length} department{ds.length === 1 ? '' : 's'}
                    </option>
                  )}
                  {ds.map((y) => <option key={y.id} value={y.id}>&nbsp;&nbsp;{y.name}</option>)}
                </optgroup>
              );
            })}
            {!!deptsOf(null).length && (
              <optgroup label="Other">
                <option value="fn:other">Other — {deptsOf(null).length}</option>
                {deptsOf(null).map((y) => <option key={y.id} value={y.id}>&nbsp;&nbsp;{y.name}</option>)}
              </optgroup>
            )}
          </select>
          <span className="t-foot ocrumbs">
            <button className="linkbtn" data-act="mp.dept" data-v={ALL}>{orgName}</button>
            {(fnOfDept || fn) && (
              <>
                <span className="mut"> › </span>
                <button className="linkbtn" data-act="mp.dept" data-v={`fn:${(fnOfDept ?? fn)!.id ?? 'other'}`}>
                  {(fnOfDept ?? fn)!.name}
                </button>
              </>
            )}
            {dept && <><span className="mut"> › </span><b>{dept.name}</b></>}
            {dept ? ` · ${dept.head} · ${dept.headTitle ?? 'Department head'}`
              : isFn ? ` · ${fn!.head ?? ''}${fn!.headTitle ? ` · ${fn!.headTitle}` : ''}`
                : ` · ${functions.length} functions · ${departments.length} departments · ${org?.leaderName ?? ''}`}
          </span>
          <Push />
          <Btn size="sm" variant="out" action="mp.import" icon="upload" iconSize={13}>New department from Excel</Btn>
          <Btn size="sm" variant="out" action="pos.new" v={dept ? dept.id : ''} icon="plus" iconSize={13}
            title="A seat enters the plan with an approved requisition">
            New position{dept ? ` in ${dept.name}` : ''}
          </Btn>
        </div>

        <div className="tiles tiles-3" style={{ margin: '12px 0 14px' }}>
          {tiles.map(([ic, label, n]) => (
            <div className="tile" key={label}>
              <Badge name={ic} size={16} />
              <b className="tl-v">{fmt.int(n)}</b>
              <span className="tl-l">{label}</span>
            </div>
          ))}
        </div>

        <OrgCanvas deptKey={key} title={title} legend={<OrgLegend />}
          hint={<>Drag to move · ⌘/Ctrl + wheel to zoom · click a seat{key !== (dept?.id ?? '') ? ' · click a department to open it' : ''}</>}>
          {dept ? (
            <DeptChart positions={positions.filter((p) => p.deptId === dept.id)} />
          ) : isFn ? (
            <FunctionChart fnId={fnId} name={fn!.name} departments={deptsOf(fnId)}
              positions={positions} summary={deptSummary} />
          ) : (
            <CompanyChart orgName={orgName} org={org} functions={functions} positions={positions}
              deptsOf={deptsOf} deptSummary={deptSummary} fnSummary={fnSummary} />
          )}
        </OrgCanvas>
      </main>
    </>
  );
}

/* ── The company: the General Manager, then one column per function ─────── */
function CompanyChart({ orgName, org, functions, positions, deptsOf, deptSummary, fnSummary }: {
  orgName: string; org: any; functions: any[]; positions: Position[];
  deptsOf: (fnId: string | null) => any[];
  deptSummary: (id: string) => Summary;
  fnSummary: (id: string | null) => Summary;
}) {
  const gmSeat = positions.find((p) => p.deptId === 'dep_mgt' && !p.reportsTo) ?? null;
  const fns = functions.filter((f) => f.id !== 'fn_mgmt');
  const other = deptsOf(null);
  const office = positions.filter((p) => p.deptId === 'dep_mgt' && p.reportsTo && !p.functionId
    && !fns.some((f) => f.head === (p.holders[0]?.name ?? null)));

  return (
    <div className="oroot">
      {gmSeat ? (
        <div className="onode-root"><OrgNode p={gmSeat} level={0} /></div>
      ) : (
        <div className="onode lv0 company" data-act="mp.company" role="button" tabIndex={0}>
          <span className="oav">
            <Avatar person={{ name: String(org?.leaderName ?? orgName), photo: 'profile', hue: 3 }} size="l" />
          </span>
          <span className="obd">
            <b>{org?.leaderName ?? orgName}</b>
            <span>{org?.leaderTitle ?? orgName}</span>
            <span className="ocode mono">{orgName}</span>
          </span>
        </div>
      )}
      <div className="orow">
        {!!office.length && (
          <div className="ocol">
            <div className="odept">
              <button className="linkbtn" data-act="mp.dept" data-v="dep_mgt">Management</button>
              <span className="t-foot">General Manager&rsquo;s office · {office.length} seat{office.length === 1 ? '' : 's'}</span>
            </div>
            <ul className="ostack">
              {office.map((p) => <li key={p.id}><OrgNode p={p} level={1} /></li>)}
            </ul>
          </div>
        )}
        {fns.map((f) => {
          const ds = deptsOf(f.id);
          if (!ds.length && !positions.some((p) => p.functionId === f.id)) return null;
          const seat = positions.find((p) => p.functionId === f.id)
            ?? positions.find((p) => p.deptId === 'dep_mgt' && p.holders[0]?.name === f.head);
          return (
            <div className="ocol" key={f.id}>
              <FnPill id={f.id} name={f.name} departments={ds.length} summary={fnSummary(f.id)} />
              {seat ? <OrgNode p={seat} level={1} /> : (
                <div className="onode lv1">
                  <span className="oav"><Avatar person={{ name: f.head ?? f.name, photo: 'profile', hue: 3 }} size="l" /></span>
                  <span className="obd">
                    <b>{f.head ?? f.name}</b>
                    <span>{f.headTitle ?? 'Function head'}</span>
                    <span className="ocode mono">{f.code ?? ''}</span>
                  </span>
                </div>
              )}
              <ul className="ostack odepts">
                {ds.map((d) => (
                  <li key={d.id}><DeptPill id={d.id} name={d.name} summary={deptSummary(d.id)} /></li>
                ))}
              </ul>
            </div>
          );
        })}
        {!!other.length && (
          <div className="ocol">
            <FnPill id={null} name="Other" departments={other.length} summary={fnSummary(null)} />
            <ul className="ostack odepts">
              {other.map((d) => (
                <li key={d.id}><DeptPill id={d.id} name={d.name} summary={deptSummary(d.id)} /></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── One function: a column per department — the head and its managers ──── */
function FunctionChart({ fnId, name, departments, positions, summary }: {
  fnId: string | null; name: string; departments: any[]; positions: Position[];
  summary: (id: string) => Summary;
}) {
  if (fnId === 'fn_mgmt') {
    return <DeptChart positions={positions.filter((p) => p.deptId === 'dep_mgt')} />;
  }
  return (
    <div className="oroot">
      <div className="orow">
        {departments.map((d) => {
          const ps = positions.filter((p) => p.deptId === d.id);
          const head = ps.find((p) => !p.reportsTo || !ps.some((x) => x.id === p.reportsTo));
          if (!head) {
            return <div className="ocol" key={d.id}><DeptPill id={d.id} name={d.name} summary={summary(d.id)} /></div>;
          }
          const mgrs = ps.filter((p) => p.reportsTo === head.id && ps.some((x) => x.reportsTo === p.id))
            .sort((a, b) => a.code.localeCompare(b.code));
          const rest = ps.length - 1 - mgrs.length;
          return (
            <div className="ocol" key={d.id}>
              <DeptPill id={d.id} name={d.name} summary={summary(d.id)} />
              <OrgNode p={head} level={1} />
              {!!mgrs.length && (
                <ul className="ostack">
                  {mgrs.map((p) => <li key={p.id}><OrgNode p={p} level={2} /></li>)}
                </ul>
              )}
              {rest > 0 && (
                <div className="odept">
                  <button className="linkbtn" data-act="mp.dept" data-v={d.id}>
                    {rest} more seat{rest === 1 ? '' : 's'}
                  </button>
                  <span className="t-foot">open the department</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Positions ──────────────────────────────────────────────────────────── */
type PosRow = Position & { _cls?: string };

function PositionsPanel({ rows, departments, dept }: {
  rows: Position[]; departments: any[]; dept: string;
}) {
  const cols: Array<Column<PosRow>> = [
    { t: 'Code', f: (p) => <span className="mono">{p.code}</span> },
    {
      t: 'Position',
      f: (p) => <><b>{p.title}</b><br /><span className="t-foot">{p.deptName} · {p.grade} · {p.city}</span></>,
    },
    {
      t: 'Reports to',
      f: (p) => {
        const up = rows.find((x) => x.id === p.reportsTo);
        return up ? <>{up.title} <span className="mono mut">{up.code}</span></> : <span className="mut">—</span>;
      },
    },
    {
      t: 'Holder',
      f: (p) => (p.holders.length
        ? <>{p.holders.map((e) => (
          <span className="row tight nowrap" key={e.id}>
            <Avatar person={{ name: e.name, photo: e.photo, hue: e.hue, gender: e.gender }} size="s" /> {e.name}
          </span>
        ))}</>
        : <span className="mut">Vacant</span>),
    },
    {
      t: 'Seats',
      f: (p) => {
        const s = p.seat;
        if (s.pending) return <><span className="mut">—</span> <Chip tone="info">{s.requested} requested</Chip></>;
        return (
          <>
            <b className="num">{s.filled}</b> / {s.approved}
            {s.recruiting ? <> <Chip tone="warn">Hiring</Chip></> : s.vacant ? <> <Chip tone="bad">Vacant</Chip></> : null}
          </>
        );
      },
    },
    {
      t: 'Requisition', cls: 'wrap',
      f: (p) => {
        const a = seatAction(p);
        if (a.kind === 'none') return <span className="mut t-foot">{a.why}</span>;
        if (a.kind === 'raise') {
          return <Btn size="xs" variant="out" action={a.act} v={a.v} icon="plus" iconSize={11}>{a.label}</Btn>;
        }
        return (
          <>
            <button className="linkbtn" data-act="go" data-v={a.v}>{a.job.title}</button>
            <JobStatus status={a.job.status} /><br />
            <Btn size="xs" variant={a.tone as any} action="go" v={a.v} icon="brief" iconSize={11}>{a.label}</Btn>
            {a.also && (
              <> <Btn size="xs" variant="out" action={a.also.act} v={a.also.v} icon="plus" iconSize={11}>{a.also.label}</Btn></>
            )}
          </>
        );
      },
    },
    { t: '', f: (p) => <Btn size="xs" variant="ghost" action="pos.open" v={p.id} icon="pencil" iconSize={11} /> },
  ];

  return (
    <>
      <div className="filters">
        <select className="inp" data-act="mp.deptAll" defaultValue={dept} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <span className="t-foot">{rows.length} positions</span>
        <Push />
        <Btn size="sm" variant="ghost" action="data.export" v="positions" icon="dl" iconSize={13}>Export</Btn>
      </div>
      <Card flush title="Positions" icon="grid">
        <Table cols={cols} rows={rows} emptyIcon="grid" emptyTitle="No positions here" />
      </Card>
    </>
  );
}

/* ── Employees ──────────────────────────────────────────────────────────── */
function EmployeesPanel({ rows, f, counts, now, verifier }: {
  rows: any[]; f: string; counts: { onboarding: number; active: number };
  now: Date; verifier: string | null;
}) {
  const cols: Array<Column<any>> = [
    {
      t: 'Employee',
      f: (e) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: e.name, photo: e.photo, hue: Number(e.hue ?? 3) }} size="s" />
          <span><b>{e.name}</b><br /><span className="mono t-foot">{e.employee_code}</span></span>
        </div>
      ),
    },
    {
      t: 'Position',
      f: (e) => <>{e.title}<br /><span className="t-foot"><span className="mono">{e.position_code ?? '—'}</span> · {e.dept_name}</span></>,
    },
    { t: 'Start', f: (e) => <>{fmt.date(e.start_date)}<br /><span className="t-foot">{ago(e.start_date, now)}</span></> },
    {
      t: 'Form',
      f: (e) => (e.form_submitted_at ? <Chip tone="ok">Submitted</Chip>
        : e.source === 'existing' ? <Chip>On file</Chip> : <Chip tone="warn">Waiting</Chip>),
    },
    {
      t: 'Documents',
      f: (e) => {
        const docs = (e.docs ?? []) as Array<{ key: string; label: string; status: string }>;
        const verified = docs.filter((d) => d.status === 'verified').length;
        return (
          <span className="row tight">
            {docs.map((d) => <i key={d.key} className={`docdot ${d.status}`} title={`${d.label}: ${d.status}`} />)}
            <span className="t-foot">{verified}/{docs.length}</span>
          </span>
        );
      },
    },
    {
      t: 'Status',
      f: (e) => (e.status === 'active' ? <Chip tone="ok">Active</Chip>
        : e.completed_at ? <Chip tone="ok">Ready for day one</Chip> : <Chip tone="warn">Onboarding</Chip>),
    },
    { t: '', f: (e) => <Btn size="xs" variant="out" action="emp.open" v={e.id}>Open</Btn> },
  ];

  return (
    <>
      <div className="filters">
        <Seg action="mp.filter" active={f} options={[
          { v: 'onboarding', t: `Onboarding (${counts.onboarding})` },
          { v: 'active', t: `Active (${counts.active})` },
          { v: 'all', t: 'Everyone' },
        ]} />
        <Push />
        <span className="t-foot">
          <Icon name="shield" size={12} /> Documents are verified by{' '}
          {verifier ? fmt.first(verifier) : 'the Onboarding Specialist'} or an Admin.
        </span>
      </div>
      <Card flush icon="badge"
        title={f === 'onboarding' ? 'Joiners in onboarding' : f === 'active' ? 'Active employees' : 'Everyone on the books'}>
        {rows.length
          ? <Table cols={cols} rows={rows} />
          : <Empty icon="badge" title="Nobody here"
            sub="Signed offers appear as joiners the moment the ID is issued." />}
      </Card>
    </>
  );
}
