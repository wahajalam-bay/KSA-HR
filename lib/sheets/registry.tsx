import 'server-only';
import type * as React from 'react';
import type { Viewer } from '@/lib/auth/session';
import type { Route } from '@/lib/nav';

/* ═════════════════════════════════════════════════════════════════════════════
   SHEETS

   A sheet is the right-hand panel on a desktop and the bottom sheet on a phone:
   the requisition editor, the candidate panel, the offer letter, the approval
   chain, the seat, the probation review. In the prototype they were built as
   strings by whichever module owned them.

   Here each one is a server component rendered on demand, which means a sheet
   reads the database exactly as a page does, and is subject to the same
   authorization — so an account that may not open a requisition cannot reach
   its editor by firing the action by hand either.
   ═════════════════════════════════════════════════════════════════════════════*/

export type SheetSpec = {
  title: React.ReactNode;
  /** The small line above the title — usually what the sheet belongs to. */
  eyebrow?: React.ReactNode;
  sub?: React.ReactNode;
  body: React.ReactNode;
  /** The action bar at the bottom; the primary action sits on the right. */
  foot?: React.ReactNode;
  /** Buttons beside the close control. */
  actions?: React.ReactNode;
  wide?: boolean;
  full?: boolean;
  /** For screen readers, when the title is not enough on its own. */
  aria?: string;
};

export type SheetContext = {
  viewer: Viewer;
  route: Route;
  /** Extra values the interface collected before opening — a filter typed into
      a sheet that re-renders itself, for instance. */
  fields: Record<string, string>;
  /** Whatever the button wrote after the colon in its action, if anything —
      `tab` in `drawer.open:tab`'s sibling forms. See `splitAction`. */
  arg?: string | null;
};

export type SheetFn = (v: string, ctx: SheetContext) => Promise<SheetSpec | null>;

const registry = new Map<string, SheetFn>();

export function defineSheet(name: string, fn: SheetFn): void {
  if (registry.has(name)) throw new Error(`sheet "${name}" is defined twice`);
  registry.set(name, fn);
}

export function defineSheets(sheets: Record<string, SheetFn>): void {
  for (const [name, fn] of Object.entries(sheets)) defineSheet(name, fn);
}

export function lookupSheet(name: string): SheetFn | undefined {
  return registry.get(name);
}

export function sheetNames(): string[] {
  return [...registry.keys()].sort();
}
