import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { candidates, candidateSkills, candidateResumes, orgSettings, files as filesTable } from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { list as listOf, str } from './fields';
import { requireJob } from '@/lib/authz';
import { read, attachStaged, fitAgainst, textOfFile, type Parsed } from '@/lib/services/cv';
import { nextStaged } from './uploads';
import { createCandidate, apply } from '@/lib/services/candidates';
import { recomputeFit } from '@/lib/services/fit';
import { readSector } from '@/lib/domain/sector';
import { audit } from '@/lib/audit';

/* ─────────────────────────────────────────────────────────────────────────────
   CV intake.

   Two commands, in the order a recruiter uses them:

     · `cv.read` — the file is already uploaded; this reads it and returns what
       it found, who it might already be, and how well it matches. Nothing is
       created;
     · `cv.create` — the recruiter has looked at that and says yes. The
       candidate is created (or the duplicate is used), the reading is kept
       against them, and they are put on the requisition.

   The split is the point. A CV reader that creates a candidate the moment a
   file lands produces a database full of half-read duplicates.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const num = (f: Record<string, unknown>, k: string): number | null => {
  const raw = str(f, k);
  if (!raw) return null;
  const n = Number(raw.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

/* The reading of the file itself lives with the parser, in
   lib/services/cv.ts — a PDF's text operators and a .docx's XML are the same
   question as what the words mean, and keeping them together is what lets the
   staged-résumé path and the intake path read a file the same way. */

