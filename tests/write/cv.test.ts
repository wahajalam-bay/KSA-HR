import { sql, eq, and } from 'drizzle-orm';
import { candidates, candidateResumes, applications, files, auditEvents } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';
import { parse, read, attach, fitAgainst } from '@/lib/services/cv';
import { upload } from '@/lib/services/files';
import type { Ctx } from '@/lib/audit';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 13 — reading a CV.

   The reader is deliberately plain, so the suite is mostly about what it says
   when it is unsure: a field it could not find is `not_found` rather than a
   guess, a scan with no text in it says so, and a duplicate is reported before
   anything is created rather than after two recruiters have rung the same
   person.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const manager = viewer({
  name: 'Saud Al-Harbi', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

const ctxOf = (tx: Parameters<typeof runIn>[0], who = recruiter) => ({
  viewer: who,
  requestId: 'test',
  correlationId: 'test',
  tx,
  now: new Date(),
}) as Ctx & { tx: typeof tx; now: Date };

const CV = [
  'Hessa Al-Rasheed',
  'hessa.alrasheed@example.com · +966 55 448 1290 · Riyadh, Saudi Arabia',
  '',
  'Professional summary',
  'Property consultant with 7 years selling residential and off-plan across Riyadh.',
  '',
  'Experience',
  'Senior Property Consultant at Aqar  2021 - Present',
  '• Closed 41 units in 2024, 18% above target',
  '• Built the referral programme for the Olaya office',
  'Property Consultant at Wasalt  2018 - 2021',
  '• Handled the off-plan launch for two developers',
  '',
  'Education',
  'Bachelor of Business Administration, King Saud University, 2017',
  '',
  'Skills',
  'Negotiation, CRM, Off-plan sales, Lead qualification, Arabic copywriting',
  '',
  'Languages',
  'Arabic — Native',
  'English — Fluent',
].join('\n');

async function aJob(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT j.id, j.title FROM jobs j
     WHERE j.status = 'open' AND EXISTS (SELECT 1 FROM job_skills s WHERE s.job_id = j.id)
     ORDER BY j.id LIMIT 1`));
  return row as { id: string; title: string };
}

const suite: Suite = {
  name: 'write · reading a CV',
  tests: [
    {
      name: 'the reader finds what is there and says where each field came from',
      fn() {
        const p = parse(CV);
        equals(p.name, 'Hessa Al-Rasheed');
        equals(p.email, 'hessa.alrasheed@example.com');
        equals(p.phone, '+966554481290');
        equals(p.locationCity, 'Riyadh');
        equals(p.yearsExperience, 7, 'from what the CV claims');
        equals(p.fieldSources.yearsExperience, 'cv');
        equals(p.currentTitle, 'Senior Property Consultant');
        equals(p.currentCompany, 'Aqar');
        equals(p.fieldSources.currentCompany, 'experience_section');
        ok(p.skills.includes('Negotiation'), 'the skills are read from their own section');
        equals(p.fieldSources.skills, 'skills_section');
        equals(p.languages.find((l) => l.name === 'Arabic')?.level, 'Native');
        ok(p.education.length >= 1, 'and the degree');
        ok(p.sections.includes('experience') && p.sections.includes('skills'),
          'the sections it recognised are listed');
        ok(p.confidence > 0.8, 'and it is confident about a CV like this one');
        ok(p.hasTextLayer, 'and there is text in it');
      },
    },

    {
      name: 'a field that is not in the document is not invented',
      fn() {
        const thin = 'Ahmed\n\nLooking for work.';
        const p = parse(thin);
        equals(p.email, null);
        equals(p.fieldSources.email, 'not_found');
        equals(p.currentCompany, null);
        equals(p.fieldSources.currentCompany, 'not_found');
        equals(p.yearsExperience, null);
        ok(p.confidence < 0.4, 'and it says how little it found');
      },
    },

    {
      name: 'a scan with no text in it says so rather than returning nothing',
      fn() {
        const p = parse('%PDF-1.4 \n obj stream endstream');
        equals(p.hasTextLayer, false);
      },
    },

    {
      name: 'two experience entries are read in order, with the current one first',
      fn() {
        const p = parse(CV);
        equals(p.experience.length, 2);
        equals(p.experience[0].company, 'Aqar');
        ok(p.experience[0].current, 'the first is the one they are in');
        equals(p.experience[1].company, 'Wasalt');
        equals(p.experience[1].to, '2021');
        ok(p.experience[0].bullets.length >= 2, 'and what they did there');
      },
    },

    {
      name: 'the fit against a requisition is the skills it asks for, with the reasoning',
      async fn() {
        await inRollback(async (tx) => {
          const j = await aJob(tx);
          const wants = rowsOf(await tx.execute(sql`
            SELECT skill, must FROM job_skills
             WHERE job_id = ${j.id} ORDER BY sort_order`)) as Array<{ skill: string; must: boolean }>;

          const none = await fitAgainst({ jobId: j.id, skills: [], yearsExperience: 1 }, tx);
          equals(none.matched.length, 0);
          equals(none.missing.length, wants.length);
          includes(none.note, 'None of the skills');

          const all = await fitAgainst({
            jobId: j.id, skills: wants.map((w) => w.skill), yearsExperience: 12,
          }, tx);
          equals(all.score, 100, 'everything matched and the years are there');
          equals(all.missing.length, 0);
          includes(all.note, `${wants.length} of ${wants.length} skills`);
        });
      },
    },

    {
      name: 'a CV that matches somebody already on file says so before anything is created',
      async fn() {
        await inRollback(async (tx) => {
          const [existing] = rowsOf(await tx.execute(sql`
            SELECT id, name, email FROM candidates
             WHERE email IS NOT NULL ORDER BY id LIMIT 1`)) as Array<{
               id: string; name: string; email: string;
             }>;

          const r = await read({
            fileId: 'fil_test',
            text: `Somebody Else\n${existing.email}\n\nExperience\nX at Y 2020 - Present`,
          }, ctxOf(tx));

          ok(r.duplicate, 'the duplicate is found');
          equals(r.duplicate!.id, existing.id);
          includes(r.duplicate!.matchedOn, 'mail');

          const made = await tx.select().from(candidates)
            .where(sql`${candidates.name} = 'Somebody Else'`);
          equals(made.length, 0, 'and nothing was created');
        });
      },
    },

    {
      name: 'a reading is only kept once there is somebody to keep it against',
      async fn() {
        await inRollback(async (tx) => {
          const ctx = ctxOf(tx);
          const before = await tx.select().from(candidateResumes);
          await read({ fileId: 'fil_test', text: CV }, ctx);
          const after = await tx.select().from(candidateResumes);
          equals(after.length, before.length, 'reading it writes no resume row');

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityType, 'resume'));
          ok(trail.length >= 1, 'but the fact it was read is on the record');
          includes(trail[0].summary, 'Hessa Al-Rasheed');
        });
      },
    },

    {
      name: 'attaching a reading makes it the current one and keeps the last',
      async fn() {
        await inRollback(async (tx) => {
          const ctx = ctxOf(tx);
          const [c] = rowsOf(await tx.execute(sql`
            SELECT id FROM candidates ORDER BY id LIMIT 1`)) as Array<{ id: string }>;

          const parsed = parse(CV);
          const first = await attach({
            candidateId: c.id, fileId: 'fil_one', fileName: 'cv.pdf',
            text: CV, parsed, readBy: 'local',
          }, ctx);
          const second = await attach({
            candidateId: c.id, fileId: 'fil_two', fileName: 'cv-updated.pdf',
            text: CV, parsed, readBy: 'local',
          }, ctx);

          const all = await tx.select().from(candidateResumes)
            .where(eq(candidateResumes.candidateId, c.id));
          const current = all.filter((r) => r.isCurrent);
          equals(current.length, 1, 'exactly one is current');
          equals(current[0].id, second.resumeId, 'and it is the newest');
          ok(all.some((r) => r.id === first.resumeId), 'the one before it is kept');
        });
      },
    },

    {
      name: 'reading and creating are two commands, and a hiring manager may do neither',
      async fn() {
        await inRollback(async (tx) => {
          const ctx = ctxOf(tx);
          const [c] = rowsOf(await tx.execute(sql`
            SELECT id FROM candidates ORDER BY id LIMIT 1`)) as Array<{ id: string }>;
          const f = await upload({
            kind: 'cv',
            ownerType: 'candidate',
            ownerId: c.id,
            originalName: 'hessa.txt',
            contentType: 'text/plain',
            bytes: new TextEncoder().encode(CV),
          }, ctx);

          refused(await runIn(tx, 'cv.read', manager, { v: f.fileId }), 'access');

          const r = await runIn(tx, 'cv.read', recruiter, { v: f.fileId });
          succeeded(r, 'cv.read');
          const data = (r as { data?: Record<string, unknown> }).data ?? {};
          const parsed = data.parsed as ReturnType<typeof parse>;
          equals(parsed.name, 'Hessa Al-Rasheed');
          equals(data.readBy, 'local', 'with no assistant configured, the plain reading stands');
          includes(String(data.note ?? ''), 'No assistant is configured');

          const madeBefore = await tx.select().from(candidates)
            .where(sql`${candidates.name} = 'Hessa Al-Rasheed'`);
          equals(madeBefore.length, 0, 'reading creates nobody');
        });
      },
    },

    {
      name: 'confirming the reading creates the candidate and puts them on the requisition',
      async fn() {
        await inRollback(async (tx) => {
          const ctx = ctxOf(tx);
          const j = await aJob(tx);
          /* Uploaded the way intake uploads it: staged under the organisation,
             belonging to nobody until somebody has looked at the reading. */
          const f = await upload({
            kind: 'cv', ownerType: 'org', ownerId: 'intake',
            originalName: 'hessa.txt', contentType: 'text/plain',
            bytes: new TextEncoder().encode(CV),
            metadata: { staged: true },
          }, ctx);

          const parsed = parse(CV);
          const r = await runIn(tx, 'cv.create', recruiter, {
            v: f.fileId,
            fields: {
              jobId: j.id,
              name: parsed.name ?? '',
              email: parsed.email ?? '',
              phone: parsed.phone ?? '',
              locationCity: parsed.locationCity ?? '',
              currentTitle: parsed.currentTitle ?? '',
              currentCompany: parsed.currentCompany ?? '',
              yearsExperience: String(parsed.yearsExperience ?? ''),
              skills: parsed.skills,
              parsed: JSON.stringify(parsed),
              source: 'CV — uploaded by the recruiter',
            },
          });
          succeeded(r, 'cv.create');
          includes(String((r as { toast?: string }).toast), 'Hessa Al-Rasheed');

          const [made] = await tx.select().from(candidates)
            .where(sql`${candidates.name} = 'Hessa Al-Rasheed'`);
          ok(made, 'the candidate exists');
          equals(made.currentCompany, 'Aqar');
          equals(made.yearsExperience, 7);

          const [resume] = await tx.select().from(candidateResumes)
            .where(and(eq(candidateResumes.candidateId, made.id), eq(candidateResumes.isCurrent, true)));
          ok(resume, 'with the reading kept against them');
          equals(resume.fileId, f.fileId);
          ok(resume.rawText?.includes('Aqar'), 'and the text it came from');
          equals(resume.fieldSources.currentCompany, 'experience_section');

          const [app] = await tx.select().from(applications)
            .where(and(eq(applications.candidateId, made.id), eq(applications.jobId, j.id)));
          ok(app, 'and they are on the requisition');
          equals(app.source, 'CV — uploaded by the recruiter');

          /* The file stops being staged and becomes theirs, so from here on
             who may read it is decided by who may see them. */
          const [stored] = rowsOf(await tx.execute(sql`
            SELECT owner_type AS "ownerType", owner_id AS "ownerId"
              FROM files WHERE id = ${f.fileId}`)) as
            Array<{ ownerType: string; ownerId: string }>;
          equals(stored.ownerType, 'candidate');
          equals(stored.ownerId, made.id);
        });
      },
    },
  ],
};

export default suite;
