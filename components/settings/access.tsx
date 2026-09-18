import * as React from 'react';
import {
  Card, Chip, Empty, Banner, Li, Avatar, Btn, Kvs, Table, SwitchRow, type Column,
} from '@/components/ui/primitives';
import { Badge, Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import { label as scoreLabel, tone as scoreTone } from '@/lib/domain/score';

/* The merge fields the pitch brief fills in, as one string. */
const MERGE_FIELD_LINE = ['first_name', 'job_title', 'project_name', 'client', 'brief',
  'task', 'duration', 'when', 'recruiter_name'].map((f) => `{{${f}}}`).join(' ');

/* ─────────────────────────────────────────────────────────────────────────────
   Access, approvals, the teams a joiner is announced to, and the sales pitch.

   Access is the panel that decides what everything else may read, so it says
   the scope of every account in words rather than a code: every requisition,
   only the ones they are named on, or a hand-picked list.
   ───────────────────────────────────────────────────────────────────────────*/

export type AccountRow = {
  id: string; kind: string; name: string; title: string | null; email: string;
  role: string; status: string; hasPassword: boolean;
  lastLoginAt: string | null; source: string | null;
  scopeKind: string; scopeJobIds: string[]; scopeOwn: boolean;
  photo: string | null; hue: number | null;
  /* Whoever this account *is* — the staff id for a member of the team, the
     account id for everybody else. The drawn portrait seeds on it, so the same
     person is the same face here as on their profile. */
  portraitId: string; gender: string | null;
};

const ROLE_GROUPS: Array<[string, string]> = [
  ['staff', 'TA team'],
  ['hiring_manager', 'Hiring managers'],
  ['participant', 'Interview participants'],
];

export const scopeLabel = (a: AccountRow): string => {
  if (a.scopeKind === 'all') return 'Every position';
  if (a.scopeKind === 'own') return 'Their own positions';
  const n = a.scopeJobIds.length;
  return `${n} position${n === 1 ? '' : 's'}${a.scopeOwn ? ' + their own' : ''}`;
};

export function AccessPanel({ accounts, mayEdit, now }: {
  accounts: AccountRow[]; mayEdit: boolean; now: Date;
}) {
  const active = accounts.filter((a) => a.status !== 'disabled' && a.hasPassword).length;
  const chip = (a: AccountRow) => (a.status === 'disabled'
    ? <Chip tone="bad">Disabled</Chip>
    : a.status === 'invited' || !a.hasPassword
      ? <Chip tone="warn">Invited — no password yet</Chip>
      : <Chip tone="ok">Active</Chip>);

  return (
    <>
      <p className="t-sub" style={{ marginBottom: 14 }}>
        Only people on this list can sign in. The TA team is here automatically; a hiring manager
        or participant is added when named on a department, a requisition or an interview — or by
        hand below. Each sets a password at first sign-in; an Admin can reset it, disable an
        account or remove it. Access is per position: use the <b>positions</b> button on a row to
        say which requisitions that account can view — every requisition, only the ones they are
        named on, or a list you pick.
      </p>

      <Card title="Accounts" icon="key" flush
        actions={
          <span className="row tight">
            <Chip tone="brand">{accounts.length} accounts · {active} active</Chip>
            {mayEdit && <Btn size="sm" variant="pri" action="acc.invite" icon="uplus" iconSize={13}>Invite someone</Btn>}
          </span>
        }
        foot={
          <span className="t-foot">
            Passwords are scrypt hashes checked on the server; the session is a row in the
            database and the cookie carries only a signed reference to it. An account can also
            sign in through OIDC, in which case no password is stored at all.
          </span>
        }>
        {ROLE_GROUPS.map(([role, label]) => {
          const rows = accounts.filter((a) => a.role === role)
            .sort((a, b) => a.name.localeCompare(b.name));
          if (!rows.length) return null;
          return (
            <React.Fragment key={role}>
              <div className="divider" style={{ margin: 0 }}>
                <span className="t-over">
                  {label}
                  <span className="mut" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                    {' '}· {rows.length}
                  </span>
                </span>
              </div>
              <div className="list flush">
                {rows.map((a) => (
                  <Li key={a.id}
                    avatar={{ id: a.portraitId, name: a.name, photo: a.photo,
                      hue: a.hue ?? undefined, gender: a.gender }}
                    title={a.name}
                    sub={
                      <>
                        {a.email} · {a.title ?? label}
                        {a.source && a.kind !== 'staff' ? ` · ${a.source}` : ''}
                        {a.lastLoginAt ? ` · last sign-in ${ago(a.lastLoginAt, now)}` : ' · never signed in'}
                      </>
                    }
                    right={
                      <span className="row tight">
                        {chip(a)}
                        <Btn size="xs" variant={a.scopeKind === 'jobs' ? 'out' : 'ghost'}
                          action="acc.scope" v={a.id} icon="brief" iconSize={12}
                          title="Which positions this account can view">
                          {scopeLabel(a)}
                        </Btn>
                        {mayEdit && (
                          <>
                            <Btn size="xs" variant="ghost" action="acc.reset" v={a.id} icon="key" iconSize={12}
                              title="Reset the password — they choose a new one at next sign-in">Reset</Btn>
                            {a.kind !== 'staff' && (
                              <>
                                <Btn size="xs" variant="ghost" action="acc.toggle" v={a.id}>
                                  {a.status === 'disabled' ? 'Enable' : 'Disable'}
                                </Btn>
                                {/* Keeps the padding of the labelled buttons beside it, which
                                    is what holds this row the width the prototype has. */}
                                <Btn size="xs" variant="ghost" className="danger" action="acc.remove" v={a.id}
                                  icon="trash" iconSize={12} ariaLabel="Remove" square={false} />
                              </>
                            )}
                          </>
                        )}
                      </span>
                    } />
                ))}
              </div>
            </React.Fragment>
          );
        })}
      </Card>
    </>
  );
}

/* ── Approvals ───────────────────────────────────────────────── */
export type FlowStep = {
  id: string; label: string; approverType: string;
  /** How the kind of approver is described, and who it resolves to. */
  typeLabel: string; who: string | null; title: string | null;
  conditionText: string | null;
  auto: boolean; ordinal: number;
};

export type Flow = {
  id: string; subject: string; name: string; isActive: boolean;
  publishOnApprove: boolean; publishChannels: string[]; requireVerification: boolean;
  updatedAt: string | null; updatedByName: string | null;
  steps: FlowStep[];
  pending: number;
  /** The chain as it comes out for one real record, conditions applied. */
  preview: Array<{ label: string; who: string; auto: boolean }>;
  previewOf: string | null;
};

export type ApprovalsData = {
  flows: Flow[];
  pendingRequisitions: number;
  pendingOffers: number;
  lettersAwaitingVerification: number;
};

const CHANNELS = ['LinkedIn', 'Bayut Careers', 'Bayt.com', 'Indeed'];

function FlowCard({ f, mayEdit, now }: { f: Flow; mayEdit: boolean; now: Date }) {
  const isReq = f.subject === 'requisition';
  const note = isReq
    ? 'A requisition is born a draft. Submitting it walks this chain in order; the Admin always has the last word, and only when the chain closes is it published.'
    : 'An offer walks this chain after it is drafted. Once approved, the Onboarding Specialist verifies the filled letter, and only then can it be sent for signature.';

  return (
    <Card title={f.name} icon="shield" flush
      actions={
        <span className="row tight">
          <Chip tone="brand">{f.steps.length} step{f.steps.length === 1 ? '' : 's'}</Chip>
          {f.pending ? <Chip tone="warn">{f.pending} waiting</Chip> : null}
          {mayEdit && (
            <Btn size="sm" variant="pri" action={`apf.stepEdit:${f.id}`} v="new" icon="plus" iconSize={13}>
              Add a step
            </Btn>
          )}
        </span>
      }
      sub={note}
      foot={
        <span className="t-foot">
          Last changed {f.updatedAt ? ago(f.updatedAt, now) : '—'}
          {f.updatedByName ? ` by ${f.updatedByName}` : ''}. Records already in flight keep the
          steps they were submitted with.
        </span>
      }>
      <div className="list flush">
        {f.steps.map((st, i) => (
          <div className="li step-row" key={st.id}>
            <span className={`ic ${st.auto ? '' : 'brand'}`}>
              <Icon name={st.auto ? 'zap' : 'shield'} size={15} />
            </span>
            <span className="bd">
              <b><span className="mut">{i + 1} ·</span> {st.label}</b>
              <span>
                {st.typeLabel}
                {st.who && st.who !== '—' && st.approverType !== 'hiring_manager' && st.approverType !== 'dept_head'
                  ? ` — ${st.who}` : ''}
                {st.title && st.approverType !== 'role' ? `, ${st.title}` : ''}
                {' · '}{st.conditionText ?? 'Always'}
                {st.auto ? ' · recorded automatically' : ''}
              </span>
            </span>
            <span className="tr">
              <span className="row tight">
                {mayEdit ? (
                  <>
                    <Btn size="xs" variant="ghost" icon="arrU" iconSize={12}
                      action={`apf.move:${f.id}:up`} v={st.id} disabled={i === 0} title="Move up" />
                    <Btn size="xs" variant="ghost" icon="arrD" iconSize={12}
                      action={`apf.move:${f.id}:down`} v={st.id}
                      disabled={i === f.steps.length - 1} title="Move down" />
                    <Btn size="xs" variant="out" action={`apf.stepEdit:${f.id}`} v={st.id}
                      icon="pencil" iconSize={12}>Edit</Btn>
                    <Btn size="xs" variant="ghost" className="danger" action={`apf.stepRemove:${f.id}`}
                      v={st.id} icon="trash" iconSize={12} title="Remove" />
                  </>
                ) : (
                  <Chip tone={st.auto ? '' : 'warn'}>{st.auto ? 'Auto' : 'Needs approval'}</Chip>
                )}
              </span>
            </span>
          </div>
        ))}
        {!f.steps.length && (
          <div className="li">
            <span className="bd">
              <span className="mut">
                No steps — {isReq
                  ? 'the Admin step is still applied automatically.'
                  : 'offers are approved on submission.'}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="divider"><span className="t-over">Options</span></div>
      <div style={{ padding: '0 2px' }}>
        {isReq ? (
          <>
            <SwitchRow label="Publish when the chain closes"
              sub={`Approving the last step posts to ${fmt.list(f.publishChannels)} and opens the board.`}
              on={f.publishOnApprove} action={mayEdit ? 'apf.publish' : ''} v={f.id} />
            <div className="row tight" style={{ padding: '4px 14px 8px', flexWrap: 'wrap' }}>
              <span className="t-foot" style={{ marginRight: 6 }}>Channels:</span>
              {CHANNELS.map((ch) => (
                <label className="chip" key={ch}>
                  <input type="checkbox" data-act={`apf.channel:${f.id}`} data-v={ch}
                    defaultChecked={f.publishChannels.includes(ch)} disabled={!mayEdit} />
                  {ch}
                </label>
              ))}
            </div>
          </>
        ) : (
          <SwitchRow label="Onboarding verification before sending"
            sub="The filled offer letter must be verified by the Onboarding Specialist (or an Admin) before e-signature. Always on."
            on title="Fixed by policy — a letter cannot be sent unverified" />
        )}
      </div>

      {!!f.preview.length && (
        <>
          <div className="divider"><span className="t-over">Applied to {f.previewOf}</span></div>
          <div className="wrap" style={{ padding: '0 16px 16px' }}>
            {f.preview.map((st, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon name="arrR" size={12} />}
                <Chip tone={st.auto ? '' : 'brand'}>
                  {i + 1} · {st.label} — {st.who.split(' ')[0]}{st.auto ? ' (auto)' : ''}
                </Chip>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function ApprovalsPanel({ d, mayEdit, now }: {
  d: ApprovalsData; mayEdit: boolean; now: Date;
}) {
  return (
    <>
      <p className="t-sub" style={{ marginBottom: 14 }}>
        Two chains, edited here and applied everywhere: who signs off a new requisition before it
        is published, and who signs off an offer before the Onboarding Specialist verifies the
        letter. Steps run in order; a step can apply only when a condition holds.
        {mayEdit ? '' : ' Only an Admin can change them.'}
      </p>

      <div className="tiles tiles-3" style={{ marginBottom: 14 }}>
        <button className="tile" data-act="go" data-v="/jobs?status=pending_approval">
          <Badge name="brief" size={16} />
          <b className="tl-v">{fmt.int(d.pendingRequisitions)}</b>
          <span className="tl-l">Requisitions in the chain</span>
        </button>
        <button className="tile" data-act="go" data-v="/candidates?tab=pipeline&stage=offer">
          <Badge name="file" size={16} />
          <b className="tl-v">{fmt.int(d.pendingOffers)}</b>
          <span className="tl-l">Offers in the chain</span>
        </button>
        <button className="tile" data-act="offer.queue">
          <Badge name="shield" size={16} />
          <b className="tl-v">{fmt.int(d.lettersAwaitingVerification)}</b>
          <span className="tl-l">Letters awaiting verification</span>
        </button>
      </div>

      <div className="stack">
        {d.flows.map((f) => <FlowCard key={f.id} f={f} mayEdit={mayEdit} now={now} />)}
      </div>
    </>
  );
}

/* ── Notified teams ──────────────────────────────────────────────────────── */
export type NotifiedTeam = {
  id: string; key: string; short: string; name: string; deptId: string | null;
  deptName: string | null; purpose: string; ask: string;
  onJoining: boolean; onFile: boolean;
  contacts: Array<{ id: string; name: string; email: string; role: string | null; isPrimary: boolean }>;
};

const TEAM_ICON: Record<string, string> = {
  it: 'laptop', hr: 'badge', training: 'star', facilities: 'board',
};

export function TeamsPanel({ teams, mayEdit }: { teams: NotifiedTeam[]; mayEdit: boolean }) {
  const fileTeams = teams.filter((t) => t.onFile).map((t) => t.short);
  return (
    <>
      <Banner tone="info" icon="handshake" title="Who hears about a new joiner"
        body={
          <>
            When the TA team confirms a joining date, everyone ticked on the joiner&rsquo;s record
            gets an e-mail — from this list. The joiner file goes to the teams marked below. Add
            the people by name and address; a department head is not always the right recipient.
          </>
        } />

      <div className="grid g-2">
        {teams.map((t) => (
          <Card key={t.id} title={t.short} icon={(TEAM_ICON[t.key] ?? 'board') as never}
            actions={
              <span className="row tight">
                {t.onJoining ? <Chip tone="ok">On the joining notice</Chip> : <Chip>Off by default</Chip>}
                {t.onFile && <Chip tone="brand">Gets the file</Chip>}
              </span>
            }
            sub={<>{t.deptName ?? t.name}{t.deptId ? '' : ' — no department linked'} · {t.purpose}</>}
            foot={mayEdit
              ? (
                <>
                  <Btn size="sm" variant="out" action="tm.add" v={t.id} icon="uplus" iconSize={13}>Add someone</Btn>
                  <Btn size="sm" variant="ghost" action={`tm.edit:${t.id}`} icon="gear" iconSize={13}>Team settings</Btn>
                  <span className="sp" />
                  <span className="t-foot">{t.contacts.length} recipient{t.contacts.length === 1 ? '' : 's'}</span>
                </>
              )
              : <span className="t-foot">{t.contacts.length} recipient{t.contacts.length === 1 ? '' : 's'}</span>}>
            {t.contacts.length ? (
              <div className="list flush">
                {t.contacts.map((c) => (
                  <Li key={c.id} avatar={c.name}
                    title={<>{c.name}{c.isPrimary && <> <Chip tone="brand">Primary</Chip></>}</>}
                    sub={<>{c.role ? `${c.role} · ` : ''}<span className="mono">{c.email}</span></>}
                    right={mayEdit ? (
                      <span className="row tight">
                        {!c.isPrimary && (
                          <Btn size="xs" variant="ghost" action={`tm.primary:${t.id}`} v={c.id}>Make primary</Btn>
                        )}
                        <Btn size="xs" variant="ghost" action={`tm.edit:${t.id}`} v={c.id} icon="pencil" iconSize={12} />
                        <Btn size="xs" variant="ghost" className="danger" action={`tm.remove:${t.id}`} v={c.id}
                          icon="trash" iconSize={12} title="Remove" />
                      </span>
                    ) : null} />
                ))}
              </div>
            ) : (
              <p className="t-foot">Nobody listed — the notice cannot reach this team.</p>
            )}
            <div className="divider"><span className="t-over">What they are asked</span></div>
            <p className="t-foot" style={{ margin: 0 }}>{t.ask}</p>
          </Card>
        ))}
      </div>

      <Card title="How it is used" icon="shield">
          <Kvs pairs={[
            ['Joining date confirmed', 'Every ticked team gets the joiner, the role, the start date and its own instruction — the primary contact on To, the rest on Cc.'],
            ['Joiner file sent', `The teams marked as receiving the file: ${fmt.list(fileTeams) || 'none'}. It carries the onboarding form, the verified documents and the joining date.`],
            ['Where it happens', 'Onboarding → open a joiner → Joining date, and Send the joiner’s file.'],
            ['Who may send', 'The TA team. Hiring managers and interview participants can see their joiners but never send these notices.'],
        ]} />
      </Card>
    </>
  );
}

/* ── Sales pitch ────────────────────────────────────────────────── */
export type PitchProject = {
  id: string; name: string; who: string | null; client: string | null;
  durationMin: number; prepHours: number;
  criteria: Array<{ key: string; name: string; hint?: string; max: number }>;
  active: boolean;
  /** Requisitions currently configured to use it, and pitches run from it. */
  onJobs: number; runs: number;
};

export type PitchJob = {
  id: string; title: string; deptName: string; projectName: string | null;
  leadHours: number; channels: string[];
  onStage: number; pitched: number; medianScore: number | null;
};

export type PitchSettings = {
  projects: PitchProject[];
  config: {
    leadHours: number; channels: string[]; gateFinal: boolean;
    waTemplate: string; emailSubject: string; emailBody: string;
    updatedAt: string | null;
  } | null;
  jobs: PitchJob[];
  jobsTotal: number;
  runs: number;
};

const CHANNEL_WORD = (c: string) => (c === 'whatsapp' ? 'WhatsApp' : 'E-mail');

export function PitchPanel({ d, mayEdit, now }: {
  d: PitchSettings; mayEdit: boolean; now: Date;
}) {
  const k = d.config;
  const live = d.projects.filter((p) => p.active).length;

  const cols: Array<Column<PitchJob & { _act?: string; _v?: string }>> = [
    { t: 'Requisition', cls: 'wrap', f: (j) => <>{j.title}<br /><span className="t-foot">{j.deptName}</span></> },
    { t: 'Project', cls: 'wrap', f: (j) => <span className="t-sub">{j.projectName ?? '—'}</span> },
    {
      t: 'Brief',
      f: (j) => (
        <span className="t-sub">
          {j.leadHours}h before · {j.channels.map((c) => (c === 'whatsapp' ? 'WhatsApp' : 'e-mail')).join(' + ')}
        </span>
      ),
    },
    { t: 'On the stage', n: true, f: (j) => fmt.int(j.onStage) },
    { t: 'Pitched', n: true, f: (j) => fmt.int(j.pitched) },
    {
      t: 'Median score', n: true,
      f: (j) => (j.medianScore == null ? '—'
        : <Chip tone={scoreTone(j.medianScore)}>{scoreLabel(j.medianScore)}</Chip>),
    },
  ];

  return (
    <>
      <p className="t-sub" style={{ marginBottom: 14 }}>
        The Sales Pitch is an optional stage: a recruiter switches it on for a position that sells,
        picks one of these projects, and the brief goes to the candidate&rsquo;s WhatsApp and
        e-mail before the call. Everything below is what the candidate reads and what the
        assistant scores against — change it here and every requisition using the project follows.
      </p>

      <Card title="The projects" icon="target" flush
        actions={
          <span className="row tight">
            <Chip tone="brand">{live} live · {fmt.int(d.runs)} pitches run</Chip>
            {mayEdit && <Btn size="sm" variant="pri" action="pp.new" icon="plus" iconSize={13}>New project</Btn>}
          </span>
        }
        foot={
          <span className="t-foot">
            A retired project stays on the requisitions already using it and drops out of the
            picker for new ones.
          </span>
        }>
        <div className="list flush">
          {d.projects.map((x) => (
            <Li key={x.id} icon="brief" iconTone={x.active ? 'brand' : ''}
              title={<>{x.name}{!x.active && <span className="mut" style={{ fontWeight: 500 }}> · retired</span>}</>}
              sub={
                <>
                  {x.who ?? (x.client ?? '').split(',')[0]} · {x.durationMin} min · brief {x.prepHours}h ahead ·{' '}
                  {x.criteria.length} criteria · on {x.onJobs} requisition{x.onJobs === 1 ? '' : 's'} ·{' '}
                  {fmt.int(x.runs)} run
                </>
              }
              right={mayEdit ? (
                <span className="row tight">
                  <Btn size="xs" variant="ghost" action="pp.edit" v={x.id} icon="pencil" iconSize={12}>Edit</Btn>
                  <Btn size="xs" variant="ghost" action="pp.copy" v={x.id} icon="copy" iconSize={12} title="Duplicate" />
                  <Btn size="xs" variant="ghost" action="pp.toggle" v={x.id}>{x.active ? 'Retire' : 'Bring back'}</Btn>
                </span>
              ) : <Chip tone={x.active ? 'ok' : ''}>{x.active ? 'Live' : 'Retired'}</Chip>}
              action="pp.edit" v={x.id} />
          ))}
          {!d.projects.length && (
            <Empty icon="target" title="No projects yet"
              sub="A pitch needs something to sell — add the first project." />
          )}
        </div>
      </Card>

      <div style={{ marginTop: 14 }}>
        <Card title="How the brief goes out" icon="mail"
          actions={mayEdit ? <Btn size="sm" variant="out" action="pp.cfg" icon="pencil" iconSize={13}>Edit the messages</Btn> : null}
          foot={
            <span className="t-foot mergeline">
              {/* Both children are elements, so each carries its own line
                  height — see the note in app/styles/04-parity.css. */}
              <span>{'Merge fields: '}</span>
              <span className="mono">{MERGE_FIELD_LINE}</span>
            </span>
          }>
          <div className="grid g-2" style={{ gap: 14 }}>
            <div>
              <Kvs pairs={[
                ['Sent', k ? `${k.leadHours} hours before the call, by default` : 'Not configured'],
                ['Channels', k ? fmt.list(k.channels.map(CHANNEL_WORD)) : '—'],
                ['The final interview', k
                  ? (k.gateFinal ? 'waits for the pitch to be scored' : 'does not wait for the pitch')
                  : '—'],
                ['Last changed', k?.updatedAt ? ago(k.updatedAt, now) : '—'],
              ]} />
            </div>
            <div>
              <div className="t-over" style={{ marginBottom: 6 }}>WhatsApp</div>
              <p className="t-foot mut">
                {k ? k.waTemplate.slice(0, 260) : '—'}{k && k.waTemplate.length > 260 ? '…' : ''}
              </p>
              <div className="t-over" style={{ margin: '10px 0 6px' }}>E-mail subject</div>
              <p className="t-foot mut">{k?.emailSubject ?? '—'}</p>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card flush title="Requisitions running a pitch" icon="brief"
          actions={<span className="t-foot">{d.jobs.length} of {d.jobsTotal}</span>}
          foot={
            <span className="t-foot">
              The switch lives on the requisition — Jobs → the requisition → Edit — so the recruiter
              decides position by position.
            </span>
          }>
          <Table cols={cols}
            rows={[...d.jobs].sort((a, b) => a.title.localeCompare(b.title))
              .map((j) => ({ ...j, _act: 'go', _v: `/jobs/${j.id}` }))}
            emptyIcon="brief" emptyTitle="No requisition is running a pitch yet"
            emptySub="Switch it on when you open a requisition for a role that sells." />
        </Card>
      </div>
    </>
  );
}
