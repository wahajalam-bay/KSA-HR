import { chrome } from '@/lib/queries/chrome';
import { portal } from '@/lib/queries/portal';
import { TopBar } from '@/components/app/shell';
import { MyHiring } from '@/components/portal/my-hiring';

export const dynamic = 'force-dynamic';

/* The portal home. Every figure on it is read under the viewer's own scope, so
   the page is the same component whether it is opened by a hiring manager, an
   interview participant, or a member of the desk looking at their own name. */
export default async function MyHiringPage() {
  const { viewer, counts, theme, now } = await chrome();
  const d = await portal(viewer, now);

  return (
    <>
      <TopBar
        title="My hiring"
        sub={<>{viewer.roleLabel}{viewer.title ? ` · ${viewer.title}` : ''} · what needs you, and only that</>}
        unread={counts.unreadNotifications} viewer={viewer} theme={theme}
      />
      <main className="view" id="view">
        <MyHiring d={d} me={viewer.name} now={now} />
      </main>
    </>
  );
}
