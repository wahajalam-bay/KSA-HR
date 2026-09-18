/* ─────────────────────────────────────────────────────────────────────────────
   How a requisition gets filled.

   Three routes, picked when the requisition is opened and changed whenever:

     Internal hiring   Bayut people first — the internal board and referrals
                       from the team. Nothing leaves the company.
     Private hunting   not advertised anywhere. The desk goes and finds people:
                       outbound sourcing, an agency brief, the talent pool. A
                       requisition running only this is confidential and cannot
                       be posted by accident.
     LinkedIn          published on the Bayut company page and open to
                       everybody; the careers site and the boards ride with it.

   More than one can be on at once, which is what a desk actually does: internal
   first, LinkedIn a fortnight later if nobody inside bites. Whatever the route,
   everyone who applies lands on the same board — the route is a label on the
   card and a filter above it, never a separate pipeline.
   ───────────────────────────────────────────────────────────────────────────*/

export type RouteKey = 'internal' | 'hunt' | 'linkedin';

export type RouteMeta = {
  key: RouteKey;
  name: string;
  icon: string;
  blurb: string;
  sources: string[];
};

export const ROUTES: RouteMeta[] = [
  {
    key: 'internal', name: 'Internal hiring', icon: 'users',
    blurb: 'Bayut people first — the internal board and referrals from the team.',
    sources: ['Internal Mobility', 'Referral'],
  },
  {
    key: 'hunt', name: 'Private hunting', icon: 'search',
    blurb: 'Not advertised anywhere. The desk goes and finds them — outbound, an agency brief, the talent pool.',
    sources: ['Sourced — Outbound', 'Agency', 'Talent Pool'],
  },
  {
    key: 'linkedin', name: 'LinkedIn company page', icon: 'ext',
    blurb: 'Published on the Bayut page and open to everybody; the careers site and the boards ride with it.',
    sources: ['LinkedIn', 'Bayut Careers', 'Bayt.com', 'Job Fair'],
  },
];

export const ROUTE_KEYS: RouteKey[] = ROUTES.map((r) => r.key);

export const routeMeta = (k: string): RouteMeta =>
  ROUTES.find((r) => r.key === k) ?? { key: k as RouteKey, name: k, icon: 'dots', blurb: '', sources: [] };

/** Which route an application arrived by, from the source it carries. */
export function routeOfSource(source: string | null | undefined): RouteKey {
  const r = ROUTES.find((x) => x.sources.includes(String(source)));
  return r ? r.key : 'linkedin';
}

export type Sourcing = { internal: boolean; hunt: boolean; linkedin: boolean; note?: string | null };

export const routesOf = (s: Sourcing): RouteKey[] => ROUTE_KEYS.filter((k) => s[k]);

/** A requisition nobody is allowed to advertise. */
export const isConfidential = (s: Sourcing): boolean => {
  const rs = routesOf(s);
  return rs.length === 1 && rs[0] === 'hunt';
};

export const sourcingLabel = (s: Sourcing): string =>
  routesOf(s).map((k) => routeMeta(k).name).join(' · ');

/** The line under the block, which changes as the ticks change. */
export function sourcingNote(routes: RouteKey[]): { tone: 'bad' | 'info' | 'ok'; text: string } {
  if (!routes.length) {
    return { tone: 'bad', text: 'Pick at least one — a requisition nobody is filling is not a requisition.' };
  }
  if (routes.length === 1 && routes[0] === 'hunt') {
    return {
      tone: 'info',
      text: 'Confidential: this requisition is not advertised anywhere. It is marked on the board and cannot be posted to LinkedIn.',
    };
  }
  const sources = routes.flatMap((k) => routeMeta(k).sources);
  const list = sources.length < 2 ? sources[0] ?? '' : `${sources.slice(0, -1).join(', ')} and ${sources[sources.length - 1]}`;
  return { tone: 'ok', text: `Candidates will arrive from ${list}.` };
}

/** The channels a requisition is published to when LinkedIn is on. */
export const PUBLISH_CHANNELS = ['LinkedIn', 'Bayut Careers', 'Bayt.com', 'Indeed'] as const;
