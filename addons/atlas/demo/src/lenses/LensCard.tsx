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

/** What a card no live metric feeds says under its title, unless a field it reads has a reason of its own. */
const NOT_WIRED_DETAIL = 'No live metric feeds this card yet; the mock page (no ?source) draws it on sample data.';

/** The card a live page draws in place of one no live metric feeds: its title, and the empty state with `detail`. */
function NotWiredCard({ config, detail }: { readonly config: CardSpec; readonly detail: string }): ReactElement {
  return (
    <Card label={config.title} span={config.span} header={<CardHeader title={config.title} subtitle={config.subtitle} />}>
      <CardStatus kind="empty" title={NOT_WIRED_TITLE} detail={detail} />
    </Card>
  );
}

/** The first reason of its own a field of `reads` has for drawing not wired (the `--github` build line), else the general one. */
function notWiredDetailOf(result: LensResult, reads: readonly LensField[]): string {
  return reads.map((field) => result.notWiredDetail.get(field)).find((detail) => detail !== undefined) ?? NOT_WIRED_DETAIL;
}

/**
 * A lens card: a `DashboardCard` that names the result fields it reads.
 * Over the mock it is the dashboard card as given. Over the live source
 * it draws only when `isWired` says so, with the live source line, the
 * live subtitle when given and `liveNoteOf`'s note in place of the mock's
 * in its spec; otherwise it is a card with the "not wired yet" empty state (Q1),
 * so no sample number shows on the live page. The state's line is the
 * result's own for a field it reads, when it has one (`notWiredDetail`).
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
  if (data !== undefined && !isWired(data, reads)) return <NotWiredCard config={config} detail={notWiredDetailOf(data, reads)} />;
  return <DashboardCard config={shown} {...card} />;
}
