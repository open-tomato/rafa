/**
 * What an arranged lens draws behind its nodes: plots, entity boxes, board
 * columns and lanes, lifelines, as plain DOM boxes the scene places every
 * frame (crisp text at any zoom), plus ELK's right-angle routes as 3D lines.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Vector3 } from 'three';

import type { Box, Route } from '../graph/arrange.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';
import { useScene } from './shared.ts';

const BOX_KEY = 'box:';
/** Row text height in world units, matching the entity rows ELK sized. */
const ROW_UNITS = 1.15;
const ROUTE_ALPHA = 0.55;

export function BoxLayer({ boxes }: { readonly boxes: readonly Box[] }) {
  const { shared } = useScene();
  const register = (id: string) => (el: HTMLElement | null): void => {
    if (el) shared.labels.set(`${BOX_KEY}${id}`, el);
    else shared.labels.delete(`${BOX_KEY}${id}`);
  };
  return (
    <div className="box-layer">
      {boxes.map((box) => (
        <div key={box.id} ref={register(box.id)} className={`plot-box ${box.kind}`} style={{ borderColor: box.color, ['--tint' as string]: box.color }}>
          {box.kind !== 'lifeline' && (
            <header>
              <b>{box.title}</b>
              {box.subtitle && <span>{box.subtitle}</span>}
            </header>
          )}
          {box.kind === 'lifeline' && <span className="lifeline-title">{box.title}</span>}
          {box.rows && (
            <ul>
              {box.rows.map((row, i) => (
                <li key={i}>
                  <span>{row.text}</span>
                  {row.tag && <i className={`key-${row.tag}`}>{row.tag}</i>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** Moves each DOM box over its world rectangle; the camera is face-on, so two corners place it. */
export function BoxProjector({ boxes }: { readonly boxes: readonly Box[] }) {
  const { shared } = useScene();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3() }), []);
  useFrame(() => {
    const o = shared.offset;
    for (const box of boxes) {
      const el = shared.labels.get(`${BOX_KEY}${box.id}`);
      if (!el) continue;
      v.a.set(box.x + o.x, box.y + o.y, o.z).project(camera);
      v.b.set(box.x + box.w + o.x, box.y - box.h + o.y, o.z).project(camera);
      const left = ((v.a.x + 1) / 2) * size.width;
      const top = ((1 - v.a.y) / 2) * size.height;
      const width = ((v.b.x + 1) / 2) * size.width - left;
      const height = ((1 - v.b.y) / 2) * size.height - top;
      el.style.transform = `translate(${left}px, ${top}px)`;
      el.style.width = `${Math.max(0, width)}px`;
      el.style.height = `${Math.max(0, height)}px`;
      el.style.fontSize = `${Math.max(6, (height / box.h) * ROW_UNITS * 0.78)}px`;
      el.style.opacity = String(1 - shared.unfoldT * 0.9);
    }
  });
  return null;
}

/** ELK's routes, one batch of segments per edge kind, bright when they touch the selection. */
export function Routes({ routes, visible }: { readonly routes: readonly Route[]; readonly visible: ReadonlySet<string> }) {
  const { state } = useStore();
  const { shared } = useScene();
  const view = useView();
  const batches = useMemo(() => {
    const kinds = [...new Set(routes.map((r) => r.kind))];
    return kinds.map((kind) => {
      const mine = routes.filter((r) => r.kind === kind);
      const segments = mine.flatMap((r) => r.points.slice(1).map((p, i) => ({ route: r, a: r.points[i]!, b: p })));
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(segments.length * 6), 3));
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(segments.length * 8), 4));
      const line = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      line.frustumCulled = false;
      return { kind, segments, line, color: new Color(view.edge(kind).color) };
    });
  }, [routes, view]);
  useEffect(() => () => batches.forEach((b) => {
    b.line.geometry.dispose();
    (b.line.material as LineBasicMaterial).dispose();
  }), [batches]);

  useFrame(() => {
    const o = shared.offset;
    for (const { kind, segments, line, color } of batches) {
      line.visible = !state.hiddenEdgeKinds.includes(kind);
      const pos = line.geometry.getAttribute('position') as BufferAttribute;
      const col = line.geometry.getAttribute('color') as BufferAttribute;
      segments.forEach(({ route, a, b }, i) => {
        const shown = visible.has(route.source) && visible.has(route.target);
        const touches = state.selected !== null && (route.source === state.selected || route.target === state.selected);
        const alpha = !shown ? 0 : state.selected ? (touches ? 0.95 : 0.12) : ROUTE_ALPHA;
        pos.setXYZ(i * 2, a[0] + o.x, a[1] + o.y, o.z - 0.05);
        pos.setXYZ(i * 2 + 1, b[0] + o.x, b[1] + o.y, o.z - 0.05);
        col.setXYZW(i * 2, color.r, color.g, color.b, alpha * (1 - shared.unfoldT));
        col.setXYZW(i * 2 + 1, color.r, color.g, color.b, alpha * (1 - shared.unfoldT));
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  });

  return (
    <>
      {batches.map((b) => <primitive key={b.kind} object={b.line} />)}
    </>
  );
}
