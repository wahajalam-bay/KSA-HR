import * as React from 'react';
import { Icon, type IconName } from '@/components/ui/icons';
import { routeMeta, type RouteKey } from '@/lib/domain/sourcing';

/* The small mark on a board card and on a row of All applicants, saying which
   route brought this person in. Everyone is on the same board whatever the
   route; the mark is a label, not a separate pipeline. */
export function SourceMark({ route, source }: { route: RouteKey | string; source: string }) {
  const m = routeMeta(route);
  return (
    <span className={`srcmk ${route}`} title={`${m.name} — ${source}`}>
      <Icon name={m.icon as IconName} size={10} />
    </span>
  );
}
