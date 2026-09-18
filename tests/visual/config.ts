/* ─────────────────────────────────────────────────────────────────────────────
   Visual regression: the prototype is the reference.

   `baseline.ts` drives the single-file prototype in a browser and captures a
   screenshot of every route at six sizes. `compare.ts` drives the production
   application through the same routes at the same sizes and measures the
   difference. The prototype file is never modified; it is the specification,
   and a change in the production interface that nobody asked for shows up as a
   number rather than as an argument.

   Six captures, because the product has three layouts and two themes and all
   six are shipped:

     1440  desktop      light and dark
      900  laptop       light and dark
      390  phone        light and dark
   ───────────────────────────────────────────────────────────────────────────*/

export const VIEWPORTS = [
  { name: '1440', width: 1440, height: 1000, label: 'desktop' },
  { name: '900', width: 900, height: 1000, label: 'laptop' },
  { name: '390', width: 390, height: 844, label: 'phone' },
] as const;

export const THEMES = ['light', 'dark'] as const;

export type Capture = {
  /** Used for the file name and reported in the diff table. */
  id: string;
  /** Where to go in the prototype — its hash route. */
  proto: string;
  /** Where to go in the production application. */
  prod: string;
  /** Anything to do once the route has loaded, before the shot. */
  prepare?: string;
  /** Routes the portal roles cannot reach are captured as the TA team only. */
  as?: 'admin' | 'recruiter' | 'onboarding' | 'hiring_manager';
  /** A tolerance above the default, where a route is genuinely dynamic. */
  tolerance?: number;
};

/* Every route in the product, in the order somebody works through it. */
export const CAPTURES: Capture[] = [
  { id: 'sign-in', proto: '#/', prod: '/sign-in' },
  { id: 'overview', proto: '#/overview', prod: '/overview' },
  { id: 'overview-month', proto: '#/overview?win=30', prod: '/overview?win=30' },
  { id: 'jobs', proto: '#/jobs', prod: '/jobs' },
  { id: 'jobs-approval', proto: '#/jobs?status=pending_approval', prod: '/jobs?status=pending_approval' },
  { id: 'jobs-archive', proto: '#/jobs?status=closed', prod: '/jobs?status=closed' },
  { id: 'job-board', proto: '#/jobs/job_01', prod: '/jobs/job_01' },
  { id: 'job-details', proto: '#/jobs/job_01?tab=details', prod: '/jobs/job_01?tab=details' },
  { id: 'job-people', proto: '#/jobs/job_01?tab=people', prod: '/jobs/job_01?tab=people' },
  { id: 'job-activity', proto: '#/jobs/job_01?tab=activity', prod: '/jobs/job_01?tab=activity' },
  { id: 'job-insights', proto: '#/jobs/job_01?tab=insights', prod: '/jobs/job_01?tab=insights' },
  { id: 'candidates', proto: '#/candidates', prod: '/candidates' },
  { id: 'candidates-pools', proto: '#/candidates?tab=pools', prod: '/candidates?tab=pools' },
  { id: 'scheduling', proto: '#/scheduling', prod: '/scheduling' },
  { id: 'scheduling-tasks', proto: '#/scheduling?tab=tasks', prod: '/scheduling?tab=tasks' },
  { id: 'scheduling-load', proto: '#/scheduling?tab=load', prod: '/scheduling?tab=load' },
  { id: 'scheduling-interviewers', proto: '#/scheduling?tab=interviewers', prod: '/scheduling?tab=interviewers' },
  { id: 'offers', proto: '#/offers', prod: '/offers' },
  { id: 'onboarding', proto: '#/onboarding', prod: '/onboarding' },
  { id: 'onboarding-probation', proto: '#/onboarding?tab=probation', prod: '/onboarding?tab=probation' },
  { id: 'manpower', proto: '#/manpower', prod: '/manpower' },
  { id: 'manpower-positions', proto: '#/manpower?tab=positions', prod: '/manpower?tab=positions' },
  { id: 'manpower-employees', proto: '#/manpower?tab=employees', prod: '/manpower?tab=employees' },
  { id: 'insights', proto: '#/insights', prod: '/insights' },
  { id: 'insights-tat', proto: '#/insights?tab=tat', prod: '/insights?tab=tat' },
  { id: 'insights-recruiters', proto: '#/insights?tab=recruiters', prod: '/insights?tab=recruiters' },
  { id: 'insights-sources', proto: '#/insights?tab=sources', prod: '/insights?tab=sources' },
  { id: 'insights-departments', proto: '#/insights?tab=departments', prod: '/insights?tab=departments' },
  { id: 'insights-offers', proto: '#/insights?tab=offers', prod: '/insights?tab=offers' },
  { id: 'insights-quality', proto: '#/insights?tab=quality', prod: '/insights?tab=quality' },
  { id: 'insights-market', proto: '#/insights?tab=market', prod: '/insights?tab=market' },
  { id: 'insights-budget', proto: '#/insights?tab=budget', prod: '/insights?tab=budget' },
  { id: 'insights-interviewers', proto: '#/insights?tab=interviewers', prod: '/insights?tab=interviewers' },
  { id: 'insights-ask', proto: '#/insights?tab=ask', prod: '/insights?tab=ask' },
  { id: 'team', proto: '#/team', prod: '/team' },
  { id: 'team-profile', proto: '#/team/stf_02', prod: '/team/stf_02' },
  { id: 'settings', proto: '#/settings', prod: '/settings' },
  { id: 'settings-org', proto: '#/settings?tab=org', prod: '/settings?tab=org' },
  { id: 'settings-access', proto: '#/settings?tab=access', prod: '/settings?tab=access' },
  { id: 'settings-approvals', proto: '#/settings?tab=approvals', prod: '/settings?tab=approvals' },
  { id: 'settings-pipelines', proto: '#/settings?tab=pipelines', prod: '/settings?tab=pipelines' },
  { id: 'settings-templates', proto: '#/settings?tab=templates', prod: '/settings?tab=templates' },
  { id: 'settings-teams', proto: '#/settings?tab=teams', prod: '/settings?tab=teams' },
  { id: 'settings-pitch', proto: '#/settings?tab=pitch', prod: '/settings?tab=pitch' },
  { id: 'settings-automations', proto: '#/settings?tab=automations', prod: '/settings?tab=automations' },
  { id: 'settings-integrations', proto: '#/settings?tab=integrations', prod: '/settings?tab=integrations' },
  { id: 'settings-audit', proto: '#/settings?tab=audit', prod: '/settings?tab=audit' },
  { id: 'settings-data', proto: '#/settings?tab=data', prod: '/settings?tab=data' },
  { id: 'my-hiring', proto: '#/my', prod: '/my', as: 'hiring_manager' },
];

