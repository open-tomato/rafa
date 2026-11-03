import type { CardSpec } from '../../contract/schemas.js';
import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { ChartCard, type ChartCardProps } from '../../organisms/ChartCard/ChartCard.js';

import { widgetCardVariants } from './WidgetCard.variants.js';

/** A widget's props: a predefined config, the data the consumer pushes, and the chart card's chrome props. */
export interface WidgetCardProps<T> extends Omit<ChartCardProps<T>, 'config' | 'onConfigChange' | 'configurable' | 'interactive' | 'data'> {
  readonly config: CardSpec;
  /** The data in the chart's shape, from the consumer's own transport; `undefined` shows loading. */
  readonly data: T | undefined;
}

/**
 * The `widget` mode: a predefined card fed by the consumer, who pushes
 * new `data` through their own transport. `CardSpecProvider` →
 * `CardBoundary` → `CardLayout` → chart, with the menu and modals on and
 * no fetching; `onRefresh`, when given, is what Try again calls.
 */
export function WidgetCard<T>({ config, className, ...rest }: WidgetCardProps<T>): ReactElement {
  return <ChartCard config={config} className={cn(widgetCardVariants(), className)} {...rest} />;
}
