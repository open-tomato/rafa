/**
 * Opening a die, by its shape's `unfold`:
 *   net      each face moves rigidly from the solid to its place in the flat
 *            net; the node's own faces open first and the rest follow
 *   explode  each face lifts away along its normal, and the node's members
 *            appear inside as small dice to pick
 *   unroll   the cylinder's side unrolls into a rectangle and its caps swing
 *            up and down beside it
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, CircleGeometry, Color, DoubleSide, EdgesGeometry, LineBasicMaterial, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';

import { readItems } from '../contract/bind.ts';
import { CYL_H, CYL_R, CYL_SEGMENTS, EXPLODE, type DieShape, type Tint } from '../geometry/dice.ts';
import { useStore } from '../state.tsx';
import type { GraphNode } from '../types.ts';
import { useView } from '../view.tsx';
import { shapeGeometry, useScene, type SceneShared } from './shared.ts';

const DURATION_S = 1.15;
const SIDE_DELAY = 0.3;
const BURST = 0.55;
const MEMBER_SIZE = 0.16;
const MEMBER_ORBIT = 0.62;
const IDENTITY = new Quaternion();
const OPEN_GRACE_S = 1.5;

const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));

function tintColor(tint: Tint, base: Color): Color {
  switch (tint) {
    case 'up': return new Color('#25415f');
    case 'down': return new Color('#4a2738');
    case 'self': return base.clone().multiplyScalar(0.85);
    case 'parent': return base.clone().multiplyScalar(0.55);
    case 'band': return base.clone().multiplyScalar(0.7);
  }
}

/** Advances the open clock toward open or closed, and reports both ends once. */
function useOpenClock(shared: SceneShared): (delta: number) => number {
  const { state, dispatch } = useStore();
  const reported = useRef<'none' | 'open' | 'closed'>('none');
  const openFor = useRef(0);
  return (delta) => {
    const goal = state.collapsing ? 0 : 1;
    const step = delta / DURATION_S;
    shared.unfoldT = goal > shared.unfoldT ? Math.min(goal, shared.unfoldT + step) : Math.max(goal, shared.unfoldT - step);
    const t = shared.unfoldT;
    // Open once the camera settles; a slow frame rate may keep it creeping, so a short grace period also counts.
    openFor.current = t >= 1 ? openFor.current + delta : 0;
    if (t >= 1 && (shared.cameraSettled || openFor.current > OPEN_GRACE_S) && reported.current !== 'open') {
      reported.current = 'open';
      dispatch({ type: 'unfolded', done: true });
    }
    if (state.collapsing && t <= 0 && reported.current !== 'closed') {
      reported.current = 'closed';
      dispatch({ type: 'collapsed' });
    }
    return t;
  };
}

function FaceRig({ node, shape }: { readonly node: GraphNode; readonly shape: DieShape }) {
  const { shared } = useScene();
  const view = useView();
  const meshes = useRef<(Mesh | null)[]>([]);
  const tick = useOpenClock(shared);
  const geometry = shapeGeometry(shape);
  const rig = useMemo(() => {
    const base = new Color(view.color(node));
    return shape.faces.map((face) => ({
      face,
      delay: face.tint === 'up' || face.tint === 'down' ? SIDE_DELAY : 0,
      from: base.clone(),
      to: shape.unfold === 'explode' ? base.clone().multiplyScalar(face.tint === 'self' ? 1 : 0.7) : tintColor(face.tint, base),
      material: new MeshStandardMaterial({ color: base.clone(), flatShading: true, roughness: 0.6, metalness: 0.05, side: DoubleSide, transparent: shape.unfold === 'explode', opacity: 1 }),
      stroke: new LineBasicMaterial({ color: '#e8edf5', transparent: true, opacity: 0.85 }),
    }));
  }, [view, node, shape]);
  const scratch = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const t = tick(delta);
    rig.forEach(({ face, delay, from, to, material }, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const u = ease(clamp01((t - delay) / (1 - delay)));
      if (shape.unfold === 'explode') {
        mesh.position.copy(face.foldedCentroid).addScaledVector(face.outward, EXPLODE * u);
        material.opacity = 1 - 0.55 * u;
      } else {
        mesh.position.lerpVectors(face.foldedCentroid, face.flatCentroid, u).add(scratch.copy(face.outward).multiplyScalar(Math.sin(Math.PI * u) * BURST));
        mesh.quaternion.slerpQuaternions(IDENTITY, face.flatRotation, u);
      }
      material.color.lerpColors(from, to, u);
    });
  });

  return (
    <group>
      {rig.map(({ face, material, stroke }, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geometry.faces[i]}
          material={material}
          position={face.foldedCentroid}
        >
          <lineSegments geometry={geometry.faceEdges[i]} material={stroke} />
        </mesh>
      ))}
      {shape.unfold === 'explode' && <Members node={node} />}
    </group>
  );
}

