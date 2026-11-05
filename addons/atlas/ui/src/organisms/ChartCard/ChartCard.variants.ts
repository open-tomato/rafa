import { cva } from 'class-variance-authority';

/** The chart card's body: the legend over the chart, the chart taking what is left. */
export const chartCardBodyVariants: (props?: ChartCardBodyVariantProps) => string = cva(
  'flex min-h-0 flex-col gap-3',
  {
    variants: {
      maximised: { true: 'h-full', false: '' },
    },
    defaultVariants: { maximised: false },
  },
);

/** The variant props `chartCardBodyVariants` takes. */
export interface ChartCardBodyVariantProps {
  readonly maximised?: boolean | null;
}
