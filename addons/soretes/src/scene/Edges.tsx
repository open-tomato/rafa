/** The links: one line batch per edge kind, each with its own colour and dash, refilled every frame. */
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineDashedMaterial, LineSegments } from 'three';

import { useStore } from '../state.tsx';
import type { EdgeKind, GraphEdge } from '../types.ts';
import { useView } from '../view.tsx';
import { useScene } from './shared.ts';

interface Batch {
  readonly kind: EdgeKind;
  readonly edges: readonly { readonly edge: GraphEdge; readonly a: number; readonly b: number; readonly base: number }[];
  readonly line: LineSegments;
}

function baseAlpha(edge: GraphEdge, weightedKind: string | undefined): number {
  return edge.kind === weightedKind ? 0.12 + 0.55 * Math.min(1, Math.log2(Math.max(1, edge.weight)) / 7) : 0.55;
}

export function Edges({ visible, lines }: { readonly visible: ReadonlySet<string>; readonly lines: ReadonlySet<string> }) {
  const { state } = useStore();
  const { shared, index } = useScene();
  const view = useView();
  const weighted = view.config.weightedKind;
  const batches = useMemo<Batch[]>(() => view.edgeKinds.map((kind) => {
    const edges = index.edges.filter((e) => e.kind === kind).flatMap((edge) => {
      const a = index.position.get(edge.source);
      const b = index.position.get(edge.target);
      return a === undefined || b === undefined ? [] : [{ edge, a, b, base: baseAlpha(edge, weighted) }];
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(edges.length * 6), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(edges.length * 8), 4));
    const style = view.edge(kind);
    const material = style.dash > 0
      ? new LineDashedMaterial({ vertexColors: true, transparent: true, dashSize: style.dash, gapSize: style.dash * 0.8, depthWrite: false })
      : new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const line = new LineSegments(geometry, material);
    line.frustumCulled = false;
    return { kind, edges, line };
  }), [index, view, weighted]);
  const colors = useMemo(() => new Map(view.edgeKinds.map((k) => [k, new Color(view.edge(k).color)])), [view]);

  useFrame(() => {
    const focus = state.highlight ? new Set(state.highlight.ids) : null;
    const fade = state.expanded ? 1 - shared.unfoldT * 0.95 : 1;
    const d = shared.display;
    for (const { kind, edges, line } of batches) {
      const on = lines.has(kind) && !state.hiddenEdgeKinds.includes(kind);
      line.visible = on;
      if (!on) continue;
      const pos = line.geometry.getAttribute('position') as BufferAttribute;
      const col = line.geometry.getAttribute('color') as BufferAttribute;
      const c = colors.get(kind) ?? new Color('#8fa3bf');
      let n = 0;
      for (const { edge, a, b, base } of edges) {
        if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
        if (kind === weighted && edge.weight < state.minImportWeight) continue;
        const touchesSelected = state.selected !== null && (edge.source === state.selected || edge.target === state.selected);
        let alpha = base;
        if (focus) alpha = focus.has(edge.source) && focus.has(edge.target) ? 0.95 : 0.03;
        else if (state.selected) alpha = touchesSelected ? 0.95 : base * 0.45;
        alpha *= fade;
        for (const [k, node] of [[0, a], [1, b]] as const) {
          pos.setXYZ(n * 2 + k, d[node * 3]!, d[node * 3 + 1]!, d[node * 3 + 2]!);
          col.setXYZW(n * 2 + k, c.r, c.g, c.b, alpha);
        }
        n += 1;
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      line.geometry.setDrawRange(0, n * 2);
      if (line.material instanceof LineDashedMaterial) line.computeLineDistances();
    }
  });

  return (
    <>
      {batches.map(({ kind, line }) => <primitive key={kind} object={line} />)}
    </>
  );
}
