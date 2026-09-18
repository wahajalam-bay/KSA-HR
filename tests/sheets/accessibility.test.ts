import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rows as rowsOf } from '@/lib/queries/sql';
import { viewer } from '../commands/harness';
import { valueFor } from './fixtures';
import { draw, sheetNames, accessibleName, type Node } from './harness';
import { ok, eq as equals, type Suite } from '../run';

/* ─────────────────────────────────────────────────────────────────────────────
   Whether the panels can be used without a mouse or a pair of eyes.

   Not a substitute for an audit by somebody who does this for a living — see
   docs/10-known-limitations.md — but these are the failures that creep back in
   every time somebody adds a control, and a machine can catch all of them:
   a button nothing announces, an input with no label, a tab order somebody
   has forced, a panel with no name.
   ───────────────────────────────────────────────────────────────────────────*/

const admin = viewer({
  name: 'Naif Allehaidan', staffRole: 'tal_lead', roleLabel: 'Admin', isAdmin: true, staffId: 'stf_01',
});

/** Every panel, drawn once, so each assertion walks the same set. */
type Panel = { name: string; elements: Node[]; spec: { title: unknown; aria?: string } };
let panels: Panel[] | null = null;
async function allPanels(): Promise<Panel[]> {
  if (panels) return panels;
  const out: Panel[] = [];
  for (const name of sheetNames()) {
    const { spec, drawn } = await draw(name, await valueFor(name), admin);
    if (!spec) continue;
    out.push({ name, elements: drawn.elements, spec });
  }
  panels = out;
  return out;
}

const INTERACTIVE = new Set(['button', 'a', 'select', 'textarea']);

/* `aria-hidden` is an attribute, so React carries it as the string "true" as
   often as the boolean. Both mean the same thing to a screen reader. */
const hidden = (el: Node) =>
  el.props['aria-hidden'] === true || el.props['aria-hidden'] === 'true';

const suite: Suite = {
  name: 'sheets · reachable without a mouse',
  tests: [
    {
      name: 'every panel announces what it is',
      async fn() {
        const bad: string[] = [];
        for (const p of await allPanels()) {
          const named = p.spec.aria || (typeof p.spec.title === 'string' && p.spec.title.trim());
          if (!named) bad.push(p.name);
        }
        equals(bad.join(', '), '', 'every sheet has a title or an aria name');
      },
    },

    {
      name: 'every control says what it does',
      async fn() {
        const bad: string[] = [];
        for (const p of await allPanels()) {
          for (const el of p.elements) {
            if (!INTERACTIVE.has(el.tag)) continue;
            /* A select is named by its label, which is asserted separately. */
            if (el.tag === 'select' || el.tag === 'textarea') continue;
            if (hidden(el)) continue;
            if (!accessibleName(el)) {
              bad.push(`${p.name}: <${el.tag} ${JSON.stringify(el.props['data-act'] ?? '')}>`);
            }
          }
        }
        equals(bad.slice(0, 12).join('\n'), '', 'no unlabelled buttons or links');
      },
    },

    {
      name: 'every field is labelled, and the label points at it',
      async fn() {
        const bad: string[] = [];
        for (const p of await allPanels()) {
          const labelled = new Set(
            p.elements.filter((e) => e.tag === 'label' && typeof e.props.htmlFor === 'string')
              .map((e) => e.props.htmlFor as string),
          );
          for (const el of p.elements) {
            if (el.tag !== 'input' && el.tag !== 'select' && el.tag !== 'textarea') continue;
            const type = String(el.props.type ?? 'text');
            if (type === 'hidden' || el.props.hidden) continue;
            const id = el.props.id;
            if (typeof id === 'string' && labelled.has(id)) continue;
            if (accessibleName(el)) continue;
            /* A control wrapped in its own <label> is named by it — which is
               how the tick-chips, the rating radios and the upload well are
               written, and is as good as a `for`. */
            if (el.inLabel) continue;
            bad.push(`${p.name}: <${el.tag} type=${type} name=${String(el.props.name ?? '?')}>`);
          }
        }
        equals(bad.slice(0, 12).join('\n'), '', 'every visible field is labelled');
      },
    },

    {
      name: 'nobody has forced the tab order',
      async fn() {
        const bad: string[] = [];
        for (const p of await allPanels()) {
          for (const el of p.elements) {
            const t = el.props.tabIndex;
            if (typeof t === 'number' && t > 0) bad.push(`${p.name}: <${el.tag} tabIndex=${t}>`);
          }
        }
        equals(bad.join('\n'), '',
          'a positive tabIndex takes an element out of the document order for everybody');
      },
    },

    {
      name: 'anything decorative is hidden from a screen reader',
      async fn() {
        const bad: string[] = [];
        for (const p of await allPanels()) {
          for (const el of p.elements) {
            if (el.tag !== 'svg') continue;
            if (hidden(el)) continue;
            if (accessibleName(el)) continue;
            bad.push(`${p.name}: an icon that is neither hidden nor named`);
          }
        }
        equals(bad.slice(0, 8).join('\n'), '', 'every icon is hidden or named');
      },
    },

    {
      name: 'an image carries alternative text',
      async fn() {
        const bad: string[] = [];
        for (const p of await allPanels()) {
          for (const el of p.elements) {
            if (el.tag !== 'img') continue;
            if (typeof el.props.alt !== 'string') bad.push(`${p.name}: <img> with no alt`);
          }
        }
        equals(bad.join('\n'), '', 'every image has an alt, even an empty one');
      },
    },

    {
      name: 'a control that is not a button behaves like one',
      async fn() {
        /* A div that fires an action is a button to a mouse and nothing to a
           keyboard unless it says so. The list row is the one place the product
           does this, because a button cannot contain a button. */
        const bad: string[] = [];
        for (const p of await allPanels()) {
          for (const el of p.elements) {
            if (INTERACTIVE.has(el.tag)) continue;
            if (!el.props['data-act']) continue;
            if (el.tag === 'input' || el.tag === 'label') continue;
            const role = el.props.role;
            const tab = el.props.tabIndex;
            if (role === 'button' && tab === 0) continue;
            if (role === 'switch' && (tab === 0 || tab === -1)) continue;
            bad.push(`${p.name}: <${el.tag} data-act="${String(el.props['data-act'])}"> `
              + `role=${String(role)} tabIndex=${String(tab)}`);
          }
        }
        equals(bad.slice(0, 10).join('\n'), '',
          'anything that acts is either a real control or says it is one');
      },
    },

    {
      name: 'the panels that ask a question mark what is required',
      async fn() {
        /* Every form sheet in the product has at least one required field, and
           the label carries the asterisk the product uses to say so. */
        const forms = (await allPanels()).filter((p) =>
          p.elements.some((e) => e.tag === 'input' && String(e.props.type ?? 'text') !== 'hidden'));
        ok(forms.length > 20, `${forms.length} panels collect input`);

        const marked = forms.filter((p) =>
          p.elements.some((e) => e.tag === 'label' && e.text.includes('*')));
        ok(marked.length > 10,
          `${marked.length} of ${forms.length} mark their required fields`);
      },
    },
  ],
};

export default suite;
