import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { progressBarVariants, progressTrackVariants, type ProgressBarVariants } from './Progress.variants.js';

/** The fill's share of the track while indeterminate. */
const SWEEP_WIDTH = '40%';

/** The percentage range a value is clamped to. */
const MIN_VALUE = 0;
const MAX_VALUE = 100;

/** A progress bar's props: the value, the tone, the indeterminate flag, the name and a layout-only passthrough class. */
export interface ProgressProps extends ProgressBarVariants {
  /** 0 to 100; ignored while indeterminate. */
  readonly value?: number;
  /** Names the bar for assistive technology. */
  readonly label: string;
  /** Layout context from the parent (margin, width); never colour or size. */
  readonly className?: string;
}

/** Determinate when the fraction is known, a sweeping fill when it is not. */
export function Progress({ value = 0, tone, indeterminate = false, label, className }: ProgressProps): ReactElement {
  const clamped = Math.max(MIN_VALUE, Math.min(MAX_VALUE, value));
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={MIN_VALUE}
      aria-valuemax={MAX_VALUE}
      aria-valuenow={indeterminate
        ? undefined
        : Math.round(clamped)}
      className={cn(progressTrackVariants(), className)}
    >
      <rect
        x="0"
        y="0"
        width={indeterminate
          ? SWEEP_WIDTH
          : `${clamped}%`}
        height="100%"
        rx="4"
        fill="currentColor"
        className={progressBarVariants({ tone, indeterminate })}
      />
    </svg>
  );
}
