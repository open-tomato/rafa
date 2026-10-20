/**
 * A lens's clouds, drawn as soft puffs that drift around their nodes.
 *   aura  a few puffs on each member, in the holder's colour, blended additively:
 *         where two epics share a module their colours mix, so overlaps show
 *   fog   puffs hung on the node itself, more of them the larger the amount (log
 *         scale), in a murky colour: a dense knot reads as an infestation
 * Puffs are rebuilt when the lens or the visible set changes, and moved every frame.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, NormalBlending, Points, PointsMaterial, Sprite, SpriteMaterial, Vector3 } from 'three';

import { readItems, readNumber } from '../contract/bind.ts';
import type { CloudSpec, LensSpec } from '../contract/types.ts';
import { useStore } from '../state.tsx';
import { useView, type View } from '../view.tsx';
import { useScene } from './shared.ts';

const FOG_PER_DOUBLING = 4;
const FOG_MAX = 36;
const AURA_PER_MEMBER = 4;
const DRIFT = 0.45;
const LOOK = {
  fog: { size: 6.5, opacity: 0.32, blending: NormalBlending, radius: 2.6 },
  aura: { size: 10, opacity: 0.16, blending: AdditiveBlending, radius: 3.4 },
} as const;

interface Puff {
  readonly anchor: number;
  readonly offset: readonly [number, number, number];
  readonly color: Color;
  readonly phase: number;
}

let softTexture: CanvasTexture | null = null;

function soft(): CanvasTexture {
  if (softTexture) return softTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  softTexture = new CanvasTexture(canvas);
  return softTexture;
}

/** A point in a ball, denser toward the middle, from a seed so a cloud keeps its shape between rebuilds. */
function scatter(seed: number, radius: number): [number, number, number] {
  const r = (n: number): number => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const theta = r(1) * Math.PI * 2;
  const phi = Math.acos(2 * r(2) - 1);
  const d = radius * r(3) ** 0.7;
  return [d * Math.sin(phi) * Math.cos(theta), d * Math.sin(phi) * Math.sin(theta) * 0.8, d * Math.cos(phi)];
}

/** The ids a cloud wraps for one holder, from each of its member fields. */
function membersOf(cloud: CloudSpec, holderId: string, view: View): string[] {
  const holder = view.index.byId.get(holderId);
  if (!holder || !cloud.members) return [];
  const fields = typeof cloud.members === 'string' ? [cloud.members] : cloud.members;
  return fields.flatMap((f) => readItems(f, { node: holder, index: view.index })).filter((id): id is string => typeof id === 'string');
}

const BUBBLE_PAD = 2.6;
const BUBBLE_MIN = 3.5;
const BUBBLE_EASE = 0.12;
const BUBBLE_OPACITY = 0.2;
const BUBBLE_DIM = 0.05;
let bubbleTexture: CanvasTexture | null = null;

/** A disc that is faint inside and brighter toward a soft rim, so its edge reads as a boundary. */
function bubbleMap(): CanvasTexture {
  if (bubbleTexture) return bubbleTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.32)');
    g.addColorStop(0.92, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  bubbleTexture = new CanvasTexture(canvas);
  return bubbleTexture;
}

interface Bubble {
  readonly id: string;
  readonly anchor: number;
  readonly members: readonly number[];
  readonly sprite: Sprite;
  radius: number;
}

function BubbleLayer({ clouds, visible }: { readonly clouds: readonly CloudSpec[]; readonly visible: ReadonlySet<string> }) {
  const { state } = useStore();
  const { shared } = useScene();
  const view = useView();
  const bubbles = useMemo<Bubble[]>(() => clouds.flatMap((cloud) =>
    view.index.nodes.filter((n) => visible.has(n.id) && view.matches(cloud.on, n)).map((holder) => {
      const members = membersOf(cloud, holder.id, view).filter((id) => visible.has(id)).map((id) => view.index.position.get(id)).filter((i): i is number => i !== undefined);
      const material = new SpriteMaterial({ map: bubbleMap(), color: new Color(cloud.color ?? view.color(holder)), transparent: true, opacity: BUBBLE_OPACITY, depthWrite: false, blending: AdditiveBlending });
      return { id: holder.id, anchor: view.index.position.get(holder.id) ?? 0, members, sprite: new Sprite(material), radius: BUBBLE_MIN };
    })), [clouds, view, visible]);
  useEffect(() => () => bubbles.forEach((b) => b.sprite.material.dispose()), [bubbles]);
  const at = useMemo(() => ({ c: new Vector3(), m: new Vector3() }), []);

  useFrame(() => {
    const d = shared.display;
    const focus = state.highlight ? new Set(state.highlight.ids) : null;
    for (const b of bubbles) {
      at.c.set(d[b.anchor * 3]!, d[b.anchor * 3 + 1]!, d[b.anchor * 3 + 2]!);
      const reach = b.members.reduce((acc, i) => Math.max(acc, at.m.set(d[i * 3]!, d[i * 3 + 1]!, d[i * 3 + 2]!).distanceTo(at.c)), 0);
      b.radius += (Math.max(BUBBLE_MIN, reach + BUBBLE_PAD) - b.radius) * BUBBLE_EASE;
      b.sprite.position.copy(at.c);
      b.sprite.scale.setScalar(b.radius * 2);
      const lit = (!focus || focus.has(b.id)) && (state.selected === null || state.selected === b.id || view.index.byId.get(state.selected)?.type !== view.index.byId.get(b.id)?.type);
      b.sprite.material.opacity = (lit ? BUBBLE_OPACITY : BUBBLE_DIM) * (1 - shared.unfoldT * 0.9);
    }
  });

  return (
    <>
      {bubbles.map((b) => <primitive key={b.id} object={b.sprite} />)}
    </>
  );
}

