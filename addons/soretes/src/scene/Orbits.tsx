/**
 * Orbits: a well with a `ring` draws its radius `rest` around each holder,
 * and its members are held at that distance.
 *   circle  a line in the layout plane, for a flat lens
 *   sphere  a see-through shell, faint in the middle and bright at the rim,
 *           so it reads as a ball from any angle in 3D
 * A member two holders share sits where their orbits cross: a link in a chain.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineLoop, Mesh, ShaderMaterial, SphereGeometry, type Object3D } from 'three';

import type { LensSpec } from '../contract/types.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';
import { useScene } from './shared.ts';

const SEGMENTS = 96;
const LIT = 1;
const DIM = 0.2;
const CIRCLE_OPACITY = 0.5;
const SHELL_OPACITY = 0.55;

const circleGeometry = (): BufferGeometry => {
  const points = Array.from({ length: SEGMENTS }, (_, i) => {
    const a = (i / SEGMENTS) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a), 0];
  }).flat();
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3));
};

/** A fresnel shell: alpha rises toward the silhouette, where the surface turns away from the eye. */
function shellMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { color: { value: color }, opacity: { value: SHELL_OPACITY } },
    vertexShader: `
      varying float vRim;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vRim = 1.0 - abs(dot(n, normalize(-view.xyz)));
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vRim;
      void main() {
        float a = (0.06 + pow(vRim, 3.0) * 0.9) * opacity;
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

interface Orbit {
  readonly id: string;
  readonly anchor: number;
  readonly object: Object3D;
  readonly setOpacity: (k: number) => void;
}

export function Orbits({ lens, visible }: { readonly lens: LensSpec; readonly visible: ReadonlySet<string> }) {
  const { state } = useStore();
  const { shared } = useScene();
  const view = useView();
  const orbits = useMemo<Orbit[]>(() => {
    const circle = circleGeometry();
    const sphere = new SphereGeometry(1, 40, 24);
    return (lens.wells ?? []).filter((w) => w.ring).flatMap((well) =>
      view.index.nodes.filter((n) => visible.has(n.id) && view.matches(well.on, n)).map((holder) => {
        const color = new Color(view.color(holder));
        const anchor = view.index.position.get(holder.id) ?? 0;
        if (well.ring === 'sphere') {
          const material = shellMaterial(color);
          const object = new Mesh(sphere, material);
          object.scale.setScalar(well.rest ?? 4);
          object.frustumCulled = false;
          return { id: holder.id, anchor, object, setOpacity: (k: number) => (material.uniforms.opacity!.value = SHELL_OPACITY * k) };
        }
        const material = new LineBasicMaterial({ color, transparent: true, opacity: CIRCLE_OPACITY, depthWrite: false });
        const object = new LineLoop(circle, material);
        object.scale.setScalar(well.rest ?? 4);
        object.frustumCulled = false;
        return { id: holder.id, anchor, object, setOpacity: (k: number) => (material.opacity = CIRCLE_OPACITY * k) };
      }));
  }, [lens, view, visible]);
  useEffect(() => () => orbits.forEach((o) => ((o.object as Mesh).material as ShaderMaterial | LineBasicMaterial).dispose()), [orbits]);

  useFrame(() => {
    const d = shared.display;
    const focus = state.highlight ? new Set(state.highlight.ids) : null;
    const selectedType = state.selected ? view.index.byId.get(state.selected)?.type : undefined;
    for (const { id, anchor, object, setOpacity } of orbits) {
      object.position.set(d[anchor * 3]!, d[anchor * 3 + 1]!, d[anchor * 3 + 2]!);
      const holderType = view.index.byId.get(id)?.type;
      const lit = (!focus || focus.has(id)) && (state.selected === id || selectedType !== holderType);
      setOpacity((lit ? LIT : DIM) * (1 - shared.unfoldT * 0.95));
    }
  });

  return (
    <>
      {orbits.map((o) => <primitive key={o.id} object={o.object} />)}
    </>
  );
}
