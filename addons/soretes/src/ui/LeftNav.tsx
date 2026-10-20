/** The left column: pinned nodes, and the filters that shape the graph. */
import { useStore, type DepthDirection } from '../state.tsx';
import { useView } from '../view.tsx';

const MAX_DEPTH = 6;

const DIRECTIONS: readonly { readonly key: DepthDirection; readonly label: string; readonly help: string }[] = [
  { key: 'upstream', label: '⬆ up', help: 'Upstream only: follow links into the node, toward what calls or holds it.' },
  { key: 'both', label: 'both', help: 'Follow links both ways.' },
  { key: 'downstream', label: '⬇ down', help: 'Downstream only: follow links out of the node, toward what it calls or holds.' },
];

export function LeftNav() {
  const { state, dispatch } = useStore();
  const view = useView();
  const { index } = view;
  const weighted = view.config.weightedKind ? view.edge(view.config.weightedKind) : null;
  const highlightBy = (label: string, ids: readonly string[]): void => {
    const same = state.highlight?.label === label;
    dispatch({ type: 'highlight', highlight: same ? null : { label, ids } });
  };

  const lens = view.lens(state.lens);
  const lensTypes = view.entityTypes.filter((t) => !lens.types || lens.types.includes(t));
  const lensHas = (id: string): boolean => {
    const node = index.byId.get(id);
    return node !== undefined && view.matches(lens.types, node);
  };

  return (
    <nav className="left">
      <section>
        <h3 data-help="A lens shows the same nodes for a different eye: which ones take part, what each link does, and what hangs around them.">Lens</h3>
        <div className="lenses">
          {view.lenses.map(([id, spec]) => (
            <button
              key={id}
              type="button"
              className={lens === spec ? 'on' : ''}
              data-help={`${spec.title}: ${spec.description}`}
              onClick={() => dispatch({ type: 'lens', lens: id, heat: spec.heat })}
            >
              {spec.icon} {spec.title}
            </button>
          ))}
        </div>
        <p className="muted small">{lens.description}</p>
      </section>

      <section>
        <h3 data-help="Nodes you keep at hand. Pin or unpin from a selected node (P).">Pinned</h3>
        {state.pinned.length === 0 && <p className="muted">Nothing pinned yet.</p>}
        {state.pinned.map((id) => {
          const node = index.byId.get(id);
          if (!node) return null;
          return (
            <button key={id} type="button" className={`pin${state.selected === id ? ' on' : ''}`} data-help={`Select ${node.label} and bring it to the front.`} onClick={() => dispatch({ type: 'select', id })}>
              <span className="swatch" style={{ background: view.color(node) }} />
              {view.icon(node)} {node.label}
            </button>
          );
        })}
      </section>

      {state.highlight && (
        <section>
          <h3>Highlight</h3>
          <button type="button" className="chip on" data-help="Clear the highlight (Esc)." onClick={() => dispatch({ type: 'highlight', highlight: null })}>
            {state.highlight.label} · {state.highlight.ids.length} ✕
          </button>
        </section>
      )}

      <section>
        <h3 data-help="The checkbox shows or hides a type; the name lights its nodes up.">Entity types</h3>
        {lensTypes.map((type) => {
          const spec = view.type(type);
          return (
            <div key={type} className="row">
              <input type="checkbox" checked={!state.hiddenTypes.includes(type)} onChange={() => dispatch({ type: 'toggle-type', entity: type })} data-help={`Show or hide every ${spec.name}.`} />
              <button type="button" className="link" data-help={spec.help} onClick={() => highlightBy(`type ${type}`, index.nodes.filter((n) => n.type === type).map((n) => n.id))}>
                <span className="stroke" style={{ borderColor: spec.stroke }} />
                {spec.icon} {spec.name}
              </button>
            </div>
          );
        })}
      </section>

      <section>
        <h3 data-help="The checkbox shows or hides a group's nodes; the name lights them up.">Groups</h3>
        {view.groups.filter((group) => index.nodes.some((n) => n.group === group && view.matches(lens.types, n))).map((group) => {
          const label = view.groupLabel(group).replace('@open-tomato/', '');
          return (
            <div key={group} className="row">
              <input type="checkbox" checked={!state.hiddenGroups.includes(group)} onChange={() => dispatch({ type: 'toggle-group', group })} data-help={`Show or hide ${label}.`} />
              <button type="button" className="link" data-help={`Light up everything in ${label}.`} onClick={() => highlightBy(label, index.nodes.filter((n) => n.group === group).map((n) => n.id))}>
                <span className="swatch" style={{ background: view.config.groupColors?.[group] ?? '#888' }} />
                {label}
              </button>
            </div>
          );
        })}
      </section>

      <section>
        <h3 data-help="The checkbox draws or hides a kind of link; the name lights up the nodes it joins.">Relationships</h3>
        {view.edgeKinds.filter((kind) => view.role(lens, kind) !== 'hidden' && index.edges.some((e) => e.kind === kind && lensHas(e.source) && lensHas(e.target))).map((kind) => {
          const spec = view.edge(kind);
          const forceOnly = view.role(lens, kind) === 'force';
          return (
            <div key={kind} className="row">
              <input type="checkbox" checked={!state.hiddenEdgeKinds.includes(kind)} onChange={() => dispatch({ type: 'toggle-edge', kind })} data-help={`Draw or hide "${spec.label}" links.`} />
              <button
                type="button"
                className="link"
                data-help={spec.help}
                onClick={() => highlightBy(spec.label, [...new Set(index.edges.filter((e) => e.kind === kind).flatMap((e) => [e.source, e.target]))])}
              >
                <span className={`line${spec.dash > 0 ? ' dashed' : ''}${forceOnly ? ' force' : ''}`} style={{ borderColor: spec.color }} />
                {spec.label}{forceOnly && <span className="muted" data-help="This lens does not draw these links; they still pull their nodes together."> · force</span>}
              </button>
            </div>
          );
        })}
        {weighted && (
          <label className="slider" data-help={`Hide "${weighted.label}" links lighter than this, to thin the hairball.`}>
            {weighted.label} ≥ {state.minImportWeight}
            <input type="range" min={1} max={40} value={state.minImportWeight} onChange={(e) => dispatch({ type: 'min-weight', value: Number(e.target.value) })} />
          </label>
        )}
      </section>

      <section>
        <h3 data-help="Keep only the selected node's neighbourhood: the nodes a few links away, over the links drawn above. Simplifies a dense graph.">Depth</h3>
        <label className="slider" data-help={state.selected ? 'How many links away from the selected node a node may be and still show. All shows the whole graph.' : 'Select a node first: the depth counts links away from it.'}>
          <span>{state.depth === 0 ? <b>all levels</b> : <><b>{state.depth}</b> {state.depth === 1 ? 'hop' : 'hops'} from {state.selected ? (index.byId.get(state.selected)?.label ?? 'selection') : 'the selection'}</>}</span>
          <input type="range" min={0} max={MAX_DEPTH} value={state.depth} onChange={(e) => {
            dispatch({ type: 'depth', depth: Number(e.target.value) });
            dispatch({ type: 'camera', kind: 'fit' });
          }} />
        </label>
        <div className="segmented">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              className={state.depthDirection === d.key ? 'on' : ''}
              disabled={state.depth === 0}
              data-help={d.help}
              onClick={() => {
                dispatch({ type: 'depth-direction', direction: d.key });
                dispatch({ type: 'camera', kind: 'fit' });
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
        {state.depth > 0 && !state.selected && <p className="muted small">Select a node to apply it.</p>}
      </section>

      <section>
        <h3 data-help="Pick one measure to light the dice by; a brighter, bigger die has more of it.">Data heat</h3>
        <label className="row" data-help="No data heat: every die at its own size.">
          <input type="radio" name="heat" checked={state.heat === 'none'} onChange={() => dispatch({ type: 'heat', heat: 'none' })} />
          none
        </label>
        {view.config.heat.map((id) => {
          const spec = view.widget(id);
          if (!spec) return null;
          return (
            <label key={id} className="row" data-help={`Light the dice by ${spec.title.toLowerCase()}: ${spec.description}`}>
              <input type="radio" name="heat" checked={state.heat === id} onChange={() => dispatch({ type: 'heat', heat: id })} />
              {spec.icon} {spec.title.toLowerCase()}
            </label>
          );
        })}
      </section>
    </nav>
  );
}
