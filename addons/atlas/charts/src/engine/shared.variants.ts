import { cva } from 'class-variance-authority';

/** Where the chart root's pointer cursor comes from. */
export type ChartCursor = 'auto' | 'default';

/** The variant props `chartRootVariants` takes. */
export interface ChartRootVariantProps {
  readonly cursor?: ChartCursor | null;
}

/**
 * The element a chart is drawn into: as wide as its container. `cursor:
 * 'default'` is for charts whose marks are not buttons: zrender puts an
 * inline pointer cursor on every hoverable mark, and this wins over it.
 */
export const chartRootVariants: (props?: ChartRootVariantProps) => string = cva('block w-full', {
  variants: {
    cursor: {
      auto: '',
      default: '[&_*]:cursor-default!',
    },
  },
  defaultVariants: { cursor: 'auto' },
});

/** The variant props `chartFrameVariants` takes. */
export interface ChartFrameVariantProps {
  readonly fill?: boolean | null;
}

/**
 * A box a primitive wraps its chart root in (to measure it): no box of
 * its own unless the chart fills its container, when it passes the
 * container's height down to the root.
 */
export const chartFrameVariants: (props?: ChartFrameVariantProps) => string = cva('', {
  variants: {
    fill: { true: 'h-full', false: '' },
  },
  defaultVariants: { fill: false },
});

/** The hover readout every chart renders into: surface, hairline ring, small text. */
export const tooltipSurfaceVariants: () => string = cva(
  'pointer-events-none rounded-md bg-surface px-2.5 py-2 text-xs text-ink shadow-md shadow-black/10 ring-1 ring-ring',
);

/** The readout's heading line. */
export const tooltipHeadingVariants: () => string = cva('mb-1 text-ink-2');

/** One readout row: key, value, label. */
export const tooltipRowVariants: () => string = cva('flex items-center gap-1.5 whitespace-nowrap');

/** A readout row's strong value. */
export const tooltipValueVariants: () => string = cva('font-semibold text-ink tabular-nums');

/** A readout row's label. */
export const tooltipLabelVariants: () => string = cva('text-ink-2');

/** The shape of a readout row's colour key. */
export type TooltipKeyShape = 'line' | 'dot';

/** The variant props `tooltipKeyVariants` takes. */
export interface TooltipKeyVariantProps {
  readonly shape?: TooltipKeyShape | null;
}

/** The colour key in front of a readout row: a short line for line marks, a dot for the rest. */
export const tooltipKeyVariants: (props?: TooltipKeyVariantProps) => string = cva('inline-block rounded-full', {
  variants: {
    shape: {
      line: 'h-0.5 w-3',
      dot: 'size-2',
    },
  },
  defaultVariants: { shape: 'dot' },
});
