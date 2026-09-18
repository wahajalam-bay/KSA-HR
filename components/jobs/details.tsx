import * as React from 'react';
import { Card, Kvs, Li, Chip, Btn, Empty, JobStatus, Priority, Avatar } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import { can } from '@/lib/authz';
import { ROUTES, routeMeta, isConfidential, sourcingLabel } from '@/lib/domain/sourcing';
import { STAGE_KEYS, DEFAULT_NAMES } from '@/lib/domain/stages';
import { ApprovalHistory } from '@/components/approvals/banner';
import type { Approval } from '@/lib/queries/approvals';
import type { JobDetailExtras } from '@/lib/queries/job-tabs';
import type { Viewer } from '@/lib/auth/session';

/* The Details tab: the record itself, who owns it, how it gets filled, the loop
   it runs, the job description and the questions it asks. */

export function DetailsTab({ job, viewer, approval, extras, now }: {
  job: any; viewer: Viewer; approval: Approval | null; extras: JobDetailExtras; now: Date;
}) {
  const live = (job.channels ?? []).filter((c: any) => c.state === 'live').map((c: any) => c.channel);
  const mayEdit = can(viewer, 'job.edit');

  return (
    <div className="stack">
      <JobDescriptionCard job={job} mayEdit={mayEdit} now={now} />
      <BudgetCard job={job} mayEdit={mayEdit} />

      <div className="grid g-2">
        <Card title="The requisition">
          <Kvs pairs={[
            ['Status', <JobStatus key="s" status={job.status} />],
            ['Priority', <Priority key="p" priority={job.priority} />],
            ['Department', job.dept?.name],
            [
              job.hiringManagers.length > 1 ? 'Hiring managers' : 'Hiring manager',
              <React.Fragment key="hm">
                {job.hiringManagers.map((h: any, i: number) => (
                  <React.Fragment key={h.id}>
                    {i > 0 && <br />}
                    <strong>{h.name}</strong>
                    {h.title && <em className="mut"> · {h.title}</em>}
                    {h.isLead && job.hiringManagers.length > 1 && <> <em className="mut">(lead)</em></>}
                  </React.Fragment>
                ))}
              </React.Fragment>,
            ],
            ['Location', job.loc?.office],
            ['Openings', `${job.filled} filled of ${job.openings}`],
            ['Salary band', `${fmt.sar(job.salaryMin)} – ${fmt.sar(job.salaryMax)} / month`],
            ['Opened', fmt.date(job.openedOn)],
            ['Target start', fmt.date(job.targetStartOn)],
            ['Position code', job.positionCode
              ? <button key="pc" className="linkbtn mono" data-act="pos.open" data-v={job.seat?.id ?? ''}>{job.positionCode}</button>
              : <span key="pc" className="mut">Not in the plan</span>],
            ['Headcount ref', <span key="hr" className="mono">{job.headcountRef ?? ''}</span>],
            ['Budget', <React.Fragment key="b">
              <BudgetChip job={job} />
              {job.budgeted === false && <> <em className="mut">addition to plan</em></>}
            </React.Fragment>],
            ['Approved by', job.approvedBy ?? ''],
            job.closedOn ? ['Closed', fmt.date(job.closedOn)] : null,
          ]} />
        </Card>

        <HiringTeamCard job={job} mayEdit={mayEdit} interviewsBy={extras.interviewsBy} />

        <Card
          title="Pipeline template"
          sub={<>{job.pipeline?.name ?? 'No template'} — the nine stages are a fixed spine; a template
            renames or skips, never reorders.</>}
          flush
        >
          <div className="list flush">
            {STAGE_KEYS.map((k) => {
              const on = job.stages.find((s: any) => s.stageKey === k);
              const standard = DEFAULT_NAMES[k];
              return (
                <Li key={k} icon={on ? 'check' : 'minus'} iconTone={on ? 'brand' : ''}
                  title={on ? on.name : <span className="mut">{standard}</span>}
                  sub={on
                    ? (on.name !== standard ? `renamed from “${standard}” · SLA ${on.sla}d` : `SLA ${on.sla} days`)
                    : 'skipped by this template'}
                  right={on ? <Chip>SLA {on.sla}d</Chip> : undefined} />
              );
            })}
          </div>
        </Card>

        <SourcingCard job={job} viewer={viewer} counts={extras.routeCounts} live={live} />

        {job.sourcing.linkedin && (
          <Card title="Where it is posted" flush
            foot={<span className="t-foot">Partner access via the incumbent ATS.</span>}>
            <div className="list flush">
              {(job.channels ?? []).map((c: any) => (
                <Li key={c.id} icon="ext" title={c.channel}
                  sub={c.state === 'live' ? 'Live' : c.state === 'expired' ? 'Expired with the requisition' : 'Not posted'}
                  right={<Chip tone={c.state === 'live' ? 'ok' : ''}>
                    {c.state === 'live' ? 'Live' : c.state === 'expired' ? 'Expired' : 'Off'}
                  </Chip>} />
              ))}
            </div>
          </Card>
        )}

        {approval && <ApprovalHistory approval={approval} viewer={viewer} now={now} publishedTo={live} />}
      </div>

      <QuestionsCard job={job} mayEdit={mayEdit} answered={extras.answered} />
    </div>
  );
}

