/** The right column with nothing selected: what the graph holds, and the top nodes for each heat widget. */
import { readNumber, widgetValue } from '../contract/bind.ts';
import type { GraphNode } from '../types.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';

const TOP = 5;
const RANKED = 3;

export function Overview() {
  const { dispatch } = useStore();
  const view = useView();
  const { index } = view;
  const ranked = (binding: string): GraphNode[] =>
    [...index.nodes]
      .map((node) => ({ node, value: readNumber(binding, { node, index }) ?? 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP)
      .map((r) => r.node);

  return (
    <aside className="right">
      <div className="title" style={{ borderColor: 'var(--accent)' }}>
        <span className="big-icon">🎲</span>
        <div>
          <h2>Overview</h2>
          <p className="muted">{view.config.title} · click a die for its details</p>
        </div>
      </div>

      <section>
        <h3 data-help="How many nodes of each type the graph holds.">In the graph</h3>
        <div className="counters">
          {view.entityTypes.map((type) => (
            <div key={type} className="counter" data-help={view.type(type).help}>
              <b>{index.nodes.filter((n) => n.type === type).length}</b>
              <span>{view.type(type).icon} {view.type(type).name}</span>
            </div>
          ))}
        </div>
        <p className="muted small">{index.nodes.length} nodes · {index.edges.length} links</p>
      </section>

      {view.config.heat.slice(0, RANKED).map((id) => {
        const spec = view.widget(id);
        if (!spec) return null;
        return (
          <section key={id}>
            <h3 data-help={`The nodes with the most ${spec.title.toLowerCase()}. Click one to select it.`}>{spec.icon} {spec.title}</h3>
            {ranked(spec.value).map((node) => (
              <button key={node.id} type="button" className="link block rank" data-help={`Select ${node.label}: ${node.legend}.`} onClick={() => dispatch({ type: 'select', id: node.id })}>
                <span className="swatch" style={{ background: view.color(node) }} />
                {view.icon(node)} {node.label}
                <span className="muted rank-value">{widgetValue(spec, { node, index }).text}</span>
              </button>
            ))}
          </section>
        );
      })}
    </aside>
  );
}
