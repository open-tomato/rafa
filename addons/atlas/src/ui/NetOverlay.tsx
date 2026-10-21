/**
 * The unfolded net's faces as SVG, laid exactly over the flat 3D net: crisp
 * text, and hit areas that are the triangles themselves. What each face shows
 * and does comes from the node's template and its widgets (see `contract/`).
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';

import { read, readItems, viewItem, widgetValue } from '../contract/bind.ts';
import { formatValue } from '../contract/format.ts';
import { BACKGROUNDS, FACE_RENDERERS, type FaceFrame, type Point } from '../contract/registry.tsx';
import type { ActionSpec, FaceWidgetSpec, OpenSpec } from '../contract/types.ts';
import { widgetOnSlot } from '../configs/index.ts';
import type { Cell, Region } from '../geometry/dice.ts';
import { useStore, type Action, type DrawerContent, type Radial } from '../state.tsx';
import type { GraphNode } from '../types.ts';
import { useView, type View } from '../view.tsx';

/** The triangle edge, in px, that the face text sizes are drawn for. */
const DESIGN_EDGE_PX = 150;
const RADIAL_LIMIT = 12;
export const WIDGET_MIME = 'application/x-atlas-widget';

export function useBoxSize<T extends Element>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box];
}

/** What an item opens in the drawer, through one of the server's readers. */
export function openFor(open: OpenSpec | undefined, raw: unknown, title: string): DrawerContent | undefined {
  if (!open || typeof raw !== 'string') return undefined;
  return open.kind === 'doc' ? { kind: 'doc', title: raw, path: raw } : { kind: 'plan', title: `${title} ${raw}`, stub: raw };
}

/** A widget's action as reducer actions, the same for every dataset. */
function actionsFor(action: ActionSpec | undefined, widget: FaceWidgetSpec, slot: string, node: GraphNode, view: View): Action[] {
  const ctx = { node, index: view.index };
  const label = (id: string): string => view.index.byId.get(id)?.label ?? id;
  switch (action?.kind) {
    case 'highlight': {
      const ids = 'ids' in action
        ? readItems(action.ids, ctx).filter((id): id is string => typeof id === 'string')
        : action.relation === 'callers' ? view.index.callers(node.id) : view.index.callees(node.id);
      return [{ type: 'collapse' }, { type: 'highlight', highlight: { label: `${widget.title} of ${node.label}`, ids: [node.id, ...ids] } }];
    }
    case 'radial': {
      const items = readItems(action.items, ctx).map((item) => {
        const v = viewItem(item, action.shape, label);
        return { label: v.tag ? `${v.text} · ${v.tag}` : v.text, open: openFor(action.open, typeof v.raw === 'string' ? v.raw : v.text, widget.title) };
      });
      if (items.length === 0) return [{ type: 'hover', hover: { kind: 'ui', text: `${node.label} has no ${widget.title.toLowerCase()} to spread out.` } }];
      return [{ type: 'radial', radial: { slot, title: `${widget.title} · ${node.label}`, items } }];
    }
    case 'list': {
      const items = readItems(action.items, ctx).map((item) => {
        const v = viewItem(item, action.shape, label);
        return { kind: v.tag ?? '·', text: v.text, meta: v.meta ? formatValue(v.meta, { kind: 'relative-time' }) : undefined };
      });
      return [{ type: 'show', content: { kind: 'list', title: `${widget.title} · ${node.label}`, items } }];
    }
    default:
      return [];
  }
}

const centroidOf = (flat: readonly (readonly [number, number])[]): Point => [
  flat.reduce((acc, p) => acc + p[0], 0) / flat.length,
  flat.reduce((acc, p) => acc + p[1], 0) / flat.length,
];

