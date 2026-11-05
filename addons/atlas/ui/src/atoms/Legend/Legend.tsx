import type { LegendItem, LegendMark } from '../../context/types.js';
import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { legendEntryVariants, legendMarkVariants, legendVariants, type LegendLayout } from './Legend.variants.js';

/** A legend's props: the series, the mark shape, and the hidden set with its toggle when interactive. */
export interface LegendProps {
  readonly items: readonly LegendItem[];
  /** `rect` mirrors bars and areas; `line` mirrors strokes. */
  readonly mark?: LegendMark;
  /** The series the reader hid; read only when `onToggle` is set. */
  readonly hidden?: ReadonlySet<string>;
  /** Makes each entry a toggle button that hides or shows its series. */
  readonly onToggle?: (id: string) => void;
  /** The list's accessible name. */
  readonly label?: string;
  /** `side` stacks the entries beside a maximised chart; `row` wraps them under one. */
  readonly layout?: LegendLayout;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/**
 * The series a chart draws, shown for two or more. Identity is never
 * colour alone, so each mark sits beside its label in text ink. With
 * `onToggle`, each entry is a button whose `aria-pressed` says whether its
 * series is shown.
 */
export function Legend({ items, mark = 'rect', hidden, onToggle, label = 'Legend', layout, className }: LegendProps): ReactElement | null {
  if (items.length < 2) return null;
  const interactive = onToggle !== undefined;
  return (
    <ul aria-label={label} className={cn(legendVariants({ layout }), className)}>
      {items.map((item) => {
        const isHidden = interactive && (hidden?.has(item.id) ?? false);
        const swatch = <span aria-hidden="true" className={legendMarkVariants({ mark, tone: item.tone, hidden: isHidden })} />;
        if (!interactive) {
          return (
            <li key={item.id} className={legendEntryVariants()}>
              {swatch}
              <span>{item.label}</span>
            </li>
          );
        }
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={!isHidden}
              title={isHidden
                ? `Show ${item.label}`
                : `Hide ${item.label}`}
              className={legendEntryVariants({ interactive: true, hidden: isHidden })}
              onClick={() => onToggle(item.id)}
            >
              {swatch}
              <span>{item.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
