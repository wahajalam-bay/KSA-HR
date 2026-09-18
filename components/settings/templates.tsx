import * as React from 'react';
import { Card, Chip, Empty, Li, Btn, Dropzone } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { fmt, ago } from '@/lib/format';
import { DEFAULT_NAMES, type StageKey } from '@/lib/domain/stages';
import { questionTypeLabel, questionIcon } from '@/lib/domain/questions';
import { MERGE_SOURCE } from '@/lib/services/offer-letter';

/* How many fields the letter filler knows how to resolve. Read from the
   dictionary rather than typed, so adding one changes the sentence. */
const MERGE_SOURCE_COUNT = Object.keys(MERGE_SOURCE).length;

/* ─────────────────────────────────────────────────────────────────────────────
   Templates: the reference documents the product fills in.

   An offer letter is the fixed file HR signs off on, uploaded once; an e-mail
   template carries a subject, a body and its merge fields; an interview kit
   carries the criteria the panel scores and the questions that keep one
   interview comparable with the next; the question bank is what a requisition
   may ask on the careers form.
   ───────────────────────────────────────────────────────────────────────────*/

export type EmailTemplate = {
  id: string; name: string; stage: string | null; lang: string;
  subject: string; body: string;
};
export type InterviewKit = {
  id: string; name: string; pipelineId: string | null;
  criteria: Array<{ name: string; weight: number; guidance?: string }>; questions: string[];
};
export type OfferTemplate = {
  id: string; name: string; fileName: string | null; version: number;
  lang: string | null; family: string | null; isDefault: boolean;
  body: string; uploadedByName: string | null; uploadedAtIso: string | null;
  /** How many offers have gone out on this letter. */
  offers: number;
};
export type BankQuestion = {
  id: string; text: string; type: string; options: string[] | null; required: boolean;
  knockout: string | null; families: string[]; isStandard: boolean;
  /** How many requisitions currently ask it. */
  uses: number;
};

export type TemplatesData = {
  emails: EmailTemplate[];
  kits: InterviewKit[];
  letters: OfferTemplate[];
  bank: BankQuestion[];
};

const MERGE_RE = /\{\{[a-z_]+\}\}/g;
const mergeFields = (s: string): string[] => [...new Set(String(s).match(MERGE_RE) ?? [])];
const stageLabel = (k: string | null) =>
  (!k || k === 'any' ? 'Any stage' : DEFAULT_NAMES[k as StageKey] ?? k);

