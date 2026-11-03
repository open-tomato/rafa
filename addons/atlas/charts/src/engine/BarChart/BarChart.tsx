import type { BarChartProps } from '../../seam/types.js';
import type { ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './BarChart.option.js';

/** The BarChart drawn with ECharts. */
export function BarChart(props: BarChartProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} />;
}
