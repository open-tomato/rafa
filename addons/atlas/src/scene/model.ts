/**
 * What both renderers draw, worked out once: which nodes a lens lets take
 * part, the layout and its arranged places, and what is visible after the
 * filters and the depth control. The 3D scene and the 2D board read it the
 * same way, so a lens, a filter or a selection means the same in both.
 */
import { useEffect, useMemo, useState } from 'react';
import { Quaternion, Vector3 } from 'three';

import { readItems, readNumber } from '../contract/bind.ts';
import type { LensSpec, Scenario } from '../contract/types.ts';
import { arrange, participants, type Arrangement } from '../graph/arrange.ts';
import type { GraphIndex } from '../graph/index.ts';
import { activate, createLayout, springFrom, springsFor, type Pull, type Spring } from '../graph/layout.ts';
import { useStore, type HeatKey, type UiState } from '../state.tsx';
import type { GraphNode } from '../types.ts';
import type { View } from '../view.tsx';
import { useView } from '../view.tsx';
import type { SceneShared } from './shared.ts';

/** How far a node moves toward its arranged place each frame. */
const ARRIVE = 0.12;

/** A heat widget's value on a node, 0 when it binds to nothing there. */
export const heatValue = (node: GraphNode, key: HeatKey, view: View): number => {
  const widget = key === 'none' ? undefined : view.widget(key);
  return widget ? (readNumber(widget.value, { node, index: view.index }) ?? 0) : 0;
};

export function isVisible(node: GraphNode, state: UiState): boolean {
  return !state.hiddenTypes.includes(node.type) && !state.hiddenGroups.includes(node.group);
}

export interface LensParts {
  /** Per node, in index order: whether the lens lets it take part. */
  readonly active: readonly boolean[];
  readonly springs: readonly Spring[];
  /** Edge kinds the lens draws as lines. */
  readonly lines: ReadonlySet<string>;
}

/** What a lens means for the layout: who takes part, which springs act (edges and wells), what is drawn. */
function lensParts(view: View, lens: LensSpec): LensParts {
  const { index } = view;
  const pulls: Pull[] = (lens.wells ?? []).flatMap((well) =>
    index.nodes.filter((n) => view.matches(well.on, n)).flatMap((holder) =>
      readItems(well.members, { node: holder, index })
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ from: holder.id, to: id, rest: well.rest ?? 4, stiffness: well.stiffness ?? 0.04 }))));
  // A well's `only` types take part only as some holder's member: the rest of that type sit out.
  const listed = new Set(pulls.map((p) => p.to));
  const onlyTypes = new Set((lens.wells ?? []).flatMap((w) => w.only ?? []));
  return {
    active: index.nodes.map((n) => view.matches(lens.types, n) && (!onlyTypes.has(n.type) || listed.has(n.id))),
    springs: springsFor(index.nodes, index.edges, springFrom(view.config.edgeKinds), (e) => view.role(lens, e.kind) !== 'hidden', pulls),
    lines: new Set(view.edgeKinds.filter((k) => view.role(lens, k) === 'line')),
  };
}

/** Drops the nodes a well keeps `only` for its members when none of their holders is showing. */
function onlyUnderVisibleHolders(nodes: readonly GraphNode[], lens: LensSpec, view: View): GraphNode[] {
  return (lens.wells ?? []).filter((w) => w.only).reduce<GraphNode[]>((kept, well) => {
    const allowed = new Set(kept.filter((n) => view.matches(well.on, n)).flatMap((holder) =>
      readItems(well.members, { node: holder, index: view.index }).filter((id): id is string => typeof id === 'string')));
    return kept.filter((n) => !well.only?.includes(n.type) || allowed.has(n.id));
  }, [...nodes]);
}

export interface AdvanceOptions {
  readonly locked: boolean;
  /** The unfolded node's index, if any: the others are pushed out from it by `push`. */
  readonly expandedAt?: number;
  readonly push: number;
}

/**
 * Moves the layout one step and writes this frame's draw positions into
 * `shared.display`: an arranged lens slides each node to its place, a free
 * one steps the forces unless locked or unfolded.
 */
export function advance(shared: SceneShared, index: GraphIndex, step: (layout: SceneShared['layout']) => boolean, options: AdvanceOptions): void {
  const p = shared.layout.positions;
  const targets = shared.targets;
  if (targets && shared.targetOn) {
    for (let i = 0; i < index.nodes.length; i += 1) {
      if (!shared.targetOn[i] || shared.layout.fixed[i]) continue;
      p[i * 3] = p[i * 3]! + (targets[i * 2]! - p[i * 3]!) * ARRIVE;
      p[i * 3 + 1] = p[i * 3 + 1]! + (targets[i * 2 + 1]! - p[i * 3 + 1]!) * ARRIVE;
      p[i * 3 + 2] = p[i * 3 + 2]! * (1 - ARRIVE);
    }
  } else if (!options.locked && options.expandedAt === undefined) {
    step(shared.layout);
  }
  const out = shared.display;
  const at = options.expandedAt;
  const cx = at === undefined ? 0 : p[at * 3]!;
  const cy = at === undefined ? 0 : p[at * 3 + 1]!;
  const cz = at === undefined ? 0 : p[at * 3 + 2]!;
  for (let i = 0; i < index.nodes.length; i += 1) {
    let x = p[i * 3]!;
    let y = p[i * 3 + 1]!;
    let z = p[i * 3 + 2]!;
    if (options.push > 0 && at !== undefined && i !== at) {
      const d = Math.hypot(x - cx, y - cy, z - cz) || 1;
      x += ((x - cx) / d) * options.push;
      y += ((y - cy) / d) * options.push;
      z += ((z - cz) / d) * options.push;
    }
    out[i * 3] = x + shared.offset.x;
    out[i * 3 + 1] = y + shared.offset.y;
    out[i * 3 + 2] = z + shared.offset.z;
  }
}

