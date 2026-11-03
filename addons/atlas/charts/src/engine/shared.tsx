/**
 * The engine's React adapter: the canvas renderer, the hook that builds a
 * primitive's option over the live tokens, and the chart root. The option
 * side (registration, the option type, the colour bridge) is `core.ts`.
 *
 * Canvas cannot read CSS variables, so a primitive re-runs its pure
 * `(props, tokens) => option` when the tokens change (a theme flip) and
 * `EChart` sets it with `notMerge`, so a flip repaints fully.
 */
import type { ChartHeight } from '../seam/height.js';
import type { ECharts } from 'echarts/core';

import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';

import { cn } from '../lib/cn.js';
import { useResolvedTokens } from '../seam/useResolvedTokens.js';

import { DEFAULT_HEIGHT, finishOption, type ChartOption, type ResolvedTokens } from './core.js';
import { chartRootVariants, type ChartCursor } from './shared.variants.js';

echarts.use([CanvasRenderer]);

/**
 * The option of one primitive: its pure `build(props, tokens)` over the
 * resolved tokens, finished with the shared options. Rebuilt when the props
 * or the tokens (a theme flip) change.
 */
export function useBuiltOption<P extends { readonly animate?: boolean }>(
  props: P,
  build: (props: P, tokens: ResolvedTokens) => ChartOption,
): ChartOption {
  const tokens = useResolvedTokens();
  return useMemo(() => finishOption(build(props, tokens), props.animate), [build, props, tokens]);
}

/* ---------- the chart root ---------- */

/** A handler for one ECharts event, bound by name on the instance. */
export type ChartEventHandler = (event: unknown, instance: ECharts) => void;

/** The props of {@link EChart}. */
export interface EChartProps {
  readonly option: ChartOption;
  readonly ariaLabel: string;
  /** Px, or `'fill'` for the container's full height; 220px when absent. */
  readonly height?: ChartHeight;
  readonly className?: string;
  /** `'default'` keeps the arrow over charts whose marks are not buttons. */
  readonly cursor?: ChartCursor;
  /** ECharts events by name (`click`, `mouseover`), bound on the instance. */
  readonly onEvents?: Readonly<Record<string, ChartEventHandler>>;
  /**
   * Merge new options into the live chart instead of replacing it, replacing
   * only these components by id. Interaction state the option does not carry
   * (a data-zoom window) then survives a re-render. Every colour is explicit
   * in each option, so a theme flip still repaints fully. Default: replace.
   */
  readonly replaceMerge?: readonly string[];
  /**
   * Adjusts the option against the live instance just before it is set (for
   * state the instance holds and the option does not, such as a zoom window).
   */
  readonly transform?: (option: ChartOption, instance: ECharts) => ChartOption;
}

/**
 * The chart root over `echarts/core` directly: init on mount, dispose on
 * unmount, resize with the host, set each option with `notMerge` unless the
 * primitive asks for a `replaceMerge`, and bind the events by name.
 *
 * The host's height is a pixel count from a prop, which no class can carry,
 * so it is set on the element in the layout effect, ahead of `init`.
 * `'fill'` sets `100%`, so the host takes its container's height and the
 * resize observer below follows the container.
 */
export function EChart({ option, ariaLabel, height, className, cursor, onEvents, replaceMerge, transform }: EChartProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const hostHeight = height === 'fill'
    ? '100%'
    : `${height ?? DEFAULT_HEIGHT}px`;

  // Declared first, so on mount the height is set before init reads it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.style.height = hostHeight;
    chartRef.current?.resize();
  }, [hostHeight]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const chart = echarts.init(host, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    // The observer reports once on `observe`, at the size `init` just read. A
    // resize then is not a change, and it would restart a running layout
    // (a force graph), so only a different size is passed on.
    let width = chart.getWidth();
    let height = chart.getHeight();
    const observer = new ResizeObserver(() => {
      const next = { width: host.clientWidth, height: host.clientHeight };
      if (next.width === width && next.height === height) return;
      width = next.width;
      height = next.height;
      chart.resize();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const next = transform
      ? transform(option, chart)
      : option;
    chart.setOption(next, replaceMerge
      ? { replaceMerge: [...replaceMerge] }
      : { notMerge: true });
  }, [option, replaceMerge, transform]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return undefined;
    const bound = Object.entries(onEvents).map(([name, handler]) => {
      const listener = (event: unknown): void => handler(event, chart);
      chart.on(name, listener);
      return [name, listener] as const;
    });
    return () => {
      for (const [name, listener] of bound) chart.off(name, listener);
    };
  }, [onEvents]);

  return <div ref={hostRef} role="img" aria-label={ariaLabel} className={cn(chartRootVariants({ cursor }), className)} />;
}
