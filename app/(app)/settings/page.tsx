import { chrome, q } from '@/lib/queries/chrome';
import * as S from '@/lib/queries/settings';
import { TopBar } from '@/components/app/shell';
import { Subnav, Empty } from '@/components/ui/primitives';
import { NoAccess } from '@/components/app/no-access';
import {
  BrandingPanel, OrganisationPanel, PipelinesPanel, AutomationsPanel, IntegrationsPanel,
  AuditPanel, DataPanel,
} from '@/components/settings/panels';
import {
  AccessPanel, ApprovalsPanel, TeamsPanel, PitchPanel,
} from '@/components/settings/access';
import { TemplatesPanel } from '@/components/settings/templates';
import { can } from '@/lib/authz';
import { fmt } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = q(await searchParams);
  const { viewer, counts, theme, now } = await chrome();

  /* Settings is read behind a capability of its own: a hiring manager has no
     business reading the access list or the audit trail. */
  if (!can(viewer, 'settings.view')) {
    return (
      <NoAccess title="Settings" what="The platform's configuration and its audit trail"
        viewer={viewer} counts={counts} theme={theme} />
    );
  }

  const tab = (S.SETTINGS_TABS.some((t) => t.v === sp.tab) ? sp.tab : 'branding') as S.SettingsTab;
  const mayEdit = can(viewer, 'settings.edit');
  const mayManageAccess = can(viewer, 'access.manage');
  const mayManageAutomations = can(viewer, 'automation.manage');
  const mayManageIntegrations = can(viewer, 'integration.manage');

  const [org, tabCounts] = await Promise.all([S.org(), S.tabCounts()]);
  const integrationCount = tabCounts.integrations;

  /* Only the panel in view is read. Twelve panels' worth of queries on every
     visit would make the page slower than the thing it configures. */
  const panel = await (async () => {
    switch (tab) {
      case 'org': return <OrganisationPanel d={await S.orgPanel()} mayEdit={mayEdit} />;
      case 'approvals': return <ApprovalsPanel d={await S.approvalsPanel()} mayEdit={mayEdit} now={now} />;
      case 'access':
        if (!can(viewer, 'access.manage') && !can(viewer, 'settings.view')) return null;
        return <AccessPanel accounts={await S.accessPanel()} mayEdit={mayManageAccess} now={now} />;
      case 'teams': return <TeamsPanel teams={await S.notifiedTeamsPanel()} mayEdit={mayEdit} />;
      case 'pipelines': return <PipelinesPanel d={await S.pipelinesPanel()} mayEdit={mayEdit} />;
      case 'pitch': return <PitchPanel d={await S.pitchPanel()} mayEdit={mayEdit} now={now} />;
      case 'templates': return <TemplatesPanel d={await S.templatesPanel()} mayEdit={mayEdit} now={now} />;
      case 'automations':
        return <AutomationsPanel {...await S.automationsPanel(now)} mayEdit={mayManageAutomations} now={now} />;
      case 'integrations':
        return <IntegrationsPanel d={await S.integrationsPanel()} mayEdit={mayManageIntegrations} now={now} />;
      case 'audit': {
        if (!can(viewer, 'audit.view')) {
          return (
            <Empty icon="shield" title="The audit trail is not part of your role"
              sub="Ask an Admin if you need it." />
          );
        }
        const filters = { q: sp.q ?? '', action: sp.action ?? '', entity: sp.entity ?? '' };
        return (
          <AuditPanel d={await S.auditPanel(filters)} filters={filters}
            retentionMonths={org.dataRetentionMonths} now={now} />
        );
      }
      case 'data': return <DataPanel d={await S.dataPanel()} />;
      default: return <BrandingPanel org={org} theme={theme} />;
    }
  })();

  return (
    <>
      <TopBar
        title="Settings"
        sub={
          <>
            {org.orgName} · {org.timezone} · weekend{' '}
            {fmt.list((org.weekendDays ?? []).map((d) => DAY_NAMES[d] ?? String(d)))} ·{' '}
            {integrationCount} systems connected
          </>
        }
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />

      <main className="view" id="view">
        <Subnav action="set.tab" active={tab}
          tabs={S.SETTINGS_TABS.map((t) => ({ ...t, n: tabCounts[t.v] ?? null }))} />
        {panel}
      </main>
    </>
  );
}

const DAY_NAMES: Record<number, string> = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday',
};
