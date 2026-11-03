import type { CardSpec } from '../../contract/schemas.js';
import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { useDashboardSlice } from '../../context/DashboardData.js';
import { ChartCard, type ChartCardProps } from '../../organisms/ChartCard/ChartCard.js';

import { dashboardCardVariants } from './DashboardCard.variants.js';

/** A dashboard card's props: a static config, the selector over the page's result set, and the chart card's chrome props. */
export interface DashboardCardProps<R, T> extends Omit<
  ChartCardProps<T>,
  'config' | 'onConfigChange' | 'configurable' | 'interactive' | 'data' | 'status' | 'error' | 'onRefresh'
> {
  readonly config: CardSpec;
  /** Picks this card's slice of the page's result set; runs during render. */
  readonly select: (result: R) => T;
}

/**
 * The `dashboard` mode: a static card over one slice of the page's
 * result set (`DashboardData` above). A page refresh or a new page range
 * re-renders every card; `useDashboard().refreshCard(config.id)`
 * re-renders this one from scratch; Try again asks the page again.
 */
export function DashboardCard<R, T>({ config, select, className, ...rest }: DashboardCardProps<R, T>): ReactElement {
  const slice = useDashboardSlice(select, config.id);
  return (
    <ChartCard
      key={slice.revision}
      config={config}
      data={slice.data}
      status={slice.status}
      error={slice.error}
      onRefresh={slice.refreshPage}
      className={cn(dashboardCardVariants(), className)}
      {...rest}
    />
  );
}
