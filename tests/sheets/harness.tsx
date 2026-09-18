import * as React from 'react';
import { lookupSheet, sheetNames, type SheetSpec } from '@/lib/sheets/registry';
import type { Viewer } from '@/lib/auth/session';
import type { Route } from '@/lib/nav';
import '@/lib/sheets';   // registers every sheet

/* ═════════════════════════════════════════════════════════════════════════════
   DRAWING A SHEET IN A TEST

   A sheet is a server component, and half of what it does happens in children
   that are themselves async — the department picker reads the departments, the
   workflow block reads the spine, the joiner form reads what the joiner filled
   in. Calling the sheet function alone would run the query at the top and none
   of those, which is exactly where a column that has been renamed hides.

   So this walks the tree the sheet returns and awaits every component in it,
   the way the framework does when it serialises the payload. It is not a
   renderer — nothing here cares what the HTML looks like, and the parity
   screenshots cover that — it is a way of making every query in a panel
   actually run against the real database, and of being able to ask what is in
   the tree afterwards.
   ═════════════════════════════════════════════════════════════════════════════*/

export { sheetNames };

const isPromise = (x: unknown): x is Promise<unknown> =>
  !!x && typeof (x as { then?: unknown }).then === 'function';

/* A client component. With a bundler the framework turns a `'use client'`
   module into a reference and never calls it; here there is no bundler, so
   the import is the function itself and calling it would run hooks this
   runtime does not have. The component says what it is with a static flag —
   the same convention as `Btn.isControl` — and the walk honours it. */
const CLIENT_REFERENCE = Symbol.for('react.client.reference');
const isClientReference = (t: unknown): boolean => {
  if (!t || (typeof t !== 'function' && typeof t !== 'object')) return false;
  const c = t as { $$typeof?: symbol; isClient?: boolean };
  return c.$$typeof === CLIENT_REFERENCE || c.isClient === true;
};

/* What to call it in the element list. A reference carries the export name. */
const nameOf = (t: unknown): string =>
  String((t as { name?: string; displayName?: string }).displayName
    ?? (t as { name?: string }).name ?? 'client-component');

/** One host element the walk went through, flattened for assertions. */
export type Node = {
  tag: string;
  props: Record<string, unknown>;
  /** The text this element contains, its own and its descendants'. */
  text: string;
  /** Inside a <label> that wraps it — which is what names it, with no `for`. */
  inLabel: boolean;
};

export type Drawn = { text: string; nodes: number; elements: Node[] };

type Acc = { out: string[]; seen: { n: number }; elements: Node[]; label: number };

async function walk(node: React.ReactNode, acc: Acc, into: string[] | null): Promise<void> {
  const push = (s: string) => { acc.out.push(s); into?.push(s); };

  if (node == null || node === false || node === true) return;
  if (typeof node === 'string' || typeof node === 'number') {
    push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) await walk(child, acc, into);
    return;
  }
  if (isPromise(node)) {
    await walk((await node) as React.ReactNode, acc, into);
    return;
  }
  if (!React.isValidElement(node)) return;

  acc.seen.n += 1;
  const el = node as React.ReactElement<Record<string, unknown>>;
  const type = el.type;

  /* A component is called; a host element is descended into. A class component
     would need instantiating, and the product has none.

     A client component is neither: under `--conditions=react-server` its
     module resolves to a reference rather than the function, and calling it
     would run hooks that do not exist in this runtime. The framework does not
     call it either — it serialises the reference and the browser renders it —
     so the walk stops here too, and records it as the leaf it is. Its props
     still go into the element list, which is what the wiring and
     accessibility assertions read. */
  if (isClientReference(type)) {
    acc.elements.push({
      tag: nameOf(type),
      props: el.props as Record<string, unknown>,
      text: '',
      inLabel: acc.label > 0,
    });
    return;
  }
  if (typeof type === 'function') {
    const rendered = (type as (p: unknown) => unknown)(el.props);
    await walk((isPromise(rendered) ? await rendered : rendered) as React.ReactNode, acc, into);
    return;
  }
  if (typeof type === 'symbol' || typeof type === 'object') {
    /* Fragments, and anything else whose children are the whole story. */
    await walk(el.props.children as React.ReactNode, acc, into);
    return;
  }

  /* A host element. Its own text is collected separately so an assertion can
     ask what a button says without walking the tree again. */
  const mine: string[] = [];
  for (const k of ['title', 'placeholder', 'aria-label', 'alt', 'value']) {
    const v = el.props[k];
    if (typeof v === 'string' && v) push(v);
  }

  const wrapping = type === 'label' && !el.props.htmlFor;
  if (wrapping) acc.label += 1;
  const inLabel = acc.label > (wrapping ? 1 : 0);
  await walk(el.props.children as React.ReactNode, acc, mine);
  if (wrapping) acc.label -= 1;

  for (const s of mine) { acc.out.push(s); into?.push(s); }

  acc.elements.push({
    tag: type,
    props: el.props as Record<string, unknown>,
    text: mine.join(' ').replace(/\s+/g, ' ').trim(),
    inLabel,
  });
}

/** Draw one sheet fully, awaiting every async component inside it. */
export async function draw(
  name: string, v: string, viewer: Viewer,
  opts: { route?: Route; fields?: Record<string, string> } = {},
): Promise<{ spec: SheetSpec | null; drawn: Drawn }> {
  const fn = lookupSheet(name);
  if (!fn) throw new Error(`no such sheet: ${name}`);
  const spec = await fn(v, {
    viewer,
    route: opts.route ?? { view: 'jobs', id: null, sub: null, query: {} },
    fields: opts.fields ?? {},
  });
  if (!spec) return { spec: null, drawn: { text: '', nodes: 0, elements: [] } };

  const acc: Acc = { out: [], seen: { n: 0 }, elements: [], label: 0 };
  for (const part of [spec.title, spec.eyebrow, spec.sub, spec.body, spec.foot, spec.actions]) {
    await walk(part as React.ReactNode, acc, null);
  }
  return {
    spec,
    drawn: { text: acc.out.join(' '), nodes: acc.seen.n, elements: acc.elements },
  };
}

/** What a screen reader would announce for an element, or '' if nothing. */
export function accessibleName(n: Node): string {
  const p = n.props;
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).trim() : '');
  return s('aria-label') || n.text || s('title') || s('alt') || s('value')
    || s('placeholder') || '';
}
