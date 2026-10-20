/** One graph node: a d20 that faces the camera, its legend line, and its drag and click handling. */
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, Group, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane, Quaternion, Ray, Vector3 } from 'three';

import { useStore } from '../state.tsx';
import type { GraphNode } from '../types.ts';
import { useView } from '../view.tsx';
import { displayPosition, emojiTexture, shapeGeometry, useScene } from './shared.ts';
import { UnfoldRig } from './UnfoldRig.tsx';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 6;
const WOBBLE = 0.22;
const HEAT_COLOR = new Color('#ff8a3d');
const SELECT_COLOR = new Color('#ffffff');

interface D20Props {
  readonly node: GraphNode;
  readonly at: number;
  /** 0 to 1, how strongly the left nav's data heat lights this node. */
  readonly heat: number;
  readonly dim: boolean;
  /** Filtered out: kept mounted (see the legend note below) but not drawn. */
  readonly hidden: boolean;
}

interface Press {
  readonly x: number;
  readonly y: number;
  timer: ReturnType<typeof setTimeout> | null;
  dragging: boolean;
  plane: Plane | null;
  last: Vector3 | null;
}

export function D20({ node, at, heat, dim, hidden }: D20Props) {
  const { state, dispatch } = useStore();
  const { shared } = useScene();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const press = useRef<Press | null>(null);
  const justDragged = useRef(false);
  const view = useView();
  const shape = view.shape(node);
  const geometry = shapeGeometry(shape);
  const radius = view.radius(node);
  const stroke = view.type(node.type).stroke;
  const color = useMemo(() => new Color(view.color(node)), [view, node]);
  const materials = useMemo(() => ({
    body: new MeshStandardMaterial({ color, flatShading: true, roughness: 0.45, metalness: 0.15, transparent: true }),
    stroke: new LineBasicMaterial({ color: stroke, transparent: true }),
    icon: new MeshBasicMaterial({ map: emojiTexture(view.icon(node)), transparent: true, depthWrite: false }),
  }), [color, stroke, view, node]);

  const selected = state.selected === node.id;
  const expandedSelf = state.expanded === node.id;
  const someoneExpanded = state.expanded !== null && !expandedSelf;
  const hovered = state.hover?.kind === 'node' && state.hover.id === node.id;
  const position = useMemo(() => new Vector3(), []);
  const wobble = useMemo(() => new Quaternion(), []);
  const phase = at * 1.7;

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.visible = !hidden;
    if (hidden) return;
    displayPosition(shared, at, position);
    g.position.copy(position);
    if (expandedSelf && shared.frozenQuat) {
      g.quaternion.copy(shared.frozenQuat);
    } else {
      const t = clock.elapsedTime * 0.6 + phase;
      wobble.setFromAxisAngle(new Vector3(Math.sin(t * 0.7), Math.cos(t), 0.2).normalize(), Math.sin(t) * WOBBLE);
      g.quaternion.copy(camera.quaternion).multiply(wobble);
    }
    const grow = 1 + heat * 0.35 + (hovered ? 0.08 : 0) + (selected && !expandedSelf ? 0.12 : 0);
    g.scale.setScalar(radius * grow);
    const fade = someoneExpanded ? 1 - shared.unfoldT * 0.92 : 1;
    const opacity = (dim ? 0.18 : 0.94) * fade;
    materials.body.opacity = opacity;
    materials.body.emissive.copy(selected ? SELECT_COLOR : HEAT_COLOR).multiplyScalar(selected ? 0.18 : heat * 0.85);
    materials.stroke.opacity = (dim ? 0.25 : 1) * fade;
    materials.stroke.color.set(selected || hovered ? '#ffffff' : stroke);
    materials.icon.opacity = (dim ? 0.3 : 1) * fade * (expandedSelf ? 1 - shared.unfoldT : 1);
    if (body.current) body.current.visible = !expandedSelf;
  });

  const endPress = (event: ThreeEvent<PointerEvent>): void => {
    const p = press.current;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    if (p.dragging) {
      shared.layout.fixed[at] = 0;
      shared.dragging = false;
      justDragged.current = true;
      document.body.style.cursor = '';
      (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
    }
    if (controls) controls.enabled = true;
    press.current = null;
  };

  const startDrag = (ray: Ray): void => {
    const p = press.current;
    if (!p) return;
    p.dragging = true;
    shared.dragging = true;
    if (controls) controls.enabled = false;
    const normal = camera.getWorldDirection(new Vector3());
    p.plane = new Plane().setFromNormalAndCoplanarPoint(normal, displayPosition(shared, at, new Vector3()));
    p.last = ray.intersectPlane(p.plane, new Vector3());
    if (!state.locked) shared.layout.fixed[at] = 1;
    document.body.style.cursor = 'grabbing';
    dispatch({ type: 'hover', hover: { kind: 'ui', text: state.locked ? 'Moving the whole graph: the lock keeps every distance.' : `Moving ${node.label}: the others follow its links.` } });
  };

  const handlers = state.expanded || hidden ? {} : {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
      dispatch({ type: 'hover', hover: { kind: 'node', id: node.id } });
    },
    onPointerOut: () => {
      if (!shared.dragging) document.body.style.cursor = '';
      dispatch({ type: 'hover', hover: null });
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      justDragged.current = false;
      press.current = { x: e.clientX, y: e.clientY, timer: null, dragging: false, plane: null, last: null };
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
      if (e.shiftKey) {
        startDrag(e.ray);
        return;
      }
      const ray = e.ray.clone();
      press.current.timer = setTimeout(() => startDrag(ray), LONG_PRESS_MS);
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const p = press.current;
      if (!p) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX && p.timer) {
          clearTimeout(p.timer);
          p.timer = null;
        }
        return;
      }
      if (!p.plane || !p.last) return;
      const hit = e.ray.intersectPlane(p.plane, new Vector3());
      if (!hit) return;
      const delta = hit.clone().sub(p.last);
      p.last = hit;
      if (state.locked) {
        shared.offset.add(delta);
      } else {
        const pos = shared.layout.positions;
        pos[at * 3] = (pos[at * 3] ?? 0) + delta.x;
        pos[at * 3 + 1] = (pos[at * 3 + 1] ?? 0) + delta.y;
        pos[at * 3 + 2] = (pos[at * 3 + 2] ?? 0) + delta.z;
        shared.layout.alpha = Math.max(shared.layout.alpha, 0.2);
      }
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (justDragged.current || e.delta > MOVE_TOLERANCE_PX) {
        justDragged.current = false;
        return;
      }
      dispatch({ type: 'select', id: node.id });
    },
    onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      dispatch({ type: 'expand', id: node.id });
    },
  };

  return (
    <group ref={group}>
      <mesh ref={body} geometry={geometry.folded} material={materials.body} {...handlers}>
        <lineSegments geometry={geometry.foldedEdges} material={materials.stroke} />
        <mesh position={[0, 0, shape.frontZ + 0.004]} material={materials.icon}>
          <planeGeometry args={[shape.iconSize, shape.iconSize]} />
        </mesh>
      </mesh>
      {expandedSelf && <UnfoldRig node={node} />}
    </group>
  );
}
