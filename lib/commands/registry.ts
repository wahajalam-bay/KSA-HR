import 'server-only';
import type { z } from 'zod';
import type { Tx } from '@/db/client';
import type { Viewer } from '@/lib/auth/session';
import type { Ctx } from '@/lib/audit';
import type { Capability } from '@/lib/authz';

/* ═════════════════════════════════════════════════════════════════════════════
   THE COMMAND REGISTRY

   Every write in the product is a command: a name, the capability it needs, the
   shape of its input, and a handler that runs inside one transaction with the
   context that knows who is asking. Nothing writes to the database outside one
   of these, which is what makes "every API route checks authorization" a fact
   about the architecture rather than a habit.

   The name is the same string the interface puts in `data-act`, so a button in
   a table, a board card and a sheet all reach the same command — and the
   migration matrix can line each one up against the prototype's action of the
   same name.
   ═════════════════════════════════════════════════════════════════════════════*/

/** What a command hands back to the interface. */
export type CommandResult = {
  /** The line the toast shows. */
  toast?: string;
  tone?: 'ok' | 'bad' | 'warn';
  icon?: string;
  /** How long the toast stays, in ms. */
  ms?: number;
  /** Navigate here afterwards. */
  go?: string;
  /** Close the sheet stack (or the top sheet). */
  closeSheet?: boolean | 'all';
  /**
   * Open this action as a sheet once the command has run. `replace` swaps the
   * panel that is open for the new one instead of stacking a second on top of
   * it — how a panel redraws itself carrying something the command produced,
   * such as the résumé just attached to the form being filled in.
   */
  openSheet?: { act: string; v?: string; replace?: boolean };
  /** Ask the server for fresh data. Defaults to true. */
  refresh?: boolean;
  /** Anything the caller needs back — an id it should navigate to, a count. */
  data?: Record<string, unknown>;
  /**
   * Hand the browser something to save. `url` is a short-lived signed link to
   * a stored file; `text` is content the command produced — an export, or the
   * reading of a CV whose original was never uploaded. Either way the command
   * has already checked who is asking and recorded the access, which is why a
   * download comes back through here rather than from a link on the page.
   */
  download?: { url?: string; text?: string; name: string; contentType?: string };
  /**
   * Ask before doing it. A command that returns this has done nothing: the
   * interface shows the question, and on yes fires the same action again with
   * `confirmed` set. The wording lives here, next to the rule it is about,
   * rather than in whichever button happened to be pressed.
   */
  confirm?: {
    title: string;
    body: string;
    yes: string;
    no?: string;
    danger?: boolean;
  };
};

export type CommandInput = {
  /** `data-v` from the element that fired. */
  v: string;
  /** Everything else the interface collected — form fields, checkbox lists. */
  fields: Record<string, string | string[]>;
  /** Files, for the upload commands. */
  files?: File[];
  /**
   * Whatever the button wrote after the colon in its action — `up` in
   * `jq.move:job_a:up`, `dept` in `onb.f:dept`. It is context the row's own
   * `data-v` cannot carry, and it is a string or nothing: never trusted, always
   * checked against the handful of values the command accepts.
   */
  arg?: string | null;
  /** The current route, so a command can navigate relative to it. */
  route: { view: string; id: string | null; sub: string | null; query: Record<string, string> };
};

export type CommandContext = Ctx & {
  viewer: Viewer;
  tx: Tx;
  /** Now, as one value for the whole command, so two writes cannot disagree. */
  now: Date;
};

export type Command<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** The capability this needs. `null` for the handful that only read. */
  capability: Capability | null;
  /** Validates and shapes the input. */
  schema?: S;
  /** Run outside a transaction — for the few that only talk to a provider. */
  noTransaction?: boolean;
  /** Everything a command does, in one place. */
  run: (
    input: S extends z.ZodTypeAny ? z.infer<S> : CommandInput,
    ctx: CommandContext,
    raw: CommandInput,
  ) => Promise<CommandResult | void>;
};

const registry = new Map<string, Command<any>>();

export function define<S extends z.ZodTypeAny>(name: string, cmd: Command<S>): void {
  if (registry.has(name)) throw new Error(`command "${name}" is defined twice`);
  registry.set(name, cmd);
}

export function defineMany(commands: Record<string, Command<any>>): void {
  for (const [name, cmd] of Object.entries(commands)) define(name, cmd);
}

export function lookup(name: string): Command<any> | undefined {
  return registry.get(name);
}

export function commandNames(): string[] {
  return [...registry.keys()].sort();
}

/** An error a command raises to say "no, and here is why" in the person's words. */
export class CommandError extends Error {
  readonly code: string;
  readonly tone: 'bad' | 'warn';
  constructor(message: string, opts: { code?: string; tone?: 'bad' | 'warn' } = {}) {
    super(message);
    this.code = opts.code ?? 'refused';
    this.tone = opts.tone ?? 'bad';
  }
}

/** Raised when the record moved under the person's feet. */
export class ConflictError extends CommandError {
  constructor(message = 'Somebody changed this a moment ago — reload and try again') {
    super(message, { code: 'conflict', tone: 'warn' });
  }
}
