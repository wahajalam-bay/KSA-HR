import { sql, eq } from 'drizzle-orm';
import {
  assessments, pitches, pitchScores, pitchProjects, tasks, notifications, messages,
  auditEvents, domainEvents,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';
import { finalGate } from '@/lib/services/transitions';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 5 — the two gates on the final interview.

   The behavioural questionnaire and the sales pitch are the only two things
   that can hold a final interview shut, so the suite checks both ends: that
   neither result can be invented, and that recording a real one opens the gate.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});
const manager = viewer({
  name: 'Saud Al-Harbi', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

/** An application on a requisition that runs the pitch, with no pitch scored. */
async function pitchApp(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.candidate_id, a.job_id, c.name AS candidate, j.title
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN candidates c ON c.id = a.candidate_id
     WHERE a.status = 'active' AND j.status = 'open' AND j.pitch_on
       AND NOT EXISTS (SELECT 1 FROM pitches p WHERE p.application_id = a.id)
     ORDER BY a.id LIMIT 1`));
  return row as { id: string; candidate_id: string; job_id: string; candidate: string; title: string };
}

/** A senior application with no behavioural test on it yet. */
async function seniorApp(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, c.name AS candidate, j.title
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN positions p ON p.code = j.position_code
     WHERE a.status = 'active' AND j.status = 'open'
       AND p.grade ~ '^[DM]'
       AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.application_id = a.id)
     ORDER BY a.id LIMIT 1`));
  return row as { id: string; candidate: string; title: string } | undefined;
}

const sixTraits = (score: number) => ({
  trait_drive: String(score),
  trait_judgement: String(score),
  trait_resilience: String(score),
  trait_collaboration: String(score),
  trait_structure: String(score),
  trait_candour: String(score),
});