/** A d12's inside: its members as small dice on a sphere, growing in as the shell opens. */
function Members({ node }: { readonly node: GraphNode }) {
  const { dispatch } = useStore();
  const { shared } = useScene();
  const view = useView();
  const group = useRef<Mesh | null>(null);
  const members = useMemo(() => {
    const template = view.template(node);
    const ids = template.members
      ? readItems(template.members, { node, index: view.index }).filter((id): id is string => typeof id === 'string')
      : view.index.nodes.filter((n) => n.group === node.id && n.id !== node.id).map((n) => n.id);
    const count = ids.length;
    return ids.flatMap((id, i) => {
      const member = view.index.byId.get(id);
      if (!member) return [];
      // A Fibonacci sphere spreads any count evenly.
      const y = count === 1 ? 0 : 1 - (2 * i) / (count - 1);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * Math.PI * (3 - Math.sqrt(5));
      return [{ member, at: new Vector3(Math.cos(a) * r, y, Math.sin(a) * r), material: new MeshStandardMaterial({ color: view.color(member), flatShading: true }) }];
    });
  }, [view, node]);
  const meshes = useRef<(Mesh | null)[]>([]);
  useFrame(() => {
    const k = ease(clamp01(shared.unfoldT * 1.2 - 0.2));
    members.forEach((m, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      mesh.position.copy(m.at).multiplyScalar(MEMBER_ORBIT * k);
      mesh.scale.setScalar(MEMBER_SIZE * k + 0.0001);
    });
    void group;
  });
  const pick = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    dispatch({ type: 'collapse' });
    dispatch({ type: 'highlight', highlight: { label: `inside ${node.label}`, ids: [node.id, ...members.map((m) => m.member.id)] } });
    setTimeout(() => dispatch({ type: 'select', id }), 50);
  };
  const geometry = shapeGeometry(view.shape(node));
  return (
    <>
      {members.map((m, i) => (
        <mesh
          key={m.member.id}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          geometry={view.shape(m.member).id === 'd20' ? geometry.folded : shapeGeometry(view.shape(m.member)).folded}
          material={m.material}
          onClick={pick(m.member.id)}
          onPointerOver={(e) => {
            e.stopPropagation();
            dispatch({ type: 'hover', hover: { kind: 'ui', text: `${m.member.label} — ${m.member.legend}. Click to fold back and select it.` } });
          }}
        />
      ))}
    </>
  );
}

/** The cylinder: a side strip whose vertices travel from the round to the flat, and two swinging caps. */
function UnrollRig({ node, shape }: { readonly node: GraphNode; readonly shape: DieShape }) {
  const { shared } = useScene();
  const view = useView();
  const tick = useOpenClock(shared);
  const parts = useMemo(() => {
    const base = new Color(view.color(node));
    const cols = CYL_SEGMENTS + 1;
    const side = new BufferGeometry();
    side.setAttribute('position', new BufferAttribute(new Float32Array(cols * 2 * 3), 3));
    const index: number[] = [];
    for (let j = 0; j < CYL_SEGMENTS; j += 1) index.push(j, j + cols, j + 1, j + 1, j + cols, j + 1 + cols);
    side.setIndex(index);
    const sideMaterial = new MeshStandardMaterial({ color: base.clone(), side: DoubleSide, roughness: 0.55, metalness: 0.1 });
    const capGeometry = new CircleGeometry(CYL_R, 40);
    const capEdges = new EdgesGeometry(capGeometry, 1);
    const top = new Mesh(capGeometry, new MeshStandardMaterial({ color: base.clone(), side: DoubleSide }));
    const bottom = new Mesh(capGeometry, new MeshStandardMaterial({ color: base.clone(), side: DoubleSide }));
    const stroke = new LineBasicMaterial({ color: '#e8edf5', transparent: true, opacity: 0.85 });
    const regionY = (kind: 'self' | 'parent'): number => {
      const r = shape.regions.find((g) => g.kind === kind);
      return r ? r.rect.y - r.rect.h / 2 : 0;
    };
    return {
      base, side, sideMaterial, top, bottom, capEdges, stroke,
      topFlat: new Vector3(0, regionY('self'), CYL_R), lowFlat: new Vector3(0, regionY('parent'), CYL_R),
      faceUp: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
      faceDown: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
      self: tintColor('self', base), parent: tintColor('parent', base), cells: tintColor('down', base),
    };
  }, [view, node, shape]);

  useFrame((_, delta) => {
    const t = tick(delta);
    const u = ease(t);
    const pos = parts.side.getAttribute('position') as BufferAttribute;
    const cols = CYL_SEGMENTS + 1;
    for (let j = 0; j < cols; j += 1) {
      // θ = 0 at the front; the strip opens from the back seam.
      const theta = -Math.PI + (2 * Math.PI * j) / CYL_SEGMENTS;
      const fx = Math.sin(theta) * CYL_R;
      const fz = Math.cos(theta) * CYL_R;
      const x = fx + (theta * CYL_R - fx) * u;
      const z = fz + (CYL_R - fz) * u;
      pos.setXYZ(j, x, CYL_H / 2, z);
      pos.setXYZ(j + cols, x, -CYL_H / 2, z);
    }
    pos.needsUpdate = true;
    parts.side.computeVertexNormals();
    parts.top.position.lerpVectors(new Vector3(0, CYL_H / 2, 0), parts.topFlat, u);
    parts.top.quaternion.slerpQuaternions(parts.faceUp, IDENTITY, u);
    parts.bottom.position.lerpVectors(new Vector3(0, -CYL_H / 2, 0), parts.lowFlat, u);
    parts.bottom.quaternion.slerpQuaternions(parts.faceDown, IDENTITY, u);
    parts.sideMaterial.color.lerpColors(parts.base, parts.cells, u);
    (parts.top.material as MeshStandardMaterial).color.lerpColors(parts.base, parts.self, u);
    (parts.bottom.material as MeshStandardMaterial).color.lerpColors(parts.base, parts.parent, u);
  });

  return (
    <group>
      <mesh geometry={parts.side} material={parts.sideMaterial} />
      <primitive object={parts.top}>
        <lineSegments geometry={parts.capEdges} material={parts.stroke} />
      </primitive>
      <primitive object={parts.bottom}>
        <lineSegments geometry={parts.capEdges} material={parts.stroke} />
      </primitive>
    </group>
  );
}

export function UnfoldRig({ node }: { readonly node: GraphNode }) {
  const view = useView();
  const shape = view.shape(node);
  return shape.unfold === 'unroll' ? <UnrollRig node={node} shape={shape} /> : <FaceRig node={node} shape={shape} />;
}
