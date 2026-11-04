/**
 * The chrome every primitive shares: the plot grid, the axes, the reference
 * line and the hover readout. Each is a pure function of the resolved tokens.
 */
import type { TooltipComponentFormatterCallbackParams, XAXisComponentOption, YAXisComponentOption } from 'echarts';
import type { GridComponentOption, MarkLineComponentOption, TooltipComponentOption } from 'echarts/components';

import { format as echartsFormat } from 'echarts/core';

import { paint, readFontFamily, TICK_FONT_SIZE, type ResolvedTokens } from './core.js';
import {
  tooltipHeadingVariants,
  tooltipKeyVariants,
  tooltipLabelVariants,
  tooltipRowVariants,
  tooltipSurfaceVariants,
  tooltipValueVariants,
  type TooltipKeyShape,
} from './shared.variants.js';

/** The params an ECharts tooltip formatter receives. */
export type TooltipParams = TooltipComponentFormatterCallbackParams;

/** An axis that fits either side of the plot. */
export type PlotAxis = XAXisComponentOption & YAXisComponentOption;

/** Room around the plot rect, in px; each side defaults to a small gutter. */
export interface PlotRoom {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** The plot rect, shrunk so axis labels stay inside the canvas. */
export function plotGrid(room: PlotRoom = {}): GridComponentOption {
  return {
    top: room.top ?? 12,
    right: room.right ?? 8,
    bottom: room.bottom ?? 4,
    left: room.left ?? 4,
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
  };
}

function tickLabel(tokens: ResolvedTokens): { color: string; fontSize: number } {
  return { color: paint(tokens, 'muted'), fontSize: TICK_FONT_SIZE };
}

/** Bounds of a value axis; `max` may be a function of the data extent. */
export interface ValueBounds {
  readonly min?: number;
  readonly max?: number | ((extent: { max: number }) => number);
}

/** The value axis: hairline solid grid in `grid`, no axis line, compact ticks in `muted`. */
export function valueAxis(tokens: ResolvedTokens, format: (value: number) => string, bounds: ValueBounds = {}): PlotAxis {
  return {
    type: 'value',
    min: bounds.min,
    max: bounds.max,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: paint(tokens, 'grid'), width: 1, type: 'solid' } },
    axisLabel: { ...tickLabel(tokens), formatter: (value: number) => format(value) },
  };
}

/** Options of a category axis. */
export interface CategoryExtra {
  readonly interval?: number;
  readonly inverse?: boolean;
  readonly showLine?: boolean;
  /** false hides the tick labels (a band axis whose edges a second axis labels). */
  readonly showLabels?: boolean;
  /** false puts the ticks on the band edges instead of between them. */
  readonly boundaryGap?: boolean;
  readonly position?: 'top' | 'bottom';
}

/** A category axis: the axis line in `baseline`, no ticks, labels in `muted`. */
/**
 * `{ [key]: value }` when `value` is set, else nothing: an explicit `undefined` overrides the
 * engine's own default (a category axis gaps its boundary unless told otherwise, and a heatmap
 * needs that gap), so an option the caller left unset is left out of the axis.
 */
function given<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  if (value === undefined) return {};
  return { [key]: value } as Partial<Record<K, V>>;
}

