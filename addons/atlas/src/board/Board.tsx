/**
 * The 2D board: the same graph, lenses and panels as the 3D scene, drawn on
 * a flat drawing sheet. Each die is its wireframe front elevation (hidden
 * edges dashed), and opening one morphs its outline into the flat net under
 * the same net overlay the 3D view uses. One camera: the wheel zooms at the
 * pointer, a drag on the sheet pans it.
 *
 * Positions move every frame, so the sheet, the dice and the links are
 * placed by hand on their SVG elements instead of through React state.
 */
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import type { GraphIndex } from '../graph/index.ts';
import { stepper } from '../graph/layout.ts';
import type { DieShape } from '../geometry/dice.ts';
import { advance, heatValue, useGraphModel } from '../scene/model.ts';
import { useStore, type UiState } from '../state.tsx';
import type { GraphEdge, GraphNode } from '../types.ts';
import { NetOverlay, useBoxSize } from '../ui/NetOverlay.tsx';
import { Toolbar } from '../ui/Toolbar.tsx';
import { useView } from '../view.tsx';
import { morph, piecesOf } from './pieces.ts';
import { boundsOf, fitTo, toScreen, zoomAt, type Point, type Viewport } from './viewport.ts';

const OPEN_MS = 650;
const FIT_MARGIN = 0.14;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.0015;
/** The open net fills this share of the board, and a face never draws wider than its text was made for. */
const NET_FILL_W = 0.86;
const NET_FILL_H = 0.8;
const MAX_EDGE_PX = 180;
/** How much the rest of the sheet fades while a die is open. */
const FADE = 0.95;
/** Grid steps, world units, from fine to coarse; the finest that stays this wide on screen is drawn. */
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200];
const GRID_MIN_PX = 14;
const DRAG_TOLERANCE_PX = 4;
/** Below this zoom (pixels per world unit) only the selected and hovered dice keep their names. */
const LABELS_FROM_K = 3.5;

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface NetFit {
  readonly unitPx: number;
  readonly edgePx: number;
}

/** The scale that fits the open net in the board, as the net overlay draws it. */
function netFit(shape: DieShape, box: { readonly width: number; readonly height: number }): NetFit {
  const unitPx = Math.min((box.width * NET_FILL_W) / shape.netWidth, (box.height * NET_FILL_H) / shape.netHeight, MAX_EDGE_PX / shape.refEdge);
  return { unitPx, edgePx: shape.refEdge * unitPx };
}

const pointsAttr = (points: readonly Point[]): string => points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

function baseAlpha(edge: GraphEdge, weightedKind: string | undefined): number {
  return edge.kind === weightedKind ? 0.12 + 0.55 * Math.min(1, Math.log2(Math.max(1, edge.weight)) / 7) : 0.55;
}

interface LinkLine {
  readonly key: number;
  readonly edge: GraphEdge;
  readonly a: number;
  readonly b: number;
}

/** One closed die on the sheet: its pieces at circumradius `r`, hidden ones dashed, its icon and name below. */
function Glyph({ node, shape, r, color, icon, heat }: { readonly node: GraphNode; readonly shape: DieShape; readonly r: number; readonly color: string; readonly icon: string; readonly heat: number }) {
  const pieces = piecesOf(shape);
  return (
    <>
      <g transform={`scale(${r})`} stroke={color}>
        {pieces.filter((p) => p.back).map((p, i) => <polygon key={`b${i}`} className="hidden-edge" points={pointsAttr(p.folded)} />)}
        {pieces.filter((p) => !p.back).map((p, i) => <polygon key={`f${i}`} className="face" fill={color} fillOpacity={0.05 + heat * 0.45} points={pointsAttr(p.folded)} />)}
      </g>
      <text className="die-icon" transform="scale(1,-1)" y={r * 0.32} fontSize={r * 0.85}>{icon}</text>
      <text className="die-label" transform="scale(1,-1)" y={r} dy="1.15em">{node.label}</text>
    </>
  );
}

