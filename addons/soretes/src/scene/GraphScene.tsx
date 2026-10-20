/** The centre column: the WebGL canvas with the graph, plus the net overlay once a node is unfolded. */
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { Vector3 } from 'three';

import type { GraphIndex } from '../graph/index.ts';
import { readItems, readNumber } from '../contract/bind.ts';
import type { LensSpec } from '../contract/types.ts';
import { arrange, participants, type Arrangement } from '../graph/arrange.ts';
import { activate, createLayout, springFrom, springsFor, stepper, type Pull, type Spring } from '../graph/layout.ts';
import { useView, type View } from '../view.tsx';
import { useStore, type HeatKey, type UiState } from '../state.tsx';
import type { GraphNode } from '../types.ts';
import { NetOverlay } from '../ui/NetOverlay.tsx';
import { Toolbar } from '../ui/Toolbar.tsx';
import { CameraRig, type NetView } from './CameraRig.tsx';
import { Clouds } from './Clouds.tsx';
import { Orbits } from './Orbits.tsx';
import { BoxLayer, BoxProjector, Routes } from './Plots.tsx';
import { SequencePlayer, SequenceStage } from './Sequence.tsx';
import { D20 } from './D20.tsx';
import { Edges } from './Edges.tsx';
import { LabelLayer, LabelProjector } from './Labels.tsx';
import { SceneContext, type SceneShared } from './shared.ts';

const SPREAD = 55;
/** How far a node moves toward its arranged place each frame. */
const ARRIVE = 0.12;

/** A heat widget's value on a node, 0 when it binds to nothing there. */
const heatValue = (node: GraphNode, key: HeatKey, view: View): number => {
  const widget = key === 'none' ? undefined : view.widget(key);
  return widget ? (readNumber(widget.value, { node, index: view.index }) ?? 0) : 0;
};

export function isVisible(node: GraphNode, state: UiState): boolean {
  return !state.hiddenTypes.includes(node.type) && !state.hiddenGroups.includes(node.group);
}

interface LensParts {
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

/** Moves the layout one step and writes this frame's draw positions. */
function Simulation({ shared, index, springs, flat }: { readonly shared: SceneShared; readonly index: GraphIndex; readonly springs: readonly Spring[]; readonly flat: boolean }) {
  const { state } = useStore();
  const step = useMemo(() => stepper(index.nodes, springs, flat), [index, springs, flat]);
  const center = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const p = shared.layout.positions;
    const targets = shared.targets;
    if (targets && shared.targetOn) {
      // An arranged lens: slide each node to its place on the plane instead of stepping the forces.
      for (let i = 0; i < index.nodes.length; i += 1) {
        if (!shared.targetOn[i] || shared.layout.fixed[i]) continue;
        p[i * 3] = p[i * 3]! + (targets[i * 2]! - p[i * 3]!) * ARRIVE;
        p[i * 3 + 1] = p[i * 3 + 1]! + (targets[i * 2 + 1]! - p[i * 3 + 1]!) * ARRIVE;
        p[i * 3 + 2] = p[i * 3 + 2]! * (1 - ARRIVE);
      }
    } else if (!state.locked && !state.expanded) {
      step(shared.layout);
    }
    const out = shared.display;
    const expandedAt = state.expanded ? index.position.get(state.expanded) : undefined;
    if (expandedAt !== undefined) center.set(p[expandedAt * 3]!, p[expandedAt * 3 + 1]!, p[expandedAt * 3 + 2]!);
    const push = expandedAt === undefined ? 0 : shared.unfoldT * SPREAD;
    for (let i = 0; i < index.nodes.length; i += 1) {
      let x = p[i * 3]!;
      let y = p[i * 3 + 1]!;
      let z = p[i * 3 + 2]!;
      if (push > 0 && i !== expandedAt) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        x += (dx / d) * push;
        y += (dy / d) * push;
        z += (dz / d) * push;
      }
      out[i * 3] = x + shared.offset.x;
      out[i * 3 + 1] = y + shared.offset.y;
      out[i * 3 + 2] = z + shared.offset.z;
    }
  }, -1);
  return null;
}

