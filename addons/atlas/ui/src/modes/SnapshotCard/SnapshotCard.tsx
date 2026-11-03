import type { LegendItem } from '../../context/types.js';
import type { CardSpec } from '../../contract/schemas.js';
import type { ChartRender } from '../../organisms/ChartCard/ChartCard.js';
import type { ReactElement } from 'react';

import { cn, DEFAULT_CHART_HEIGHT } from '@open-tomato/charts';

import { Legend } from '../../atoms/Legend/Legend.js';
import { CardHeader } from '../../molecules/CardHeader/CardHeader.js';
import { CardLayout } from '../../organisms/CardLayout/CardLayout.js';
import { chartCardBodyVariants } from '../../organisms/ChartCard/ChartCard.variants.js';
import { NO_HIDDEN } from '../../organisms/ChartCard/entries.js';

import { snapshotCardVariants } from './SnapshotCard.variants.js';

/** A snapshot's props: static config, static data, the legend and the chart. */
export interface SnapshotCardProps<T> {
  readonly config: CardSpec;
  readonly data: T;
  readonly legend?: readonly LegendItem[] | ((data: T) => readonly LegendItem[]);
  /** Layout context from the parent (grid placement); never colour or size. */
  readonly className?: string;
  readonly children: ChartRender<T>;
}

/**
 * The `snapshot` mode: static config and data rendered once. Only
 * `CardLayout`'s header and content are present — no menu, no modals, no
 * legend toggles, and the chart is told not to animate. Nothing here
 * touches a browser API during render, so it renders to a string on the
 * server (`renderToStaticMarkup`) for an export or an email.
 */
export function SnapshotCard<T>({ config, data, legend, className, children }: SnapshotCardProps<T>): ReactElement {
  const items = typeof legend === 'function'
    ? legend(data)
    : legend ?? [];
  return (
    <CardLayout
      title={config.title}
      header={<CardHeader title={config.title} subtitle={config.subtitle} />}
      menu={null}
      span={config.span}
      footer={config.source
        ? `Source: ${config.source}`
        : undefined}
      className={cn(snapshotCardVariants(), className)}
      content={(
        <div className={chartCardBodyVariants()}>
          <Legend items={items} mark={config.legend?.mark} />
          {children({ data, hidden: NO_HIDDEN, animate: false, maximised: false, height: DEFAULT_CHART_HEIGHT })}
        </div>
      )}
    />
  );
}
