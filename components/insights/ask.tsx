import * as React from 'react';
import { Card, Chip, Table, Btn, Push, type Column } from '@/components/ui/primitives';
import { Badge, Icon } from '@/components/ui/icons';
import { Bars, HBars, Pie, Legend, type Pick, type Picks } from '@/components/charts';
import { RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';
import { METRICS, DIMS, SUGGESTIONS, parse, title as reportTitle } from '@/lib/services/ask';
import { vocabulary, resolve, narrative } from '@/lib/queries/ask';
import { providers } from '@/lib/env';
import type { Viewer } from '@/lib/auth/session';

/* ─────────────────────────────────────────────────────────────────────────────
   Ask AI.

   A question in plain words becomes a report: one metric, one breakdown, a
   period, a chart, a table and a narrative. The interpretation runs on a closed
   grammar; when a model is configured it can read a question the grammar
   misses, but it answers with a specification in the same vocabulary — it never
   sees the database and never writes a query.

   When no model is configured the panel says so plainly rather than pretending:
   the grammar still answers most questions, and the ones it cannot read come
   back as "I could not read that" with the vocabulary it does know.
   ───────────────────────────────────────────────────────────────────────────*/

export async function AskPanel({ viewer, question, report, now }: {
  viewer: Viewer; question: string; report: string; now: Date;
}) {
  const vocab = await vocabulary(viewer);
  const ai = providers().ai;

  const spec = question.trim() ? parse(question, vocab) : null;
  const res = spec?.metric ? await resolve(viewer, spec, now) : null;

  return (
    <>
      <Card title="Ask for a report" icon="spark"
        sub={'Say what you want to see — a metric, how to break it down, and the period. Hires, '
          + 'applications, interviews, offers, acceptance rate, time to hire, pipeline, SLA breaches, '
          + 'screenings, conversion, open requisitions, joiners, headcount — by department, function, '
          + 'recruiter, source, month, stage, location, requisition, hiring manager or nationality.'}
        >
        <form className="askrow" action="/insights" method="get">
          <input type="hidden" name="tab" value="ask" />
          <input className="inp grow" id="askbox" name="q" defaultValue={question}
            placeholder="e.g. Hires by department in the last 6 months" autoComplete="off" />
          <button className="btn pri" type="submit"><Icon name="spark" size={14} /> Ask</button>
        </form>
        <div className="wrap" style={{ marginTop: 10 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" data-act="ask.suggest" data-v={s}>{s}</button>
          ))}
        </div>
        {/* The prototype shows this line only when a model is reachable, and so
            does production. The other half of the truth — that no model is
            configured — is said where it actually bites, on the card that comes
            back when the grammar cannot read a question, rather than as a
            standing notice on a panel that works without one. */}
        {ai.configured && (
          <p className="t-foot" style={{ marginTop: 10 }}>
            <Icon name="spark" size={12} /> {ai.provider} is configured: a question the grammar
            cannot read is passed to it, and it answers with a report specification in this same
            vocabulary. It is never given database access, and every question is logged.
          </p>
        )}
      </Card>

      <div className="stack" id="asklog" style={{ marginTop: 14 }}>
        {question.trim() && (
          <div className="askq">
            <span className="bub me"><p>{question}</p><time>just now</time></span>
          </div>
        )}
        {question.trim() && (!spec || !spec.metric) && (
          <Card title="I could not read that" icon="alert" className="report"
            sub="The question did not name anything measurable. These are the words the grammar knows."
            foot={
              <span className="t-foot">
                {ai.configured
                  ? `${ai.provider} was asked to read it as well and could not map it to a report.`
                  : 'No model is configured, so questions are read by the built-in grammar only. '
                    + 'Set AI_PROVIDER and its key and a model will be asked to read the ones it '
                    + 'misses — answering with a specification in this same vocabulary, never a query.'}
              </span>
            }>
            <div className="grid g-2">
              <div>
                <div className="t-over" style={{ marginBottom: 6 }}>Metrics</div>
                <div className="wrap">
                  {Object.values(METRICS).map((m) => <Chip key={m.label}>{m.label}</Chip>)}
                </div>
              </div>
              <div>
                <div className="t-over" style={{ marginBottom: 6 }}>Breakdowns</div>
                <div className="wrap">
                  {Object.values(DIMS).map((d) => <Chip key={d.label}>by {d.label}</Chip>)}
                </div>
              </div>
            </div>
          </Card>
        )}
        {spec?.metric && res && <ReportCard spec={spec} res={res} vocab={vocab} />}
      </div>
    </>
  );
}

