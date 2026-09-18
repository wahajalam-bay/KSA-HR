import * as React from 'react';
import { listCandidates } from '@/lib/queries/candidates';
import { listJobs } from '@/lib/queries/jobs';
import { teamList } from '@/lib/queries/team';
import { agenda } from '@/lib/queries/scheduling';
import { appFiltersFrom } from '@/lib/charts/drill';
import { drawTree, type Node } from '../sheets/harness';
import { viewer } from '../commands/harness';
import { ok, eq as equals } from '../run';
import type { Viewer } from '@/lib/auth/session';
import type { Window } from '@/lib/domain/window';
import type { Pick } from '@/lib/charts/interaction';


/* ═════════════════════════════════════════════════════════════════════════════
   A CHART AND ITS DRILL-DOWN ARE ONE NUMBER READ TWICE

   A bar says 66. Clicking it opens a list. If that list says 71, the product
   has lied to somebody — and it will have lied quietly, in a review, to the
   person least able to check it.

   The two numbers come from different queries by necessity: one aggregates,
   the other lists, and they are written months apart in different files. So
   this suite takes each Overview chart, reads the marks it actually drew,
   follows the URL each mark carries, runs the query that URL asks for, and
   insists the count comes back the same.

   It runs under more than one scope on purpose. `jobScopeSql` collapses to
   `true` for every desk account, so a drill-down that leaks past somebody's
   access is invisible to everyone who builds the product and obvious to the
   one hiring manager it exposes.
   ═════════════════════════════════════════════════════════════════════════════*/

export const NOW = new Date('2026-09-18T09:00:00.000Z');
export const WINDOW: Window = { kind: 'preset', days: 90 };

export const all: Viewer = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin',
  isAdmin: true, staffId: 'stf_01',
  scope: { kind: 'all', jobIds: [], own: false },
});

export const picked: Viewer = viewer({
  name: 'Taif Alshaikhi', staffRole: 'recruiter', staffId: 'stf_04',
  scope: { kind: 'jobs', jobIds: ['job_01', 'job_02'], own: false },
});

/* ── Reading a chart back ─────────────────────────────────────────────────────
   The chart primitives are client components, so the walk stops at them and
   hands over their props. That is the honest place to read a mark from: it is
   what the browser will be given, values and picks together, rather than a
   restatement of what the card meant to pass. */

export type Mark = { label: string; value: number; pick: Pick | null };

const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x ?? 0));

export function marksOf(elements: Node[], tag: string, read: (p: any) => Array<{ label: string; value: number }>): Mark[] {
  const el = elements.find((n) => n.tag === tag);
  if (!el) return [];
  const p = el.props as any;
  const picks = (p.picks ?? []) as Array<Pick | null>;
  return read(p).map((d, i) => ({ ...d, pick: picks[i] ?? null }));
}

/** The same, for a primitive whose marks form a grid. */
export function marksOf2(
  elements: Node[], tag: string,
  read: (p: any) => Array<Array<{ label: string; value: number }>>,
): Mark[] {
  const el = elements.find((n) => n.tag === tag);
  if (!el) return [];
  const p = el.props as any;
  const picks = (p.picks ?? []) as Array<Array<Pick | null> | undefined>;
  return read(p).flatMap((row, a) =>
    row.map((d, b) => ({ ...d, pick: picks[a]?.[b] ?? null })));
}

