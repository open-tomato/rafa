import type { NetworkGraphProps } from '../../seam/types.js';

import { useMemo, type ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { nodeIdOf, buildOption } from './NetworkGraph.option.js';

/** The NetworkGraph drawn with ECharts. */
export function NetworkGraph(props: NetworkGraphProps): ReactElement {
  const { className } = props;
  // A new option restarts the force layout, so a parent re-render must not rebuild it.
  const { nodes, links, groupTones, onNodeClick, animate } = props;
  const optionProps = useMemo(
    () => ({ nodes, links, groupTones, onNodeClick, animate }),
    [nodes, links, groupTones, onNodeClick, animate],
  );
  const option = useBuiltOption(optionProps, buildOption);
  const onEvents = useMemo(() => (onNodeClick
    ? {
      click: (event: unknown): void => {
        const data: unknown = typeof event === 'object' && event !== null && 'data' in event
          ? event.data
          : undefined;
        const node = nodes.find((entry) => entry.id === nodeIdOf(data));
        if (node) onNodeClick(node);
      },
    }
    : undefined), [nodes, onNodeClick]);
  return <EChart option={option} ariaLabel={props.ariaLabel} height={props.height} className={className} onEvents={onEvents} />;
}
