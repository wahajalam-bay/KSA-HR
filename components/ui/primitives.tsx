import * as React from 'react';
import { markProps, type Pick, type MarkProps } from '@/lib/charts/interaction';
import { Icon, Badge, guessIcon, type IconName } from './icons';
import { Portrait, type PortraitPerson } from './portrait';
import { fmt, clamp, cls } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   The design system.

   Every component here emits the markup and the class names the prototype's
   stylesheet was written against, so the three stylesheets are carried over
   untouched and the result is the same interface rather than an approximation
   of it. What changes is where the markup comes from: these are components with
   props and types, composed by server components reading the database, instead
   of template strings assembled in a browser.

   Anything interactive carries `data-act` (and `data-v`), which the delegation
   layer in components/app/actions.tsx turns into a server action, a navigation
   or a panel. Nothing here knows how an action is carried out — which is what
   lets the same button work from a table row, a board card and a sheet.
   ───────────────────────────────────────────────────────────────────────────*/

export type Act = { act: string; v?: string | number | null; live?: boolean; keep?: string };

/** Spread onto any element to make it fire an action. */
export function act(a?: Act | null): Record<string, string> {
  if (!a) return {};
  const out: Record<string, string> = { 'data-act': a.act };
  if (a.v !== undefined && a.v !== null) out['data-v'] = String(a.v);
  if (a.live) out['data-live'] = '';
  if (a.keep) out['data-keep'] = a.keep;
  return out;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'violet' | 'gold' | '' | undefined;

// ── chips, tags, pills ──────────────────────────────────────────────────────
export function Chip({ children, tone, title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return <span className={cls('chip', tone)} title={title}>{children}</span>;
}

export function Tag({ tag, on, action }: { tag: string; on?: boolean; action?: Act }) {
  const label = `#${String(tag).replace(/^#/, '')}`;
  if (action) {
    return <button className={cls('tag', on && 'on')} {...act({ ...action, v: tag })}>{label}</button>;
  }
  return <span className="tag">{label}</span>;
}

export const Dot = ({ tone }: { tone: string }) => <i className={`dot ${tone}`} />;

/* The stage pill takes its colour from where the stage sits on the spine, so a
   later stage always reads darker than an earlier one whatever a requisition
   has renamed it to. */
export function StagePill({ name, ordinal }: { name: string; ordinal: number }) {
  const band = Math.min(6, Math.floor((ordinal / 8) * 5) + 1);
  return (
    <span className="stage-pill" style={{ background: `var(--stg-${band})`, color: 'var(--stg-fg)' }}>
      {name}
    </span>
  );
}

const APP_STATUS: Record<string, [string, Tone]> = {
  active: ['Active', 'ok'], on_hold: ['On hold', 'warn'], rejected: ['Rejected', 'bad'],
  withdrawn: ['Withdrew', ''], hired: ['Hired', 'brand'],
};
export function StatusChip({ status }: { status: string }) {
  const [t, tone] = APP_STATUS[status] ?? [status, ''];
  return <Chip tone={tone}>{t}</Chip>;
}

export const JOB_STATUS: Record<string, [string, Tone]> = {
  open: ['Open', 'ok'], on_hold: ['On hold', 'warn'], closed: ['Closed', ''],
  draft: ['Draft', 'info'], pending_approval: ['Awaiting approval', 'warn'],
};
export const jobStatusText = (s: string): string => (JOB_STATUS[s] ?? [s])[0];
export function JobStatus({ status }: { status: string }) {
  const [t, tone] = JOB_STATUS[status] ?? [status, ''];
  return <Chip tone={tone}>{t}</Chip>;
}

const PRIORITY: Record<string, [string, Tone]> = {
  critical: ['Critical', 'bad'], high: ['High', 'warn'], normal: ['Normal', ''], low: ['Low', ''],
};
export function Priority({ priority }: { priority: string }) {
  const [t, tone] = PRIORITY[priority] ?? [priority, ''];
  return <Chip tone={tone}>{t}</Chip>;
}

const VERDICT: Record<string, [string, Tone]> = {
  strong_yes: ['Strong yes', 'brand'], yes: ['Yes', 'ok'], no: ['No', 'warn'], strong_no: ['Strong no', 'bad'],
};
export function Verdict({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <Chip tone="info">Awaiting</Chip>;
  const [t, tone] = VERDICT[verdict] ?? [verdict, ''];
  return <Chip tone={tone}>{t}</Chip>;
}

// ── avatars ─────────────────────────────────────────────────────────────────
export type AvatarSize = 's' | 'm' | 'l' | 'xl';
const AV_PX: Record<AvatarSize, number> = { s: 26, m: 34, l: 46, xl: 68 };

export type AvatarPerson = PortraitPerson & {
  photoUrl?: string | null;
  photo?: string | null;
  hue?: number | null;
  hasResume?: boolean;
};

/* A person's picture: the photograph when there is one, the drawn portrait when
   the platform has them on file without one, and a monogram when it has
   neither — with the reason in the tooltip, because "no photo in the CV" is
   information a recruiter uses. */
export function Avatar({ person, size = 's' }: { person: AvatarPerson | string | null | undefined; size?: AvatarSize }) {
  const p = typeof person === 'string' ? { name: person } as AvatarPerson : person;
  const name = p?.name ?? '?';
  if (p?.photoUrl) {
    return (
      <span className={`av ${size} photo`} title={name}>
        <img src={p.photoUrl} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  if (p?.photo) {
    return (
      <span className={`av ${size} photo`} title={`${name}${p.photo === 'cv' ? ' — photo from the CV' : ''}`}>
        <Portrait person={p} size={AV_PX[size]} />
      </span>
    );
  }
  const h = p?.hue ?? fmt.hue(name);
  return (
    <span className={`av ${size} h${h}`} title={`${name}${p?.hasResume ? ' — no photo in the CV' : ''}`}>
      {fmt.initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4 }: { people: Array<AvatarPerson | string>; max?: number }) {
  return (
    <span className="avs">
      {people.slice(0, max).map((p, i) => <Avatar key={i} person={p} size="s" />)}
      {people.length > max && <span className="av s h4">+{people.length - max}</span>}
    </span>
  );
}

// ── measures ────────────────────────────────────────────────────────────────
export function Stars({ n, size = 12, hideNum }: { n: number | null | undefined; size?: number; hideNum?: boolean }) {
  if (n == null) return <span className="mut">—</span>;
  return (
    <>
      <span className="stars">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={cls('s', i <= Math.round(n) && 'f')}>
            <Icon name="star" size={size} fill={i <= Math.round(n) ? 'currentColor' : 'none'} sw={1.4} />
          </i>
        ))}
      </span>
      {!hideNum && <> <b className="num">{fmt.dec(n, n % 1 ? 1 : 0)}</b></>}
    </>
  );
}

export function Rate({ value, action, v }: { value: number; action: string; v?: string }) {
  return (
    <span className="rate">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} className={i === value ? 'on' : ''} data-act={action} data-v={v ?? ''} data-n={i}>{i}</button>
      ))}
    </span>
  );
}

