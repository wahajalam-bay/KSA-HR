'use client';

import * as React from 'react';
import { fmt, sum, pct, clamp } from '@/lib/format';
import {
  AX, GR, TX, TX2, CAT, SEQ, RAMP, nice, ticks, trunc, useChartId, ChartDefs, ChartFrame,
  useWidth, wavePath, formatter, type Fmt, type FmtName,
} from './chart-core';

/* The palette is NOT re-exported here on purpose. This module is a client
   boundary, and a constant exported across it reaches a server component as
   a reference rather than as its value — every swatch and every series colour
   then comes out as the chart's default. Import it from
   '@/lib/charts/palette', which both sides can read for real. */
export type { FmtName } from './chart-core';

const TAU = Math.PI * 2;

// ═════════════════════════════════════════════════════════════════════════════
//  Vertical bars — magnitude across categories, one hue, with an optional
//  target marker where a plan or an SLA applies.
// ═════════════════════════════════════════════════════════════════════════════
export type BarDatum = { label: string; value: number; target?: number | null; color?: string };

export function Bars({
  data: dataIn, h = 240, padL = 44, padB = 30, gap = 0.62, colorBy, color, labels = true,
  labelMax, tickCount = 3, format,
}: {
  data: BarDatum[]; h?: number; padL?: number; padB?: number; gap?: number;
  colorBy?: boolean; color?: string; labels?: boolean; labelMax?: number; tickCount?: number;
  format?: FmtName;
}) {
  const [ref, w] = useWidth(720);
  const id = useChartId();
  const fm = formatter(format);
  const data = dataIn.map((d) => ({ ...d, value: Number.isFinite(+d.value) ? +d.value : 0 }));
  const padR = 10, padT = 16;
  const iw = w - padL - padR, ih = h - padT - padB;
  const max = nice(Math.max(...data.map((d) => Math.max(d.value, d.target ?? 0)), 1));
  const bw = Math.max(4, (iw / Math.max(1, data.length)) * gap);
  const x = (i: number) => padL + (iw / Math.max(1, data.length)) * (i + 0.5);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const slot = iw / Math.max(1, data.length);
  const every = Math.max(1, Math.ceil(44 / slot));
  const radius = Math.min(9, bw / 2.4);

  return (
    <div ref={ref}>
      <ChartFrame w={w} h={h} className="cv-bars">
        <ChartDefs id={id} />
        {ticks(max, tickCount).map((t, i) => (
          <g key={`t${i}`}>
            <line x1={padL} x2={w - padR} y1={y(t).toFixed(1)} y2={y(t).toFixed(1)} stroke={GR} strokeWidth="1" />
            <text x={padL - 8} y={(y(t) + 4).toFixed(1)} textAnchor="end" fill={TX} fontSize="11">{fm(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const hh = Math.max(d.value > 0 ? 2 : 0, ih - (y(d.value) - padT));
          const col = colorBy ? CAT[i % 4] : (d.color ?? color ?? 'var(--brand-500)');
          return (
            <g className="bg" key={i}>
              <title>{`${d.label}: ${fm(d.value)}${d.target ? ` (target ${fm(d.target)})` : ''}`}</title>
              {hh > 4 && (
                <rect x={(x(i) - bw / 2).toFixed(1)} y={(y(d.value) + 4).toFixed(1)} width={bw.toFixed(1)}
                  height={hh.toFixed(1)} rx={radius.toFixed(1)} fill="#103828" opacity=".35" />
              )}
              <rect x={(x(i) - bw / 2).toFixed(1)} y={y(d.value).toFixed(1)} width={bw.toFixed(1)}
                height={hh.toFixed(1)} rx={radius.toFixed(1)} fill={col} filter={`url(#${id}s)`} />
              <rect x={(x(i) - bw / 2).toFixed(1)} y={y(d.value).toFixed(1)} width={bw.toFixed(1)}
                height={hh.toFixed(1)} rx={radius.toFixed(1)} fill={`url(#${id}l)`} pointerEvents="none" />
              {d.target != null && (
                <line x1={(x(i) - bw / 2 - 2).toFixed(1)} x2={(x(i) + bw / 2 + 2).toFixed(1)}
                  y1={y(d.target).toFixed(1)} y2={y(d.target).toFixed(1)}
                  stroke="var(--fg-2)" strokeWidth="2" strokeDasharray="3 2" />
              )}
              {labels && bw > 16 && (
                <text x={x(i).toFixed(1)} y={(y(d.value) - 5).toFixed(1)} textAnchor="middle"
                  fill={TX2} fontSize="11" fontWeight="600">{fm(d.value)}</text>
              )}
              {(i % every === 0 || data.length <= 8) && (
                <text x={x(i).toFixed(1)} y={h - padB + 15} textAnchor="middle" fill={TX} fontSize="11">
                  {trunc(d.label, labelMax ?? (bw > 44 ? 12 : 7))}
                </text>
              )}
            </g>
          );
        })}
      </ChartFrame>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Grouped bars — two series side by side, same unit, one axis.
// ═════════════════════════════════════════════════════════════════════════════
export function Grouped({
  data, keys, h = 250, format,
}: {
  data: Array<Record<string, any> & { label: string }>;
  keys: Array<{ key: string; name: string; color?: string }>;
  h?: number; format?: FmtName;
}) {
  const [ref, w] = useWidth(720);
  const id = useChartId();
  const fm = formatter(format);
  const padL = 44, padR = 10, padT = 16, padB = 34;
  const iw = w - padL - padR, ih = h - padT - padB;
  const max = nice(Math.max(1, ...data.flatMap((d) => keys.map((k) => d[k.key] || 0))));
  const slot = iw / Math.max(1, data.length);
  const bw = Math.max(3, (slot * 0.7) / keys.length);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(44 / slot));

  return (
    <div ref={ref}>
      <ChartFrame w={w} h={h} className="cv-grouped">
        <ChartDefs id={id} />
        {ticks(max).map((t, i) => (
          <g key={`t${i}`}>
            <line x1={padL} x2={w - padR} y1={y(t).toFixed(1)} y2={y(t).toFixed(1)} stroke={GR} />
            <text x={padL - 8} y={(y(t) + 4).toFixed(1)} textAnchor="end" fill={TX} fontSize="11">{fm(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = padL + slot * i + (slot - bw * keys.length) / 2;
          return (
            <g key={i}>
              {keys.map((k, j) => {
                const v = d[k.key] || 0;
                return (
                  <g className="bg" key={k.key}>
                    <title>{`${d.label} — ${k.name}: ${fm(v)}`}</title>
                    <rect x={(x0 + j * bw).toFixed(1)} y={y(v).toFixed(1)} width={(bw - 3).toFixed(1)}
                      height={Math.max(v > 0 ? 2 : 0, ih - (y(v) - padT)).toFixed(1)}
                      rx={Math.min(7, bw / 2.5).toFixed(1)} fill={k.color ?? CAT[j % 4]} filter={`url(#${id}s)`} />
                  </g>
                );
              })}
              {(i % every === 0 || data.length <= 8) && (
                <text x={(padL + slot * (i + 0.5)).toFixed(1)} y={h - padB + 15} textAnchor="middle"
                  fill={TX} fontSize="11">{trunc(d.label, 7)}</text>
              )}
            </g>
          );
        })}
      </ChartFrame>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Line — change over time. A single series becomes five sheets of cut paper:
//  the trend behind, the data in the middle, reduced-amplitude sheets in front.
// ═════════════════════════════════════════════════════════════════════════════
export type Series = { name: string; color?: string; points: Array<{ x: string; y: number }> };

export function Line({
  series, h = 220, area = true, dots = true, maxTicks = 12, format,
}: { series: Series[]; h?: number; area?: boolean; dots?: boolean; maxTicks?: number; format?: FmtName }) {
  const [ref, w] = useWidth(720);
  const id = useChartId();
  const fm = formatter(format);
  const padL = 44, padR = 14, padT = 16, padB = 30;
  const iw = w - padL - padR, ih = h - padT - padB;
  const n = Math.max(...series.map((s) => s.points.length), 1);
  const max = nice(Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y))));
  const x = (i: number) => padL + (n === 1 ? iw / 2 : (iw / (n - 1)) * i);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const base = (padT + ih).toFixed(1);
  const single = series.length === 1;
  const every = Math.max(1, Math.ceil(n / Math.min(maxTicks, Math.max(1, Math.floor(iw / 48)))));

  return (
    <div ref={ref}>
      <ChartFrame w={w} h={h} className="cv-line">
        <ChartDefs id={id} />
        <defs>
          <clipPath id={`${id}c`}>
            <rect x={padL - 2} y="0" width={iw + 4} height={(padT + ih).toFixed(1)} />
          </clipPath>
        </defs>
        {ticks(max).map((t, i) => (
          <g key={`t${i}`}>
            <line x1={padL} x2={w - padR} y1={y(t).toFixed(1)} y2={y(t).toFixed(1)} stroke={GR} />
            <text x={padL - 8} y={(y(t) + 4).toFixed(1)} textAnchor="end" fill={TX} fontSize="11">{fm(t)}</text>
          </g>
        ))}
        {series.map((s, si) => {
          const col = s.color ?? CAT[si % 4];
          const P = s.points.map((p, i) => [x(i), y(p.y)] as [number, number]);
          const x0 = x(0).toFixed(1), x1 = x(s.points.length - 1).toFixed(1);
          const ys = s.points.map((p) => p.y);
          const smooth = (k: number) => ys.map((_, i) => {
            const a = Math.max(0, i - k), b = Math.min(ys.length - 1, i + k);
            let t = 0; for (let j = a; j <= b; j++) t += ys[j];
            return t / (b - a + 1);
          });
          const scaled = (f: number) => ys.map((v) => v * f);
          const pts = (a: number[]) => a.map((v, i) => [x(i), y(v)] as [number, number]);
          const sheets: Array<[string, Array<[number, number]>, number]> = [
            ['var(--wave-1)', pts(smooth(3)), -26], ['var(--wave-2)', pts(smooth(1)), -12],
            ['var(--wave-3)', P, 0], ['var(--wave-4)', pts(scaled(0.82)), 10],
            ['var(--wave-5)', pts(scaled(0.62)), 18],
          ];
          return (
            <g key={si}>
              {area && single && (
                <g clipPath={`url(#${id}c)`}>
                  {sheets.map(([fill, Q, dy], k) => {
                    const d = `${wavePath(Q, dy)} L ${x1} ${base} L ${x0} ${base} Z`;
                    return (
                      <g key={k}>
                        <path d={d} fill={fill} filter={`url(#${id})`} />
                        <path d={d} fill={`url(#${id}l)`} />
                      </g>
                    );
                  })}
                </g>
              )}
              <path d={wavePath(P)} fill="none" stroke={single ? 'var(--wave-1)' : col}
                strokeWidth={single ? 2 : 2.6} strokeLinejoin="round" strokeLinecap="round"
                opacity={single ? 0.9 : 1} filter={`url(#${id}s)`}
                clipPath={single && area ? `url(#${id}c)` : undefined} />
              {s.points.map((p, i) => (
                <g className="bg" key={i}>
                  <title>{`${p.x} — ${s.name}: ${fm(p.y)}`}</title>
                  <circle cx={x(i).toFixed(1)} cy={y(p.y).toFixed(1)} r={dots ? 3.4 : 8}
                    fill={!dots ? 'transparent' : single ? 'var(--ground)' : col}
                    stroke={!dots ? 'none' : single ? 'var(--wave-1)' : 'none'} strokeWidth="2" />
                </g>
              ))}
            </g>
          );
        })}
        {(series[0]?.points ?? []).map((p, i) => (i % every ? null : (
          <text key={`x${i}`} x={x(i).toFixed(1)} y={h - padB + 15} textAnchor="middle" fill={TX} fontSize="11">
            {p.x}
          </text>
        )))}
      </ChartFrame>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Waves — several series as overlapping sheets, largest at the back so every
//  sheet's cut edge stays visible.
// ═════════════════════════════════════════════════════════════════════════════
export function Waves({ series, h = 240, maxTicks = 12, format }: {
  series: Series[]; h?: number; maxTicks?: number; format?: FmtName;
}) {
  const [ref, w] = useWidth(720);
  const id = useChartId();
  const fm = formatter(format);
  const padL = 44, padR = 14, padT = 16, padB = 30;
  const iw = w - padL - padR, ih = h - padT - padB;
  const n = Math.max(...series.map((s) => s.points.length), 1);
  const max = nice(Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y))));
  const x = (i: number) => padL + (n === 1 ? iw / 2 : (iw / (n - 1)) * i);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const base = (padT + ih).toFixed(1);
  const order = series.map((s, i) => ({ s, i, peak: Math.max(...s.points.map((p) => p.y), 0) }))
    .sort((a, b) => b.peak - a.peak);
  const every = Math.max(1, Math.ceil(n / Math.min(maxTicks, Math.max(1, Math.floor(iw / 48)))));

  return (
    <div ref={ref}>
      <ChartFrame w={w} h={h} className="cv-waves">
        <ChartDefs id={id} />
        <defs>
          <clipPath id={`${id}c`}>
            <rect x={padL - 2} y="0" width={iw + 4} height={(padT + ih).toFixed(1)} />
          </clipPath>
        </defs>
        {ticks(max).map((t, i) => (
          <g key={`t${i}`}>
            <line x1={padL} x2={w - padR} y1={y(t).toFixed(1)} y2={y(t).toFixed(1)} stroke={GR} />
            <text x={padL - 8} y={(y(t) + 4).toFixed(1)} textAnchor="end" fill={TX} fontSize="11">{fm(t)}</text>
          </g>
        ))}
        <g clipPath={`url(#${id}c)`}>
          {order.map(({ s, i }) => {
            const P = s.points.map((p, k) => [x(k), y(p.y)] as [number, number]);
            const d = `${wavePath(P)} L ${x(s.points.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`;
            return (
              <g key={i}>
                <path d={d} fill={s.color ?? RAMP[i % 5]} filter={`url(#${id})`}><title>{s.name}</title></path>
                <path d={d} fill={`url(#${id}l)`} pointerEvents="none" />
              </g>
            );
          })}
        </g>
        {(series[0]?.points ?? []).map((p, i) => (i % every ? null : (
          <text key={`x${i}`} x={x(i).toFixed(1)} y={h - padB + 15} textAnchor="middle" fill={TX} fontSize="11">{p.x}</text>
        )))}
        {series.map((s, si) => s.points.map((p, i) => (
          <g className="bg" key={`${si}-${i}`}>
            <title>{`${p.x} — ${s.name}: ${fm(p.y)}`}</title>
            <circle cx={x(i).toFixed(1)} cy={y(p.y).toFixed(1)} r="7" fill="transparent" />
          </g>
        )))}
      </ChartFrame>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Pie and donut — a tilted disc with a real side wall.
//
//  The top face is an ellipse. A slice's sector on an ellipse parametrised by
//  angle still has area proportional to its angle, so the shares stay honest
//  despite the tilt. The wall is the band between the top ellipse and the same
//  ellipse `depth` lower, drawn only where it faces the viewer; a donut also
//  shows the far inner wall through the hole.
// ═════════════════════════════════════════════════════════════════════════════
export type Segment = { label: string; value: number; color?: string };

export function Disc3d({
  segments, size = 200, depth = 22, tilt = 0.72, inner: innerRatio = 0, labels = true, centre, centreSub,
}: {
  segments: Segment[]; size?: number; depth?: number; tilt?: number; inner?: number;
  labels?: boolean; centre?: React.ReactNode; centreSub?: string;
}) {
  const id = useChartId();
  const segs = segments.filter((s) => s.value > 0);
  const rx = size / 2 - 12;
  const ry = rx * tilt;
  const inner = innerRatio ? rx * innerRatio : 0;
  const cx = size / 2;
  const cy = size / 2 - depth / 2 + 2;
  const total = sum(segs.map((s) => s.value)) || 1;

  const P = (t: number, R: number, dy = 0) =>
    `${(cx + Math.cos(t) * R).toFixed(2)},${(cy + Math.sin(t) * R * tilt + dy).toFixed(2)}`;
  const arcTo = (t: number, R: number, sweep: number, large: number, dy = 0) =>
    `A ${R} ${(R * tilt).toFixed(2)} 0 ${large} ${sweep} ${P(t, R, dy)}`;

  const face = (a0: number, a1: number) => {
    if (segs.length === 1) {
      const outer = `M ${P(0, rx)} ${arcTo(Math.PI, rx, 1, 0)} ${arcTo(TAU, rx, 1, 0)} Z`;
      const hole = inner ? ` M ${P(0, inner)} ${arcTo(Math.PI, inner, 0, 0)} ${arcTo(TAU, inner, 0, 0)} Z` : '';
      return outer + hole;
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return inner
      ? `M ${P(a0, rx)} ${arcTo(a1, rx, 1, large)} L ${P(a1, inner)} ${arcTo(a0, inner, 0, large)} Z`
      : `M ${cx},${cy} L ${P(a0, rx)} ${arcTo(a1, rx, 1, large)} Z`;
  };
  const wall = (b0: number, b1: number, R: number) =>
    `M ${P(b0, R)} ${arcTo(b1, R, 1, b1 - b0 > Math.PI ? 1 : 0)} L ${P(b1, R, depth)} ${arcTo(b0, R, 0, b1 - b0 > Math.PI ? 1 : 0, depth)} Z`;
  /* The parts of [a0,a1] that fall inside [lo,hi] on the circle, mod 2π. */
  const clip = (a0: number, a1: number, lo: number, hi: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let k = -1; k <= 1; k++) {
      const s0 = Math.max(a0, lo + k * TAU), s1 = Math.min(a1, hi + k * TAU);
      if (s1 - s0 > 1e-4) out.push([s0, s1]);
    }
    return out;
  };

  let a = -Math.PI / 2;
  const slices = segs.map((s, i) => {
    const a1 = a + (s.value / total) * TAU;
    const sl = { s, i, a0: a, a1, col: s.color ?? RAMP[i % RAMP.length] };
    a = a1;
    return sl;
  });

  const Wall = ({ d, col, extra }: { d: string; col: string; extra: number }) => (
    <>
      <path d={d} fill={col} />
      <path d={d} fill="#0B2A20" opacity={extra} />
      <path d={d} fill={`url(#${id}c)`} />
    </>
  );

  return (
    <div className="chart chart-donut">
      <svg className="cvs cv-pie" viewBox={`0 0 ${size} ${size}`} role="img" style={{ width: size, maxWidth: '100%' }}>
        <defs>
          <filter id={`${id}b`} x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="7" /></filter>
          <radialGradient id={`${id}h`}>
            <stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0B2A20" stopOpacity=".38" />
            <stop offset=".35" stopColor="#fff" stopOpacity=".10" />
            <stop offset=".6" stopColor="#0B2A20" stopOpacity=".05" />
            <stop offset="1" stopColor="#0B2A20" stopOpacity=".45" />
          </linearGradient>
        </defs>
        <g className="disc">
          <ellipse cx={cx} cy={(cy + depth + 6).toFixed(1)} rx={(rx * 0.98).toFixed(1)}
            ry={(ry * 0.98).toFixed(1)} fill="#0B2A20" opacity=".28" filter={`url(#${id}b)`} />

          {inner > 0 && slices.flatMap((sl) =>
            clip(sl.a0, sl.a1, Math.PI, TAU).map(([b0, b1], k) => (
              <g className="slice w" data-i={sl.i} key={`iw${sl.i}-${k}`}>
                <Wall d={wall(b0, b1, inner)} col={sl.col} extra={0.5} />
              </g>
            )))}

          {inner > 0 && (
            <ellipse cx={cx} cy={(cy + depth).toFixed(1)} rx={inner.toFixed(1)}
              ry={(inner * tilt).toFixed(1)} fill="var(--nm-dark)" opacity=".55" />
          )}

          {slices.flatMap((sl) =>
            clip(sl.a0, sl.a1, 0, Math.PI).map(([b0, b1], k) => (
              <g className="slice w" data-i={sl.i} key={`ow${sl.i}-${k}`}>
                <Wall d={wall(b0, b1, rx)} col={sl.col} extra={0.38} />
              </g>
            )))}

          <path d={`M ${P(0, rx, depth)} ${arcTo(Math.PI, rx, 1, 0, depth)}`} fill="none"
            stroke="#ffffff" strokeOpacity=".18" strokeWidth="1.5" />

          {slices.map((sl) => (
            <g className="slice t" data-i={sl.i} key={`f${sl.i}`}>
              <title>{`${sl.s.label}: ${fmt.int(sl.s.value)} (${fmt.pct(sl.s.value / total)})`}</title>
              <path d={face(sl.a0, sl.a1)} fill={sl.col} stroke="var(--ground)" strokeWidth="1.4" strokeLinejoin="round" />
            </g>
          ))}

          <ellipse cx={(cx - rx * 0.25).toFixed(1)} cy={(cy - ry * 0.35).toFixed(1)}
            rx={(rx * 0.7).toFixed(1)} ry={(ry * 0.55).toFixed(1)} fill={`url(#${id}h)`} pointerEvents="none" />

          {labels && !inner && slices.map((sl) => {
            const share = sl.s.value / total;
            if (share < 0.07) return null;
            const mid = (sl.a0 + sl.a1) / 2;
            const lx = cx + Math.cos(mid) * rx * 0.6;
            const ly = cy + Math.sin(mid) * ry * 0.6;
            return (
              <text key={`l${sl.i}`} x={lx.toFixed(1)} y={(ly + 4).toFixed(1)} textAnchor="middle"
                fontSize={share > 0.2 ? 15 : 12} fontWeight="700" pointerEvents="none"
                fill={sl.i >= 3 ? '#103828' : '#F3F4F1'}>{fmt.pct(share)}</text>
            );
          })}

          {inner > 0 && centre != null && (
            <>
              <text x={cx} y={(cy + depth / 2 - 1).toFixed(1)} textAnchor="middle" fill="var(--fg-1)"
                fontSize="22" fontWeight="800">{centre}</text>
              <text x={cx} y={(cy + depth / 2 + 15).toFixed(1)} textAnchor="middle" fill={TX} fontSize="11">
                {centreSub ?? ''}
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

export const Pie = (p: React.ComponentProps<typeof Disc3d>) => <Disc3d {...p} />;

export function Donut({ segments, size = 168, thin, centre, centreSub }: {
  segments: Segment[]; size?: number; thin?: boolean; centre?: React.ReactNode; centreSub?: string;
}) {
  const total = sum(segments.map((s) => s.value)) || 1;
  return (
    <Disc3d segments={segments} size={size} inner={thin ? 0.68 : 0.56} depth={16} tilt={0.64}
      labels={false} centre={centre ?? fmt.int(total)} centreSub={centreSub ?? 'total'} />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Horizontal bars — many categories, long labels, ranked, with an optional
//  marker tick where an SLA or a target sits.
// ═════════════════════════════════════════════════════════════════════════════
export type HBarDatum = {
  label: string; value: number; marker?: number | null; markerLabel?: string;
  scaleHint?: number; note?: string; color?: string;
};

export function HBars({ data, max: maxIn, color, format }: {
  data: HBarDatum[]; max?: number; color?: string; format?: FmtName;
}) {
  const fm = formatter(format);
  const max = maxIn ?? Math.max(1, ...data.map((d) =>
    Math.max(d.value, d.scaleHint != null ? d.scaleHint : (d.marker ?? 0))));
  return (
    <div className="hbar">
      {data.map((d, i) => (
        <React.Fragment key={i}>
          <div className="lb" title={d.label}>{d.label}</div>
          <div className="tr">
            <i className="fl" style={{
              width: `${(pct(d.value, max) * 100).toFixed(1)}%`,
              ...(d.color || color ? { background: d.color ?? color } : {}),
            }} />
            {d.marker != null && (
              <b className="mk" style={{ left: `${Math.min(100, pct(d.marker, max) * 100).toFixed(1)}%` }}
                title={d.markerLabel ?? fm(d.marker)} />
            )}
          </div>
          <div className="vv">{fm(d.value)}{d.note && <> <em className="mut">{d.note}</em></>}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Funnel — absolute width plus stage-to-stage conversion.
// ═════════════════════════════════════════════════════════════════════════════
export type FunnelRow = { key: string; name: string; n: number; convFromPrev: number | null };

export function Funnel({ rows }: { rows: FunnelRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="fnl">
      {rows.map((r, i) => {
        const wpc = pct(r.n, max) * 100;
        const drop = r.convFromPrev == null ? 0 : 1 - r.convFromPrev;
        const band = Math.min(6, Math.floor((i / Math.max(1, rows.length - 1)) * 5) + 1);
        return (
          <React.Fragment key={r.key}>
            <div className="lb" title={r.name}>{r.name}</div>
            <div className="tr">
              <i className="fl" style={{ width: `${wpc.toFixed(1)}%`, background: `var(--stg-${band})` }}>
                <b>{fmt.int(r.n)}</b>
              </i>
            </div>
            <div className={`cv ${r.convFromPrev == null ? 'mut' : drop > 0.6 ? 'bad' : drop > 0.4 ? 'warn' : 'good'}`}>
              {r.convFromPrev == null ? '—' : fmt.pct(r.convFromPrev)}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Stack, spark, ring, rings, heat, legend
// ═════════════════════════════════════════════════════════════════════════════
export function Stack({ segments }: { segments: Segment[] }) {
  const total = sum(segments.map((s) => s.value)) || 1;
  return (
    <div className="stk">
      {segments.filter((s) => s.value).map((s, i) => (
        <i key={i} style={{ flex: s.value, background: s.color ?? `var(--stg-${(i % 6) + 1})` }}
          title={`${s.label}: ${fmt.int(s.value)} (${fmt.pct(s.value / total)})`}>
          {s.value / total > 0.08 ? fmt.int(s.value) : ''}
        </i>
      ))}
    </div>
  );
}

export function Spark({ values, w = 96, h = 28, color }: { values: number[]; w?: number; h?: number; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const rng = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / Math.max(1, values.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / rng) * (h - 5)).toFixed(1)}`,
  ).join(' ');
  const col = color ?? 'var(--brand-500)';
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={`1,${h} ${pts} ${w - 1},${h}`} fill={col} opacity=".10" transform="translate(0 4)" />
      <polygon points={`1,${h} ${pts} ${w - 1},${h}`} fill={col} opacity=".18" />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function GaugeRing({ value, size = 76, sw = 8, color, label, title }: {
  value: number; size?: number; sw?: number; color?: string; label?: React.ReactNode; title?: string;
}) {
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const v = clamp(value || 0, 0, 1.5);
  const col = color ?? (v >= 0.95 ? 'var(--ok)' : v >= 0.7 ? 'var(--brand-500)' : 'var(--warn)');
  return (
    <svg className="rng" viewBox={`0 0 ${size} ${size}`} role="img">
      <title>{title ?? fmt.pct(value)}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--nm-dark)" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(1, v)).toFixed(1)} ${c.toFixed(1)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fill="var(--fg-1)"
        fontSize={size > 60 ? 16 : 13} fontWeight="700">{label ?? fmt.pct(value)}</text>
    </svg>
  );
}

export function Rings({ items, size = 84 }: {
  items: Array<{ name: string; value: number; label?: React.ReactNode; sub?: string; title?: string; color?: string; act?: string; v?: string }>;
  size?: number;
}) {
  return (
    <div className="rings">
      {items.map((it, i) => {
        const inner = (
          <>
            <GaugeRing value={it.value} size={size} label={it.label ?? fmt.pct(it.value)} title={it.title} color={it.color} />
            <b className="trunc">{it.name}</b>
            {it.sub && <span>{it.sub}</span>}
          </>
        );
        return it.act
          ? <button className="rg" key={i} data-act={it.act} data-v={it.v ?? ''}>{inner}</button>
          : <div className="rg" key={i}>{inner}</div>;
      })}
    </div>
  );
}

export function Heat({ rows, cols, format }: {
  rows: Array<{ label: string; values: Record<string, number | null> }>;
  cols: Array<{ key: string; name: string; short?: string }>;
  format?: FmtName;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => r.values[c.key] || 0)));
  const fm = formatter(format ?? 'dec1');
  const band = (v: number | null | undefined) =>
    (v == null ? 'na' : v / max > 0.75 ? 4 : v / max > 0.5 ? 3 : v / max > 0.25 ? 2 : 1);
  return (
    <div className="tw">
      <div className="heat" style={{ ['--cols' as any]: cols.length }}>
        <div className="heat-hd">
          <span />
          {cols.map((c) => <span key={c.key} title={c.name}>{trunc(c.short ?? c.name, 6)}</span>)}
        </div>
        {rows.map((r, i) => (
          <div className="heat-row" key={i}>
            <span className="heat-l" title={r.label}>{r.label}</span>
            {cols.map((c) => {
              const v = r.values[c.key];
              return (
                <span key={c.key} className={`heat-c b${band(v)}`}
                  title={`${r.label} · ${c.name}: ${v == null ? 'no data' : fm(v)}`}>
                  {v == null ? '' : fm(v)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: {
  items: Array<{ color: string; label: string; sub?: string; value?: React.ReactNode }>;
}) {
  const rows = items.some((i) => i.value != null);
  return (
    <div className={`legend${rows ? ' rows' : ''}`}>
      {items.map((i, k) => (
        <span key={k} data-i={k}>
          <i style={{ background: i.color }} />
          <span className="lg-l">{i.label}{i.sub && <em className="lg-s">{i.sub}</em>}</span>
          {i.value != null && <b>{i.value}</b>}
        </span>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Radar — the candidate against the job description.
//
//  The bar is a dashed outline rather than a filled sheet, so it reads as a
//  threshold and not a quantity; the candidate sits on top as paper. The dents
//  in that shape are the gaps, which is the whole reason for drawing it.
// ═════════════════════════════════════════════════════════════════════════════
export type RadarAxis = { label: string; must?: boolean };
export type RadarSeries = { kind: 'bar' | 'got'; values: number[] };

export function Radar({ axes, series, h = 330, max = 5, pad = 78 }: {
  axes: RadarAxis[]; series: RadarSeries[]; h?: number; max?: number; pad?: number;
}) {
  const [ref, wRaw] = useWidth(460);
  const id = useChartId();
  const n = axes.length;
  if (!n) return null;
  const w = Math.max(300, Math.min(wRaw, 520));
  const cx = w / 2, cy = h / 2 + 4;
  const R = Math.min(cx, cy) - pad;
  const ang = (i: number) => (TAU * i) / n - Math.PI / 2;
  const at = (i: number, v: number): [number, number] =>
    [cx + Math.cos(ang(i)) * R * (v / max), cy + Math.sin(ang(i)) * R * (v / max)];
  const poly = (vals: number[]) => vals.map((v, i) => at(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const bar = series.find((x) => x.kind === 'bar');
  const got = series.find((x) => x.kind !== 'bar');

  return (
    <div ref={ref}>
      <ChartFrame w={w} h={h} className="chart-radar">
        <ChartDefs id={id} />
        {Array.from({ length: max }, (_, k) => max - 1 - k).map((k) => {
          const v = k + 1;
          return (
            <polygon key={k} points={poly(axes.map(() => v))}
              fill={k % 2 ? 'var(--surface-2)' : 'var(--surface)'}
              fillOpacity={k === max - 1 ? '.5' : '.34'} stroke={GR} strokeWidth="1" />
          );
        })}
        {axes.map((_, i) => {
          const [x, y] = at(i, max);
          return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke={GR} strokeWidth="1" />;
        })}
        {bar && (
          <polygon points={poly(bar.values)} fill="none" stroke="var(--fg-3)" strokeWidth="1.6"
            strokeDasharray="5 4" strokeLinejoin="round" opacity=".85" />
        )}
        {got && (
          <polygon points={poly(got.values)} fill="var(--brand-500)" fillOpacity=".2"
            stroke="var(--brand-600)" strokeWidth="2.2" strokeLinejoin="round" filter={`url(#${id}s)`} />
        )}
        {got && got.values.map((v, i) => {
          const [x, y] = at(i, v);
          const short = !!bar && v < bar.values[i];
          return (
            <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={short ? 4 : 3.4}
              fill={short ? 'var(--bad)' : 'var(--brand-600)'} stroke="var(--surface)" strokeWidth="1.6">
              <title>{`${axes[i].label} — ${v} of ${bar ? bar.values[i] : max}${short ? ' · short' : ''}`}</title>
            </circle>
          );
        })}
        {axes.map((a, i) => {
          const [x, y] = at(i, max * 1.17);
          const c = Math.cos(ang(i));
          const anchor = Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end';
          const words = String(a.label).split(' ');
          /* Wrap onto two lines rather than truncate, whenever there is a space
             to break at and the label would not fit. */
          const lines = (words.length > 2 || (words.length === 2 && String(a.label).length > 13))
            ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
            : [String(a.label)];
          const dy0 = y + (Math.sin(ang(i)) > 0.5 ? 9 : Math.sin(ang(i)) < -0.5 ? -4 : 4) - (lines.length - 1) * 6;
          return lines.map((ln, k) => (
            <text key={`${i}-${k}`} x={x.toFixed(1)} y={(dy0 + k * 12).toFixed(1)} textAnchor={anchor}
              fontSize="10.5" fontWeight={a.must ? 700 : 500} fill={a.must ? TX2 : TX}>
              {trunc(ln, 17)}
            </text>
          ));
        })}
      </ChartFrame>
    </div>
  );
}
