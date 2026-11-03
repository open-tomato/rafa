import type { TreemapProps } from '../../seam/types.js';
import type { ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './Treemap.option.js';

/** The Treemap drawn with ECharts. */
export function Treemap(props: TreemapProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} />;
}
