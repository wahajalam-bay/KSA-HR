import { loadEnvFiles } from '../db/env-files';
loadEnvFiles();

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { messages, jobQueue, screenings, candidates, jobs, applications } from '@/db/schema';
import { rows as rowsOf } from '@/lib/queries/sql';
import { env } from '@/lib/env';
import { channelAdapter, voiceAdapter, allStatuses } from '@/lib/providers';
import { dispatchPending, retryable, retryRun } from '@/lib/services/automation';
import { runDailySweeps, runWeeklySweeps } from '@/lib/services/sweeps';
import { questionsFor } from '@/lib/services/screening';
import { rescan, unscanned } from '@/lib/services/files';
import type { Ctx } from '@/lib/audit';

/* ═════════════════════════════════════════════════════════════════════════════
   THE WORKER

   One process, one loop, five jobs:

     · drain the outbox — every queued message goes to its provider, and what
       the provider said is written back on the row;
     · place the phone screens that are due;
     · dispatch the events the automation rules are waiting for, and retry the
       runs that failed;
     · run the sweeps once a day and once a week;
     · re-scan the files that arrived while no scanner was configured.

   Everything it does is idempotent. It can be killed at any moment, started
   twice by accident, or run behind a provider that times out, and the worst
   case is that a message is queued a second time and the provider's own
   idempotency key collapses it.

     npm run worker            run it
     npm run worker -- --once  one pass, for a cron or a test
   ═════════════════════════════════════════════════════════════════════════════*/

