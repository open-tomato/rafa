/** The view tools on the canvas: lock, zoom, fit, reset, and fold back while unfolded. */
import { useStore } from '../state.tsx';

export function Toolbar() {
  const { state, dispatch } = useStore();
  if (state.expanded) {
    return (
      <div className="toolbar">
        <button type="button" data-help="Fold the net back into its d20 and unlock the view (Esc)." onClick={() => dispatch({ type: 'collapse' })}>⤺ fold back</button>
      </div>
    );
  }
  return (
    <div className="toolbar">
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
      <button type="button" data-help="Back to the starting view (0)." onClick={() => dispatch({ type: 'camera', kind: 'reset' })}>⟲</button>
    </div>
  );
}
