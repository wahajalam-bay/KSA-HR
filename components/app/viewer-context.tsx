'use client';

import * as React from 'react';
import type { Viewer } from '@/lib/auth/session';
import type { NavCounts } from '@/lib/queries/shell';

/* Who is looking, what their access covers and the counts the shell shows —
   available to any client component below the shell without threading it
   through every page. The server is still the authority on all of it; this is
   for the interface's own decisions, like which control to disable. */

export type ViewerState = {
  viewer: Viewer;
  counts: NavCounts;
  theme: 'system' | 'light' | 'dark';
  orgName: string;
};

const Ctx = React.createContext<ViewerState | null>(null);

export function ViewerProvider({ viewer, counts, theme, orgName, children }: ViewerState & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ viewer, counts, theme, orgName }), [viewer, counts, theme, orgName]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewer(): ViewerState {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useViewer outside the app shell');
  return c;
}
