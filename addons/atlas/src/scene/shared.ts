/** Per-frame scene state shared by the meshes, outside React so a frame never re-renders. */
import { createContext, useContext } from 'react';
import { BufferGeometry, CanvasTexture, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, Quaternion, SRGBColorSpace, Vector3 } from 'three';

import { CYL_H, CYL_R, CYL_SEGMENTS, polygonGeometry, SHAPES, type DieShape, type ShapeId } from '../geometry/dice.ts';

import { faceGeometry, foldedGeometry, NET_FACES } from '../geometry/icosa.ts';
import type { GraphIndex } from '../graph/index.ts';
import type { Layout } from '../graph/layout.ts';

export interface SceneShared {
  readonly layout: Layout;
  /** Where each node is drawn this frame: layout + pan offset + the push-out while a node is unfolded. */
  readonly display: Float32Array;
  readonly offset: Vector3;
  dragging: boolean;
  /** The camera's turn when the unfold started; the net faces it until it folds back. */
  frozenQuat: Quaternion | null;
  unfoldT: number;
  cameraSettled: boolean;
  /** The DOM label of each node by id, plus `ACTIONS_KEY` for the selected node's buttons; placed every frame. */
  readonly labels: Map<string, HTMLElement>;
  /** Where an arranged lens wants each node (x, y per node), or null for the force layout. */
  targets: Float32Array | null;
  /** 1 where `targets` holds a place for the node. */
  targetOn: Uint8Array | null;
  /** The current camera's arrived turn: what 2D dice and open nets face. */
  modeQuat: Quaternion;
  /** True while a pointer is down on a node, so the navigator leaves that drag alone. */
  pressingNode: boolean;
}

export const ACTIONS_KEY = '__actions';

export interface SceneContextValue {
  readonly shared: SceneShared;
  readonly index: GraphIndex;
}

export const SceneContext = createContext<SceneContextValue | null>(null);

export function useScene(): SceneContextValue {
  const value = useContext(SceneContext);
  if (!value) throw new Error('useScene outside SceneContext');
  return value;
}

export const displayPosition = (shared: SceneShared, i: number, out: Vector3): Vector3 =>
  out.set(shared.display[i * 3]!, shared.display[i * 3 + 1]!, shared.display[i * 3 + 2]!);

export interface ShapeGeometry {
  readonly folded: BufferGeometry;
  readonly foldedEdges: BufferGeometry;
  /** Each face around its own folded centroid, for the open rigs. */
  readonly faces: readonly BufferGeometry[];
  readonly faceEdges: readonly BufferGeometry[];
}

const shapeGeometries = new Map<ShapeId, ShapeGeometry>();

/** A die's meshes, built once per shape. */
export function shapeGeometry(shape: DieShape): ShapeGeometry {
  const cached = shapeGeometries.get(shape.id);
  if (cached) return cached;
  const folded = shape.id === 'd20'
    ? foldedGeometry()
    : shape.id === 'cylinder'
      ? new CylinderGeometry(CYL_R, CYL_R, CYL_H, CYL_SEGMENTS)
      : mergeFaces(shape.faces.map((f) => polygonGeometry(f.folded)));
  const faces = shape.id === 'd20' ? NET_FACES.map((f) => faceGeometry(f)) : shape.faces.map((f) => polygonGeometry(f.folded, f.foldedCentroid));
  const built: ShapeGeometry = {
    folded,
    foldedEdges: new EdgesGeometry(folded, shape.id === 'cylinder' ? 30 : 1),
    faces,
    faceEdges: faces.map((g) => new EdgesGeometry(g, 1)),
  };
  shapeGeometries.set(shape.id, built);
  return built;
}

function mergeFaces(parts: readonly BufferGeometry[]): BufferGeometry {
  const positions = parts.flatMap((g) => [...(g.getAttribute('position').array as Float32Array)]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The d20's meshes, the default die. */
export const GEOMETRY: ShapeGeometry = shapeGeometry(SHAPES.d20);

const textures = new Map<string, CanvasTexture>();

/** An emoji drawn onto a transparent canvas, cached per glyph. */
export function emojiTexture(glyph: string): CanvasTexture {
  const cached = textures.get(glyph);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '84px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 72);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textures.set(glyph, texture);
  return texture;
}
