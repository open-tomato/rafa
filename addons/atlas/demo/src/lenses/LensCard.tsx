import type { LensField, LensResult } from '../data/source.js';

import { Card, CardHeader, CardStatus, DashboardCard, useDashboard, type CardSpec, type DashboardCardProps } from '@open-tomato/atlas-ui';
import { useMemo, type ReactElement } from 'react';

import { isWired, LIVE_SOURCE, NOT_WIRED_TITLE } from './spec.js';

/** A lens card's props: the dashboard card's, and the result fields it reads. */
export interface LensCardProps<T> extends DashboardCardProps<LensResult, T> {
  /** The fields `select`, `table`, `legend` and the chart read; none means module constants only. */
  readonly reads?: readonly LensField[];
}

const NO_FIELDS: readonly LensField[] = [];

/** The card a live page draws in place of one no live metric feeds: its title, and the empty state. */
function NotWiredCard({ config }: { readonly config: CardSpec }): ReactElement {
  return (
    <Card label={config.title} span={config.span} header={<CardHeader title={config.title} subtitle={config.subtitle} />}>
      <CardStatus kind="empty" title={NOT_WIRED_TITLE} detail="No live metric feeds this card yet; the mock page (no ?source) draws it on sample data." />
    </Card>
  );
}

/**
 * A lens card: a `DashboardCard` that names the result fields it reads.
 * Over the mock it is the dashboard card as given. Over the live source
 * it draws only when `isWired` says so, with the live source line in its
 * spec; otherwise it is a card with the "not wired yet" empty state (Q1),
 * so no sample number shows on the live page.
 */
export function LensCard<T>({ reads = NO_FIELDS, config, ...card }: LensCardProps<T>): ReactElement {
  const { data } = useDashboard<LensResult>();
  const live = data?.source === 'live';
  const shown = useMemo(() => (live
    ? { ...config, source: LIVE_SOURCE }
    : config), [live, config]);
  if (data !== undefined && !isWired(data, reads)) return <NotWiredCard config={config} />;
  return <DashboardCard config={shown} {...card} />;
}
