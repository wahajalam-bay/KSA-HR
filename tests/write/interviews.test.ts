import { sql, eq, and } from 'drizzle-orm';
import {
  interviews, interviewPanel, evaluations, accounts, messages, auditEvents, domainEvents,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 3 — booking, moving and cancelling an interview.

   Four things make this more than a row with a date on it, and each one gets a
   test: the panel is invited, the scorecards are raised, a clash is refused
   until somebody insists, and the final interview stays locked behind the gate
   the board applies.
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
const coordinator = viewer({
  name: 'Taif Alshaikhi', staffRole: 'coordinator', staffId: 'stf_05', roleLabel: 'Coordinator',
});

/** A live application on a requisition that runs interviews. */
async function liveApp(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.job_id, a.candidate_id, c.name AS candidate, j.title, j.hiring_manager
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN candidates c ON c.id = a.candidate_id
     WHERE a.status = 'active' AND j.status = 'open'
       AND EXISTS (SELECT 1 FROM job_stages s WHERE s.job_id = j.id AND s.stage_key = 'iv1')
     ORDER BY a.id LIMIT 1`));
  return row as {
    id: string; job_id: string; candidate_id: string;
    candidate: string; title: string; hiring_manager: string;
  };
}

/* A working-day slot a few days out, so nothing collides with the dataset. */
function slot(days = 3, hour = 10) {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour - 3, 0, 0, 0);       // Riyadh is UTC+3
  /* Sunday to Thursday. */
  while (d.getUTCDay() === 5 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const timeOf = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh',
}).format(d);

const book = (over: Record<string, string> = {}) => ({
  date: dayOf(slot()),
  time: timeOf(slot()),
  durationMin: '45',
  mode: 'Google Meet',
  stage: 'iv1',
  panel: 'Reem Al-Sudairi, Karthik Menon',
  ...over,
});

const suite: Suite = {
  name: 'write · interviews',
  tests: [
    {
      name: 'booking writes the interview, the panel and one scorecard each',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const r = await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          });
          succeeded(r, 'ivw.create');
          const id = String((r as { data?: Record<string, unknown> }).data?.interviewId);

          const [iv] = await tx.select().from(interviews).where(eq(interviews.id, id));
          equals(iv.stage, 'iv1', 'it sits at the stage that was picked');
          equals(iv.status, 'scheduled');
          equals(iv.durationMin, 45);
          equals(iv.interviewer, a.hiring_manager, 'the hiring manager runs it');
          equals(iv.title, `1st Interview — ${a.candidate}`, 'the title names the stage and the person');

          const panel = await tx.select().from(interviewPanel)
            .where(eq(interviewPanel.interviewId, id)).orderBy(interviewPanel.sortOrder);
          equals(panel.length, 3, 'the hiring manager plus the two named');
          equals(panel[0].name, a.hiring_manager, 'and leads the list');
          ok(panel[0].isHiringManager, 'marked as the hiring manager');

          const evals = await tx.select().from(evaluations)
            .where(eq(evaluations.interviewId, id));
          equals(evals.length, 3, 'everybody on the panel owes a scorecard');
          ok(evals.every((e) => !e.submitted), 'none of them filed yet');
          ok(evals.every((e) => e.requestedAt !== null), 'and each one records when it was asked for');
        });
      },
    },

    {
      name: 'the panel can sign in afterwards — the accounts are made for them',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const before = await tx.select({ id: accounts.id }).from(accounts);
          succeeded(await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book({ panel: 'Nouf Binhamad Test, Karthik Menon' }), appId: a.id, interviewer: a.hiring_manager },
          }));
          const after = await tx.select().from(accounts);
          ok(after.length > before.length, 'somebody new can now sign in');

          const made = after.find((x) => x.name === 'Nouf Binhamad Test');
          ok(made, 'the new panel member has an account');
          equals(made!.email, 'nouf.binhamad.test@bayut.sa', 'on the company convention');
          equals(made!.role, 'participant', 'as an interview participant, not a hiring manager');
          equals(made!.status, 'invited', 'invited — they set a password at first sign-in');
          equals(made!.kind, 'person');
        });
      },
    },

    {
      name: 'a named hiring manager gets the hiring-manager role, not the narrower one',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book({ panel: '' }), appId: a.id, interviewer: a.hiring_manager },
          }));
          const [acc] = await tx.select().from(accounts)
            .where(sql`lower(${accounts.email}) = 'saud.alharbi@bayut.sa'`);
          ok(acc, 'the hiring manager has an account');
          equals(acc.role, 'hiring_manager');
        });
      },
    },

    {
      name: 'the same person cannot be in two rooms at once — unless somebody insists',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          }));

          /* Same panel, thirty minutes into the first — an overlap. */
          const clashing = new Date(slot().getTime() + 30 * 60_000);
          const second = await runIn(tx, 'ivw.create', recruiter, {
            fields: {
              ...book({ date: dayOf(clashing), time: timeOf(clashing) }),
              appId: a.id, interviewer: a.hiring_manager,
            },
          });
          refused(second, 'already with');

          const forced = await runIn(tx, 'ivw.create', recruiter, {
            fields: {
              ...book({ date: dayOf(clashing), time: timeOf(clashing), force: '1' }),
              appId: a.id, interviewer: a.hiring_manager,
            },
          });
          succeeded(forced, 'a recruiter who knows better can book it anyway');
        });
      },
    },

    {
      name: 'a Friday says so in the toast rather than being refused',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const friday = slot();
          while (friday.getUTCDay() !== 5) friday.setUTCDate(friday.getUTCDate() + 1);
          const r = await runIn(tx, 'ivw.create', recruiter, {
            fields: {
              ...book({ date: dayOf(friday), time: timeOf(friday) }),
              appId: a.id, interviewer: a.hiring_manager,
            },
          });
          succeeded(r, 'the weekend is allowed');
          includes(String((r as { toast?: string }).toast), 'Friday or Saturday');
          equals((r as { tone?: string }).tone, 'bad', 'and is shown as a warning');
        });
      },
    },

    {
      name: 'a time in the past is refused',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const past = new Date(Date.now() - 5 * 86_400_000);
          refused(await runIn(tx, 'ivw.create', recruiter, {
            fields: {
              ...book({ date: dayOf(past), time: '10:00' }),
              appId: a.id, interviewer: a.hiring_manager,
            },
          }), 'in the past');
        });
      },
    },

    {
      name: 'a stage you do not interview at is refused',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          refused(await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book({ stage: 'offer' }), appId: a.id, interviewer: a.hiring_manager },
          }), 'pick one of those');

          /* And one the requisition itself does not run. */
          const [without] = rowsOf(await tx.execute(sql`
            SELECT a.id, j.hiring_manager
              FROM applications a
              JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND j.status = 'open'
               AND NOT EXISTS (SELECT 1 FROM job_stages s WHERE s.job_id = j.id AND s.stage_key = 'iv2')
             ORDER BY a.id LIMIT 1`)) as Array<{ id: string; hiring_manager: string }>;
          if (without) {
            refused(await runIn(tx, 'ivw.create', admin, {
              fields: { ...book({ stage: 'iv2' }), appId: without.id, interviewer: without.hiring_manager },
            }), 'does not run that stage');
          }
        });
      },
    },

    {
      name: 'the final interview stays locked behind the sales-pitch gate',
      async fn() {
        await inRollback(async (tx) => {
          /* A requisition that runs the pitch, with a candidate whose pitch is
             not scored yet. */
          const [row] = rowsOf(await tx.execute(sql`
            SELECT a.id, j.hiring_manager
              FROM applications a
              JOIN jobs j ON j.id = a.job_id
             WHERE a.status = 'active' AND j.status = 'open' AND j.pitch_on
               AND EXISTS (SELECT 1 FROM job_stages s WHERE s.job_id = j.id AND s.stage_key = 'ivf')
               AND NOT EXISTS (
                 SELECT 1 FROM pitches p WHERE p.application_id = a.id AND p.status = 'completed')
             ORDER BY a.id LIMIT 1`)) as Array<{ id: string; hiring_manager: string }>;
          ok(row, 'the dataset has one waiting on its pitch');

          refused(await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book({ stage: 'ivf' }), appId: row.id, interviewer: row.hiring_manager },
          }), 'locked');
        });
      },
    },

    {
      name: 'a hiring manager may not book, a coordinator may',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          refused(await runIn(tx, 'ivw.create', manager, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          }), 'access');
          succeeded(await runIn(tx, 'ivw.create', coordinator, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          }), 'a coordinator schedules interviews for a living');
        });
      },
    },

    {
      name: 'a recruiter outside the requisition cannot book on it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const outsider = viewer({
            name: 'Lama Alghamdi', staffRole: 'recruiter', staffId: 'stf_09',
            scope: { kind: 'jobs', jobIds: ['job_99_nothing'], own: false },
          });
          refused(await runIn(tx, 'ivw.create', outsider, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          }), '');
        });
      },
    },

    {
      name: 'moving one keeps the scorecards and records where it came from',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const created = await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          });
          const id = String((created as { data?: Record<string, unknown> }).data?.interviewId);
          const was = (await tx.select().from(interviews).where(eq(interviews.id, id)))[0].at;

          const later = slot(6, 14);
          const moved = await runIn(tx, 'ivw.moveSave', recruiter, {
            v: id,
            fields: { date: dayOf(later), time: timeOf(later), durationMin: '60', mode: 'On-site — Olaya' },
          });
          succeeded(moved, 'ivw.moveSave');

          const [iv] = await tx.select().from(interviews).where(eq(interviews.id, id));
          equals(iv.durationMin, 60, 'the new length sticks');
          equals(iv.mode, 'On-site — Olaya');
          ok(iv.at.getTime() !== was.getTime(), 'and it actually moved');

          const evals = await tx.select().from(evaluations).where(eq(evaluations.interviewId, id));
          equals(evals.length, 3, 'nobody stopped owing a scorecard');

          const [trail] = await tx.select().from(auditEvents)
            .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'update')));
          ok(trail, 'the move is on the record');
          ok((trail.before as Record<string, unknown>).at, 'with the time it was moved from');
        });
      },
    },

    {
      name: 'changing the panel on the way moves the scorecards with it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const created = await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          });
          const id = String((created as { data?: Record<string, unknown> }).data?.interviewId);

          const later = slot(7, 11);
          succeeded(await runIn(tx, 'ivw.moveSave', recruiter, {
            v: id,
            fields: {
              date: dayOf(later), time: timeOf(later),
              interviewer: a.hiring_manager, panel: 'Karthik Menon',
            },
          }));

          const panel = await tx.select().from(interviewPanel)
            .where(eq(interviewPanel.interviewId, id)).orderBy(interviewPanel.sortOrder);
          equals(panel.length, 2, 'two on the panel now');
          const names = panel.map((p) => p.name);
          ok(!names.includes('Reem Al-Sudairi'), 'the one taken off is gone');

          const evals = await tx.select().from(evaluations).where(eq(evaluations.interviewId, id));
          equals(evals.length, 2, 'and owes nothing');
          ok(!evals.some((e) => e.evaluatorName === 'Reem Al-Sudairi'),
            'the withdrawn scorecard went with them');
        });
      },
    },

    {
      name: 'cancelling withdraws the outstanding scorecards and leaves the application alone',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const created = await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          });
          const id = String((created as { data?: Record<string, unknown> }).data?.interviewId);

          /* One of them files before it is called off. */
          const [first] = await tx.select().from(evaluations).where(eq(evaluations.interviewId, id));
          await tx.update(evaluations).set({ submitted: true, overall: '4.0', verdict: 'yes' })
            .where(eq(evaluations.id, first.id));

          const [appBefore] = rowsOf(await tx.execute(sql`
            SELECT stage, status FROM applications WHERE id = ${a.id}`));

          /* It asks before it acts, and does nothing until it is answered. */
          const asked = await runIn(tx, 'ivw.cancel', recruiter, { v: id });
          succeeded(asked, 'ivw.cancel asks');
          ok((asked as { confirm?: unknown }).confirm, 'it asks first');
          const still = (await tx.select().from(interviews).where(eq(interviews.id, id)))[0];
          equals(still.status, 'scheduled', 'and nothing has happened yet');

          succeeded(await runIn(tx, 'ivw.cancel', recruiter, {
            v: id, fields: { confirmed: '1', reason: 'The hiring manager is travelling' },
          }));

          const [iv] = await tx.select().from(interviews).where(eq(interviews.id, id));
          equals(iv.status, 'cancelled');
          equals(iv.cancelReason, 'The hiring manager is travelling');
          ok(iv.cancelledAt, 'and when');

          const left = await tx.select().from(evaluations).where(eq(evaluations.interviewId, id));
          equals(left.length, 1, 'only the one already written survives');
          ok(left[0].submitted, 'and it is the submitted one');

          const [appAfter] = rowsOf(await tx.execute(sql`
            SELECT stage, status FROM applications WHERE id = ${a.id}`));
          equals(appAfter.stage, appBefore.stage, 'cancelling an interview is not a rejection');
          equals(appAfter.status, appBefore.status);
        });
      },
    },

    {
      name: 'a cancelled interview cannot be cancelled or moved again',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const created = await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          });
          const id = String((created as { data?: Record<string, unknown> }).data?.interviewId);
          succeeded(await runIn(tx, 'ivw.cancel', admin, { v: id, fields: { confirmed: '1' } }));

          refused(await runIn(tx, 'ivw.cancel', admin, { v: id, fields: { confirmed: '1' } }),
            'already cancelled');
          const later = slot(8, 9);
          refused(await runIn(tx, 'ivw.moveSave', admin, {
            v: id, fields: { date: dayOf(later), time: timeOf(later) },
          }), 'cancelled');
        });
      },
    },

    {
      name: 'the slot picker queues the candidate confirmation rather than pretending to send it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const when = slot(4, 11);
          const r = await runIn(tx, 'book.confirm', recruiter, {
            v: `${a.id}|${when.toISOString()}`,
            fields: { stage: 'iv1', mode: 'Google Meet', dur: '45', interviewer: a.hiring_manager, panel: 'Karthik Menon' },
          });
          succeeded(r, 'book.confirm');
          includes(String((r as { toast?: string }).toast), 'invitation sent');

          const [msg] = await tx.select().from(messages)
            .where(and(eq(messages.applicationId, a.id), eq(messages.channel, 'Email')))
            .orderBy(sql`${messages.at} DESC`).limit(1);
          ok(msg, 'the confirmation exists');
          /* No e-mail provider is configured in a test environment, and the
             product says so rather than claiming it went. */
          equals(msg.status, 'not_configured', 'it says why it did not go');
          includes(msg.statusDetail ?? '', 'Settings → Integrations');
          includes(msg.subject ?? '', 'Confirmed:');
          includes(msg.body, a.hiring_manager);
        });
      },
    },

    {
      name: 'every booking leaves a trail and an event the automations can react to',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const created = await runIn(tx, 'ivw.create', recruiter, {
            fields: { ...book(), appId: a.id, interviewer: a.hiring_manager },
          });
          const id = String((created as { data?: Record<string, unknown> }).data?.interviewId);

          const trail = await tx.select().from(auditEvents).where(eq(auditEvents.entityId, id));
          equals(trail.length, 1, 'one audit event for the booking');
          equals(trail[0].actorName, recruiter.name);
          equals(trail[0].entityType, 'interview');
          includes(trail[0].summary, 'booked');

          const events = await tx.select().from(domainEvents)
            .where(eq(domainEvents.subjectId, id));
          equals(events.length, 1);
          equals(events[0].type, 'interview.scheduled');

          const asked = await tx.select().from(domainEvents)
            .where(eq(domainEvents.type, 'scorecard.requested'));
          ok(asked.length >= 3, 'and one request per scorecard');
        });
      },
    },
  ],
};

export default suite;