export function NetOverlay({ node, unitPx, edgePx }: { readonly node: GraphNode; readonly unitPx: number; readonly edgePx: number }) {
  const { state, dispatch } = useStore();
  const view = useView();
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const shape = view.shape(node);
  const template = view.template(node);
  const overrides = state.faceOverrides[template.id];
  const u = Math.min(1.25, edgePx / DESIGN_EDGE_PX);
  const roomy = edgePx >= 110;
  const at = ([x, y]: Point): Point => [box.width / 2 + (x - shape.netCenter.x) * unitPx, box.height / 2 - (y - shape.netCenter.y) * unitPx];
  const poly = (points: readonly Point[]): string => points.map((p) => at(p).join(',')).join(' ');
  const ctx = { node, index: view.index };
  const parent = view.index.byId.get(node.group);
  const [codeLine, ...chips] = template.details;

  const onDrop = (slot: string) => (e: DragEvent<SVGPolygonElement>) => {
    e.preventDefault();
    const widget = e.dataTransfer.getData(WIDGET_MIME);
    setDropSlot(null);
    if (view.widget(widget)) dispatch({ type: 'assign', template: template.id, slot, widget });
  };

  const regionCard = (region: Region) => {
    const [rx, ry] = at([region.rect.x, region.rect.y]);
    const w = region.rect.w * unitPx;
    const h = region.rect.h * unitPx;
    const hoverSlot = region.kind === 'parent' ? 'A' : 'B';
    return (
      <g key={`${region.kind}-${region.rect.x}`}>
        <polygon className={`region ${region.kind}`} points={poly(region.polygon)} onMouseEnter={() => dispatch({ type: 'hover', hover: { kind: 'face', slot: hoverSlot } })} onMouseLeave={() => dispatch({ type: 'hover', hover: null })} />
        <foreignObject x={rx} y={ry} width={w} height={h} pointerEvents="none">
          {region.kind === 'parent' && (
            <div className="region-card" style={{ fontSize: 13 * u }}>
              <small>parent</small>
              <strong>{parent && parent.id !== node.id ? parent.label : view.groupLabel(node.group)}</strong>
              <span>{view.type(node.type).icon} {view.type(node.type).name}</span>
            </div>
          )}
          {region.kind === 'self' && (
            <div className="region-card self" style={{ fontSize: 13 * u, borderColor: view.color(node) }}>
              <strong className="big">{view.icon(node)} {node.label}</strong>
              {roomy && codeLine && <code>{formatValue(read(codeLine.value, ctx), codeLine.format)}</code>}
              <div className="chips">
                {chips.map((line) => <span key={line.value}>{formatValue(read(line.value, ctx), line.format)} {line.label}</span>)}
              </div>
            </div>
          )}
          {region.kind === 'band' && (
            <div className="region-band" style={{ fontSize: Math.min(13 * u, (h * 0.55)) }}>
              <strong>{view.icon(node)} {node.label}</strong>
              <span className="muted">{node.legend}</span>
              {chips.slice(0, 3).map((line) => <span key={line.value} className="chip-inline">{formatValue(read(line.value, ctx), line.format)} {line.label}</span>)}
            </div>
          )}
        </foreignObject>
      </g>
    );
  };

  return (
    <div className="net-overlay" ref={ref}>
      {box.width > 0 && (
        <svg width={box.width} height={box.height}>
          {shape.cells.map((cell) => {
            const widgetId = widgetOnSlot(template, overrides, shape.slots, cell.slot);
            const spec = widgetId ? view.widget(widgetId) : undefined;
            if (!spec) return <polygon key={cell.slot} className="cap-empty" points={poly(cell.polygon)} />;
            const frame: FaceFrame = { apex: at(cell.apex), centroid: at(centroidOf(cell.polygon)), baseMid: at(cell.baseMid), u, roomy, corners: cell.polygon.map(at) };
            const { text, number } = widgetValue(spec, ctx);
            const parts = (spec.parts ?? []).map((p) => ({ title: p.title, text: formatValue(read(p.value, ctx), p.format) }));
            const clickable = (spec.action?.kind ?? 'none') !== 'none';
            const render = FACE_RENDERERS[spec.ui ?? 'counter'];
            const background = spec.background ?? { kind: 'none' as const };
            const top = cell.slot.startsWith('up') || cell.slot === 'top' || cell.slot === 'left';
            return (
              <g key={cell.slot} className={`cap ${top ? 'top' : 'bottom'}${clickable ? ' clickable' : ''}${spec.ui !== 'combo' && (number === 0 || text === '—') ? ' empty' : ''}${dropSlot === cell.slot ? ' drop' : ''}`}>
                <polygon
                  points={poly(cell.polygon)}
                  onMouseEnter={() => dispatch({ type: 'hover', hover: { kind: 'face', slot: cell.slot } })}
                  onMouseLeave={() => dispatch({ type: 'hover', hover: null })}
                  onClick={() => clickable && actionsFor(spec.action, spec, cell.slot, node, view).forEach(dispatch)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropSlot(cell.slot);
                  }}
                  onDragLeave={() => setDropSlot(null)}
                  onDrop={onDrop(cell.slot)}
                />
                {BACKGROUNDS[background.kind](spec, frame, background, background.kind === 'sparkline' ? readItems(background.values, ctx).filter((v): v is number => typeof v === 'number') : [])}
                {render({ spec, text, frame, parts })}
              </g>
            );
          })}
          {shape.regions.map(regionCard)}
          {shape.unfold === 'explode' && (
            <text x={box.width / 2} y={box.height - 24} className="explode-hint">{node.label}: pick a small die inside to fold back onto it</text>
          )}
          {state.radial && <RadialMenu radial={state.radial} at={at} k={edgePx} box={box} cells={shape.cells} />}
        </svg>
      )}
    </div>
  );
}

