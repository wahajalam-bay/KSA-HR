import 'server-only';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  jobs, jobStages, jobSkills, jobHiringManagers, jobQuestions, questionBank, positions,
  departments, locations, staff, applications, stages,
} from '@/db/schema';
import type { Exec } from '@/db/client';
import { defineMany, CommandError, type CommandContext } from './registry';
import { carries, lines, list, num, str, yes } from './fields';
import { requireJob } from '@/lib/authz';
import { audit, emit } from '@/lib/audit';
import { rows as rowsOf } from '@/lib/queries/sql';
import {
  submitRequisition, decideRequisition, archiveRequisition, reopenRequisition, applyPipeline,
} from '@/lib/services/requisitions';
import { nextCode } from '@/lib/services/manpower';
import { publishToLinkedIn } from '@/lib/services/publishing';

/* ─────────────────────────────────────────────────────────────────────────────
   The requisition: opening one, editing it, walking it through approval,
   closing it and bringing it back.

   The state machine itself lives in lib/services/requisitions.ts — these are
   the doors into it, each checking the capability and the scope before it
   turns the handle.
   ───────────────────────────────────────────────────────────────────────────*/

const base = z.object({ v: z.string().default(''), fields: z.record(z.any()).default({}) });

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;

/* The careers-site path. Two requisitions with the same title get the same
   stem and are told apart by the reference the database already guarantees. */
const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** The fields the requisition form writes, validated once for create and edit. */
const FORM = z.object({
  title: z.string().trim().min(3, 'A requisition needs a title'),
  deptId: z.string().trim().min(1, 'Pick a department'),
  locationId: z.string().trim().min(1, 'Pick a location'),
  /* Blank on the new-requisition sheet, where the family is the department's
     function and is filled in from it rather than asked for twice. */
  family: z.string().trim().default(''),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern']).default('full_time'),
  priority: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
  openings: z.number().int().min(1, 'At least one opening').max(50),
  salaryMin: z.number().int().min(0),
  salaryMax: z.number().int().min(0),
  pipelineId: z.string().trim().min(1, 'Pick a pipeline template'),
  recruiterId: z.string().trim().optional(),
  sourcerId: z.string().trim().optional(),
  coordinatorId: z.string().trim().optional(),
  hiringManager: z.string().trim().optional(),
  positionCode: z.string().trim().optional(),
  budgeted: z.boolean().default(true),
  budgetNote: z.string().trim().optional(),
  remoteOk: z.boolean().default(false),
  targetStartOn: z.string().trim().optional(),
}).refine((x) => x.salaryMax >= x.salaryMin, {
  message: 'The top of the band cannot be under the bottom',
  path: ['salaryMax'],
});

function readForm(f: Record<string, unknown>) {
  const parsed = FORM.safeParse({
    title: str(f, 'title'),
    deptId: str(f, 'deptId'),
    locationId: str(f, 'locationId'),
    family: str(f, 'family'),
    employmentType: (str(f, 'employmentType') || 'full_time') as 'full_time',
    priority: (str(f, 'priority') || 'normal') as 'normal',
    openings: num(f, 'openings') ?? 1,
    salaryMin: num(f, 'salaryMin') ?? 0,
    salaryMax: num(f, 'salaryMax') ?? 0,
    pipelineId: str(f, 'pipelineId'),
    recruiterId: str(f, 'recruiterId') || undefined,
    sourcerId: str(f, 'sourcerId') || undefined,
    coordinatorId: str(f, 'coordinatorId') || undefined,
    hiringManager: str(f, 'hiringManager') || undefined,
    positionCode: str(f, 'positionCode') || undefined,
    budgeted: str(f, 'budgeted') !== '0' && str(f, 'budgeted') !== 'false',
    budgetNote: str(f, 'budgetNote') || undefined,
    remoteOk: str(f, 'remoteOk') === '1' || str(f, 'remoteOk') === 'true',
    targetStartOn: str(f, 'targetStartOn') || undefined,
  });
  if (!parsed.success) {
    throw new CommandError(parsed.error.issues[0]?.message ?? 'That form is not complete');
  }
  return parsed.data;
}

/** The family is the department's function; the form does not ask twice. */
async function familyOf(deptId: string, ctx: { tx: Exec }): Promise<string> {
  const [row] = rowsOf(await ctx.tx.execute(sql`
    SELECT COALESCE(f.name, d.name) AS family
      FROM ${departments} d LEFT JOIN functions f ON f.id = d.function_id
     WHERE d.id = ${deptId}`)) as Array<{ family: string }>;
  if (!row) throw new CommandError('Pick the department this role sits in');
  return row.family;
}

