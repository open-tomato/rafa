import type { SankeyProps } from '../../seam/types.js';

import { useMemo, type ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './Sankey.option.js';

/** The Sankey drawn with ECharts. */
export function Sankey(props: SankeyProps): ReactElement {
  const { className } = props;
  const { nodes, links, groupTones, groupOrder, valueFormat, animate } = props;
  const optionProps = useMemo(
    () => ({ nodes, links, groupTones, groupOrder, valueFormat, animate }),
    [nodes, links, groupTones, groupOrder, valueFormat, animate],
  );
  const option = useBuiltOption(optionProps, buildOption);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} cursor="default" />;
}
