'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icons';

/* The filter row, and the tag chips under it.

   Everything lives in the URL, so a filtered view can be reloaded, bookmarked
   or sent to a colleague. The text box filters as you type and keeps the caret
   where it was; the selects act on change, the way a select should. */

export type Options = {
  families: string[];
  sources: string[];
  owners: Array<{ id: string; name: string }>;
  tags: string[];
  stages: Array<{ key: string; name: string }>;
};

const HELD = [
  ['', 'Any recruiter tag'],
  ['mine', 'Tagged to me'],
  ['others', 'Tagged to someone else'],
  ['free', 'Untagged — open to the desk'],
  ['any', 'Tagged to anyone'],
] as const;

const SORTS = [
  ['stale', 'Longest in stage'],
  ['recent', 'Recently moved'],
  ['rating', 'Best rated'],
  ['experience', 'Most experience'],
  ['name', 'A–Z'],
] as const;

export function CandidateFilters({ sp, options, tab, tagFacets, poolName }: {
  sp: Record<string, string>;
  options: Options;
  tab: string;
  tagFacets: Array<{ tag: string; n: number }>;
  poolName?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = React.useState(sp.q ?? '');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => { setText(sp.q ?? ''); }, [sp.q]);

  const push = React.useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    router.push(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  }, [params, pathname, router]);

  const onText = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: v }), 280);
  };

  const active = (sp.tags ?? '').split(',').filter(Boolean);
  const toggleTag = (t: string) => {
    const next = active.includes(t) ? active.filter((x) => x !== t) : [...active, t];
    push({ tags: next.join(',') });
  };

  return (
    <>
      <div className="filters">
        <input className="inp grow" value={text} onChange={(e) => onText(e.target.value)}
          placeholder="Name, company, skill, email…" aria-label="Search candidates" />

        <select className="inp" value={sp.fam ?? ''} onChange={(e) => push({ fam: e.target.value })}
          aria-label="Function">
          <option value="">Any function</option>
          {options.families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>

        {tab === 'pipeline' && (
          <select className="inp" value={sp.stage ?? ''} onChange={(e) => push({ stage: e.target.value })}
            aria-label="Stage">
            <option value="">Any stage</option>
            {options.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        )}

        <select className="inp" value={sp.src ?? ''} onChange={(e) => push({ src: e.target.value })}
          aria-label="Source">
          <option value="">Any source</option>
          {options.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select className="inp" value={sp.own ?? ''} onChange={(e) => push({ own: e.target.value })}
          aria-label="Recruiter">
          <option value="">Any recruiter</option>
          {options.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        <select className="inp" value={sp.held ?? ''} onChange={(e) => push({ held: e.target.value })}
          title="Recruiter tags — who has put their name on the candidate" aria-label="Recruiter tag">
          {HELD.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>

        {poolName && (
          <button className="btn sm out" type="button" onClick={() => push({ pool: '' })}>
            <Icon name="x" size={12} /> {poolName}
          </button>
        )}

        <select className="inp" value={sp.sort ?? (tab === 'pipeline' ? 'stale' : 'recent')}
          onChange={(e) => push({ sort: e.target.value })} aria-label="Order">
          {SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>

        <button className="btn sm ghost" data-act="data.export" data-v="candidates">
          <Icon name="dl" size={13} /><span className="only-wide">Export</span>
        </button>
      </div>

      {tagFacets.length > 0 && (
        <div className="chipbar" style={{ margin: '-6px 0 14px' }}>
          <span className="t-cap">Tags</span>
          {tagFacets.map((x) => (
            <button key={x.tag} type="button"
              className={`tag${active.includes(x.tag) ? ' on' : ''}`}
              onClick={() => toggleTag(x.tag)}>
              #{x.tag}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