const WORKER_ID = `wkr_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

/** The worker acts as itself. Everything it writes says so. */
function ctxOf(now: Date): Ctx & { tx: Tx; now: Date } {
  return {
    viewer: {
      accountId: 'system',
      sessionId: 'worker',
      name: 'System',
      email: null,
      title: null,
      role: 'staff',
      staffRole: null,
      staffId: null,
      roleLabel: 'System',
      hue: 1,
      photo: null,
      scope: { kind: 'all', jobIds: [], own: true },
      isPortal: false,
      isAdmin: true,
    } as never,
    requestId: WORKER_ID,
    correlationId: WORKER_ID,
    tx: null as never,
    now,
  };
}

const log = (...parts: unknown[]) => {
  if (env().LOG_FORMAT === 'json') {
    console.log(JSON.stringify({ at: new Date().toISOString(), worker: WORKER_ID, message: parts.join(' ') }));
  } else {
    console.log(`  ${parts.join(' ')}`);
  }
};

/* ── The outbox ──────────────────────────────────────────────────────────── */

async function drainOutbox(now: Date, batch: number): Promise<number> {
  /* Claim a batch first, so two workers never send the same message. */
  const claimed = await db().transaction(async (tx) => rowsOf(await tx.execute(sql`
    UPDATE ${messages} SET status = 'sending', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM ${messages}
        WHERE status = 'queued' AND direction = 'out' AND internal = false
        ORDER BY queued_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)
     RETURNING id, channel::text AS channel, to_address, to_name, subject, body,
               idempotency_key, attempts`)) as Array<{
                 id: string; channel: string; to_address: string | null; to_name: string | null;
                 subject: string | null; body: string; idempotency_key: string | null;
                 attempts: number;
               }>);

  let sent = 0;
  for (const m of claimed) {
    const adapter = channelAdapter(m.channel);
    if (!adapter) {
      await mark(m.id, 'failed', 'that channel has no adapter', now);
      continue;
    }
    if (!m.to_address) {
      await mark(m.id, 'failed', 'there is no address to send it to', now);
      continue;
    }

    const r = await adapter.send({
      to: m.to_address,
      toName: m.to_name,
      subject: m.subject,
      body: m.body,
      idempotencyKey: m.idempotency_key ?? m.id,
    });

    if (r.ok) {
      await db().execute(sql`
        UPDATE ${messages}
           SET status = 'sent', sent_at = ${now}, provider_message_id = ${r.externalId},
               status_detail = null
         WHERE id = ${m.id}`);
      sent += 1;
    } else if (r.reason === 'not_configured') {
      await mark(m.id, 'not_configured', r.message, now);
    } else if (r.retryable && m.attempts < env().WORKER_MAX_ATTEMPTS) {
      /* Back on the queue, with a wait that grows. */
      await db().execute(sql`
        UPDATE ${messages}
           SET status = 'queued', status_detail = ${r.message},
               queued_at = ${new Date(now.getTime() + backoff(m.attempts))}
         WHERE id = ${m.id}`);
    } else {
      await mark(m.id, 'failed', r.message, now);
    }
  }
  return sent;
}

const backoff = (attempt: number) =>
  Math.min(30 * 60_000, 2 ** attempt * 30_000);

async function mark(id: string, status: string, detail: string, now: Date): Promise<void> {
  await db().execute(sql`
    UPDATE ${messages}
       SET status = ${status}::comm_status, status_detail = ${detail},
           failed_at = CASE WHEN ${status} = 'failed' THEN ${now} ELSE failed_at END
     WHERE id = ${id}`);
}

/* ── The phone screens that are due ──────────────────────────────────────── */

async function placeCalls(now: Date, batch: number): Promise<number> {
  const voice = voiceAdapter();
  if (!voice.status().configured) return 0;

  const due = await db().transaction(async (tx) => rowsOf(await tx.execute(sql`
    UPDATE ${screenings}
       SET status = 'calling', call_attempts = call_attempts + 1, call_started_at = ${now}
     WHERE id IN (
       SELECT id FROM ${screenings}
        WHERE channel = 'AI phone' AND status = 'scheduled'
          AND call_next_attempt_at IS NOT NULL AND call_next_attempt_at <= ${now}
        ORDER BY call_next_attempt_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)
     RETURNING id, application_id, job_id, call_phone, call_language,
               call_voice, call_attempts`)) as Array<{
    id: string; application_id: string; job_id: string; call_phone: string | null;
    call_language: string | null; call_voice: string | null; call_attempts: number;
  }>);

  let placed = 0;
  for (const s of due) {
    if (!s.call_phone) {
      await db().execute(sql`
        UPDATE ${screenings} SET status = 'cancelled', call_outcome = 'failed'
         WHERE id = ${s.id}`);
      continue;
    }
    const { questions } = await questionsFor(s.job_id, db());
    const r = await voice.place({
      to: s.call_phone,
      language: (s.call_language === 'en' ? 'en' : 'ar'),
      voice: s.call_voice ?? 'Noor',
      script: questions.map((q) => ({ key: q.key, question: q.question })),
      recordingNotice: 'This call is recorded for the hiring team. Is that all right?',
      idempotencyKey: `screening:${s.id}:${s.call_attempts}`,
      webhookUrl: `${env().APP_URL}/api/webhooks/voice`,
    });

    if (r.ok) {
      await db().execute(sql`
        UPDATE ${screenings}
           SET call_provider_ref = ${r.detail?.callId ?? null},
               call_outcome = 'in_progress', call_next_attempt_at = null
         WHERE id = ${s.id}`);
      placed += 1;
    } else {
      /* No answer gets one more try in two hours; anything else stops. */
      const again = r.reason === 'failed' && r.retryable && s.call_attempts < 2;
      await db().execute(sql`
        UPDATE ${screenings}
           SET status = ${again ? 'scheduled' : 'no_answer'}::screening_status,
               call_outcome = ${again ? 'scheduled' : 'no_answer'}::call_outcome,
               call_next_attempt_at = ${again ? new Date(now.getTime() + 2 * 3600_000) : null}
         WHERE id = ${s.id}`);
    }
  }
  return placed;
}

/* ── One pass ────────────────────────────────────────────────────────────── */

export type PassResult = {
  sent: number;
  calls: number;
  events: number;
  automations: number;
  retried: number;
  rescanned: number;
};

export async function pass(now = new Date()): Promise<PassResult> {
  const e = env();
  const sent = await drainOutbox(now, e.WORKER_BATCH);
  const calls = await placeCalls(now, e.WORKER_BATCH);

  const { events, automations } = await db().transaction(async (tx) => {
    const ctx = { ...ctxOf(now), tx };
    const d = await dispatchPending(ctx, e.WORKER_BATCH);
    return { events: d.events, automations: d.runs.filter((r) => r.state === 'succeeded').length };
  });

  const retried = await db().transaction(async (tx) => {
    const ctx = { ...ctxOf(now), tx };
    const failed = await retryable(ctx, 10);
    let n = 0;
    for (const run of failed) {
      const out = await retryRun(run.id, ctx);
      if (out?.state === 'succeeded') n += 1;
    }
    return n;
  });

  /* Files that arrived while nothing was scanning them. */
  let rescanned = 0;
  const scanner = allStatuses().find((s) => s.key === 'malware');
  if (scanner?.configured) {
    const waiting = await unscanned(db(), 20);
    for (const f of waiting) {
      await db().transaction(async (tx) => {
        await rescan(f.id, { ...ctxOf(now), tx });
      });
      rescanned += 1;
    }
  }

  return { sent, calls, events, automations, retried, rescanned };
}

/* ── The schedule ────────────────────────────────────────────────────────── */

let lastDaily = '';
let lastWeekly = '';

async function schedule(now: Date): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  /* Six in the morning, Riyadh. */
  const riyadhHour = (now.getUTCHours() + 3) % 24;

  if (today !== lastDaily && riyadhHour >= 6) {
    lastDaily = today;
    const summary = await db().transaction(async (tx) => runDailySweeps({ ...ctxOf(now), tx }));
    log(`daily sweeps — ${summary.sla} past SLA, ${summary.probation} probation, `
      + `${summary.scorecards} scorecards outstanding, ${summary.filesDeleted} files deleted`);
  }

  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const week = monday.toISOString().slice(0, 10);
  if (week !== lastWeekly && now.getUTCDay() === 1 && riyadhHour >= 7) {
    lastWeekly = week;
    await db().transaction(async (tx) => runWeeklySweeps({ ...ctxOf(now), tx }));
    log('weekly digest raised');
  }
}

/* ── The loop ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const e = env();
  const once = process.argv.includes('--once');

  if (!e.WORKER_ENABLED && !once) {
    log('WORKER_ENABLED is false — nothing to do');
    return;
  }

  log(`started (${WORKER_ID})`);
  for (const s of allStatuses()) {
    log(`  ${s.key.padEnd(11)} ${s.configured ? s.provider : `not configured (${s.missing.join(', ')})`}`);
  }

  let running = true;
  const stop = () => { running = false; log('stopping'); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  do {
    const now = new Date();
    try {
      const r = await pass(now);
      const did = r.sent + r.calls + r.events + r.retried + r.rescanned;
      if (did) {
        log(`${r.sent} sent, ${r.calls} calls, ${r.events} events `
          + `(${r.automations} rules ran), ${r.retried} retried, ${r.rescanned} rescanned`);
      }
      await schedule(now);
    } catch (err: unknown) {
      log(`pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (once || !running) break;
    await new Promise((r) => setTimeout(r, e.WORKER_POLL_MS));
  } while (running);

  log('stopped');
  process.exit(0);
}

if (process.argv[1]?.includes('workers')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
