import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Exec } from '@/db/client';
import {
  candidateResumes, candidates, candidateSkills, jobs, jobSkills, applications, files,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { audit, type Ctx } from '@/lib/audit';
import { CommandError } from '@/lib/commands/registry';
import { aiAdapter, storageAdapter } from '@/lib/providers';
import { findDuplicate } from '@/lib/services/candidates';
import { docxText, isDocx } from '@/lib/domain/docx';

/* ═════════════════════════════════════════════════════════════════════════════
   READING A CV

   Somebody drops a PDF on the page and expects a candidate record. Between
   those two things sit four questions, and the intake sheet asks all four
   before anything is created:

     · what did the reader actually find, and where in the document did each
       field come from? Every field carries its provenance, so a recruiter can
       see that the salary was inferred and the name was on the first line;
     · is this person already on file? A duplicate found at intake costs a
       second; one found after two recruiters have rung them costs a candidate;
     · how well does this match the requisition? A score against the skills the
       job description asks for, with the reasoning shown;
     · is there a photograph in it?

   The parser is deliberately plain — sections, dates, e-mail, phone — and says
   what it is unsure of. When an AI provider is configured it is asked for a
   second reading, and the two are shown side by side rather than merged
   silently. When it is not, the plain reading stands and the record says so.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Provenance =
  | 'cv' | 'experience_section' | 'education_section' | 'skills_section'
  | 'languages_section' | 'personal_section' | 'email_address' | 'ai'
  | 'recruiter' | 'screening' | 'not_found';

export type Parsed = {
  name: string | null;
  email: string | null;
  phone: string | null;
  locationCity: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  yearsExperience: number | null;
  skills: string[];
  languages: Array<{ name: string; level: string }>;
  education: Array<{ degree: string; school: string; year?: number }>;
  experience: Array<{
    title: string; company: string; from?: string; to?: string; current?: boolean; bullets: string[];
  }>;
  sections: string[];
  summary: string | null;
  fieldSources: Record<string, Provenance>;
  confidence: number;
  hasTextLayer: boolean;
};

/* ── The plain reader ────────────────────────────────────────────────────── */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?966[\s-]?|0)?5\d[\s-]?\d{3}[\s-]?\d{4}/;
const YEARS = /(\d{1,2})\+?\s*(?:years?|yrs?)\b/i;

const SECTION_WORDS: Array<[string, RegExp]> = [
  ['summary', /^\s*(professional\s+)?(summary|profile|objective|about)\b/im],
  ['experience', /^\s*(work\s+)?(experience|employment|career\s+history)\b/im],
  ['education', /^\s*education\b/im],
  ['skills', /^\s*(skills|competencies|technical\s+skills)\b/im],
  ['languages', /^\s*languages?\b/im],
  ['certifications', /^\s*(certifications?|licences?|licenses?)\b/im],
  ['personal', /^\s*(personal|details|nationality)\b/im],
];

const CITIES = [
  'Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Mecca', 'Makkah', 'Medina', 'Madinah',
  'Dhahran', 'Jubail', 'Yanbu', 'Tabuk', 'Abha', 'Dubai', 'Abu Dhabi', 'Cairo', 'Amman',
];

const LANGUAGE_LEVELS = ['Native', 'Fluent', 'Conversational', 'Basic'];
const LANGUAGES = ['Arabic', 'English', 'Urdu', 'Hindi', 'Tagalog', 'French', 'Bengali', 'Malayalam'];

/** A section of the document, between its heading and the next one. */
function sectionAt(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const from = m.index + m[0].length;
  let to = text.length;
  for (const [, other] of SECTION_WORDS) {
    if (other === re) continue;
    const n = other.exec(text.slice(from));
    if (n && from + n.index < to) to = from + n.index;
  }
  return text.slice(from, to).trim();
}

/**
 * Read what is there. Everything it returns carries where it came from, and
 * anything it could not find is `not_found` rather than a guess.
 */