const suite: Suite = {
  name: 'write · assessment and sales pitch',
  tests: [
    {
      name: 'the behavioural test is refused while there is no provider to send it with',
      async fn() {
        await inRollback(async (tx) => {
          const a = await seniorApp(tx);
          ok(a, 'the dataset has a manager-and-above application');
          const r = await runIn(tx, 'asm.send', recruiter, { v: a!.id });
          refused(r, 'No assessment provider is configured');

          const left = await tx.select().from(assessments)
            .where(eq(assessments.applicationId, a!.id));
          equals(left.length, 0, 'and nothing is written as if it had gone');
        });
      },
    },

    {
      name: 'a result is recorded from the report, never invented',
      async fn() {
        await inRollback(async (tx) => {
          /* The provider is absent in a test environment, so the record is
             seeded the way the webhook would have, and the recruiter types the
             report in — which is the path this test is about. */
          const [row] = rowsOf(await tx.execute(sql`
            SELECT a.id, a.candidate_id, a.job_id FROM applications a
              JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND j.status = 'open'
               AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.application_id = a.id)
             ORDER BY a.id LIMIT 1`)) as Array<{ id: string; candidate_id: string; job_id: string }>;
          const asmId = 'asm_test_0001';
          await tx.insert(assessments).values({
            id: asmId,
            applicationId: row.id,
            candidateId: row.candidate_id,
            jobId: row.job_id,
            provider: 'Thomas PPA',
            status: 'invited',
            invitedAt: new Date(),
          });

          const r = await runIn(tx, 'asm.complete', recruiter, {
            v: asmId, fields: sixTraits(8),
          });
          succeeded(r, 'asm.complete');
          includes(String((r as { toast?: string }).toast), '80 of 100');

          const [a] = await tx.select().from(assessments).where(eq(assessments.id, asmId));
          equals(a.status, 'completed');
          equals(a.score, 80);
          equals(a.verdict, 'strong');
          equals(a.traits.length, 6, 'all six traits are stored');
          ok(a.traits.every((t) => t.note), 'each with what it measures');
          includes(a.summary ?? '', 'leadership norm');

          const bell = await tx.select().from(notifications)
            .where(eq(notifications.applicationId, row.id));
          ok(bell.some((n) => n.kind === 'assessment'), 'the desk is told the final can be booked');
        });
      },
    },

    {
      name: 'a partial report is refused rather than averaged',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT a.id, a.candidate_id, a.job_id FROM applications a
              JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND j.status = 'open'
               AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.application_id = a.id)
             ORDER BY a.id LIMIT 1`)) as Array<{ id: string; candidate_id: string; job_id: string }>;
          const asmId = 'asm_test_0002';
          await tx.insert(assessments).values({
            id: asmId, applicationId: row.id, candidateId: row.candidate_id, jobId: row.job_id,
            provider: 'SHL OPQ32', status: 'invited', invitedAt: new Date(),
          });

          const partial = sixTraits(7);
          delete (partial as Record<string, string>).trait_candour;
          refused(await runIn(tx, 'asm.complete', recruiter, { v: asmId, fields: partial }),
            'Candour has no score');

          refused(await runIn(tx, 'asm.complete', recruiter, {
            v: asmId, fields: { ...sixTraits(7), trait_drive: '14' },
          }), 'between one and ten');

          const [a] = await tx.select().from(assessments).where(eq(assessments.id, asmId));
          equals(a.status, 'invited', 'and nothing was written');
        });
      },
    },

    {
      name: 'the brief goes out with the project the requisition names',
      async fn() {
        await inRollback(async (tx) => {
          const a = await pitchApp(tx);
          const r = await runIn(tx, 'pitch.send', recruiter, { v: a.id });
          succeeded(r, 'pitch.send');

          const [p] = await tx.select().from(pitches).where(eq(pitches.applicationId, a.id));
          ok(p, 'the pitch record exists');
          equals(p.status, 'sent');
          ok(p.dueAt, 'with a date on it');
          ok(p.projectId, 'and a project');
          ok((p.max ?? 0) > 0, 'and the marks it will be scored out of');

          /* The application already carries its acknowledgement, so the brief
             is the newest thing on the thread rather than the only thing. */
          const msgs = await tx.select().from(messages)
            .where(eq(messages.applicationId, a.id))
            .orderBy(sql`${messages.at} DESC`);
          ok(msgs.length >= 1, 'the brief is on the thread');
          const email = msgs.find((m) => m.channel === 'Email' && m.status === 'not_configured');
          ok(email, 'including the long one');
          ok(!/\{\{/.test(email!.body), 'with every merge field filled');
          includes(email!.subject ?? '', 'sales pitch brief');
        });
      },
    },

    {
      name: 'a requisition that does not sell has no pitch to send',
      async fn() {
        await inRollback(async (tx) => {
          const [row] = rowsOf(await tx.execute(sql`
            SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND j.status = 'open' AND NOT j.pitch_on
             ORDER BY a.id LIMIT 1`)) as Array<{ id: string }>;
          refused(await runIn(tx, 'pitch.send', admin, { v: row.id }), 'does not run a sales pitch');
        });
      },
    },

    {
      name: 'a pitch is scored against the project’s own criteria, one score each',
      async fn() {
        await inRollback(async (tx) => {
          const a = await pitchApp(tx);
          succeeded(await runIn(tx, 'pitch.send', recruiter, { v: a.id }));
          succeeded(await runIn(tx, 'pitch.run', recruiter, { v: a.id }));

          const [p] = await tx.select().from(pitches).where(eq(pitches.applicationId, a.id));
          equals(p.status, 'running');
          const [project] = await tx.select().from(pitchProjects)
            .where(eq(pitchProjects.id, p.projectId!));
          const criteria = project.criteria;
          ok(criteria.length >= 3, 'the project has criteria');

          /* One short is a refusal, not a guess. */
          const short: Record<string, string> = {};
          for (const c of criteria.slice(1)) short[`c_${c.key}`] = '4';
          refused(await runIn(tx, 'pitch.score', recruiter, { v: a.id, fields: short }),
            'has no score');

          const full: Record<string, string> = {};
          for (const c of criteria) full[`c_${c.key}`] = '4';
          const r = await runIn(tx, 'pitch.score', recruiter, {
            v: a.id,
            fields: { ...full, strengths: 'Held the price\nClosed on a date', gaps: 'Thin discovery' },
          });
          succeeded(r, 'pitch.score');
          includes(String((r as { toast?: string }).toast), '80 of 100');

          const [after] = await tx.select().from(pitches).where(eq(pitches.id, p.id));
          equals(after.status, 'completed');
          equals(after.score, 80);
          equals(after.verdict, 'strong');
          equals(after.model, 'human', 'a person scored it, and the record says so');
          equals(after.strengths.length, 2);
          equals(after.gaps.length, 1);

          const rows = await tx.select().from(pitchScores).where(eq(pitchScores.pitchId, p.id));
          equals(rows.length, criteria.length, 'one row per criterion');
        });
      },
    },

    {
      name: 'scoring the pitch opens the final interview on a selling requisition',
      async fn() {
        await inRollback(async (tx) => {
          const a = await pitchApp(tx);
          const before = await finalGate(a.id, 'ivf', tx);
          ok(!before.ok, 'the final is shut while the pitch is outstanding');

          succeeded(await runIn(tx, 'pitch.send', recruiter, { v: a.id }));
          succeeded(await runIn(tx, 'pitch.run', recruiter, { v: a.id }));
          const [p] = await tx.select().from(pitches).where(eq(pitches.applicationId, a.id));
          const [project] = await tx.select().from(pitchProjects)
            .where(eq(pitchProjects.id, p.projectId!));
          const full: Record<string, string> = {};
          for (const c of project.criteria) full[`c_${c.key}`] = '4';
          succeeded(await runIn(tx, 'pitch.score', recruiter, { v: a.id, fields: full }));

          const after = await finalGate(a.id, 'ivf', tx);
          ok(after.ok, 'and open once it is scored');
        });
      },
    },

    {
      name: 'a pitch cannot be scored before it has been run',
      async fn() {
        await inRollback(async (tx) => {
          const a = await pitchApp(tx);
          refused(await runIn(tx, 'pitch.score', recruiter, { v: a.id, fields: { c_x: '4' } }),
            'no pitch on this application');
        });
      },
    },

    {
      name: 'a hiring manager may not send a brief or score a pitch',
      async fn() {
        await inRollback(async (tx) => {
          const a = await pitchApp(tx);
          refused(await runIn(tx, 'pitch.send', manager, { v: a.id }), 'access');
          refused(await runIn(tx, 'pitch.score', manager, { v: a.id, fields: { c_x: '4' } }), 'access');
        });
      },
    },

    {
      name: 'the pitch leaves a trail, an event and a use on the project',
      async fn() {
        await inRollback(async (tx) => {
          const a = await pitchApp(tx);
          succeeded(await runIn(tx, 'pitch.send', recruiter, { v: a.id }));
          const [p] = await tx.select().from(pitches).where(eq(pitches.applicationId, a.id));
          const [before] = await tx.select().from(pitchProjects)
            .where(eq(pitchProjects.id, p.projectId!));

          succeeded(await runIn(tx, 'pitch.run', recruiter, { v: a.id }));
          const full: Record<string, string> = {};
          for (const c of before.criteria) full[`c_${c.key}`] = '3';
          succeeded(await runIn(tx, 'pitch.score', recruiter, { v: a.id, fields: full }));

          const [after] = await tx.select().from(pitchProjects)
            .where(eq(pitchProjects.id, p.projectId!));
          equals(after.uses, (before.uses ?? 0) + 1, 'the project counts the run');

          const trail = await tx.select().from(auditEvents).where(eq(auditEvents.entityId, p.id));
          equals(trail.length, 3, 'brief, start and score');

          const events = await tx.select().from(domainEvents)
            .where(eq(domainEvents.subjectId, p.id));
          const types = events.map((e) => e.type).sort();
          equals(types.join(','), 'pitch.completed,pitch.sent');
        });
      },
    },
  ],
};

export default suite;
