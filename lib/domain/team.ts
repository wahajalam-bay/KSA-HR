/* ─────────────────────────────────────────────────────────────────────────────
   The desk: who is on it, and what each role is measured on.

   Two of the six roles own applications and carry a hiring target; the other
   four do not, and reading them against hires would say they do nothing. A
   sourcer is measured on the applications they brought in, a coordinator on the
   interviews they set, an onboarding specialist on the offer letters they
   checked, an analyst on the scorecards they wrote. This module holds that
   split so that the query, the card and the profile all read it the same way.
   ───────────────────────────────────────────────────────────────────────────*/

export type RoleKey = 'recruiter' | 'sourcer' | 'coordinator' | 'analyst' | 'onboarding' | 'tal_lead';

export type RoleDef = {
  v: RoleKey;
  /** The short word used in a chip, a filter and a crumb. */
  t: string;
  /** The job title the organisation gives the role. */
  label: string;
  tone: '' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'violet' | 'gold';
};

export const TEAM_ROLES: RoleDef[] = [
  { v: 'recruiter', t: 'Recruiter', label: 'Recruiter', tone: 'ok' },
  { v: 'sourcer', t: 'Sourcer', label: 'Sourcer', tone: 'violet' },
  { v: 'coordinator', t: 'Coordinator', label: 'Coordinator', tone: 'info' },
  { v: 'analyst', t: 'Analyst', label: 'Analyst', tone: 'gold' },
  { v: 'onboarding', t: 'Onboarding', label: 'Onboarding Specialist', tone: 'ok' },
  { v: 'tal_lead', t: 'TA lead', label: 'Admin', tone: 'brand' },
];

/** The roles that own applications, and so carry a hiring target. */
export const HIRING_ROLES: RoleKey[] = ['recruiter', 'tal_lead'];

export const roleDef = (p: { role: string; roleLabel?: string | null }): RoleDef =>
  TEAM_ROLES.find((x) => x.v === p.role)
  ?? { v: p.role as RoleKey, t: p.roleLabel || p.role, label: p.roleLabel || p.role, tone: '' };

export const carriesTarget = (p: { role: string }): boolean =>
  HIRING_ROLES.includes(p.role as RoleKey);

/* Hire counts are whole numbers, so an axis tick that lands between two of them
   is left unlabelled rather than rounded into a duplicate. */
export const axisInt = (n: number): string =>
  (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : '');
