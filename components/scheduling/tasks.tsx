import * as React from 'react';
import { Card, Chip, Empty, Priority, Push } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, daysBetween } from '@/lib/format';
import { TASK_KIND, type TaskRow } from '@/lib/queries/scheduling';

/* The chase list, in the five buckets a desk actually works in: what is late,
   what is today, what is this week, what is later, and what is done. */

export const BUCKETS: Array<[string, string, string]> = [
  ['over', 'Overdue', 'bad'], ['today', 'Due today', 'warn'],
  ['week', 'This week', 'info'], ['later', 'Later', ''], ['done', 'Done', 'ok'],
];

export function bucketOf(t: TaskRow, today: string): string {
  if (t.done) return 'done';
  if (!t.dueOn) return 'later';
  const d = Math.round(daysBetween(today, t.dueOn));
  return d < 0 ? 'over' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later';
}

function Row({ t, today }: { t: TaskRow; today: string }) {
  const late = !t.done && !!t.dueOn && t.dueOn < today;
  const d = t.dueOn ? Math.round(daysBetween(t.dueOn, today)) : 0;
  return (
    <div className={`tk${t.done ? ' done' : ''}`}>
      <span className={`box${t.done ? ' on' : ''}`} data-act="task.toggle" data-v={t.id}
        role="button" tabIndex={0}
        aria-label={`${t.done ? 'Reopen' : 'Complete'} this task`}
        title={t.done ? 'Reopen this task' : 'Mark it done'}>
        <Icon name="check" size={13} sw={2.6} />
      </span>
      <span className="bd">
        <b>{t.title}</b>
        <span>
          {TASK_KIND[t.kind] ?? t.kind}{t.jobTitle ? ` · ${t.jobTitle}` : ''} ·{' '}
          due {fmt.date(t.dueOn)}
          {late ? <> · <em className="bad-t">{d} day{d === 1 ? '' : 's'} past</em></> : null}
          {' · '}{t.assigneeName ?? '—'}
        </span>
      </span>
      <span className="wrap" style={{ flex: '0 0 auto', justifyContent: 'flex-end' }}>
        {t.priority !== 'normal' && <Priority priority={t.priority} />}
        {t.candidateName && t.applicationId && (
          <button className="btn xs ghost" data-act="drawer.open" data-v={t.applicationId}>
            {fmt.first(t.candidateName)}
          </button>
        )}
      </span>
    </div>
  );
}

export function TasksTab({ kept, owners, who, today, now }: {
  kept: TaskRow[];
  owners: Array<{ id: string; name: string }>;
  who: string;
  today: string;
  now: Date;
}) {
  const g: Record<string, TaskRow[]> = {};
  for (const t of kept) {
    const k = bucketOf(t, today);
    g[k] = [...(g[k] ?? []), t];
  }
  const openN = kept.filter((t) => !t.done).length;
  const owner = owners.find((o) => o.id === who);

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="wrap">
          {BUCKETS.map(([k, t, tone]) => (
            <Chip key={k} tone={((g[k] ?? []).length ? tone : '') as any}>
              {(g[k] ?? []).length} {t.toLowerCase()}
            </Chip>
          ))}
        </span>
        <Push />
        <span className="t-foot">
          {openN} open of {kept.length}{owner ? ` for ${owner.name}` : ' across the team'}
        </span>
      </div>

      <div className="filters">
        <select className="inp" data-act="sch.who" defaultValue={who} aria-label="Owner">
          <option value="">Everyone</option>
          {owners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Push />
        <span className="t-foot">
          Buckets are measured against {fmt.date(now.toISOString())}, today.
        </span>
      </div>

      {kept.length ? (
        <div className="stack">
          {BUCKETS.map(([k, t, tone]) => {
            const rows = [...(g[k] ?? [])].sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
            if (!rows.length) return null;
            return (
              <Card key={k} title={t} actions={<Chip tone={tone as any}>{String(rows.length)}</Chip>}
                sub={k === 'over' ? 'Past its due date and still open — clear these first.'
                  : k === 'done' ? 'Ticked off; tick again to reopen.' : undefined}>
                {rows.map((r) => <Row key={r.id} t={r} today={today} />)}
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty icon="check" title="No tasks here" sub="Nothing is assigned to this person." />
      )}
    </>
  );
}