export interface GraphModel {
  readonly lens: LensSpec;
  readonly parts: LensParts;
  readonly shared: SceneShared;
  /** True for a lens drawn on one plane: `flat`, or any `arrange`. */
  readonly flat: boolean;
  readonly arrangement: Arrangement | null;
  readonly scenarios: readonly Scenario[];
  readonly scenario: Scenario | undefined;
  readonly visibleNodes: readonly GraphNode[];
  readonly visible: ReadonlySet<string>;
  readonly maxHeat: number;
  readonly highlightIds: ReadonlySet<string> | null;
  readonly expandedNode: GraphNode | undefined;
}

export function useGraphModel(index: GraphIndex): GraphModel {
  const { state, dispatch } = useStore();
  const view = useView();
  const lens = view.lens(state.lens);
  const parts = useMemo(() => lensParts(view, lens), [view, lens]);
  const shared = useMemo<SceneShared>(() => {
    const layout = createLayout(index.nodes, parts.springs, parts.active);
    return { layout, display: new Float32Array(layout.positions), offset: new Vector3(), dragging: false, frozenQuat: null, unfoldT: 0, cameraSettled: false, labels: new Map(), targets: null, targetOn: null, modeQuat: new Quaternion(), pressingNode: false };
    // Built once per snapshot; a lens switch re-activates it below instead of starting over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, view]);
  const flat = Boolean(lens.flat || lens.arrange);
  useEffect(() => {
    activate(shared.layout, parts.springs, parts.active);
    if (flat) dispatch({ type: 'view-mode', mode: 'front' });
    const timer = setTimeout(() => dispatch({ type: 'camera', kind: 'fit' }), 900);
    return () => clearTimeout(timer);
  }, [shared, parts, flat, dispatch]);

  // An arranged lens computes fixed places (ELK runs async), then the nodes slide there.
  const scenarios = view.index.scenarios;
  const scenario = scenarios.find((s) => s.id === state.scenario) ?? scenarios[0];
  const candidates = index.nodes.filter((n, i) => parts.active[i] && isVisible(n, state));
  const candidateKey = candidates.map((n) => n.id).join('|');
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  useEffect(() => {
    if (!lens.arrange) {
      setArrangement(null);
      shared.targets = null;
      shared.targetOn = null;
      return;
    }
    let alive = true;
    const pool = lens.arrange.kind === 'sequence' && scenario ? index.nodes.filter((n) => participants(scenario).includes(n.id)) : candidates;
    const keep = (e: { kind: string; weight: number }): boolean => e.kind !== view.config.weightedKind || e.weight >= state.minImportWeight;
    void arrange(lens.arrange, view, pool, scenario, keep).then((laid) => {
      if (!alive) return;
      const targets = new Float32Array(index.nodes.length * 2);
      const on = new Uint8Array(index.nodes.length);
      for (const [id, [x, y]] of laid.positions) {
        const i = index.position.get(id);
        if (i === undefined) continue;
        targets[i * 2] = x;
        targets[i * 2 + 1] = y;
        on[i] = 1;
      }
      shared.offset.set(0, 0, 0);
      shared.targets = targets;
      shared.targetOn = on;
      setArrangement(laid);
      dispatch({ type: 'view-mode', mode: 'front' });
      dispatch({ type: 'camera', kind: 'fit' });
    }).catch((error: unknown) => {
      if (alive) dispatch({ type: 'hover', hover: { kind: 'ui', text: `The layout failed: ${error instanceof Error ? error.message : String(error)}` } });
    });
    return () => {
      alive = false;
    };
    // `candidateKey` stands for `candidates`, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, view, candidateKey, scenario, shared, index, dispatch, state.minImportWeight]);
  // The depth control keeps the selected node's neighbourhood, over the links the lens keeps.
  const reach = state.depth > 0 && state.selected
    ? index.within(state.selected, state.depth, state.depthDirection, (e) => view.role(lens, e.kind) !== 'hidden' && !state.hiddenEdgeKinds.includes(e.kind) && (e.kind !== view.config.weightedKind || e.weight >= state.minImportWeight))
    : null;
  const shown = index.nodes.filter((n, i) => parts.active[i] && isVisible(n, state) && (!reach || reach.has(n.id)));
  const arranged = lens.arrange ? (arrangement?.positions ?? new Map()) : null;
  const visibleNodes = onlyUnderVisibleHolders(shown, lens, view).filter((n) => !arranged || arranged.has(n.id));
  const visibleKey = visibleNodes.map((n) => n.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visible = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleKey]);
  return {
    lens,
    parts,
    shared,
    flat,
    arrangement,
    scenarios,
    scenario,
    visibleNodes,
    visible,
    maxHeat: Math.max(1e-9, ...visibleNodes.map((n) => heatValue(n, state.heat, view))),
    highlightIds: state.highlight ? new Set(state.highlight.ids) : null,
    expandedNode: state.expanded ? index.byId.get(state.expanded) : undefined,
  };
}