defineMany({
  'cv.read': {
    capability: 'cv.parse',
    schema: base,
    async run({ v, fields }, ctx) {
      const jobId = str(fields, 'jobId') || null;
      if (jobId) await requireJob(ctx.viewer, jobId, ctx.tx);

      const { text, name } = await textOfFile(v, ctx.tx);
      const r = await read({ fileId: v, text, jobId }, ctx);

      return {
        refresh: false,
        toast: r.parsed.hasTextLayer
          ? `Read — ${Math.round(r.parsed.confidence * 100)}% of the fields found`
            + (r.duplicate ? `, and ${r.duplicate.name} is already on file` : '')
          : 'That PDF is a scan, so there is nothing to read — type the details in',
        tone: r.parsed.hasTextLayer && !r.duplicate ? undefined : 'warn',
        icon: 'spark',
        ms: 4600,
        data: {
          fileId: v,
          fileName: name,
          parsed: r.parsed as unknown as Record<string, unknown>,
          duplicate: r.duplicate,
          fit: r.fit,
          readBy: r.readBy,
          note: r.aiNote,
        },
      };
    },
  },

  /* The recruiter has looked at the reading and corrected it. What arrives here
     is what they saw, not what the parser said — the fields are editable. */
  'cv.create': {
    capability: 'cv.confirm',
    schema: base,
    async run({ v, fields }, ctx) {
      const fileId = v || str(fields, 'fileId');
      if (!fileId) throw new CommandError('That CV is not here any more');

      /* The panel ticks requisitions rather than picking one: somebody read off
         an agency's CV is often worth two open roles, and making the recruiter
         repeat the whole intake to say so is how a product teaches people to
         only ever apply them to one. Each is checked against their scope. */
      const jobIds = [...new Set([...listOf(fields, 'jobIds'), str(fields, 'jobId')].filter(Boolean))];
      for (const id of jobIds) await requireJob(ctx.viewer, id, ctx.tx);

      const useExisting = str(fields, 'useExisting');
      let candidateId = useExisting;
      let candidateName = '';

      if (useExisting) {
        const [c] = await ctx.tx.select().from(candidates)
          .where(eq(candidates.id, useExisting)).limit(1);
        if (!c) throw new CommandError('That candidate is no longer on file');
        candidateName = c.name;
      } else {
        const made = await createCandidate({
          name: str(fields, 'name'),
          email: str(fields, 'email') || null,
          phone: str(fields, 'phone') || null,
          locationCity: str(fields, 'locationCity') || null,
          nationality: str(fields, 'nationality') || null,
          headline: str(fields, 'headline') || null,
          currentTitle: str(fields, 'currentTitle') || null,
          currentCompany: str(fields, 'currentCompany') || null,
          yearsExperience: num(fields, 'yearsExperience'),
          noticeDays: num(fields, 'noticeDays'),
          expectedSalary: num(fields, 'expectedSalary'),
          currentSalary: num(fields, 'currentSalary'),
          currentSalarySource: num(fields, 'currentSalary') != null ? 'cv' : null,
          linkedin: str(fields, 'linkedin') || null,
          skills: listOf(fields, 'skills'),
          hashtags: listOf(fields, 'hashtags'),
        }, ctx, { allowDuplicate: str(fields, 'allowDuplicate') === '1' });
        candidateId = made.id;
        candidateName = str(fields, 'name');
      }

      /* The reading the panel showed is what is kept — the fields are editable,
         and a recruiter who corrected the parser should not have their
         correction overwritten by the parser on the way in. The file stops
         being a staged upload here and becomes theirs. */
      const edited = JSON.parse(str(fields, 'parsed') || '{}') as Parsed;
      if (edited.fieldSources) {
        const [f] = await ctx.tx.select({ metadata: filesTable.metadata })
          .from(filesTable).where(eq(filesTable.id, fileId)).limit(1);
        await ctx.tx.update(filesTable)
          .set({ metadata: { ...(f?.metadata ?? {}), parsed: edited as unknown as Record<string, unknown> } })
          .where(eq(filesTable.id, fileId));
      }
      await attachStaged(fileId, candidateId, ctx);

      /* Whatever is left in this person's intake queue — several CVs at once is
         the ordinary case, and the panel moves straight on to the next rather
         than making somebody find it again. */
      const next = await nextStaged(ctx.viewer.staffId ?? ctx.viewer.accountId ?? '', ctx.tx);

      if (!jobIds.length) {
        return {
          toast: `${candidateName} added from their CV`,
          icon: 'uplus',
          closeSheet: 'all',
          openSheet: next
            ? { act: 'cv.review', v: next }
            : { act: 'drawer.cand', v: candidateId },
          data: { candidateId, next },
        };
      }

      const applied: Array<{ applicationId: string; jobTitle: string; stageName: string; candidateName: string }> = [];
      const already: string[] = [];
      for (const id of jobIds) {
        try {
          const a = await apply({
            candidateId,
            jobId: id,
            source: str(fields, 'source') || 'CV — uploaded by the recruiter',
          }, ctx);
          await recomputeFit({ applicationId: a.applicationId }, ctx.tx);
          applied.push(a);
        } catch (e) {
          /* Already in that pipeline is not a failure of the intake — the
             candidate is created, and the rest of the requisitions still get
             them. It is said out loud rather than swallowed. */
          if (e instanceof CommandError) already.push(`${e.message}`);
          else throw e;
        }
      }

      if (!applied.length) {
        return {
          toast: `${candidateName} added — ${already[0] ?? 'no requisition took them'}`,
          tone: 'warn',
          ms: 5200,
          icon: 'uplus',
          closeSheet: 'all',
          openSheet: next ? { act: 'cv.review', v: next } : { act: 'drawer.cand', v: candidateId },
          data: { candidateId, next },
        };
      }

      const first = applied[0];
      return {
        toast: applied.length === 1
          ? `${first.candidateName} added to ${first.jobTitle} at ${first.stageName}`
          : `${first.candidateName} added to ${applied.length} requisitions`
            + (already.length ? `, ${already.length} refused` : ''),
        tone: already.length ? 'warn' : undefined,
        ms: already.length ? 5200 : undefined,
        icon: 'uplus',
        closeSheet: 'all',
        openSheet: next
          ? { act: 'cv.review', v: next }
          : { act: 'drawer.open', v: first.applicationId },
        data: {
          candidateId,
          applicationId: first.applicationId,
          applications: applied.map((a) => a.applicationId),
          refused: already,
          next,
        },
      };
    },
  },

  /* Scoring a CV already on file against a requisition — the Fit column. */
  'cv.fit': {
    capability: 'cv.parse',
    schema: base,
    async run({ v, fields }, ctx) {
      const jobId = str(fields, 'jobId');
      if (!jobId) throw new CommandError('Against which requisition?');
      await requireJob(ctx.viewer, jobId, ctx.tx);

      const [c] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!c) throw new CommandError('That candidate is no longer on file');

      const skills = await ctx.tx.select({ skill: candidateSkills.skill })
        .from(candidateSkills)
        .where(eq(candidateSkills.candidateId, v));

      const fit = await fitAgainst({
        jobId,
        skills: skills.map((s) => s.skill),
        yearsExperience: c.yearsExperience,
      }, ctx.tx);

      return { refresh: false, data: { ...fit } };
    },
  },

  /* ── Re-reading which industry somebody comes out of ──────────────────── */
  /* The sector is written when the CV is first read, and a recruiter who has
     since corrected the company — or who has just uploaded a better CV — wants
     it read again. The judgement is rules, in lib/domain/sector.ts: the
     employer against the organisation's own table first, then the words on the
     page. It says what it read, so a recruiter who disagrees can see why and
     correct it by hand, which is recorded as theirs rather than the CV's. */
  'cv.sector': {
    capability: 'cv.parse',
    schema: base,
    async run({ v, fields }, ctx) {
      const [c] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!c) throw new CommandError('That candidate is no longer on file');

      /* A recruiter may say it outright, which beats any reading. */
      const typed = str(fields, 'sector');
      if (typed) {
        await ctx.tx.update(candidates).set({
          sector: typed, sectorSource: 'recruiter', updatedAt: ctx.now,
        }).where(eq(candidates.id, v));
        await audit(ctx, {
          action: 'update',
          summary: `set ${c.name}’s sector to ${typed}`,
          entityType: 'candidate', entityId: v, entityLabel: c.name,
          before: { sector: c.sector, source: c.sectorSource }, after: { sector: typed, source: 'recruiter' },
        }, ctx.tx);
        return { toast: `Sector set to ${typed}`, icon: 'spark' };
      }

      /* The table of employers is the organisation's own — a fact about this
         market rather than about software — and lives with its settings. */
      const [org] = await ctx.tx.select({ extra: orgSettings.extra })
        .from(orgSettings).limit(1);
      const table = ((org?.extra as { sectorCompanies?: Record<string, string[]> } | undefined)
        ?.sectorCompanies) ?? {};

      const [resume] = await ctx.tx.select().from(candidateResumes)
        .where(eq(candidateResumes.candidateId, v)).limit(1);
      const skills = await ctx.tx.select({ skill: candidateSkills.skill })
        .from(candidateSkills).where(eq(candidateSkills.candidateId, v));

      const r = readSector({
        currentCompany: c.currentCompany,
        currentTitle: c.currentTitle,
        summary: resume?.summary ?? null,
        history: (resume?.experience ?? [])
          .map((e) => `${e.title ?? ''} ${e.company ?? ''} ${(e.bullets ?? []).join(' ')}`)
          .join(' '),
        skills: skills.map((s) => s.skill),
      }, table);

      await ctx.tx.update(candidates).set({
        sector: r.sector, sectorSource: r.source, updatedAt: ctx.now,
      }).where(eq(candidates.id, v));

      await audit(ctx, {
        action: 'update',
        summary: `re-read ${c.name}’s sector from the CV — ${r.sector}`,
        entityType: 'candidate', entityId: v, entityLabel: c.name,
        before: { sector: c.sector, source: c.sectorSource },
        after: { sector: r.sector, source: r.source, why: r.why },
      }, ctx.tx);

      return {
        toast: `Sector read from the CV — ${r.sector}${r.why ? ` (${r.why})` : ''}`,
        icon: 'spark',
        ms: 4200,
      };
    },
  },
});