/* A proportion drawn as a rail or a ring.

   Both are data — a share of a target, a rate, a breach rate — so both get the
   product's own tooltip rather than the browser's, the same one every chart
   uses. `title` stays as the way a caller says what the figure means; it is now
   the tooltip's text instead of a `title` attribute, so it reads in the
   product's voice, appears on keyboard focus as well as on hover, and does not
   wait a second and a half to show up. */
function proportionProps(p: number, title: string | undefined, base: string): MarkProps {
  return markProps({ tip: { label: title ?? 'Share', value: fmt.pct(p) } }, base);
}

export function Bar({ p, thin, tone, title, color }: { p: number; thin?: boolean; tone?: Tone; title?: string; color?: string }) {
  return (
    <span {...proportionProps(p, title, cls('bar', thin && 'thin') ?? 'bar')}>
      <i className={tone ?? ''} style={{ width: `${clamp(p * 100, 0, 100).toFixed(1)}%`, ...(color ? { background: color } : {}) }} />
    </span>
  );
}

export function Ring({ p, label, title, color }: { p: number; label?: React.ReactNode; title?: string; color?: string }) {
  const style: React.CSSProperties = { ['--p' as any]: clamp((p || 0) * 100, 0, 100).toFixed(0) };
  if (color) style.background = `conic-gradient(${color} calc(var(--p)*1%),var(--surface-3) 0)`;
  return (
    <span style={style} {...proportionProps(p, title, 'ring')}>
      <span>{label ?? fmt.pct(p)}</span>
    </span>
  );
}