export function GraphScene({ index }: { readonly index: GraphIndex }) {
  const { state, dispatch } = useStore();
  const view = useView();
  const [netView, setNetView] = useState<NetView | null>(null);
  const lens = view.lens(state.lens);
  const parts = useMemo(() => lensParts(view, lens), [view, lens]);
  const shared = useMemo<SceneShared>(() => {
    const layout = createLayout(index.nodes, parts.springs, parts.active);
    return { layout, display: new Float32Array(layout.positions), offset: new Vector3(), dragging: false, frozenQuat: null, unfoldT: 0, cameraSettled: false, labels: new Map(), targets: null, targetOn: null };
    // Built once per snapshot; a lens switch re-activates it below instead of starting over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, view]);
  const flat = Boolean(lens.flat || lens.arrange);
  useEffect(() => {
    activate(shared.layout, parts.springs, parts.active);
    const timer = setTimeout(() => dispatch({ type: 'camera', kind: flat ? 'front' : 'fit' }), 900);
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
      dispatch({ type: 'camera', kind: 'front' });
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
  const visible = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes.map((n) => n.id).join('|')]);
  const maxHeat = Math.max(1e-9, ...visibleNodes.map((n) => heatValue(n, state.heat, view)));
  const highlightIds = state.highlight ? new Set(state.highlight.ids) : null;
  const expandedNode = state.expanded ? index.byId.get(state.expanded) : undefined;

  return (
    <SceneContext.Provider value={{ shared, index }}>
      <div className="scene">
        <Canvas
          camera={{ position: [0, 14, 78], fov: 45, near: 0.5, far: 6000 }}
          dpr={[1, 2]}
          onPointerMissed={() => {
            if (!state.expanded) dispatch({ type: 'select', id: null });
          }}
        >
          <color attach="background" args={['#0b0e13']} />
          {/* Depth fog helps a 3D cloud read; a flat view sits at one depth and only loses its far side. */}
          {!flat && <fog attach="fog" args={['#0b0e13', 160, 420]} />}
          <ambientLight intensity={0.55} />
          <directionalLight position={[30, 40, 60]} intensity={1.6} />
          <directionalLight position={[-40, -20, -30]} intensity={0.5} color="#7aa2f7" />
          <Simulation shared={shared} index={index} springs={parts.springs} flat={flat} />
          <Orbits lens={lens} visible={visible} />
          <Edges visible={visible} lines={arrangement && lens.arrange?.kind === 'plots' ? new Set([...parts.lines].filter((k) => !(lens.arrange?.kind === 'plots' && lens.arrange.routed.includes(k)))) : parts.lines} />
          {arrangement && <Routes routes={arrangement.routes} visible={visible} />}
          {arrangement && <BoxProjector boxes={arrangement.boxes} />}
          {lens.arrange?.kind === 'sequence' && scenario && <SequenceStage scenario={scenario} />}
          <Clouds lens={lens} visible={visible} />
          {index.nodes.map((node) => (
            <D20
              key={node.id}
              node={node}
              hidden={!visible.has(node.id)}
              at={index.position.get(node.id) ?? 0}
              heat={Math.sqrt(heatValue(node, state.heat, view) / maxHeat)}
              dim={highlightIds !== null && !highlightIds.has(node.id)}
            />
          ))}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={2400} />
          <CameraRig visible={visible} onNetView={setNetView} flat={flat} />
          <LabelProjector visible={visible} />
        </Canvas>
        {arrangement && <BoxLayer boxes={arrangement.boxes} />}
        <LabelLayer index={index} visible={visible} dimmed={highlightIds} />
        {lens.arrange?.kind === 'sequence' && <SequencePlayer scenarios={scenarios} scenario={scenario} />}
        <Toolbar />
        {expandedNode && state.unfolded && netView && <NetOverlay node={expandedNode} unitPx={netView.unitPx} edgePx={netView.edgePx} />}
      </div>
    </SceneContext.Provider>
  );
}
