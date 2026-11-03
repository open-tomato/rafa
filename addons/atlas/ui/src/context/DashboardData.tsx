import type { TimeRange } from '../contract/schemas.js';

import { createContext, use, useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useSourced, type DataSource, type DataStatus, type Sourced } from './useSourced.js';

/** The range a dashboard opens on unless told otherwise. */
export const DEFAULT_DASHBOARD_RANGE: TimeRange = 'past-month';

/** What `useDashboard()` answers: the page's result set, its range, and the refreshes. */
export interface DashboardHandle<R> extends Sourced<R> {
  readonly range: TimeRange;
  readonly setRange: (range: TimeRange) => void;
  /** How many times the card `id` was told to refresh alone. */
  readonly revisionOf: (id: string) => number;
  /** Re-renders one card from scratch without asking the source again. */
  readonly refreshCard: (id: string) => void;
}

const DashboardContext = createContext<DashboardHandle<unknown> | null>(null);

/** The page data layer's props: a source over the range, or the result set itself, and the page below. */
export interface DashboardDataProps<R> {
  readonly source?: DataSource<R, TimeRange>;
  readonly data?: R;
  readonly defaultRange?: TimeRange;
  /** Told when the reader picks a range, after the page has switched to it. */
  readonly onRangeChange?: (range: TimeRange) => void;
  readonly children?: ReactNode;
}

/**
 * The page-level data of a dashboard: one result set for every card,
 * asked for one range (`now`, `last-week`, `past-month`, `last-year`).
 * Picking a range or `refresh()` asks the source again and every card
 * re-renders from the new set; `refreshCard(id)` re-renders one card.
 */
export function DashboardData<R>({ source, data, defaultRange = DEFAULT_DASHBOARD_RANGE, onRangeChange, children }: DashboardDataProps<R>): ReactElement {
  const [range, setOwnRange] = useState<TimeRange>(defaultRange);
  const [revisions, setRevisions] = useState<Readonly<Record<string, number>>>({});
  const sourced = useSourced(source, data, range);

  const setRange = useCallback((next: TimeRange) => {
    setOwnRange(next);
    onRangeChange?.(next);
  }, [onRangeChange]);
  const refreshCard = useCallback((id: string) => {
    setRevisions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }, []);
  const revisionOf = useCallback((id: string) => revisions[id] ?? 0, [revisions]);

  const handle = useMemo<DashboardHandle<unknown>>(() => ({
    data: sourced.data,
    status: sourced.status,
    error: sourced.error,
    refresh: sourced.refresh,
    range,
    setRange,
    revisionOf,
    refreshCard,
  }), [sourced.data, sourced.status, sourced.error, sourced.refresh, range, setRange, revisionOf, refreshCard]);

  return <DashboardContext value={handle}>{children}</DashboardContext>;
}

/** The enclosing dashboard's handle, for page controls (the range, a refresh); throws outside one. */
export function useDashboard<R>(): DashboardHandle<R> {
  const handle = use(DashboardContext);
  if (handle === null) throw new Error('useDashboard() needs a <DashboardData> above it.');
  return handle as DashboardHandle<R>;
}

/** One card's slice of the page's result set. */
export interface DashboardSlice<S> {
  readonly data: S | undefined;
  readonly status: DataStatus;
  readonly error: Error | null;
  readonly range: TimeRange;
  /** Asks the page's source again; every card re-renders. */
  readonly refreshPage: () => void;
  /** Re-renders this card alone; a no-op without a card id. */
  readonly refresh: () => void;
  /** Bumped by each refresh of this card alone; a card keys on it. */
  readonly revision: number;
}

/**
 * A card's slice of the page's result set: `selector` runs during render
 * over the current set, so a page refresh re-renders the slice with no
 * effect in between. `cardId` lets the card be refreshed alone.
 */
export function useDashboardSlice<R, S>(selector: (result: R) => S, cardId?: string): DashboardSlice<S> {
  const dashboard = useDashboard<R>();
  const { refreshCard } = dashboard;
  const refresh = useCallback(() => {
    if (cardId !== undefined) refreshCard(cardId);
  }, [refreshCard, cardId]);
  return {
    data: dashboard.data === undefined
      ? undefined
      : selector(dashboard.data),
    status: dashboard.status,
    error: dashboard.error,
    range: dashboard.range,
    refreshPage: dashboard.refresh,
    refresh,
    revision: cardId === undefined
      ? 0
      : dashboard.revisionOf(cardId),
  };
}
