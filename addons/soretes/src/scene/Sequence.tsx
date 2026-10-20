/**
 * The time warp: a scenario replayed as a request moving between its
 * participants. The stage (inside the canvas) moves the request and draws
 * the link it travels; the player (over the canvas) holds the clock: play,
 * pause, step, rewind, a timeline, and the choice at a fork.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';

import type { Scenario, ScenarioStep } from '../contract/types.ts';
import { useStore } from '../state.tsx';
import { useView } from '../view.tsx';
import { displayPosition, useScene } from './shared.ts';

const STEP_SECONDS = 1.1;
const MESSAGE_KEY = '__message';
const REQUEST_COLOR = '#ff6b4a';
const REPLY_COLOR = '#7dcfff';
const TRAIL_COLOR = '#8892a6';

interface Clock {
  readonly step: number;
  readonly playing: boolean;
  /** Steps already travelled, oldest first: the way back for ◀. */
  readonly history: readonly number[];
}

// One clock for the player and the stage. `t`, the progress along the current
// step, changes every frame, so it lives outside the subscribed state.
let clock: Clock = { step: 0, playing: false, history: [] };
const progress = { t: 0 };
const listeners = new Set<() => void>();
const setClock = (next: Partial<Clock>): void => {
  clock = { ...clock, ...next };
  listeners.forEach((l) => l());
};
const useClock = (): Clock => useSyncExternalStore((l) => {
  listeners.add(l);
  return () => listeners.delete(l);
}, () => clock);

const nextOf = (scenario: Scenario, at: number): number => {
  const step = scenario.steps[at];
  if (!step) return -1;
  const next = step.next ?? at + 1;
  return next >= scenario.steps.length ? -1 : next;
};

/** The path the clock walks by default: each fork takes its first option. */
function mainPath(scenario: Scenario): number[] {
  const path: number[] = [];
  let at = 0;
  while (at >= 0 && at < scenario.steps.length && !path.includes(at)) {
    path.push(at);
    const step = scenario.steps[at];
    at = step?.choice ? (step.choice.options[0]?.goto ?? -1) : nextOf(scenario, at);
  }
  return path;
}

/** The current step finished: stop at a fork or the end, else move on. */
function arrive(scenario: Scenario): void {
  const step = scenario.steps[clock.step];
  progress.t = 1;
  if (step?.choice) {
    setClock({ playing: false });
    return;
  }
  const next = nextOf(scenario, clock.step);
  if (next < 0) {
    setClock({ playing: false });
    return;
  }
  progress.t = 0;
  setClock({ step: next, history: [...clock.history, clock.step] });
}

export function SequenceStage({ scenario }: { readonly scenario: Scenario }) {
  const { shared, index } = useScene();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const current = useClock();
  const parts = useMemo(() => {
    const particle = new Mesh(new SphereGeometry(0.55, 20, 12), new MeshBasicMaterial({ color: REQUEST_COLOR }));
    const link = new LineSegments(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)), new LineDashedMaterial({ color: REQUEST_COLOR, dashSize: 0.8, gapSize: 0.5, transparent: true }));
    const trail = new LineSegments(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(scenario.steps.length * 6), 3)), new LineBasicMaterial({ color: TRAIL_COLOR, transparent: true, opacity: 0.35 }));
    link.frustumCulled = false;
    trail.frustumCulled = false;
    return { particle, link, trail, a: new Vector3(), b: new Vector3(), p: new Vector3() };
  }, [scenario]);
  useEffect(() => {
    progress.t = 0;
    setClock({ step: 0, playing: true, history: [] });
  }, [scenario]);

  useFrame((_, delta) => {
    const step = scenario.steps[current.step];
    if (!step) return;
    const from = index.position.get(step.from);
    const to = index.position.get(step.to);
    if (from === undefined || to === undefined) return;
    if (current.playing) {
      progress.t = Math.min(1, progress.t + delta / STEP_SECONDS);
      if (progress.t >= 1) arrive(scenario);
    }
    displayPosition(shared, from, parts.a);
    displayPosition(shared, to, parts.b);
    // A reply runs a little below the request, so both directions stay readable.
    const drop = step.reply ? -1.2 : 0.6;
    parts.a.y += drop;
    parts.b.y += drop;
    const t = progress.t < 0.5 ? 2 * progress.t * progress.t : 1 - (-2 * progress.t + 2) ** 2 / 2;
    parts.p.lerpVectors(parts.a, parts.b, t);
    parts.particle.position.copy(parts.p);
    const color = new Color(step.reply ? REPLY_COLOR : REQUEST_COLOR);
    (parts.particle.material as MeshBasicMaterial).color.copy(color);
    const linkPos = parts.link.geometry.getAttribute('position') as BufferAttribute;
    linkPos.setXYZ(0, parts.a.x, parts.a.y, parts.a.z);
    linkPos.setXYZ(1, parts.b.x, parts.b.y, parts.b.z);
    linkPos.needsUpdate = true;
    (parts.link.material as LineDashedMaterial).color.copy(color);
    parts.link.computeLineDistances();
    const trailPos = parts.trail.geometry.getAttribute('position') as BufferAttribute;
    current.history.forEach((at, i) => {
      const s = scenario.steps[at];
      const fa = s ? index.position.get(s.from) : undefined;
      const ta = s ? index.position.get(s.to) : undefined;
      if (fa === undefined || ta === undefined) return;
      const da = displayPosition(shared, fa, new Vector3());
      const db = displayPosition(shared, ta, new Vector3());
      const dy = s?.reply ? -1.2 : 0.6;
      trailPos.setXYZ(i * 2, da.x, da.y + dy, da.z);
      trailPos.setXYZ(i * 2 + 1, db.x, db.y + dy, db.z);
    });
    trailPos.needsUpdate = true;
    parts.trail.geometry.setDrawRange(0, current.history.length * 2);
    // The message pill rides above the request.
    const pill = shared.labels.get(MESSAGE_KEY);
    if (pill) {
      const v = parts.p.clone().add(new Vector3(0, 1.4, 0)).project(camera);
      pill.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
    }
  });

  return (
    <>
      <primitive object={parts.trail} />
      <primitive object={parts.link} />
      <primitive object={parts.particle} />
    </>
  );
}

