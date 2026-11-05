import type { LineChartProps } from '../../seam/types.js';
import type { LineSeriesOption } from 'echarts/charts';
import type { DataZoomComponentOption } from 'echarts/components';

import { formatCompact, formatDay } from '../../seam/format.js';
import {
  crosshair,
  numericAt,
  paramList,
  plotGrid,
  referenceLabelRoom,
  referenceLine,
  timeAxis,
  type TimeTicks,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
  valueAxis,
} from '../chrome.js';
import {
  type ChartOption,
  paint,
  type ResolvedTokens,
  withAlpha,
} from '../core.js';

const AREA_WASH = 0.1;
/** The hover dot: 8px plus the 2px surface ring. */
const HOVER_DOT_SIZE = 10;
const SLIDER_HEIGHT = 24;
/** Room under the plot for the slider, the gap above it and the x tick labels. */
const SLIDER_ROOM = SLIDER_HEIGHT + 12;
const SLIDER_FILL_ALPHA = 0.15;

/**
 * The range selector: a slider under the plot plus wheel-with-ctrl (pinch)
 * and drag zoom inside it, both showing the whole range until the viewer
 * moves them.
 */
function zoomOption(tokens: ResolvedTokens): DataZoomComponentOption[] {
  const range = { start: 0, end: 100 };
  const accent = paint(tokens, 'series-1');
  const grid = paint(tokens, 'grid');
  return [
    {
      type: 'slider',
      xAxisIndex: 0,
      filterMode: 'none',
      ...range,
      height: SLIDER_HEIGHT,
      bottom: 0,
      left: 8,
      right: 12,
      borderColor: paint(tokens, 'baseline'),
      borderRadius: 4,
      backgroundColor: 'transparent',
      fillerColor: withAlpha(accent, SLIDER_FILL_ALPHA),
      dataBackground: { lineStyle: { color: grid, width: 1 }, areaStyle: { color: withAlpha(grid, 0.5) } },
      selectedDataBackground: { lineStyle: { color: accent, width: 1 }, areaStyle: { color: withAlpha(accent, 0.1) } },
      handleStyle: { color: paint(tokens, 'ink-2'), borderColor: paint(tokens, 'surface'), borderWidth: 1 },
      moveHandleSize: 0,
      brushSelect: false,
      showDetail: false,
      emphasis: { handleStyle: { color: paint(tokens, 'ink'), borderColor: paint(tokens, 'surface') } },
    },
    {
      type: 'inside',
      xAxisIndex: 0,
      filterMode: 'none',
      ...range,
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: true,
    },
  ];
}

/** The pinned ticks for `xStep`, over the span of every series' points; none without a step or a point. */
function timeTicksOf(props: LineChartProps): TimeTicks | undefined {
  if (props.xStep === undefined) return undefined;
  const times = props.series.flatMap((entry) => entry.points.map((point) => point.x.getTime()));
  if (times.length === 0) return undefined;
  return { step: props.xStep, from: Math.min(...times), to: Math.max(...times) };
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: LineChartProps, tokens: ResolvedTokens): ChartOption {
  const { variant = 'line', baseline } = props;
  const format = props.valueFormat ?? formatCompact;
  const xFormat = props.xFormat ?? formatDay;
  const surface = paint(tokens, 'surface');

  const series: LineSeriesOption[] = props.series.map((entry, index) => {
    const colour = paint(tokens, entry.tone);
    return {
      type: 'line',
      id: entry.id,
      name: entry.label,
      stack: variant === 'stacked-area'
        ? 'total'
        : undefined,
      // The symbol stays hidden until the crosshair lands on its x.
      symbol: 'circle',
      symbolSize: HOVER_DOT_SIZE,
      showSymbol: false,
      lineStyle: { color: colour, width: 2, cap: 'round', join: 'round' },
      itemStyle: { color: colour, borderColor: surface, borderWidth: 2 },
      areaStyle: variant === 'line'
        ? undefined
        : { color: colour, opacity: AREA_WASH },
      emphasis: { focus: 'none', lineStyle: { width: 2 } },
      data: entry.points.map((point) => [point.x.getTime(), point.y]),
      markLine: baseline && index === 0
        ? referenceLine(tokens, 'yAxis', baseline.value, baseline.label)
        : undefined,
    };
  });

  const tooltipFormatter = (params: TooltipParams) => {
    const items = paramList(params);
    const time = numericAt(items[0]?.value, 0);
    const rows = items.map((item) => {
      const entry = props.series[item.seriesIndex ?? 0];
      return {
        value: format(numericAt(item.value, 1)),
        label: entry?.label ?? '',
        colour: paint(tokens, entry?.tone ?? 'series-1'),
        key: 'line' as const,
      };
    });
    return tooltipNode(Number.isFinite(time)
      ? xFormat(new Date(time))
      : undefined, rows);
  };

  const ceiling = baseline
    ? (extent: { max: number }) => Math.max(extent.max, baseline.value)
    : undefined;
  return {
    grid: plotGrid({ right: baseline
      ? referenceLabelRoom(baseline.label)
      : 12, bottom: props.zoom
      ? SLIDER_ROOM
      : 4 }),
    dataZoom: props.zoom
      ? zoomOption(tokens)
      : undefined,
    xAxis: timeAxis(tokens, xFormat, timeTicksOf(props)),
    yAxis: valueAxis(tokens, format, { min: 0, max: ceiling }),
    tooltip: { ...tooltipChrome('axis'), axisPointer: crosshair(tokens), formatter: tooltipFormatter },
    series,
  };
}
