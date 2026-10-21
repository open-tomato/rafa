/**
 * Camera moves: bring a selected node to the front, frame the unfolded net
 * flat on screen, fit the graph, zoom steps. A user orbit cancels any move
 * except the unfold, which holds the view until it folds back.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

import type { DieShape } from '../geometry/dice.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';
import { displayPosition, useScene } from './shared.ts';

const FOCUS_DISTANCE = 24;
const HOME_DISTANCE = 78;
const EASE = 0.1;
/** The unfold moves the camera a little faster: the view is locked and nothing else competes. */
const NET_EASE = 0.16;
/** About half a degree: closer than that the net already reads as face-on. */
const DIR_TOLERANCE = 0.01;
/** The largest a net triangle may draw, in px: past it the face text stops filling the face. */
const MAX_TRIANGLE_PX = 190;

interface Goal {
  readonly follow: string | null;
  readonly target: Vector3;
  readonly distance: number;
  readonly dir: Vector3 | null;
  readonly net: boolean;
}

interface OrbitLike {
  target: Vector3;
  enabled: boolean;
  enableRotate: boolean;
  update: () => void;
  addEventListener: (type: 'start', fn: () => void) => void;
  removeEventListener: (type: 'start', fn: () => void) => void;
}

export interface NetView {
  /** Pixels per unit of the open die's local space. */
  readonly unitPx: number;
  /** Pixels per typical face (the shape's `refEdge`), which sizes the face text. */
  readonly edgePx: number;
}

interface CameraRigProps {
  readonly visible: ReadonlySet<string>;
  readonly onNetView: (view: NetView | null) => void;
  /** A flat lens: the camera stays face-on to the layout plane, so it pans and zooms but never turns. */
  readonly flat: boolean;
}

export function CameraRig({ visible, onNetView, flat }: CameraRigProps) {
  const { state } = useStore();
  const { shared, index } = useScene();
  const { radius: radiusOf, shape: shapeOf } = useView();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const size = useThree((s) => s.size);
  const goal = useRef<Goal | null>(null);
  const scratch = useMemo(() => ({ a: new Vector3(), b: new Vector3(), c: new Vector3() }), []);
  const halfTan = Math.tan(MathUtils.degToRad(camera.fov / 2));

  const netDistance = (radius: number, shape: DieShape): number => {
    const aspect = size.width / size.height;
    const byHeight = (shape.netHeight * radius * 1.3) / 2 / halfTan;
    const byWidth = (shape.netWidth * radius * 1.1) / 2 / (halfTan * aspect);
    const byFont = (shape.refEdge * radius * size.height) / (2 * halfTan * MAX_TRIANGLE_PX);
    return Math.max(byHeight, byWidth, byFont);
  };

  // Selection and the unfold.
  useEffect(() => {
    shared.cameraSettled = false;
    if (state.expanded && !state.collapsing) {
      const node = index.byId.get(state.expanded);
      // The net faces the current camera's axis, not wherever the camera is mid-move.
      shared.frozenQuat = shared.modeQuat.clone();
      const radius = node ? radiusOf(node) : 1;
      const shape = node ? shapeOf(node) : undefined;
      if (!shape) return;
      const distance = netDistance(radius, shape);
      goal.current = { follow: state.expanded, target: new Vector3(), distance, dir: new Vector3(0, 0, 1).applyQuaternion(shared.frozenQuat), net: true };
      const unitPx = (radius * size.height) / (2 * distance * halfTan);
      onNetView({ unitPx, edgePx: shape.refEdge * unitPx });
      return;
    }
    onNetView(null);
    if (state.selected) {
      goal.current = { follow: state.selected, target: new Vector3(), distance: FOCUS_DISTANCE, dir: null, net: false };
    }
    // `size` re-frames the net on a resize; the rest is read fresh each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selected, state.expanded, state.collapsing, size.width, size.height]);

  // Toolbar and keyboard camera commands.
  useEffect(() => {
    const command = state.cameraCommand;
    if (!command || !controls || state.expanded) return;
    const current = camera.position.distanceTo(controls.target);
    if (command.kind === 'zoom-in' || command.kind === 'zoom-out') {
      goal.current = { follow: null, target: controls.target.clone(), distance: current * (command.kind === 'zoom-in' ? 0.72 : 1.38), dir: null, net: false };
      return;
    }
    if (command.kind === 'reset') {
      goal.current = { follow: null, target: new Vector3(), distance: HOME_DISTANCE, dir: null, net: false };
      return;
    }
    const ids = [...visible];
    // An arranged lens fits where the nodes are going, not where they are mid-slide.
    const placeOf = (i: number): Vector3 => (shared.targets && shared.targetOn?.[i]
      ? new Vector3(shared.targets[i * 2]! + shared.offset.x, shared.targets[i * 2 + 1]! + shared.offset.y, shared.offset.z)
      : displayPosition(shared, i, new Vector3()));
    const points = ids.map((id) => placeOf(index.position.get(id) ?? 0));
    const center = points.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(Math.max(1, points.length));
    // The 85th percentile, so a few loose packages at the rim do not shrink the rest to dots.
    const spread = points.map((p) => p.distanceTo(center)).sort((a, b) => a - b);
    const reach = Math.max(1, spread[Math.floor(spread.length * 0.85)] ?? 1);
    const head = null;
    goal.current = { follow: null, target: center, distance: (reach * 1.15) / Math.sin(MathUtils.degToRad(camera.fov / 2)), dir: head, net: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cameraCommand]);

  // A user orbit or zoom wins over a move in flight, the unfold excepted.
  useEffect(() => {
    if (!controls) return;
    const cancel = (): void => {
      if (!goal.current?.net) goal.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame(() => {
    if (!controls) return;
    controls.enabled = !state.expanded && !shared.dragging;
    controls.enableRotate = !flat;
    const g = goal.current;
    if (!g) return;
    const target = scratch.a.copy(g.target);
    if (g.follow) {
      const at = index.position.get(g.follow);
      if (at !== undefined) displayPosition(shared, at, target);
      const node = index.byId.get(g.follow);
      if (g.net && node && shared.frozenQuat) {
        target.add(scratch.c.copy(shapeOf(node).netCenter).multiplyScalar(radiusOf(node)).applyQuaternion(shared.frozenQuat));
      }
    }
    const ease = g.net ? NET_EASE : EASE;
    controls.target.lerp(target, ease);
    const offset = scratch.b.copy(camera.position).sub(controls.target);
    const length = MathUtils.lerp(offset.length(), g.distance, ease);
    const dir = g.dir ? offset.normalize().lerp(g.dir, ease).normalize() : offset.normalize();
    camera.position.copy(controls.target).addScaledVector(dir, length);
    controls.update();
    // Close enough is relative to the distance, so a small die settles as surely as a far fit.
    const settled = controls.target.distanceTo(target) < 0.02 * Math.max(1, g.distance / 10) && Math.abs(length - g.distance) < 0.01 * g.distance + 0.02 && (!g.dir || dir.distanceTo(g.dir) < DIR_TOLERANCE);
    if (g.net) {
      if (settled) {
        controls.target.copy(target);
        camera.position.copy(target).addScaledVector(g.dir ?? dir, g.distance);
        camera.lookAt(target);
        shared.cameraSettled = true;
      }
    } else if (settled) {
      goal.current = null;
    }
  });

  return null;
}
