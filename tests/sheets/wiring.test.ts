import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import { classify, NAV_ACTIONS, SHEET_ACTIONS, LOCAL_ACTIONS } from '@/lib/nav';
import { commandNames, lookup } from '@/lib/commands/registry';
import { CAPABILITIES } from '@/lib/authz';
import { viewer } from '../commands/harness';
import { draw, sheetNames, type Node } from './harness';
import { valueFor } from './fixtures';
import { ok, eq as equals, type Suite } from '../run';
import '@/lib/commands';

/* ─────────────────────────────────────────────────────────────────────────────
   Whether every button in the product is wired to something.

   The interface is one delegated listener over `data-act`. That is what makes
   adding a control cheap, and it is also what makes a typo silent: a button
   with an action nobody registered does nothing at all, and nothing anywhere
   says so. There is no compiler for the string in the middle.

   So this is the compiler. It draws every panel, collects every action on
   every control in it, and asserts that each one resolves — to a command in
   the registry, a sheet in the registry, a route, or the short list the client
   handles itself.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});

type Wired = { panel: string; act: string; tag: string };

let wiring: Wired[] | null = null;
async function allActions(): Promise<Wired[]> {
  if (wiring) return wiring;
  const out: Wired[] = [];
  for (const name of sheetNames()) {
    const { spec, drawn } = await draw(name, await valueFor(name), admin);
    if (!spec) continue;
    for (const el of drawn.elements) {
      const act = el.props['data-act'];
      if (typeof act !== 'string' || !act) continue;
      out.push({ panel: name, act, tag: el.tag });
    }
  }
  wiring = out;
  return out;
}

/* A few actions are handled by the sheet's own client behaviour rather than by
   the registry: the blocks that re-render themselves as the form is filled in.
   Each is listed here so that adding one is a decision rather than a typo. */
const CLIENT_ONLY = new Set([
  'hm.dept',       // the department picker refills the hiring-manager list
  'hm.pick',       // and reveals the free-text box for somebody not on it
  'job.budget',    // an unbudgeted requisition reveals its justification
  'job.pipeline',  // picking a template refills the workflow block
  'job.srcToggle', // ticking a route updates the line underneath it
  'job.wfToggle',  // ticking a stage shows the pitch settings, and the preview
  'job.wfTemplate',// putting the template's stages back
  'sk.barAdd', 'sk.barDrop', 'sk.barChange',   // the skill bar's own rows
  'prob.pick',     // "not confirmed" reveals the reason
  'otpl.scope',    // the template's scope select posts on change
  'acc.scopeKind', // the scope select shows the "and their own" question
  'tm.onJoining', 'tm.onFile',
]);