/* A delta against the period before. `inverse` is for the measures where down
   is the good direction — time to hire, SLA breaches. */
export function Trend({ v, inverse }: { v: number | null | undefined; inverse?: boolean }) {
  if (v == null || Number.isNaN(v)) return null;
  const up = v >= 0;
  const good = inverse ? !up : up;
  return (
    <span className={cls('trend', Math.abs(v) < 0.005 ? 'flat' : good ? 'up' : 'down')}>
      <Icon name={up ? 'arrU' : 'arrD'} size={11} sw={2.4} />
      {fmt.pct(Math.abs(v))}
    </span>
  );
}

// ── containers ──────────────────────────────────────────────────────────────
export function Card({
  title, icon, sub, actions, foot, flush, className, id, children,
}: {
  title?: React.ReactNode; icon?: IconName | false; sub?: React.ReactNode;
  actions?: React.ReactNode; foot?: React.ReactNode; flush?: boolean;
  className?: string; id?: string; children?: React.ReactNode;
}) {
  const showHeader = title != null || actions != null;
  return (
    <section className={cls('card', className)} id={id}>
      {showHeader && (
        <header className="card-h">
          {title != null && icon !== false && <Badge name={icon ?? guessIcon(typeof title === 'string' ? title : '')} />}
          <h3>{title}</h3>
          {actions && <div className="act">{actions}</div>}
        </header>
      )}
      {sub && <div className="card-b" style={{ paddingBottom: 0 }}><p className="t-sub">{sub}</p></div>}
      <div className={cls('card-b', flush && 'flush')}>{children}</div>
      {foot && <footer className="card-f">{foot}</footer>}
    </section>
  );
}

export function Kpi({
  label, value, unit, sub, def, icon, accent, trendValue, inverse, action, spark, className,
}: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; def?: string;
  icon?: IconName | false; accent?: boolean; trendValue?: number | null; inverse?: boolean;
  action?: Act; spark?: React.ReactNode; className?: string;
}) {
  return (
    <div
      className={cls('kpi', accent && 'acc', className)}
      {...(action ? { ...act(action), role: 'button', tabIndex: 0 } : {})}
    >
      {icon !== false && <Badge name={icon ?? guessIcon(label)} size={16} className="kpi-i" />}
      <div className="lab">
        {label}
        {def && <span className="hint" title={def}><Icon name="alert" size={10} /></span>}
      </div>
      {/* The value carries its own line-height so that a unit wrapping onto a
          second line is as tall as the unit, not as tall as the number — see
          app/styles/04-parity.css. */}
      <div className="val num"><span className="v">{value}</span>{unit && <small>{unit}</small>}</div>
      <div className="foot">
        {sub && <span>{sub}</span>}
        {trendValue != null && <Trend v={trendValue} inverse={inverse} />}
      </div>
      {spark}
    </div>
  );
}

export type SegOption = { v: string; t: React.ReactNode };
export function Seg({ options, active, action, className }: {
  options: Array<SegOption | string>; active: string; action: string; className?: string;
}) {
  return (
    <div className={cls('seg', className)} role="tablist">
      {options.map((x) => {
        const v = typeof x === 'string' ? x : x.v;
        const t = typeof x === 'string' ? x : x.t;
        return (
          <button key={v} role="tab" className={v === active ? 'on' : ''}
            data-act={action} data-v={v} aria-selected={v === active}>{t}</button>
        );
      })}
    </div>
  );
}

/* A tab strip that scrolls when it is wider than its box; the arrows at the
   edges appear only when there is more to see. */
/* The tab strip moved to its own file because it has to measure itself,
   which makes it a client component — and everything else in here stays a
   server one. Re-exported so no caller has to know that. */
export { Subnav } from '@/components/ui/subnav';
export type { SubnavTab } from '@/components/ui/subnav';