export function categoryAxis(tokens: ResolvedTokens, data: readonly string[], extra: CategoryExtra = {}): PlotAxis {
  return {
    type: 'category',
    data: [...data],
    ...given('inverse', extra.inverse),
    ...given('boundaryGap', extra.boundaryGap),
    ...given('position', extra.position),
    axisLine: { show: extra.showLine ?? true, lineStyle: { color: paint(tokens, 'baseline'), width: 1 } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { ...tickLabel(tokens), show: extra.showLabels ?? true, interval: extra.interval ?? 'auto', hideOverlap: true },
  };
}

/** One day and one week, in ms. */
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Days from Monday to the given UTC weekday (Sunday is 0). */
const DAYS_SINCE_MONDAY = [6, 0, 1, 2, 3, 4, 5] as const;

/** The tick step a time axis may be pinned to; the axis picks its own otherwise. */
export type TimeStep = 'week';

/** How a time axis's ticks are pinned: the step and the span of the data, in epoch ms. */
export interface TimeTicks {
  readonly step: TimeStep;
  readonly from: number;
  readonly to: number;
}

/** The Monday 00:00 UTC on or before the epoch `ms`. */
export function startOfWeekUtc(ms: number): number {
  const date = new Date(ms);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return dayStart - (DAYS_SINCE_MONDAY[date.getUTCDay()] ?? 0) * DAY_MS;
}

/** Every Monday 00:00 UTC from the week of `from` to `to`, inclusive. */
export function weekStartsUtc(from: number, to: number): number[] {
  const starts: number[] = [];
  for (let monday = startOfWeekUtc(from); monday <= to; monday += WEEK_MS) starts.push(monday);
  return starts;
}

/**
 * A time axis: the axis line in `baseline`, labels through `xFormat`,
 * spread so they never overlap. With `ticks` of step `week` the axis
 * starts on the Monday of its first point and its labels sit on the
 * Mondays of the span (ECharts' `customValues`), so a weekly label
 * ("w/c 3 Nov") lands on a week's first day rather than wherever the
 * time scale's own interval falls.
 */
export function timeAxis(tokens: ResolvedTokens, xFormat: (date: Date) => string, ticks?: TimeTicks): PlotAxis {
  const formatter = (value: number): string => xFormat(new Date(value));
  const label = { ...tickLabel(tokens), formatter, hideOverlap: true };
  const chrome = {
    axisLine: { show: true, lineStyle: { color: paint(tokens, 'baseline'), width: 1 } },
    axisTick: { show: false },
    splitLine: { show: false },
  };
  if (ticks === undefined) return { type: 'time', ...chrome, axisLabel: label };
  return {
    type: 'time',
    min: startOfWeekUtc(ticks.from),
    ...chrome,
    axisLabel: { ...label, customValues: weekStartsUtc(ticks.from, ticks.to) },
  };
}

/** A reference line (baseline, limit, target): 1px `ink-2`, its label in `ink-2` at the end. */
export function referenceLine(
  tokens: ResolvedTokens,
  axis: 'xAxis' | 'yAxis',
  value: number,
  label: string,
  labelAt: 'start' | 'end' = 'end',
): MarkLineComponentOption {
  return {
    silent: true,
    symbol: 'none',
    animation: false,
    lineStyle: { color: paint(tokens, 'ink-2'), width: 1, type: 'solid' },
    label: {
      show: true,
      position: labelAt,
      color: paint(tokens, 'ink-2'),
      fontSize: TICK_FONT_SIZE,
      formatter: () => label,
    },
    data: [axis === 'yAxis'
      ? { yAxis: value }
      : { xAxis: value }],
  };
}

/** Room on the right of the plot for a horizontal reference line's end label. */
export function referenceLabelRoom(label: string): number {
  return Math.ceil(echartsFormat.getTextRect(label, `${TICK_FONT_SIZE}px ${readFontFamily()}`).width) + 12;
}

/* ---------- tooltips ---------- */

/**
 * The ECharts tooltip container made invisible: the readout itself is the
 * element the formatter returns, built from text nodes.
 */
export function tooltipChrome(trigger: 'item' | 'axis'): TooltipComponentOption {
  return {
    trigger,
    confine: true,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    shadowBlur: 0,
    extraCssText: 'box-shadow: none;',
    transitionDuration: 0.1,
  };
}

/** The axis tooltip's crosshair: a vertical hairline in `grid`. */
export function crosshair(tokens: ResolvedTokens): TooltipComponentOption['axisPointer'] {
  return { type: 'line', snap: true, lineStyle: { color: paint(tokens, 'grid'), width: 1, type: 'solid' }, label: { show: false } };
}

/** One row of the hover readout. */
export interface TooltipRow {
  readonly value: string;
  readonly label: string;
  /** The key's colour; omitted for a plain row. */
  readonly colour?: string;
  readonly key?: TooltipKeyShape;
}

function element(tag: 'div' | 'span' | 'strong', className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function keyNode(colour: string, shape: TooltipKeyShape): HTMLElement {
  const node = element('span', tooltipKeyVariants({ shape }));
  // The colour is a resolved token value, known only at run time.
  node.style.background = colour;
  return node;
}

/** The hover readout: an optional heading in `ink-2`, then rows of value (strong, `ink`) and label (`ink-2`). */
export function tooltipNode(heading: string | undefined, rows: readonly TooltipRow[]): HTMLElement {
  const root = element('div', tooltipSurfaceVariants());
  if (heading !== undefined) root.append(element('div', tooltipHeadingVariants(), heading));
  for (const row of rows) {
    const line = element('div', tooltipRowVariants());
    if (row.colour !== undefined) line.append(keyNode(row.colour, row.key ?? 'line'));
    line.append(element('strong', tooltipValueVariants(), row.value), element('span', tooltipLabelVariants(), row.label));
    root.append(line);
  }
  return root;
}

/** The first hovered item, whether ECharts passed one or a list. */
export function firstParam(params: TooltipParams): ReturnType<typeof paramList>[number] | undefined {
  return paramList(params)[0];
}

/** Every hovered item as a list. */
export function paramList(params: TooltipParams): Exclude<TooltipParams, unknown[]>[] {
  return Array.isArray(params)
    ? params
    : [params];
}

/** The numeric value of a `[x, y]` or plain data value. */
export function numericAt(value: unknown, index: number): number {
  if (Array.isArray(value)) {
    const item: unknown = value[index];
    return typeof item === 'number'
      ? item
      : Number(item);
  }
  return typeof value === 'number'
    ? value
    : Number(value);
}
