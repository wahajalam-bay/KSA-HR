import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { currentViewer } from '@/lib/auth/session';
import { navCounts, orgSettings } from '@/lib/queries/shell';
import { clockOf } from '@/lib/clock';
import { AppClient } from '@/components/app/app-client';
import { BackgroundArt } from '@/components/app/background';
import { Sidebar, TabBar } from '@/components/app/shell';
import { ViewerProvider } from '@/components/app/viewer-context';

/* Everything behind the sign-in screen. The shell is rendered once; the pages
   below fill #view and supply their own title and actions through the top bar
   slot, so moving between two pages does not rebuild the navigation. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/sign-in');

  const { at: now, held } = await clockOf();
  const [counts, org, jar] = await Promise.all([navCounts(viewer, now), orgSettings(), cookies()]);
  const theme = (jar.get('bayut_ta_theme')?.value ?? 'system') as 'system' | 'light' | 'dark';

  return (
    <ViewerProvider viewer={viewer} counts={counts} theme={theme} orgName={String(org.org_name ?? 'Bayut KSA')}>
      <AppClient isPortal={viewer.isPortal}>
        <BackgroundArt />
        {/* Said out loud when the request's clock is being held to a fixed
            instant, so the visual harness can refuse to compare a production
            build — which rejects the override — against frozen captures. It
            can never appear in production; see lib/clock.ts. */}
        <div id="app" {...(held ? { 'data-clock': 'held' } : {})}>
          <Sidebar viewer={viewer} counts={counts} orgName={String(org.org_name ?? 'Bayut KSA')} />
          <div className="main">{children}</div>
        </div>
        <TabBar isPortal={viewer.isPortal} />
      </AppClient>
    </ViewerProvider>
  );
}
