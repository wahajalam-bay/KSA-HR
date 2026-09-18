import { redirect } from 'next/navigation';
import { currentViewer } from '@/lib/auth/session';

export default async function Root() {
  const v = await currentViewer();
  redirect(v ? (v.isPortal ? '/my' : '/overview') : '/sign-in');
}
