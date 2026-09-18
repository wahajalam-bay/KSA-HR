import { sql, eq } from 'drizzle-orm';
import { messages, auditEvents } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { providers } from '@/lib/env';
import { queueMessage } from '@/lib/services/messaging';
import { setUpCall } from '@/lib/services/screening';
import { invite as inviteAssessment } from '@/lib/services/assessments';
import { inRollback, runIn, viewer } from '../commands/harness';
import { ok, eq as equals, refused, succeeded, includes, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   What the product does when there is nothing on the other end.

   Every integration in this platform can be absent, and most of them are on
   most days of a deployment's life. The rule the whole design rests on is that
   the product never reports success it did not have — because a recruiter who
   believes a message went out stops chasing the candidate, and that costs a
   hire.

   These tests run against whatever this environment actually has configured.
   Where a provider is present they assert the honest success; where it is
   absent they assert the honest refusal. Both are correct outcomes; claiming
   the first while doing the second is the failure.
   ───────────────────────────────────────────────────────────────────────────*/

const recruiter = viewer({
  name: 'Abdulaziz Alsaloum', staffRole: 'recruiter', staffId: 'stf_02',
});
const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});

const ctx = (tx: Parameters<typeof runIn>[0]) => ({
  tx, now: new Date(), viewer: recruiter, requestId: 'test',
} as Parameters<typeof queueMessage>[1]);

