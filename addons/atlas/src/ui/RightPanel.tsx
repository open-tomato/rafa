/**
 * The right column, always shown: the selected node's counters and lists as
 * its template lists them, the widget palette while unfolded, or the overview.
 */
import { readItems, viewItem, widgetValue } from '../contract/bind.ts';
import type { PanelList } from '../contract/types.ts';
import type { GraphNode } from '../types.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';
import { openFor, WIDGET_MIME } from './NetOverlay.tsx';
import { Overview } from './Overview.tsx';

const DEFAULT_LIST_LIMIT = 6;

function ListSection({ list, node }: { readonly list: PanelList; readonly node: GraphNode }) {
  const { dispatch } = useStore();
  const view = useView();
  const label = (id: string): string => view.index.byId.get(id)?.label ?? id;
  const items = readItems(list.items, { node, index: view.index }).slice(0, list.limit ?? DEFAULT_LIST_LIMIT).map((item) => viewItem(item, list.shape, label));
  if (items.length === 0) return null;
  if (list.display === 'chips') {
    return (
      <section>
        <h3>{list.title}</h3>
        <p className="deps">{items.map((item, i) => <code key={i}>{item.text}</code>)}</p>
      </section>
    );
  }
  return (
    <section>
      <h3>{list.title}</h3>
      <ul className="list">
        {items.map((item, i) => {
          const open = openFor(list.open, typeof item.raw === 'string' ? item.raw : item.text, list.title);
          return (
            <li key={i}>
              {item.tag && <span className={`kind ${item.tag}`}>{item.tag}</span>}{' '}
              {open ? (
                <button type="button" className="link" data-help={`Open ${item.text} in the drawer.`} onClick={() => dispatch({ type: 'show', content: open })}>{item.text}</button>
              ) : item.text}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RightPanel() {
  const { state, dispatch } = useStore();
  const view = useView();
  const node = state.selected ? view.index.byId.get(state.selected) : undefined;
  if (!node) return <Overview />;
  const template = view.template(node);
  const parent = view.index.byId.get(node.group);
  const ctx = { node, index: view.index };

  return (
    <aside className="right">
      <div className="title" style={{ borderColor: view.color(node) }}>
        <span className="big-icon">{view.icon(node)}</span>
        <div>
          <h2>{node.label}</h2>
          <p className="muted">{view.type(node.type).name} · {parent && parent.id !== node.id ? parent.label : node.legend}</p>
        </div>
      </div>
      <div className="actions">
        <button type="button" data-help="Unfold the d20 into its net of faces (Enter or double-click)." onClick={() => dispatch(state.expanded ? { type: 'collapse' } : { type: 'expand', id: node.id })}>
          {state.expanded ? '⤺ fold back' : '＋ unfold'}
        </button>
        <button type="button" className={state.pinned.includes(node.id) ? 'on' : ''} data-help="Keep this node in the left column's pinned list (P)." onClick={() => dispatch({ type: 'toggle-pin', id: node.id })}>📌 pin</button>
        <button type="button" data-help="Light up the nodes linked to this one, both ways." onClick={() => dispatch({ type: 'highlight', highlight: { label: `links of ${node.label}`, ids: [node.id, ...view.index.callers(node.id), ...view.index.callees(node.id)] } })}>✳ links</button>
      </div>

      <section>
        <h3 data-help={`The counters of the "${template.id}" template.`}>Status</h3>
        <div className="counters">
          {template.summary.map((id) => {
            const spec = view.widget(id);
            if (!spec) return null;
            const { text, number } = widgetValue(spec, ctx);
            return (
              <div key={id} className={`counter${number === 0 || text === '—' ? ' zero' : ''}`} data-help={`${spec.title}: ${spec.description}`}>
                <b>{text}</b>
                <span>{spec.title.toLowerCase()}</span>
              </div>
            );
          })}
        </div>
        <p className="muted small">{node.legend}</p>
      </section>

      {state.expanded && (
        <section>
          <h3 data-help="Drag a widget onto a triangle of the net to change what that face shows.">Face widgets</h3>
          <p className="muted small">Drag one onto a triangle of the net.</p>
          <div className="palette">
            {Object.entries(view.config.widgets).map(([id, spec]) => (
              <div
                key={id}
                className="widget-chip"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(WIDGET_MIME, id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                data-help={`${spec.title}: ${spec.description}`}
              >
                {spec.icon} {spec.title}
              </div>
            ))}
          </div>
        </section>
      )}

      {(template.lists ?? []).map((list) => <ListSection key={list.title} list={list} node={node} />)}
    </aside>
  );
}
