import 'server-only';
import * as React from 'react';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  offers, offerTemplates, offerLetterEdits, applications, candidates, jobs, staff,
} from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Card, Kvs } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { requireApplication } from '@/lib/authz';
import {
  letterContext, offerOf, mayVerify, SENT_STATES, DECLINE_REASONS,
} from '@/lib/services/offers';
import {
  offerLetter, sendReadiness, MERGE_SOURCE, TERM_FIELDS,
} from '@/lib/services/offer-letter';
import { fmt, ago } from '@/lib/format';
import { depts } from './blocks';

/* ═════════════════════════════════════════════════════════════════════════════
   THE OFFER SHEETS

   The letter queue, the editor, the verification, the decline, a new version,
   and the two that belong to the templates in Settings.

   One rule shapes all of them: a letter that has gone out never changes. The
   editor refuses to open on a sent offer and points at "make version two"
   instead — the candidate holds a document, and the database will not rewrite
   it behind them (db/migrations/0001_integrity.sql says the same thing again,
   because a rule worth stating is worth enforcing twice).
   ═════════════════════════════════════════════════════════════════════════════*/

const isSent = (state: string) => (SENT_STATES as readonly string[]).includes(state);

/** The offer, its candidate and its requisition in one row. */
async function about(offerId: string) {
  const [row] = rowsOf(await db().execute(sql`
    SELECT o.id, o.application_id, o.job_id, o.state::text AS state, o.version,
           o.base_monthly, o.housing, o.transport, o.annual_bonus_pct, o.start_date,
           o.template_id, o.template_name, o.verified_at, o.verified_by,
           c.name AS candidate, j.title, j.salary_min, j.salary_max, j.family
      FROM ${offers} o
      JOIN ${candidates} c ON c.id = o.candidate_id
      JOIN ${jobs} j ON j.id = o.job_id
     WHERE o.id = ${offerId}`)) as Array<{
       id: string; application_id: string; job_id: string; state: string; version: number;
       base_monthly: number; housing: number; transport: number; annual_bonus_pct: number;
       start_date: string; template_id: string | null; template_name: string | null;
       verified_at: string | null; verified_by: string | null;
       candidate: string; title: string; salary_min: number; salary_max: number; family: string;
     }>;
  return row ?? null;
}

const templates = () => db().select().from(offerTemplates)
  .where(isNull(offerTemplates.archivedAt)).orderBy(asc(offerTemplates.name));

