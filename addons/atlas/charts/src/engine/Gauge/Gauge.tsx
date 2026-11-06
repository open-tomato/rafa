import type { GaugeProps } from '../../seam/types.js';
import type { ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './Gauge.option.js';

/** The Gauge drawn with ECharts. */
export function Gauge(props: GaugeProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} />;
}