function puffsFor(cloud: CloudSpec, view: View, visible: ReadonlySet<string>): Puff[] {
  const { index } = view;
  const radius = cloud.radius ?? LOOK[cloud.look === 'fog' ? 'fog' : 'aura'].radius;
  return index.nodes.filter((n) => visible.has(n.id) && view.matches(cloud.on, n)).flatMap((holder) => {
    const color = new Color(cloud.color ?? view.color(holder));
    if (cloud.look === 'aura') {
      const members = cloud.members ? membersOf(cloud, holder.id, view).filter((id) => visible.has(id)) : [holder.id];
      return members.flatMap((id) => {
        const anchor = index.position.get(id);
        if (anchor === undefined) return [];
        return Array.from({ length: AURA_PER_MEMBER }, (_, k) => {
          const seed = anchor * 97 + k + holder.id.length * 7;
          return { anchor, offset: scatter(seed, radius), color, phase: seed };
        });
      });
    }
    const amount = cloud.amount ? (readNumber(cloud.amount, { node: holder, index }) ?? 0) : 0;
    const count = Math.min(FOG_MAX, Math.round(FOG_PER_DOUBLING * Math.log2(1 + amount)));
    const anchor = index.position.get(holder.id) ?? 0;
    return Array.from({ length: count }, (_, k) => ({ anchor, offset: scatter(anchor * 131 + k, radius * (0.7 + Math.min(1, count / FOG_MAX) * 0.6)), color, phase: anchor + k }));
  });
}

function CloudLayer({ look, puffs }: { readonly look: 'aura' | 'fog'; readonly puffs: readonly Puff[] }) {
  const { shared } = useScene();
  const points = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(puffs.length * 3), 3));
    const colors = new Float32Array(puffs.length * 3);
    puffs.forEach((p, i) => colors.set([p.color.r, p.color.g, p.color.b], i * 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const style = LOOK[look];
    const material = new PointsMaterial({ size: style.size, map: soft(), vertexColors: true, transparent: true, opacity: style.opacity, depthWrite: false, blending: style.blending, sizeAttenuation: true });
    const object = new Points(geometry, material);
    object.frustumCulled = false;
    return object;
  }, [look, puffs]);
  useEffect(() => () => {
    points.geometry.dispose();
    (points.material as PointsMaterial).dispose();
  }, [points]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pos = points.geometry.getAttribute('position') as BufferAttribute;
    const d = shared.display;
    puffs.forEach((p, i) => {
      const a = p.anchor * 3;
      pos.setXYZ(
        i,
        d[a]! + p.offset[0] + Math.sin(t * 0.37 + p.phase) * DRIFT,
        d[a + 1]! + p.offset[1] + Math.cos(t * 0.29 + p.phase * 1.3) * DRIFT,
        d[a + 2]! + p.offset[2] + Math.sin(t * 0.23 + p.phase * 0.7) * DRIFT,
      );
    });
    pos.needsUpdate = true;
    (points.material as PointsMaterial).opacity = LOOK[look].opacity * (1 - shared.unfoldT * 0.9);
  });

  return <primitive object={points} />;
}

export function Clouds({ lens, visible }: { readonly lens: LensSpec; readonly visible: ReadonlySet<string> }) {
  const view = useView();
  const layers = useMemo(() => {
    const clouds = lens.clouds ?? [];
    return (['aura', 'fog'] as const).map((look) => ({ look, puffs: clouds.filter((c) => c.look === look).flatMap((c) => puffsFor(c, view, visible)) }));
  }, [lens, view, visible]);
  const bubbles = useMemo(() => (lens.clouds ?? []).filter((c) => c.look === 'bubble'), [lens]);
  return (
    <>
      {bubbles.length > 0 && <BubbleLayer clouds={bubbles} visible={visible} />}
      {layers.filter((l) => l.puffs.length > 0).map((l) => <CloudLayer key={l.look} look={l.look} puffs={l.puffs} />)}
    </>
  );
}
