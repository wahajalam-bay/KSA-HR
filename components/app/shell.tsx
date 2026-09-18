'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/icons';
import { Avatar } from '@/components/ui/primitives';
import { BrandLogo } from '@/components/ui/brand';
import { fmt } from '@/lib/format';
import type { Viewer } from '@/lib/auth/session';
import type { NavCounts } from '@/lib/queries/shell';

/* ─────────────────────────────────────────────────────────────────────────────
   The shell: the sidebar on a desktop, the tab bar on a phone, and the top bar
   that carries the page's own title and actions.

   The navigation is different for the TA team and for somebody who is here
   because they are hiring: a hiring manager or an interview participant lands
   on their own hiring and sees that and their joiners, because everything else
   would be a list of other people's work.
   ───────────────────────────────────────────────────────────────────────────*/

type NavItem = { v: string; t: string; ic: IconName; count?: keyof NavCounts };
type NavGroup = { grp: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  { grp: null, items: [{ v: 'overview', t: 'Overview', ic: 'grid' }] },
  {
    grp: 'Hiring',
    items: [
      { v: 'jobs', t: 'Jobs', ic: 'brief', count: 'openJobs' },
      { v: 'candidates', t: 'Candidates', ic: 'users', count: 'livePipeline' },
      { v: 'scheduling', t: 'Scheduling', ic: 'cal', count: 'upcomingInterviews' },
      { v: 'offers', t: 'Offer stage', ic: 'file', count: 'atOffer' },
      { v: 'onboarding', t: 'Onboarding', ic: 'handshake', count: 'onboarding' },
      { v: 'manpower', t: 'Manpower plan', ic: 'board', count: 'vacantSeats' },
    ],
  },
  {
    grp: 'Measure',
    items: [
      { v: 'insights', t: 'Insights', ic: 'chart' },
      { v: 'team', t: 'Team', ic: 'badge', count: 'teamSize' },
    ],
  },
  { grp: 'Configure', items: [{ v: 'settings', t: 'Settings', ic: 'gear' }] },
];

const NAV_PORTAL: NavGroup[] = [
  {
    grp: null,
    items: [
      { v: 'my', t: 'My hiring', ic: 'grid' },
      { v: 'onboarding', t: 'Onboarding', ic: 'handshake', count: 'onboarding' },
    ],
  },
];

const TABS: NavItem[] = [
  { v: 'overview', t: 'Home', ic: 'grid' },
  { v: 'jobs', t: 'Jobs', ic: 'brief' },
  { v: 'candidates', t: 'People', ic: 'users' },
  { v: 'insights', t: 'Insights', ic: 'chart' },
  { v: 'team', t: 'Team', ic: 'badge' },
];

const TABS_PORTAL: NavItem[] = [
  { v: 'my', t: 'My hiring', ic: 'grid' },
  { v: 'onboarding', t: 'Onboarding', ic: 'handshake' },
];

/* Which section is lit comes from the URL rather than from a prop, so the
   sidebar is rendered once by the layout and does not re-render when a page
   below it changes. */
function useView(): string {
  const pathname = usePathname();
  return pathname.split('/').filter(Boolean)[0] ?? 'overview';
}

