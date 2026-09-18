import * as React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   The icon set, path for path from the prototype. One stroked 24×24 grid, one
   component, so every icon in the product has the same weight and the same
   corner treatment.
   ───────────────────────────────────────────────────────────────────────────*/
export const ICONS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  brief: 'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16.5 4.6a3.5 3.5 0 0 1 0 6.8',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v3M16 3v3M8 14h3M8 17h3M14 14h2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  badge: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9L9.5 8z',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2.5a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H8.6a1.6 1.6 0 0 0 1-1.5V2.5a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20.5 20.5L16 16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  play: 'M8 5.5v13l10-6.5z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  filter: 'M4 5h16l-6 7v7l-4-2v-5z',
  dots: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  chev: 'M9 6l6 6-6 6',
  chevD: 'M6 9l6 6 6-6',
  chevU: 'M18 15l-6-6-6 6',
  chevL: 'M15 6l-6 6 6 6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M4 12.5l5 5L20 6.5',
  star: 'M12 3l2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.3-.9z',
  upload: 'M12 16V4M7.5 8.5L12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  dl: 'M12 4v12M7.5 11.5L12 16l4.5-4.5M4 20h16',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  phone: 'M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2',
  msg: 'M4 5h16v11H9l-5 4z',
  clock: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16M12 8v4.5l3 1.8',
  alert: 'M12 3l9 16H3zM12 9v5M12 17h.01',
  spark: 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 16l.9 2.1 2.1.9-2.1.9L18 22l-.9-2.1-2.1-.9 2.1-.9z',
  coin: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  expand: 'M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5',
  shrink: 'M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5',
  brain: 'M9 5a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8A3 3 0 0 0 12 21V5a3 3 0 0 0-3 0M15 5a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8A3 3 0 0 1 12 21',
  link: 'M9.5 14.5l5-5M8 11L6 13a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2',
  pencil: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  eye: 'M12 5c5 0 9 7 9 7s-4 7-9 7-9-7-9-7 4-7 9-7M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10',
  laptop: 'M5 5h14v10H5zM2 19h20',
  tag: 'M4 12l8-8 8 8-8 8zM9 9h.01',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4',
  ext: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  board: 'M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v7h-4z',
  uplus: 'M14 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M18 8v6M15 11h6',
  shield: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z M9 12l2 2 4-4',
  zap: 'M13 3L5 14h6l-1 7 8-11h-6z',
  plug: 'M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3',
  inbox: 'M3 12h5l1 3h6l1-3h5M3 12l3-7h12l3 7v7H3z',
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M10 12h4l.5 4h-5zM8 20h8',
  flame: 'M12 21c4 0 6-2.6 6-6 0-4-4-5-4-9 0 0-2 1.5-2 4 0-2-1-3-1-3-1 2-4 3.5-4 8 0 3.4 2 6 5 6',
  arrU: 'M12 19V5M6 11l6-6 6 6',
  arrD: 'M12 5v14M18 13l-6 6-6-6',
  arrR: 'M5 12h14M13 6l6 6-6 6',
  arrL: 'M19 12H5M11 18l-6-6 6-6',
  drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  cmd: 'M6 3a3 3 0 0 1 3 3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H6',
  book: 'M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2zM8 7h8M8 11h6',
  hash: 'M9 4l-1 16M16 4l-1 16M4 9h16M3 15h16',
  bolt: 'M4 12h4l2-6 4 12 2-6h4',
  copy: 'M8 8h11v11a1 1 0 0 1-1 1H8zM5 16V5a1 1 0 0 1 1-1h10',
  db: 'M12 8c4.4 0 8-1.1 8-2.5S16.4 3 12 3 4 4.1 4 5.5 7.6 8 12 8M20 5.5v13c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5v-13M20 12c0 1.4-3.6 2.5-8 2.5S4 13.4 4 12',
  logo: 'M4 11.5L12 4l8 7.5M6.5 10v9h11v-9M10 19v-5h4v5',
  thumbUp: 'M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.5 2.5V10h5a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17.5 20H7',
  thumbDown: 'M17 13V4h3v9zM17 13l-4 7c-1.5 0-2.5-1-2.5-2.5V14h-5a2 2 0 0 1-2-2.3l1-6A2 2 0 0 1 6.5 4H17',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3M12 15v2',
  key: 'M14 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10M10.5 12.5L3 20M6 17l2 2M8.5 14.5l2 2',
  login: 'M14 4h5v16h-5M4 12h10M10 8l4 4-4 4',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H8',
  handshake: 'M3 11l4-4 5 3 5-3 4 4-3 3-2-1-4 4-4-4-2 1z',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name, size = 18, sw = 1.7, fill = 'none', className = '',
}: {
  name: IconName | string; size?: number; sw?: number; fill?: string; className?: string;
}) {
  const d = ICONS[name as IconName] ?? ICONS.dots;
  return (
    <svg
      className={`ic ${className}`.trim()} viewBox="0 0 24 24" width={size} height={size}
      fill={fill} stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/* ── Guessing an icon from a heading ─────────────────────────────────────────
   The paper-cut design puts a circular badge on every card header and KPI tile.
   Guessing from the words means a new card lights up without an edit; pass
   `icon` to override, or `icon={false}` for none. Rules in the prototype's
   order — the first match wins, so the specific ones come before the general. */
const ICON_RULES: Array<[RegExp, IconName]> = [
  [/pipeline|stage|board|funnel|conversion/i, 'board'],
  [/time|days|sla|turnaround|tat|dwell|response|ageing|aging|stale|overdue/i, 'clock'],
  [/hire|joined|attainment|target|goal|plan/i, 'trophy'],
  [/offer|letter|signature|e-sign/i, 'file'],
  [/interview|schedule|agenda|calendar|load|capacity/i, 'cal'],
  [/scorecard|quality|rating|evaluation|feedback|score/i, 'star'],
  [/note|comment|mention/i, 'msg'],
  [/source|channel|sourcing|where they came/i, 'search'],
  [/candidate|people|applicant|pool|talent|résumé|resume|profile|contact/i, 'users'],
  [/recruiter|team|staff|leader|who|panel/i, 'badge'],
  [/task|to-do|todo|needs you|checklist/i, 'check'],
  [/application|inbox|volume|new /i, 'inbox'],
  [/department|function|org/i, 'grid'],
  [/automation|rule|trigger|zap/i, 'zap'],
  [/integration|connect|system/i, 'plug'],
  [/audit|log|trail|security|permission/i, 'shield'],
  [/brand|colour|color|theme|palette|design/i, 'sun'],
  [/data|collection|export|baseline|schema/i, 'db'],
  [/email|template|message/i, 'mail'],
  [/tag|skill|hashtag/i, 'tag'],
  [/activity|timeline|history|everything/i, 'clock'],
  [/requisition|job|role|opening|position|salary|band/i, 'brief'],
  [/spread|chart|trend|month|insight|metric|kpi|health|overview/i, 'chart'],
];

export function guessIcon(t: unknown): IconName {
  const txt = String(t ?? '');
  for (const [re, ic] of ICON_RULES) if (re.test(txt)) return ic;
  return 'spark';
}

/* The circular badge itself. */
export function Badge({ name, size = 15, className = '' }: { name: IconName | string; size?: number; className?: string }) {
  return (
    <span className={`ibadge ${className}`.trim()}>
      <Icon name={name} size={size} sw={2} />
    </span>
  );
}
