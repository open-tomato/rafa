import type { TimeRange } from '../contract/schemas.js';

import { useCallback, useEffect, useRef, useState } from 'react';

import { toError } from './errors.js';

/** Where a card's data stands: waiting for its first answer (or a new one), answered, or failed. */
export type DataStatus = 'loading' | 'ready' | 'error';

/** A data source: the range in, the data out, asynchronously. */
export type DataSource<T, Range = TimeRange | undefined> = (range: Range) => Promise<T>;

/** What a data layer exposes: the data (the last answer while a new one loads), its status, its error and a refresh. */
export interface Sourced<T> {
  readonly data: T | undefined;
  readonly status: DataStatus;
  readonly error: Error | null;
  /** Asks the source again for the same range. */
  readonly refresh: () => void;
}

/** The last answer, tagged with the request it answered. */
interface Settled<T> {
  readonly request: string;
  readonly data: T | undefined;
  readonly error: Error | null;
}

/**
 * The fetch shared by `CardData` and `DashboardData`. A request is the
 * range plus a refresh count; its answer is stored with the request it
 * answered, so the status is derived during render (a stored answer for
 * another request means loading) and the effect only ever sets state from
 * the source's callbacks. The source is read through a ref, so an inline
 * source does not refetch on every render; a new range or `refresh()` does.
 * With no source, `given` is the data and the status is ready once it is set.
 */
export function useSourced<T, Range>(source: DataSource<T, Range> | undefined, given: T | undefined, range: Range): Sourced<T> {
  const [count, setCount] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const sourceRef = useRef(source);
  const hasSource = source !== undefined;
  const request = `${String(range)}#${count}`;

  useEffect(() => {
    sourceRef.current = source;
  });

  useEffect(() => {
    const load = sourceRef.current;
    if (load === undefined) return undefined;
    let live = true;
    const asked = `${String(range)}#${count}`;
    Promise.resolve()
      .then(() => load(range))
      .then(
        (data) => {
          if (live) setSettled({ request: asked, data, error: null });
        },
        (thrown: unknown) => {
          if (live) setSettled((previous) => ({ request: asked, data: previous?.data, error: toError(thrown) }));
        },
      );
    return () => {
      live = false;
    };
  }, [range, count, hasSource]);

  const refresh = useCallback(() => setCount((current) => current + 1), []);

  if (!hasSource) {
    return { data: given, status: given === undefined
      ? 'loading'
      : 'ready', error: null, refresh };
  }
  const answered = settled?.request === request;
  const error = answered
    ? settled.error
    : null;
  return {
    data: settled?.data,
    status: answered
      ? (error === null
        ? 'ready'
        : 'error')
      : 'loading',
    error,
    refresh,
  };
}
