import 'server-only';
import { cookies } from 'next/headers';
import { requireViewer, type Viewer } from '@/lib/auth/session';
import { requestNow } from '@/lib/clock';
import { navCounts, type NavCounts } from './shell';

/* What every page needs before it can draw its own top bar: who is looking,
   the counts the bell and the sidebar show, and which theme is on. One call
   rather than three, and one place to change if it becomes four. */
export type Chrome = {
  viewer: Viewer;
  counts: NavCounts;
  theme: 'system' | 'light' | 'dark';
  now: Date;
};

export async function chrome(): Promise<Chrome> {
  const viewer = await requireViewer();
  const now = await requestNow();
  const [counts, jar] = await Promise.all([navCounts(viewer, now), cookies()]);
  return {
    viewer,
    counts,
    theme: (jar.get('bayut_ta_theme')?.value ?? 'system') as Chrome['theme'],
    now,
  };
}

/** Query parameters as a plain object, however Next hands them over. */
export function q(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v[0] ?? '' : v;
  }
  return out;
}
