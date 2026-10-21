/**
 * The footer: one persistent line saying what the hovered or selected thing
 * is, and a drawer that slides up over the canvas for longer help or content.
 * No tooltip ever needs the pointer to stay put.
 */
import { useEffect, useState } from 'react';

import { widgetValue } from '../contract/bind.ts';
import { widgetOnSlot } from '../configs/index.ts';
import { useStore, type DrawerContent, type UiState } from '../state.tsx';
import { useView, type View } from '../view.tsx';

const REGION_HELP = {
  A: 'Region A, the parent: the group or package this node belongs to.',
  B: "Region B, the node itself: its name and the detail lines its template lists.",
} as const;
/** How many of the template's counters the footer line repeats. */
const FOOTER_COUNTERS = 4;

interface Line {
  readonly text: string;
  readonly more: string;
}

const TUTORIAL: readonly [string, string][] = [
  ['click a die', 'select it and bring it to the front; its details open on the right'],
  ['double-click / Enter / ＋', 'unfold it into its net'],
  ['shift + drag, or long press', 'move a node; with the lock on, move the whole graph'],
  ['I · T · V', 'isometric, top or front camera'],
  ['Q · E', 'turn the isometric camera a quarter'],
  ['W A S D · middle drag', 'move over the view\'s plane (left drag on empty space too)'],
  ['wheel', 'iso: zoom; top and front: scroll, shift for sideways; ctrl/⌘ + wheel zooms'],
  ['L · F · 0 · + · −', 'lock, fit, reset view, zoom'],
  ['P', 'pin the selected node to the left column'],
  ['Esc', 'close the drawer, fold back, clear the highlight, deselect'],
  ['? or H', 'open or close this drawer'],
];

function describe(state: UiState, view: View): Line {
  const { index } = view;
  const hover = state.hover;
  if (hover?.kind === 'ui') return { text: hover.text, more: hover.more ?? hover.text };
  if (hover?.kind === 'face') {
    if (hover.slot === 'A' || hover.slot === 'B') return { text: REGION_HELP[hover.slot], more: REGION_HELP[hover.slot] };
    const unfolded = state.expanded ? index.byId.get(state.expanded) : undefined;
    const template = unfolded ? view.template(unfolded) : undefined;
    const slot = hover.slot;
    const widgetId = template && unfolded ? widgetOnSlot(template, state.faceOverrides[template.id], view.shape(unfolded).slots, slot) : undefined;
    const widget = widgetId ? view.widget(widgetId) : undefined;
    if (!widget) return { text: 'An empty face.', more: '' };
    const where = hover.slot.startsWith('up') ? 'Top row: upstream, what feeds this node.' : 'Bottom row: downstream, what this node feeds or causes.';
    return { text: `${widget.icon} ${widget.title}: ${widget.description}`, more: `${widget.title}. ${widget.description}\n\n${where} Drag another widget from the right column onto this face to change it.` };
  }
  const id = hover?.kind === 'node' ? hover.id : state.selected;
  const node = id ? index.byId.get(id) : undefined;
  if (node) {
    const type = view.type(node.type);
    const counts = view.template(node).summary.slice(0, FOOTER_COUNTERS).flatMap((id) => {
      const spec = view.widget(id);
      return spec ? [`${widgetValue(spec, { node, index }).text} ${spec.title.toLowerCase()}`] : [];
    });
    return {
      text: `${node.label} — ${type.name}, ${node.legend}${counts.length > 0 ? ` · ${counts.join(' · ')}` : ''}`,
      more: `${node.label} is a ${type.name}. ${type.help}`,
    };
  }
  if (state.expanded) return { text: 'Point at a face to read what it shows. Click a lit face to act on it. Esc folds back.', more: 'The net: the top row is upstream, the middle strip is the parent (A) and the node (B), the bottom row is downstream.' };
  return { text: 'Click a die to select it, double-click to unfold it. Press ? for help.', more: '' };
}

function DrawerBody({ content }: { readonly content: DrawerContent }) {
  const [text, setText] = useState<string | null>(null);
  const [rows, setRows] = useState<readonly { task: string; status: string; outcome: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    setRows(null);
    setError(null);
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        if (content.kind === 'doc') {
          const res = await fetch(`/api/doc?path=${encodeURIComponent(content.path)}`, { signal: controller.signal });
          if (!res.ok) throw new Error(await res.text());
          setText(await res.text());
        } else if (content.kind === 'plan') {
          const res = await fetch(`/api/plan?stub=${encodeURIComponent(content.stub)}`, { signal: controller.signal });
          if (!res.ok) throw new Error(await res.text());
          setRows((await res.json()) as { task: string; status: string; outcome: string }[]);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'load failed');
      }
    };
    void load();
    return () => controller.abort();
  }, [content]);

  if (error) return <p className="error">Could not load: {error}</p>;
  if (content.kind === 'list') {
    if (content.items.length === 0) return <p className="muted">Nothing recorded.</p>;
    return (
      <ul className="list drawer-list">
        {content.items.map((item, i) => (
          <li key={i}><span className={`kind ${item.kind}`}>{item.kind}</span> {item.text} {item.meta && <span className="muted">· {item.meta}</span>}</li>
        ))}
      </ul>
    );
  }
  if (content.kind === 'doc') return text === null ? <p className="muted">Loading…</p> : <pre className="doc">{text}</pre>;
  if (rows === null) return <p className="muted">Loading…</p>;
  return (
    <ul className="list drawer-list">
      {rows.map((row, i) => <li key={i}><span className={`kind ${row.outcome}`}>{row.outcome}</span> {row.task}</li>)}
    </ul>
  );
}

export function Footer() {
  const { state, dispatch } = useStore();
  const view = useView();
  const line = describe(state, view);
  const { drawer } = state;

  return (
    <>
      <div className={`drawer${drawer.open ? ' open' : ''}`} aria-hidden={!drawer.open}>
        <div className="drawer-tabs">
          <button type="button" className={drawer.tab === 'help' ? 'on' : ''} onClick={() => dispatch({ type: 'drawer', open: true, tab: 'help' })}>Help</button>
          {drawer.content && <button type="button" className={drawer.tab === 'content' ? 'on' : ''} onClick={() => dispatch({ type: 'drawer', open: true, tab: 'content' })}>{drawer.content.title}</button>}
          <span className="spacer" />
          <button type="button" onClick={() => dispatch({ type: 'drawer', open: false })}>close · Esc</button>
        </div>
        <div className="drawer-body">
          {drawer.tab === 'content' && drawer.content ? <DrawerBody content={drawer.content} /> : (
            <>
              {line.more && <p className="context-help">{line.more}</p>}
              <table className="keys">
                <tbody>
                  {TUTORIAL.map(([keys, what]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{what}</td></tr>)}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      <footer className="footer">
        <span className="status">{line.text}</span>
        <span className="hints">
          {state.locked && <span className="badge">🔒 locked</span>}
          {state.expanded && <span className="badge">unfolded</span>}
          <kbd>?</kbd> help · <kbd>Esc</kbd> back
        </span>
      </footer>
    </>
  );
}
