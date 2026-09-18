import * as React from 'react';
import { Avatar } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt } from '@/lib/format';
import type { Position, Summary } from '@/lib/queries/manpower';

/* ─────────────────────────────────────────────────────────────────────────────
   The organisation chart.

   One department, or the whole company. The root sits at the top, its direct
   reports form a row, and everyone beneath each of them stacks in a column —
   the classic hierarchy chart, with a photo bubble on every seat.

   A seat that is empty says so, a seat being recruited into says who is hiring,
   and a seat that was requested but not yet approved is drawn differently again:
   the chart is the plan, and the plan distinguishes between a seat you have and
   a seat you have asked for.
   ───────────────────────────────────────────────────────────────────────────*/

export const ALL = 'all';

export function OrgNode({ p, level }: { p: Position; level: number }) {
  const s = p.seat;
  const person = p.holders[0] ?? null;
  const hiring = s.recruiting > 0;

  const sub = s.pending ? `${p.title} · requested, awaiting approval`
    : person ? `${p.title}${p.holders.length > 1 ? ` · +${p.holders.length - 1} more` : ''}`
      : s.job?.status === 'open'
        ? `${p.title} · hiring${s.inPipeline ? ` · ${s.inPipeline} in pipeline` : ''}`
        : s.job?.status === 'draft' ? `${p.title} · requisition drafted` : `${p.title} · vacant`;

  const cls = `onode lv${Math.min(level, 2)}${person ? '' : ' vacant'}`
    + `${hiring ? ' hiring' : ''}${s.pending ? ' pendingseat' : ''}`;

  return (
    <div className={cls} data-act="pos.open" data-v={p.id} role="button" tabIndex={0}
      title={`${p.code} · ${p.title}${s.pending ? ' · requested, awaiting approval' : ''}`}>
      <span className="oav">
        {person
          ? <Avatar person={{ name: person.name, photo: person.photo, hue: person.hue, gender: person.gender }} size="l" />
          : <span className="av l photo empty"><Icon name={s.job ? 'brief' : 'users'} size={18} /></span>}
      </span>
      <span className="obd">
        <b>{person ? person.name : s.job?.status === 'open' ? 'Open position' : 'Vacant seat'}</b>
        <span>{sub}</span>
        <span className="ocode mono">{p.code}{s.approved > 1 ? ` · ${s.filled}/${s.approved}` : ''}</span>
      </span>
      {hiring
        ? <span className="otag">Hiring{s.job?.hiringManager ? ` · ${fmt.first(s.job.hiringManager)}` : ''}</span>
        : !person && s.job?.status === 'draft'
          ? <span className="otag warn">Draft{s.job?.hiringManager ? ` · ${fmt.first(s.job.hiringManager)}` : ''}</span>
          : !person && !s.job ? <span className="otag bad">Vacant</span> : null}
    </div>
  );
}

type Kids = (id: string) => Position[];

function OrgStack({ nodes, kids, level }: { nodes: Position[]; kids: Kids; level: number }) {
  return (
    <ul className="ostack">
      {nodes.map((p) => {
        const ch = kids(p.id);
        return (
          <li key={p.id}>
            <OrgNode p={p} level={level} />
            {!!ch.length && <OrgStack nodes={ch} kids={kids} level={level + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

/* The row under the root: managers each get a column; seats that report
   straight to the root without a team of their own are gathered into one
   stacked column so the chart stays readable. */
function OrgTree({ roots, kids, level, spread }: {
  roots: Position[]; kids: Kids; level: number; spread?: boolean;
}) {
  const branches = roots.filter((p) => kids(p.id).length);
  const leaves = roots.filter((p) => !kids(p.id).length);
  const gather = leaves.length && !spread && (branches.length > 0 || leaves.length > 4);

  return (
    <div className="orow">
      {branches.map((p) => (
        <div className="ocol" key={p.id}>
          <OrgNode p={p} level={level} />
          <OrgStack nodes={kids(p.id)} kids={kids} level={level + 1} />
        </div>
      ))}
      {gather ? (
        <div className="ocol">
          <div className="odept">
            <span className="linkbtn" style={{ textDecoration: 'none', cursor: 'default' }}>Direct reports</span>
            <span className="t-foot">{leaves.length} seat{leaves.length === 1 ? '' : 's'}</span>
          </div>
          <OrgStack nodes={leaves} kids={kids} level={level} />
        </div>
      ) : leaves.map((p) => (
        <div className="ocol" key={p.id}><OrgNode p={p} level={level} /></div>
      ))}
    </div>
  );
}

const byRank = (a: Position, b: Position) => {
  const ka = (a.holders.length ? 0 : 1) + a.code;
  const kb = (b.holders.length ? 0 : 1) + b.code;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

export function DeptChart({ positions }: { positions: Position[] }) {
  const kids: Kids = (id) => positions.filter((p) => p.reportsTo === id).sort(byRank);
  const roots = positions.filter((p) => !p.reportsTo || !positions.some((x) => x.id === p.reportsTo));
  /* A leadership team reads as a row of directors, not a stack of direct reports. */
  const spread = positions.every((p) => p.kind === 'leadership' || p.kind === 'management');
  return (
    <>
      {roots.map((root) => {
        const ch = kids(root.id);
        return (
          <div className="oroot" key={root.id}>
            <OrgNode p={root} level={0} />
            {!!ch.length && <OrgTree roots={ch} kids={kids} level={1} spread={spread} />}
          </div>
        );
      })}
    </>
  );
}

export function peopleText(sm: Summary): string {
  const colleagues = sm.filled - sm.onboarding;
  return `${colleagues} colleague${colleagues === 1 ? '' : 's'}`
    + `${sm.onboarding ? ` · ${sm.onboarding} joining` : ''}`
    + `${sm.recruiting ? ` · ${sm.recruiting} hiring` : ''}`
    + `${sm.vacant - sm.recruiting > 0 ? ` · ${sm.vacant - sm.recruiting} vacant` : ''}`;
}

export function DeptPill({ id, name, summary }: { id: string; name: string; summary: Summary }) {
  return (
    <div className="odept">
      <button className="linkbtn" data-act="mp.dept" data-v={id}>{name}</button>
      <span className="t-foot">{peopleText(summary)}</span>
    </div>
  );
}

export function FnPill({ id, name, departments, summary }: {
  id: string | null; name: string; departments: number; summary: Summary;
}) {
  return (
    <div className="odept ofn">
      <button className="linkbtn" data-act="mp.dept" data-v={`fn:${id ?? 'other'}`}>{name}</button>
      <span className="t-foot">
        {departments} department{departments === 1 ? '' : 's'} · {peopleText(summary)}
      </span>
    </div>
  );
}

export function OrgLegend() {
  return (
    <span className="row tight">
      <span className="okey lv0" /><span className="t-foot">Leadership</span>
      <span className="okey lv1" /><span className="t-foot">Managers</span>
      <span className="okey lv2" /><span className="t-foot">Team</span>
      <span className="okey hiring" /><span className="t-foot">Open position — in recruitment</span>
      <span className="okey vacant" /><span className="t-foot">Vacant seat</span>
    </span>
  );
}
