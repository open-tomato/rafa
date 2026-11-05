import type { HeatmapCell, HeatmapGridProps } from '../../seam/types.js';

import { useMemo, type ReactElement } from 'react';

import { EChart, useBuiltOption } from '../shared.js';

import { buildOption } from './HeatmapGrid.option.js';

/** The cell an ECharts click event names, from its `[col, row, value]` data. */
function cellOf(event: unknown): HeatmapCell | null {
  if (typeof event !== 'object' || event === null || !('value' in event)) return null;
  const value: unknown = event.value;
  if (!Array.isArray(value)) return null;
  const [col, row, count] = value.map(Number);
  if (col === undefined || row === undefined || count === undefined) return null;
  return { row, col, value: count };
}

/** The HeatmapGrid drawn with ECharts. */
export function HeatmapGrid(props: HeatmapGridProps): ReactElement {
  const { className } = props;
  const option = useBuiltOption(props, buildOption);
  const { onCellClick } = props;
  const onEvents = useMemo(() => (onCellClick
    ? {
      click: (event: unknown): void => {
        const cell = cellOf(event);
        if (cell) onCellClick(cell);
      },
    }
    : undefined), [onCellClick]);
  // Cells are not buttons unless a click handler makes them so.
  return (
    <EChart
      option={option}
      ariaLabel={props.ariaLabel}
      height={props.height}
      className={className}
      cursor={onCellClick
        ? 'auto'
        : 'default'}
      onEvents={onEvents}
    />
  );
}
