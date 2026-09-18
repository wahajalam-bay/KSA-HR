import * as React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   The drawn portrait.

   A quiet corporate head-and-shoulders, deterministic from a person's id, used
   wherever the platform has somebody on file but no photograph of them. It is
   not a placeholder grey circle and it is not a cartoon: business attire, a soft
   studio backdrop, no facial features drawn, so a row of people reads as a row
   of people. A real photograph — from a CV, or uploaded on a profile — replaces
   it everywhere the moment there is one.

   The same seed draws the same face on every screen, which is the point: a
   recruiter recognises a candidate by their picture long before they read the
   name, and a picture that changed between the list and the panel would be
   worse than none.
   ───────────────────────────────────────────────────────────────────────────*/

const SKIN = ['#F3DCC8', '#EAC7A9', '#D9A985', '#C08B65', '#A5704F', '#82553A', '#5E3B2A'];
const HAIR = ['#1B1714', '#2A211B', '#3B2A20', '#523628', '#6F4B33', '#454545', '#7D746C'];
const SUIT = ['#1F2A37', '#26323F', '#2E3A48', '#1E3A34', '#3A3F4B', '#2B2F3A', '#3C2F3F', '#4A3B2E'];
const BLOUSE = ['#F4F1EA', '#E9EEF2', '#F1E6DA', '#DCE7E2', '#EDE3EC'];
const HIJAB = ['#2F3A44', '#4C4256', '#1E4A55', '#6B5A3E', '#3E3E3E', '#5A6B58', '#7A5561', '#8C7B62', '#26324A'];
const BG: Array<[string, string]> = [
  ['#E7EEF0', '#C9D6DB'], ['#EAE6DE', '#CFC7B8'], ['#E6ECE8', '#C6D5CC'],
  ['#ECE8EA', '#D3C9CE'], ['#E4E8EE', '#C5CCD8'], ['#EDE9E1', '#D6CDBE'],
];
const TIE = ['#7A2E2E', '#2E4A7A', '#3B5A4A', '#5B3D6E', '#8A5A2B'];

/* FNV-1a. Small, fast, and stable across runtimes — the same string gives the
   same 32 bits on the server and in the browser, which is what keeps a
   server-rendered portrait from flickering into a different one on hydration. */
export function seed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const pickBy = <T,>(arr: readonly T[], n: number): T => arr[n % arr.length];

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/* Where the gender of a name is not on the record, it is inferred from the
   first name against the names that actually occur in this market. It only
   decides which drawing is used; nothing in the product reads it back. */
const FEMININE = /^(sara|sarah|nour|noura|lama|reem|reema|hessa|dana|nouf|yasmin|aisha|priya|grace|hala|maha|amal|rana|ghada|fatima|mona|salma|lina|layla|huda|abeer|dalal|rahaf|shahad|joud|maryam|noor|hind|manal|sumaya|arwa|farah|jana|razan|haifa|malak|wafa|taif|raghad|hatoon|aljohara|munira|nadia|mariam|rania|layan|hessah|shaden|haya|zainab|shreya|anjali|divya|neha|maria|joanna|cheryl|bushra|rawan|jood|areej|tala|amani|nada)\b/i;

export type PortraitPerson = {
  id?: string | null;
  name?: string | null;
  gender?: string | null;
  nationality?: string | null;
};

