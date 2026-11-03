import type { KeyboardEvent, ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { segmentedOptionVariants, segmentedVariants, type SegmentedSize } from './Segmented.variants.js';

/** One option of a segmented control. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** A segmented control's props: the options, the checked value and its change handler. */
export interface SegmentedProps<T extends string> {
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  /** Names the radio group for assistive technology. */
  readonly label: string;
  readonly size?: SegmentedSize;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** Arrow keys that move the choice, and the step each takes. */
const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A small radio group drawn as one pill: a range, a window, a view. The
 * checked option takes the tab stop, and the arrow keys move the choice
 * and the focus together, as a radio group does.
 */
export function Segmented<T extends string>({ value, options, onChange, label, size, className }: SegmentedProps<T>): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = STEP[event.key];
    if (step === undefined || options.length === 0) return;
    event.preventDefault();
    const nextIndex = (index + step + options.length) % options.length;
    const next = options[nextIndex];
    if (next === undefined) return;
    onChange(next.value);
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[nextIndex]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn(segmentedVariants({ size }), className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked
              ? 0
              : -1}
            className={segmentedOptionVariants({ size, checked })}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
