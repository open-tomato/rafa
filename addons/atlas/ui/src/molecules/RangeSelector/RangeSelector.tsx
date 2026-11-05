import type { SegmentedSize } from '../../atoms/Segmented/Segmented.variants.js';
import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { Segmented, type SegmentedOption } from '../../atoms/Segmented/Segmented.js';
import { TIME_RANGES, type TimeRange } from '../../contract/schemas.js';

import { rangeSelectorVariants } from './RangeSelector.variants.js';

/** The label each range shows. */
export const RANGE_LABELS: Readonly<Record<TimeRange, string>> = {
  'now': 'Now',
  'last-week': 'Last week',
  'past-month': 'Past month',
  'last-year': 'Last year',
};

/** The four ranges as segmented options, in contract order. */
const RANGE_OPTIONS: readonly SegmentedOption<TimeRange>[] = TIME_RANGES.map((value) => ({ value, label: RANGE_LABELS[value] }));

/** A range selector's props: the range and its change handler. */
export interface RangeSelectorProps {
  readonly value: TimeRange;
  readonly onChange: (range: TimeRange) => void;
  readonly label?: string;
  readonly size?: SegmentedSize;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The page-level range: now, last week, past month or last year, as one segmented control. */
export function RangeSelector({ value, onChange, label = 'Time range', size, className }: RangeSelectorProps): ReactElement {
  return (
    <Segmented
      value={value}
      options={RANGE_OPTIONS}
      onChange={onChange}
      label={label}
      size={size}
      className={cn(rangeSelectorVariants(), className)}
    />
  );
}