export function Sidebar({ viewer, counts, orgName }: {
  viewer: Viewer; counts: NavCounts; orgName: string;
}) {
  const view = useView();
  const nav = viewer.isPortal ? NAV_PORTAL : NAV;
  return (
    <aside className="side" id="side">
      <div className="side-brand">
        {/* The lockup carries the name, so the line under it is the product
            and the entity — not the word "Bayut" a second time. The chip is
            what a collapsed rail shows instead; CSS picks between them. */}
        <span className="logo" aria-hidden="true">
          <BrandLogo variant="compact" on="brand" alt="" height={19} />
        </span>
        <span className="nm">
          {/* The rail is brand green in both themes, so the lockup on it is the
              white artwork in both — the theme-swapped pair is for a card or a
              page, where the ground actually changes. */}
          <BrandLogo variant="full" on="brand" alt={orgName} />
          <span>KSA · Talent Acquisition</span>
        </span>
      </div>

      {!viewer.isPortal && (
        <div className="side-search">
          {/* Collapsed, this is the rail's first icon rather than something
              that disappears — search is how people move around here. */}
          <div className="searchbox" data-act="palette.open" data-tip="Search or jump to…"
            role="button" tabIndex={0} aria-label="Search or jump to">
            <Icon name="search" size={15} />
            <input placeholder="Search or jump to…" readOnly tabIndex={-1} aria-hidden="true" />
            <kbd>⌘K</kbd>
          </div>
        </div>
      )}

      <nav className="nav">
        {nav.map((g, gi) => (
          <div className="nav-grp" key={gi}>
            {g.grp && <div className="t-over">{g.grp}</div>}
            {g.items.map((i) => {
              const n = i.count ? counts[i.count] : null;
              return (
                <button key={i.v} className={`nav-item${view === i.v ? ' on' : ''}`}
                  data-act="go" data-v={`/${i.v}`}
                  /* `data-tip` rather than `title`: the interface draws its own
                     tooltip, and a native one on top of it would be two. The
                     count rides along so a collapsed rail can say "Jobs · 29"
                     where the badge only has room for the number. */
                  data-tip={n != null ? `${i.t} · ${fmt.int(n)}` : i.t}
                  /* Three digits do not fit a badge on a 74-pixel rail, so a
                     big number becomes a dot and the tooltip carries the
                     figure — clean alignment over a squeezed number. */
                  data-count={n == null ? undefined : n > 99 ? 'wide' : 'fits'}
                  aria-current={view === i.v ? 'page' : undefined}>
                  <span className="ic"><Icon name={i.ic} size={17} /></span>
                  <span className="lb">{i.t}</span>
                  {n != null && <span className="cnt">{fmt.int(n)}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="side-foot">
        <button className="userchip" data-act="me.switch"
          data-tip={`${viewer.name} · ${viewer.roleLabel}`}>
          <Avatar person={{ name: viewer.name, photo: viewer.photo, hue: viewer.hue }} size="m" />
          <span className="meta"><b>{viewer.name}</b><span>{viewer.roleLabel}</span></span>
          <span className="chev"><Icon name="chevU" size={14} /></span>
        </button>
      </div>
    </aside>
  );
}

export function TabBar({ isPortal }: { isPortal: boolean }) {
  const view = useView();
  const tabs = isPortal ? TABS_PORTAL : TABS;
  return (
    <nav className="tabbar" id="tabbar">
      {tabs.map((i) => (
        <button key={i.v} className={view === i.v ? 'on' : ''} data-act="go" data-v={`/${i.v}`}>
          <Icon name={i.ic} size={21} />
          <span>{i.t}</span>
        </button>
      ))}
    </nav>
  );
}

export function TopBar({
  title, sub, crumb, actions, unread, viewer, theme,
}: {
  title: React.ReactNode; sub?: React.ReactNode; crumb?: React.ReactNode;
  actions?: React.ReactNode; unread: number; viewer: Viewer; theme: 'system' | 'light' | 'dark';
}) {
  return (
    <header className="topbar" id="top">
      <div className="title">
        {crumb}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="row tight nowrap">
        {actions}
        <button className="btn icon ghost only-narrow" data-act="palette.open" aria-label="Search">
          <Icon name="search" />
        </button>
        {!viewer.isPortal && (
          <button className="btn icon ghost bellwrap" data-act="notif.open" aria-label="Notifications">
            <Icon name="bell" />
            {unread > 0 && <b>{unread}</b>}
          </button>
        )}
        <button className="btn icon ghost only-wide" data-act="theme.cycle"
          aria-label={`Theme — currently ${theme}`} title={`Theme — currently ${theme}`}>
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'laptop'} />
        </button>
        {viewer.isPortal ? (
          <button className="btn out" data-act="auth.signout">
            <Icon name="logout" size={15} /><span className="only-wide">Sign out</span>
          </button>
        ) : (
          <button className="btn pri" data-act="create.open">
            <Icon name="plus" size={15} sw={2.2} /><span className="only-wide">Create</span>
          </button>
        )}
      </div>
    </header>
  );
}
