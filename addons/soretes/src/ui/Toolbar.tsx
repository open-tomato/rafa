/** The view tools on the canvas: lock, zoom, fit, reset, and fold back while unfolded. */
import { turnLabel } from '../scene/views.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';

export function Toolbar() {
  const { state, dispatch } = useStore();
  const view = useView();
  if (state.expanded) {
    return (
      <div className="toolbar">
        <button type="button" data-help="Fold the net back into its d20 and unlock the view (Esc)." onClick={() => dispatch({ type: 'collapse' })}>⤺ fold back</button>
      </div>
    );
  }
  const lens = view.lens(state.lens);
  const flat = Boolean(lens.flat || lens.arrange);
  const mode = flat ? 'front' : state.view.mode;
  return (
    <div className="toolbar">
      <div className="segmented inline">
        <button type="button" disabled={flat} data-help="Turn the isometric camera a quarter, counter-clockwise (Q)." onClick={() => dispatch({ type: 'view-turn', by: 1 })}>⟲</button>
        <button type="button" disabled={flat} className={mode === 'iso' ? 'on' : ''} data-help={`Isometric camera, ${turnLabel(state.view)} (I). Q and E turn it.`} onClick={() => dispatch({ type: 'view-mode', mode: 'iso' })}>◇ iso</button>
        <button type="button" disabled={flat} data-help="Turn the isometric camera a quarter, clockwise (E)." onClick={() => dispatch({ type: 'view-turn', by: -1 })}>⟳</button>
        <button type="button" disabled={flat} className={mode === 'top' ? 'on' : ''} data-help="Top camera, straight down (T)." onClick={() => dispatch({ type: 'view-mode', mode: 'top' })}>⬒ top</button>
        <button type="button" className={mode === 'front' ? 'on' : ''} data-help={flat ? 'This lens is 2D: it holds the front camera.' : 'Front camera, level (V).'} onClick={() => dispatch({ type: 'view-mode', mode: 'front' })}>▭ front</button>
      </div>
      <button
        type="button"
        className={state.locked ? 'on' : ''}
        data-help={state.locked ? 'Locked: the layout is frozen, and dragging a node moves the whole graph with every distance kept (L).' : 'Unlocked: the layout settles by itself, and dragging a node moves that node alone (L).'}
        onClick={() => dispatch({ type: 'toggle-lock' })}
      >
        {state.locked ? '🔒' : '🔓'}
      </button>
      <button type="button" data-help="Zoom in (+)." onClick={() => dispatch({ type: 'camera', kind: 'zoom-in' })}>＋</button>
      <button type="button" data-help="Zoom out (−)." onClick={() => dispatch({ type: 'camera', kind: 'zoom-out' })}>－</button>
      <button type="button" data-help="Fit every visible node in the view (F)." onClick={() => dispatch({ type: 'camera', kind: 'fit' })}>⤢</button>
      <button type="button" data-help="Back to the middle of the graph (0)." onClick={() => dispatch({ type: 'camera', kind: 'reset' })}>⟲</button>
    </div>
  );
}