export function Portrait({ person, size = 64 }: { person: PortraitPerson | string; size?: number }) {
  const name = typeof person === 'string' ? person : person?.name ?? '?';
  const id = (typeof person === 'object' && person && (person.id || person.name)) || name;
  const h = seed(String(id));
  const g = (typeof person === 'object' && person?.gender) || (FEMININE.test(name) ? 'f' : 'm');
  const saudi = typeof person === 'object' && person?.nationality
    ? person.nationality === 'Saudi'
    : (h >> 3) % 5 < 3;

  const skin = pickBy(SKIN, ((h >>> 4) % 7) + (saudi ? 1 : 0));
  const hair = pickBy(HAIR, (h >>> 8) % HAIR.length);
  const suit = pickBy(SUIT, (h >>> 12) % SUIT.length);
  const blouse = pickBy(BLOUSE, (h >>> 14) % BLOUSE.length);
  const [bg1, bg2] = pickBy(BG, (h >>> 16) % BG.length);
  const variant = (h >>> 20) % 100;
  const glasses = (h >>> 26) % 6 === 0;
  const beard = g === 'm' && (h >>> 28) % 3 === 0;
  const tie = g === 'm' && (h >>> 22) % 2 === 0;
  const uid = 'pt' + (h % 1e6).toString(36);
  const skinDark = shade(skin, -22);
  const skinLight = shade(skin, 12);
  const hijab = g === 'f' && variant < 48;
  const thobe = g === 'm' && saudi && variant < 40;
  const hj = pickBy(HIJAB, (h >>> 9) % HIJAB.length);

  const body: React.ReactNode[] = [];
  let k = 0;
  const add = (node: React.ReactNode) => body.push(<React.Fragment key={k++}>{node}</React.Fragment>);

  // ── shoulders and attire
  if (thobe) {
    add(<path d="M2 70 C3 52 15 46 32 46 C49 46 61 52 62 70 Z" fill="#F5F2EC" />);
    add(<path d="M26.5 45 L32 55 L37.5 45 L35 44 L32 48 L29 44 Z" fill="#E7E2D8" />);
  } else if (hijab) {
    add(<path d="M2 70 C3 53 14 47 32 47 C50 47 61 53 62 70 Z" fill={`url(#${uid}st)`} />);
    add(<path d="M24 47 L32 58 L40 47 L36 46 L32 51 L28 46 Z" fill={blouse} />);
    add(<path d="M9 70 C8 50 16 44 22 41 L22 30 C22 13 42 13 42 30 L42 41 C48 44 56 50 55 70 Z" fill={hj} />);
    add(<path d="M22 30 C22 13 42 13 42 30 L42 44 L22 44 Z" fill={shade(hj, 10)} />);
  } else {
    add(<path d="M2 70 C3 53 14 47 32 47 C50 47 61 53 62 70 Z" fill={`url(#${uid}st)`} />);
    add(<path d="M24.5 47 L32 60 L39.5 47 L36 45.5 L32 53 L28 45.5 Z" fill={g === 'm' ? '#F6F4EF' : blouse} />);
    add(<path d="M24.5 47 L20 52 L26 62 L32 60 Z M39.5 47 L44 52 L38 62 L32 60 Z" fill={shade(suit, -10)} />);
    if (tie) add(<path d="M30.6 49 L33.4 49 L34.6 62 L32 65 L29.4 62 Z" fill={pickBy(TIE, (h >>> 24) % 5)} />);
  }

  // ── neck
  add(<path d="M26.5 42 C27.5 48 36.5 48 37.5 42 L37.5 38 L26.5 38 Z" fill={skinDark} />);

  // ── hair behind the head, where it is uncovered
  if (g === 'f' && !hijab && variant < 78) {
    add(<path d="M17 54 C15 32 19 13 32 13 C45 13 49 32 47 54 C42 52 22 52 17 54 Z" fill={hair} />);
  }

  // ── ears and head
  if (!hijab) {
    add(<><circle cx="20.8" cy="30.5" r="2.5" fill={skinDark} /><circle cx="43.2" cy="30.5" r="2.5" fill={skinDark} /></>);
  }
  add(<ellipse cx="32" cy="29.5" rx="11.2" ry="13.2" fill={`url(#${uid}sk)`} />);
  if (hijab) add(<path d="M22.4 31 C23 19 41 19 41.6 31 C40 25.5 24 25.5 22.4 31 Z" fill={shade(hj, 10)} />);

  // ── a soft cheek highlight, so the face reads as a face without features
  add(<ellipse cx="28.5" cy="27" rx="4.2" ry="5.6" fill="#fff" opacity=".10" />);

  // ── hair, shemagh, beard
  if (g === 'm') {
    if (thobe) {
      add(<path d="M18 47 L17 30 C17 13 47 13 47 30 L46 47 L40 45 L40 35 C40 25 24 25 24 35 L24 45 Z" fill="#F4F1EA" />);
      add(<path d="M20 25 C22 15 42 15 44 25 C40 21 24 21 20 25 Z" fill="#F4F1EA" />);
      add(<ellipse cx="32" cy="18.2" rx="11.4" ry="3" fill="#1C1C1C" />);
      add(<ellipse cx="32" cy="18.2" rx="11.4" ry="1.1" fill="#3A3A3A" />);
    } else if (variant < 55) {
      add(<path d="M20.8 28.5 C20.2 15 43.8 15 43.2 28.5 C41 22.5 23 22.5 20.8 28.5 Z" fill={hair} />);
    } else if (variant < 78) {
      add(<path d="M20.8 27.5 C21 14 40.5 12 43.2 26.5 C39 17.5 31 19.5 20.8 27.5 Z" fill={hair} />);
    } else if (variant < 92) {
      add(<path d="M21.2 26.5 C22 17.5 42 17.5 42.8 26.5 C40 22.5 24 22.5 21.2 26.5 Z" fill={hair} opacity=".85" />);
    }
    if (beard) add(<path d="M21.8 31 C22.2 42.8 41.8 42.8 42.2 31 C40.8 39 23.2 39 21.8 31 Z" fill={hair} opacity=".78" />);
  } else if (!hijab) {
    if (variant >= 78 && variant < 90) {
      add(<><path d="M20.8 28.5 C20.2 14 43.8 14 43.2 28.5 C41 23 23 23 20.8 28.5 Z" fill={hair} /><circle cx="32" cy="14.5" r="5" fill={hair} /></>);
    } else {
      add(<path d="M20.8 28.5 C20.2 15 43.8 15 43.2 28.5 C41 23.5 23 23.5 20.8 28.5 Z" fill={hair} />);
    }
  }

  if (glasses) {
    add(
      <g stroke="#2A2A2A" strokeWidth=".9" fill="none" opacity=".55">
        <rect x="23.6" y="26.8" width="7.2" height="5" rx="2" />
        <rect x="33.2" y="26.8" width="7.2" height="5" rx="2" />
        <path d="M30.8 29.2h2.4M23.6 28.4l-2.6 1M40.8 28.4l2.6 1" />
      </g>,
    );
  }

  return (
    <svg className="pt" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={`${uid}c`}><circle cx="32" cy="32" r="32" /></clipPath>
        <radialGradient id={`${uid}bg`} cx="50%" cy="30%" r="80%">
          <stop offset="0" stopColor={bg1} /><stop offset="1" stopColor={bg2} />
        </radialGradient>
        <linearGradient id={`${uid}sk`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={skinLight} /><stop offset="1" stopColor={skinDark} />
        </linearGradient>
        <linearGradient id={`${uid}st`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(suit, 14)} /><stop offset="1" stopColor={suit} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${uid}bg)`} />
      <g clipPath={`url(#${uid}c)`}>{body}</g>
      <circle cx="32" cy="32" r="31.4" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" />
    </svg>
  );
}