/* ─────────────────────────────────────────────────────────────────────────────
   THE BLOCKS ON THE REQUISITION FORM

   The requisition sheet is not a flat list of columns: how the position gets
   filled, which stages the loop runs, what the bar is and which questions the
   careers form asks are each a block of their own, shared between the new sheet
   and the editor (lib/sheets/blocks.tsx). They are read back here, once, so the
   two doors write exactly the same thing.
   ───────────────────────────────────────────────────────────────────────────*/

const PICKABLE = ['screen', 'assessment', 'iv1', 'iv2', 'pitch', 'ivf'] as const;
const IV_KEYS = ['iv1', 'iv2', 'ivf'];
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
const isOrdinal = (n: string) => /^\s*(1st|2nd|3rd|4th|5th)\s+Interview\s*$/i.test(n);

/** How the position gets filled. A requisition nobody is filling is not one. */
function readSourcing(f: Record<string, unknown>) {
  const internal = yes(f, 'src_internal');
  const hunt = yes(f, 'src_hunt');
  const linkedin = yes(f, 'src_linkedin');
  if (!internal && !hunt && !linkedin) {
    throw new CommandError(
      'Say how this position gets filled — internally, by hunting, or on the LinkedIn company page',
    );
  }
  return { internal, hunt, linkedin, note: str(f, 'srcNote') || null };
}

/** The skill bar, read off the sk_name_N / sk_lvl_N / sk_must_N triples. */
function readBar(f: Record<string, unknown>) {
  const out: Array<{ skill: string; level: number; must: boolean }> = [];
  const seen = new Set<string>();
  for (const key of Object.keys(f)) {
    if (!key.startsWith('sk_name_')) continue;
    const i = key.slice('sk_name_'.length);
    const skill = str(f, key);
    if (!skill || seen.has(skill.toLowerCase())) continue;
    seen.add(skill.toLowerCase());
    out.push({
      skill,
      level: Math.max(1, Math.min(5, num(f, `sk_lvl_${i}`) ?? 3)),
      must: yes(f, `sk_must_${i}`),
    });
  }
  return out;
}

/** The loop this requisition runs. The four fixed stages are never asked
    about — they are on every requisition there is — and the interview rounds
    are renumbered by where they actually fall unless somebody named them. */
async function readWorkflow(f: Record<string, unknown>, ctx: { tx: Exec }) {
  const spine = await ctx.tx.select().from(stages).orderBy(sql`ordinal`);
  let n = 0;
  const picked = new Map<string, { name: string; sla: number }>();
  for (const key of PICKABLE) {
    if (!yes(f, `wf_on_${key}`)) continue;
    const st = spine.find((s) => s.key === key);
    let name = str(f, `wf_name_${key}`) || st?.name || key;
    if (IV_KEYS.includes(key)) {
      n += 1;
      if (isOrdinal(name)) name = `${ORD[n - 1] ?? `${n}th`} Interview`;
    }
    picked.set(key, {
      name,
      sla: Math.max(1, Math.min(60, num(f, `wf_sla_${key}`) ?? st?.defaultSla ?? 3)),
    });
  }
  if (!picked.size) {
    throw new CommandError(
      'An interview workflow needs at least one stage between applying and the offer',
    );
  }
  return spine
    .filter((s) => s.fixed || picked.has(s.key))
    .map((s) => ({
      stageKey: s.key,
      name: picked.get(s.key)?.name ?? s.name,
      sla: picked.get(s.key)?.sla ?? s.defaultSla,
      ordinal: s.ordinal,
    }));
}