function ReportCard({ spec, res, vocab }: {
  spec: NonNullable<ReturnType<typeof parse>>;
  res: NonNullable<Awaited<ReturnType<typeof resolve>>>;
  vocab: Awaited<ReturnType<typeof vocabulary>>;
}) {
  const lines = narrative(spec, res);
  const total = res.series ? res.series.reduce((n, x) => n + x.value, 0) : 0;
  const s = (res.series ?? []).filter((x) => x.label !== '—' || x.value);

  const cols: Array<Column<{ label: string; value: number; n: number }>> = [
    {
      t: spec.dim ? DIMS[spec.dim].label.replace(/^./, (m) => m.toUpperCase()) : '',
      f: (r) => r.label,
    },
    {
      t: spec.metric ? METRICS[spec.metric].label : '', n: true,
      f: (r) => <b className="num">{res.unit === '%' ? `${r.value}%` : fmt.int(r.value)}</b>,
    },
    res.agg
      ? { t: 'Records', n: true, f: (r) => fmt.int(r.n) }
      : { t: 'Share', n: true, f: (r) => fmt.pct(r.value / (total || 1)) },
  ];

  /* ── Why nothing here is clickable ────────────────────────────────────────
     Every other chart in the product knows what its marks stand for, because
     somebody wrote the query and the destination side by side and a suite holds
     the two to each other. A report here is assembled from whatever was asked:
     any metric against any dimension, aggregated or not. Building a link from
     that would mean guessing at a filter that matches what was counted, and a
     guess that is wrong is a list of records somebody was never meant to be
     handed. So these marks say exactly what they are worth — the figure, the
     records behind it, its share — and lead nowhere.

     The figures themselves are already inside the account's access: `resolve`
     reads the same scoped dataset every other report does. This is about not
     inventing a second, unchecked way into records on top of it. */
  const shown = spec.dim === 'month' ? s : s.slice(0, spec.share && !res.agg && s.length <= 8 ? 8 : 12);
  const askPicks: Picks = shown.map((x): Pick => ({
    tip: {
      label: x.label,
      value: res.unit === '%' ? `${x.value}%` : res.unit === 'days' ? `${x.value} days` : fmt.int(x.value),
      rows: [
        ['Records behind it', fmt.int(x.n)],
        ...(res.agg ? [] : [['Share of the answer', fmt.pct(x.value / (total || 1))] as [string, string]]),
      ],
    },
  }));

  const chart = !s.length ? null
    : spec.dim === 'month'
      ? <Bars data={s.map((x) => ({ label: x.label, value: x.value || 0 }))} h={220} labelMax={8}
        format={res.unit === '%' ? 'pct' : 'int'} picks={askPicks} />
      : spec.share && !res.agg && s.length <= 8
        ? (
          <div className="pie-row">
            <Pie segments={s.slice(0, 8).map((x) => ({ label: x.label, value: x.value }))} size={200}
              picks={askPicks} />
            <Legend picks={askPicks} items={s.slice(0, 8).map((x, i) => ({
              color: RAMP[i % RAMP.length], label: x.label, value: fmt.int(x.value),
            }))} />
          </div>
        )
        : <HBars picks={askPicks} data={s.slice(0, 12).map((x) => ({ label: x.label, value: x.value || 0 }))}
          format={res.unit === '%' ? 'pct' : res.unit === 'days' ? 'days' : 'int'} />;

  return (
    <Card title={reportTitle(spec, vocab)} icon="chart" className="report"
      actions={
        <span className="row tight">
          {spec.via === 'model' && <Chip tone="violet">Interpreted by the model</Chip>}
          <Chip>{fmt.int(res.rows.length)} records</Chip>
          <Btn size="xs" variant="ghost" action="ask.csv" v={spec.q} icon="dl" iconSize={12}>CSV</Btn>
          <Btn size="xs" variant="ghost" action="ask.save" v={spec.q} icon="star" iconSize={12}>Save</Btn>
        </span>
      }
      foot={
        <>
          <span className="t-foot">{spec.q}{res.note ? ` · ${res.note}` : ''}</span>
          <Push />
          <span className="row tight">
            {(['month', 'department', 'recruiter'] as const).map((d) => (
              <a key={d} className="btn xs out"
                href={`/insights?tab=ask&q=${encodeURIComponent(`${spec.q} by ${DIMS[d].label}`)}`}>
                By {DIMS[d].label}
              </a>
            ))}
          </span>
        </>
      }>
      <div className="narr">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>

      {res.series ? (
        <>
          <div style={{ marginTop: 12 }}>{chart}</div>
          <div style={{ marginTop: 12 }}>
            <Table cols={cols} rows={res.series} emptyIcon="chart" emptyTitle="Nothing in scope" />
          </div>
        </>
      ) : (
        <div className="tiles tiles-3" style={{ marginTop: 12 }}>
          <div className="tile">
            <Badge name="chart" size={16} />
            <b className="tl-v">
              {res.total == null ? '—' : res.unit === '%' ? `${res.total}%` : fmt.int(res.total)}
            </b>
            <span className="tl-l">{spec.metric ? METRICS[spec.metric].label : ''}</span>
          </div>
          {res.prev != null && (
            <div className="tile">
              <Badge name="clock" size={16} />
              <b className="tl-v">{fmt.int(res.prev)}</b>
              <span className="tl-l">Previous period</span>
            </div>
          )}
          <div className="tile">
            <Badge name="cal" size={16} />
            <b className="tl-v" style={{ fontSize: 16 }}>{spec.windowLabel}</b>
            <span className="tl-l">Period</span>
          </div>
        </div>
      )}
    </Card>
  );
}
