/**
 * The engine's core, with no React and no DOM: the tree-shaken registration
 * of the series and components every primitive uses, the option type, and
 * the colour bridge (tokens resolved to colour strings). The React adapter
 * (`shared.tsx`) adds the canvas renderer and the chart root; the headless
 * engine (`headless/`) adds the SVG renderer.
 *
 * ECharts cannot read CSS variables, so every option is a pure function
 * `(props, tokens) => option` over concrete colour strings.
 */
import type { ResolvedTokens } from '../seam/tones.js';
import type { ChartTone } from '../seam/types.js';

import {
  BarChart,
  BoxplotChart,
  CustomChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  TreemapChart,
  type BarSeriesOption,
  type BoxplotSeriesOption,
  type CustomSeriesOption,
  type GaugeSeriesOption,
  type GraphSeriesOption,
  type HeatmapSeriesOption,
  type LineSeriesOption,
  type PieSeriesOption,
  type RadarSeriesOption,
  type SankeySeriesOption,
  type ScatterSeriesOption,
  type SunburstSeriesOption,
  type TreemapSeriesOption,
} from 'echarts/charts';
import {
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GraphicComponent,
  GridComponent,
  MarkLineComponent,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent,
  type DataZoomComponentOption,
  type GraphicComponentOption,
  type GridComponentOption,
  type MarkLineComponentOption,
  type RadarComponentOption,
  type TooltipComponentOption,
  type VisualMapComponentOption,
} from 'echarts/components';
import { color as zrColor, type ComposeOption } from 'echarts/core';
import * as echarts from 'echarts/core';

import { DEFAULT_CHART_HEIGHT } from '../seam/height.js';

echarts.use([
  BarChart, BoxplotChart, CustomChart, GaugeChart, GraphChart, HeatmapChart, LineChart, PieChart, RadarChart,
  SankeyChart, ScatterChart, SunburstChart, TreemapChart,
  DataZoomInsideComponent, DataZoomSliderComponent, GraphicComponent, GridComponent, MarkLineComponent,
  RadarComponent, TooltipComponent, VisualMapComponent,
]);

/** The option shape of exactly the modules registered above. */
export type ChartOption = ComposeOption<
  | BarSeriesOption | BoxplotSeriesOption | CustomSeriesOption | GaugeSeriesOption | GraphSeriesOption
  | HeatmapSeriesOption | LineSeriesOption | PieSeriesOption | RadarSeriesOption | SankeySeriesOption
  | ScatterSeriesOption | SunburstSeriesOption | TreemapSeriesOption
  | DataZoomComponentOption | GraphicComponentOption | GridComponentOption | MarkLineComponentOption
  | RadarComponentOption | TooltipComponentOption | VisualMapComponentOption
>;

export type { ResolvedTokens };

/** Plot height in px when a chart is given none (the seam's `DEFAULT_CHART_HEIGHT`). */
export const DEFAULT_HEIGHT: number = DEFAULT_CHART_HEIGHT;
/** Bars and columns never grow thicker than this. */
export const BAR_MAX_WIDTH = 24;
/** Data-end corner radius of bars and columns. */
export const BAR_RADIUS = 4;
/** What the other marks fade to while one is hovered. */
export const BLUR_OPACITY = 0.85;
export const TICK_FONT_SIZE = 11;
/** Mount animation length in ms. */
const ANIMATION_DURATION = 400;

/** Hover lift for marks: the hovered one stays, the others fade slightly. */
export interface MarkHover {
  readonly emphasis: { readonly focus: 'self' };
  readonly blur: { readonly itemStyle: { readonly opacity: number } };
}

export const markHover: MarkHover = {
  emphasis: { focus: 'self' },
  blur: { itemStyle: { opacity: BLUR_OPACITY } },
};

/* ---------- the canvas-theme bridge ---------- */

/** A tone's colour, or a chrome token's, as a concrete string. */
export function paint(tokens: ResolvedTokens, toneOrToken: ChartTone | string): string {
  return tokens[toneOrToken] ?? '';
}

/** The same colour at an alpha, for fills the canvas cannot wash with `opacity`. */
export function withAlpha(colour: string, alpha: number): string {
  return zrColor.modifyAlpha(colour, alpha);
}

/** The colour `share` of the way from `from` to `to` (0 is `from`, 1 is `to`). */
export function mix(from: string, to: string, share: number): string {
  return zrColor.lerp(Math.min(1, Math.max(0, share)), [from, to]);
}

/** Whichever of `ink` and `surface` reads better on `background`, by luminance. */
export function readableOn(tokens: ResolvedTokens, background: string): string {
  const ink = paint(tokens, 'ink');
  const surface = paint(tokens, 'surface');
  const contrast = (text: string): number => Math.abs(zrColor.lum(text, 0) - zrColor.lum(background, 0));
  return contrast(ink) >= contrast(surface)
    ? ink
    : surface;
}

/** The font stack when the page names none, or there is no page (the headless engine). */
export const FALLBACK_FONT_FAMILY = 'sans-serif';

/** The page font stack from `--font-sans`, for canvas text and text measuring; the fallback with no DOM. */
export function readFontFamily(): string {
  if (typeof document === 'undefined') return FALLBACK_FONT_FAMILY;
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--font-sans')
    .trim();
  return declared === ''
    ? FALLBACK_FONT_FAMILY
    : declared;
}

/**
 * Lays the options every chart shares under a primitive's own: UTC time
 * axes, so ECharts places a tick at midnight UTC where `formatDay` labels
 * it; the mount animation (on unless `animate` is false); and the page
 * font on canvas text.
 */
export function finishOption(option: ChartOption, animate: boolean | undefined): ChartOption {
  return {
    useUTC: true,
    animation: animate !== false,
    animationDuration: ANIMATION_DURATION,
    ...option,
    textStyle: { fontFamily: readFontFamily() },
  };
}