/** Everything on the requisition form that is not a column on `jobs`. */
async function applyBlocks(
  jobId: string, f: Record<string, unknown>, ctx: CommandContext,
  o: { lead?: string | null } = {},
): Promise<void> {
  /* ── The rest of the hiring team ───────────────────────────────────── */
  if ('hiringManagersExtra' in f) {
    const lead = o.lead ?? null;
    const extra = lines(f, 'hiringManagersExtra').map((line) => {
      const [name, title] = line.split(/\s+[—–-]\s+/);
      return { name: (name ?? '').trim(), title: (title ?? '').trim() || null };
    }).filter((h) => h.name && h.name !== lead);

    await ctx.tx.delete(jobHiringManagers)
      .where(and(eq(jobHiringManagers.jobId, jobId), eq(jobHiringManagers.isLead, false)));
    let i = 1;
    for (const h of extra) {
      await ctx.tx.insert(jobHiringManagers).values({
        jobId, name: h.name, title: h.title, email: hmEmail(h.name), isLead: false, sortOrder: i++,
      });
    }
  }

  /* ── How it gets filled ────────────────────────────────────────────── */
  if (carries(f, 'src_')) {
    const s = readSourcing(f);
    await ctx.tx.update(jobs).set({
      sourcingInternal: s.internal, sourcingHunt: s.hunt, sourcingLinkedin: s.linkedin,
      sourcingNote: s.note,
    }).where(eq(jobs.id, jobId));
  }

  /* ── The loop ──────────────────────────────────────────────────────── */
  if (carries(f, 'wf_on_')) {
    const rows = await readWorkflow(f, ctx);
    const keep = new Set(rows.map((r) => r.stageKey));

    /* A stage somebody is standing on cannot be switched off underneath
       them — the candidate would be on a stage this requisition no longer
       runs, and no board would know where to draw them. */
    const stuck = rowsOf(await ctx.tx.execute(sql`
      SELECT stage::text AS stage, count(*)::int AS n FROM ${applications}
       WHERE job_id = ${jobId} AND status IN ('active','on_hold')
       GROUP BY stage`)) as Array<{ stage: string; n: number }>;
    const blocked = stuck.filter((r) => !keep.has(r.stage as 'applied'));
    if (blocked.length) {
      throw new CommandError(
        `${blocked.map((b) => `${b.n} candidate${Number(b.n) === 1 ? ' is' : 's are'} on ${b.stage}`)
          .join(', ')} — move them on before switching that stage off`,
      );
    }

    await ctx.tx.delete(jobStages).where(eq(jobStages.jobId, jobId));
    for (const r of rows) await ctx.tx.insert(jobStages).values({ jobId, ...r });

    /* The sales pitch stage carries its own configuration. */
    const pitchOn = keep.has('pitch');
    const projectId = str(f, 'pitchProjectId') || null;
    if (pitchOn && !projectId) {
      throw new CommandError('Pick the project the candidate will pitch, or switch the stage off');
    }
    await ctx.tx.update(jobs).set({
      pitchOn,
      pitchProjectId: pitchOn ? projectId : null,
      pitchChannels: (str(f, 'pitchChannels') || 'whatsapp,email').split(',').map((x) => x.trim()).filter(Boolean),
      pitchLeadHours: num(f, 'pitchLeadHours') ?? 24,
      pitchNote: str(f, 'pitchNote') || null,
    }).where(eq(jobs.id, jobId));
  }

  /* ── The bar ───────────────────────────────────────────────────────── */
  if (carries(f, 'sk_name_')) {
    const bar = readBar(f);
    if (!bar.length) {
      throw new CommandError(
        'Name at least one skill this position needs — it is what every applicant is measured against',
      );
    }
    await ctx.tx.delete(jobSkills).where(eq(jobSkills.jobId, jobId));
    let i = 0;
    for (const r of bar) {
      await ctx.tx.insert(jobSkills).values({
        jobId, skill: r.skill, level: r.level, must: r.must, sortOrder: i++,
      });
    }
  }

  /* ── The job description ───────────────────────────────────────────── */
  if ('desc_summary' in f || 'desc_responsibilities' in f) {
    await ctx.tx.update(jobs).set({
      descSummary: str(f, 'desc_summary') || null,
      descResponsibilities: lines(f, 'desc_responsibilities'),
      descRequirements: lines(f, 'desc_requirements'),
      descBenefits: lines(f, 'desc_benefits'),
      descUpdatedAt: ctx.now,
    }).where(eq(jobs.id, jobId));
  }

  /* ── The careers form ──────────────────────────────────────────────── */
  if ('qids' in f || 'ownq' in f) {
    const picked = list(f, 'qids');
    const keepOwn = new Set(list(f, 'ownq'));

    /* A question written for this requisition is kept unless it was untick-
       ed; the bank ones are exactly what is ticked now. Answers already
       given are on the applications that gave them and are never touched. */
    const existing = await ctx.tx.select().from(jobQuestions)
      .where(eq(jobQuestions.jobId, jobId)).orderBy(jobQuestions.ordinal);
    const own = existing.filter((q) => !q.bankId && ('ownq' in f ? keepOwn.has(q.id) : true));

    await ctx.tx.delete(jobQuestions).where(eq(jobQuestions.jobId, jobId));
    let ordinal = 0;
    for (const qid of picked) {
      const [q] = await ctx.tx.select().from(questionBank)
        .where(eq(questionBank.id, qid)).limit(1);
      if (!q) continue;
      await ctx.tx.insert(jobQuestions).values({
        jobId, bankId: q.id, text: q.text, type: q.type, options: q.options,
        required: q.required, knockout: q.knockout, ordinal: ordinal++,
      });
    }
    for (const q of own) {
      await ctx.tx.insert(jobQuestions).values({
        jobId, bankId: null, text: q.text, type: q.type, options: q.options,
        required: q.required, knockout: q.knockout, ordinal: ordinal++,
      });
    }
  }
}

/* Whatever a hiring manager's address is, it is derived the same way every
   time, so the same person is the same account wherever they are named. */
