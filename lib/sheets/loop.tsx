import 'server-only';
import * as React from 'react';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  applications, candidates, jobs, jobStages, screenings, screeningTurns, assessments, pitches,
  evaluations,
} from '@/db/schema';
import { defineSheets } from './registry';
import { Field, Btn, Sp, Banner, Li, Chip, Empty, Card } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { rows as rowsOf } from '@/lib/queries/sql';
import { requireApplication, requireJob } from '@/lib/authz';
import { VOICES, callDefaults } from '@/lib/services/screening';
import { briefPreview, projectFor } from '@/lib/services/pitch';
import { providers } from '@/lib/env';
import { fmt } from '@/lib/format';

/** What a number on a scorecard means, so that two people mean the same by it. */
const SCORES: Array<{ v: number; t: string }> = [
  { v: 1, t: 'well below the bar' },
  { v: 2, t: 'below it' },
  { v: 3, t: 'at the bar' },
  { v: 4, t: 'above it' },
  { v: 5, t: 'well above' },
];

/* ═════════════════════════════════════════════════════════════════════════════
   THE LOOP SHEETS

   The phone screen, what the screen captured, the transcript, the behaviour
   test and the sales pitch brief.

   Two of these say no rather than pretending. Setting up a call with no
   telephony provider configured is refused on the form, not after the recruiter
   has filled it in and gone away believing somebody will ring. The behaviour
   test asks for the six trait scores off the provider's report, because the
   product does not have an opinion about a person it has never met.
   ═════════════════════════════════════════════════════════════════════════════*/

const TRAITS: Array<[string, string]> = [
  ['Drive', 'pace and appetite for targets'],
  ['Judgement', 'decisions with incomplete information'],
  ['Resilience', 'setbacks and pressure'],
  ['Collaboration', 'working across teams'],
  ['Structure', 'planning and follow-through'],
  ['Candour', 'straight talk with people and peers'],
];

/** The candidate, requisition and stage behind an application. */
async function about(applicationId: string) {
  const [row] = rowsOf(await db().execute(sql`
    SELECT a.id, a.stage::text AS stage, a.job_id, a.candidate_id,
           c.name AS candidate, c.phone, c.email, c.current_salary, c.expected_salary,
           c.notice_days, j.title, j.salary_min, j.salary_max, j.pitch_on
      FROM ${applications} a
      JOIN ${candidates} c ON c.id = a.candidate_id
      JOIN ${jobs} j ON j.id = a.job_id
     WHERE a.id = ${applicationId}`)) as Array<{
       id: string; stage: string; job_id: string; candidate_id: string; candidate: string;
       phone: string | null; email: string | null; current_salary: number | null;
       expected_salary: number | null; notice_days: number | null; title: string;
       salary_min: number; salary_max: number; pitch_on: boolean;
     }>;
  return row ?? null;
}

