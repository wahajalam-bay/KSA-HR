import 'server-only';
import * as React from 'react';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  staff, positions, employees, departments, jobs, locations, approvalFlows,
} from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Card, Kvs, Avatar } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { TEAM_ROLES, HIRING_ROLES } from '@/lib/domain/team';
import { nextCode } from '@/lib/services/manpower';
import { owned, heirs } from '@/lib/services/team';
import { fmt } from '@/lib/format';
import { allLocations, depts } from './blocks';

/* ═════════════════════════════════════════════════════════════════════════════
   THE DESK AND THE PLAN

   Adding somebody to the TA team, editing their profile, and the three sheets
   that belong to the manpower plan: a seat, the note that says a seat starts
   with a requisition, and the import.

   The plan sheet is the one that says no. Nothing is added to the manpower plan
   directly — a seat arrives with the requisition that raised it, held as
   requested while the chain runs and counted as headcount only when it closes.
   The sheet explains that rather than offering a form that would quietly create
   headcount nobody approved.
   ═════════════════════════════════════════════════════════════════════════════*/

const GRADES = ['D1', 'M4', 'M3', 'M2', 'P4', 'P3', 'P2', 'P1'];

/** The form both the new sheet and the editor show, with the same names. */
async function TeamForm({ p }: {
  p?: {
    id: string; name: string; title: string | null; role: string; email: string | null;
    phone: string | null; locationId: string | null; monthlyTarget: number | null;
    gender: string | null; deptIds?: string[];
  } | null;
}) {
  const [locs, ds] = await Promise.all([allLocations(), depts()]);
  const on = new Set(p?.deptIds ?? []);

  return (
    <div className="form">
      <Field label="Full name" name="name" value={p?.name ?? ''} req className="wide"
        placeholder="e.g. Sara Al-Amri" />
      <Field label="Job title" name="title" value={p?.title ?? ''} req className="wide"
        placeholder="e.g. Talent Partner — Commercial" />
      <Field label="Role" name="role" type="select" value={p?.role ?? 'recruiter'}
        options={TEAM_ROLES.map((x) => ({ v: x.v, t: x.t }))}
        help="Only recruiters and the TA lead carry a hiring target." />
      <Field label="Base location" name="locationId" type="select"
        value={p?.locationId ?? locs[0]?.id ?? ''}
        options={locs.map((l) => ({ v: l.id, t: l.city }))} />
      <Field label="Drawn portrait" name="gender" type="select" value={p?.gender ?? ''}
        options={[
          { v: '', t: 'Guess from the name' }, { v: 'f', t: 'Woman' }, { v: 'm', t: 'Man' },
        ]}
        help="Only used for the stand-in portrait when no photo is uploaded." />
      <Field label="Work email" name="email" type="email" value={p?.email ?? ''}
        placeholder="first.last@bayut.sa" help="Left blank, it is derived from the name." />
      <Field label="Mobile" name="phone" value={p?.phone ?? ''} placeholder="+9665…" />
      <Field label="Monthly hiring target" name="monthlyTarget" type="number"
        value={p?.monthlyTarget ?? 2} min={0} step={1}
        help="Hires a month. Set 0 for a sourcer, coordinator or analyst." />
      <div className="field wide">
        <label>Departments covered</label>
        <div className="wrap">
          {ds.map((d) => (
            <label className="chip" key={d.id}>
              <input type="checkbox" name="deptIds" value={d.id} defaultChecked={on.has(d.id)} />
              {d.name}
            </label>
          ))}
        </div>
        <span className="help">
          Leave every box clear for a role that works across the whole team.
        </span>
      </div>
    </div>
  );
}