/* The share of pixels that may differ before a capture is called a regression.
   Not zero: the two applications draw the same interface from two different
   datasets' worth of live timestamps, and a chart label reading "3w ago" in one
   and "22d ago" in the other is not a visual regression. */
export const DEFAULT_TOLERANCE = 0.02;

/* Anything that genuinely cannot match pixel for pixel, with the reason. These
   are read out in the test report rather than hidden. */
export const KNOWN_DIFFERENCES: Record<string, string> = {
  'sign-in': 'The production screen adds the single sign-on option and drops the prototype-account list.',
  'settings-integrations': 'Production reports each provider as configured or not; the prototype showed a fixed list as connected.',
  'settings-data': 'Production prints the real collection sizes from the database.',
  /* The prototype ships a rule — "Acknowledge every application within five
     minutes" — that points at a template called application_received, and the
     prototype has no such template: the rule would send nothing. Production
     creates it (migration 0012), so the e-mail template list is one row longer
     and everything below it moves down by that row's height. */
  'settings-templates': 'Production carries the acknowledgement template the shipped automation rule '
    + 'refers to; the prototype’s rule pointed at a template that did not exist, so its list is one row shorter.',
  'settings-audit': 'Production shows real audit entries, including the ones this test run just wrote.',
  'settings-automations': 'Each rule prints the event the engine actually raises — requisition.approved '
    + 'rather than the prototype’s job.opened — and the longer name wraps one line further at 900 and below.',
  /* 89 of the prototype's 959 closed applications carry a close stamped before
     their last stage hop — one of them by seven months. The prototype simply
     drops the resulting negative dwell and shows the close wherever its date
     falls; production cannot store a record that closed before it last moved,
     so the seeder moves the close to the last hop and says how many it moved.
     Two places show the difference: a close that was months old now falls
     inside the activity window, and the last spell that the prototype dropped
     is counted as a same-day one. */
  'job-activity': 'Production moves a close stamped before the last stage hop onto that hop, so '
    + 'closes the prototype dated months earlier fall inside the 200-day feed.',
  'team-profile': 'Production moves a close stamped before the last stage hop onto that hop, so the '
    + 'last spell the prototype drops as negative is counted, and each stage reads a few applications higher.',
};
