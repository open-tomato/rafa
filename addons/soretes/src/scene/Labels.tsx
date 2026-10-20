/**
 * Node legends and the selected node's buttons as one plain DOM layer over
 * the canvas. The projector inside the canvas moves each element every frame,
 * so labels never mount or unmount with the 3D scene.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import type { GraphIndex } from '../graph/index.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';
import { ACTIONS_KEY, displayPosition, useScene } from './shared.ts';

const BELOW = 1.4;
const BESIDE = 1.15;

interface LabelLayerProps {
  readonly index: GraphIndex;
  readonly visible: ReadonlySet<string>;
  readonly dimmed: ReadonlySet<string> | null;
}

export function LabelLayer({ index, visible, dimmed }: LabelLayerProps) {
  const { state, dispatch } = useStore();
  const view = useView();
  const lens = view.lens(state.lens);
  const { shared } = useScene();
  const register = (key: string) => (el: HTMLElement | null): void => {
    if (el) shared.labels.set(key, el);
    else shared.labels.delete(key);
  };
  const off = state.expanded !== null;
  return (
    <div className="label-layer">
      {index.nodes.map((node) => {
        const mode = lens.labels?.[node.type] ?? view.type(node.type).label ?? 'full';
        const focused = state.selected === node.id || (state.hover?.kind === 'node' && state.hover.id === node.id) || (dimmed?.has(node.id) ?? false);
        const shown = !off && visible.has(node.id) && (mode !== 'none' || focused);
        return (
          <div
            key={node.id}
            ref={register(node.id)}
            className={`legend${dimmed && !dimmed.has(node.id) ? ' dim' : ''}${state.selected === node.id ? ' selected' : ''}${shown ? '' : ' hidden'}`}
          >
            <b>{node.label}</b>
            {(mode === 'full' || focused) && <span>{node.legend}</span>}
          </div>
        );
      })}
      <div ref={register(ACTIONS_KEY)} className={`node-actions${off || !state.selected ? ' hidden' : ''}`}>
        {state.selected && (
          <>
            <button type="button" data-help="Unfold this d20 into its net (Enter)." onClick={() => state.selected && dispatch({ type: 'expand', id: state.selected })}>＋</button>
            <button
              type="button"
              data-help="Pin it to the left column (P)."
              className={state.pinned.includes(state.selected) ? 'on' : ''}
              onClick={() => state.selected && dispatch({ type: 'toggle-pin', id: state.selected })}
            >
              📌
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function LabelProjector({ visible }: { readonly visible: ReadonlySet<string> }) {
  const { state } = useStore();
  const { shared, index } = useScene();
  const { radius: radiusOf } = useView();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => ({ p: new Vector3(), up: new Vector3(), right: new Vector3() }), []);

  const place = (el: HTMLElement, at: Vector3): void => {
    at.project(camera);
    if (at.z > 1) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '';
    el.style.transform = `translate(${((at.x + 1) / 2) * size.width}px, ${((1 - at.y) / 2) * size.height}px)`;
  };

  useFrame(() => {
    v.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    v.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const node of index.nodes) {
      const el = shared.labels.get(node.id);
      const at = index.position.get(node.id);
      if (!el || at === undefined || !visible.has(node.id)) continue;
      const r = radiusOf(node);
      place(el, displayPosition(shared, at, v.p).addScaledVector(v.up, -r * BELOW));
    }
    const actions = shared.labels.get(ACTIONS_KEY);
    const selected = state.selected ? index.byId.get(state.selected) : undefined;
    const at = state.selected ? index.position.get(state.selected) : undefined;
    if (actions && selected && at !== undefined) {
      const r = radiusOf(selected) * 1.12;
      place(actions, displayPosition(shared, at, v.p).addScaledVector(v.up, r * BESIDE).addScaledVector(v.right, r * BESIDE));
    }
  });
  return null;
}
