'use server';

import * as React from 'react';
import { requireViewer, AuthError, ForbiddenError } from '@/lib/auth/session';
import { lookupSheet } from '@/lib/sheets/registry';
import type { Route } from '@/lib/nav';
import { log } from '@/lib/log';
import '@/lib/sheets';   // registers every sheet

/* A sheet's content, rendered on the server and handed back as a React tree.
   The panel that shows it knows nothing about what is inside — which is what
   lets the candidate panel, the requisition editor and the probation review all
   be one mechanism. */
export type SheetPayload = {
  ok: true;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  sub?: React.ReactNode;
  body: React.ReactNode;
  foot?: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
  full?: boolean;
  aria?: string;
} | { ok: false; error: string };

export async function renderSheet(
  name: string,
  v: string,
  route: Route,
  fields: Record<string, string> = {},
  arg: string | null = null,
): Promise<SheetPayload> {
  try {
    const viewer = await requireViewer();
    /* The whole name first, then the base — the same rule the command
       dispatcher follows, so `drawer.open:tab` keeps meaning one thing. */
    let fn = lookupSheet(name);
    let carried = arg;
    if (!fn && name.includes(':')) {
      const base = name.slice(0, name.indexOf(':'));
      fn = lookupSheet(base);
      if (fn) carried = carried ?? name.slice(name.indexOf(':') + 1);
    }
    if (!fn) {
      log.warn('sheet.unknown', { name });
      return { ok: false, error: `That panel is not available (${name})` };
    }
    const spec = await fn(v, { viewer, route, fields, arg: carried });
    if (!spec) return { ok: false, error: 'That record no longer exists' };
    return { ok: true, ...spec };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: 'Your session has ended — sign in again' };
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    log.error('sheet.failed', { name, error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'That panel could not be drawn' };
  }
}
