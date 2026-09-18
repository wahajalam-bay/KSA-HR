import * as React from 'react';
import { Chip, Tag } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago, hue } from '@/lib/format';
import type { Viewer } from '@/lib/auth/session';
import type { PoolCard } from '@/lib/queries/candidates';

/* Talent pools: saved segments of people worth coming back to. Opening one
   filters the candidate list by it rather than taking you somewhere else, so
   the same filters, the same sorting and the same row stay available. */

export function PoolsTab({ pools, viewer, now }: { pools: PoolCard[]; viewer: Viewer; now: Date }) {
  return (
    <div className="grid g-3">
      {pools.map((p) => {
        const f = p.filter ?? {};
        const tags = (f.hashtags as string[] | undefined) ?? [];
        return (
          <button key={p.id} className="pcard" data-act="cand.pool" data-v={p.id}>
            <div className="hd">
              <span className={`av m h${hue(p.name)}`}><Icon name="hash" size={15} /></span>
              <div className="bd">
                <b>{p.name}</b>
                <span>{p.owner_name ?? '—'} · built {ago(p.created_at, now)}</span>
              </div>
            </div>
            <div className="wrap">
              {tags.map((t) => <Tag key={t} tag={t} />)}
              {f.family ? <Chip>{String(f.family)}</Chip> : null}
              {f.city ? <Chip>{String(f.city)}</Chip> : null}
              {f.minYears ? <Chip>{String(f.minYears)}y+</Chip> : null}
            </div>
            <div className="st">
              <div><b>{fmt.int(p.members)}</b><span>People</span></div>
              <div><b>{fmt.int(p.live)}</b><span>Live</span></div>
              <div><b>{fmt.int(p.hired)}</b><span>Hired</span></div>
            </div>
          </button>
        );
      })}
      <button className="pcard" data-act="pool.new"
        style={{ alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', color: 'var(--ink-3)' }}>
        <span className="av m h4"><Icon name="plus" size={16} /></span>
        <b>New talent pool</b>
        <span className="t-foot">Save a search you keep coming back to</span>
      </button>
    </div>
  );
}
