import * as React from 'react';
import {
  Card, Kpi, Chip, Empty, Banner, Li, Table, Avatar, Btn, Kvs, SwitchRow, Seg,
  type Column,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { Legend, HBars } from '@/components/charts';
import { CAT, SEQ } from '@/lib/charts/palette';
import { Swatches } from './swatches';
import { fmt, ago } from '@/lib/format';
import type {
  Org, OrgPanel, PipelineRow, IntegrationRow, AuditRow, TableCount,
} from '@/lib/queries/settings';

/* ─────────────────────────────────────────────────────────────────────────────
   Settings, panel by panel.

   Two rules run through all of them. Reference data is shown as it is, counted
   from the database rather than described; and nothing reports a state it has
   not checked — an integration is green only when the process holds the
   credentials for it, and says which ones are missing when it does not.
   ───────────────────────────────────────────────────────────────────────────*/

/* ── Branding ────────────────────────────────────────────────────────────── */

export function BrandingPanel({ org, theme }: { org: Org; theme: 'system' | 'light' | 'dark' }) {
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Banner tone="info" icon="spark"
          title="Every colour in the product comes from one :root block in the stylesheet"
          body={
            <>
              There is no colour hard-coded in a component, a chart or an icon. Change{' '}
              <b>--brand-500</b>, <b>--brand-600</b> and <b>--brand-tint</b> in that block and
              every screen re-themes at once — navigation, buttons, pipeline pills, KPI tiles,
              charts and the focus ring. The dark theme redefines the same names, so it follows
              too.
            </>
          } />
      </div>

      <div className="grid g-2">
        <Card title="Brand ramp"
          sub="The Bayut green, from the pressed state through to the soft fills used for selected rows. --brand-500 is the primary.">
          <Swatches names={['--brand-700', '--brand-600', '--brand-500', '--brand-400', '--brand-300', '--brand-tint', '--brand-tint-2']} />
        </Card>

        <Card title="Gold accent"
          sub="Reserved for premium and verified marks, so it keeps its meaning. It is never used for magnitude in a chart.">
          <Swatches names={['--gold', '--gold-tint']} />
        </Card>

        <Card title="Categorical chart colours"
          sub={'Four, and only four. A fifth category is folded into "Other" rather than given a '
            + 'colour, because separation stops being reliable past four.'}>
          <Swatches names={['--cat-1', '--cat-2', '--cat-3', '--cat-4']} />
          <div style={{ marginTop: 12 }}>
            <Legend items={CAT.map((c, i) => ({ color: c, label: `Series ${i + 1}` }))} />
          </div>
        </Card>

        <Card title="Sequential chart colours"
          sub={'One hue in four steps, for magnitude across a single category — time in stage, '
            + 'load per person, a heat grid.'}>
          <Swatches names={['--seq-1', '--seq-2', '--seq-3', '--seq-4']} />
          <div style={{ marginTop: 12 }}>
            <Legend items={SEQ.map((c, i) => ({ color: c, label: `Step ${i + 1}` }))} />
          </div>
        </Card>

        <Card title="Appearance"
          sub="System follows the device. Light and dark pin it, and the choice is remembered against your profile.">
          <Seg action="theme.set" active={theme}
            options={[{ v: 'system', t: 'System' }, { v: 'light', t: 'Light' }, { v: 'dark', t: 'Dark' }]} />
          <p className="t-sub" style={{ marginTop: 11 }}>
            Currently showing the <b>{theme}</b> palette. Both themes define the same
            custom-property names, so a rebrand only has to be done once.
          </p>
        </Card>

        <Card title="Organisation" sub="Read from the organisation record.">
          <Kvs pairs={[
            ['Organisation', org.orgName],
            ['Legal entity', org.legalName],
            ['Country', org.country],
            ['Time zone', org.timezone],
            ['Weekend', fmt.list((org.weekendDays ?? []).map((d) => DAY_NAMES[d] ?? String(d)))],
            ['Currency', org.currency],
            ['Fiscal year starts', org.fiscalYearStart],
            ['Locales', `${org.locale} · ${org.secondLocale}`],
            ['Data retention', `${org.dataRetentionMonths} months`],
            ['Offer approval above', `${fmt.sar(org.offerApprovalThreshold)} / month`],
            ['Offers signed by', org.signedBy ?? '—'],
            ['ATS owner', org.atsOwner ?? '—'],
            ['HRIS of record', org.hrisName ?? '—'],
          ]} />
        </Card>
      </div>
    </>
  );
}

