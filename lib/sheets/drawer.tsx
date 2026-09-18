import 'server-only';
import * as React from 'react';
import { defineSheets } from './registry';
import { drawer, type DrawerData } from '@/lib/queries/drawer';
import { requestNow } from '@/lib/clock';
import { can } from '@/lib/authz';
import {
  Subnav, Btn, Empty, Chip, StagePill, StatusChip, Li,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { STAGE_INDEX } from '@/lib/domain/stages';
import {
  DRAWER_TABS, HeadStrip, ProfileTab, ResumeTab, ResumeDoc, ScreeningTab, ReachTab,
  EvalsTab, NotesTab, TimelineTab, OfferTab,
} from '@/components/drawer/panel';

/* ─────────────────────────────────────────────────────────────────────────────
   The candidate panel, as a sheet.

   Four ways in, one panel: by application from a board or a list, by candidate
   from search or a pool, by a sibling application from the cross-pipeline
   banner. The tab and the full-screen state ride in the value after a colon,
   so the panel can be reopened exactly as it was without any client state.

     drawer.open   <applicationId>[:tab][:full]
     drawer.cand   <candidateId>[:tab][:full]
     drawer.app    <applicationId>[:tab][:full]
     drawer.cross  <candidateId>

   Full screen puts the CV beside whatever tab is open, so nobody has to
   download a file to read it while they work through the profile, the
   scorecards or the offer.
   ───────────────────────────────────────────────────────────────────────────*/

type Parsed = { id: string; tab: string; full: boolean };

function parse(v: string): Parsed {
  const [id = '', tab = 'profile', flag = ''] = v.split(':');
  return { id, tab: tab || 'profile', full: flag === 'full' };
}

const value = (id: string, tab: string, full: boolean) =>
  `${id}:${tab}${full ? ':full' : ''}`;

function body(d: DrawerData, p: Parsed, now: Date, me: string): React.ReactNode {
  const tabs = DRAWER_TABS(d);
  const tab = tabs.some((t) => t.v === p.tab) ? p.tab : 'profile';
  const which = (
    tab === 'resume' ? <ResumeTab d={d} now={now} />
      : tab === 'screen' ? <ScreeningTab d={d} now={now} />
        : tab === 'reach' ? <ReachTab d={d} now={now} />
          : tab === 'evals' ? <EvalsTab d={d} now={now} me={me} />
            : tab === 'notes' ? <NotesTab d={d} now={now} me={me} />
              : tab === 'offer' ? <OfferTab d={d} now={now} />
                : tab === 'timeline' ? <TimelineTab d={d} now={now} />
                  : <ProfileTab d={d} now={now} />
  );

  /* The tab action carries the record and the full-screen state with it, so
     moving between tabs never loses either. */
  const base = d.application?.id ?? d.candidate.id;
  const kind = d.application ? 'drawer.open' : 'drawer.cand';

  return (
    <>
      <HeadStrip d={d} now={now} />
      <Subnav action={`${kind}:tab`} active={tab}
        tabs={tabs.map((t) => ({ ...t, v: value(base, t.v, p.full) }))} />
      {p.full
        ? (
          <div className="dsplit">
            <div id="dbody">{which}</div>
            <aside className="dcv">
              <div className="dcv-h">
                <span className="ic"><Icon name="file" size={14} /></span>
                <span className="bd">
                  <b>{d.resume?.fileName ?? 'No résumé on file'}</b>
                  <span>
                    {d.resume
                      ? `${d.resume.sizeKb ? `${d.resume.sizeKb} KB` : ''}${d.resume.pages ? ` · ${d.resume.pages} page${d.resume.pages > 1 ? 's' : ''}` : ''}`
                      : 'Upload one and it is parsed on the way in.'}
                  </span>
                </span>
                <Btn size="xs" variant="ghost" icon="ext" iconSize={12}
                  action={`${kind}`} v={value(base, 'resume', p.full)}
                  title="Open the résumé tab" />
              </div>
              <div className="dcv-b"><ResumeDoc d={d} /></div>
            </aside>
          </div>
        )
        : <div id="dbody">{which}</div>}
    </>
  );
}

function foot(d: DrawerData, mayMove: boolean): React.ReactNode {
  const app = d.application;
  if (!app || !['active', 'on_hold'].includes(app.status) || !mayMove) return null;
  return (
    <>
      <Btn variant="out" action="app.reject" v={app.id} icon="x" iconSize={14}>Disqualify</Btn>
      <span className="sp" />
      <Btn variant="ghost" action="app.move" v={app.id}>Move to…</Btn>
      <Btn variant="pri" action="app.advance" v={app.id}>
        {d.nextStage ? `Advance to ${d.nextStage.name}` : 'Mark joined'}
      </Btn>
    </>
  );
}

async function panel(v: string, viewer: Parameters<Parameters<typeof defineSheets>[0][string]>[1]['viewer'], byCandidate: boolean) {
  const p = parse(v);
  if (!p.id) return null;
  const now = await requestNow();
  const d = await drawer(viewer, byCandidate ? { candidateId: p.id } : { applicationId: p.id }, now);
  if (!d) return null;

  const base = d.application?.id ?? d.candidate.id;
  const kind = d.application ? 'drawer.open' : 'drawer.cand';
  const mayMove = can(viewer, 'application.move');

  return {
    wide: true,
    full: p.full,
    aria: d.candidate.name,
    eyebrow: d.application ? d.application.jobTitle : 'Talent pool',
    title: d.candidate.name,
    sub: [d.candidate.headline, d.candidate.locationCity].filter(Boolean).join(' · '),
    actions: (
      <>
        {d.application && can(viewer, 'comment.write') && (
          <>
            <Btn variant="ghost" icon="mail" action="app.email" v={d.application.id} title="Email" />
            <Btn variant="ghost" icon="clock" action="app.hold" v={d.application.id}
              title={d.application.status === 'on_hold' ? 'Take off hold' : 'Put on hold'} />
          </>
        )}
        <Btn variant="ghost" icon={p.full ? 'shrink' : 'expand'}
          action={kind} v={value(base, p.tab, !p.full)}
          title={p.full ? 'Leave full screen' : 'Full screen — read the CV beside the profile'}
          ariaLabel="Full screen" />
      </>
    ),
    body: body(d, p, now, viewer.name),
    foot: foot(d, mayMove),
  };
}

defineSheets({
  'drawer.open': async (v, { viewer }) => panel(v, viewer, false),
  'drawer.app': async (v, { viewer }) => panel(v, viewer, false),
  'drawer.cand': async (v, { viewer }) => panel(v, viewer, true),

  /* The same person, everywhere they are in play. */
  'drawer.cross': async (v, { viewer }) => {
    const p = parse(v);
    if (!p.id) return null;
    const now = await requestNow();
    const d = await drawer(viewer, { candidateId: p.id }, now);
    if (!d) return null;
    return {
      title: d.candidate.name,
      eyebrow: 'Every pipeline',
      sub: `${d.applications.length} application${d.applications.length === 1 ? '' : 's'} across the company.`,
      aria: `${d.candidate.name} — every pipeline`,
      body: d.applications.length ? (
        <div className="list flush">
          {d.applications.map((a) => (
            <Li key={a.id} icon="brief" title={a.jobTitle}
              sub={`${a.deptName} · applied ${new Date(a.appliedAt).toISOString().slice(0, 10)}`}
              right={
                <>
                  <StagePill name={a.stageName} ordinal={STAGE_INDEX[a.stage] ?? 0} />
                  <StatusChip status={a.status} />
                </>
              }
              action="drawer.app" v={a.id} />
          ))}
        </div>
      ) : <Empty icon="brief" title="No applications" sub="This person sits in the talent pool only." />,
    };
  },

  /* Moving between tabs re-renders the panel in place. */
  'drawer.open:tab': async (v, { viewer }) => panel(v, viewer, false),
  'drawer.cand:tab': async (v, { viewer }) => panel(v, viewer, true),
});
