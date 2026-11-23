import type { LensField, LensResult } from '../data/source.js';

import { Card, CardHeader, CardStatus, DashboardCard, useDashboard, type CardSpec, type DashboardCardProps } from '@open-tomato/atlas-ui';
import { useMemo, type ReactElement } from 'react';

import { isWired, LIVE_SOURCE, liveNoteOf, NOT_WIRED_TITLE } from './spec.js';

/** A lens card's props: the dashboard card's, and the result fields it reads. */
export interface LensCardProps<T> extends DashboardCardProps<LensResult, T> {
  /** The fields `select`, `table`, `legend` and the chart read; none means module constants only. */
  readonly reads?: readonly LensField[];
  /** The subtitle on the live page, where the mock's (its 12 weeks, its sample) would not hold. */
  readonly liveSubtitle?: string;
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
 * it draws only when `isWired` says so, with the live source line, the
 * live subtitle when given and `liveNoteOf`'s note in place of the mock's
 * in its spec; otherwise it is a card with the "not wired yet" empty state (Q1),
 * so no sample number shows on the live page.
 */
export function LensCard<T>({ reads = NO_FIELDS, liveSubtitle, config, ...card }: LensCardProps<T>): ReactElement {
  const { data } = useDashboard<LensResult>();
  const note = data === undefined
    ? undefined
    : liveNoteOf(data, reads);
  const live = data?.source === 'live';
  const shown = useMemo(() => (live
    ? { ...config, subtitle: liveSubtitle ?? config.subtitle, source: LIVE_SOURCE, note }
    : config), [live, config, liveSubtitle, note]);
  if (data !== undefined && !isWired(data, reads)) return <NotWiredCard config={config} />;
  return <DashboardCard config={shown} {...card} />;
}