const hmEmail = (n: string) =>
  `${n.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).join('.')}@bayut.sa`;

defineMany({
  /* ── Opening one ──────────────────────────────────────────────────────── */
  'job.create': {
    capability: 'job.create',
    schema: base,
    async run({ v, fields }, ctx) {
      const form = readForm(fields);
      const family = form.family || await familyOf(form.deptId, ctx);

      /* An unbudgeted requisition needs a written justification, because that
         is what Finance and the GM read on the approval. */
      if (!form.budgeted && !form.budgetNote) {
        throw new CommandError('A requisition outside the plan needs a justification');
      }

      const jobId = id('job');
      const [{ n }] = rowsOf(await ctx.tx.execute(sql`
        SELECT count(*)::int AS n FROM ${jobs}`)) as Array<{ n: number }>;

      await ctx.tx.insert(jobs).values({
        id: jobId,
        reference: `REQ-${new Date(ctx.now).getUTCFullYear()}-${String(Number(n) + 1).padStart(4, '0')}`,
        slug: slugify(form.title),
        title: form.title,
        deptId: form.deptId,
        locationId: form.locationId!,
        family,
        employmentType: form.employmentType,
        priority: form.priority,
        status: 'draft',
        openings: form.openings,
        filled: 0,
        salaryMin: form.salaryMin,
        salaryMax: form.salaryMax,
        pipelineId: form.pipelineId,
        recruiterId: form.recruiterId ?? null,
        sourcerId: form.sourcerId ?? null,
        coordinatorId: form.coordinatorId ?? null,
        hiringManager: form.hiringManager ?? null,
        positionCode: form.positionCode ?? null,
        budgeted: form.budgeted,
        budgetNote: form.budgetNote ?? null,
        remoteOk: form.remoteOk,
        targetStartOn: form.targetStartOn || undefined,
        createdAt: ctx.now,
        createdBy: ctx.viewer.staffId ?? null,
        updatedAt: ctx.now,
        updatedBy: ctx.viewer.staffId ?? null,
      });

      await applyPipeline(jobId, form.pipelineId, ctx);

      if (form.hiringManager) {
        await ctx.tx.insert(jobHiringManagers).values({
          jobId, name: form.hiringManager, isLead: true, sortOrder: 0,
        });
      }

      /* The standard questions attach themselves when the form did not pick
         any; when it did, the picks are the whole answer. */
      if (!('qids' in fields)) {
        const standard = await ctx.tx.select().from(questionBank)
          .where(and(eq(questionBank.isStandard, true), sql`archived_at IS NULL`))
          .orderBy(questionBank.sortOrder);
        let ordinal = 0;
        for (const q of standard) {
          await ctx.tx.insert(jobQuestions).values({
            jobId, bankId: q.id, text: q.text, type: q.type, options: q.options,
            required: q.required, knockout: q.knockout, ordinal: ordinal++,
          });
        }
      }

      /* Everything the form carried that is not a column: the rest of the
         hiring team, how it gets filled, the loop, the bar, the description
         and the careers form. */
      await applyBlocks(jobId, fields, ctx, { lead: form.hiringManager ?? null });

      /* An unplanned seat is requested, never approved: it becomes headcount
         when the requisition it belongs to is approved, and not before. */
      if (!form.positionCode) {
        const code = await nextCode(form.deptId, ctx.tx);
        await ctx.tx.insert(positions).values({
          code,
          deptId: form.deptId,
          title: form.title,
          locationId: form.locationId ?? null,
          /* Requested, not approved: an unplanned seat is not headcount until
             the requisition that raised it clears its chain. */
          planState: 'pending',
          approved: 0,
          requested: form.openings,
          jobId,
        });
        await ctx.tx.update(jobs).set({ positionCode: code }).where(eq(jobs.id, jobId));
        await emit(ctx, {
          type: 'seat.requested', subjectType: 'position', subjectId: code,
          payload: { jobId, title: form.title },
        }, ctx.tx);
      }

      await audit(ctx, {
        action: 'create',
        summary: `opened a draft requisition — ${form.title}`,
        entityType: 'requisition', entityId: jobId, entityLabel: form.title,
        after: { status: 'draft', openings: form.openings, budgeted: form.budgeted },
      }, ctx.tx);
      await emit(ctx, {
        type: 'requisition.created', subjectType: 'requisition', subjectId: jobId,
        payload: { title: form.title, openings: form.openings },
      }, ctx.tx);

      /* "Save as draft" leaves it in the drawer; "Submit for approval" walks
         it straight into the chain, which is the same door req.submit uses. */
      if (v === 'submit') {
        const r = await submitRequisition(jobId, ctx);
        return {
          toast: r.openedImmediately
            ? `${r.title} approved and opened`
            : `${r.title} sent for approval — ${r.steps} step${r.steps === 1 ? '' : 's'}`,
          icon: r.openedImmediately ? 'check' : 'shield',
          closeSheet: true,
          go: `/jobs/${jobId}`,
          data: { jobId },
        };
      }

      return {
        toast: `${form.title} saved as a draft — submit it for approval when it is ready`,
        icon: 'pencil',
        closeSheet: true,
        go: `/jobs/${jobId}`,
        data: { jobId },
      };
    },
  },

  'job.save': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const [before] = await ctx.tx.select().from(jobs).where(eq(jobs.id, v)).limit(1);
      if (!before) throw new CommandError('That requisition no longer exists');
      const form = readForm(fields);
      const family = form.family || await familyOf(form.deptId, ctx);
      if (!form.budgeted && !form.budgetNote) {
        throw new CommandError('A requisition outside the plan needs a justification');
      }

      /* A pipeline change rewrites the loop, which is only safe while nobody
         is standing on a stage the new template does not have. */
      if (form.pipelineId !== before.pipelineId) {
        const [{ n }] = rowsOf(await ctx.tx.execute(sql`
          SELECT count(*)::int AS n FROM ${applications}
           WHERE job_id = ${v} AND status IN ('active', 'on_hold')`)) as Array<{ n: number }>;
        if (Number(n)) {
          throw new CommandError(
            `${n} candidate${Number(n) === 1 ? ' is' : 's are'} in this pipeline — the template cannot change under them`,
          );
        }
        await applyPipeline(v, form.pipelineId, ctx);
      }

      await ctx.tx.update(jobs).set({
        title: form.title,
        deptId: form.deptId,
        locationId: form.locationId!,
        family,
        employmentType: form.employmentType,
        priority: form.priority,
        openings: form.openings,
        salaryMin: form.salaryMin,
        salaryMax: form.salaryMax,
        pipelineId: form.pipelineId,
        recruiterId: form.recruiterId ?? null,
        sourcerId: form.sourcerId ?? null,
        coordinatorId: form.coordinatorId ?? null,
        hiringManager: form.hiringManager ?? null,
        budgeted: form.budgeted,
        budgetNote: form.budgetNote ?? null,
        remoteOk: form.remoteOk,
        targetStartOn: form.targetStartOn || undefined,
        updatedAt: ctx.now,
        updatedBy: ctx.viewer.staffId ?? null,
        version: before.version + 1,
      }).where(and(eq(jobs.id, v), eq(jobs.version, before.version)));

      /* The lead hiring manager moves with the form; the rest of the team, the
         routes, the loop, the bar, the description and the questions follow in
         applyBlocks — but only the blocks this particular sheet carried. */
      if (form.hiringManager && form.hiringManager !== before.hiringManager) {
        await ctx.tx.delete(jobHiringManagers)
          .where(and(eq(jobHiringManagers.jobId, v), eq(jobHiringManagers.isLead, true)));
        await ctx.tx.insert(jobHiringManagers).values({
          jobId: v, name: form.hiringManager, email: hmEmail(form.hiringManager),
          isLead: true, sortOrder: 0,
        });
      }
      await applyBlocks(v, fields, ctx, { lead: form.hiringManager ?? before.hiringManager });

      await audit(ctx, {
        action: 'update',
        summary: `edited ${form.title}`,
        entityType: 'requisition', entityId: v, entityLabel: form.title,
        before: {
          title: before.title, openings: before.openings, salaryMin: before.salaryMin,
          salaryMax: before.salaryMax, budgeted: before.budgeted,
        },
        after: {
          title: form.title, openings: form.openings, salaryMin: form.salaryMin,
          salaryMax: form.salaryMax, budgeted: form.budgeted,
        },
      }, ctx.tx);

      return { toast: `${form.title} saved`, icon: 'check', closeSheet: true };
    },
  },

  /* ── The approval chain ───────────────────────────────────────────────── */
  'job.submit': {
    capability: 'job.submit',
    schema: base,
    async run({ v }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const r = await submitRequisition(v, ctx);
      return {
        toast: r.openedImmediately
          ? `${r.title} approved and opened`
          : `${r.title} sent for approval — ${r.steps} step${r.steps === 1 ? '' : 's'}`,
        icon: r.openedImmediately ? 'check' : 'shield',
        closeSheet: true,
      };
    },
  },

  'job.approve': {
    capability: 'approval.act',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const r = await decideRequisition(v, 'approve', str(fields, 'reason') || null, ctx);
      return {
        toast: r.finished ? `${r.title} approved and opened` : `${r.label} approved`,
        icon: r.finished ? 'trophy' : 'check',
        closeSheet: true,
      };
    },
  },

  'job.reject': {
    capability: 'approval.act',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const reason = str(fields, 'reason');
      if (!reason) throw new CommandError('Say why it is going back — the requester needs to know');
      const r = await decideRequisition(v, 'reject', reason, ctx);
      return { toast: `${r.title} sent back to draft`, icon: 'arrL', tone: 'warn', closeSheet: true };
    },
  },

  /* ── Holding, closing, reopening ──────────────────────────────────────── */
  'job.hold': {
    capability: 'job.edit',
    schema: base,
    async run({ v }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, v)).limit(1);
      if (!job) throw new CommandError('That requisition no longer exists');
      if (!['open', 'on_hold'].includes(job.status)) {
        throw new CommandError('Only an open requisition can be put on hold', { tone: 'warn' });
      }
      const next = job.status === 'on_hold' ? 'open' : 'on_hold';
      await ctx.tx.update(jobs)
        .set({ status: next, updatedAt: ctx.now, updatedBy: ctx.viewer.staffId ?? null })
        .where(eq(jobs.id, v));
      await audit(ctx, {
        action: 'update',
        summary: next === 'on_hold' ? `put ${job.title} on hold` : `took ${job.title} off hold`,
        entityType: 'requisition', entityId: v, entityLabel: job.title,
        before: { status: job.status }, after: { status: next },
      }, ctx.tx);
      return {
        toast: next === 'on_hold' ? `${job.title} is on hold` : `${job.title} is open again`,
        icon: next === 'on_hold' ? 'clock' : 'check',
      };
    },
  },

  'job.archive': {
    capability: 'job.archive',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const r = await archiveRequisition(v, str(fields, 'reason') || null, ctx);
      return {
        toast: r.live
          ? `${r.title} archived — ${r.live} application${r.live === 1 ? '' : 's'} still open on it`
          : `${r.title} archived`,
        tone: r.live ? 'warn' : 'ok',
        icon: 'archive',
        closeSheet: true,
      };
    },
  },

  'job.reopen': {
    capability: 'job.archive',
    schema: base,
    async run({ v }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const r = await reopenRequisition(v, ctx);
      return { toast: `${r.title} is a draft again`, icon: 'undo' };
    },
  },

  /* ── The hiring team ──────────────────────────────────────────────────── */
  'hm.save': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const name = str(fields, 'hm_name');
      if (!name) throw new CommandError('A name, please');
      const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, v)).limit(1);
      if (!job) throw new CommandError('That requisition no longer exists');

      const [{ n }] = rowsOf(await ctx.tx.execute(sql`
        SELECT count(*)::int AS n FROM ${jobHiringManagers} WHERE job_id = ${v}`)) as Array<{ n: number }>;
      await ctx.tx.insert(jobHiringManagers).values({
        jobId: v,
        name,
        title: str(fields, 'hm_title') || null,
        email: str(fields, 'hm_email') || null,
        isLead: Number(n) === 0,
        sortOrder: Number(n),
      });
      if (Number(n) === 0) {
        await ctx.tx.update(jobs).set({ hiringManager: name, updatedAt: ctx.now }).where(eq(jobs.id, v));
      }

      await audit(ctx, {
        action: 'update',
        summary: `added ${name} as a hiring manager on ${job.title}`,
        entityType: 'requisition', entityId: v, entityLabel: job.title,
        after: { hiringManager: name },
      }, ctx.tx);
      return { toast: `${name} added to the hiring team`, icon: 'users', closeSheet: true };
    },
  },

  'hm.remove': {
    capability: 'job.edit',
    schema: base,
    async run({ v }, ctx) {
      const [row] = await ctx.tx.select().from(jobHiringManagers)
        .where(eq(jobHiringManagers.id, v)).limit(1);
      if (!row) throw new CommandError('That person is already off the requisition', { tone: 'warn' });
      await requireJob(ctx.viewer, row.jobId, ctx.tx);
      if (row.isLead) {
        throw new CommandError('The lead hiring manager cannot be removed — make somebody else lead first');
      }
      await ctx.tx.delete(jobHiringManagers).where(eq(jobHiringManagers.id, v));
      await audit(ctx, {
        action: 'update',
        summary: `removed ${row.name} from the hiring team`,
        entityType: 'requisition', entityId: row.jobId,
        before: { hiringManager: row.name },
      }, ctx.tx);
      return { toast: `${row.name} removed`, icon: 'x' };
    },
  },

  /* ── The job description ──────────────────────────────────────────────── */
  'jd.save': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, v)).limit(1);
      if (!job) throw new CommandError('That requisition no longer exists');
      const summary = str(fields, 'desc_summary');
      await ctx.tx.update(jobs).set({
        descSummary: summary || null,
        descResponsibilities: lines(fields, 'desc_responsibilities'),
        descRequirements: lines(fields, 'desc_requirements'),
        descBenefits: lines(fields, 'desc_benefits'),
        descUpdatedAt: ctx.now,
        updatedAt: ctx.now,
        updatedBy: ctx.viewer.staffId ?? null,
      }).where(eq(jobs.id, v));
      await audit(ctx, {
        action: 'update',
        summary: `rewrote the job description on ${job.title}`,
        entityType: 'requisition', entityId: v, entityLabel: job.title,
        before: { summary: job.descSummary },
        after: { summary },
      }, ctx.tx);
      return { toast: 'Job description saved', icon: 'check', closeSheet: true };
    },
  },

  /* ── The stage SLAs on this requisition ───────────────────────────────── */
  'job.sla': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const [jobId, stageKey] = v.split('|');
      if (!jobId || !stageKey) throw new CommandError('That change was not understood');
      await requireJob(ctx.viewer, jobId, ctx.tx);
      const days = num(fields, 'value') ?? num(fields, stageKey);
      if (days == null || days < 1 || days > 60) throw new CommandError('An SLA is between 1 and 60 days');
      const [before] = await ctx.tx.select().from(jobStages)
        .where(and(eq(jobStages.jobId, jobId), eq(jobStages.stageKey, stageKey as 'applied'))).limit(1);
      if (!before) throw new CommandError('That stage is not on this requisition');
      await ctx.tx.update(jobStages).set({ sla: days })
        .where(and(eq(jobStages.jobId, jobId), eq(jobStages.stageKey, stageKey as 'applied')));
      await audit(ctx, {
        action: 'update',
        summary: `set the ${before.name} SLA to ${days} day${days === 1 ? '' : 's'}`,
        entityType: 'requisition', entityId: jobId,
        before: { [stageKey]: before.sla }, after: { [stageKey]: days },
      }, ctx.tx);
      return { toast: `${before.name} SLA is now ${days} day${days === 1 ? '' : 's'}`, icon: 'clock' };
    },
  },

  /* ── The skills the JD asks for ───────────────────────────────────────── */
  'sk.save': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const names = list(fields, 'skills');
      await ctx.tx.delete(jobSkills).where(eq(jobSkills.jobId, v));
      let i = 0;
      for (const name of names) {
        await ctx.tx.insert(jobSkills).values({
          jobId: v, skill: name, must: true, sortOrder: i++,
        });
      }
      await audit(ctx, {
        action: 'update',
        summary: `set ${names.length} required skill${names.length === 1 ? '' : 's'}`,
        entityType: 'requisition', entityId: v,
        after: { skills: names },
      }, ctx.tx);
      return { toast: 'Skills saved', icon: 'check', closeSheet: true };
    },
  },

  /* ── A question asked on this requisition only ────────────────────────── */
  'jq.save': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const [jobId, which] = v.split('|');
      if (!jobId) throw new CommandError('That change was not understood');
      await requireJob(ctx.viewer, jobId, ctx.tx);
      const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!job) throw new CommandError('That requisition no longer exists');

      const text = str(fields, 'text');
      if (!text) throw new CommandError('Write the question');
      const type = str(fields, 'type') || 'yesno';
      if (!QUESTION_TYPES.includes(type)) throw new CommandError('That answer type is not one we ask for');
      const options = ['choice', 'multi'].includes(type) ? lines(fields, 'options') : null;
      if (options && options.length < 2) {
        throw new CommandError('A choice question needs at least two options');
      }
      const required = str(fields, 'required') !== '0';
      const knockout = str(fields, 'knockout') || null;

      const isNew = !which || which === 'new';
      if (isNew) {
        const [{ n }] = rowsOf(await ctx.tx.execute(sql`
          SELECT coalesce(max(ordinal), -1) + 1 AS n FROM ${jobQuestions}
           WHERE job_id = ${jobId}`)) as Array<{ n: number }>;
        await ctx.tx.insert(jobQuestions).values({
          jobId, bankId: null, text, type: type as 'yesno', options, required, knockout,
          ordinal: Number(n),
        });
      } else {
        const [q] = await ctx.tx.select().from(jobQuestions)
          .where(and(eq(jobQuestions.id, which), eq(jobQuestions.jobId, jobId))).limit(1);
        if (!q) throw new CommandError('That question is no longer on this requisition');
        await ctx.tx.update(jobQuestions)
          .set({ text, type: type as 'yesno', options, required, knockout })
          .where(eq(jobQuestions.id, which));
      }

      await audit(ctx, {
        action: 'update',
        summary: `${isNew ? 'added' : 'edited'} an application question on ${job.title}`,
        entityType: 'requisition', entityId: jobId, entityLabel: job.title,
        after: { question: text, type, required },
      }, ctx.tx);

      return {
        toast: isNew ? 'Question added to the careers form' : 'Question saved',
        icon: 'list', closeSheet: true,
      };
    },
  },

  'jq.remove': {
    capability: 'job.edit',
    schema: base,
    async run({ v }, ctx) {
      const [q] = await ctx.tx.select().from(jobQuestions).where(eq(jobQuestions.id, v)).limit(1);
      if (!q) throw new CommandError('That question is already off the form', { tone: 'warn' });
      await requireJob(ctx.viewer, q.jobId, ctx.tx);
      await ctx.tx.delete(jobQuestions).where(eq(jobQuestions.id, v));
      /* Close the gap so the ordinals stay a run. */
      const rest = await ctx.tx.select().from(jobQuestions)
        .where(eq(jobQuestions.jobId, q.jobId)).orderBy(jobQuestions.ordinal);
      let i = 0;
      for (const r of rest) {
        await ctx.tx.update(jobQuestions).set({ ordinal: i++ }).where(eq(jobQuestions.id, r.id));
      }
      await audit(ctx, {
        action: 'update',
        summary: 'removed an application question',
        entityType: 'requisition', entityId: q.jobId,
        before: { question: q.text },
      }, ctx.tx);
      return { toast: 'Question removed — earlier answers stay on their applications', icon: 'x' };
    },
  },

  /* ── Advertising it ───────────────────────────────────────────────────── */
  'job.post': {
    capability: 'job.publish',
    schema: base,
    async run({ v }, ctx) {
      await requireJob(ctx.viewer, v, ctx.tx);
      const r = await publishToLinkedIn(v, ctx);
      return r.state === 'live'
        ? {
          toast: `${r.title} is live on the LinkedIn company page`,
          icon: 'zap',
          ms: 4200,
        }
        : {
          toast: r.reason ?? 'It could not be posted',
          tone: 'warn' as const,
          icon: 'plug',
          ms: 5200,
        };
    },
  },

  /* Adding a question the bank already has, from the picker. */
  'jq.add': {
    capability: 'job.edit',
    schema: base,
    async run({ v, fields }, ctx) {
      const [jobId, bankId] = v.includes('|') ? v.split('|') : [str(fields, 'jobId'), v];
      if (!jobId || !bankId) throw new CommandError('That question was not understood');
      await requireJob(ctx.viewer, jobId, ctx.tx);
      const [job] = await ctx.tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!job) throw new CommandError('That requisition no longer exists');

      const [q] = await ctx.tx.select().from(questionBank)
        .where(eq(questionBank.id, bankId)).limit(1);
      if (!q) throw new CommandError('That question is no longer in the bank');

      const [existing] = await ctx.tx.select({ id: jobQuestions.id }).from(jobQuestions)
        .where(and(eq(jobQuestions.jobId, jobId), eq(jobQuestions.bankId, bankId))).limit(1);
      if (existing) {
        throw new CommandError('That question is already on this form', { tone: 'warn' });
      }

      const [{ n }] = rowsOf(await ctx.tx.execute(sql`
        SELECT coalesce(max(ordinal), -1) + 1 AS n FROM ${jobQuestions}
         WHERE job_id = ${jobId}`)) as Array<{ n: number }>;
      await ctx.tx.insert(jobQuestions).values({
        jobId, bankId: q.id, text: q.text, type: q.type, options: q.options,
        required: q.required, knockout: q.knockout, ordinal: Number(n),
      });

      await audit(ctx, {
        action: 'update',
        summary: `added a bank question to ${job.title}`,
        entityType: 'requisition', entityId: jobId, entityLabel: job.title,
        after: { question: q.text },
      }, ctx.tx);
      return { toast: 'Added to the careers form', icon: 'list' };
    },
  },

  /* Ticking "required" straight off the card. */
  'jq.req': {
    capability: 'job.edit',
    schema: base,
    async run({ v }, ctx) {
      const [q] = await ctx.tx.select().from(jobQuestions).where(eq(jobQuestions.id, v)).limit(1);
      if (!q) throw new CommandError('That question is no longer on this requisition');
      await requireJob(ctx.viewer, q.jobId, ctx.tx);
      await ctx.tx.update(jobQuestions).set({ required: !q.required }).where(eq(jobQuestions.id, v));
      await audit(ctx, {
        action: 'update',
        summary: `made an application question ${q.required ? 'optional' : 'required'}`,
        entityType: 'requisition', entityId: q.jobId,
        before: { required: q.required }, after: { required: !q.required },
      }, ctx.tx);
      return { toast: q.required ? 'Now optional' : 'Now required', icon: 'check' };
    },
  },
});

const QUESTION_TYPES = ['yesno', 'choice', 'multi', 'short', 'long', 'number'];
