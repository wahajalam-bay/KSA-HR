import { sql, eq, and } from 'drizzle-orm';
import {
  screenings, screeningScores, screeningTurns, candidates, messages, accessLinks,
  auditEvents, domainEvents,
} from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';
import { recordAnswer, beginChat, complete } from '@/lib/services/screening';
import { scoreAnswer, moneyIn, noticeIn, verdictOf } from '@/lib/domain/screening';

/* ─────────────────────────────────────────────────────────────────────────────
   Flow 4 — screening.

   The rules worth a suite: a link is a credential and is stored as one; an
   answer is scored by a rule rather than by a model; a channel with no provider
   says so instead of claiming it sent; and the phone screen is refused outright
   when there is nothing to place the call with.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const coordinator = viewer({
  name: 'Taif Alshaikhi', staffRole: 'coordinator', staffId: 'stf_05', roleLabel: 'Coordinator',
});
const manager = viewer({
  name: 'Saud Al-Harbi', role: 'hiring_manager', staffRole: null,
  roleLabel: 'Hiring manager', isPortal: true, scope: { kind: 'own', jobIds: [], own: true },
});

async function liveApp(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.candidate_id, a.job_id, c.name AS candidate, j.title
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN candidates c ON c.id = a.candidate_id
     WHERE a.status = 'active' AND j.status = 'open' AND c.phone IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM screenings s WHERE s.application_id = a.id)
     ORDER BY a.id LIMIT 1`));
  return row as { id: string; candidate_id: string; job_id: string; candidate: string; title: string };
}

const ctxOf = (tx: Parameters<typeof runIn>[0], who = recruiter) => ({
  viewer: who,
  requestId: 'test',
  correlationId: 'test',
  tx,
  now: new Date(),
});

const suite: Suite = {
  name: 'write · screening',
  tests: [
    {
      name: 'the six questions are built from the requisition, not from thin air',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));
          const s = (await tx.select().from(screenings)
            .where(eq(screenings.applicationId, a.id)))[0];
          ok(s, 'the screening exists');

          const r = await beginChat(s.id, ctxOf(tx));
          equals(r.of, 6, 'six questions');
          ok(r.question, 'and the first one is waiting');
          includes(r.question!.question, 'based in', 'it opens on where they are');

          const [job] = rowsOf(await tx.execute(sql`
            SELECT l.city FROM jobs j JOIN locations l ON l.id = j.location_id
             WHERE j.id = ${a.job_id}`)) as Array<{ city: string }>;
          includes(r.question!.question, job.city, 'naming this requisition’s city');
        });
      },
    },

    {
      name: 'the link is a credential — the token is never stored',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));

          const [link] = await tx.select().from(accessLinks)
            .where(eq(accessLinks.applicationId, a.id));
          ok(link, 'a link was minted');
          equals(link.purpose, 'screening');
          equals(link.tokenHash.length, 64, 'a SHA-256, not the token');
          ok(link.expiresAt, 'and it expires');

          const [msg] = await tx.select().from(messages)
            .where(eq(messages.applicationId, a.id))
            .orderBy(sql`${messages.at} DESC`).limit(1);
          ok(msg, 'the message exists');
          ok(!msg.body.includes(link.tokenHash), 'the hash never goes in the message');
          ok(/\/screen\/[A-Za-z0-9_-]{20,}/.test(msg.body), 'but the link does');
        });
      },
    },

    {
      name: 'a channel with no provider says so rather than claiming it sent',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const r = await runIn(tx, 'scr.invite', recruiter, { v: a.id });
          succeeded(r, 'scr.invite');
          includes(String((r as { toast?: string }).toast), 'not configured');
          equals((r as { tone?: string }).tone, 'warn');

          const [msg] = await tx.select().from(messages)
            .where(eq(messages.applicationId, a.id))
            .orderBy(sql`${messages.at} DESC`).limit(1);
          equals(msg.status, 'not_configured');
          ok(msg.provider === null, 'and no provider is claimed');
        });
      },
    },

    {
      name: 'answering walks the six and finishes with a verdict',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));
          const s = (await tx.select().from(screenings)
            .where(eq(screenings.applicationId, a.id)))[0];

          const ctx = ctxOf(tx);
          await beginChat(s.id, ctx);

          const answers: Record<string, string> = {
            location: 'Yes — I am in Riyadh now.',
            right_to_work: 'Yes, Saudi national.',
            notice: '30 days, possibly negotiable.',
            salary: 'I am on SAR 9,000 now and looking for around SAR 12,000 a month.',
            arabic: 'Native speaker.',
            experience: '8 years, most recently at Aqar.',
          };
          let last: Awaited<ReturnType<typeof recordAnswer>> | null = null;
          for (const [key, answer] of Object.entries(answers)) {
            last = await recordAnswer({ screeningId: s.id, key: key as never, answer }, ctx);
          }
          ok(last?.finished, 'the last answer closes it');

          const after = (await tx.select().from(screenings).where(eq(screenings.id, s.id)))[0];
          equals(after.status, 'completed');
          equals(after.max, 12, 'six questions out of two each');
          equals(after.total, 12, 'every answer clears');
          equals(after.score, 100);
          equals(after.verdict, 'pass');
          includes(after.summary ?? '', 'Clears every knockout');

          const turns = await tx.select().from(screeningTurns)
            .where(eq(screeningTurns.screeningId, s.id));
          ok(turns.length >= 13, 'the conversation is on the record');
          equals(new Set(turns.map((t) => t.seq)).size, turns.length, 'and each turn is numbered once');
        });
      },
    },

    {
      name: 'a weak answer costs the score and shows up in the summary',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));
          const s = (await tx.select().from(screenings)
            .where(eq(screenings.applicationId, a.id)))[0];
          const ctx = ctxOf(tx);
          await beginChat(s.id, ctx);

          for (const [key, answer] of Object.entries({
            location: 'I am in Cairo and cannot move.',
            right_to_work: 'No, I would need sponsorship.',
            notice: '90 days.',
            salary: 'I am looking for SAR 60,000 a month.',
            arabic: 'I do not speak Arabic.',
            experience: 'I am a recent graduate.',
          })) {
            await recordAnswer({ screeningId: s.id, key: key as never, answer }, ctx);
          }

          const after = (await tx.select().from(screenings).where(eq(screenings.id, s.id)))[0];
          equals(after.verdict, 'fail');
          includes(after.summary ?? '', 'Misses on');
          ok((after.total ?? 0) <= 2, 'almost nothing scored');
        });
      },
    },

    {
      name: 'the scoring rules are rules, not opinions',
      fn() {
        const c = {
          jobTitle: 'Property Consultant', family: 'Sales', city: 'Riyadh', remoteOk: false,
          salaryMin: 9000, salaryMax: 14000, arabicMatters: true, wantsYears: 2,
        };
        equals(scoreAnswer('notice', 'I can start immediately.', c), 2);
        equals(scoreAnswer('notice', '45 days', c), 1);
        equals(scoreAnswer('notice', '3 months', c), 0);
        equals(scoreAnswer('salary', 'Around SAR 13,000 a month.', c), 2);
        equals(scoreAnswer('salary', 'SAR 15,500 all in.', c), 1);
        equals(scoreAnswer('salary', 'SAR 30,000.', c), 0);
        equals(scoreAnswer('arabic', 'Conversational — comfortable with customers.', c), 1,
          'conversational Arabic costs a point on a selling role');
        equals(scoreAnswer('arabic', 'Conversational.', { ...c, arabicMatters: false }), 2,
          'and costs nothing where it is not customer-facing');
        equals(scoreAnswer('experience', '', c), 0, 'an unanswered knockout is a knockout');

        equals(moneyIn('I am on SAR 9,750 and want SAR 12,500').join(','), '9750,12500');
        /* Spelled out is still an answer — "two months" is what a person says,
           and reading it as nothing scored them a one where they deserved a
           nought. What is null is an answer with no number in it at all. */
        equals(noticeIn('two months'), 60, 'spelled out counts');
        equals(noticeIn('a month'), 30);
        equals(noticeIn('I would have to check with my manager'), null,
          'and an answer with no period in it is no period');
        /* The same for money: most people answer in thousands. */
        equals(moneyIn('around 18k').join(','), '18000', 'thousands count');
        equals(moneyIn('16-20k').join(','), '16000,20000', 'and so does a range');
        equals(noticeIn('2 months'), 60);
        equals(noticeIn('45 days'), 45);
        equals(verdictOf(12, 12), 'pass');
        equals(verdictOf(7, 12), 'review');
        equals(verdictOf(5, 12), 'fail');
      },
    },

    {
      name: 'the phone screen is refused while there is nothing to call with',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const r = await runIn(tx, 'scr.callGo', recruiter, { v: a.id, fields: { when: 'now' } });
          refused(r, 'not configured');
          const left = await tx.select().from(screenings).where(eq(screenings.applicationId, a.id));
          equals(left.length, 0, 'and nothing is written as if it had been booked');
        });
      },
    },

    {
      name: 'the recruiter can type the numbers in, and they reach the candidate record',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          const r = await runIn(tx, 'scr.salarySave', recruiter, {
            v: a.id, fields: { cur: '11,500', exp: '14000', notice: '30' },
          });
          succeeded(r, 'scr.salarySave');
          includes(String((r as { toast?: string }).toast), 'SAR 11,500');

          const [c] = await tx.select().from(candidates).where(eq(candidates.id, a.candidate_id));
          equals(c.currentSalary, 11500);
          equals(c.expectedSalary, 14000);
          equals(c.noticeDays, 30);
          equals(c.currentSalarySource, 'recruiter');
          ok(c.currentSalaryAt, 'and when it was asked');
        });
      },
    },

    {
      name: 'a salary that is obviously annual is refused',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          refused(await runIn(tx, 'scr.salarySave', recruiter, {
            v: a.id, fields: { cur: '540000' },
          }), 'annual');
          refused(await runIn(tx, 'scr.salarySave', recruiter, {
            v: a.id, fields: { cur: '' },
          }), 'current salary');
        });
      },
    },

    {
      name: 'the pay is read off the transcript, and refused when there is no number in it',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));
          const s = (await tx.select().from(screenings)
            .where(eq(screenings.applicationId, a.id)))[0];
          const ctx = ctxOf(tx);
          await beginChat(s.id, ctx);

          await recordAnswer({
            screeningId: s.id, key: 'location', answer: 'I am in Riyadh.',
          }, ctx);
          refused(await runIn(tx, 'scr.capture', recruiter, { v: s.id }),
            'does not give a number');

          await recordAnswer({
            screeningId: s.id, key: 'salary',
            answer: 'I am on SAR 10,250 basic now and looking for about SAR 13,000 all in.',
          }, ctx);
          await recordAnswer({
            screeningId: s.id, key: 'notice', answer: '30 days.',
          }, ctx);

          succeeded(await runIn(tx, 'scr.capture', recruiter, { v: s.id }));
          const after = (await tx.select().from(screenings).where(eq(screenings.id, s.id)))[0];
          equals(after.capturedCurrentSalary, 10250, 'the lower figure is what they are on');
          equals(after.capturedExpectedSalary, 13000, 'the higher one is what they want');
          equals(after.capturedNoticeDays, 30);
          equals(after.capturedSource, 'ai');
          ok(after.capturedQuote, 'with the sentence it came from');

          const [c] = await tx.select().from(candidates).where(eq(candidates.id, a.candidate_id));
          equals(c.currentSalary, 10250, 'and the candidate record follows');
        });
      },
    },

    {
      name: 'inviting twice reuses the screen in flight rather than starting a second',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));
          succeeded(await runIn(tx, 'scr.invite', recruiter, {
            v: a.id, fields: { channel: 'Careers site' },
          }));
          const all = await tx.select().from(screenings)
            .where(eq(screenings.applicationId, a.id));
          equals(all.length, 1, 'one conversation, not two');
          equals(all[0].channel, 'Careers site', 'on the channel last chosen');

          const links = await tx.select().from(accessLinks)
            .where(and(eq(accessLinks.applicationId, a.id), eq(accessLinks.purpose, 'screening')));
          equals(links.length, 2, 'each invitation mints its own link');
          equals(links.filter((l) => !l.revokedAt).length, 1, 'and only the newest still opens');
        });
      },
    },

    {
      name: 'a hiring manager may not screen; a coordinator may',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          refused(await runIn(tx, 'scr.invite', manager, { v: a.id }), 'access');
          succeeded(await runIn(tx, 'scr.invite', coordinator, { v: a.id }));
        });
      },
    },

    {
      name: 'finishing the screen revokes the link and leaves a trail',
      async fn() {
        await inRollback(async (tx) => {
          const a = await liveApp(tx);
          succeeded(await runIn(tx, 'scr.invite', recruiter, { v: a.id }));
          const s = (await tx.select().from(screenings)
            .where(eq(screenings.applicationId, a.id)))[0];
          const ctx = ctxOf(tx);
          await beginChat(s.id, ctx);
          await recordAnswer({
            screeningId: s.id, key: 'location', answer: 'Yes, I am in Riyadh.',
          }, ctx);
          await complete(s.id, ctx);

          const [link] = await tx.select().from(accessLinks)
            .where(eq(accessLinks.applicationId, a.id));
          ok(link.revokedAt, 'the link no longer opens');

          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, s.id));
          ok(trail.length >= 2, 'the invitation and the result are both recorded');

          const events = await tx.select().from(domainEvents)
            .where(eq(domainEvents.subjectId, s.id));
          const types = events.map((e) => e.type);
          ok(types.includes('screening.invited'), 'the invitation is an event');
          ok(types.includes('screening.completed'), 'and so is the result');

          const scored = await tx.select().from(screeningScores)
            .where(eq(screeningScores.screeningId, s.id));
          equals(scored.length, 1, 'one answer, scored once');
        });
      },
    },
  ],
};

export default suite;