defineSheets({
  /* ── Setting up the phone screen ──────────────────────────────────────── */
  'scr.call': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const app = await about(v);
    if (!app) return null;

    const voice = providers().voice;
    const d = await callDefaults(app.candidate_id, db());

    /* Ten in the morning, Riyadh, tomorrow — as a value the datetime input
       will accept, which is local wall-clock with no zone on it. */
    const t = new Date(Date.now() + 86_400_000);
    t.setUTCHours(7, 0, 0, 0);
    const slot = new Date(t.getTime() + 3 * 3600_000).toISOString().slice(0, 16);

    if (!voice.configured) {
      return {
        title: 'AI phone screen',
        aria: 'AI phone screen',
        eyebrow: app.candidate,
        body: (
          <Banner tone="warn" icon="plug" title="No telephony provider is configured"
            body={`Nothing can place this call, so nothing will be scheduled. Set ${
              voice.missing.join(', ')} under Settings → Integrations, or run the screen as a chat `
              + 'instead — the same six questions, answered by the candidate on a link.'} />
        ),
        foot: (
          <>
            <Btn variant="ghost" action="sheet.close">Close</Btn>
            <Sp />
            <Btn variant="pri" action="scr.invite" v={v} icon="msg" iconSize={14}>
              Send the chat screen instead
            </Btn>
          </>
        ),
      };
    }

    return {
      title: 'AI phone screen',
      aria: 'AI phone screen',
      eyebrow: app.candidate,
      sub: `The assistant calls ${app.phone ?? 'the number on file'}, reads the recorded-line notice, `
        + `asks the six knockout questions for ${app.title} and scores the transcript.`,
      body: (
        <>
          <div className="form">
            <Field label="When" name="when" type="select" value="now" className="wide"
              options={[
                { v: 'now', t: 'Call now' },
                { v: 'candidate', t: 'Let the candidate pick a time (SMS with a booking link)' },
                { v: 'schedule', t: 'Schedule a time' },
              ]} />
            <Field label="Scheduled for (AST)" name="at" type="datetime-local" value={slot}
              help="Used when “Schedule a time” is chosen" />
            <Field label="Language" name="lang" type="select" value={d.language}
              options={[
                { v: 'ar', t: `Arabic${d.language === 'ar' ? ' (from the CV)' : ''}` },
                { v: 'en', t: `English${d.language === 'en' ? ' (from the CV)' : ''}` },
              ]} />
            <Field label="Voice" name="voice" type="select" value={d.voice}
              options={VOICES.map(([vv, t]) => ({ v: vv, t }))} />
          </div>
          <p className="t-foot" style={{ marginTop: 10 }}>
            <Icon name="shield" size={12} /> The call opens with “this call is recorded for the
            hiring team” and asks for consent; a no is logged and the chat link is sent instead. No
            answer → one retry after two hours and an SMS with a call-back link.
          </p>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="scr.callGo" v={v} icon="phone" iconSize={13}>
            Set up the call
          </Btn>
        </>
      ),
    };
  },

  /* ── Everybody in the screening stage who has not been screened ───────── */
  'scr.stageCalls': async (v, { viewer }) => {
    await requireJob(viewer, v, db());
    const [job] = await db().select().from(jobs).where(eq(jobs.id, v)).limit(1);
    if (!job) return null;
    const [stage] = await db().select().from(jobStages)
      .where(and(eq(jobStages.jobId, v), eq(jobStages.stageKey, 'screen'))).limit(1);

    const queue = rowsOf(await db().execute(sql`
      SELECT a.id, c.id AS candidate_id, c.name, c.phone, c.photo, c.hue,
             s.status::text AS screening
        FROM ${applications} a
        JOIN ${candidates} c ON c.id = a.candidate_id
        LEFT JOIN ${screenings} s ON s.application_id = a.id
       WHERE a.job_id = ${v} AND a.stage = 'screen' AND a.status IN ('active','on_hold')
         AND (s.id IS NULL OR s.status::text NOT IN ('completed','in_progress'))
       ORDER BY c.name`)) as Array<{
         id: string; candidate_id: string; name: string; phone: string | null;
         photo: string | null; hue: number; screening: string | null;
       }>;

    const voice = providers().voice;

    return {
      title: `AI phone screens — ${stage?.name ?? 'Screening'}`,
      aria: 'Stage calls',
      eyebrow: job.title,
      wide: true,
      sub: `${queue.length} candidate${queue.length === 1 ? '' : 's'} in the stage without a `
        + 'screening. Call each now, or schedule the lot for tomorrow morning fifteen minutes apart.',
      body: !voice.configured ? (
        <Banner tone="warn" icon="plug" title="No telephony provider is configured"
          body={`Nobody here can be called until ${voice.missing.join(', ')} is set under `
            + 'Settings → Integrations. The chat screen works without it.'} />
      ) : queue.length ? (
        <div className="list flush">
          {queue.map((q) => (
            <Li key={q.id} avatar={{ name: q.name, photo: q.photo, hue: q.hue }} title={q.name}
              sub={`${q.phone ?? 'no number on file'}${
                q.screening === 'no_answer' ? ' · no answer last time' : ''}`}
              right={(
                <span className="row tight">
                  <Btn size="xs" variant="out" action="scr.call" v={q.id}>Set up</Btn>
                  <Btn size="xs" variant="pri" action="scr.callNow" v={q.id} icon="phone" iconSize={12}>
                    Call now
                  </Btn>
                </span>
              )} />
          ))}
        </div>
      ) : (
        <Empty icon="check" title="Everyone in this stage has been screened"
          sub="Results are on each candidate’s Screening tab." />
      ),
      foot: voice.configured && queue.length ? (
        <>
          <span className="t-foot">Scheduled calls appear on each card as a phone mark.</span>
          <Sp />
          <Btn variant="pri" action="scr.scheduleAll" v={v} icon="cal" iconSize={13}>
            Schedule all {queue.length} for tomorrow
          </Btn>
        </>
      ) : undefined,
    };
  },

  /* ── What the screen captured ─────────────────────────────────────────── */
  'scr.salary': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const app = await about(v);
    if (!app) return null;

    return {
      title: 'Salary and notice',
      aria: 'Salary',
      eyebrow: app.candidate,
      sub: 'Ask what they are on today — it is what the market analysis in Insights is built from, '
        + `and it settles the offer conversation early. The band for ${app.title} is `
        + `${fmt.sarK(app.salary_min)} – ${fmt.sarK(app.salary_max)}.`,
      body: (
        <div className="form">
          <Field label="Current salary (SAR / month)" name="cur" type="number"
            value={app.current_salary ?? ''} step={250}
            help="Basic, as they stated it on the call." />
          <Field label="Expectation (SAR / month)" name="exp" type="number"
            value={app.expected_salary ?? ''} step={250} />
          <Field label="Notice period (days)" name="notice" type="number"
            value={app.notice_days ?? 0} min={0} />
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="scr.salarySave" v={v} icon="check" iconSize={14}>Save</Btn>
        </>
      ),
    };
  },

  /* ── The transcript ───────────────────────────────────────────────────── */
  'scr.transcript': async (v, { viewer }) => {
    const [s] = await db().select().from(screenings).where(eq(screenings.id, v)).limit(1);
    if (!s) return null;
    await requireApplication(viewer, s.applicationId, db());
    const app = await about(s.applicationId);
    const turns = await db().select().from(screeningTurns)
      .where(eq(screeningTurns.screeningId, v)).orderBy(asc(screeningTurns.seq));

    const head = [
      `${s.channel} screen — ${app?.candidate ?? ''}`,
      `${app?.title ?? ''} · ${s.startedAt ? fmt.when(s.startedAt) : 'not started'}`
        + `${s.callDurationSec ? ` · ${s.callDurationSec}s` : ''}`,
      '',
    ];
    const lines = turns.map((t) => `[${t.at ? fmt.time(t.at) : '—'}] ${
      t.who === 'bot' ? (s.callVoice ?? 'Assistant') : (app?.candidate ?? 'Candidate')}: ${t.text}`);
    const tail = ['', `Score ${s.total} of ${s.max}${s.verdict ? ` — ${s.verdict}` : ''}`, s.summary ?? ''];

    return {
      title: `Transcript — ${app?.candidate ?? 'screening'}`,
      aria: 'Transcript',
      wide: true,
      sub: turns.length
        ? `${turns.length} turn${turns.length === 1 ? '' : 's'}, as recorded. Nothing here is `
          + 'generated — it is what was said.'
        : 'Nothing has been said yet.',
      body: turns.length ? (
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: '12.5px', lineHeight: 1.6 }}>
          {[...head, ...lines, ...tail].join('\n')}
        </pre>
      ) : (
        <Empty icon="msg" title="No transcript yet"
          sub="It fills in as the screen runs." />
      ),
    };
  },

  /* ── The behaviour test ───────────────────────────────────────────────── */
  'asm.invite': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const app = await about(v);
    if (!app) return null;
    const existing = await db().select().from(assessments)
      .where(eq(assessments.applicationId, v)).limit(1);
    const p = providers().assessment;

    if (existing.length) {
      return {
        title: 'Behaviour test',
        aria: 'Behaviour test',
        eyebrow: app.candidate,
        body: (
          <Banner tone="info" icon="brain" title="The test has already gone out"
            body={`${existing[0].provider ?? 'The provider'} was invited on `
              + `${fmt.date(existing[0].invitedAt)}. Its result goes on the Loop tab when it is back.`} />
        ),
        foot: (
          <>
            <Btn variant="ghost" action="sheet.close">Close</Btn>
            <Sp />
            {existing[0].status !== 'completed' && (
              <Btn variant="out" action="asm.remind" v={existing[0].id} icon="mail" iconSize={13}>
                Send a reminder
              </Btn>
            )}
          </>
        ),
      };
    }

    return {
      title: 'Behaviour test',
      aria: 'Behaviour test',
      eyebrow: app.candidate,
      sub: 'Every manager-and-above candidate sits a short behavioural questionnaire before the '
        + 'final interview. The final is locked until the result is back.',
      body: p.configured ? (
        <Banner tone="info" icon="brain" title={`${p.provider} sends the questionnaire`}
          body={`${app.candidate} gets a link by e-mail, about twenty minutes, no right answers. `
            + 'A task is raised on the recruiter so nobody forgets to chase it, and the final '
            + 'interview unlocks the moment the result lands.'} />
      ) : (
        <Banner tone="warn" icon="plug" title="No assessment provider is configured"
          body={`Nothing can send the questionnaire until ${p.missing.join(', ')} is set under `
            + 'Settings → Integrations, so nothing is recorded either: an invitation nobody '
            + 'received would leave the final interview waiting on a result that is never coming. '
            + 'A report that arrives another way can still be typed in against this candidate.'} />
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Close</Btn>
          <Sp />
          {p.configured && (
            <Btn variant="pri" action="asm.send" v={v} icon="brain" iconSize={14}>
              Send the questionnaire
            </Btn>
          )}
        </>
      ),
    };
  },

  /* The result, typed off the provider's report. */
  'asm.complete': async (v, { viewer }) => {
    const [a] = await db().select().from(assessments).where(eq(assessments.id, v)).limit(1);
    if (!a) return null;
    await requireApplication(viewer, a.applicationId, db());
    const app = await about(a.applicationId);

    return {
      title: 'Record the result',
      aria: 'Record assessment result',
      eyebrow: `${app?.candidate ?? ''} · ${a.provider ?? 'behaviour test'}`,
      wide: true,
      sub: 'The six trait scores come off the report, out of ten each. Nothing is inferred — a '
        + 'missing trait is refused rather than guessed, because the final interview turns on this.',
      body: (
        <>
          <div className="form">
            {TRAITS.map(([name, note]) => (
              <Field key={name} label={name} name={`trait_${name.toLowerCase()}`} type="number"
                min={0} max={10} step={1} req help={note} />
            ))}
            <Field label="Report reference" name="reportRef" className="wide"
              placeholder={a.reportRef ?? 'e.g. HPI-2026-00841'}
              help="Where the full report lives, so the panel can read it." />
          </div>
          <p className="t-foot" style={{ marginTop: 10 }}>
            <Icon name="shield" size={12} /> The overall score is the six traits out of sixty, as a
            percentage. Strong is 75 and over, mixed 60 to 74, concern below that.
          </p>
        </>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="asm.complete" v={v} icon="brain" iconSize={14}>
            Record the result
          </Btn>
        </>
      ),
    };
  },

  /* ── The sales pitch brief ────────────────────────────────────────────── */
  'pitch.brief': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const app = await about(v);
    if (!app) return null;
    const preview = await briefPreview(v, db(), new Date());
    if (!preview) return null;

    if (!preview.project) {
      return {
        title: 'The brief, as they get it',
        aria: 'Pitch brief',
        eyebrow: 'Sales pitch',
        body: (
          <Banner tone="warn" icon="spark" title="There is no brief to show yet"
            body={preview.reason ?? 'No pitch project is set up.'} />
        ),
      };
    }

    return {
      title: 'The brief, as they get it',
      aria: 'Pitch brief',
      wide: true,
      eyebrow: preview.project.name,
      sub: `Sent ${preview.leadHours} hours before the call to ${preview.phone ?? 'no number'} and `
        + `${preview.email ?? 'no address'}. Edit the wording in Settings → Sales pitch.`,
      body: (
        <div className="stack">
          {preview.reason && (
            <Banner tone="warn" icon="alert" title="This requisition does not run a sales pitch"
              body={preview.reason} />
          )}
          <Card title="WhatsApp" icon="msg">
            <div className="chat">
              <div className="bub me"><p>{preview.whatsapp}</p></div>
            </div>
          </Card>
          <Card title="E-mail" icon="mail" sub={preview.emailSubject}>
            <pre className="letter">{preview.emailBody}</pre>
          </Card>
          <p className="t-foot">
            <Icon name="clock" size={12} /> Due {preview.due ? fmt.when(preview.due) : '—'}, which is
            the interview booked for the stage if there is one, and the stage’s own SLA if not.
          </p>
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Close</Btn>
          <Sp />
          <Btn variant="pri" action="pitch.send" v={v} icon="mail" iconSize={14}>Send it now</Btn>
        </>
      ),
    };
  },

  /* ── The scorecard ────────────────────────────────────────── */
  /* Everybody on a panel is asked the same questions in the same order, which
     is the only thing that makes two interviewers’ scores comparable. So the
     criteria come from the kit rather than from whoever is filling it in, the
     weights are shown, and the box for what they actually saw is as large as
     the scores — a number with no sentence under it is not feedback.

     Booking an interview raises an empty scorecard for each panellist; this
     panel fills one of those in when there is one waiting for this person. */
  'eval.start': async (v, { viewer }) => {
    await requireApplication(viewer, v, db());
    const [app] = await db().select().from(applications).where(eq(applications.id, v)).limit(1);
    if (!app) return null;
    const [cand] = await db().select().from(candidates)
      .where(eq(candidates.id, app.candidateId)).limit(1);
    const [job] = await db().select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);

    const who = viewer.staffId ?? viewer.accountId;
    const [mine] = rowsOf(await db().execute(sql`
      SELECT e.id, e.submitted, e.stage::text AS stage, e.interview_id AS "interviewId"
        FROM ${evaluations} e
       WHERE e.application_id = ${v}
         AND (e.evaluator_id = ${who} OR lower(e.evaluator_name) = ${viewer.name.toLowerCase()})
         AND NOT e.submitted
       ORDER BY e.created_at
       LIMIT 1`)) as Array<{ id: string; submitted: boolean; stage: string; interviewId: string | null }>;

    const [already] = rowsOf(await db().execute(sql`
      SELECT e.id, js.name AS "stageName"
        FROM ${evaluations} e
        LEFT JOIN ${jobStages} js ON js.job_id = e.job_id AND js.stage_key = e.stage
       WHERE e.application_id = ${v} AND e.submitted
         AND (e.evaluator_id = ${who} OR lower(e.evaluator_name) = ${viewer.name.toLowerCase()})
         AND e.stage = ${mine?.stage ?? app.stage}::stage_key
       LIMIT 1`)) as Array<{ id: string; stageName: string | null }>;

    const stage = mine?.stage ?? app.stage;
    const stageRows = await db().select().from(jobStages)
      .where(eq(jobStages.jobId, app.jobId)).orderBy(asc(jobStages.ordinal));
    const stageName = stageRows.find((x) => x.stageKey === stage)?.name ?? stage;

    /* The kit is the requisition’s pipeline’s. When one has criteria already
       written against this scorecard — raised with it when the interview was
       booked — those win, because they are what the panel was told to score. */
    const seeded = mine
      ? rowsOf(await db().execute(sql`
          SELECT name, weight::float AS weight FROM evaluation_criteria
           WHERE evaluation_id = ${mine.id} ORDER BY sort_order`)) as
        Array<{ name: string; weight: number }>
      : [];
    const kitRows = rowsOf(await db().execute(sql`
      SELECT k.criteria, k.questions, k.name
        FROM interview_kits k
       WHERE k.pipeline_id = ${job?.pipelineId ?? null} AND k.archived_at IS NULL
       ORDER BY k.sort_order LIMIT 1`)) as Array<{
        criteria: Array<{ name: string; weight?: number; guidance?: string }>;
        questions: string[]; name: string;
      }>;
    const kit = kitRows[0] ?? null;
    const criteria = seeded.length
      ? seeded.map((c) => ({ name: c.name, weight: c.weight, guidance: undefined as string | undefined }))
      : (kit?.criteria ?? []).map((c) => ({ name: c.name, weight: c.weight ?? 1, guidance: c.guidance }));

    if (already) {
      return {
        title: 'You have already scored this stage',
        aria: 'Scorecard',
        eyebrow: cand?.name,
        body: (
          <Banner tone="warn" icon="check"
            title={`Your ${already.stageName ?? stageName} scorecard is in`}
            body="A second one from the same person at the same stage would count twice in the
              candidate’s rating and in quality-of-hire. Ask the recruiter to reopen it if it was
              wrong." />
        ),
      };
    }

    if (!criteria.length) {
      return {
        title: 'Score this candidate',
        aria: 'Scorecard',
        eyebrow: cand?.name,
        body: (
          <Banner tone="warn" icon="alert" title="This pipeline has no interview kit"
            body={`${job?.title ?? 'The requisition'} scores against a kit’s criteria, and none is `
              + 'set up for its pipeline. Add one under Settings → Templates — until then there is '
              + 'nothing for two interviewers to agree or disagree about.'} />
        ),
        foot: (
          <>
            <Btn variant="ghost" action="sheet.close">Close</Btn>
            <Sp />
            <Btn variant="out" action="go" v="/settings?tab=templates" icon="gear" iconSize={13}>
              Open Templates
            </Btn>
          </>
        ),
      };
    }

    return {
      title: 'Score this candidate',
      aria: 'Scorecard',
      eyebrow: `${cand?.name ?? ''} · ${job?.title ?? ''}`,
      wide: true,
      sub: `${stageName}${kit ? ` · ${kit.name}` : ''} — one to five on each, then what you `
        + 'actually saw. Scores roll into the candidate’s rating and into quality-of-hire.',
      body: (
        <div className="stack">
          {mine && (
            <Banner tone="info" icon="check" title="This is the scorecard you were asked for"
              body="Filing it takes you off the waiting list rather than adding a second card." />
          )}

          <input type="hidden" name="stage" value={stage} />

          <div className="list flush">
            {criteria.map((c) => (
              <div className="li" key={c.name}>
                <span className="bd">
                  <b>{c.name}</b>
                  <span>
                    {c.guidance ?? 'One is well below the bar, three is at it, five is well above.'}
                    {c.weight && c.weight !== 1 ? ` · weighted ×${c.weight}` : ''}
                  </span>
                </span>
                <span className="tr">
                  <select className="inp" name={`crit:${c.name}`} defaultValue="3"
                    style={{ width: 'auto', minWidth: 132 }}
                    aria-label={`Score for ${c.name}`}>
                    {SCORES.map((x) => (
                      <option key={x.v} value={x.v}>{x.v} — {x.t}</option>
                    ))}
                  </select>
                </span>
              </div>
            ))}
          </div>

          {kit?.questions?.length ? (
            <>
              <div className="divider"><span className="t-over">
                What the kit asks ({kit.questions.length})
              </span></div>
              <div className="list flush">
                {kit.questions.slice(0, 8).map((q, i) => (
                  <Li key={i} icon="msg" title={q} />
                ))}
              </div>
            </>
          ) : null}

          <div className="form" style={{ marginTop: 12 }}>
            <Field label="Recommendation" name="verdict" type="select" className="wide"
              value="yes"
              options={[
                { v: 'strong_yes', t: 'Strong yes — would fight to hire' },
                { v: 'yes', t: 'Yes — hire' },
                { v: 'no', t: 'No — not for this role' },
                { v: 'strong_no', t: 'Strong no — would not hire' },
              ]} />
            <Field label="What you saw" name="comment" type="textarea" rows={6} className="wide"
              placeholder="The evidence behind the scores — what they said, what they built, where
                they struggled."
              help="Everybody on the panel reads this after they have filed their own." />
          </div>
        </div>
      ),
      foot: (
        <>
          <Btn variant="ghost" action="sheet.close">Cancel</Btn>
          <Sp />
          <Btn variant="pri" action="eval.save" v={v} icon="star" iconSize={14}>
            Submit the scorecard
          </Btn>
        </>
      ),
    };
  },
});