// ── tables ──────────────────────────────────────────────────────────────────
export type Column<T> = {
  t: string;
  f: (row: T, index: number) => React.ReactNode;
  n?: boolean;          // numeric — right aligned
  cls?: string;
  sort?: string;        // sort key; makes the header a button
};
/* Three optional keys a row may carry to say what clicking it does. They are
   all optional, which makes this a "weak type" — TypeScript then refuses a row
   object that happens to share none of them, which is most rows. So the table
   takes any object and reads the three through this view instead. */
export type TableRow = { _act?: string; _v?: string; _cls?: string };
const meta = (r: unknown): TableRow => (r ?? {}) as TableRow;

/* A grid with subgrid rows, so every row can be its own soft card while the
   columns still line up across the header — a real table's alignment with a
   card's shape. */
export function Table<T extends object>({
  cols, rows, sortAct, sortKey, sortDir, emptyIcon, emptyTitle, emptySub,
}: {
  cols: Array<Column<T>>; rows: T[]; sortAct?: string; sortKey?: string; sortDir?: 1 | -1;
  emptyIcon?: IconName; emptyTitle?: string; emptySub?: string;
}) {
  if (!rows.length) {
    return <Empty icon={emptyIcon ?? 'inbox'} title={emptyTitle ?? 'Nothing here yet'} sub={emptySub} />;
  }
  return (
    <div className="tw">
      <div className="tgrid" style={{ gridTemplateColumns: `repeat(${cols.length},auto)` }}>
        <div className="thead">
          {cols.map((c, i) => (
            <div key={i} className={cls('th', c.n && 'n', c.sort && 'srt')}
              {...(c.sort ? { 'data-act': sortAct, 'data-v': c.sort, role: 'button', tabIndex: 0 } : {})}>
              {c.t}
              {c.sort && sortKey === c.sort && <Icon name={sortDir === 1 ? 'chevU' : 'chevD'} size={11} />}
            </div>
          ))}
        </div>
        {rows.map((r, ri) => {
          const m = meta(r);
          return (
          <div key={ri} className={cls('trow', m._act && 'clickable', m._cls)}
            {...(m._act ? { 'data-act': m._act, 'data-v': m._v ?? '', tabIndex: 0, role: 'button' } : {})}>
            {cols.map((c, ci) => (
              <div key={ci} className={cls('td', c.n && 'n', c.cls)}>{c.f(r, ri)}</div>
            ))}
          </div>
          );
        })}
      </div>
    </div>
  );
}

export function Empty({ icon = 'inbox', title, sub, action }: {
  icon?: IconName; title: string; sub?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="ic"><Icon name={icon} size={22} /></span>
      <b>{title}</b>
      {sub && <p className="t-sub">{sub}</p>}
      {action && <div className="empty-a">{action}</div>}
    </div>
  );
}

// ── forms ───────────────────────────────────────────────────────────────────
export type FieldOption = { v: string; t: string } | string;

