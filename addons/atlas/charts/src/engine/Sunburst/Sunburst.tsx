import type { SunburstProps } from '../../seam/types.js';

import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react';

import { useResolvedTokens } from '../../seam/useResolvedTokens.js';
import { finishOption } from '../core.js';
import { EChart } from '../shared.js';
import { chartFrameVariants } from '../shared.variants.js';

import { pathsById, buildOption } from './Sunburst.option.js';

function idOf(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null || !('data' in event)) return undefined;
  const data: unknown = event.data;
  return typeof data === 'object' && data !== null && 'id' in data
    ? String(data.id)
    : undefined;
}

/** An element's size in whole px; zero until it is measured. */
interface MeasuredSize {
  readonly width: number;
  readonly height: number;
}

const UNMEASURED: MeasuredSize = { width: 0, height: 0 };

/**
 * Tracks an element's size. A radial label runs across its ring, so the
 * ring's depth in px (from the canvas size) is the width it may take; the
 * height counts only when the chart fills its container.
 */
function useSize(): [(element: HTMLDivElement | null) => (() => void) | undefined, MeasuredSize] {
  const [size, setSize] = useState<MeasuredSize>(UNMEASURED);
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width ?? 0);
      const height = Math.round(entry?.contentRect.height ?? 0);
      setSize((current) => (current.width === width && current.height === height
        ? current
        : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** The Sunburst drawn with ECharts. */
export function Sunburst(props: SunburstProps): ReactElement {
  const { className } = props;
  const [measure, size] = useSize();
  const fill = props.height === 'fill';
  // A fixed height is known, so only a filling chart rebuilds when its height changes.
  const { width } = size;
  const height = fill
    ? size.height
    : 0;
  const tokens = useResolvedTokens();
  const option = useMemo(() => finishOption(buildOption(props, tokens, width, height), props.animate), [props, tokens, width, height]);
  const { onNodeClick, nodes } = props;
  const onEvents = useMemo(() => (onNodeClick
    ? {
      click: (event: unknown): void => {
        const id = idOf(event);
        const path = id === undefined
          ? undefined
          : pathsById(nodes).get(id);
        if (path) onNodeClick(path);
      },
    }
    : undefined), [nodes, onNodeClick]);
  return (
    <div ref={measure} className={chartFrameVariants({ fill })}>
      <EChart
        option={option}
        ariaLabel={props.ariaLabel}
        height={props.height}
        className={className}
        cursor={onNodeClick
          ? 'auto'
          : 'default'}
        onEvents={onEvents}
      />
    </div>
  );
}