function RadialMenu({ radial, at, k, box, cells }: { readonly radial: Radial; readonly at: (p: Point) => Point; readonly k: number; readonly box: { width: number; height: number }; readonly cells: readonly Cell[] }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, [radial]);
  const cell = cells.find((c) => c.slot === radial.slot);
  if (!cell) return null;
  const [cx, cy] = at(centroidOf(cell.polygon));
  const shown = radial.items.slice(0, RADIAL_LIMIT);
  const extra = radial.items.length - shown.length;
  const items = extra > 0 ? [...shown, { label: `+${extra} more`, open: { kind: 'list' as const, title: radial.title, items: radial.items.map((i) => ({ kind: '·', text: i.label })) } }] : shown;
  const radius = Math.min(k * 1.35, Math.min(box.width, box.height) * 0.38);
  const start = cell.apex[1] > cell.baseMid[1] ? -Math.PI / 2 : Math.PI / 2;
  return (
    <g className="radial">
      <rect x={0} y={0} width={box.width} height={box.height} className="radial-backdrop" onClick={() => dispatch({ type: 'radial', radial: null })} />
      <text x={cx} y={cy + 5} className="radial-title">{radial.title}</text>
      {items.map((item, i) => {
        const angle = start + (i / items.length) * Math.PI * 2;
        const ring = radius * (i % 2 === 0 ? 1 : 0.78);
        const x = open ? cx + Math.cos(angle) * ring : cx;
        const y = open ? cy + Math.sin(angle) * ring : cy;
        return (
          <g
            key={`${item.label}-${i}`}
            className={`radial-item${item.open ? ' clickable' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px)`, transitionDelay: `${i * 18}ms` }}
            onClick={() => item.open && dispatch({ type: 'show', content: item.open })}
            onMouseEnter={() => dispatch({ type: 'hover', hover: { kind: 'ui', text: item.open ? `${item.label}: click to open it in the drawer.` : item.label } })}
          >
            <line x1={0} y1={0} x2={cx - x} y2={cy - y} />
            <circle r={5} />
            <foreignObject x={-80} y={8} width={160} height={24}>
              <div className="pill">{item.label}</div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}