const suite: Suite = {
  name: 'sheets · every button is wired to something',
  tests: [
    {
      name: 'every action on every panel resolves',
      async fn() {
        const commands = new Set(commandNames());
        const sheets = new Set(sheetNames());
        const dangling: string[] = [];

        for (const w of await allActions()) {
          /* An action may carry an argument after a colon — `jq.save:job_x` in
             the prototype's shape — and the name is what has to resolve. */
          const name = w.act.split(':')[0];
          if (commands.has(name) || sheets.has(name)) continue;
          if (LOCAL_ACTIONS.has(name) || NAV_ACTIONS[name]) continue;
          if (CLIENT_ONLY.has(name)) continue;
          if (name === 'go') continue;   // the router, with a path in the value
          dangling.push(`${w.panel}: <${w.tag} data-act="${w.act}">`);
        }
        equals([...new Set(dangling)].sort().join('\n'), '',
          'a button with an action nobody registered does nothing, silently');
      },
    },

    {
      name: 'every command the panels fire is reachable and guarded',
      async fn() {
        const fired = new Set(
          (await allActions()).map((w) => w.act.split(':')[0]).filter((n) => !!lookup(n)),
        );
        ok(fired.size > 45, `${fired.size} commands are reachable from a panel`);

        /* Four commands are about the person asking rather than about what they
           may do: signing out, opening your own notification, marking them
           read, and — Admin-only, checked inside the command — looking at the
           product as a colleague. Every other command names a capability, and
           this list is here so that a fifth is a decision rather than an
           omission nobody noticed. */
        const NO_CAPABILITY = new Set(['auth.signout', 'notif.go', 'notif.readall', 'me.set']);

        const bad: string[] = [];
        for (const name of fired) {
          const cmd = lookup(name) as { capability?: string | null; schema?: unknown } | undefined;
          if (!cmd?.capability) {
            if (!NO_CAPABILITY.has(name)) {
              bad.push(`${name}: no capability, and not one of the four that need none`);
            }
            continue;
          }
          if (!(CAPABILITIES as readonly string[]).includes(cmd.capability)) {
            bad.push(`${name}: ${cmd.capability} is not a capability`);
          }
          if (!cmd.schema) bad.push(`${name}: no schema`);
        }
        equals(bad.join('\n'), '', 'every command names a real capability and parses its input');

        /* The one of those four that grants a different view of the product
           guards itself, because no capability check stands in front of it. */
        const me = lookup('me.set');
        ok(me && String((me as { run: unknown }).run).includes('isAdmin'),
          'switching persona is an Admin’s, checked inside the command');
      },
    },

    {
      name: 'every sheet the panels open exists',
      async fn() {
        const sheets = new Set(sheetNames());
        const bad: string[] = [];
        for (const w of await allActions()) {
          const name = w.act.split(':')[0];
          if (!SHEET_ACTIONS.has(name)) continue;
          if (!sheets.has(name)) bad.push(`${w.panel} opens ${name}, which is not defined`);
        }
        equals([...new Set(bad)].join('\n'), '', 'no panel opens a panel that does not exist');
      },
    },

    {
      name: 'every action written into a page resolves as well',
      async fn() {
        /* A page cannot be drawn here — it reads the session cookie — but the
           action strings in it are literals, and a literal can be read off
           disk. The visual sweep drives the pages for real; this catches the
           typo the sweep would photograph without complaining about.

           Three forms, because all three are used:

             action="x.y"                a plain one;
             action={`x.y:${id}`}        the base is still a literal, and the
                                         colon carries the row's context;
             action={cond ? 'x.y' : ''}  one that is only live sometimes;

           and `data-dz`, which is the same thing for a file well — it posts
           to the command dispatcher exactly as a button does, so an unwired
           dropzone is an upload that silently fails.

           The earlier version of this test read only the first form, which is
           why thirty-seven buttons and four upload wells could sit in the
           codebase pointing at nothing. */
        const fs = await import('node:fs');
        const path = await import('node:path');

        const files: string[] = [];
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.tsx?$/.test(e.name)) files.push(p);
          }
        };
        for (const root of ['components', 'app', 'lib/sheets']) {
          const dir = path.join(process.cwd(), root);
          if (fs.existsSync(dir)) walk(dir);
        }
        ok(files.length > 40, `${files.length} files to read`);

        const commands = new Set(commandNames());
        const sheets = new Set(sheetNames());
        const dangling = new Set<string>();

        const PATTERNS = [
          /(?:action|data-act|data-dz)=\{?[`"']([a-z][\w.]*)/g,
          /\bact:\s*['"`]([a-z][\w.]*)/g,
          /(?:action|data-act|data-dz)=\{[^}]*\?[^}]*['"`]([a-z][\w.]*\.[\w.]*)['"`]/g,
        ];

        for (const file of files) {
          const src = fs.readFileSync(file, 'utf8');
          const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
          for (const re of PATTERNS) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) {
              const name = m[1].split(':')[0];
              if (commands.has(name) || sheets.has(name)) continue;
              if (LOCAL_ACTIONS.has(name) || NAV_ACTIONS[name]) continue;
              if (CLIENT_ONLY.has(name)) continue;
              if (name === 'go') continue;
              dangling.add(`${rel}: ${name}`);
            }
          }
        }
        equals([...dangling].sort().join('\n'), '',
          'every action written into a page or a component resolves');
      },
    },

    {
      name: 'an upload well posts to a command that reads its files',
      async fn() {
        /* A dropzone is not a button: what it sends is a multipart body, and a
           command that ignores `raw.files` would take the file, do nothing
           with it, and say it had worked. */
        const fs = await import('node:fs');
        const path = await import('node:path');

        const wells = new Set<string>();
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!/\.tsx?$/.test(e.name)) continue;
            const src = fs.readFileSync(p, 'utf8');
            for (const m of src.matchAll(/(?:data-dz|<Dropzone[^>]*?action)=\{?[`"']([a-z][\w.]*)/g)) {
              wells.add(m[1].split(':')[0]);
            }
          }
        };
        for (const root of ['components', 'app', 'lib/sheets']) {
          const dir = path.join(process.cwd(), root);
          if (fs.existsSync(dir)) walk(dir);
        }
        ok(wells.size >= 4, `${wells.size} upload wells in the product`);

        const bad: string[] = [];
        for (const name of wells) {
          const cmd = lookup(name);
          if (!cmd) { bad.push(`${name}: no command behind the well`); continue; }
          const src = String((cmd as { run: unknown }).run);
          if (!/files/.test(src)) bad.push(`${name}: the command never looks at the files`);
        }
        equals(bad.join('\n'), '', 'every upload well reaches a command that reads the bytes');
      },
    },

    {
      name: 'the classifier and the registries agree',
      async fn() {
        const bad: string[] = [];
        for (const name of SHEET_ACTIONS) {
          if (classify(name.split(':')[0]) !== 'sheet' && !NAV_ACTIONS[name.split(':')[0]]) {
            bad.push(`${name} is in SHEET_ACTIONS but does not classify as a sheet`);
          }
        }
        for (const name of commandNames()) {
          if (SHEET_ACTIONS.has(name)) {
            /* A name that is both is ambiguous: the interface would open a
               panel where the author meant to run the command. */
            bad.push(`${name} is both a command and a sheet`);
          }
        }
        equals(bad.join('\n'), '', 'a name means one thing');
      },
    },

    {
      name: 'a destructive command asks before it acts',
      async fn() {
        /* Every one of these does something a person cannot undo from the
           interface, so each returns a question first and does nothing until
           it is answered. The write suites prove the behaviour; this proves
           nobody has added a seventh without the question. */
        const DESTRUCTIVE = [
          'ivw.cancel', 'dept.remove', 'pos.remove', 'acc.remove', 'qb.remove',
          'staff.deactivate',
        ];
        const bad: string[] = [];
        for (const name of DESTRUCTIVE) {
          const cmd = lookup(name);
          if (!cmd) { bad.push(`${name} is gone`); continue; }
          const src = String((cmd as { run: unknown }).run);
          if (!src.includes('confirm')) bad.push(`${name} no longer asks`);
        }
        equals(bad.join('\n'), '', 'the destructive commands still ask first');
      },
    },
  ],
};

export default suite;
