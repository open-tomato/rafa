import type { BoxPlotProps } from '../../seam/types.js';
import type { ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './BoxPlot.option.js';

/** The BoxPlot drawn with ECharts. */
export function BoxPlot(props: BoxPlotProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} />;
}
