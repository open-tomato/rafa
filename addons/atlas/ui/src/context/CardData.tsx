import type { TimeRange } from '../contract/schemas.js';

import { createContext, use, useMemo, type ReactElement, type ReactNode } from 'react';

import { useSourced, type DataSource, type Sourced } from './useSourced.js';

/** What `useCardData()` answers: the sourced data and the range it was asked for. */
export interface CardDataHandle<T> extends Sourced<T> {
  readonly range: TimeRange | undefined;
}

const CardDataContext = createContext<CardDataHandle<unknown> | null>(null);

/** The data layer's props: a source and a range, or the data itself, and the card below. */
export interface CardDataProps<T> {
  /** Asked once per range and per `refresh()`; a zero-argument source works too. */
  readonly source?: DataSource<T>;
  /** The data, when there is no source to ask. */
  readonly data?: T;
  readonly range?: TimeRange;
  readonly children?: ReactNode;
}

/**
 * The data concern of the cascade: a source and a range become
 * `{ data, status, error, refresh }` for the card below, through
 * `useCardData()`. While a new range loads, the last answer stays as
 * `data` and the status says `loading`.
 */
export function CardData<T>({ source, data, range, children }: CardDataProps<T>): ReactElement {
  const sourced = useSourced(source, data, range);
  const handle = useMemo<CardDataHandle<unknown>>(
    () => ({ data: sourced.data, status: sourced.status, error: sourced.error, refresh: sourced.refresh, range }),
    [sourced.data, sourced.status, sourced.error, sourced.refresh, range],
  );
  return <CardDataContext value={handle}>{children}</CardDataContext>;
}

/** The enclosing `CardData`'s handle, or `null` when the card has none (a widget gets its data as props). */
export function useOptionalCardData<T>(): CardDataHandle<T> | null {
  return use(CardDataContext) as CardDataHandle<T> | null;
}

/** The enclosing `CardData`'s handle; throws outside one. */
export function useCardData<T>(): CardDataHandle<T> {
  const handle = useOptionalCardData<T>();
  if (handle === null) throw new Error('useCardData() needs a <CardData> above it.');
  return handle;
}
