import type { NightingaleProps } from '../../seam/types.js';
import type { ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './Nightingale.option.js';

/** The Nightingale drawn with ECharts. */
export function Nightingale(props: NightingaleProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} />;
}
