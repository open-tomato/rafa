/** The centre column: the WebGL canvas with the graph, plus the net overlay once a node is unfolded. */
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';

import type { GraphIndex } from '../graph/index.ts';
import { stepper, type Spring } from '../graph/layout.ts';
import { useView } from '../view.tsx';
import { useStore } from '../state.tsx';
import { NetOverlay } from '../ui/NetOverlay.tsx';
import { Toolbar } from '../ui/Toolbar.tsx';
import { CameraRig, type NetView } from './CameraRig.tsx';
import { Clouds } from './Clouds.tsx';
import { advance, heatValue, useGraphModel } from './model.ts';
import { Navigator } from './Navigator.tsx';
import { Orbits } from './Orbits.tsx';
import { BoxLayer, BoxProjector, Routes } from './Plots.tsx';
import { SequencePlayer, SequenceStage } from './Sequence.tsx';
import { D20 } from './D20.tsx';
import { Edges } from './Edges.tsx';
import { LabelLayer, LabelProjector } from './Labels.tsx';
import { SceneContext, type SceneShared } from './shared.ts';

const SPREAD = 55;

/** Moves the layout one step and writes this frame's draw positions. */
function Simulation({ shared, index, springs, flat }: { readonly shared: SceneShared; readonly index: GraphIndex; readonly springs: readonly Spring[]; readonly flat: boolean }) {
  const { state } = useStore();
  const step = useMemo(() => stepper(index.nodes, springs, flat), [index, springs, flat]);
  useFrame(() => {
    const expandedAt = state.expanded ? index.position.get(state.expanded) : undefined;
    advance(shared, index, step, { locked: state.locked, expandedAt, push: expandedAt === undefined ? 0 : shared.unfoldT * SPREAD });
  }, -1);
  return null;
}

export function GraphScene({ index }: { readonly index: GraphIndex }) {
  const { state, dispatch } = useStore();
  const view = useView();
  const [netView, setNetView] = useState<NetView | null>(null);
  const { lens, parts, shared, flat, arrangement, scenarios, scenario, visible, maxHeat, highlightIds, expandedNode } = useGraphModel(index);

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
          <Navigator flat={flat} />
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
