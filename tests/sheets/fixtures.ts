import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';

/* ═════════════════════════════════════════════════════════════════════════════
   WHAT TO OPEN EACH PANEL ON

   Three suites draw every panel in the product — that they render, that they
   are reachable without a mouse, that every button in them is wired to
   something — and each of them needs the same thing first: a real id of each
   kind, out of the real database.

   That list lived in each of the three, which meant a new panel passed two
   suites and failed the third, and a panel whose id nobody had added was drawn
   on an empty string and "failed" for a reason that had nothing to do with the
   panel. So it is one list, here.

   A name that is not in it opens on nothing, which is itself worth drawing:
   that is what Create, Help and the notification bell do.
   ═════════════════════════════════════════════════════════════════════════════*/

export type Ids = Record<string, string>;

let cached: Ids | null = null;

export async function realIds(): Promise<Ids> {
  if (cached) return cached;
  const one = async (q: ReturnType<typeof sql>) => {
    const [row] = rowsOf(await db().execute(q)) as Array<{ id: string }>;
    return row?.id ? String(row.id) : '';
  };
  cached = {
    job: await one(sql`SELECT id FROM jobs WHERE status = 'open' ORDER BY created_at LIMIT 1`),
    application: await one(sql`
      SELECT id FROM applications WHERE status = 'active' ORDER BY applied_at DESC LIMIT 1`),
    candidate: await one(sql`SELECT id FROM candidates ORDER BY created_at DESC LIMIT 1`),
    interview: await one(sql`
      SELECT id FROM interviews WHERE status <> 'cancelled' ORDER BY at DESC LIMIT 1`),
    /* An interview that was actually recorded — what the review panel is for. */
    reviewed: await one(sql`
      SELECT id FROM interviews WHERE recorded ORDER BY at DESC LIMIT 1`),
    offer: await one(sql`SELECT id FROM offers ORDER BY created_at DESC LIMIT 1`),
    template: await one(sql`SELECT id FROM offer_templates WHERE archived_at IS NULL LIMIT 1`),
    employee: await one(sql`SELECT id FROM employees ORDER BY start_date DESC LIMIT 1`),
    reference: await one(sql`SELECT id FROM employee_references LIMIT 1`),
    position: await one(sql`SELECT id FROM positions WHERE retired_at IS NULL LIMIT 1`),
    staff: await one(sql`SELECT id FROM staff WHERE status = 'active' LIMIT 1`),
    dept: await one(sql`SELECT id FROM departments WHERE archived_at IS NULL LIMIT 1`),
    question: await one(sql`SELECT id FROM question_bank WHERE archived_at IS NULL LIMIT 1`),
    jobQuestion: await one(sql`SELECT id FROM job_questions LIMIT 1`),
    project: await one(sql`SELECT id FROM pitch_projects LIMIT 1`),
    notifyTeam: await one(sql`SELECT id FROM notified_teams WHERE archived_at IS NULL LIMIT 1`),
    flow: await one(sql`SELECT id FROM approval_flows LIMIT 1`),
    step: await one(sql`SELECT id FROM approval_flow_steps LIMIT 1`),
    account: await one(sql`SELECT id FROM accounts LIMIT 1`),
    screening: await one(sql`SELECT id FROM screenings LIMIT 1`),
    assessment: await one(sql`SELECT id FROM assessments LIMIT 1`),
    /* An application on a requisition whose loop actually has that stage. */
    screenApp: await one(sql`
      SELECT a.id FROM applications a
       JOIN job_stages js ON js.job_id = a.job_id AND js.stage_key = 'screen'
       WHERE a.status = 'active' LIMIT 1`),
    pitchApp: await one(sql`
      SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE j.pitch_on AND a.status = 'active' LIMIT 1`),
    /* A CV waiting in the intake queue, and a plan waiting to be imported.
       Both are ordinary for a live desk and absent in a fresh one, which is
       why the panels that open on them are allowed to come back empty. */
    stagedCv: await one(sql`
      SELECT id FROM files
       WHERE kind = 'cv' AND owner_type = 'org' AND owner_id = 'intake' AND deleted_at IS NULL
       LIMIT 1`),
    importFile: await one(sql`
      SELECT id FROM files WHERE kind = 'import' AND deleted_at IS NULL LIMIT 1`),
  };
  return cached;
}

export async function valueFor(name: string): Promise<string> {
  const i = await realIds();
  const byName: Record<string, string> = {
    /* Requisitions */
    'job.edit': i.job, 'jd.edit': i.job, 'hm.add': i.job, 'sk.jd': i.job, 'jq.new': i.job,
    'jq.pick': i.job, 'job.addCand': i.job, 'scr.stageCalls': i.job,
    'cand.new': i.job, 'cand.newJob': i.job,
    'jq.edit': i.jobQuestion,

    /* People */
    'cand.claim': i.candidate, 'tag.add': i.candidate,
    'drawer.cross': i.candidate, 'drawer.cand': i.candidate,

    /* Applications */
    'app.move': i.application, 'app.reject': i.application, 'app.email': i.application,
    'app.emailTpl': i.application, 'drawer.open': i.application, 'drawer.app': i.application,
    'task.new': i.application, 'offer.open': i.application, 'asm.invite': i.application,
    'eval.start': i.application,
    'scr.call': i.screenApp || i.application, 'scr.salary': i.application,
    'pitch.brief': i.pitchApp || i.application,
    'scr.transcript': i.screening,
    'book.pick': `${i.application}|${new Date(Date.now() + 172_800_000).toISOString()}`,

    /* The loop */
    'ivw.reschedule': i.interview, 'ivr.open': i.reviewed || i.interview,

    /* Offers */
    'offer.edit': i.offer, 'offer.verify': i.offer, 'offer.decline': i.offer,
    'offer.revise': i.offer,
    'otpl.open': i.template,

    /* Joining */
    'emp.open': i.employee, 'emp.formEdit': i.employee, 'ref.add': i.employee,
    'onb.notify': i.employee, 'onb.file': i.employee, 'prob.open': i.employee,
    'ref.rate': i.reference,

    /* The plan */
    'pos.open': i.position, 'pos.new': i.dept, 'pos.openReq': i.position,
    'mp.importPreview': i.importFile,

    /* Intake */
    'cv.review': i.stagedCv,

    /* Settings and the desk */
    'staff.edit': i.staff, 'staff.delete': i.staff,
    'dept.edit': i.dept, 'qb.edit': i.question, 'pp.edit': i.project,
    'tm.edit': i.notifyTeam,
    'apf.stepEdit': i.step ? `${i.flow}|${i.step}` : i.flow,
    'acc.scope': i.account,
    'audit.open': 'requisition',
  };
  return byName[name] ?? '';
}

/**
 * Panels whose whole point is a record a given dataset may not have: a
 * transcript nobody has recorded, a CV nobody has dropped, a plan nobody has
 * uploaded. Each draws an honest "there is nothing here" rather than throwing,
 * and the suites allow them to come back empty rather than failing on a seed.
 */
export const MAY_BE_EMPTY = new Set([
  'scr.transcript', 'ivr.open', 'ref.rate', 'otpl.open', 'jq.edit', 'apf.stepEdit',
  'cv.review', 'mp.importPreview',
]);
