import 'server-only';
import * as React from 'react';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  interviews, applications, candidates, jobs, jobStages, auditEvents, staff, departments,
} from '@/db/schema';
import { defineSheets, lookupSheet } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Card, Kvs, Dropzone } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { requireApplication } from '@/lib/authz';
import { CRIT, CRIT_LABEL, band, bandText, scoreFrom, isFlagged } from '@/lib/domain/ivreview';
import { importTemplate, IMPORT_COLUMNS } from '@/lib/services/manpower';
import { fmt, ago } from '@/lib/format';
import { depts } from './blocks';

/* ═════════════════════════════════════════════════════════════════════════════
   THE REST

   How an interview was run, the department import, the offer tab, the audit
   trail, the help panel and the shape of the database.

   The last two are unusual for a product to ship, and deliberate. A recruiter
   who wants to know what a number means should be able to find out without
   asking anybody, and an Admin who wants to know what is stored about a person
   should be able to read it rather than take it on trust.
   ═════════════════════════════════════════════════════════════════════════════*/

defineSheets({
  /* ── How the interview was run ────────────────────────────────────────── */
  'ivr.open': async (v, { viewer }) => {
    const [iv] = await db().select().from(interviews).where(eq(interviews.id, v)).limit(1);
    if (!iv) return null;
    await requireApplication(viewer, iv.applicationId, db());

    const [cand] = await db().select({ name: candidates.name }).from(candidates)
      .where(eq(candidates.id, iv.candidateId)).limit(1);
    const who = iv.interviewer ?? 'the interviewer';
    const ratings = iv.reviewerRatings ?? {};
    const score = iv.reviewerScore ?? (Object.keys(ratings).length ? scoreFrom(ratings) : null);

    /* Their other interviews in the last year, so a single score is read
       against how they usually run one rather than on its own. */
    const others = iv.interviewer
      ? rowsOf(await db().execute(sql`
        SELECT i.id, i.title, i.at, i.mode, i.reviewer_score, c.name AS candidate
          FROM ${interviews} i
          LEFT JOIN ${candidates} c ON c.id = i.candidate_id
         WHERE i.interviewer = ${iv.interviewer} AND i.id <> ${v}
           AND i.status <> 'cancelled' AND i.at > now() - interval '365 days'
         ORDER BY i.at DESC LIMIT 6`)) as Array<{
           id: string; title: string; at: string; mode: string;
           reviewer_score: number | null; candidate: string | null;
         }>
      : [];
    const [stats] = iv.interviewer
      ? rowsOf(await db().execute(sql`
        SELECT count(*) FILTER (WHERE reviewer_score IS NOT NULL)::int AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY reviewer_score)::int AS median
          FROM ${interviews}
         WHERE interviewer = ${iv.interviewer} AND status <> 'cancelled'
           AND at > now() - interval '365 days'`)) as Array<{ n: number; median: number | null }>
      : [{ n: 0, median: null }];

    const now = new Date();

    return {
      title: `How ${who} ran it`,
      aria: 'Interviewer review',
      wide: true,
      eyebrow: iv.title,
      sub: `${fmt.when(iv.at)} · ${iv.durationMin} min ${iv.mode}`
        + (Number(stats.n) > 1
          ? ` · ${who.split(/\s+/)[0]} has run ${stats.n} reviewed interviews in the last year, `
            + `median ${stats.median} of 100`
          : ''),
      body: (
        <div className="stack">
          <Card title="This interview" icon="target"
            actions={score != null ? <Chip tone={band(score)}>{score} of 100</Chip> : undefined}
            sub={iv.reviewedAt
              ? `${bandText(score)} · reviewed ${ago(iv.reviewedAt, now)}`
              : iv.recorded
                ? 'Recorded, not analysed yet.'
                : 'Not recorded — there is nothing to review.'}>
            {iv.reviewedAt ? (
              <>
                <div className="grid g-2" style={{ gap: 14 }}>
                  <div>
                    {CRIT.map(([k, label, hint]) => (
                      <div className="bar-row" key={k}>
                        <span className="bar-l" title={hint}>{label}</span>
                        <span className="bar">
                          <i style={{ width: `${((ratings[k] ?? 0) / 5) * 100}%` }} />
                        </span>
                        <b className="bar-v">{ratings[k] ?? '—'}</b>
                      </div>
                    ))}
                  </div>
                  <div>
                    <Kvs pairs={[
                      ['Strongest', iv.reviewerStrengths?.[0] ?? '—'],
                      ['To work on', iv.reviewerImprove?.[0] ?? '—'],
                      ['Analysed by', iv.reviewerModel ?? '—'],
                      iv.flags.length ? ['Flagged', iv.flags.join('; ')] : null,
                    ]} />
                  </div>
                </div>
                {isFlagged({ ratings, flags: iv.flags }) && (
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="warn" icon="alert" title="Worth a second look"
                      body={iv.flags.length
                        ? iv.flags.join('; ')
                        : 'Compliance scored two or less — read the recording before the next one.'} />
                  </div>
                )}
              </>
            ) : (
              <Empty icon="target" title="Nothing analysed yet"
                sub="The review is coaching from the recording — it says nothing about the candidate." />
            )}
          </Card>

          {!!others.length && (
            <Card title={`${who.split(/\s+/)[0]}’s other interviews`} icon="users" flush>
              <div className="list flush">
                {others.map((o) => (
                  <Li key={o.id} avatar={o.candidate ?? o.title} title={o.candidate ?? o.title}
                    sub={`${fmt.when(o.at)} · ${o.mode}`}
                    right={o.reviewer_score != null
                      ? <Chip tone={band(o.reviewer_score)}>{o.reviewer_score}</Chip>
                      : <Chip>Not analysed</Chip>}
                    action="ivr.open" v={o.id} />
                ))}
              </div>
            </Card>
          )}
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Close</Btn>
          <Sp />
          <Btn variant="out" action="drawer.open" v={iv.applicationId} icon="ext" iconSize={13}>
            Open {cand?.name.split(/\s+/)[0] ?? 'the candidate'}
          </Btn>
        </>
      ),
    };
  },

  /* ── The offer tab of the drawer, by its own name ─────────────────────── */
  'offer.open': async (v, ctx) => {
    const sheet = lookupSheet('drawer.open');
    return sheet ? sheet(`${v.split(':')[0]}:offer`, ctx) : null;
  },

  /* ── A department out of a spreadsheet ────────────────────────────────── */
  'mp.import': async (_v, { viewer }) => {
    if (!viewer.isAdmin) {
      return {
        title: 'New department from Excel',
        aria: 'Import structure',
        body: (
          <Banner tone="warn" icon="lock" title="Only an Admin imports a department"
            body="An import creates seats, and seats are headcount." />
        ),
      };
    }
    const fns = await db().select({ id: sql<string>`id`, name: sql<string>`name` })
      .from(sql`functions`).orderBy(sql`sort_order`);

    return {
      title: 'New department from Excel',
      aria: 'Import structure',
      eyebrow: 'Manpower plan',
      wide: true,
      sub: 'One row per seat. Download the template, fill it in Excel, and drop it here — the chart '
        + 'is built from it. Reporting lines are titles, so the rows are planted heads first; a row '
        + 'whose manager is a name nobody in the sheet has is reported rather than hung off the top.',
      body: (
        <>
          <Dropzone action="mp.importFile" accept=".xlsx,.csv"
            title="Drop the department sheet here"
            sub="Excel (.xlsx) or CSV — one row per position" />

          <div className="divider"><span className="t-over">Columns</span></div>
          <div className="tw">
            <table className="mono" style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {IMPORT_COLUMNS.map((c) => (
                    <th key={c.key} style={{
                      textAlign: 'left', padding: '4px 8px',
                      borderBottom: '1px solid var(--hairline)',
                    }}>{c.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importTemplate().slice(0, 3).map((row, i) => (
                  <tr key={i}>
                    {IMPORT_COLUMNS.map((c) => (
                      <td key={c.key} style={{ padding: '4px 8px', color: 'var(--ink-3)' }}>
                        {String(row[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-foot" style={{ marginTop: 8 }}>
            {IMPORT_COLUMNS.map((c) => `${c.key} — ${c.note}`).join('. ')}.
          </p>
        </>
      ),
      foot: (
        <>
          <Btn variant="out" action="mp.template" icon="dl" iconSize={14}>
            Download the Excel template
          </Btn>
          <Sp />
          <Btn variant="ghost" action="sheet.close">Close</Btn>
        </>
      ),
    };
  },

  'mp.template': async () => ({
    title: 'The import template',
    aria: 'Import template',
    eyebrow: 'Manpower plan',
    wide: true,
    sub: 'Copy this into a spreadsheet, or save it as a .csv and open it in Excel. One row per seat.',
    body: (
      <>
        <pre className="mono" style={{ whiteSpace: 'pre', fontSize: '12.5px', lineHeight: 1.6 }}>
          {[
            IMPORT_COLUMNS.map((c) => c.key).join(','),
            ...importTemplate().map((r) => IMPORT_COLUMNS.map((c) => r[c.key] ?? '').join(',')),
          ].join('\n')}
        </pre>
        <div className="divider"><span className="t-over">What each column means</span></div>
        <div className="list flush">
          {IMPORT_COLUMNS.map((c) => (
            <Li key={c.key} icon="hash" title={c.key} sub={c.note} />
          ))}
        </div>
      </>
    ),
    foot: (
      <>
        <Sp />
        <Btn variant="out" action="sheet.close">Done</Btn>
      </>
    ),
  }),

  /* ── The audit trail ──────────────────────────────────────────────────── */
  'audit.open': async (v, { viewer }) => {
    if (!viewer.isAdmin) {
      return {
        title: 'Audit trail',
        aria: 'Audit trail',
        body: (
          <Banner tone="warn" icon="lock" title="The trail is an Admin’s to read"
            body="It records who did what to whom, which is not something everybody should see." />
        ),
      };
    }

    /* `entityType:entityId` narrows it; nothing shows the last of everything. */
    const [kind, id] = v ? v.split(':') : [];
    const where = id
      ? sql`entity_type = ${kind} AND entity_id = ${id}`
      : kind
        ? sql`entity_type = ${kind}`
        : sql`true`;
    const trail = rowsOf(await db().execute(sql`
      SELECT id, at, actor_name, action::text AS action, summary, entity_type, entity_label,
             before, after, reason, request_id
        FROM ${auditEvents}
       WHERE ${where}
       ORDER BY at DESC
       LIMIT 200`)) as Array<{
         id: string; at: string; actor_name: string | null; action: string; summary: string;
         entity_type: string; entity_label: string | null;
         before: unknown; after: unknown; reason: string | null; request_id: string | null;
       }>;

    const now = new Date();

    return {
      title: 'Audit trail',
      aria: 'Audit trail',
      eyebrow: id ? `${kind} · ${id}` : 'Everything',
      wide: true,
      sub: `${trail.length} entr${trail.length === 1 ? 'y' : 'ies'}, newest first. The trail is `
        + 'append-only — nothing in the product can edit or delete a line of it.',
      body: trail.length ? (
        <div className="list flush">
          {trail.map((t) => (
            <Li key={t.id} icon="db" title={`${t.actor_name ?? 'The system'} ${t.summary}`}
              sub={`${fmt.when(t.at)} · ${ago(t.at, now)} · ${t.entity_type}`
                + `${t.entity_label ? ` · ${t.entity_label}` : ''}`
                + `${t.reason ? ` · ${t.reason}` : ''}`}
              right={<Chip>{t.action}</Chip>} />
          ))}
        </div>
      ) : (
        <Empty icon="db" title="Nothing recorded yet"
          sub="Every meaningful write puts a line here." />
      ),
    };
  },

  /* ── Help ─────────────────────────────────────────────────────────────── */
  'help.open': async () => ({
    title: 'How this works',
    aria: 'Help',
    wide: true,
    eyebrow: 'Bayut KSA Talent Acquisition',
    sub: 'The short version of the rules the product actually enforces, so that a number on a chart '
      + 'means the same thing to everybody reading it.',
    body: (
      <div className="stack">
        <Card title="The pipeline" icon="board">
          <p className="lead">
            Nine stages, in a fixed order. A pipeline template may rename a stage or leave one out;
            nothing reorders them. Rejection is a status, not a tenth column — a disqualified
            application keeps the stage it reached, which is what makes conversion honest.
          </p>
        </Card>
        <Card title="What a requisition is" icon="brief">
          <p className="lead">
            A requisition hires into a coded seat in the manpower plan. Raising one for a seat that
            does not exist yet creates it as <b>requested</b>; it becomes approved headcount when
            the requisition clears its approval chain, and not a moment before.
          </p>
        </Card>
        <Card title="The gate on the final interview" icon="shield">
          <p className="lead">
            A manager-and-above requisition cannot book its final interview until the behaviour test
            is back and every earlier scorecard is in. A requisition that runs a sales pitch cannot
            book its final until the pitch is scored. Both are checked on the server, so the gate
            holds however the action is fired.
          </p>
        </Card>
        <Card title="The offer" icon="file">
          <p className="lead">
            An offer walks an approval chain, then Onboarding verifies the filled letter, and only
            then can it be sent. A letter that has gone out never changes — a re-negotiation is
            version two, with its own approvals. Acceptance issues the employee number, once.
          </p>
        </Card>
        <Card title="What you can see" icon="lock">
          <p className="lead">
            Every query and every command applies your scope. A hiring manager sees their own
            requisitions; a participant sees only what they have been asked to do. Knowing an
            address does not get you past it.
          </p>
        </Card>
        <Card title="When something is not configured" icon="plug">
          <p className="lead">
            The product never reports a message as sent when nothing can send it. A message with no
            provider sits in the outbox marked <b>not configured</b>, with the setting that is
            missing named. A file with no malware scanner is marked <b>skipped</b>, never clean.
          </p>
        </Card>
      </div>
    ),
    foot: (
      <>
        <Sp />
        <Btn variant="out" action="data.schema" icon="db" iconSize={13}>What is stored</Btn>
        <Btn variant="ghost" action="sheet.close">Close</Btn>
      </>
    ),
  }),

  /* ── What is stored ───────────────────────────────────────────────────── */
  'data.schema': async (_v, { viewer }) => {
    if (!viewer.isAdmin) {
      return {
        title: 'What is stored',
        aria: 'Data',
        body: (
          <Banner tone="warn" icon="lock" title="An Admin reads this"
            body="It lists what the platform keeps about candidates and staff." />
        ),
      };
    }

    const tables = rowsOf(await db().execute(sql`
      SELECT c.relname AS name,
             obj_description(c.oid) AS note,
             c.reltuples::bigint AS rows,
             (SELECT count(*)::int FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = c.relname) AS cols
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`)) as Array<{
         name: string; note: string | null; rows: number; cols: number;
       }>;

    return {
      title: 'What is stored',
      aria: 'Data',
      eyebrow: 'The database',
      wide: true,
      sub: `${tables.length} tables. Row counts are the planner’s estimate, which is what makes this `
        + 'cheap enough to open; they are approximate until the table is next analysed.',
      body: (
        <div className="list flush">
          {tables.map((t) => (
            <Li key={t.name} icon="db" title={t.name}
              sub={`${t.cols} column${t.cols === 1 ? '' : 's'}`
                + `${Number(t.rows) >= 0 ? ` · about ${fmt.int(Math.max(0, Number(t.rows)))} rows` : ''}`
                + `${t.note ? ` · ${t.note}` : ''}`} />
          ))}
        </div>
      ),
      foot: (
        <>
          <Sp />
          <Btn variant="out" action="audit.open">Read the audit trail</Btn>
          <Btn variant="ghost" action="sheet.close">Close</Btn>
        </>
      ),
    };
  },
});
