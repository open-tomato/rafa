/**
 * The renderer registry, the `widget_for(arg.ui)` of the dice: a widget's
 * `ui` hint picks how its face draws, and its `background` kind picks what
 * sits behind. Both maps take a new entry without touching the faces.
 *
 * Every face keeps the same anchors, measured from the triangle itself: the
 * icon in the point (the vertex), the value at the centre, the title along
 * the wide edge.
 */
import type { ReactNode } from 'react';

import type { BackgroundSpec, FaceUi, FaceWidgetSpec } from './types.ts';

export type Point = readonly [number, number];

export interface FaceFrame {
  /** The triangle's lone vertex: the top for a top-row face, the bottom for a bottom-row one. */
  readonly apex: Point;
  readonly centroid: Point;
  /** The middle of the edge across from the apex. */
  readonly baseMid: Point;
  /** Scale against the design size of a 150 px triangle. */
  readonly u: number;
  /** False on small nets, where only the icon and the value fit. */
  readonly roomy: boolean;
  /** The face's corners, for widgets that place values in them. */
  readonly corners: readonly Point[];
}

export interface FaceRenderProps {
  readonly spec: FaceWidgetSpec;
  readonly text: string;
  readonly frame: FaceFrame;
  /** A combo's values, formatted, in the order its `parts` list them. */
  readonly parts: readonly { readonly title: string; readonly text: string }[];
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ICON_AT = 0.42;
const TITLE_AT = 0.55;
/** How far toward each corner a combo puts its values. */
const COMBO_AT = 0.52;

function Anchored({ spec, frame, children }: { readonly spec: FaceWidgetSpec; readonly frame: FaceFrame; readonly children: ReactNode }) {
  const [ix, iy] = lerp(frame.apex, frame.centroid, ICON_AT);
  const [tx, ty] = lerp(frame.centroid, frame.baseMid, TITLE_AT);
  return (
    <>
      <text x={ix} y={iy} className="cap-icon" fontSize={18 * frame.u} dominantBaseline="central">{spec.icon}</text>
      {children}
      {frame.roomy && <text x={tx} y={ty} className="cap-title" fontSize={10.5 * frame.u} dominantBaseline="central">{spec.title}</text>}
    </>
  );
}

export const FACE_RENDERERS: Readonly<Record<FaceUi, (props: FaceRenderProps) => ReactNode>> = {
  counter: ({ spec, text, frame }) => (
    <Anchored spec={spec} frame={frame}>
      <text x={frame.centroid[0]} y={frame.centroid[1]} className="cap-value" fontSize={19 * frame.u} dominantBaseline="central">{text}</text>
    </Anchored>
  ),
  label: ({ spec, text, frame }) => (
    <Anchored spec={spec} frame={frame}>
      <text x={frame.centroid[0]} y={frame.centroid[1]} className="cap-value label" fontSize={12.5 * frame.u} dominantBaseline="central">{text}</text>
    </Anchored>
  ),
  // One value per corner, a fourth in the middle; the widget's title runs along the wide side.
  combo: ({ spec, frame, parts }) => {
    const spots = [...frame.corners.map((c) => lerp(frame.centroid, c, COMBO_AT)), frame.centroid];
    const [tx, ty] = lerp(frame.centroid, frame.baseMid, 0.82);
    return (
      <>
        {parts.slice(0, spots.length).map((part, i) => {
          const [x, y] = spots[i]!;
          return (
            <g key={part.title}>
              <text x={x} y={y - 4 * frame.u} className="cap-value" fontSize={13 * frame.u} dominantBaseline="central">{part.text}</text>
              {frame.roomy && <text x={x} y={y + 8 * frame.u} className="cap-title" fontSize={8.5 * frame.u} dominantBaseline="central">{part.title}</text>}
            </g>
          );
        })}
        {frame.roomy && <text x={tx} y={ty} className="cap-title combo-title" fontSize={9.5 * frame.u} dominantBaseline="central">{spec.icon} {spec.title}</text>}
      </>
    );
  },
};

type BackgroundKind = BackgroundSpec['kind'];

/** How wide and tall a sparkline sits behind the value, against the triangle's edge in px at u = 1. */
const SPARK_W = 0.5 * 150;
const SPARK_H = 0.16 * 150;
const SPARK_AT = 0.5;

function sparkline(values: readonly number[], frame: FaceFrame, color: string): ReactNode {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = SPARK_W * frame.u;
  const h = SPARK_H * frame.u;
  // Below the value, toward the wide edge, so the number stays on top of a clear field.
  const [cx, cy] = lerp(frame.centroid, frame.baseMid, SPARK_AT);
  const points = values.map((v, i) => `${cx - w / 2 + (i / (values.length - 1)) * w},${cy + h / 2 - (v / max) * h}`).join(' ');
  return (
    <g className="cap-background">
      <polyline points={`${cx - w / 2},${cy + h / 2} ${points} ${cx + w / 2},${cy + h / 2}`} fill={color} fillOpacity={0.16} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.5} />
    </g>
  );
}

/** A background renderer gets the widget, the face frame, its own spec, and the node's values for its bindings. */
export const BACKGROUNDS: Readonly<Record<BackgroundKind, (spec: FaceWidgetSpec, frame: FaceFrame, background: BackgroundSpec, values: readonly number[]) => ReactNode>> = {
  none: () => null,
  icon: (spec, frame, background) => (
    <text
      x={frame.centroid[0]}
      y={frame.centroid[1]}
      className="cap-background"
      fontSize={64 * frame.u}
      dominantBaseline="central"
      style={{ opacity: background.kind === 'icon' ? (background.opacity ?? 0.12) : 0 }}
    >
      {spec.icon}
    </text>
  ),
  sparkline: (_spec, frame, background, values) => sparkline(values, frame, background.kind === 'sparkline' ? (background.color ?? '#ff7a7a') : '#ff7a7a'),
};