/* ── The job description ───────────────────────────────────────────────────
   The careers site and the offer-letter context both read from this, so the
   card carries the description itself and, above it, who the hire answers to —
   the line a hiring manager checks first. */
function JobDescriptionCard({ job, mayEdit, now }: { job: any; mayEdit: boolean; now: Date }) {
  const summary: string = job.descSummary ?? '';
  const responsibilities: string[] = job.descResponsibilities ?? [];
  const requirements: string[] = job.descRequirements ?? [];
  const benefits: string[] = job.descBenefits ?? [];
  const skills: any[] = job.skills ?? [];
  const empty = !summary && !responsibilities.length && !requirements.length;
  const hms: any[] = job.hiringManagers ?? [];

  return (
    <Card
      title="Job description" icon="book"
      actions={
        <span className="row tight">
          {job.descUpdatedAt && <Chip>Updated {ago(job.descUpdatedAt, now)}</Chip>}
          {mayEdit && <Btn size="xs" variant="out" action="jd.edit" v={job.id} icon="pencil" iconSize={12}>Edit</Btn>}
        </span>
      }
      sub={
        <>
          Hiring manager{hms.length > 1 ? 's' : ''}:{' '}
          {hms.map((h, i) => (
            <React.Fragment key={h.id}>
              {i > 0 && ', '}
              <b>{h.name}</b>
              {h.title ? ` (${h.title})` : ''}
              {h.isLead && hms.length > 1 ? ' — lead' : ''}
            </React.Fragment>
          ))}
          {' · '}{job.dept?.name}{' · '}{job.loc?.office}
        </>
      }
    >
      {empty ? (
        <Empty icon="book" title="No description yet"
          sub="Write the summary, responsibilities and requirements — they appear on the careers site and in the offer letter context." />
      ) : (
        <div className="jd">
          <p className="lead">{summary}</p>
          {!!responsibilities.length && (
            <><h4>What you will do</h4><ul>{responsibilities.map((x, i) => <li key={i}>{x}</li>)}</ul></>
          )}
          {!!requirements.length && (
            <><h4>What you bring</h4><ul>{requirements.map((x, i) => <li key={i}>{x}</li>)}</ul></>
          )}
          {!!benefits.length && (
            <><h4>Benefits</h4><ul>{benefits.map((x, i) => <li key={i}>{x}</li>)}</ul></>
          )}
          {!!skills.length && (
            <><h4>Skills</h4><div className="wrap">{skills.map((s: any) => (
              <Chip key={s.id ?? s.skill}>{s.skill}</Chip>
            ))}</div></>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Budget ────────────────────────────────────────────────────────────────
   Inside the approved headcount plan, or an addition to it. A requisition that
   is not budgeted has to say why: Finance and the GM read that line before
   approving, and Insights counts both. */
export function BudgetChip({ job }: { job: any }) {
  return job.budgeted === false
    ? <Chip tone="warn">Not budgeted</Chip>
    : <Chip tone="ok">Budgeted</Chip>;
}

function BudgetCard({ job, mayEdit }: { job: any; mayEdit: boolean }) {
  const midpoint = Math.round(((Number(job.salaryMin) + Number(job.salaryMax)) / 2) * 12 * 1.25 * (job.openings || 1));
  return (
    <Card
      title="Budget" icon="coin"
      actions={<BudgetChip job={job} />}
      sub={job.budgeted === false
        ? 'This seat is not in the approved headcount plan — it was justified and approved as an addition.'
        : 'This seat is funded in the approved headcount plan.'}
      foot={mayEdit
        ? <Btn size="sm" variant="ghost" action="job.edit" v={job.id} icon="pencil" iconSize={13}>Edit the requisition</Btn>
        : undefined}
    >
      <Kvs pairs={[
        ['Status', job.budgeted === false
          ? <><b>Not budgeted</b> — addition to plan</>
          : <><b>Budgeted</b> — inside the plan</>],
        ['Headcount reference', <span key="hr" className="mono">{job.headcountRef || '—'}</span>],
        ['Openings', fmt.int(job.openings)],
        ['Annual cost at band midpoint', fmt.sar(midpoint)],
      ]} />
      {job.budgetNote ? (
        <>
          <div className="divider"><span className="t-over">Justification</span></div>
          <p className="lead" style={{ margin: 0 }}>{job.budgetNote}</p>
        </>
      ) : job.budgeted === false ? (
        <p className="t-foot" style={{ marginTop: 8 }}>
          No justification recorded yet — add one on the requisition.
        </p>
      ) : null}
    </Card>
  );
}

/* ── The hiring team ───────────────────────────────────────────────────────
   The desk first — recruiter, sourcer, coordinator — then the hiring managers,
   each with how many interviews they have actually taken here, then whoever
   else sits on the panel. */
function HiringTeamCard({ job, mayEdit, interviewsBy }: {
  job: any; mayEdit: boolean; interviewsBy: Record<string, number>;
}) {
  const hms: any[] = job.hiringManagers ?? [];
  return (
    <Card
      title="The hiring team" flush
      actions={mayEdit
        ? <Btn size="xs" variant="out" action="hm.add" v={job.id} icon="uplus" iconSize={12}>Add hiring manager</Btn>
        : undefined}
      foot={
        <span className="t-foot">
          Every hiring manager here can be picked to run an interview when it is arranged; the lead is the
          default and the one the approval chain and the offer letter refer to.
        </span>
      }
    >
      <div className="list flush">
        {job.recruiter && (
          <Li avatar={job.recruiter} title={job.recruiter.name} sub="Owning recruiter"
            right={<Chip tone="brand">Owner</Chip>} action="go" v={`/team/${job.recruiter.id}`} />
        )}
        {job.sourcer && (
          <Li avatar={job.sourcer} title={job.sourcer.name} sub="Sourcing" action="go" v={`/team/${job.sourcer.id}`} />
        )}
        {job.coordinator && (
          <Li avatar={job.coordinator} title={job.coordinator.name} sub="Scheduling" action="go" v={`/team/${job.coordinator.id}`} />
        )}
        {hms.map((h: any) => {
          const n = interviewsBy[h.name] ?? 0;
          return (
            <Li key={h.id} avatar={h.name}
              title={<>{h.name}{h.isLead && <> <Chip tone="brand">Lead</Chip></>}</>}
              sub={`${h.title || 'Hiring manager'}${h.email ? ` · ${h.email}` : ''} · ${n} interview${n === 1 ? '' : 's'} on this requisition`}
              right={mayEdit ? (
                <span className="row tight">
                  {!h.isLead && <Btn size="xs" variant="ghost" action={`hm.lead:${job.id}`} v={h.id}>Make lead</Btn>}
                  {hms.length > 1 && (
                    <Btn size="xs" variant="ghost" className="danger" action={`hm.remove:${job.id}`} v={h.id}
                      ariaLabel="Remove" icon="trash" iconSize={12} />
                  )}
                </span>
              ) : undefined} />
          );
        })}
        {(job.panel ?? []).map((p: string) => (
          <Li key={p} avatar={p} title={p} sub="Interview panel" />
        ))}
      </div>
    </Card>
  );
}

/* ── How it is being filled ────────────────────────────────────────────────
   The routes this requisition runs, and what each has actually produced. A
   route switched off that still brought people keeps its count: those people
   stay where they are. */
function SourcingCard({ job, viewer, counts, live }: {
  job: any; viewer: Viewer; counts: JobDetailExtras['routeCounts']; live: string[];
}) {
  const confidential = isConfidential(job.sourcing);
  const posted = live.includes('LinkedIn');
  const stray = counts.filter((c) => !job.sourcing[c.key] && c.n);
  const all = counts.reduce((n, c) => n + c.n, 0);
  const strayTotal = stray.reduce((n, c) => n + c.n, 0);

  return (
    <Card
      title="How it is being filled" icon="search" flush
      actions={confidential ? <Chip tone="violet">Confidential</Chip> : undefined}
      sub={job.sourcing.note ? job.sourcing.note : `${sourcingLabel(job.sourcing)}.`}
      foot={
        <>
          <span className="t-foot">
            {fmt.int(all)} applicants in all, every one of them on the board.
            {!!stray.length && ` ${fmt.int(strayTotal)} arrived by a route that is switched off now — they stay where they are.`}
          </span>
          {can(viewer, 'job.publish') && job.sourcing.linkedin && !posted && (
            <>
              <span className="sp" />
              <Btn size="sm" variant="out" action="job.post" v={job.id} icon="zap" iconSize={13}>
                Post to the company page
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="list flush">
        {ROUTES.map((r) => {
          const on = !!job.sourcing[r.key];
          const c = counts.find((x) => x.key === r.key) ?? { n: 0, live: 0, hired: 0 };
          return (
            <Li key={r.key} icon={on ? (r.icon as any) : 'minus'} iconTone={on ? 'brand' : ''}
              title={on ? r.name : <span className="mut">{r.name}</span>}
              sub={on
                ? `${r.blurb}${r.key === 'linkedin' ? ` · ${posted ? 'live on the company page' : 'not posted yet'}` : ''}`
                : (c.n ? `Switched off, but ${c.n} came this way before` : 'Not in use on this requisition')}
              right={c.n
                ? <Chip tone={on ? 'info' : ''}>{c.n}{c.live ? ` · ${c.live} live` : ''}</Chip>
                : undefined} />
          );
        })}
      </div>
    </Card>
  );
}

/* ── Application questions ─────────────────────────────────────────────────
   What the careers form asks on this requisition. A knockout answer flags the
   application rather than rejecting it: a person is not turned away by a
   dropdown. */
const QTYPES: Record<string, string> = {
  yesno: 'Yes / No', choice: 'Single choice', multi: 'Multiple choice',
  short: 'Short answer', long: 'Long answer', number: 'Number',
};
const qtype = (t: string): string => QTYPES[t] ?? t;
const qIcon = (t: string) => (t === 'yesno' ? 'check' : t === 'number' ? 'hash' : t === 'long' ? 'book' : 'list');

function QuestionRow({ q, i, right }: { q: any; i: number; right?: React.ReactNode }) {
  return (
    <div className="li q-row">
      <span className={`ic ${q.knockout ? 'warn' : ''}`}><Icon name={qIcon(q.type) as any} size={15} /></span>
      <span className="bd">
        <b><span className="mut">{i + 1} ·</span> {q.text}</b>
        <span>
          {qtype(q.type)}
          {q.options?.length ? ` · ${q.options.join(' / ')}` : ''}
          {q.required ? ' · required' : ' · optional'}
          {q.knockout ? ` · knockout unless “${q.knockout}”` : ''}
        </span>
      </span>
      <span className="tr"><span className="row tight">{right}</span></span>
    </div>
  );
}

function QuestionsCard({ job, mayEdit, answered }: { job: any; mayEdit: boolean; answered: number }) {
  const qs: any[] = job.questions ?? [];
  return (
    <Card
      title="Application questions" icon="list" flush
      actions={
        <span className="row tight">
          <Chip tone="brand">{qs.length} question{qs.length === 1 ? '' : 's'}</Chip>
          {mayEdit && (
            <>
              <Btn size="xs" variant="out" action="jq.pick" v={job.id} icon="list" iconSize={12}>From the bank</Btn>
              <Btn size="xs" variant="pri" action="jq.new" v={job.id} icon="plus" iconSize={12}>Add a question</Btn>
            </>
          )}
        </span>
      }
      sub={`Asked on the careers form when somebody applies to this requisition; the answers land on the application. ${answered} applicant${answered === 1 ? '' : 's'} answered so far.`}
      foot={<span className="t-foot">Knockout questions flag an application in red when the answer misses; nothing is rejected automatically.</span>}
    >
      {qs.length ? (
        <div className="list flush">
          {qs.map((q, i) => (
            <QuestionRow key={q.id} q={q} i={i} right={mayEdit ? (
              <>
                <Btn size="xs" variant="ghost" action={`jq.move:${job.id}:up`} v={q.id}
                  ariaLabel="Move up" icon="arrU" iconSize={12} disabled={i === 0} />
                <Btn size="xs" variant="ghost" action={`jq.move:${job.id}:down`} v={q.id}
                  ariaLabel="Move down" icon="arrD" iconSize={12} disabled={i === qs.length - 1} />
                <Btn size="xs" variant={q.required ? 'out' : 'ghost'} action={`jq.req:${job.id}`} v={q.id}>
                  {q.required ? 'Required' : 'Optional'}
                </Btn>
                <Btn size="xs" variant="out" action={`jq.edit:${job.id}`} v={q.id} icon="pencil" iconSize={12} />
                <Btn size="xs" variant="ghost" className="danger" action={`jq.remove:${job.id}`} v={q.id}
                  ariaLabel="Remove" icon="trash" iconSize={12} />
              </>
            ) : (q.required ? <Chip tone="warn">Required</Chip> : null)} />
          ))}
        </div>
      ) : (
        <Empty icon="list" title="No questions yet"
          sub="Applicants are asked nothing beyond their résumé. Add from the bank or write your own." />
      )}
    </Card>
  );
}
