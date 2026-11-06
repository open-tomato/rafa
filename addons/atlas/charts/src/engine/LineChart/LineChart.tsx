import type { LineChartProps } from '../../seam/types.js';
import type { ChartOption } from '../core.js';
import type { DataZoomComponentOption } from 'echarts/components';
import type { ECharts } from 'echarts/core';

import { useMemo, useRef, type ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './LineChart.option.js';

/** Series are replaced by id on a re-render; the data-zoom window is merged, so it survives a legend toggle. */
const REPLACE_MERGE: readonly string[] = ['series'];

/** The zoom window as axis values (epoch ms); null when the whole range shows. */
export type ZoomWindow = { from: number; to: number } | null;

interface ZoomReading { start?: number; end?: number; startValue?: number; endValue?: number }

/** The live data-zoom window, read back from the instance. */
export function readZoomWindow(instance: Pick<ECharts, 'getOption'>): ZoomWindow {
  // Before the first option is set the instance has none to give.
  const live = instance.getOption() as { dataZoom?: ZoomReading[] } | undefined;
  const zoom = live?.dataZoom?.[0];
  if (!zoom) return null;
  const full = (zoom.start ?? 0) <= 0 && (zoom.end ?? 100) >= 100;
  if (full || zoom.startValue === undefined || zoom.endValue === undefined) return null;
  return { from: zoom.startValue, to: zoom.endValue };
}

/**
 * Pins the live zoom window into a rebuilt option, so a legend toggle or a
 * theme flip never moves it. The window is read from the instance when the
 * option is set, not while rendering; the whole range leaves the option as is.
 */
export function carryZoom(option: ChartOption, instance: Pick<ECharts, 'getOption'>): ChartOption {
  const zoomWindow = readZoomWindow(instance);
  if (zoomWindow === null || !Array.isArray(option.dataZoom)) return option;
  const dataZoom = option.dataZoom.map((entry): DataZoomComponentOption => {
    // The percent range would win over the values, so it leaves the entry.
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'start' && key !== 'end')) as DataZoomComponentOption;
    return { ...rest, startValue: zoomWindow.from, endValue: zoomWindow.to };
  });
  return { ...option, dataZoom };
}

/** The LineChart drawn with ECharts. */
export function LineChart(props: LineChartProps): ReactElement {
  const { className } = props;
  // The last range reported; a ref, so a drag does not re-render this component.
  const reportedRef = useRef<ZoomWindow>(null);
  const option = useBuiltOption(props, buildOption);
  const { onRangeChange, zoom } = props;
  const onEvents = useMemo(() => (zoom
    ? {
      datazoom: (_event: unknown, instance: ECharts): void => {
        const next = readZoomWindow(instance);
        const previous = reportedRef.current;
        if (next?.from === previous?.from && next?.to === previous?.to) return;
        reportedRef.current = next;
        onRangeChange?.(next === null
          ? null
          : { from: new Date(next.from), to: new Date(next.to) });
      },
    }
    : undefined), [zoom, onRangeChange]);
  return (
    <EChart
      option={option}
      ariaLabel={props.ariaLabel}
      height={props.height}
      className={className}
      onEvents={onEvents}
      replaceMerge={zoom
        ? REPLACE_MERGE
        : undefined}
      transform={zoom
        ? carryZoom
        : undefined}
    />
  );
}
