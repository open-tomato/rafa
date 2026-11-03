import type { LegendItem, TableData } from '../../context/types.js';
import type { DataStatus } from '../../context/useSourced.js';
import type { ContentView } from '../CardLayout/CardLayout.js';
import type { ModalEntry } from '../CardLayout/registry.js';
import type { ChartHeight } from '@open-tomato/charts';

import { useCallback, useState, type ReactElement, type ReactNode } from 'react';

import { Card } from '../../atoms/Card/Card.js';
import { Legend } from '../../atoms/Legend/Legend.js';
import { nextHidden } from '../../atoms/Legend/toggle.js';
import { CardBoundary } from '../../context/CardBoundary.js';
import { useOptionalCardData } from '../../context/CardData.js';
import { CardSpecProvider, useCardSpec } from '../../context/CardSpec.js';
import { applyDescriptor, descriptorOf, type CardSpec, type ModalKey } from '../../contract/schemas.js';
import { CardHeader } from '../../molecules/CardHeader/CardHeader.js';
import { CardStatus } from '../../molecules/CardStatus/CardStatus.js';
import { ConfigView } from '../../molecules/ConfigView/ConfigView.js';
import { InfoView } from '../../molecules/InfoView/InfoView.js';
import { SourceView } from '../../molecules/SourceView/SourceView.js';
import { CardLayout } from '../CardLayout/CardLayout.js';

import { chartCardBodyVariants } from './ChartCard.variants.js';
import { NO_HIDDEN, relabelAll } from './entries.js';

/** What the chart child receives. */
export interface ChartRenderArgs<T> {
  readonly data: T;
  /** The series the reader hid from the legend; empty unless the legend toggles. */
  readonly hidden: ReadonlySet<string>;
  /** Whether the chart may animate; false in snapshots and when the config says so. */
  readonly animate: boolean;
  /** True when rendered inside the maximise modal. */
  readonly maximised: boolean;
  /**
   * The height to hand the chart: `'fill'` inside the maximise modal, so it
   * fills the box; the charts' default px (220) in the card, which a chart
   * with a base height of its own ignores.
   */
  readonly height: ChartHeight;
}

/** The chart child: a pure render of the data and the card's view state. */
export type ChartRender<T> = (args: ChartRenderArgs<T>) => ReactNode;

/** A chart card's props: the config, the data (or the enclosing `CardData`), what the chrome shows, and the chart. */
export interface ChartCardProps<T> {
  /** The descriptor; when absent, the card reads an enclosing `CardSpecProvider`. */
  readonly config?: CardSpec;
  /** Makes `config` controlled: a Config edit is handed here. */
  readonly onConfigChange?: (next: CardSpec) => void;
  /** The data; when absent, the card reads an enclosing `CardData`. */
  readonly data?: T;
  readonly status?: DataStatus;
  readonly error?: Error | null;
  /** Asks the data again; Try again calls it. Defaults to the enclosing `CardData`'s refresh. */
  readonly onRefresh?: () => void;
  readonly legend?: readonly LegendItem[] | ((data: T) => readonly LegendItem[]);
  /** The data as a table, for the Source entry. */
  readonly table?: TableData | ((data: T) => TableData);
  /** Richer content for the Info entry than the config's description. */
  readonly info?: ReactNode;
  /** Controls in the header beside the title. */
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  /** The consumer's own registry entries, added to the built-in ones. */
  readonly modals?: Readonly<Record<string, ModalEntry>>;
  /** False drops the menu, the modals and the legend toggles (a snapshot). */
  readonly interactive?: boolean;
  /** Adds the `config` entry: a form over the descriptor. */
  readonly configurable?: boolean;
  /** Layout context from the parent (grid placement); never colour or size. */
  readonly className?: string;
  readonly children: ChartRender<T>;
}

/** A legend shows for two series or more (the `Legend` atom's rule), so the maximise view offers it from two. */
const MIN_LEGEND_ITEMS = 2;

/** What the boundary around the whole card says when the chrome itself threw. */
const CHROME_FAILURE = 'The card could not render its frame; reload the page to try again.';

/** A value or the value a function of the data gives. */
function fromData<T, V>(value: V | ((data: T) => V) | undefined, data: T | undefined): V | undefined {
  if (typeof value !== 'function') return value;
  return data === undefined
    ? undefined
    : (value as (data: T) => V)(data);
}

