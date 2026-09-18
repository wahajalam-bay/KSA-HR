import * as React from 'react';
import { Empty, Btn } from '@/components/ui/primitives';
import { TopBar } from '@/components/app/shell';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   A page the account may not open.

   The check that produces this runs on the server, before the query: hiding
   the link in the sidebar is a courtesy, not a control, and a page reached by
   typing its address has to refuse on its own. It says what the account *can*
   do rather than only what it cannot, because a hiring manager who lands here
   has usually followed a link somebody else sent them.
   ───────────────────────────────────────────────────────────────────────────*/

export function NoAccess({ title, what, viewer, counts, theme }: {
  title: string;
  /** What the page holds, in the words the refusal should use. */
  what: string;
  viewer: Viewer;
  counts: { unreadNotifications: number };
  theme: 'system' | 'light' | 'dark';
}) {
  return (
    <>
      <TopBar title={title} unread={counts.unreadNotifications} viewer={viewer} theme={theme} />
      <main className="view" id="view">
        <Empty icon="shield" title="Your access does not cover this page"
          sub={viewer.isPortal
            ? `Your access covers your own requisitions, interviews, approvals and feedback. ${what} is handled by the TA team.`
            : `${what} is not part of your role. Ask an Admin if you need it.`}
          action={<Btn variant="out" action="go" v="/overview">Back to the overview</Btn>} />
      </main>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   A record the account may not open.

   Different from the page refusal above: the page is one they may use, and
   this particular requisition, candidate or joiner is not in their scope. It
   happens for an ordinary reason — somebody sent them a link to a requisition
   they are not on — and the answer is the product with a sentence in it, not a
   server error and not the sign-in door.

   The message is the one the authorization layer wrote, because that layer is
   where the rule lives and it already says the right thing.
   ───────────────────────────────────────────────────────────────────────────*/

export function OutOfScope({ title, message, viewer, counts, theme, back }: {
  title: string;
  message: string;
  viewer: Viewer;
  counts: { unreadNotifications: number };
  theme: 'system' | 'light' | 'dark';
  /** Where "back" goes; the list this record would have been on. */
  back?: { href: string; label: string };
}) {
  return (
    <>
      <TopBar title={title} unread={counts.unreadNotifications} viewer={viewer} theme={theme} />
      <main className="view" id="view">
        <Empty icon="shield" title={message}
          sub={viewer.isPortal
            ? 'Your access covers your own requisitions, interviews, approvals and feedback. '
              + 'If you should be on this one, ask the recruiter who owns it to add you.'
            : 'Your access covers a named list of requisitions. Ask an Admin if this one '
              + 'should be on it.'}
          action={(
            <Btn variant="out" action="go" v={back?.href ?? '/overview'}>
              {back?.label ?? 'Back to the overview'}
            </Btn>
          )} />
      </main>
    </>
  );
}
