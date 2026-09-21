import * as React from 'react';
import { Card, Kpi, Empty, Table, Avatar, Btn, type Column, type Page } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icons';
import { Grouped, Pie, Legend, HBars } from '@/components/charts';
import { CAT, RAMP } from '@/lib/charts/palette';
import { fmt } from '@/lib/format';

/* ─────────────────────────────────────────────────────────────────────────────
   Hires and pay.

   Everything here is built from the hires themselves — the sector they came
   from, gender, years of experience and, above all, what each person was
   earning before they joined, captured on the screening call.

   That last number is the only honest market signal an ATS holds: it is what
   the market was paying these people, so the median by position is the market
   rate for that position, and the gap to what we offered is the premium it took
   to move them.
   ───────────────────────────────────────────────────────────────────────────*/

export type MarketHire = {
  applicationId: string;
  name: string;
  photo: string | null;
  hue: number;
  position: string;
  sector: string;
  from: string | null;
  dept: string;
  fn: string;
  gender: string;
  years: number;
  band: string;
  before: number | null;
  offered: number;
  source: string | null;
};

export type MarketData = {
  rows: MarketHire[];
  byPosition: Array<{ position: string; n: number; market: number; ours: number; years: number; gap: number; band: string; dept: string; sector: string }>;
  bySector: Array<{ sector: string; n: number; women: number; years: number; market: number | null; ours: number | null; gap: number | null }>;
  byBand: Array<{ label: string; n: number; market: number | null; ours: number | null }>;
  medianBefore: number;
  medianOffer: number;
  uplift: number | null;
  medianYears: number;
  women: number;
  deptName: string;
  periodLabel: string;
  scopedToDept: boolean;
};