/** The card below the config and the outer boundary: reads both hooks and lays the card out. */
function ChartCardBody<T>({
  data: givenData,
  status: givenStatus,
  error: givenError,
  onRefresh,
  legend,
  table,
  info,
  actions,
  footer,
  modals,
  interactive = true,
  configurable = false,
  className,
  children,
}: Omit<ChartCardProps<T>, 'config' | 'onConfigChange'>): ReactElement {
  const { config, update } = useCardSpec();
  const sourced = useOptionalCardData<T>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_HIDDEN);

  const data = givenData ?? sourced?.data;
  const error = givenError ?? sourced?.error ?? null;
  const status: DataStatus = givenStatus ?? sourced?.status ?? (data === undefined
    ? 'loading'
    : 'ready');
  const refresh = onRefresh ?? sourced?.refresh;
  const legendItems = fromData(legend, data) ?? [];
  const tableData = fromData(table, data);
  const toggleable = interactive && (config.legend?.toggleable ?? false);
  const animate = interactive && (config.animate ?? true);
  const toggle = useCallback((id: string) => setHidden((current) => nextHidden(current, id, legendItems.length)), [legendItems.length]);
  const offered = (key: ModalKey): boolean => interactive && (config.modals === undefined || config.modals.includes(key));

  const builtIns: Record<string, ModalEntry> = {
    info: offered('info') && (
      <InfoView
        subtitle={config.subtitle}
        description={info ?? config.description}
        note={config.note}
        legend={legendItems}
        mark={config.legend?.mark}
        source={config.source}
      />
    ),
    source: offered('source') && tableData !== undefined && <SourceView table={tableData} caption={config.title} source={config.source} />,
    config: offered('config') && configurable && {
      render: ({ close }) => (
        <ConfigView
          value={descriptorOf(config)}
          onSubmit={(next) => {
            update(applyDescriptor(config, next));
            close();
          }}
          onCancel={close}
        />
      ),
      chrome: true,
    },
  };
  const registry = relabelAll({ ...builtIns, ...(interactive
    ? modals
    : {}) }, config.menu);

  const legendNode = (
    <Legend
      items={legendItems}
      mark={config.legend?.mark}
      hidden={toggleable
        ? hidden
        : undefined}
      onToggle={toggleable
        ? toggle
        : undefined}
    />
  );
  const maximiseExtras = {
    legend: legendItems.length >= MIN_LEGEND_ITEMS
      ? legendNode
      : undefined,
    table: tableData === undefined
      ? undefined
      : <SourceView table={tableData} caption={config.title} source={config.source} />,
  };

  // The maximise view offers the legend under a toggle, so the maximised content is the chart alone.
  const content = ({ maximised, height }: ContentView): ReactNode => (
    <div className={chartCardBodyVariants({ maximised })}>
      {!maximised && legendNode}
      {data === undefined
        ? <CardStatus kind={status === 'error'
          ? 'error'
          : 'loading'} detail={status === 'error'
          ? 'The details are under the card menu\'s Errors item.'
          : undefined} />
        : children({ data, hidden: toggleable
          ? hidden
          : NO_HIDDEN, animate, maximised, height })}
    </div>
  );

  return (
    <CardLayout
      title={config.title}
      header={<CardHeader title={config.title} subtitle={config.subtitle} actions={actions} />}
      menu={interactive
        ? undefined
        : null}
      content={content}
      footer={footer}
      modals={registry}
      maximisable={offered('maximise')}
      maximiseExtras={maximiseExtras}
      error={error}
      onRetry={refresh}
      span={config.span}
      className={className}
    />
  );
}

/**
 * The composed card: `CardSpecProvider` (when `config` is given) →
 * `CardBoundary` → `CardLayout` → the chart child. The data comes from
 * `data` or an enclosing `CardData`; the menu offers Info, Source (with
 * a table), Configure (when `configurable`), Maximise and, once something
 * failed, Errors; `config.modals` narrows the built-ins and `config.menu`
 * relabels them. The child receives `{ data, hidden, animate, maximised,
 * height }`; maximised, `height` is `'fill'` and the legend and the source
 * table move under the Maximise view's toggles.
 */
export function ChartCard<T>({ config, onConfigChange, ...body }: ChartCardProps<T>): ReactElement {
  const guarded = (
    <CardBoundary fallback={(
      <Card label={config?.title ?? 'Card'} span={config?.span}>
        <CardStatus kind="error" detail={CHROME_FAILURE} />
      </Card>
    )}>
      <ChartCardBody {...body} />
    </CardBoundary>
  );
  if (config === undefined) return guarded;
  return <CardSpecProvider value={config} onChange={onConfigChange}>{guarded}</CardSpecProvider>;
}
