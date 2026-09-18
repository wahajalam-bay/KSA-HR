import * as React from 'react';
import { Icon } from '@/components/ui/icons';
import { fmt } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   WHAT A CHART FILTERED THIS PAGE BY

   When a mark on a chart sends somebody here, the page has to say so. Otherwise
   a list of eleven people is just a list of eleven people, and nobody can tell
   whether it is the eleven they clicked or eleven the page happened to show.

   Each chip names one filter and clears exactly that one. Clearing is a link to
   the same page without that parameter, which means Back still works, the URL
   still describes the view, and nothing here needs to be a client component.
   ───────────────────────────────────────────────────────────────────────────*/

export type ChipDef = { key: string; label: string; value: string };

export function DrillChips({ sp, path, chips, sub }: {
  sp: Record<string, string>;
  path: string;
  chips: ChipDef[];
  /* What the filtered set is, in words — shown once, before the chips. */
  sub?: React.ReactNode;
}) {
  if (!chips.length) return null;

  const without = (...drop: string[]) => {
    const parts = Object.entries(sp)
      .filter(([k, v]) => v && !drop.includes(k))
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return parts.length ? `${path}?${parts.join('&')}` : path;
  };

  /* Clearing the period has to take the reading of it with it, and clearing the
     last chip has to leave an ordinary page rather than an empty drill. */
  const SPAN = ['from', 'to', 'fromAt', 'toAt', 'after', 'win'];
  const alsoDrop = (k: string) => (SPAN.includes(k) ? SPAN : [k]);
  const all = chips.flatMap((c) => alsoDrop(c.key));

  return (
    <div className="cfilters">
      <span className="t-over">From the chart</span>
      {chips.map((c) => (
        <span className="cfilter" key={c.key}>
          {c.label} <b>{c.value}</b>
          <a href={without(...alsoDrop(c.key))} aria-label={`Clear ${c.label} ${c.value}`}>
            <Icon name="x" size={11} sw={2.4} />
          </a>
        </span>
      ))}
      {chips.length > 1 && (
        <a className="btn xs ghost" href={without(...all, 'apps')}>Clear all</a>
      )}
      {sub && <span className="t-foot mut" style={{ flexBasis: '100%' }}>{sub}</span>}
    </div>
  );
}

/* The chips a requisition filter comes to. */
export function jobChips(sp: Record<string, string>, names: {
  dept?: (id: string) => string;
  owner?: (id: string) => string;
}): ChipDef[] {
  const out: ChipDef[] = [];
  if (sp.dept) out.push({ key: 'dept', label: 'Department', value: names.dept?.(sp.dept) ?? sp.dept });
  if (sp.owner) out.push({ key: 'owner', label: 'Recruiter', value: names.owner?.(sp.owner) ?? sp.owner });
  return out;
}

/* The chips an interview filter comes to.

   These matter more than most: a span given in instants has no control on the
   page showing it, so without a chip the agenda would silently be holding a
   window nobody can see or clear. */
export function interviewChips(sp: Record<string, string>): ChipDef[] {
  const out: ChipDef[] = [];
  const stamp = (iso: string) => `${fmt.dateShort(iso)} ${fmt.time(iso)}`;
  const a = sp.after || sp.fromAt;
  if (a && sp.toAt) {
    out.push({ key: sp.after ? 'after' : 'fromAt', label: 'Between', value: `${stamp(a)} and ${stamp(sp.toAt)}` });
  } else if (a) {
    out.push({ key: sp.after ? 'after' : 'fromAt', label: 'From', value: stamp(a) });
  } else if (sp.toAt) {
    out.push({ key: 'toAt', label: 'Up to', value: stamp(sp.toAt) });
  }
  if (sp.panel) out.push({ key: 'panel', label: 'On the panel', value: sp.panel });
  return out;
}

/* The chips a set of application filters comes to. Names are resolved by the
   page, which is the only thing that knows what a stage or a department is
   called; anything it cannot name is shown as it was given rather than hidden,
   because a filter nobody can see is a filter nobody can clear. */
export function appChips(sp: Record<string, string>, names: {
  stage?: (key: string) => string;
  dept?: (id: string) => string;
  job?: (id: string) => string;
  staff?: (id: string) => string;
}): ChipDef[] {
  const out: ChipDef[] = [];
  const list = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

  const period = sp.win === 'closed' ? 'Closed'
    : sp.win === 'inplay' ? 'In play'
      : sp.win === 'touched' ? 'In the period' : 'Applied';
  if (sp.from && sp.to) {
    out.push({
      key: 'from', label: period,
      value: `${fmt.dateShort(sp.from)} – ${fmt.dateShort(sp.to)}`,
    });
  } else if (sp.fromAt && sp.toAt) {
    out.push({
      key: 'fromAt', label: period,
      value: `${fmt.dateShort(sp.fromAt)} – ${fmt.dateShort(sp.toAt)}`,
    });
  }
  const stages = list(sp.stage);
  if (stages.length) {
    out.push({
      key: 'stage',
      label: sp.win === 'inplay' ? 'Reached by then' : 'Stage',
      value: stages.map((s) => names.stage?.(s) ?? s).join(', '),
    });
  }
  if (sp.reached) {
    out.push({ key: 'reached', label: 'Reached', value: names.stage?.(sp.reached) ?? sp.reached });
  }
  const srcs = list(sp.src);
  if (srcs.length === 1) out.push({ key: 'src', label: 'Source', value: srcs[0] });
  else if (srcs.length > 1) {
    out.push({ key: 'src', label: 'Channels', value: `${srcs.length} of them` });
  }
  const depts = list(sp.dept);
  if (depts.length === 1) {
    out.push({ key: 'dept', label: 'Department', value: names.dept?.(depts[0]) ?? depts[0] });
  } else if (depts.length > 1) {
    /* A mark that groups the tail of a ranking stands for several departments
       at once. Naming each would be a chip nobody can read; the count is what
       the mark itself said. */
    out.push({ key: 'dept', label: 'Departments', value: `${depts.length} of them` });
  }
  if (sp.job) out.push({ key: 'job', label: 'Requisition', value: names.job?.(sp.job) ?? sp.job });
  if (sp.by) out.push({ key: 'by', label: 'Owned or sourced by', value: names.staff?.(sp.by) ?? sp.by });
  if (sp.over === '1') out.push({ key: 'over', label: 'Past', value: 'their stage SLA' });
  const st = list(sp.status);
  if (st.length) out.push({ key: 'status', label: 'Status', value: st.join(', ') });
  return out;
}