export function parse(text: string): Parsed {
  const clean = text.replace(/\r/g, '').replace(/\u00a0/g, ' ');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const sources: Record<string, Provenance> = {};

  const sections = SECTION_WORDS.filter(([, re]) => re.test(clean)).map(([name]) => name);

  /* The name is the first line that reads like one: two or three words, no
     digits, not an address. */
  const name = lines.slice(0, 6).find((l) =>
    /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3}$/u.test(l) && !EMAIL.test(l)) ?? null;
  sources.name = name ? 'cv' : 'not_found';

  const email = EMAIL.exec(clean)?.[0] ?? null;
  sources.email = email ? 'cv' : 'not_found';

  const phone = PHONE.exec(clean)?.[0]?.replace(/[\s-]/g, '') ?? null;
  sources.phone = phone ? 'cv' : 'not_found';

  const locationCity = CITIES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(clean)) ?? null;
  sources.locationCity = locationCity ? 'personal_section' : 'not_found';

  const experienceText = sectionAt(clean, SECTION_WORDS[1][1]) ?? '';
  const experience = readExperience(experienceText);
  sources.currentTitle = experience[0]?.title ? 'experience_section' : 'not_found';
  sources.currentCompany = experience[0]?.company ? 'experience_section' : 'not_found';

  /* Years: what the CV claims, else what the dates add up to. */
  const claimed = YEARS.exec(clean)?.[1];
  const spanned = experience.reduce((n, e) => {
    const from = Number(e.from?.slice(0, 4));
    const to = e.current ? new Date().getUTCFullYear() : Number(e.to?.slice(0, 4));
    return Number.isFinite(from) && Number.isFinite(to) && to >= from ? n + (to - from) : n;
  }, 0);
  const yearsExperience = claimed ? Number(claimed) : (spanned || null);
  sources.yearsExperience = claimed ? 'cv' : spanned ? 'experience_section' : 'not_found';

  const skillsText = sectionAt(clean, SECTION_WORDS[3][1]) ?? '';
  const skills = [...new Set(
    skillsText.split(/[,;•·\n|]/).map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40 && !/^\d+$/.test(s)),
  )].slice(0, 30);
  sources.skills = skills.length ? 'skills_section' : 'not_found';

  const languagesText = sectionAt(clean, SECTION_WORDS[4][1]) ?? clean;
  const languages = LANGUAGES
    .filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(languagesText))
    .map((name2) => {
      const near = new RegExp(`${name2}[^\\n]{0,30}`, 'i').exec(languagesText)?.[0] ?? '';
      const level = LANGUAGE_LEVELS.find((lv) => new RegExp(lv, 'i').test(near)) ?? 'Conversational';
      return { name: name2, level };
    });
  sources.languages = languages.length ? 'languages_section' : 'not_found';

  const educationText = sectionAt(clean, SECTION_WORDS[2][1]) ?? '';
  const education = educationText.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => /bachelor|master|diploma|degree|bsc|ba\b|mba|phd|university|college/i.test(l))
    .slice(0, 5)
    .map((l) => {
      const year = /(19|20)\d{2}/.exec(l)?.[0];
      const [degree, school] = l.split(/[,–—|]/).map((x) => x.trim());
      return { degree: degree ?? l, school: school ?? '', year: year ? Number(year) : undefined };
    });
  sources.education = education.length ? 'education_section' : 'not_found';

  const summary = sectionAt(clean, SECTION_WORDS[0][1])?.split('\n').slice(0, 4).join(' ').trim() || null;
  sources.summary = summary ? 'cv' : 'not_found';

  /* How much of what matters was found. */
  const wanted = ['name', 'email', 'phone', 'currentTitle', 'currentCompany', 'yearsExperience', 'skills'];
  const found = wanted.filter((k) => sources[k] && sources[k] !== 'not_found').length;

  return {
    name,
    email,
    phone,
    locationCity,
    currentTitle: experience[0]?.title ?? null,
    currentCompany: experience[0]?.company ?? null,
    yearsExperience,
    skills,
    languages,
    education,
    experience,
    sections,
    summary,
    fieldSources: sources,
    confidence: Math.round((found / wanted.length) * 100) / 100,
    /* A PDF of scanned pages has almost no extractable text. */
    hasTextLayer: clean.replace(/\s/g, '').length > 200,
  };
}

const DATE_RANGE = /((?:19|20)\d{2})\s*[-–—to]+\s*((?:19|20)\d{2}|present|current|now)/i;

