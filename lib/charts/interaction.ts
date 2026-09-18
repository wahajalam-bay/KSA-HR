/* ═════════════════════════════════════════════════════════════════════════════
   THE CHART INTERACTION CONTRACT

   One description of what a chart mark is, so that forty charts across the
   product behave the same way rather than each inventing its own handlers.

   It is deliberately **data**, not callbacks. A chart is a client component and
   the page that draws it is a server one, and a function cannot cross that
   boundary — the same reason `FmtName` exists in chart-core instead of a
   formatter function. So a mark says what it is and what picking it should do,
   in strings, and three things downstream act on that:

     · the delegated dispatcher in components/app/app-client.tsx already turns
       `data-act` + `data-v` into a route change, a panel or a command. A chart
       mark is therefore no different from a button, which is what gives drill
       its URL state, its Back behaviour and its authorization for free — the
       page it lands on applies the viewer's scope exactly as it always did;
     · the tooltip in components/charts/tooltip.tsx reads `data-tip` and draws
       the product's own tooltip rather than the browser's;
     · the stylesheet gives `[data-act]` inside a chart its hover, focus and
       selected states.

   Nothing here knows about any particular chart, and no chart knows about any
   particular page.
   ═════════════════════════════════════════════════════════════════════════════*/

/** One supporting fact in a tooltip: a label and an already-formatted value. */
export type TipRow = [label: string, value: string];

/**
 * What a tooltip says about a mark.
 *
 * Every value is formatted by the caller, because the caller is the only thing
 * that knows whether a number is a count, a rate, a currency or a span of days.
 * Only facts the record actually has belong here — a tooltip that invents a
 * comparison is worse than one that omits it.
 */
export type Tip = {
  /** The mark's own name: "Screening", "LinkedIn", "15 Aug". */
  label: string;
  /** Its headline figure, formatted. */
  value?: string;
  /** Supporting facts. Anything the data does not carry is simply left out. */
  rows?: TipRow[];
  /** One sentence of context, where the number needs it. */
  note?: string;
  /** What picking the mark will do, shown as the tooltip's footer. */
  action?: string;
};

/**
 * What a mark is and what picking it does.
 *
 * `act` is any action the dispatcher understands — a nav action that sets a
 * filter on the current page, a sheet, or a command. A mark with no `act` is
 * informational: it explains itself on hover and is not focusable, because a
 * thing that looks clickable and is not is worse than a thing that is plainly
 * not clickable.
 */
export type Pick = {
  act?: string;
  v?: string;
  tip?: Tip;
  /** True for the mark the current filter has selected. */
  on?: boolean;
  /**
   * How many records picking this will actually find, when that is not the
   * number the mark draws.
   *
   * Most marks are counts, and the two are the same. Some are not: a bar of
   * median days in a stage is a duration, and the list behind it is the
   * applications standing in that stage. Saying so here keeps the promise
   * explicit and lets the reconciliation suite hold a rate or a median to the
   * same standard as a count, instead of skipping it.
   */
  n?: number;
  /**
   * What picking it opens. `set` — the default — is a list of records, and
   * that list has to come back with exactly `n` (or the mark's own figure) in
   * it. `record` opens one thing: somebody's page, a requisition, a panel
   * member's own record. There is nothing to add up, and saying so is how a
   * reconciliation suite can tell a drill it cannot check from one it can.
   */
  opens?: 'set' | 'record';
};

/** The props a mark carries. Spread onto the element that *is* the mark. */
export type MarkProps = {
  'data-act'?: string;
  'data-v'?: string;
  'data-tip'?: string;
  'data-on'?: '1';
  className?: string;
  tabIndex?: number;
  role?: string;
  'aria-label'?: string;
};

/** A tooltip as one line, for the accessible name and for a plain fallback. */
export function tipText(t: Tip): string {
  const head = t.value ? `${t.label}: ${t.value}` : t.label;
  const rest = (t.rows ?? []).map(([k, v]) => `${k} ${v}`).join(', ');
  return [head, rest, t.note].filter(Boolean).join(' — ');
}

/**
 * Turn a pick into the props a mark carries.
 *
 * A mark that acts becomes a button: focusable, named, and activated by Enter
 * or Space as well as by a click — the shell's delegated listener does that for
 * any focusable element carrying `data-act`. A mark that only explains stays
 * out of the tab order and keeps its plain cursor.
 */
export function markProps(pick: Pick | null | undefined, base = 'cmk'): MarkProps {
  if (!pick) return { className: base };
  const acts = !!pick.act;
  const name = pick.tip ? tipText(pick.tip) : undefined;

  return {
    className: [base, acts ? 'pickable' : null, pick.on ? 'on' : null].filter(Boolean).join(' '),
    ...(acts ? { 'data-act': pick.act, 'data-v': pick.v ?? '' } : {}),
    ...(pick.tip ? { 'data-tip': JSON.stringify(pick.tip) } : {}),
    ...(pick.on ? { 'data-on': '1' as const } : {}),
    ...(acts
      ? { tabIndex: 0, role: 'button', 'aria-label': pick.tip?.action ?? name ?? undefined }
      : name
        ? { role: 'img', 'aria-label': name }
        : {}),
  };
}

/**
 * The picks for a set of marks, given the data.
 *
 * Charts take `picks` as an array parallel to their data so the caller decides,
 * per mark, whether it acts and what it says — including deciding that some
 * marks act and others do not, which is the ordinary case for a chart that
 * mixes real categories with an "Other" bucket.
 */
export type Picks = Array<Pick | null> | undefined;

export const pickAt = (picks: Picks, i: number): Pick | null => picks?.[i] ?? null;

/**
 * The picks for a chart whose marks form a grid rather than a row: a grouped
 * bar chart (category x key), a multi-series line (series x point), a heatmap
 * (row x column). Indexed in the order the data was given, outer first.
 */
export type Picks2 = Array<Picks> | undefined;

export const pickAt2 = (picks: Picks2, a: number, b: number): Pick | null =>
  picks?.[a]?.[b] ?? null;

/* ── Selection, as query state ────────────────────────────────────────────────
   A selection lives in the URL rather than in a component, so reload, Back and
   a pasted link all behave. These are the helpers a page uses to read one and
   to build the chip that clears it; the nav actions in lib/nav.ts are what set
   them, through the same dispatcher every other control uses. */

export type Selection = { key: string; label: string; value: string };

/** The selections currently in force, given the query and what to look for. */
export function selectionsFrom(
  query: Record<string, string>,
  fields: Array<{ key: string; label: string; format?: (v: string) => string }>,
): Selection[] {
  const out: Selection[] = [];
  for (const f of fields) {
    const raw = query[f.key];
    if (!raw) continue;
    out.push({ key: f.key, label: f.label, value: f.format ? f.format(raw) : raw });
  }
  return out;
}