function Detail({ step }: { readonly step: ScenarioStep }) {
  return <pre className="seq-detail">{JSON.stringify(step.detail ?? {}, null, 2)}</pre>;
}

export function SequencePlayer({ scenarios, scenario }: { readonly scenarios: readonly Scenario[]; readonly scenario: Scenario | undefined }) {
  const { dispatch } = useStore();
  const { shared } = useScene();
  const view = useView();
  const current = useClock();
  if (!scenario) return <div className="seq-player"><p className="muted">This dataset has no scenarios to replay.</p></div>;
  const step = scenario.steps[current.step];
  const path = mainPath(scenario);
  const at = path.indexOf(current.step);
  const label = (id: string): string => view.index.byId.get(id)?.label ?? id;
  const fork = step?.choice && !current.playing && progress.t >= 1 ? step.choice : null;
  const go = (to: number): void => {
    progress.t = 0;
    setClock({ step: to, playing: true, history: [...current.history, current.step] });
  };
  const restart = (): void => {
    progress.t = 0;
    setClock({ step: 0, playing: true, history: [] });
  };
  const back = (): void => {
    const previous = current.history.at(-1);
    if (previous === undefined) return;
    progress.t = 0;
    setClock({ step: previous, playing: false, history: current.history.slice(0, -1) });
  };
  const scrub = (i: number): void => {
    const target = path[i];
    if (target === undefined) return;
    progress.t = 0;
    setClock({ step: target, playing: false, history: path.slice(0, i) });
  };

  return (
    <>
      <div
        className="seq-message"
        ref={(el) => {
          if (el) shared.labels.set(MESSAGE_KEY, el);
          else shared.labels.delete(MESSAGE_KEY);
        }}
      >
        {step?.label}
      </div>
      <div className="seq-player">
        <div className="seq-row">
          <select
            value={scenario.id}
            data-help="Pick the use case to replay."
            onChange={(e) => dispatch({ type: 'scenario', id: e.target.value })}
          >
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <button type="button" data-help="Back to the first request." onClick={restart}>⏮</button>
          <button type="button" data-help="One step back along the way you came." onClick={back}>◀</button>
          <button type="button" data-help="Play or pause the clock." onClick={() => setClock({ playing: !current.playing })}>{current.playing ? '⏸' : '▶'}</button>
          <button type="button" data-help="Finish this step and go to the next." onClick={() => arrive(scenario)}>▶|</button>
          <input
            type="range"
            min={0}
            max={Math.max(0, path.length - 1)}
            value={Math.max(0, at)}
            data-help="The timeline of the default path; drag to jump to a step."
            onChange={(e) => scrub(Number(e.target.value))}
          />
          <span className="muted">{current.step + 1} / {scenario.steps.length}</span>
        </div>
        {step && (
          <div className="seq-step">
            <b>{label(step.from)} → {label(step.to)}</b> <span className={step.reply ? 'reply' : 'request'}>{step.label}</span>
            {step.ms !== undefined && <span className="muted"> · {step.ms} ms</span>}
            <Detail step={step} />
          </div>
        )}
        {fork && (
          <div className="seq-fork">
            <span>{fork.prompt}</span>
            {fork.options.map((o) => <button key={o.label} type="button" className="on" onClick={() => go(o.goto)}>{o.label}</button>)}
          </div>
        )}
        <p className="muted small">{scenario.description}</p>
      </div>
    </>
  );
}