export function Field({
  label, name, type = 'text', value, defaultValue, options, placeholder, help, req, rows, min, max, step,
  action, v, className, disabled, readOnly, list,
}: {
  label: string; name: string; type?: string; value?: string | number | null;
  defaultValue?: string | number | null; options?: FieldOption[]; placeholder?: string;
  help?: React.ReactNode; req?: boolean; rows?: number; min?: number | string; max?: number | string;
  step?: number | string; action?: string; v?: string; className?: string;
  disabled?: boolean; readOnly?: boolean; list?: string;
}) {
  const id = `f_${name}`;
  const common = {
    className: 'inp', name, id, disabled, readOnly,
    ...(action ? { 'data-act': action, ...(v ? { 'data-v': v } : {}) } : {}),
  };
  let inner: React.ReactNode;
  if (type === 'select') {
    inner = (
      <select {...common} defaultValue={String(value ?? defaultValue ?? '')}>
        {(options ?? []).map((o, i) => {
          const ov = typeof o === 'string' ? o : o.v;
          const ot = typeof o === 'string' ? o : o.t;
          return <option key={`${ov}-${i}`} value={ov}>{ot}</option>;
        })}
      </select>
    );
  } else if (type === 'textarea') {
    inner = <textarea {...common} rows={rows ?? 3} placeholder={placeholder} defaultValue={String(value ?? defaultValue ?? '')} />;
  } else {
    inner = (
      <input {...common} type={type} placeholder={placeholder} list={list}
        defaultValue={String(value ?? defaultValue ?? '')}
        min={min} max={max} step={step} />
    );
  }
  return (
    <div className={cls('field', className)}>
      <label htmlFor={id}>{label}{req && ' *'}</label>
      {inner}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

/* A switch with no action is a statement, not a control: it renders as one,
   says why it cannot be moved, and carries no data-act for the delegated layer
   to pick up. */
export function SwitchRow({ label, sub, on, action, v, right, title }: {
  label: string; sub?: React.ReactNode; on?: boolean; action?: string; v?: string;
  right?: React.ReactNode; title?: string;
}) {
  const locked = !action;
  return (
    <div className="switch-row">
      <div className="bd"><b>{label}</b>{sub && <span>{sub}</span>}</div>
      {right}
      <div className={cls('switch', on && 'on', locked && 'locked')} role="switch"
        aria-checked={!!on} aria-disabled={locked || undefined}
        tabIndex={locked ? -1 : 0} title={title}
        {...(locked ? {} : { 'data-act': action, 'data-v': v ?? '' })} />
    </div>
  );
}

/* A list row. It is a <button> when it acts, unless its right-hand side carries
   buttons of its own — a button cannot contain a button, and the parser would
   tear the row apart — in which case it becomes a div with role=button. */
export function Li({
  title, sub, icon, iconTone, avatar, right, action, v, className, children,
}: {
  title: React.ReactNode; sub?: React.ReactNode; icon?: IconName; iconTone?: string;
  avatar?: AvatarPerson | string; right?: React.ReactNode; action?: string; v?: string;
  className?: string; children?: React.ReactNode;
}) {
  const nested = !!action && React.Children.toArray(right).some(
    (c) => React.isValidElement(c) && hasButton(c),
  );
  const Tag = (action && !nested ? 'button' : 'div') as 'button' | 'div';
  return (
    <Tag className={cls('li', className, nested && 'act')}
      {...(action ? { 'data-act': action, 'data-v': v ?? '', ...(nested ? { role: 'button', tabIndex: 0 } : {}) } : {})}>
      {icon ? <span className={cls('ic', iconTone ?? 'brand')}><Icon name={icon} size={15} /></span>
        : avatar ? <Avatar person={avatar} size="m" /> : null}
      <span className="bd"><b>{title}</b>{sub && <span>{sub}</span>}</span>
      {right && <span className="tr">{right}</span>}
      {action && <span className="chev"><Icon name="chev" size={15} /></span>}
      {children}
    </Tag>
  );
}

/* A row that is itself a button cannot hold buttons: the HTML parser closes the
   outer one when it meets the inner, and what renders is not what was written.
   So a row with controls on its right becomes a div with a button's role, and
   this is how it finds out — including for `Btn`, which is a component and not
   a <button> until it renders. */
function hasButton(node: React.ReactElement): boolean {
  if (node.type === 'button') return true;
  if (typeof node.type === 'function' && (node.type as { isControl?: boolean }).isControl) return true;
  const kids = (node.props as any)?.children;
  return React.Children.toArray(kids).some((c) => React.isValidElement(c) && hasButton(c));
}

export function Banner({ title, body, tone, icon, action }: {
  title: React.ReactNode; body?: React.ReactNode; tone?: Tone; icon?: IconName; action?: React.ReactNode;
}) {
  return (
    <div className={cls('banner', tone)}>
      <span className="ic"><Icon name={icon ?? 'alert'} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{title}</b>
        {body && <p className="t-sub" style={{ marginTop: 2 }}>{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function Dropzone({ action, accept, multi, title, sub }: {
  action: string; accept?: string; multi?: boolean; title?: string; sub?: string;
}) {
  return (
    <label className="dz" data-dz={action}>
      {/* Out of the layout but still in the tab order. The prototype used
          `hidden`, which is display:none — the control could not be reached
          without a mouse at all, and an upload well nobody can tab to is an
          upload well half the desk cannot use. */}
      <input type="file" className="sr-only" accept={accept} multiple={multi} />
      <span className="ic"><Icon name="upload" size={20} /></span>
      <b>{title ?? 'Upload a résumé'}</b>
      <i>{sub ?? 'PDF, DOC or DOCX — parsed on upload'}</i>
    </label>
  );
}

export function Skeleton({ n = 3 }: { n?: number }) {
  return <div className="skel-w">{Array.from({ length: n }, (_, i) => <div key={i} className="skel" />)}</div>;
}

export function Kvs({ pairs }: { pairs: Array<[React.ReactNode, React.ReactNode] | null | false | undefined> }) {
  return (
    <div className="g-kv">
      {pairs.filter(Boolean).map((p, i) => {
        const [k, v] = p as [React.ReactNode, React.ReactNode];
        return <div className="kv" key={i}><b>{k}</b><span>{v}</span></div>;
      })}
    </div>
  );
}

export function Timeline({ items }: {
  items: Array<{ at: string; text: React.ReactNode; when: string; byName?: string | null; on?: boolean; extra?: React.ReactNode }>;
}) {
  return (
    <ol className="tl">
      {items.map((i, k) => (
        <li key={k} className={i.on ? 'on' : ''}>
          <div className="bd">
            <p>{i.text}</p>
            <span className="when">{i.when}{i.byName ? ` · ${i.byName}` : ''}</span>
            {i.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* The pipeline as connected nodes — filled up to where the person is, hollow
   beyond it, with an optional count under each. */
const STEP_ICON: Record<string, IconName> = {
  applied: 'inbox', sourced: 'search', screen: 'phone', assessment: 'file',
  iv1: 'users', iv2: 'users', pitch: 'target', ivf: 'badge', offer: 'mail', joined: 'check',
};
export function Stepper({ stages, current, counts, action, className, picks }: {
  stages: Array<{ key: string; name: string }>; current?: string | null;
  counts?: Record<string, number>; action?: string; className?: string;
  /* One per step. A stepper drawn beside a chart is another view of the same
     marks, so it takes the same picks and lands in the same place. */
  picks?: Array<Pick | null>;
}) {
  const cur = current ? stages.findIndex((s) => s.key === current) : -1;
  return (
    <div className={cls('stepper', className)}>
      {stages.map((s, i) => {
        const state = cur < 0 ? 'on' : i < cur ? 'done' : i === cur ? 'now' : 'todo';
        const n = counts ? counts[s.key] : null;
        const pick = picks?.[i] ?? null;
        const m = pick
          ? markProps(pick, `step ${state}`)
          : { className: `step ${state}`, ...(action ? { 'data-act': action, 'data-v': s.key } : {}) };
        return (
          <div key={s.key} {...m}>
            {i > 0 && <i className="ln" />}
            <span className="nd"><Icon name={STEP_ICON[s.key] ?? 'chev'} size={14} sw={2} /></span>
            <b>{s.name}</b>
            {n != null && <em>{fmt.int(n)}</em>}
          </div>
        );
      })}
    </div>
  );
}

// ── buttons ─────────────────────────────────────────────────────────────────
export type BtnVariant = 'pri' | 'out' | 'ghost' | 'danger' | '';
export function Btn({
  children, action, v, variant = '', size, icon, iconSize, disabled, title, ariaLabel, className,
  square, type = 'button',
}: {
  children?: React.ReactNode; action?: string; v?: string | number | null; variant?: BtnVariant;
  size?: 'xs' | 'sm'; icon?: IconName; iconSize?: number; disabled?: boolean; title?: string;
  ariaLabel?: string; className?: string;
  /* A button with an icon and no label is square by default. Some rows want it
     to keep the height of the labelled buttons beside it instead, so the shape
     is a choice rather than something inferred from having no children. */
  square?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      className={cls('btn', size, variant, (square ?? (!children && !!icon)) && 'icon', className)}
      title={title} aria-label={ariaLabel} disabled={disabled}
      {...(action ? { 'data-act': action, ...(v != null ? { 'data-v': String(v) } : {}) } : {})}
    >
      {icon && <Icon name={icon} size={iconSize ?? (size === 'xs' ? 12 : size === 'sm' ? 13 : 15)} />}
      {children}
    </button>
  );
}

Btn.isControl = true;

/** The spacer that pushes a sheet's primary action to the right. */
export const Sp = () => <span className="sp" />;
export const Push = () => <span className="push" />;
