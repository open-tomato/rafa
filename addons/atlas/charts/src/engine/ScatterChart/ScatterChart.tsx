import type { ScatterChartProps } from '../../seam/types.js';
import type { ReactElement } from 'react';

import { EChart, type EChartProps, useBuiltOption } from '../shared.js';

import { DOTS_SERIES, HIT_SERIES, buildOption } from './ScatterChart.option.js';

/** Hovering the hit target lifts the visible dot under it. */
const liftDot: NonNullable<EChartProps['onEvents']> = {
  mouseover: (event, instance) => {
    const index = dataIndexOf(event);
    if (index !== undefined) instance.dispatchAction({ type: 'highlight', seriesId: DOTS_SERIES, dataIndex: index });
  },
  mouseout: (event, instance) => {
    const index = dataIndexOf(event);
    if (index !== undefined) instance.dispatchAction({ type: 'downplay', seriesId: DOTS_SERIES, dataIndex: index });
  },
};

function dataIndexOf(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const { seriesId, dataIndex } = event as { seriesId?: unknown; dataIndex?: unknown };
  return seriesId === HIT_SERIES && typeof dataIndex === 'number'
    ? dataIndex
    : undefined;
}

/** The ScatterChart drawn with ECharts. */
export function ScatterChart(props: ScatterChartProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} onEvents={liftDot} />;
}
