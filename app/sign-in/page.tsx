import { redirect } from 'next/navigation';
import { currentViewer } from '@/lib/auth/session';
import { orgSettings } from '@/lib/queries/shell';
import { ssoStatus } from './actions';
import { SignInForm } from './form';

export const metadata = { title: 'Sign in — Bayut KSA Talent Acquisition' };

export default async function SignInPage() {
  if (await currentViewer()) redirect('/overview');
  const [org, sso] = await Promise.all([orgSettings(), ssoStatus()]);

  return (
    <>
      <SignInForm
        orgName={String(org.org_name ?? 'Bayut KSA')}
        legalName={String(org.legal_name ?? '')}
        timezone={String(org.timezone ?? '')}
        sso={sso}
      />
    </>
  );
}
