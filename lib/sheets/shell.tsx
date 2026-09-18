import 'server-only';
import * as React from 'react';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications, staff } from '@/db/schema';
import { defineSheets } from './registry';
import { Avatar, Chip, Li, Empty, Btn, Sp } from '@/components/ui/primitives';
import { Icon, type IconName } from '@/components/ui/icons';
import { ago } from '@/lib/format';

/* The panels the shell itself owns: the bell, the profile menu and Create. */

const NOTIF_ICON: Record<string, IconName> = {
  evaluation: 'star', application: 'inbox', offer: 'file', mention: 'msg', sla: 'clock',
  interview: 'cal', approval: 'shield', joiner: 'badge', notice: 'handshake', file: 'mail',
  question: 'msg', assessment: 'brain', feedback: 'thumbUp', claim: 'pin', ivreview: 'target',
  probation: 'shield', automation: 'zap', integration: 'plug',
};

defineSheets({
  'notif.open': async (_v, { viewer }) => {
    const rows = await db().select().from(notifications)
      .where(and(
        or(isNull(notifications.recipientAccountId), eq(notifications.recipientAccountId, viewer.accountId)),
        viewer.staffId
          ? or(isNull(notifications.recipientStaffId), eq(notifications.recipientStaffId, viewer.staffId))
          : isNull(notifications.recipientStaffId),
      ))
      .orderBy(desc(notifications.at))
      .limit(80);
    const now = new Date();

    return {
      title: 'Notifications',
      aria: 'Notifications',
      actions: <Btn size="sm" variant="ghost" action="notif.readall">Mark all read</Btn>,
      body: rows.length ? (
        <div className="list flush">
          {rows.map((n) => (
            <button key={n.id} className={`notif${n.readAt ? '' : ' un'}`} data-act="notif.go" data-v={n.id}>
              <span className="ic"><Icon name={NOTIF_ICON[n.kind] ?? 'bell'} size={15} /></span>
              <span className="bd">
                <p>{n.text}</p>
                <time>{ago(n.at, now)}</time>
              </span>
            </button>
          ))}
        </div>
      ) : <Empty icon="bell" title="All clear" sub="No notifications." />,
    };
  },

  'me.switch': async (_v, { viewer }) => {
    const team = viewer.isAdmin
      ? await db().select().from(staff).where(sql`${staff.status} <> 'deleted'`).orderBy(staff.name)
      : [];

    return {
      title: viewer.name,
      eyebrow: viewer.roleLabel,
      aria: 'Your account',
      sub: `${viewer.title ?? ''}${viewer.email ? ` · ${viewer.email}` : ''}`,
      body: (
        <>
          {viewer.isAdmin ? (
            <>
              <div className="divider" style={{ marginTop: 0 }}>
                <span className="t-over">View the product as a colleague</span>
              </div>
              <p className="t-foot" style={{ marginBottom: 8 }}>
                An Admin can look at the platform as any member of the TA team — the interface changes
                shape with the role. Anything you do while switched is recorded against your own name
                as well as theirs.
              </p>
              <div className="list">
                {team.map((s) => (
                  <Li key={s.id} avatar={{ name: s.name, photo: s.photo, hue: s.hue }}
                    title={s.name} sub={s.title}
                    right={s.id === (viewer.actingAsStaffId ?? viewer.staffId) ? <Chip tone="brand">Current</Chip> : undefined}
                    action="me.set" v={s.id} />
                ))}
              </div>
            </>
          ) : (
            <p className="t-sub">
              You are signed in as {viewer.roleLabel.toLowerCase()}.{' '}
              {viewer.isPortal
                ? 'You see your own requisitions, interviews, approvals and new joiners.'
                : 'Ask an Admin to change your role.'}
            </p>
          )}
        </>
      ),
      foot: (
        <>
          <Sp />
          <Btn variant="out" action="auth.signout" icon="logout" iconSize={14}>Sign out</Btn>
        </>
      ),
    };
  },

  'create.open': async () => ({
    title: 'Create',
    eyebrow: 'Quick add',
    aria: 'Create',
    body: (
      <div className="list">
        <Li icon="brief" title="Requisition" sub="Open a role and pick its pipeline" action="job.new" />
        <Li icon="uplus" title="Candidate" sub="Add a person and upload a résumé" action="cand.new" />
        <Li icon="badge" title="Recruiter" sub="Add a member of the TA team" action="staff.new" />
        <Li icon="cal" title="Interview" sub="Schedule a panel" action="ivw.new" />
        <Li icon="check" title="Task" sub="Something to chase" action="task.new" />
      </div>
    ),
  }),
});