function readExperience(text: string): Parsed['experience'] {
  const out: Parsed['experience'] = [];
  /* A block starts at a line that is not a bullet: a role's heading. The
     bullets under it are what somebody did there, not three more jobs. */
  const blocks = text.split(/\n(?=[^\s\u2022\u00b7*-])/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const head = lines[0];
    if (/^[\u2022\u00b7*-]/.test(head)) continue;
    const range = DATE_RANGE.exec(head);
    if (!range && !/\bat\b|\u2014|\u2013/.test(head)) continue;

    /* The dates sit on the same line as the role. Take them off before the
       company is read, or the company becomes "Aqar 2021 - Present". */
    const withoutDates = head.replace(DATE_RANGE, '').trim();
    const [title, company] = withoutDates
      .split(/\s+(?:at|\u2014|\u2013|\|)\s+/)
      .map((x) => x.replace(/[\s,;\u2013\u2014-]+$/, '').trim());
    if (!title) continue;
    out.push({
      title: title.slice(0, 120),
      company: (company ?? '').slice(0, 120),
      from: range?.[1],
      to: /present|current|now/i.test(range?.[2] ?? '') ? undefined : range?.[2],
      current: /present|current|now/i.test(range?.[2] ?? ''),
      bullets: lines.slice(1)
        .filter((l) => /^[\u2022\u00b7*-]/.test(l))
        .map((l) => l.replace(/^[\u2022\u00b7*-]\s*/, ''))
        .slice(0, 6),
    });
    if (out.length >= 8) break;
  }
  return out;
}

/* ── Matching a CV against a requisition ─────────────────────────────────── */

export type Fit = {
  score: number;
  matched: string[];
  missing: string[];
  note: string;
};

/**
 * How well what the CV says lines up with what the requisition asks for. The
 * skills the job description names, weighted by whether they are essential, and
 * the reasoning is the two lists — nothing here is a black box.
 */
export async function fitAgainst(
  input: { jobId: string; skills: string[]; yearsExperience: number | null },
  exec: Exec,
): Promise<Fit> {
  const wants = await exec.select().from(jobSkills)
    .where(eq(jobSkills.jobId, input.jobId));
  if (!wants.length) {
    return { score: 50, matched: [], missing: [], note: 'This requisition names no skills to match against.' };
  }

  const have = input.skills.map((s) => s.toLowerCase());
  const matched: string[] = [];
  const missing: string[] = [];
  let points = 0;
  let total = 0;

  for (const w of wants) {
    const weight = w.must ? 2 : 1;
    total += weight;
    const hit = have.some((h) => h.includes(w.skill.toLowerCase()) || w.skill.toLowerCase().includes(h));
    if (hit) { points += weight; matched.push(w.skill); } else { missing.push(w.skill); }
  }

  const [job] = await exec.select({ salaryMin: jobs.salaryMin }).from(jobs)
    .where(eq(jobs.id, input.jobId)).limit(1);
  const wantsYears = (job?.salaryMin ?? 0) > 20_000 ? 5 : 2;
  const yearsOk = (input.yearsExperience ?? 0) >= wantsYears;

  /* Skills are most of it; the years are the rest. */
  const score = Math.round(((points / total) * 0.8 + (yearsOk ? 0.2 : 0)) * 100);
  const note = matched.length
    ? `${matched.length} of ${wants.length} skills the requisition asks for`
      + (missing.length ? `, missing ${missing.slice(0, 3).join(', ')}` : '')
      + (yearsOk ? '' : `, and under ${wantsYears} years`)
    : 'None of the skills the requisition asks for are on this CV';

  return { score, matched, missing, note };
}

/* ── Intake ──────────────────────────────────────────────────────────────── */

export type IntakeResult = {
  parsed: Parsed;
  duplicate: { id: string; name: string; matchedOn: string } | null;
  fit: Fit | null;
  readBy: 'local' | 'ai';
  aiNote: string | null;
};

/**
 * Read a CV and report what it says. Nothing is created here: the intake sheet
 * shows the reading, the duplicate and the fit, and a person decides.
 */