const DAY_NAMES: Record<number, string> = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday',
};

/* ── Organisation ────────────────────────────────────────────────────────── */
export function OrganisationPanel({ d, mayEdit }: { d: OrgPanel; mayEdit: boolean }) {
  const groups = [
    ...d.functions.map((f) => ({ f, rows: d.departments.filter((x) => x.functionId === f.id) })),
    { f: { id: null, name: 'Other', head: null, headTitle: null }, rows: d.departments.filter((x) => !x.functionId) },
  ].filter((g) => g.rows.length);

  const live = [...d.departments].filter((x) => x.live).sort((a, b) => b.live - a.live);

  return (
    <>
      <p className="t-sub" style={{ marginBottom: 14 }}>
        Departments are named exactly as the HR system names them (the headcount report) and
        grouped into functions for the company chart. Each carries its head — the default hiring
        manager for a new requisition — a code, a cost centre and its headcount on the report.{' '}
        {mayEdit
          ? 'Add one when a team is created; a department can be removed once it has no live requisition.'
          : 'Only an Admin can add or remove them.'}
      </p>

      <Card title="Departments" icon="grid" flush
        actions={
          <span className="row tight">
            <Chip tone="brand">{d.departments.length} departments · {d.functions.length} functions</Chip>
            {mayEdit && <Btn size="sm" variant="pri" action="dept.new" icon="plus" iconSize={13}>Add department</Btn>}
          </span>
        }
        foot={
          <span className="t-foot">
            A removed department disappears from filters and forms; closed requisitions that
            mention it keep its name. Open a department to see its chart on the Manpower plan.
          </span>
        }>
        {groups.map((g) => (
          <React.Fragment key={g.f.id ?? 'other'}>
            <div className="divider" style={{ margin: 0 }}>
              <span className="t-over">
                {g.f.name}
                {g.f.head && (
                  <span className="mut" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                    {' '}· {g.f.head}, {g.f.headTitle}
                  </span>
                )}
                <span className="mut" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                  {' '}· {g.rows.reduce((n, r) => n + r.colleagues, 0)} colleagues
                </span>
              </span>
            </div>
            <div className="list flush">
              {g.rows.map((r) => (
                <Li key={r.id} icon="grid"
                  title={<>{r.name} <span className="mono mut" style={{ fontSize: 11 }}>{r.code}</span></>}
                  sub={
                    <>
                      {r.head}{r.headTitle ? ` · ${r.headTitle}` : ''} · {r.colleagues} colleague
                      {r.colleagues === 1 ? '' : 's'}
                      {r.headcount != null && r.headcount !== r.colleagues ? ` (report: ${r.headcount})` : ''}
                      {r.joining ? ` · ${r.joining} joining` : ''} · {r.live} live requisition
                      {r.live === 1 ? '' : 's'} · {r.pipeline} in pipeline ·{' '}
                      {r.recruiters.length
                        ? `${fmt.list(r.recruiters.map((n) => n.split(' ')[0]))} recruit for it`
                        : 'no recruiter assigned'}
                    </>
                  }
                  right={
                    <span className="row tight">
                      {r.costCentre && <Chip>{r.costCentre}</Chip>}
                      {mayEdit && (
                        <>
                          <Btn size="xs" variant="out" action="dept.edit" v={r.id} icon="pencil" iconSize={12}>Edit</Btn>
                          <Btn size="xs" variant={r.live ? 'ghost' : 'danger'} action="dept.remove" v={r.id}
                            icon="trash" iconSize={12}
                            title={r.live ? 'Has live requisitions' : 'Remove'} />
                        </>
                      )}
                    </span>
                  }
                  action="go" v={`/manpower?dept=${r.id}`} />
              ))}
            </div>
          </React.Fragment>
        ))}
      </Card>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Live requisitions by department" icon="brief">
          {live.length ? (
            <HBars data={live.map((r) => ({
              label: r.name, value: r.live,
              note: r.pipeline ? `${fmt.int(r.pipeline)} in pipeline` : 'nobody in pipeline',
            }))} />
          ) : <Empty icon="brief" title="Nothing open" />}
        </Card>
        <Card title="Hiring managers" icon="users" flush
          sub="Every department head is a hiring manager by default; a requisition can name somebody else.">
          <div className="list flush">
            {d.hiringManagers.map((h) => (
              <Li key={h.name} avatar={h.name} title={h.name}
                sub={<>{h.title}{h.deptName ? ` · ${h.deptName}` : ''} · {h.interviews} interview{h.interviews === 1 ? '' : 's'} taken</>}
                right={<Chip>{h.requisitions} requisition{h.requisitions === 1 ? '' : 's'}</Chip>}
                action="go" v={`/jobs?q=${encodeURIComponent(h.name)}`} />
            ))}
            {!d.hiringManagers.length && <Empty icon="users" title="Nobody named on a live requisition" />}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ── Pipelines ───────────────────────────────────────────────────────────── */
export function PipelinesPanel({ d, mayEdit }: {
  d: { pipelines: PipelineRow[]; stageCount: number; jobs: number; overrides: number };
  mayEdit: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        {/* Nine, not ten. Applied and Sourced are two doors onto the same first
            position — a candidate comes through one of them, never both — so
            the spine a template may not reorder is nine long, even though ten
            stage keys exist and the count above says ten. */}
        <Banner tone="info" icon="board" title="The nine stages are a fixed spine"
          body={
            <>
              A template may rename a stage or switch it off; it can never reorder the spine or add
              a tenth stage, because conversion, time in stage and SLA breaches have to mean the
              same thing in every requisition and every report. Rejection is a <b>status</b> on the
              application rather than a stage, so the record still shows the stage a candidate had
              reached when they dropped out — a tenth stage would erase exactly that.
            </>
          } />
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <span className="t-sub">
          {d.pipelines.length} templates across {d.stageCount} spine stages · {fmt.int(d.jobs)}{' '}
          requisitions built from them
        </span>
        <span className="push" />
        {d.overrides
          ? (
            <>
              <Chip tone="warn">{d.overrides} SLA{d.overrides === 1 ? '' : 's'} overridden</Chip>
              {mayEdit && <Btn size="sm" variant="out" action="set.slaReset">Restore the defaults</Btn>}
            </>
          )
          : <Chip tone="ok">SLAs at their defaults</Chip>}
      </div>

      <div className="stack">
        {d.pipelines.map((p) => {
          const used = p.stages.filter((s) => !s.off);
          const off = p.stages.filter((s) => s.off);
          return (
            <Card key={p.id} title={p.name} flush
              actions={
                <>
                  <Chip>{used.length} of {d.stageCount} stages</Chip>
                  <Chip tone="brand">{p.jobs} requisition{p.jobs === 1 ? '' : 's'}</Chip>
                  <Chip>{p.endToEnd} d end to end</Chip>
                </>
              }
              sub={
                <>
                  {p.renamed
                    ? `Renames ${p.renamed} stage${p.renamed === 1 ? '' : 's'}`
                    : 'Uses the spine names as they are'}
                  {off.length
                    ? `, switches off ${fmt.list(off.map((s) => s.spineName))}`
                    : ', switches nothing off'}
                  . SLA changes here apply to <b>new applications</b>; the requisitions already
                  open keep the SLA they were opened with.
                </>
              }
              foot={
                <span className="t-foot">
                  End to end is the sum of the stage SLAs — the longest a candidate should wait if
                  every stage is worked inside its target.
                </span>
              }>
              <div className="list flush">
                {p.stages.map((s) => (
                  <Li key={s.key} icon={s.off ? 'minus' : 'check'} iconTone={s.off ? '' : 'brand'}
                    title={s.off ? <span className="mut">{s.spineName}</span> : s.name}
                    sub={s.off ? 'Switched off by this template'
                      : s.name !== s.spineName
                        ? <>Spine stage &ldquo;{s.spineName}&rdquo; renamed to &ldquo;{s.name}&rdquo;</>
                        : 'Spine stage, kept under its own name'}
                    right={s.off ? <span className="mut">no SLA</span> : (
                      <>
                        {s.sla !== s.defaultSla && <Chip tone="warn">was {s.defaultSla} d</Chip>}
                        <select className="inp"
                          style={{ width: 'auto', minWidth: 96, padding: '5px 9px', fontSize: 12.5 }}
                          data-act={`set.sla:${p.id}|${s.key}`} defaultValue={String(s.sla)}
                          disabled={!mayEdit}
                          aria-label={`SLA for ${s.name}`}>
                          {SLA_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>
                          ))}
                        </select>
                      </>
                    )} />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

const SLA_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 21, 30];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numberWord = (n: number) => WORDS[n] ?? String(n);

/* ── Automations ─────────────────────────────────────────────────────────── */
export type RuleRow = {
  id: string; name: string; description: string | null; trigger: string;
  actions: Array<Record<string, unknown>>; enabled: boolean; isSystem: boolean;
  /* The engine keeps these two on the rule as it runs; the detailed history
     lives in automation_runs and is read for the failure count. */
  lastRunAt: string | null; runs30d: number;
  stats: { runs: number; failed: number; lastAt: string | null };
};

export function AutomationsPanel({ rules, mayEdit, now }: {
  rules: RuleRow[]; mayEdit: boolean; now: Date;
}) {
  const on = rules.filter((r) => r.enabled);
  const runs = on.reduce((n, r) => n + r.runs30d, 0);
  const busiest = [...on].sort((a, b) => b.runs30d - a.runs30d)[0];
  const failing = rules.filter((r) => r.stats.failed > 0);

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Rules enabled" value={String(on.length)} unit={`/ ${rules.length}`}
          sub="a disabled rule keeps its history" />
        <Kpi label="Runs in the last 30 days" value={fmt.int(runs)}
          sub="across the enabled rules"
          def="Firings recorded in automation_runs — a count of firings, not of records changed." />
        <Kpi label="Most active rule"
          value={<span style={{ fontSize: 16 }}>{busiest ? busiest.name.split(' ').slice(0, 4).join(' ') : '—'}</span>}
          sub={busiest ? `${fmt.int(busiest.runs30d)} runs` : 'nothing has fired'} />
      </div>

      {/* A failure is something the prototype's automations could never have:
          they never ran. When one happens it is said out loud, in the place
          the reference already keeps a rule's standing. */}
      {!!failing.length && (
        <div style={{ marginBottom: 14 }}>
          <Banner tone="warn" icon="alert"
            title={`${failing.length} rule${failing.length === 1 ? ' has' : 's have'} failed in the last 30 days`}
            body={failing.map((r) => `${r.name} — ${r.stats.failed} failed of ${r.stats.runs}`).join('; ')} />
        </div>
      )}

      <Card title="Rules"
        sub={'The toggle takes effect immediately. Nothing is queued or batched — a rule that is '
          + 'off simply does not fire on its next trigger.'}>
        {rules.map((r) => (
          <SwitchRow key={r.id} label={r.name}
            sub={
              <>
                Trigger {r.trigger} · {r.description ?? r.actions.map((a) => String(a.type ?? '')).join(', ')} ·{' '}
                {fmt.int(r.runs30d)} run{r.runs30d === 1 ? '' : 's'} in 30 days · last ran{' '}
                {r.lastRunAt ? ago(r.lastRunAt, now) : 'never'}
              </>
            }
            on={r.enabled} action={mayEdit ? 'aut.toggle' : ''} v={r.id}
            right={
              <span className="row tight">
                {!!r.stats.failed && <Chip tone="bad">{r.stats.failed} failed</Chip>}
                {r.enabled ? <Chip tone="ok">On</Chip> : <Chip>Off</Chip>}
              </span>
            } />
        ))}
      </Card>
    </>
  );
}

/* ── Integrations ────────────────────────────────────────────────────────── */
const HEALTH: Record<string, [string, 'ok' | 'warn' | 'bad' | '']> = {
  ok: ['Healthy', 'ok'], degraded: ['Degraded', 'warn'], failing: ['Failing', 'bad'],
  unknown: ['Not checked', ''],
};

export function IntegrationsPanel({ d, mayEdit, now }: {
  d: { rows: IntegrationRow[]; connected: number; configuredInEnv: number };
  mayEdit: boolean; now: Date;
}) {
  const live = d.rows.filter((r) => r.envConfigured);
  const intended = d.rows.filter((r) => !r.envConfigured && r.state === 'connected');
  const off = d.rows.filter((r) => !r.envConfigured && r.state !== 'connected');

  const block = (title: string, sub: React.ReactNode, rows: IntegrationRow[], connected: boolean) => (
    <Card title={title} sub={sub} flush actions={<Chip tone={connected ? 'brand' : ''}>{rows.length}</Chip>}>
      {rows.length ? (
        <div className="list flush">
          {[...rows].sort((a, b) => a.name.localeCompare(b.name)).map((i) => (
            <Li key={i.id} icon="plug" iconTone={connected ? 'brand' : ''}
              title={i.name}
              sub={
                <>
                  {i.kind} · {i.detail}
                  {connected && <> · provider <b>{i.envProvider}</b>
                    {i.lastSyncAt ? ` · last sync ${ago(i.lastSyncAt, now)}` : ' · never synced'}</>}
                  {!connected && !!i.envMissing.length && (
                    <> · missing <span className="mono">{i.envMissing.join(', ')}</span></>
                  )}
                  {i.lastError && <> · last error: {i.lastError}</>}
                </>
              }
              right={
                <span className="row tight">
                  {connected
                    ? <Chip tone={HEALTH[i.health]?.[1] ?? ''}>{HEALTH[i.health]?.[0] ?? i.health}</Chip>
                    : <Chip tone="warn">Not configured</Chip>}
                  <Btn size="xs" variant={connected ? 'ghost' : 'out'}
                    action={connected && mayEdit ? 'set.conn' : ''} v={i.id}
                    disabled={!connected || !mayEdit}
                    title={connected
                      ? (mayEdit ? 'Stop using this integration' : 'Only an Admin may change this')
                      : `Set ${i.envMissing.join(', ') || 'the provider'} in the environment and restart — credentials are never entered here`}>
                    {connected ? 'Disable' : 'Not configured'}
                  </Btn>
                </span>
              } />
          ))}
        </div>
      ) : <Empty icon="plug" title="Nothing here" />}
    </Card>
  );

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Banner tone="info" icon="shield" title="Credentials live in the environment, not in this page"
          body={
            <>
              An integration is live when the process holds its credentials — nothing here can turn
              one on by flipping a flag. {d.connected} of {d.rows.length} are configured. Each one
              below names the environment variables it is waiting for, and every adapter refuses
              rather than pretending when they are missing.
            </>
          } />
      </div>

      {!!intended.length && (
        <div style={{ marginBottom: 14 }}>
          <Banner tone="warn" icon="alert"
            title={`${intended.length} system${intended.length === 1 ? ' is' : 's are'} marked connected but not configured`}
            body={`${intended.map((i) => i.name).join(', ')} — the record says connected and the environment has no credentials, so every call would fail. Set the variables named below, or mark the integration off.`} />
        </div>
      )}

      <div className="stack">
        {block('Live', 'The process holds credentials for these. Health and last sync come from the integration record.', live, true)}
        {block('Not configured', 'Available, and waiting on the environment. Nothing is exchanged from this page.', [...intended, ...off], false)}
      </div>
    </>
  );
}

/* ── Audit trail ─────────────────────────────────────────────────────────── */
export function AuditPanel({ d, filters, retentionMonths, now }: {
  d: { rows: AuditRow[]; total: number; actions: string[]; entities: string[] };
  filters: { q: string; action: string; entity: string };
  retentionMonths: number;
  now: Date;
}) {
  const cols: Array<Column<AuditRow>> = [
    {
      t: 'Actor',
      f: (a) => (
        <div className="row tight nowrap">
          <Avatar person={a.actorName ?? 'System'} size="s" />
          <span>
            <b>{a.actorName ?? 'System'}</b>
            {a.actorRole && <><br /><span className="t-foot">{a.actorRole}</span></>}
          </span>
        </div>
      ),
    },
    { t: 'Action', f: (a) => <span className="mono t-foot">{a.action}</span> },
    {
      t: 'Entity', cls: 'wrap',
      f: (a) => (
        <>
          {a.entity}
          {a.entityId && <><br /><span className="mono t-foot">{a.entityId}</span></>}
        </>
      ),
    },
    { t: 'What happened', cls: 'wrap', f: (a) => a.summary ?? <span className="mut">—</span> },
    { t: 'Reason', cls: 'wrap', f: (a) => a.reason ?? <span className="mut">—</span> },
    { t: 'Source', f: (a) => <span className="t-foot">{a.source ?? '—'}</span> },
    {
      t: 'When',
      f: (a) => <>{fmt.when(a.at)} <em className="mut">{ago(a.at, now)}</em></>,
    },
  ];

  const oldest = d.rows[d.rows.length - 1];
  const newest = d.rows[0];

  return (
    <>
      <div className="filters">
        <input className="inp grow" name="q" defaultValue={filters.q}
          data-act="set.audit.q" data-live="1" data-keep="audit"
          placeholder="Search the summary, the actor or the record id" autoComplete="off" />
        <select className="inp" data-act="set.audit.action" defaultValue={filters.action}>
          <option value="">Every action</option>
          {d.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="inp" data-act="set.audit.entity" defaultValue={filters.entity}>
          <option value="">Every record type</option>
          {d.entities.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="push" />
        <span className="t-foot">
          {fmt.int(d.total)} entr{d.total === 1 ? 'y' : 'ies'}, newest first
          {newest && oldest ? ` · ${fmt.date(oldest.at)} to ${fmt.date(newest.at)}` : ' · no range'}
          {' '}· retained {retentionMonths} months
        </span>
      </div>

      <Card flush title="Who did what"
        sub={'Written by the application inside the same transaction as the change itself. The '
          + 'table is append-only — an update or a delete on it is refused by the database, so '
          + 'nothing in this interface can edit or remove an entry.'}
        actions={<Btn size="sm" variant="ghost" action="data.export" v="audit" icon="dl" iconSize={13}>Export</Btn>}
        foot={
          <span className="t-foot">
            Showing the {fmt.int(d.rows.length)} most recent of {fmt.int(d.total)}. Each entry
            carries the before and the after of the record it changed, the reason given, where the
            change came from and a correlation id that ties one action's cascade together.
          </span>
        }>
        <Table cols={cols} rows={d.rows}
          emptyIcon="shield" emptyTitle="Nothing matches"
          emptySub="Clear a filter, or widen the search." />
      </Card>
    </>
  );
}

/* ── Data ────────────────────────────────────────────────────────────────── */
export function DataPanel({ d }: {
  d: {
    counts: TableCount[];
    org: Org;
    seed: { datasetClock: string | null; datasetAsOf: string | null; rebasedDays: number | null };
  };
}) {
  const total = d.counts.reduce((n, x) => n + x.n, 0);
  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Tables counted" value={fmt.int(d.counts.length)}
          sub="the ones a person would ask about" accent />
        <Kpi label="Rows" value={fmt.int(total)} sub="across those tables" />
        <Kpi label="Retention" value={fmt.int(d.org.dataRetentionMonths)} unit="months"
          sub="candidate records past it are anonymised"
          def="From the organisation record. The retention sweep runs in the worker and writes an audit entry for every record it touches." />
        <Kpi label="Dataset clock"
          value={<span style={{ fontSize: 16 }}>{d.seed.datasetClock ? fmt.date(d.seed.datasetClock) : 'live'}</span>}
          sub={d.seed.rebasedDays
            ? `seeded data shifted ${d.seed.rebasedDays} days forward`
            : 'no shift applied'}
          def="The demonstration dataset ships with a fixed 'today'. The seed moves every timestamp forward by whole days so that intervals are preserved and 'now' means now." />
      </div>

      <Banner tone="info" icon="shield" title="Where the data in this instance came from"
        body={
          <>
            Every row below is in PostgreSQL, written by the seed from the prototype&rsquo;s
            dataset{d.seed.datasetAsOf ? ` (as of ${fmt.date(d.seed.datasetAsOf)})` : ''} and by the
            application since. The people, salaries and notes are invented; the shape, the
            volumes and the relationships are the ones the product is designed for.
          </>
        } />

      <div style={{ marginTop: 14 }}>
        <Card flush title="What is in the database"
          foot={
            <span className="t-foot">
              Counted at the moment this page was rendered, not cached. Audit events and domain
              events only ever grow — the first is the record of what people did, the second is
              what the automations reacted to.
            </span>
          }>
          <Table
            cols={[
              { t: 'Table', f: (r: TableCount) => <b>{r.label}</b> },
              { t: '', f: (r: TableCount) => <span className="mono t-foot">{r.table}</span> },
              { t: 'Rows', n: true, f: (r: TableCount) => fmt.int(r.n) },
            ]}
            rows={d.counts} />
        </Card>
      </div>
    </>
  );
}