export function Board({ index }: { readonly index: GraphIndex }) {
  const { state, dispatch } = useStore();
  const view = useView();
  const { lens, parts, shared, arrangement, visibleNodes, visible, maxHeat, highlightIds, expandedNode } = useGraphModel(index);
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const viewport = useRef<Viewport>({ x: 0, y: 0, k: 6 });
  const sheet = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const linkEls = useRef(new Map<number, SVGLineElement>());
  const stageEls = useRef<(SVGPolygonElement | null)[]>([]);
  const stateRef = useRef<UiState>(state);
  stateRef.current = state;
  const boxRef = useRef(box);
  boxRef.current = box;
  const step = useMemo(() => stepper(index.nodes, parts.springs, true), [index, parts.springs]);

  // Links the lens draws as lines; plots route theirs at right angles instead.
  const routed = lens.arrange?.kind === 'plots' ? new Set(lens.arrange.routed) : new Set<string>();
  const lineKinds = [...parts.lines].filter((k) => !(arrangement && routed.has(k)));
  const lineKey = lineKinds.join('|');
  const links = useMemo<LinkLine[]>(() => index.edges.flatMap((edge, key) => {
    const a = index.position.get(edge.source);
    const b = index.position.get(edge.target);
    return a === undefined || b === undefined || !lineKinds.includes(edge.kind) ? [] : [{ key, edge, a, b }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [index, lineKey]);
  const weighted = view.config.weightedKind;
  const shownLinks = links.filter(({ edge }) => visible.has(edge.source) && visible.has(edge.target) && !state.hiddenEdgeKinds.includes(edge.kind) && (edge.kind !== weighted || edge.weight >= state.minImportWeight));

  const expandedShape = expandedNode ? view.shape(expandedNode) : null;
  const fit = expandedShape && box.width > 0 ? netFit(expandedShape, box) : null;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // The frame loop: step the layout, run the open animation, place everything.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let reported: string | null = null;
    let wasExpanded: string | null = null;
    const frame = (now: number): void => {
      const s = stateRef.current;
      const dt = Math.min(64, now - last);
      last = now;
      if (s.expanded !== wasExpanded) {
        wasExpanded = s.expanded;
        reported = null;
      }
      const expandedAt = s.expanded ? index.position.get(s.expanded) : undefined;
      advance(shared, index, step, { locked: s.locked, expandedAt, push: 0 });
      const opening = s.expanded !== null && !s.collapsing;
      t = Math.min(1, Math.max(0, t + (opening ? dt : -dt) / OPEN_MS));
      const u = ease(t);
      shared.unfoldT = u;
      paint(u, expandedAt);
      if (opening && t === 1 && reported !== 'open') {
        reported = 'open';
        dispatch({ type: 'unfolded', done: true });
      }
      if (s.collapsing && t === 0 && reported !== 'closed') {
        reported = 'closed';
        dispatch({ type: 'collapsed' });
      }
      raf = requestAnimationFrame(frame);
    };

    const paint = (u: number, expandedAt: number | undefined): void => {
      const v = viewport.current;
      const d = shared.display;
      const g = sheet.current;
      if (g) {
        g.setAttribute('transform', `matrix(${v.k} 0 0 ${-v.k} ${v.x} ${v.y})`);
        g.style.opacity = String(1 - FADE * u);
        // Names keep one screen size at any zoom: the CSS divides their font by the zoom.
        g.style.setProperty('--k', String(v.k));
        g.classList.toggle('far', v.k < LABELS_FROM_K);
      }
      const host = ref.current;
      if (host) {
        const stepUnits = GRID_STEPS.find((s) => s * v.k >= GRID_MIN_PX) ?? GRID_STEPS[GRID_STEPS.length - 1]!;
        const minor = stepUnits * v.k;
        const major = minor * 5;
        host.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
        host.style.backgroundPosition = `${v.x}px ${v.y}px`;
      }
      for (const [id, el] of nodeEls.current) {
        const i = index.position.get(id);
        if (i !== undefined) el.setAttribute('transform', `translate(${d[i * 3]!.toFixed(3)} ${d[i * 3 + 1]!.toFixed(3)})`);
      }
      for (const { key, a, b } of links) {
        const el = linkEls.current.get(key);
        if (!el) continue;
        el.setAttribute('x1', d[a * 3]!.toFixed(3));
        el.setAttribute('y1', d[a * 3 + 1]!.toFixed(3));
        el.setAttribute('x2', d[b * 3]!.toFixed(3));
        el.setAttribute('y2', d[b * 3 + 1]!.toFixed(3));
      }
      const s = stateRef.current;
      const node = s.expanded ? index.byId.get(s.expanded) : undefined;
      const fitNow = fitRef.current;
      if (!node || expandedAt === undefined || !fitNow) return;
      // The open die lives in screen space: from its place on the sheet to the middle of the board.
      const shape = view.shape(node);
      const r = view.radius(node) * v.k;
      const [sx, sy] = toScreen(v, [d[expandedAt * 3]!, d[expandedAt * 3 + 1]!]);
      const { width, height } = boxRef.current;
      const c = shape.netCenter;
      piecesOf(shape).forEach((piece, k) => {
        const el = stageEls.current[k];
        if (!el) return;
        const from = piece.folded.map(([x, y]): Point => [sx + x * r, sy - y * r]);
        const to = piece.open.map(([x, y]): Point => [width / 2 + (x - c.x) * fitNow.unitPx, height / 2 - (y - c.y) * fitNow.unitPx]);
        el.setAttribute('points', pointsAttr(morph({ folded: from, open: to, back: piece.back }, u)));
        el.style.strokeDasharray = piece.back && u < 0.5 ? '4 3' : '';
      });
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [index, shared, step, links, view, dispatch, ref]);

  // Camera commands from the keys and the toolbar: fit, zoom steps, reset.
  const fitAll = (): void => {
    if (box.width === 0) return;
    const d = shared.display;
    const at = (n: GraphNode): Point => {
      const i = index.position.get(n.id)!;
      return shared.targets && shared.targetOn?.[i] ? [shared.targets[i * 2]!, shared.targets[i * 2 + 1]!] : [d[i * 3]!, d[i * 3 + 1]!];
    };
    const corners = (arrangement?.boxes ?? []).flatMap((b): Point[] => [[b.x, b.y], [b.x + b.w, b.y - b.h]]);
    const bounds = boundsOf([...visibleNodes.map(at), ...corners]);
    if (bounds) viewport.current = fitTo(bounds, box, FIT_MARGIN);
  };
  useEffect(() => {
    const command = state.cameraCommand;
    if (!command) return;
    const centre: Point = [box.width / 2, box.height / 2];
    if (command.kind === 'zoom-in') viewport.current = zoomAt(viewport.current, ZOOM_STEP, centre);
    else if (command.kind === 'zoom-out') viewport.current = zoomAt(viewport.current, 1 / ZOOM_STEP, centre);
    else fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cameraCommand]);
  const fitted = useRef(false);
  useEffect(() => {
    if (box.width > 0 && !fitted.current) {
      fitted.current = true;
      fitAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.width]);

  // The wheel zooms at the pointer; it needs a listener that may cancel the page scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (stateRef.current.expanded) return;
      const rect = el.getBoundingClientRect();
      viewport.current = zoomAt(viewport.current, Math.exp(-e.deltaY * WHEEL_ZOOM), [e.clientX - rect.left, e.clientY - rect.top]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);

  // A drag on the empty sheet pans it; a press that does not move clears the selection.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const p = drag.current;
    if (!p || state.expanded) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_TOLERANCE_PX) return;
    const v = viewport.current;
    viewport.current = { ...v, x: v.x + dx, y: v.y + dy };
    drag.current = { x: e.clientX, y: e.clientY, moved: true };
  };
  const onPointerUp = (): void => {
    const p = drag.current;
    drag.current = null;
    if (p && !p.moved && !state.expanded) dispatch({ type: 'select', id: null });
  };

  const registerNode = (id: string) => (el: SVGGElement | null): void => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  };
  const registerLink = (key: number) => (el: SVGLineElement | null): void => {
    if (el) linkEls.current.set(key, el);
    else linkEls.current.delete(key);
  };
  const stopPan = (e: ReactPointerEvent): void => e.stopPropagation();

  return (
    <div className="scene board" ref={ref}>
      <svg
        className={`board-sheet${state.expanded ? ' open' : ''}`}
        width={box.width}
        height={box.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g ref={sheet}>
          {arrangement?.boxes.map((b) => (
            <g key={b.id} className={`sheet-box ${b.kind}`} transform={`translate(${b.x} ${b.y}) scale(1 -1)`} stroke={b.color}>
              <rect width={b.w} height={b.h} />
              {b.kind !== 'lifeline' && <text className="box-title" x={0.7} y={1.7} fontSize={1.25}>{b.title}</text>}
              {b.subtitle && b.kind !== 'lifeline' && <text className="box-sub" x={b.w - 0.7} y={1.7} fontSize={1}>{b.subtitle}</text>}
              {b.kind === 'lifeline' && <text className="box-title" x={0.4} y={-0.6} fontSize={1.1}>{b.title}</text>}
              {b.rows?.map((row, i) => <text key={i} className="box-row" x={0.7} y={4.2 + (i + 1) * 1.15 - 0.3} fontSize={0.85}>{row.text}{row.tag ? `  ${row.tag}` : ''}</text>)}
            </g>
          ))}
          {arrangement?.routes.filter((r) => visible.has(r.source) && visible.has(r.target) && !state.hiddenEdgeKinds.includes(r.kind)).map((r, i) => {
            const touches = state.selected !== null && (r.source === state.selected || r.target === state.selected);
            return <polyline key={i} className="route" stroke={view.edge(r.kind).color} strokeOpacity={state.selected ? (touches ? 0.95 : 0.12) : 0.55} points={pointsAttr(r.points)} />;
          })}
          {shownLinks.map(({ key, edge }) => {
            const spec = view.edge(edge.kind);
            const touches = state.selected !== null && (edge.source === state.selected || edge.target === state.selected);
            const alpha = state.selected ? (touches ? 0.95 : 0.08) : baseAlpha(edge, weighted);
            return <line key={key} ref={registerLink(key)} className="link" stroke={spec.color} strokeOpacity={alpha} strokeDasharray={spec.dash > 0 ? '5 4' : undefined} />;
          })}
          {visibleNodes.map((node) => {
            const selected = state.selected === node.id;
            const hovered = state.hover?.kind === 'node' && state.hover.id === node.id;
            const dim = highlightIds !== null && !highlightIds.has(node.id);
            return (
              <g
                key={node.id}
                ref={registerNode(node.id)}
                className={`die${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}${dim ? ' dim' : ''}`}
                onPointerDown={stopPan}
                onClick={() => dispatch({ type: 'select', id: node.id })}
                onDoubleClick={() => dispatch({ type: 'expand', id: node.id })}
                onMouseEnter={() => dispatch({ type: 'hover', hover: { kind: 'node', id: node.id } })}
                onMouseLeave={() => dispatch({ type: 'hover', hover: null })}
              >
                <Glyph node={node} shape={view.shape(node)} r={view.radius(node)} color={view.color(node)} icon={view.icon(node)} heat={Math.sqrt(heatValue(node, state.heat, view) / maxHeat)} />
              </g>
            );
          })}
        </g>
        {expandedNode && expandedShape && (
          <g className="stage" stroke={view.color(expandedNode)}>
            {piecesOf(expandedShape).map((piece, k) => (
              <polygon key={k} ref={(el) => { stageEls.current[k] = el; }} className={piece.back ? 'face back' : 'face'} fill={view.color(expandedNode)} />
            ))}
          </g>
        )}
      </svg>
      <Toolbar />
      {expandedNode && state.unfolded && fit && <NetOverlay node={expandedNode} unitPx={fit.unitPx} edgePx={fit.edgePx} />}
    </div>
  );
}