defineSheets({
  /* ── Everything waiting to be checked ─────────────────────────────────── */
  'offer.queue': async (_v, { viewer }) => {
    const queue = rowsOf(await db().execute(sql`
      SELECT o.id, o.application_id, o.template_name, o.created_at,
             c.name AS candidate, c.photo, c.hue, j.title,
             (SELECT count(*)::int FROM ${offerLetterEdits} e WHERE e.offer_id = o.id) AS edits
        FROM ${offers} o
        JOIN ${candidates} c ON c.id = o.candidate_id
        JOIN ${jobs} j ON j.id = o.job_id
       WHERE o.state = 'approved' AND o.verified_at IS NULL
       ORDER BY o.created_at`)) as Array<{
         id: string; application_id: string; template_name: string | null; created_at: string;
         candidate: string; photo: string | null; hue: number; title: string; edits: number;
       }>;

    const now = new Date();
    const [onb] = await db().select({ name: staff.name }).from(staff)
      .where(and(eq(staff.role, 'onboarding'), sql`${staff.status} = 'active'`)).limit(1);
    const may = mayVerify(viewer);

    return {
      title: 'Offer letters awaiting verification',
      aria: 'Letter queue',
      eyebrow: 'Onboarding',
      wide: true,
      sub: `${queue.length} approved offer${queue.length === 1 ? '' : 's'} whose filled letter has `
        + `not been checked. ${may
          ? 'Open one, correct what is wrong, and mark it verified — then the recruiter can send it.'
          : `${onb?.name ?? 'The Onboarding Specialist'} or an Admin verifies each letter before it can be sent.`}`,
      body: queue.length ? (
        <div className="list flush">
          {queue.map((o) => (
            <Li key={o.id} avatar={{ name: o.candidate, photo: o.photo, hue: o.hue }}
              title={o.candidate}
              sub={`${o.title} · ${o.template_name ?? 'no template'} · approved ${ago(o.created_at, now)}${
                Number(o.edits) ? ` · ${o.edits} correction${Number(o.edits) === 1 ? '' : 's'}` : ''}`}
              right={<Chip tone="warn">Ready to check</Chip>}
              action="offer.open" v={o.application_id} />
          ))}
        </div>
      ) : (
        <Empty icon="check" title="Nothing waiting"
          sub="Every approved offer has a verified letter." />
      ),
    };
  },

  /* ── Correcting the letter ────────────────────────────────────────────── */
  'offer.edit': async (v, { viewer }) => {
    const o = await about(v);
    if (!o) return null;
    await requireApplication(viewer, o.application_id, db());

    if (!mayVerify(viewer)) {
      return {
        title: 'Edit offer',
        aria: 'Edit offer',
        body: (
          <Banner tone="warn" icon="lock" title="Only Onboarding or an Admin edits an offer letter"
            body="The letter is the document the candidate signs; correcting it is one desk’s job so
              that the corrections are all in one hand." />
        ),
      };
    }
    if (isSent(o.state)) {
      return {
        title: `Offer — ${o.candidate}`,
        aria: 'Edit offer',
        eyebrow: o.title,
        body: (
          <Banner tone="info" icon="lock" title="That letter has gone out"
            body="The letter the candidate holds cannot change. A re-negotiation makes version two,
              which starts as a draft and needs verifying again." />
        ),
        foot: (
          <>
            <Btn variant="ghost" action="sheet.close">Close</Btn>
            <Sp />
            <Btn variant="pri" action="offer.reviseConfirm" v={v}>Make version {o.version + 1}</Btn>
          </>
        ),
      };
    }

    const x = await letterContext(v, db());
    const L = offerLetter(x.letter);
    const used = [...new Set(
      [...String(L.src).matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]),
    )];
    const editable = used.filter((k) => !TERM_FIELDS.includes(k));
    const tpls = await templates();

    return {
      title: `Edit offer — ${o.candidate}`,
      aria: 'Edit offer',
      wide: true,
      eyebrow: o.title,
      sub: 'Check every field against the requisition and the signed approval. Saving clears the '
        + 'verification until you re-verify.',
      body: (
        <>
          <div className="divider" style={{ marginTop: 0 }}><span className="t-over">Terms</span></div>
          <div className="grid g-3">
            <Field label="Monthly basic (SAR)" name="baseMonthly" type="number"
              value={o.base_monthly} min={0} step={100}
              help={`Band ${fmt.sarK(o.salary_min)} – ${fmt.sarK(o.salary_max)}`} />
            <Field label="Housing (SAR)" name="housing" type="number" value={o.housing}
              min={0} step={100} help="Policy: 25% of basic" />
            <Field label="Transport (SAR)" name="transport" type="number" value={o.transport}
              min={0} step={100} />
            <Field label="Annual bonus (% of basic)" name="annualBonusPct" type="number"
              value={o.annual_bonus_pct} min={0} step={5} />
            <Field label="Start date" name="startDate" type="date" value={o.start_date} />
            <Field label="Template" name="templateId" type="select" value={o.template_id ?? ''}
              options={tpls.map((t) => ({ v: t.id, t: t.name }))} />
          </div>

          <div className="divider">
            <span className="t-over">
              Merge fields in this letter ({editable.length} editable)
            </span>
          </div>
          <p className="t-foot" style={{ margin: '-4px 0 10px' }}>
            Values below are what the platform filled in. Correct any that are wrong — the change is
            recorded against your name. {TERM_FIELDS.filter((k) => used.includes(k)).length} salary
            and date fields follow the terms above.
          </p>
          <div className="grid g-2">
            {editable.map((k) => (
              <Field key={k} label={k.replace(/_/g, ' ')} name={`f_${k}`} value={L.vals[k] ?? ''}
                className={L.vals[k] == null ? 'miss' : undefined}
                placeholder={L.vals[k] == null ? 'Unresolved — type a value' : undefined}
                help={x.offer.fieldOverrides?.[k] != null
                  ? 'Edited by hand'
                  : MERGE_SOURCE[k] ?? 'Not in the merge dictionary'} />
            ))}
          </div>

          <details className="fold" style={{ marginTop: 14 }} open={L.edited}>
            <summary>
              Letter wording {L.edited
                ? '(edited by hand)'
                : '(template text — edit only if the wording itself must change)'}
            </summary>
            <Field label="Letter" name="wording" type="textarea" rows={16} value={L.src}
              help="Keep {{merge_fields}} in braces so they keep following the terms." />
          </details>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="out" action="offer.editSave" v={v}>Save</Btn>
          <Btn variant="pri" action="offer.verifyConfirm" v={v} icon="check" iconSize={13}>
            Save and mark verified
          </Btn>
        </>
      ),
    };
  },

  /* ── The verification itself ──────────────────────────────────────────── */
  'offer.verify': async (v, { viewer }) => {
    const o = await about(v);
    if (!o) return null;
    await requireApplication(viewer, o.application_id, db());

    if (!mayVerify(viewer)) {
      return {
        title: 'Verify the offer letter',
        aria: 'Verify offer',
        body: (
          <Banner tone="warn" icon="lock" title="Only Onboarding or an Admin verifies an offer"
            body="Verification is the statement that every figure in the letter matches the approved
              offer, so it belongs to one desk." />
        ),
      };
    }

    const x = await letterContext(v, db());
    const L = offerLetter(x.letter);
    const R = sendReadiness(x.offer.state, L, null);
    const blocking = R.checks.find((c) => !c.ok && c.k !== 'approved' && c.k !== 'verified');
    const [{ edits }] = rowsOf(await db().execute(sql`
      SELECT count(*)::int AS edits FROM ${offerLetterEdits} WHERE offer_id = ${v}`)) as Array<{ edits: number }>;

    return {
      title: 'Verify the offer letter',
      aria: 'Verify offer',
      eyebrow: o.candidate,
      body: (
        <>
          {blocking ? (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="bad" icon="alert" title={blocking.t}
                body="Fix that before verifying — a verified letter is a statement that it is right." />
            </div>
          ) : (
            <p className="lead">
              You confirm that every figure, date and name in the filled letter matches the approved
              offer and the requisition.
            </p>
          )}
          <Kvs pairs={[
            ['Basic', fmt.sar(o.base_monthly)],
            ['Total monthly', fmt.sar(o.base_monthly + o.housing + o.transport)],
            ['Start date', fmt.date(o.start_date)],
            ['Template', o.template_name ?? '—'],
            ['Corrections so far', String(edits)],
          ]} />
          <div className="form" style={{ marginTop: 12 }}>
            <Field label="Note (optional)" name="note" type="textarea" rows={3} className="wide"
              placeholder="e.g. Start date confirmed with the hiring manager." />
          </div>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          {!blocking && (
            <Btn variant="pri" action="offer.verifyConfirm" v={v} icon="check" iconSize={13}>
              Confirm verification
            </Btn>
          )}
        </>
      ),
    };
  },

  /* ── Recording a decline ──────────────────────────────────────────────── */
  'offer.decline': async (v, { viewer }) => {
    const o = await about(v);
    if (!o) return null;
    await requireApplication(viewer, o.application_id, db());
    const [existing] = await db().select().from(offers).where(eq(offers.id, v)).limit(1);

    return {
      title: `${o.candidate} declined`,
      aria: 'Record a decline',
      eyebrow: o.title,
      sub: 'The reason is what makes this useful later — Insights → Offers counts them, and a '
        + 'pattern of counter-offers or package declines is something the team can act on.',
      body: (
        <div className="form">
          <Field label="Reason" name="why" type="select" className="wide"
            value={existing?.responseReason ?? DECLINE_REASONS[0]}
            options={DECLINE_REASONS.map((x) => ({ v: x, t: x }))}
            help="The main reason, as the candidate gave it." />
          <Field label="What they said" name="note" type="textarea" rows={3} className="wide"
            value={existing?.responseNote ?? ''}
            placeholder="e.g. Their employer matched the basic and added a retention bonus." />
          <Field label="How it came" name="source" type="select"
            value={existing?.responseSource ?? 'call'}
            options={[
              { v: 'call', t: 'On a call' }, { v: 'email', t: 'By e-mail' },
              { v: 'whatsapp', t: 'On WhatsApp' }, { v: 'no answer', t: 'No answer at all' },
            ]} />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="danger" action="offer.declineSave" v={v} icon="x" iconSize={14}>
            Record the decline
          </Btn>
        </>
      ),
    };
  },

  /* ── A new version ────────────────────────────────────────────────────── */
  'offer.revise': async (v, { viewer }) => {
    const o = await about(v);
    if (!o) return null;
    await requireApplication(viewer, o.application_id, db());

    return {
      title: `Version ${o.version + 1}`,
      aria: 'Revise the offer',
      eyebrow: `${o.candidate} · ${o.title}`,
      sub: 'A re-negotiated offer is a new version, not an edit. Version '
        + `${o.version} stays exactly as it was — including the letter the candidate holds — and `
        + 'the new one starts as a draft that walks the approval chain again.',
      body: (
        <>
          <Kvs pairs={[
            ['Current version', `v${o.version} · ${o.state.replace('_', ' ')}`],
            ['Basic', fmt.sar(o.base_monthly)],
            ['Total monthly', fmt.sar(o.base_monthly + o.housing + o.transport)],
            ['Start date', fmt.date(o.start_date)],
          ]} />
          <p className="t-foot" style={{ marginTop: 12 }}>
            <Icon name="shield" size={12} /> The new version copies these terms so you have
            somewhere to start; change them on the editor, then submit it for approval. A task to
            verify the new letter is raised on Onboarding.
          </p>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="offer.reviseConfirm" v={v} icon="copy" iconSize={14}>
            Create version {o.version + 1}
          </Btn>
        </>
      ),
    };
  },

  /* ── An offer letter template ─────────────────────────────────────────── */
  'otpl.open': async (v, { viewer }) => {
    const [t] = await db().select().from(offerTemplates).where(eq(offerTemplates.id, v)).limit(1);
    if (!t) return null;

    const fields = [...new Set(
      [...String(t.body).matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]),
    )];
    const unknown = fields.filter((k) => !MERGE_SOURCE[k]);
    const [{ uses }] = rowsOf(await db().execute(sql`
      SELECT count(*)::int AS uses FROM ${offers} WHERE template_id = ${v}`)) as Array<{ uses: number }>;
    const fams = (await depts()).map((d) => d.name);
    const may = mayVerify(viewer);

    /* Preview against a real offer on this template if there is one that has
       not gone out; otherwise the template text as written. */
    const [sample] = await db().select({ id: offers.id }).from(offers)
      .where(and(eq(offers.templateId, v), sql`${offers.state} NOT IN ('sent','viewed','signed','accepted','declined','expired')`))
      .orderBy(desc(offers.createdAt)).limit(1);
    const preview = sample ? offerLetter((await letterContext(sample.id, db())).letter) : null;

    return {
      title: t.name,
      aria: t.name,
      wide: true,
      eyebrow: 'Offer letter template',
      sub: `${t.fileName ?? 'written here'} · v${t.version} · ${uses} offer${Number(uses) === 1 ? '' : 's'}`,
      body: (
        <>
          {t.note && <p className="lead">{t.note}</p>}
          <Kvs pairs={[
            ['Scope', t.family
              ? `Default for ${t.family} requisitions`
              : t.isDefault
                ? 'Default for every requisition without a family-specific letter'
                : 'Available on request — not a default'],
            ['Merge fields', `${fields.length} · ${fields.length - unknown.length} fill automatically${
              unknown.length ? ` · ${unknown.length} unknown` : ''}`],
            ['Language', t.lang === 'en+ar' ? 'English with Arabic summary'
              : t.lang === 'ar' ? 'Arabic' : 'English'],
          ]} />
          {may && (
            <div className="form" style={{ marginTop: 12 }}>
              <Field label="Make this the default for" name="family" type="select" className="wide"
                action="otpl.scope" v={t.id}
                value={t.family ?? (t.isDefault ? '*' : '')}
                options={[
                  { v: '', t: 'Nothing — on request only' },
                  { v: '*', t: 'Every requisition (fallback)' },
                  ...fams.map((f) => ({ v: f, t: `${f} requisitions` })),
                ]} />
            </div>
          )}

          <div className="divider"><span className="t-over">Merge fields</span></div>
          <div className="wrap">
            {fields.length
              ? fields.map((k) => (
                <Chip key={k} tone={MERGE_SOURCE[k] ? 'brand' : 'bad'}>{`{{${k}}}`}</Chip>
              ))
              : <span className="mut">None — the letter would go out exactly as written.</span>}
          </div>
          {!!unknown.length && (
            <p className="t-foot" style={{ marginTop: 8 }}>
              <Icon name="alert" size={12} /> {unknown.map((k) => `{{${k}}}`).join(', ')}{' '}
              {unknown.length === 1 ? 'is' : 'are'} not in the merge dictionary; the Onboarding
              Specialist types {unknown.length === 1 ? 'it' : 'them'} in per offer.
            </p>
          )}

          <div className="divider">
            <span className="t-over">{preview ? 'Preview — filled from a live offer' : 'Template text'}</span>
          </div>
          <pre className="letter">{preview ? preview.text : t.body}</pre>
        </>
      ),
      foot: (
        <>
          <Sp />
          <Btn variant="out" action="sheet.close">Done</Btn>
        </>
      ),
    };
  },

  /* ── The merge dictionary ─────────────────────────────────────────────── */
  'otpl.fields': async () => ({
    title: 'Merge fields',
    aria: 'Merge fields',
    wide: true,
    eyebrow: 'Offer letter templates',
    sub: 'Anything in double braces is replaced when the letter is filled. A field that is not on '
      + 'this list is left in braces and flagged as unresolved — the letter cannot be sent until '
      + 'somebody types a value for it.',
    body: (
      <div className="list flush">
        {Object.entries(MERGE_SOURCE).map(([k, src]) => (
          <Li key={k} icon="hash" title={`{{${k}}}`} sub={src} />
        ))}
      </div>
    ),
  }),
});