export async function read(
  input: { fileId: string; text: string; jobId?: string | null },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<IntakeResult> {
  const parsed = parse(input.text);

  /* A second reading, when there is something to read with. */
  let readBy: 'local' | 'ai' = 'local';
  let aiNote: string | null = null;
  const ai = aiAdapter();
  if (ai.status().configured && parsed.hasTextLayer) {
    const r = await ai.json<Partial<Parsed>>({
      prompt: 'Read this CV and return JSON with name, email, phone, locationCity, '
        + 'currentTitle, currentCompany, yearsExperience (a number) and skills (an array of '
        + `strings). Use null where the CV does not say.\n\n${input.text.slice(0, 12_000)}`,
    });
    if (r.ok) {
      readBy = 'ai';
      const v = r.detail!.value;
      /* The model fills what the plain reader could not, and never overwrites
         what it could: a field that was found in the document keeps its
         provenance. */
      for (const key of ['name', 'email', 'phone', 'locationCity', 'currentTitle', 'currentCompany'] as const) {
        if (parsed.fieldSources[key] === 'not_found' && typeof v[key] === 'string' && v[key]) {
          (parsed as Record<string, unknown>)[key] = v[key];
          parsed.fieldSources[key] = 'ai';
        }
      }
      if (parsed.fieldSources.yearsExperience === 'not_found' && Number.isFinite(Number(v.yearsExperience))) {
        parsed.yearsExperience = Number(v.yearsExperience);
        parsed.fieldSources.yearsExperience = 'ai';
      }
      if (!parsed.skills.length && Array.isArray(v.skills)) {
        parsed.skills = v.skills.map(String).slice(0, 30);
        parsed.fieldSources.skills = 'ai';
      }
    } else if (r.reason === 'failed') {
      aiNote = `${r.message} — the plain reading stands`;
    }
  } else if (!ai.status().configured) {
    aiNote = 'No assistant is configured, so this is the plain reading';
  } else if (!parsed.hasTextLayer) {
    aiNote = 'That PDF has no text in it — it is a scan. Type the details in.';
  }

  const duplicate = await findDuplicate(
    { email: parsed.email, phone: parsed.phone }, ctx.tx,
  );

  const fit = input.jobId
    ? await fitAgainst({
      jobId: input.jobId,
      skills: parsed.skills,
      yearsExperience: parsed.yearsExperience,
    }, ctx.tx)
    : null;

  /* A reading is not stored until there is somebody to store it against: a CV
     that is read and then discarded should leave nothing behind but the trail
     saying it was read. `attach` writes the row once a candidate exists. */
  await audit(ctx, {
    action: 'action',
    summary: `read a CV — ${parsed.name ?? 'no name found'}`
      + (duplicate ? `, already on file as ${duplicate.name}` : ''),
    entityType: 'resume', entityId: input.fileId, entityLabel: parsed.name ?? 'unnamed',
    after: {
      confidence: parsed.confidence,
      readBy,
      duplicate: duplicate?.id ?? null,
      fit: fit?.score ?? null,
    },
  }, ctx.tx);

  return { parsed, duplicate, fit, readBy, aiNote };
}

/**
 * Keep the reading against the candidate it produced. The one before it stops
 * being current rather than being deleted: a CV somebody was hired from is part
 * of the record.
 */
export async function attach(
  input: {
    candidateId: string; fileId: string; fileName?: string | null;
    text: string; parsed: Parsed; readBy: 'local' | 'ai';
  },
  ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ resumeId: string }> {
  await ctx.tx.update(candidateResumes)
    .set({ isCurrent: false })
    .where(and(
      eq(candidateResumes.candidateId, input.candidateId),
      eq(candidateResumes.isCurrent, true),
    ));

  const resumeId = `res_${crypto.randomUUID().slice(0, 12)}`;
  await ctx.tx.insert(candidateResumes).values({
    id: resumeId,
    candidateId: input.candidateId,
    fileId: input.fileId,
    fileName: input.fileName ?? null,
    parsed: true,
    confidence: String(input.parsed.confidence),
    hasTextLayer: input.parsed.hasTextLayer,
    summary: input.parsed.summary,
    rawText: input.text.slice(0, 200_000),
    sections: input.parsed.sections,
    experience: input.parsed.experience,
    education: input.parsed.education,
    languages: input.parsed.languages,
    fieldSources: input.parsed.fieldSources,
    parserVersion: 'plain-1',
    parsedBy: input.readBy,
    isCurrent: true,
    uploadedAt: ctx.now,
    uploadedBy: ctx.viewer.staffId ?? null,
  });
  return { resumeId };
}

/* ── The words in the file ───────────────────────────────────────────────── */

/**
 * The text of an uploaded CV, whatever it arrived as.
 *
 * Three shapes reach this: a PDF, a .docx, and plain text. A PDF is a
 * container whose words live in text-showing operators; a .docx is a zip of
 * XML. Both are pulled apart here rather than through a document library the
 * product would otherwise carry for one screen.
 *
 * A PDF that is a scan yields almost nothing, and that is the honest answer —
 * `parse` reports `hasTextLayer: false` and the intake sheet says to type the
 * details in rather than showing an empty reading as a reading.
 */
export async function textOfFile(
  fileId: string, exec: Exec,
): Promise<{ text: string; name: string; contentType: string }> {
  const [f] = await exec.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.deletedAt) throw new CommandError('That file is not here any more');
  if (f.scanState === 'infected') throw new CommandError('That file was found to be infected');

  const got = await storageAdapter().get(f.storageKey);
  if (!got.ok) throw new CommandError(`That file could not be read back: ${got.message}`);
  const bytes = got.detail!.bytes;

  let text: string;
  if (f.contentType === 'application/pdf') {
    text = pdfText(new TextDecoder('latin1').decode(bytes));
  } else if (isDocx(f.contentType, f.originalName)) {
    text = docxText(bytes);
  } else {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  return { text, name: f.originalName, contentType: f.contentType };
}

/** The strings inside a PDF's text-showing operators, in page order. */
export function pdfText(raw: string): string {
  const out: string[] = [];
  const show = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\][]|\\.)*\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = show.exec(raw))) {
    const pieces = m[0].match(/\((?:\\.|[^\\()])*\)/g) ?? [];
    out.push(pieces.map((piece) => piece.slice(1, -1)
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')).join(''));
    if (/TJ$/.test(m[0])) out.push('\n');
  }
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

/* ── From staged to theirs ───────────────────────────────────────────────── */

/**
 * A CV that was uploaded before there was anybody to attach it to.
 *
 * Intake stores the file under the organisation while a person decides, which
 * means nothing owns it and the access rules that govern a CV have nothing to
 * govern. This is the moment that changes: the file is handed to the candidate,
 * the reading kept on it is kept against them, and from here on who may read it
 * is decided by who may see them.
 *
 * It is deliberately refused rather than silently re-pointed when the file
 * already belongs to somebody else — a CV cannot be two people's.
 */
export async function attachStaged(
  fileId: string, candidateId: string, ctx: Ctx & { tx: Exec; now: Date },
): Promise<{ resumeId: string }> {
  const [f] = await ctx.tx.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.deletedAt) throw new CommandError('That résumé is no longer here');
  if (f.kind !== 'cv') throw new CommandError('That file is not a CV');
  if (f.ownerType === 'candidate' && f.ownerId !== candidateId) {
    throw new CommandError('That CV already belongs to somebody else');
  }

  const meta = (f.metadata ?? {}) as { parsed?: Parsed; readBy?: 'local' | 'ai' };
  const { text } = await textOfFile(fileId, ctx.tx);
  const parsed = meta.parsed?.fieldSources ? meta.parsed : parse(text);

  if (f.ownerType !== 'candidate' || f.ownerId !== candidateId) {
    const rest = { ...(f.metadata ?? {}) } as Record<string, unknown>;
    delete rest.staged;
    delete rest.forForm;
    await ctx.tx.update(files)
      .set({ ownerType: 'candidate', ownerId: candidateId, metadata: rest })
      .where(eq(files.id, fileId));
    await audit(ctx, {
      action: 'update',
      summary: `attached ${f.originalName} to a candidate record`,
      entityType: 'file', entityId: fileId, entityLabel: f.originalName,
      before: { owner: `${f.ownerType}:${f.ownerId}` },
      after: { owner: `candidate:${candidateId}` },
    }, ctx.tx);
  }

  return attach({
    candidateId,
    fileId,
    fileName: f.originalName,
    text,
    parsed,
    readBy: meta.readBy === 'ai' ? 'ai' : 'local',
  }, ctx);
}