export function Market({ d, pageAt }: {
  d: MarketData;
  /* Where each long table on this tab has got to. Ninety-eight positions of a
     dozen cells each was four thousand elements and most of the weight of the
     page; a page of them is forty. */
  pageAt: (key: string, size: number) => Page;
}) {
  if (!d.rows.length) {
    return (
      <Empty icon="coin" title="No hires in this period"
        sub={`Nothing to analyse for ${d.deptName} inside ${d.periodLabel}. Widen the period.`} />
    );
  }
  const withPay = d.rows.filter((x) => x.before);
  const missing = d.rows.length - withPay.length;
  const top = d.byPosition.slice(0, 10);
  const genderSegs = [
    { label: 'Male', value: d.rows.length - d.women },
    { label: 'Female', value: d.women },
  ].filter((x) => x.value);

  const posCols: Array<Column<MarketData['byPosition'][number]>> = [
    {
      t: 'Position', cls: 'wrap',
      f: (x) => <><b>{x.position}</b><br /><span className="t-foot">{x.dept} · {x.sector}</span></>,
    },
    { t: 'Hires', n: true, f: (x) => fmt.int(x.n) },
    { t: 'Median experience', n: true, f: (x) => `${fmt.dec(x.years, 0)} yrs` },
    { t: 'Market rate', n: true, f: (x) => fmt.sar(x.market) },
    { t: 'We offered', n: true, f: (x) => fmt.sar(x.ours) },
    { t: 'Premium', n: true, f: (x) => <span className={x.gap > 0.25 ? 'bad-t' : ''}>{fmt.pct(x.gap)}</span> },
    { t: 'Our band', n: true, f: (x) => x.band },
  ];

  const sectorCols: Array<Column<MarketData['bySector'][number]>> = [
    { t: 'Sector', cls: 'wrap', f: (x) => x.sector },
    { t: 'Hires', n: true, f: (x) => fmt.int(x.n) },
    { t: 'Women', n: true, f: (x) => <>{fmt.int(x.women)} <span className="t-foot">{fmt.pct(x.women / x.n)}</span></> },
    { t: 'Exp.', n: true, f: (x) => fmt.dec(x.years, 0) },
    { t: 'Market', n: true, f: (x) => (x.market ? fmt.sarK(x.market) : '—') },
    { t: 'Ours', n: true, f: (x) => (x.ours ? fmt.sarK(x.ours) : '—') },
    { t: 'Premium', n: true, f: (x) => (x.gap != null ? fmt.pct(x.gap) : '—') },
  ];

  const hireCols: Array<Column<MarketHire & { _act?: string; _v?: string }>> = [
    {
      t: 'Hire', cls: 'wrap',
      f: (x) => (
        <div className="row tight nowrap">
          <Avatar person={{ name: x.name, photo: x.photo, hue: x.hue }} size="s" />
          <span><b>{x.name}</b><br /><span className="t-foot">{x.position}</span></span>
        </div>
      ),
    },
    { t: 'Came from', cls: 'wrap', f: (x) => <>{x.sector}<br /><span className="t-foot">{x.from ?? ''}</span></> },
    { t: 'Joined', cls: 'wrap', f: (x) => <>{x.dept}<br /><span className="t-foot">{x.fn}</span></> },
    { t: 'Gender', f: (x) => x.gender },
    { t: 'Experience', n: true, f: (x) => `${fmt.int(x.years)} yrs` },
    {
      t: 'Before joining', n: true,
      f: (x) => (x.before
        ? <>{fmt.sar(x.before)}<br /><span className="t-foot">{x.source === 'ai' ? 'from the call' : 'from the recruiter'}</span></>
        : <span className="mut">not captured</span>),
    },
    { t: 'Offered', n: true, f: (x) => fmt.sar(x.offered) },
    { t: 'Premium', n: true, f: (x) => (x.before ? fmt.pct((x.offered - x.before) / x.before) : '—') },
    { t: '', f: (x) => <Btn size="xs" variant="out" action="drawer.open" v={x.applicationId}>Open</Btn> },
  ];

  return (
    <>
      <div className="grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Hires analysed" value={fmt.int(d.rows.length)} accent
          sub={`${fmt.int(withPay.length)} with the salary they were on before${missing ? ` · ${missing} without` : ''}`}
          def={`Hires closed inside the period for ${d.deptName}. The pay analysis uses the ones whose current salary was captured on the screening call.`} />
        <Kpi label="Market rate, median" value={fmt.sarK(d.medianBefore)} unit="/ month"
          sub="what these people were already earning"
          def={"Median of the salary each hire was on immediately before joining — the market's own price for these profiles, not our band."} />
        <Kpi label="We offered, median" value={fmt.sarK(d.medianOffer)} unit="/ month"
          sub={d.uplift != null ? `${fmt.pct(d.uplift)} above the market rate` : ''}
          def="Median monthly basic on the signed offers of the same hires." />
        <Kpi label="Median experience" value={fmt.dec(d.medianYears, 0)} unit="years"
          sub={`${fmt.pct(d.women / d.rows.length)} of hires are women`}
          def="Years of experience as parsed from the CV, and the gender split of the same cohort." />
      </div>

      <Card title="Average pay by position" icon="coin"
        sub={`The market rate is the median salary the people we hired into that position were already on; ours is the median basic we offered them. The gap is what it cost to move them${d.scopedToDept ? ` — ${d.deptName} only` : ''}.`}
        foot={
          <span className="t-foot">
            <Icon name="shield" size={12} /> Captured on the screening call by the recruiter or read
            off the AI phone screen — see <b>What the screen captured</b> on any candidate.
          </span>
        }>
        <Grouped format="sarK" h={260}
          data={top.map((x) => ({
            label: x.position.length > 22 ? `${x.position.slice(0, 21)}…` : x.position,
            market: x.market, ours: x.ours,
          }))}
          keys={[
            { key: 'market', name: 'Market rate (before joining)', color: CAT[2] },
            { key: 'ours', name: 'What we offered', color: CAT[0] },
          ]} />
        <Legend items={[
          { color: CAT[2], label: 'Market rate — what they were on' },
          { color: CAT[0], label: 'What we offered' },
        ]} />
      </Card>

      <Card title={`Position by position (${d.byPosition.length})`} flush>
        <Table cols={posCols} rows={d.byPosition} page={pageAt('pos', 40)} />
      </Card>

      <div className="grid g-2">
        <Card title="The sector they came from" icon="grid"
          sub={'The industry on the CV — real estate, marketing, consulting, construction and the '
            + 'rest — taken from the employer and the words on the page, not from the team they joined.'}>
          <HBars color={CAT[1]}
            data={d.bySector.map((x) => ({
              label: x.sector, value: x.n, note: x.market ? `${fmt.sarK(x.market)} market` : '',
            }))} />
          <div className="divider"><span className="t-over">Pay and mix by sector</span></div>
          <Table cols={sectorCols} rows={d.bySector} />
          <p className="t-foot" style={{ marginTop: 10 }}>
            <Icon name="spark" size={12} /> Read from each CV: the employer is matched against the
            sector table, and anything unlisted is classified from the résumé text. With AI
            configured the assistant can be asked to judge a CV directly — see <b>Sector</b> on
            a candidate&rsquo;s profile.
          </p>
        </Card>

        <Card title="Who we hired" icon="users"
          sub="Gender split and years of experience across the same cohort, with what each band costs.">
          {!!genderSegs.length && (
            <div className="pie-row">
              <Pie segments={genderSegs} size={180} />
              <Legend items={genderSegs.map((x, i) => ({
                color: RAMP[i % RAMP.length], label: x.label,
                value: `${fmt.int(x.value)} · ${fmt.pct(x.value / d.rows.length)}`,
              }))} />
            </div>
          )}
          <div className="divider"><span className="t-over">Experience bands</span></div>
          <HBars color={CAT[3]}
            data={d.byBand.map((x) => ({
              label: x.label, value: x.n,
              note: x.market ? `${fmt.sarK(x.market)} → ${fmt.sarK(x.ours ?? 0)}` : '',
            }))} />
          <p className="t-foot" style={{ marginTop: 10 }}>
            <Icon name="shield" size={12} /> Gender is held for Saudization and diversity reporting
            and is never part of screening, scoring or ranking.
          </p>
        </Card>
      </div>

      <Card title="The hires behind these numbers" flush
        actions={<span className="t-foot">{fmt.int(d.rows.length)} in {d.periodLabel}</span>}>
        <Table cols={hireCols} rows={d.rows} page={pageAt('hire', 40)} />
      </Card>
    </>
  );
}