/** Every mark a card drew, whichever primitive it drew them with. */
export async function marks(node: React.ReactElement): Promise<Mark[]> {
  const { elements } = await drawTree(node);
  return [
    ...marksOf(elements, 'Bars', (p) =>
      (p.data ?? []).map((d: any) => ({ label: String(d.label), value: num(d.value) }))),
    ...marksOf(elements, 'HBars', (p) =>
      (p.data ?? []).map((d: any) => ({ label: String(d.label), value: num(d.value) }))),
    ...marksOf(elements, 'Funnel', (p) =>
      (p.rows ?? []).map((r: any) => ({ label: String(r.name), value: num(r.n) }))),
    ...marksOf(elements, 'Disc3d', (p) =>
      (p.segments ?? []).map((s: any) => ({ label: String(s.label), value: num(s.value) }))),
    ...marksOf(elements, 'Donut', (p) =>
      (p.segments ?? []).map((s: any) => ({ label: String(s.label), value: num(s.value) }))),
    ...marksOf(elements, 'Pie', (p) =>
      (p.segments ?? []).map((s: any) => ({ label: String(s.label), value: num(s.value) }))),
    ...marksOf2(elements, 'Line', (p) =>
      (p.series ?? []).map((se: any) =>
        (se.points ?? []).map((pt: any) => ({
          label: `${se.name} · ${pt.x}`, value: num(pt.y),
        })))),
    ...marksOf2(elements, 'Waves', (p) =>
      (p.series ?? []).map((se: any) =>
        (se.points ?? []).map((pt: any) => ({
          label: `${se.name} · ${pt.x}`, value: num(pt.y),
        })))),
    ...marksOf2(elements, 'Heat', (p) =>
      (p.rows ?? []).map((r: any) =>
        (p.cols ?? []).map((c: any) => ({
          label: `${r.label} · ${c.name}`,
          value: r.values?.[c.key] == null ? 0 : num(r.values[c.key]),
        })))),
    ...marksOf2(elements, 'Grouped', (p) =>
      (p.data ?? []).map((d: any) =>
        (p.keys ?? []).map((k: any) => ({
          label: `${d.label} · ${k.name}`, value: num(d[k.key]),
        })))),
    ...marksOf(elements, 'Stack', (p) =>
      (p.segments ?? []).map((s: any) => ({ label: String(s.label), value: num(s.value) }))),
    /* A ring draws a rate, never a count, so its promise is always explicit. */
    ...marksOf(elements, 'Rings', (p) =>
      (p.items ?? []).map((it: any) => ({ label: String(it.name), value: NaN }))),
  ];
}

/* ── Following one ──────────────────────────────────────────────────────────*/

const paramsOf = (href: string): { path: string; sp: Record<string, string> } => {
  const u = new URL(href, 'http://local');
  return { path: u.pathname, sp: Object.fromEntries(u.searchParams.entries()) };
};

/** How many records the page a mark points at actually finds. */
export async function behind(v: Viewer, href: string): Promise<number> {
  const { path, sp } = paramsOf(href);

  if (path === '/candidates') {
    const tab = (['pipeline', 'all', 'hired'].includes(sp.tab) ? sp.tab : 'pipeline') as
      'pipeline' | 'all' | 'hired';
    const { total } = await listCandidates(v, {
      tab, q: sp.q, family: sp.fam, source: sp.src, ownerId: sp.own,
      held: sp.held, tags: (sp.tags ?? '').split(',').filter(Boolean),
      poolId: sp.pool, sort: sp.sort, limit: 1, ...appFiltersFrom(sp),
    }, NOW);
    return total;
  }

  if (path === '/jobs') {
    /* The bar is openings, not requisitions — so the list's openings are what
       has to add up. */
    const { rows } = await listJobs(v, { status: sp.status, deptId: sp.dept }, NOW);
    return rows.reduce((n, r) => n + num(r.openings), 0);
  }

  if (path === '/scheduling') {
    const { keptTotal } = await agenda(v, {
      range: sp.range, owner: sp.owner, mode: sp.mode,
      after: sp.after, fromAt: sp.fromAt, toAt: sp.toAt, panel: sp.panel,
    }, NOW);
    return keptTotal;
  }

  if (path === '/team') {
    const { people } = await teamList(v, { kind: 'preset', days: 180 }, NOW);
    return people.filter((p) => p.role === sp.role).length;
  }

  throw new Error(`a mark points somewhere this test does not know: ${href}`);
}

/** Every acting mark of a card, checked against what its URL finds. */
export async function reconcile(v: Viewer, card: string, node: React.ReactElement): Promise<number> {
  const ms = await marks(node);
  let checked = 0;
  for (const m of ms) {
    if (!m.pick?.act) continue;
    equals(m.pick.act, 'go', `${card} · ${m.label} · drills through the ordinary nav action`);
    if (m.pick.opens === 'record') {
      /* One record, not a set — there is nothing to count. What is still
         checked is that it says so, and that it goes somewhere real. */
      ok(/^\/[a-z]/.test(m.pick.v ?? ''), `${card} · ${m.label} · points at a route`);
      checked += 1;
      continue;
    }
    const found = await behind(v, m.pick.v!);
    /* A mark that is not itself a count says how many its drill will find. */
    const promised = m.pick.n ?? m.value;
    equals(found, promised,
      `${card} · ${m.label} · the chart promises ${promised}, the list behind it finds ${found}`);
    checked += 1;
  }
  return checked;
}
