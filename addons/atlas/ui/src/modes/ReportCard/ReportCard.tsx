import type { DataSource } from '../../context/useSourced.js';
import type { CardSpec, TimeRange } from '../../contract/schemas.js';

import { cn } from '@open-tomato/charts';
import { useState, type ReactElement } from 'react';

import { CardData } from '../../context/CardData.js';
import { ChartCard, type ChartCardProps } from '../../organisms/ChartCard/ChartCard.js';

import { reportCardVariants } from './ReportCard.variants.js';

/** A report card's props: the starting config, the card's own source, and the chart card's chrome props. */
export interface ReportCardProps<T> extends Omit<
  ChartCardProps<T>,
  'config' | 'onConfigChange' | 'configurable' | 'interactive' | 'data' | 'status' | 'error' | 'onRefresh'
> {
  /** The starting descriptor; the Config modal edits the card's own copy of it. */
  readonly config: CardSpec;
  /** Asked for the config's range, again after each range edit and each Try again. */
  readonly source: DataSource<T>;
  /** Told after each Config edit, with the whole new config (to save it, say). */
  readonly onConfigChange?: (next: CardSpec) => void;
}

/**
 * The `report` mode: the whole cascade, live per card. `CardData` asks
 * `source` for the config's range; the card owns its config, which the
 * Config modal edits — a new range asks the source again. Later changes
 * to the `config` prop are not read; give the card a new `key` instead.
 */
export function ReportCard<T>({ config: initial, source, onConfigChange, className, ...rest }: ReportCardProps<T>): ReactElement {
  const [config, setConfig] = useState(initial);
  const change = (next: CardSpec): void => {
    setConfig(next);
    onConfigChange?.(next);
  };
  const range: TimeRange | undefined = config.range;
  return (
    <CardData source={source} range={range}>
      <ChartCard config={config} onConfigChange={change} configurable className={cn(reportCardVariants(), className)} {...rest} />
    </CardData>
  );
}
