/* ─────────────────────────────────────────────────────────────────────────────
   Which industry a candidate comes out of.

   It matters because Bayut hires from a handful of sectors and a recruiter
   reading a shortlist wants to know at a glance whether somebody has sold
   off-plan before or has only ever sold insurance. The judgement is made in two
   passes, in this order:

     1. The employer. If the company is one the organisation already knows —
        the table lives in the organisation's own settings, because it is a
        fact about this market rather than about software — that answers it.
     2. The words on the page. Failing a known employer, the title, the summary
        and the experience are read against the phrases each sector actually
        uses.

   Both are rules. Nothing here asks a model, and the answer always carries the
   reason it reached, so a recruiter who disagrees can see what it read and
   correct it — which is recorded as `recruiter` rather than `cv`.
   ───────────────────────────────────────────────────────────────────────────*/

export type SectorRead = {
  sector: string;
  /** cv — read from the record. ai — read by a model. recruiter — typed. */
  source: 'cv' | 'ai' | 'recruiter';
  /** What it read, in the words the interface shows. */
  why: string;
};

/* The phrases each sector uses about itself. Order matters: the first match
   wins, and the list runs from the most specific to the most general. */
export const SECTOR_KEYS: Array<[string, RegExp]> = [
  ['Real estate & property', /real estate|property (management|consultan|develop|brokerage)|broker|off-plan|leasing|rega|rera|valuation/i],
  ['Construction & contracting', /construction|contracting|civil engineer|infrastructure|site engineer|mep\b|quantity survey|main contractor/i],
  ['Marketing & advertising', /advertis|marketing agency|media agency|brand agency|creative agency|performance marketing|social media agency|pr agency/i],
  ['Consulting & professional services', /consult|advisory|big four|audit|assurance|transaction services|strategy house/i],
  ['Banking & finance', /\bbank\b|banking|fintech|lending|mortgage|investment|asset management|treasury|brokerage house/i],
  ['Insurance', /insurance|takaful|underwrit|claims adjust/i],
  ['Legal', /law firm|legal counsel|advocates|solicitor|litigation|paralegal/i],
  ['Retail & FMCG', /retail|fmcg|supermarket|hypermarket|grocery|showroom|merchandis|consumer goods/i],
  ['Telecom', /telecom|mobile operator|network operator|gsm|fibre|isp\b/i],
  ['Technology & IT services', /software|saas|it services|system integrat|technolog|developer|data engineer|platform/i],
  ['Logistics & delivery', /logistic|freight|courier|last mile|delivery|supply chain|warehous|3pl/i],
  ['Travel & hospitality', /hotel|hospitality|travel|tourism|airline|resort|f&b|restaurant group/i],
  ['Healthcare', /hospital|clinic|healthcare|pharma|medical centre|polyclinic|nursing/i],
  ['Education', /school|university|college|education|academy|edtech|teacher|lecturer/i],
  ['Government & public sector', /ministry|government|authority|municipality|public sector|royal commission/i],
  ['Energy & petrochemicals', /oil|gas|petrochemical|energy|refinery|aramco|sabic|renewab/i],
  ['Facilities management', /facilit(y|ies) management|soft services|hard services|hvac maintenance|cleaning contract/i],
  ['Classifieds & internet', /classified|marketplace|e-commerce|ecommerce|listings platform|online portal/i],
];

/* The words that decorate a company name in this market without telling you
   anything about what it does. */
const NOISE = /\b(ksa|saudi|arabia|middle east|mena|riyadh|group|co|llc|ltd)\b/g;

/**
 * One employer, against the table the organisation keeps. An exact name first,
 * then a loose match — "Aqar" should find "Aqar Real Estate KSA" — with a floor
 * on the length, because a three-letter fragment matches half the table.
 */
export function sectorOfCompany(
  company: string | null | undefined,
  table: Record<string, string[]>,
): string | null {
  const name = String(company ?? '').trim();
  if (!name) return null;

  for (const [sector, list] of Object.entries(table)) {
    if (list.some((x) => x.toLowerCase() === name.toLowerCase())) return sector;
  }
  const soft = name.toLowerCase().replace(NOISE, '').trim();
  if (soft.length <= 3) return null;
  for (const [sector, list] of Object.entries(table)) {
    if (list.some((x) => x.toLowerCase().includes(soft))) return sector;
  }
  return null;
}

export type SectorInput = {
  currentCompany?: string | null;
  currentTitle?: string | null;
  summary?: string | null;
  /** The experience as it was parsed, flattened to words. */
  history?: string | null;
  skills?: string[] | null;
};

/** The whole judgement: the employer first, then the words on the page. */
export function readSector(
  c: SectorInput, table: Record<string, string[]> = {},
): SectorRead {
  const company = c.currentCompany ?? '';
  const byCompany = sectorOfCompany(company, table);
  if (byCompany) {
    return {
      sector: byCompany,
      source: 'cv',
      why: `${company} is a ${byCompany.toLowerCase()} employer`,
    };
  }

  const text = [company, c.currentTitle ?? '', c.summary ?? '', c.history ?? '',
    (c.skills ?? []).join(' ')].join(' ');
  for (const [sector, re] of SECTOR_KEYS) {
    if (re.test(text)) {
      return { sector, source: 'cv', why: `the CV reads as ${sector.toLowerCase()}` };
    }
  }
  return { sector: 'Other', source: 'cv', why: 'nothing in the CV names an industry' };
}
