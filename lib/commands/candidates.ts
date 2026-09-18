import 'server-only';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  candidates, candidateSkills, candidateResumes, applications, jobs, talentPools,
  talentPoolMembers, hashtags,
} from '@/db/schema';
import { defineMany, CommandError } from './registry';
import { num, str, yes } from './fields';
import { requireJob, requireApplication } from '@/lib/authz';
import { audit, emit } from '@/lib/audit';
import { rows as rowsOf } from '@/lib/queries/sql';
import {
  createCandidate, apply, claim, release, findDuplicate, emailKey, phoneKey,
} from '@/lib/services/candidates';
import { recomputeFit } from '@/lib/services/fit';
import { readClaimDays } from '@/lib/domain/claim';
import { remove as removeFile, signedUrlFor, logAccess } from '@/lib/services/files';
import { attachStaged } from '@/lib/services/cv';

/* ─────────────────────────────────────────────────────────────────────────────
   Candidates: adding one, editing one, putting a name on one, putting them
   into a pipeline, and the pools and tags that hold the rest.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const listOf = (f: Record<string, unknown>, k: string): string[] => {
  const raw = f[k];
  if (Array.isArray(raw)) return raw.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
};

const PERSON = z.object({
  name: z.string().trim().min(2, 'A name, please'),
  email: z.string().trim().email('A valid e-mail address, please').optional().or(z.literal('')),
  phone: z.string().trim().optional(),
}).refine((x) => x.email || x.phone, {
  message: 'An e-mail or a phone number — something to reach them on',
  path: ['email'],
});

function readPerson(f: Record<string, unknown>) {
  const parsed = PERSON.safeParse({
    name: str(f, 'name'),
    email: str(f, 'email'),
    phone: str(f, 'phone'),
  });
  if (!parsed.success) throw new CommandError(parsed.error.issues[0].message);
  return parsed.data;
}

defineMany({
  'cand.create': {
    capability: 'candidate.create',
    schema: base,
    async run({ v, fields }, ctx) {
      const person = readPerson(fields);
      const r = await createCandidate({
        name: person.name,
        email: person.email || null,
        phone: person.phone || null,
        locationCity: str(fields, 'locationCity') || null,
        nationality: str(fields, 'nationality') || null,
        headline: str(fields, 'headline') || null,
        currentTitle: str(fields, 'currentTitle') || null,
        currentCompany: str(fields, 'currentCompany') || null,
        yearsExperience: num(fields, 'yearsExperience'),
        noticeDays: num(fields, 'noticeDays'),
        expectedSalary: num(fields, 'expectedSalary'),
        currentSalary: num(fields, 'currentSalary'),
        currentSalarySource: num(fields, 'currentSalary') != null ? 'recruiter' : null,
        linkedin: str(fields, 'linkedin') || null,
        skills: listOf(fields, 'skills'),
        hashtags: listOf(fields, 'hashtags'),
      }, ctx, { allowDuplicate: yes(fields, 'allowDuplicate') });

      /* A résumé attached while the form was being filled in. It is already
         stored and scanned; this is where it stops being a staged file and
         becomes theirs — read, kept against them, and owned by their record so
         the access rules that govern a CV start applying to it. */
      const resumeFileId = str(fields, 'resumeFileId');
      if (resumeFileId) await attachStaged(resumeFileId, r.id, ctx);

      /* The sheet can carry a requisition, which is the common case: somebody
         is added because there is a seat to put them on. */
      const jobId = str(fields, 'jobId') || v;
      if (jobId) {
        await requireJob(ctx.viewer, jobId, ctx.tx);
        const a = await apply({
          candidateId: r.id,
          jobId,
          source: str(fields, 'source') || 'Added by the recruiter',
          sourcerId: str(fields, 'source').startsWith('Sourced') ? (ctx.viewer.staffId ?? null) : null,
        }, ctx);
        await recomputeFit({ applicationId: a.applicationId }, ctx.tx);
        return {
          toast: `${a.candidateName} added to ${a.jobTitle} at ${a.stageName}`,
          icon: 'uplus',
          closeSheet: true,
          openSheet: { act: 'drawer.open', v: a.applicationId },
          data: { candidateId: r.id, applicationId: a.applicationId },
        };
      }

      return {
        toast: `${person.name} added`,
        icon: 'uplus',
        closeSheet: true,
        openSheet: { act: 'drawer.cand', v: r.id },
        data: { candidateId: r.id },
      };
    },
  },

  'cand.save': {
    capability: 'candidate.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const [before] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!before) throw new CommandError('That candidate no longer exists');
      const person = readPerson(fields);

      /* An edit can create a duplicate as easily as a create can. */
      const dup = await findDuplicate(
        { email: person.email, phone: person.phone, exceptId: v }, ctx.tx,
      );
      if (dup && !yes(fields, 'allowDuplicate')) {
        throw new CommandError(
          `${dup.name} already has that ${dup.matchedOn}`, { code: 'duplicate', tone: 'warn' },
        );
      }

      const salary = num(fields, 'currentSalary');
      await ctx.tx.update(candidates).set({
        name: person.name,
        email: person.email || null,
        emailKey: emailKey(person.email),
        phone: person.phone || null,
        phoneKey: phoneKey(person.phone),
        locationCity: str(fields, 'locationCity') || null,
        nationality: str(fields, 'nationality') || null,
        headline: str(fields, 'headline') || null,
        currentTitle: str(fields, 'currentTitle') || null,
        currentCompany: str(fields, 'currentCompany') || null,
        yearsExperience: num(fields, 'yearsExperience'),
        noticeDays: num(fields, 'noticeDays'),
        expectedSalary: num(fields, 'expectedSalary'),
        currentSalary: salary,
        currentSalarySource: salary != null && salary !== before.currentSalary
          ? 'recruiter' : before.currentSalarySource,
        currentSalaryAt: salary != null && salary !== before.currentSalary
          ? ctx.now : before.currentSalaryAt,
        linkedin: str(fields, 'linkedin') || null,
        updatedAt: ctx.now,
        version: before.version + 1,
      }).where(and(eq(candidates.id, v), eq(candidates.version, before.version)));

      await audit(ctx, {
        action: 'update',
        summary: `edited ${person.name}'s details`,
        entityType: 'candidate', entityId: v, entityLabel: person.name,
        before: { name: before.name, email: before.email, phone: before.phone, currentSalary: before.currentSalary },
        after: { name: person.name, email: person.email, phone: person.phone, currentSalary: salary },
      }, ctx.tx);
      await emit(ctx, {
        type: 'candidate.updated', subjectType: 'candidate', subjectId: v, payload: {},
      }, ctx.tx);

      return { toast: `${person.name} saved`, icon: 'check', closeSheet: true };
    },
  },

  /* ── Putting somebody into a pipeline ─────────────────────────────────── */
  'cand.addToJob': {
    capability: 'application.create',
    schema: base,
    async run({ v, fields }, ctx) {
      const jobId = str(fields, 'jobId');
      if (!jobId) throw new CommandError('Pick a requisition');
      await requireJob(ctx.viewer, jobId, ctx.tx);
      const source = str(fields, 'source') || 'Added by the recruiter';
      const a = await apply({
        candidateId: v,
        jobId,
        source,
        sourcerId: source.startsWith('Sourced') ? (ctx.viewer.staffId ?? null) : null,
      }, ctx);
      await recomputeFit({ applicationId: a.applicationId }, ctx.tx);
      return {
        toast: `${a.candidateName} added to ${a.jobTitle}`,
        icon: 'uplus',
        closeSheet: true,
        openSheet: { act: 'drawer.open', v: a.applicationId },
      };
    },
  },

  /* ── The recruiter tag ────────────────────────────────────────────────── */
  /* The sheet sends the note, how long the tag should last, and — when the
     recruiter has read the warning and means it — that they are going over
     somebody else's. `cand.claimSave` is the sheet's own name for it. */
  'cand.claimSave': {
    capability: 'candidate.claim',
    schema: base,
    async run({ v, fields }, ctx) {
      const r = await claim(
        v, str(fields, 'note') || null, ctx,
        readClaimDays(fields.days), yes(fields, 'takeover'),
      );
      return {
        toast: r.tookOverFrom
          ? `${r.name} is tagged to you — ${r.tookOverFrom.split(/\s+/)[0]} has been told`
          : `Your name is on ${r.name} for ${r.days} days`,
        icon: 'pin',
        closeSheet: true,
      };
    },
  },

  'cand.release': {
    capability: 'candidate.claim',
    schema: base,
    async run({ v }, ctx) {
      const r = await release(v, ctx);
      return { toast: `${r.name} is open to the desk again`, icon: 'check' };
    },
  },

  /* ── Tags and pools ───────────────────────────────────────────────────── */
  'tag.save': {
    capability: 'candidate.tag',
    schema: base,
    async run({ v, fields }, ctx) {
      const [cand] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!cand) throw new CommandError('That candidate no longer exists');
      const tags = listOf(fields, 'hashtags').map((t) => (t.startsWith('#') ? t : `#${t}`));
      await ctx.tx.update(candidates)
        .set({ hashtags: tags, updatedAt: ctx.now })
        .where(eq(candidates.id, v));

      /* A tag nobody has used before joins the list, so the next person can
         pick it rather than invent a near-miss. */
      for (const tag of tags) {
        await ctx.tx.insert(hashtags)
          .values({ tag, sortOrder: 999 })
          .onConflictDoNothing({ target: hashtags.tag });
      }

      await audit(ctx, {
        action: 'update',
        summary: `tagged ${cand.name} — ${tags.join(' ') || 'no tags'}`,
        entityType: 'candidate', entityId: v, entityLabel: cand.name,
        before: { hashtags: cand.hashtags }, after: { hashtags: tags },
      }, ctx.tx);
      return { toast: 'Tags saved', icon: 'check', closeSheet: true };
    },
  },

  'pool.create': {
    capability: 'candidate.pool',
    schema: base,
    async run({ fields }, ctx) {
      const name = str(fields, 'name');
      if (!name) throw new CommandError('A name for the pool, please');
      const id = `pool_${crypto.randomUUID().slice(0, 12)}`;
      const [{ n }] = rowsOf(await ctx.tx.execute(sql`
        SELECT count(*)::int AS n FROM ${talentPools}`)) as Array<{ n: number }>;
      await ctx.tx.insert(talentPools).values({
        id,
        name,
        /* A pool built by hand carries no filter: it is the people somebody put
           in it, not a saved search that changes underneath them. */
        filter: {},
        ownerId: ctx.viewer.staffId ?? null,
        sortOrder: Number(n),
        createdAt: ctx.now,
      });
      await audit(ctx, {
        action: 'create',
        summary: `created the ${name} talent pool`,
        entityType: 'pool', entityId: id, entityLabel: name,
      }, ctx.tx);
      return { toast: `${name} created`, icon: 'users', closeSheet: true, data: { poolId: id } };
    },
  },

  'pool.add': {
    capability: 'candidate.pool',
    schema: base,
    async run({ v, fields }, ctx) {
      const poolId = str(fields, 'poolId');
      if (!poolId) throw new CommandError('Pick a pool');
      const [pool] = await ctx.tx.select().from(talentPools)
        .where(eq(talentPools.id, poolId)).limit(1);
      const [cand] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!pool || !cand) throw new CommandError('That pool or candidate no longer exists');

      await ctx.tx.insert(talentPoolMembers)
        .values({ poolId, candidateId: v, addedAt: ctx.now, addedBy: ctx.viewer.staffId ?? null })
        .onConflictDoNothing({ target: [talentPoolMembers.poolId, talentPoolMembers.candidateId] });

      await audit(ctx, {
        action: 'update',
        summary: `added ${cand.name} to ${pool.name}`,
        entityType: 'pool', entityId: poolId, entityLabel: pool.name,
        after: { candidateId: v },
      }, ctx.tx);
      return { toast: `${cand.name} added to ${pool.name}`, icon: 'users', closeSheet: true };
    },
  },

  'pool.remove': {
    capability: 'candidate.pool',
    schema: base,
    async run({ v, fields }, ctx) {
      const poolId = str(fields, 'poolId');
      await ctx.tx.delete(talentPoolMembers).where(and(
        eq(talentPoolMembers.poolId, poolId),
        eq(talentPoolMembers.candidateId, v),
      ));
      await audit(ctx, {
        action: 'update',
        summary: 'removed a candidate from a pool',
        entityType: 'pool', entityId: poolId,
        before: { candidateId: v },
      }, ctx.tx);
      return { toast: 'Removed from the pool', icon: 'check' };
    },
  },

  /* ── The picture ──────────────────────────────────────────────────────── */
  /* A photograph taken out of a CV is the candidate's, and a recruiter who
     thinks it should not be on the screen can take it off. The file itself goes
     with it — leaving the image behind and only hiding it would be the sort of
     deletion that is not one. */
  'photo.remove': {
    capability: 'candidate.edit',
    schema: base,
    async run({ v }, ctx) {
      const [c] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!c) throw new CommandError('That candidate no longer exists');
      if (!c.photo && !c.photoFileId) {
        throw new CommandError('There is no photograph to remove', { tone: 'warn' });
      }

      if (c.photoFileId) {
        await removeFile({ fileId: c.photoFileId, reason: 'the photograph was removed' }, ctx);
      }
      await ctx.tx.update(candidates)
        .set({ photo: null, photoFileId: null, photoAt: null, updatedAt: ctx.now })
        .where(eq(candidates.id, v));

      await audit(ctx, {
        action: 'delete',
        summary: `removed ${c.name}’s photograph`,
        entityType: 'candidate', entityId: v, entityLabel: c.name,
        before: { photo: c.photo, fileId: c.photoFileId },
      }, ctx.tx);
      return { toast: 'Photograph removed — the monogram is shown instead', icon: 'trash' };
    },
  },

  /* ── The CV ───────────────────────────────────────────────────────────── */
  /* Hands back a short-lived signed link to the file that was uploaded. When
     there is no file — an older record, or one typed in by hand — it hands back
     the reading instead, and says which it gave, because a button that opens a
     blank document is worse than one that says there is nothing to open. */
  'resume.download': {
    capability: 'candidate.view',
    schema: base,
    async run({ v }, ctx) {
      const [c] = await ctx.tx.select().from(candidates).where(eq(candidates.id, v)).limit(1);
      if (!c) throw new CommandError('That candidate no longer exists');

      const [r] = await ctx.tx.select().from(candidateResumes)
        .where(eq(candidateResumes.candidateId, v))
        .orderBy(sql`${candidateResumes.isCurrent} DESC, ${candidateResumes.uploadedAt} DESC NULLS LAST`)
        .limit(1);

      if (r?.fileId) {
        const link = await signedUrlFor(r.fileId, ctx.viewer, ctx.tx);
        if ('ok' in link) {
          /* `readable` refused it — the viewer, the scan state or the file
             itself. The reason it gives is the reason the interface shows. */
          const no = link as { ok: false; why: string; message: string };
          throw new CommandError(
            no.why === 'forbidden'
              ? 'That CV is not yours to read'
              : `That CV could not be read back: ${no.message}`,
          );
        }
        await logAccess({ fileId: r.fileId, action: 'download' }, ctx);
        await audit(ctx, {
          action: 'read',
          summary: `downloaded ${c.name}’s CV`,
          entityType: 'candidate', entityId: v, entityLabel: c.name,
          after: { fileId: r.fileId },
        }, ctx.tx);
        return {
          refresh: false,
          download: { url: link.url, name: link.name || (r.fileName ?? `${c.name}-CV`) },
          toast: 'Downloading',
          icon: 'dl',
        };
      }

      if (!r?.rawText && !r?.summary) {
        throw new CommandError(
          `There is no CV on file for ${c.name} — nothing was uploaded, and the details were `
          + 'typed in',
          { tone: 'warn' },
        );
      }

      /* The reading, as text. Not the document they sent, and it says so. */
      const text = [
        c.name, c.headline ?? '', '',
        r.summary ?? '', '',
        'EXPERIENCE',
        ...(r.experience ?? []).flatMap((e) => [
          `${e.title ?? ''} — ${e.company ?? ''} (${e.from ?? ''}–${e.to ?? ''})`,
          ...(e.bullets ?? []).map((b) => `  · ${b}`), '',
        ]),
        'EDUCATION',
        ...(r.education ?? []).map((e) => `${e.degree ?? ''}, ${e.school ?? ''}, ${e.year ?? ''}`),
        '', 'LANGUAGES',
        ...(r.languages ?? []).map((l) => `${l.name} — ${l.level}`),
      ].join('\n');

      await audit(ctx, {
        action: 'read',
        summary: `took ${c.name}’s parsed CV as text — no original file is on record`,
        entityType: 'candidate', entityId: v, entityLabel: c.name,
      }, ctx.tx);
      return {
        refresh: false,
        download: { text, name: `${c.name.replace(/\s+/g, '-')}-CV.txt` },
        toast: 'No original document is on file — this is what was read from it',
        tone: 'warn' as const,
        icon: 'file',
        ms: 4600,
      };
    },
  },
});