defineSheets({
  /* ── Somebody new on the desk ─────────────────────────────────────────── */
  'staff.new': async () => ({
    title: 'Add a recruiter',
    aria: 'Add a member of the TA team',
    wide: true,
    eyebrow: 'TA team',
    sub: 'Only recruiters and the TA lead are measured against a hiring target. Sourcers, '
      + 'coordinators and analysts are measured on sourced applications, interviews scheduled '
      + 'and tasks closed.',
    body: <TeamForm />,
    foot: (
      <>
        <Btn variant="ghost" action="sheet.close">Cancel</Btn>
        <Sp />
        <Btn variant="pri" action="staff.create">Add to the team</Btn>
      </>
    ),
  }),

  /* ── Their profile ────────────────────────────────────────────────────── */
  'staff.edit': async (v, { viewer }) => {
    const [p] = await db().select().from(staff).where(eq(staff.id, v)).limit(1);
    if (!p) return null;
    const mine = p.id === (viewer.actingAsStaffId ?? viewer.staffId);

    return {
      title: 'Edit profile',
      aria: 'Edit staff profile',
      wide: true,
      eyebrow: p.name,
      sub: p.status === 'inactive'
        ? 'This profile is deactivated — the desk they owned has already been handed over.'
        : undefined,
      body: <TeamForm p={p} />,
      foot: (
        <>
          {p.status === 'active' && !mine && (
            <Btn variant="ghost" action="staff.deactivate" v={p.id}>Deactivate</Btn>
          )}
          {p.status === 'inactive' && (
            <Btn variant="ghost" action="staff.reactivate" v={p.id}>Reactivate</Btn>
          )}
          {viewer.isAdmin && !mine && (
            <Btn variant="danger" action="staff.deleteConfirm" v={p.id} icon="trash" iconSize={13}>
              Delete
            </Btn>
          )}
          <Sp />
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Btn variant="pri" action="staff.save" v={p.id}>Save profile</Btn>
        </>
      ),
    };
  },

  /* ── A seat on the plan ───────────────────────────────────────────────── */
  'pos.open': async (v, { viewer }) => {
    const [p] = await db().select().from(positions).where(eq(positions.id, v)).limit(1);
    if (!p) return null;
    const [dept] = await db().select().from(departments)
      .where(eq(departments.id, p.deptId)).limit(1);
    const [loc] = p.locationId
      ? await db().select().from(locations).where(eq(locations.id, p.locationId)).limit(1)
      : [];
    const [up] = p.reportsToId
      ? await db().select().from(positions).where(eq(positions.id, p.reportsToId)).limit(1)
      : [];

    const holders = rowsOf(await db().execute(sql`
      SELECT id, name, employee_code, start_date, status::text AS status, candidate_id
        FROM ${employees}
       WHERE position_code = ${p.code} AND status <> 'left'
       ORDER BY start_date`)) as Array<{
         id: string; name: string; employee_code: string; start_date: string;
         status: string; candidate_id: string | null;
       }>;

    const [job] = p.jobId
      ? await db().select().from(jobs).where(eq(jobs.id, p.jobId)).limit(1)
      : [];
    const [{ pipeline }] = p.jobId
      ? rowsOf(await db().execute(sql`
        SELECT count(*)::int AS pipeline FROM applications
         WHERE job_id = ${p.jobId} AND status IN ('active','on_hold')`)) as Array<{ pipeline: number }>
      : [{ pipeline: 0 }];

    const siblings = await db().select({ id: positions.id, code: positions.code, title: positions.title })
      .from(positions)
      .where(and(eq(positions.deptId, p.deptId), isNull(positions.retiredAt), sql`${positions.id} <> ${v}`))
      .orderBy(asc(positions.code));
    const locs = await allLocations();
    const may = viewer.isAdmin;
    const pending = p.planState === 'pending';
    const filled = holders.length;
    const vacant = Math.max(0, p.approved - filled);

    return {
      title: `${p.code} · ${p.title}`,
      aria: 'Position',
      eyebrow: dept?.name,
      wide: true,
      sub: `${p.grade ?? '—'} · ${loc?.city ?? '—'} · reports to ${
        up ? `${up.title} (${up.code})` : 'nobody — top of the department'}`,
      body: (
        <>
          <div className="tiles tiles-3" style={{ marginBottom: 14 }}>
            {(pending
              ? [['shield', 'Requested', p.requested], ['users', 'Approved', p.approved], ['check', 'Filled', filled]]
              : [['users', 'Approved', p.approved], ['check', 'Filled', filled], ['alert', 'Vacant', vacant]]
            ).map(([ic, l, n]) => (
              <div className="tile" key={String(l)}>
                <span className="badge"><Icon name={ic as 'users'} size={16} /></span>
                <b className="tl-v">{String(n)}</b>
                <span className="tl-l">{String(l)}</span>
              </div>
            ))}
          </div>

          {pending && (
            <Banner tone="info" icon="shield" title="Requested, not yet approved"
              body="This seat came with a requisition that is still in the approval chain. It is not
                counted as headcount, and nobody can be hired into it, until that closes." />
          )}

          <div className="divider"><span className="t-over">Who holds it</span></div>
          {holders.length ? (
            <div className="list flush">
              {holders.map((e) => (
                <Li key={e.id} avatar={e.name} title={e.name}
                  sub={`${e.employee_code} · since ${fmt.date(e.start_date)}${
                    e.status === 'onboarding' ? ' · onboarding' : ''}`}
                  right={<Chip tone={e.status === 'onboarding' ? 'warn' : 'ok'}>
                    {e.status === 'onboarding' ? 'Onboarding' : 'Active'}
                  </Chip>}
                  action="emp.open" v={e.id} />
              ))}
            </div>
          ) : <p className="t-foot">Nobody yet.</p>}

          <div className="divider"><span className="t-over">Requisition</span></div>
          {job ? (
            <>
              <Li icon="brief" title={job.title}
                sub={`${job.openings} opening${job.openings === 1 ? '' : 's'} · ${pipeline} in pipeline`}
                right={<Chip tone={job.status === 'open' ? 'ok' : ''}>{job.status.replace('_', ' ')}</Chip>}
                action="go" v={`/jobs/${job.id}`} />
              <div className="row" style={{ marginTop: 9 }}>
                <span className="t-foot">
                  {['open', 'pending_approval', 'draft', 'on_hold'].includes(job.status)
                    ? 'This seat is already being hired into — there is nothing to raise.'
                    : 'The last requisition on this seat is closed.'}
                </span>
                <Sp />
                {!['open', 'pending_approval', 'draft', 'on_hold'].includes(job.status) && vacant > 0 && (
                  <Btn size="sm" variant="out" action="pos.openReq" v={v} icon="plus" iconSize={13}>
                    Raise a requisition
                  </Btn>
                )}
              </div>
            </>
          ) : vacant > 0 ? (
            <div className="row">
              <span className="t-foot">
                No requisition hires into this seat yet. Raising one sends it through the approval
                chain; the seat is only hired into once that closes.
              </span>
              <Sp />
              <Btn size="sm" variant="pri" action="pos.openReq" v={v} icon="plus" iconSize={13}>
                Raise a requisition
              </Btn>
            </div>
          ) : (
            <p className="t-foot">The seat is full — there is nothing to hire for.</p>
          )}

          {may && (
            <>
              <div className="divider"><span className="t-over">Edit</span></div>
              <div className="form">
                <Field label="Title" name="title" value={p.title} className="wide" />
                <Field label="Grade" name="grade" type="select" value={p.grade ?? 'P3'}
                  options={GRADES} />
                <Field label="Approved headcount" name="approved" type="number"
                  value={p.approved} min={filled}
                  help={filled ? `${filled} already in the seat — it cannot go under that.` : undefined} />
                <Field label="Reports to" name="reportsTo" type="select" value={p.reportsToId ?? ''}
                  options={[
                    { v: '', t: 'Nobody (top of the department)' },
                    ...siblings.map((x) => ({ v: x.id, t: `${x.code} · ${x.title}` })),
                  ]} />
                <Field label="Location" name="locationId" type="select" value={p.locationId ?? ''}
                  options={locs.map((l) => ({ v: l.id, t: l.city }))} />
              </div>
            </>
          )}
        </>
      ),
      foot: may ? (
        <>
          {!holders.length && !job && (
            <Btn variant="danger" action="pos.remove" v={v} icon="trash" iconSize={13}>Remove</Btn>
          )}
          <Sp />
          <Btn variant="ghost" action="sheet.close">Close</Btn>
          <Btn variant="pri" action="pos.save" v={v}>Save the seat</Btn>
        </>
      ) : undefined,
    };
  },

  /* ── "A new seat starts with a requisition" ───────────────────────────── */
  'pos.new': async (v, { viewer }) => {
    if (!viewer.isAdmin) {
      return {
        title: 'Add to the manpower plan',
        aria: 'Add a position',
        body: (
          <Banner tone="warn" icon="lock" title="Only an Admin adds to the manpower plan"
            body="Headcount is what the plan is for, so changing it is one desk’s decision." />
        ),
      };
    }

    const ds = await depts();
    const deptId = ds.some((d) => d.id === v) ? v : ds[0]?.id ?? '';
    const code = deptId ? await nextCode(deptId, db()) : '—';
    const [flow] = await db().select().from(approvalFlows)
      .where(and(eq(approvalFlows.subject, 'requisition'), eq(approvalFlows.isActive, true)))
      .orderBy(asc(approvalFlows.sortOrder))
      .limit(1);
    const steps = flow
      ? rowsOf(await db().execute(sql`
        SELECT label FROM approval_flow_steps WHERE flow_id = ${flow.id} ORDER BY ordinal`)) as Array<{ label: string }>
      : [];

    return {
      title: 'A new seat starts with a requisition',
      aria: 'Add a position',
      eyebrow: 'Manpower plan',
      sub: 'Nothing is added to the plan directly. Raise the requisition for the role and the seat '
        + 'comes with it — held as requested while the approval chain runs, and counted as approved '
        + 'headcount the moment that closes.',
      body: (
        <div className="stack">
          <Card title="How it goes" icon="shield">
            <ol className="steps">
              <li>
                <b>Raise the requisition</b> — the title, the department, the band, the loop and the
                skills, on one form. The next code in{' '}
                {ds.find((d) => d.id === deptId)?.name ?? 'that department'} is{' '}
                <span className="mono">{code}</span>.
              </li>
              <li>
                <b>It goes for approval</b>
                {steps.length ? ` — ${steps.map((s) => s.label).join(', ')}` : ''}. The seat shows on
                the plan as requested, so nobody raises it twice.
              </li>
              <li>
                <b>Approved</b> — the seat becomes approved headcount and the requisition opens for
                applications. Sent back, and the seat goes with it.
              </li>
            </ol>
          </Card>
          <div className="form">
            <Field label="Department" name="deptId" type="select" value={deptId} className="wide"
              options={ds.map((d) => ({ v: d.id, t: d.name }))}
              help="The requisition form opens on this department." />
          </div>
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="job.new" icon="plus" iconSize={14}>Raise the requisition</Btn>
        </>
      ),
    };
  },

  /* ── Deleting somebody from the desk ─────────────────────────────────── */
  /* The only sheet in the product whose whole job is to make somebody choose
     an heir. A profile leaves the team, the leaderboards and the role
     switcher; the live work has to go somewhere, and the closed work stays
     exactly where it is, under their name, because history is not rewritten. */
  'staff.delete': async (v, { viewer }) => {
    const [p] = await db().select().from(staff).where(eq(staff.id, v)).limit(1);
    if (!p) return null;

    if (!viewer.isAdmin) {
      return {
        title: 'Delete a team member',
        aria: 'Delete team member',
        body: (
          <Banner tone="warn" icon="lock" title="Only an Admin deletes a profile"
            body="Deactivating closes somebody’s way in and keeps their desk; deleting hands the
              desk over. Both are an Admin’s." />
        ),
      };
    }
    if (p.id === (viewer.actingAsStaffId ?? viewer.staffId)) {
      return {
        title: `Delete ${p.name}`,
        aria: 'Delete team member',
        body: (
          <Banner tone="warn" icon="alert" title="You cannot delete your own profile"
            body="Ask another Admin." />
        ),
      };
    }

    const [what, candidates_] = await Promise.all([owned(p.id, db()), heirs(p.id, db())]);
    const needsHeir = what.requisitions.length + what.live + what.tasks > 0;
    const suggested = candidates_[0] ?? null;

    return {
      title: `Delete ${p.name}`,
      aria: 'Delete team member',
      eyebrow: 'Admin',
      sub: 'The profile leaves the team, the leaderboards and the role switcher. Their name stays '
        + 'on every record they touched — history is never rewritten.',
      body: (
        <div className="stack">
          <Card title="What they are holding" icon="brief">
            <Kvs pairs={[
              ['Live requisitions', what.requisitions.length
                ? `${what.requisitions.length} — ${what.requisitions.map((r) => r.title).join(', ')}`
                : 'None'],
              ['Live applications', what.live ? String(what.live) : 'None'],
              ['Open tasks', what.tasks ? String(what.tasks) : 'None'],
              ['Closed applications', what.closed
                ? `${what.closed} — these keep their name`
                : 'None'],
            ]} />
          </Card>

          {needsHeir ? (
            <>
              <Banner tone="warn" icon="users" title="Somebody has to pick this up"
                body={`${what.requisitions.length + what.live + what.tasks} live things are on `
                  + `${p.name.split(/\s+/)[0]}’s desk. Whoever you name takes them over in the same `
                  + 'breath as the deletion — there is no moment where they belong to nobody.'} />
              <div className="form">
                <Field label="Hand the desk to" name="heir" type="select" req className="wide"
                  value={suggested?.id ?? ''}
                  options={candidates_.map((h) => ({
                    v: h.id,
                    t: `${h.name}${h.title ? ` — ${h.title}` : ''} · ${h.open} open`,
                  }))}
                  help={suggested
                    ? `${suggested.name} has the fewest open requisitions today.`
                    : 'Nobody on the desk can take this on — deactivate them instead.'} />
              </div>
            </>
          ) : (
            <Banner tone="info" icon="check" title="Nothing live to hand over"
              body="Their closed work keeps their name, which is what a report of it should say." />
          )}
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          {p.status === 'active' && (
            <Btn variant="out" action="staff.deactivate" v={v}>Deactivate instead</Btn>
          )}
          <Btn variant="danger" action="staff.deleteConfirm" v={v} icon="trash" iconSize={14}>
            Delete {p.name.split(/\s+/)[0]}
          </Btn>
        </>
      ),
    };
  },

  /* Raising the requisition that hires into a particular seat. */
  'pos.openReq': async (v, ctx) => {
    const [p] = await db().select().from(positions).where(eq(positions.id, v)).limit(1);
    if (!p) return null;
    const sheet = (await import('./registry')).lookupSheet('job.new');
    return sheet ? sheet(p.code, ctx) : null;
  },
});
