/* ─────────────────────────────────────────────────────────────────────────────
   Logging.

   Structured, levelled, and careful about what it prints. Candidate and
   employee data is sensitive, so a log line carries ids and counts rather than
   names, e-mail addresses or anything from a CV — the audit trail is where the
   record of who did what to whom lives, and it is access-controlled.
   ───────────────────────────────────────────────────────────────────────────*/

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const level = (): Level => (process.env.LOG_LEVEL as Level) ?? 'info';
const json = () => process.env.LOG_FORMAT === 'json';

/* Keys whose value never reaches a log line, whatever a caller passes. */
const SECRET = /pass|secret|token|key|authorization|cookie|iban|national|dob|email|phone/i;

function clean(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = SECRET.test(k) ? '[redacted]' : v;
  }
  return out;
}

function emit(lvl: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[lvl] < ORDER[level()]) return;
  const payload = clean(fields);
  if (json()) {
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), lvl, event, ...payload }) + '\n');
    return;
  }
  const bits = Object.entries(payload).map(([k, v]) =>
    `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  const line = `${lvl.padEnd(5)} ${event}${bits ? '  ' + bits : ''}`;
  if (lvl === 'error') console.error(line);
  else if (lvl === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (e: string, f?: Record<string, unknown>) => emit('debug', e, f),
  info: (e: string, f?: Record<string, unknown>) => emit('info', e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit('warn', e, f),
  error: (e: string, f?: Record<string, unknown>) => emit('error', e, f),
};