export function TemplatesPanel({ d, mayEdit, now }: { d: TemplatesData; mayEdit: boolean; now: Date }) {
  return (
    <>
      <p className="t-sub" style={{ marginBottom: 14 }}>
        Templates are reference data: an offer letter is the fixed document HR uploads and the
        platform fills, an email template carries the subject, the body and its merge fields, and
        an interview kit carries the scorecard criteria and the questions the panel is asked to
        work through.
      </p>

      <Card title="Offer letter templates" icon="file" flush
        actions={<Chip tone="brand">{d.letters.length} uploaded</Chip>}
        sub={
          <>
            A fixed letter, uploaded once. Its {'{{merge_fields}}'} are filled the moment an offer
            is drafted; the Onboarding Specialist checks the result before it can be sent.
          </>
        }
        foot={
          <span className="t-foot">
            {MERGE_SOURCE_COUNT} fields fill automatically —{' '}
            <button className="linkbtn" data-act="otpl.fields">see the merge-field reference</button>.
            Anything else in braces stays visible and blocks the send until it is typed in.
          </span>
        }>
        <div className="list flush">
          {d.letters.map((t) => (
            <Li key={t.id} icon="file" title={t.name}
              sub={
                <>
                  {t.fileName ?? '—'} · v{t.version} · {mergeFields(t.body).length} merge fields ·{' '}
                  {fmt.int(t.offers)} offer{t.offers === 1 ? '' : 's'}
                  {t.uploadedByName ? ` · uploaded by ${t.uploadedByName}` : ''}
                  {t.uploadedAtIso ? ` ${ago(t.uploadedAtIso, now)}` : ''}
                </>
              }
              right={
                <span className="row tight">
                  {t.family ? <Chip tone="info">Default for {t.family}</Chip>
                    : t.isDefault ? <Chip tone="ok">Default</Chip> : null}
                  {t.lang === 'en+ar' && <Chip tone="violet">EN/AR</Chip>}
                </span>
              }
              action="otpl.open" v={t.id} />
          ))}
          {!d.letters.length && (
            <Empty icon="file" title="No offer letter yet"
              sub="Upload the fixed template HR signs off on." />
          )}
        </div>
        <div style={{ padding: '14px 16px 16px' }}>
          {mayEdit ? (
            <Dropzone action="otpl.upload" accept=".docx,.txt,.md,.html"
              title="Upload a fixed offer letter"
              sub="DOCX, TXT, MD or HTML — merge fields such as {{candidate_name}} are detected on upload" />
          ) : (
            <p className="t-foot">
              <Icon name="shield" size={12} /> Uploading and editing templates is limited to the
              Onboarding Specialist and Admins.
            </p>
          )}
        </div>
      </Card>

      <div style={{ marginTop: 14 }}>
        <Card title="Application questions — bank" icon="list" flush
          actions={
            <span className="row tight">
              <Chip tone="brand">{d.bank.length} questions</Chip>
              {mayEdit && <Btn size="sm" variant="pri" action="qb.new" icon="plus" iconSize={13}>Add a question</Btn>}
            </span>
          }
          sub={'The questions a requisition can ask on the careers form. Standard ones attach to '
            + 'every new requisition; the rest are picked per role or suggested by job family.'}
          foot={
            <span className="t-foot">
              Write <span className="mono">{'{{city}}'}</span> in a question and it becomes the
              requisition&rsquo;s city when attached.
            </span>
          }>
          <div className="list flush">
            {d.bank.map((qq, i) => (
              <div className="li q-row" key={qq.id}>
                <span className={`ic ${qq.knockout ? 'warn' : ''}`}>
                  <Icon name={questionIcon(qq.type)} size={15} />
                </span>
                <span className="bd">
                  <b><span className="mut">{i + 1} ·</span> {qq.text}</b>
                  <span>
                    {questionTypeLabel(qq.type)}
                    {qq.options?.length ? ` · ${qq.options.join(' / ')}` : ''}
                    {qq.required ? ' · required' : ' · optional'}
                    {qq.knockout ? ` · knockout unless “${qq.knockout}”` : ''}
                    {' · '}{qq.isStandard ? 'standard · ' : ''}
                    {qq.families.length ? fmt.list(qq.families) : 'any family'}
                    {` · used on ${qq.uses} requisition${qq.uses === 1 ? '' : 's'}`}
                  </span>
                </span>
                <span className="tr">
                  <span className="row tight">
                    {qq.isStandard && <Chip tone="ok">Standard</Chip>}
                    {mayEdit && (
                      <>
                        <Btn size="xs" variant="out" action="qb.edit" v={qq.id} icon="pencil" iconSize={12}>Edit</Btn>
                        <Btn size="xs" variant="ghost" className="danger" action="qb.remove" v={qq.id}
                          icon="trash" iconSize={12} ariaLabel="Remove" square={false} />
                      </>
                    )}
                  </span>
                </span>
              </div>
            ))}
            {!d.bank.length && <Empty icon="list" title="No questions yet" />}
          </div>
        </Card>
      </div>

      <div className="grid g-2" style={{ marginTop: 14 }}>
        <Card title="Email templates" flush
          sub={`${d.emails.length} templates · merge fields are filled from the application, the candidate and the requisition at send time.`}>
          <div className="list flush">
            {d.emails.map((t) => (
              <Li key={t.id} icon="mail" title={t.name}
                sub={
                  <>
                    {stageLabel(t.stage)} · {t.lang === 'ar' ? 'Arabic' : 'English'} ·{' '}
                    {mergeFields(`${t.subject} ${t.body}`).length} merge fields
                  </>
                }
                right={<Chip tone={t.lang === 'ar' ? 'violet' : ''}>{t.lang.toUpperCase()}</Chip>}
                action="set.tpl" v={t.id} />
            ))}
            {!d.emails.length && <Empty icon="mail" title="No email templates" />}
          </div>
        </Card>

        <Card title="Interview kits" flush
          sub={`${d.kits.length} scorecards, one per pipeline template. The criteria are what the panel scores 1–5; the questions keep the interview comparable.`}>
          <div className="list flush">
            {d.kits.map((k) => (
              <Li key={k.id} icon="star" title={k.name}
                sub={<>{k.criteria.length} criteria · {k.questions.length} questions</>}
                action="set.kit" v={k.id} />
            ))}
            {!d.kits.length && <Empty icon="star" title="No interview kits" />}
          </div>
        </Card>
      </div>
    </>
  );
}