async function liveApplication(tx: Parameters<typeof runIn>[0]) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT a.id, a.candidate_id, a.job_id, c.name, c.phone, c.email
      FROM applications a JOIN candidates c ON c.id = a.candidate_id
     WHERE a.status = 'active' AND c.phone IS NOT NULL AND c.email IS NOT NULL
     ORDER BY a.applied_at DESC LIMIT 1`));
  return row as {
    id: string; candidate_id: string; job_id: string;
    name: string; phone: string; email: string;
  };
}

const suite: Suite = {
  name: 'write · integrations, present and absent',
  tests: [
    {
      name: 'every provider reports a state, and names what it is missing',
      async fn() {
        const p = providers() as Record<string,
          { configured: boolean; provider: string; missing: string[] }>;
        const keys = Object.keys(p);
        ok(keys.length >= 10, `${keys.length} integrations are declared`);

        const bad: string[] = [];
        for (const [name, s] of Object.entries(p)) {
          if (typeof s.configured !== 'boolean') bad.push(`${name}: no verdict`);
          if (!s.provider) bad.push(`${name}: no provider named`);
          /* The whole point: a provider that is not configured says which
             settings would configure it. "Not configured" with no reason is
             the same as silence. */
          if (!s.configured && !s.missing.length) bad.push(`${name}: absent, with nothing named`);
          if (s.configured && s.missing.length) bad.push(`${name}: configured, yet missing ${s.missing.join(', ')}`);
        }
        equals(bad.join('\n'), '', 'every integration reports honestly');
      },
    },

    {
      name: 'a message is queued when it can go, and marked not_configured when it cannot',
      async fn() {
        await inRollback(async (tx) => {
          const app = await liveApplication(tx);
          const email = providers().email;

          const q = await queueMessage({
            channel: 'Email',
            subject: 'A test of the outbox',
            body: 'Nothing here leaves the building unless a provider is set up.',
            toName: app.name,
            toAddress: app.email,
            applicationId: app.id,
            candidateId: app.candidate_id,
            jobId: app.job_id,
          }, ctx(tx));

          ok(q.messageId, 'the message is on the record either way');
          const [row] = await tx.select().from(messages).where(eq(messages.id, q.messageId!));

          if (email.configured) {
            equals(q.status, 'queued');
            equals(row.status, 'queued', 'the row agrees with the result');
            equals(q.reason, null, 'and there is nothing to explain');
          } else {
            equals(q.status, 'not_configured');
            equals(row.status, 'not_configured', 'the row agrees with the result');
            ok(q.reason, 'it says why it cannot go');
            includes(q.reason!, 'Settings → Integrations', 'and where to fix it');
            for (const m of email.missing) {
              includes(q.reason!, m, 'naming each setting that is absent');
            }
            /* The one thing that must never happen. */
            ok(row.sentAt == null, 'nothing claims to have been sent');
            ok(row.providerMessageId == null, 'and there is no receipt for it');
          }
        });
      },
    },

    {
      name: 'a message is never recorded as sent by the act of queueing it',
      async fn() {
        await inRollback(async (tx) => {
          const app = await liveApplication(tx);
          for (const channel of ['Email', 'WhatsApp', 'SMS'] as const) {
            const q = await queueMessage({
              channel,
              body: 'Queued, not sent.',
              toName: app.name,
              toAddress: channel === 'Email' ? app.email : app.phone,
              applicationId: app.id,
              candidateId: app.candidate_id,
            }, ctx(tx));
            const [row] = await tx.select().from(messages).where(eq(messages.id, q.messageId!));
            ok(['queued', 'not_configured'].includes(row.status),
              `${channel} is ${row.status}, which is one of the two honest answers`);
            ok(row.sentAt == null, `${channel}: nothing is marked sent before the worker runs`);
          }
        });
      },
    },

    {
      name: 'the phone screen is refused outright without telephony — not scheduled',
      async fn() {
        await inRollback(async (tx) => {
          const app = await liveApplication(tx);
          const voice = providers().voice;

          if (voice.configured) {
            const r = await setUpCall({ applicationId: app.id, when: 'now' }, ctx(tx));
            ok(r.screeningId, 'with a provider, the call is set up');
            return;
          }

          let refusal = '';
          try {
            await setUpCall({ applicationId: app.id, when: 'now' }, ctx(tx));
          } catch (e) {
            refusal = e instanceof Error ? e.message : String(e);
          }
          ok(refusal, 'without one it is refused rather than scheduled');
          includes(refusal, 'Settings → Integrations', 'and says where to turn it on');
          includes(refusal, 'chat screening', 'and offers the thing that does work');

          const left = rowsOf(await tx.execute(sql`
            SELECT id FROM screenings WHERE application_id = ${app.id}
              AND channel = 'AI phone'`));
          equals(left.length, 0, 'and nothing was written that would look like a booking');
        });
      },
    },

    {
      name: 'an assessment invitation says plainly when nothing was sent',
      async fn() {
        await inRollback(async (tx) => {
          const [app] = rowsOf(await tx.execute(sql`
            SELECT a.id FROM applications a
             WHERE a.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.application_id = a.id)
             LIMIT 1`)) as Array<{ id: string }>;
          const p = providers().assessment;

          if (p.configured) {
            const r = await inviteAssessment(app.id, ctx(tx));
            ok(r.sent, 'with a provider it goes');
            const [asm] = rowsOf(await tx.execute(sql`
              SELECT status::text AS status FROM assessments WHERE application_id = ${app.id}`));
            equals(String(asm.status), 'invited');
            return;
          }

          /* Without a provider it refuses and writes nothing. Recording an
             invitation nobody received would be worse than refusing: the final
             interview is gated on the result, so the candidate would wait on
             something that was never coming. */
          let refusal = '';
          try {
            await inviteAssessment(app.id, ctx(tx));
          } catch (e) {
            refusal = e instanceof Error ? e.message : String(e);
          }
          ok(refusal, 'it is refused rather than half-done');
          includes(refusal, 'Settings → Integrations', 'and says where to turn it on');
          const left = rowsOf(await tx.execute(sql`
            SELECT id FROM assessments WHERE application_id = ${app.id}`));
          equals(left.length, 0, 'and nothing is left looking like an invitation');
        });
      },
    },

    {
      name: 'an uploaded file is never called clean by a scanner that is not there',
      async fn() {
        const p = providers().malware;
        /* The files suite proves the state machine; this proves the claim the
           product makes about it, from the configured state outward. */
        if (p.configured) {
          ok(p.provider !== 'none', 'a scanner is named');
          return;
        }
        includes(p.missing.join(','), 'MALWARE_SCANNER',
          'the setting that would turn scanning on is named');
      },
    },

    {
      name: 'what the interface is told matches what the outbox holds',
      async fn() {
        await inRollback(async (tx) => {
          const [app] = rowsOf(await tx.execute(sql`
            SELECT a.id FROM applications a JOIN candidates c ON c.id = a.candidate_id
             WHERE a.status = 'active' AND c.email IS NOT NULL LIMIT 1`)) as Array<{ id: string }>;

          const r = await runIn(tx, 'app.emailSend', recruiter, {
            v: String(app.id),
            fields: { to: 'x@example.com', subject: 'Parity of claim', body: 'One line.' },
          });
          succeeded(r, 'app.emailSend');
          const toast = String((r as { toast?: string }).toast ?? '');

          const [row] = rowsOf(await tx.execute(sql`
            SELECT status::text AS status FROM messages
             WHERE application_id = ${String(app.id)} ORDER BY queued_at DESC LIMIT 1`));

          if (String(row.status) === 'queued') {
            includes(toast, 'queued', 'a queued message is described as queued');
          } else {
            equals(String(row.status), 'not_configured');
            includes(toast.toLowerCase(), 'not configured',
              'an unconfigured channel says so where the recruiter can see it');
          }
          ok(!/\bsent\b/i.test(toast) || String(row.status) === 'queued',
            'nothing says "sent" about a message the outbox has not sent');
        });
      },
    },

    {
      name: 'the state of an integration is on the record when it changes something',
      async fn() {
        await inRollback(async (tx) => {
          const app = await liveApplication(tx);
          await runIn(tx, 'app.emailSend', admin, {
            v: app.id,
            fields: { to: app.email, subject: 'For the trail', body: 'One line.' },
          });
          const trail = await tx.select().from(auditEvents)
            .where(eq(auditEvents.entityId, app.id));
          const wrote = trail.filter((t) => t.summary.includes('wrote to'));
          ok(wrote.length >= 1, 'writing to a candidate is on the trail');
          const after = wrote[wrote.length - 1].after as { status?: string } | null;
          ok(after?.status && ['queued', 'not_configured'].includes(after.status),
            `the trail records which of the two happened (${after?.status})`);
        });
      },
    },
  ],
};

export default suite;
