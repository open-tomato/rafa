/**
 * A stub `AtlasClient` for the live source's tests (`../live.test.ts`) and
 * the page's (`../../App.test.tsx`). Its `runMetric` answers the fixed
 * results below and records every call; each other route refuses. The
 * values are ones no real store holds (`stub-model-a`, round thousands),
 * so a stray request elsewhere would show. Named without `.test` so bun
 * never runs it alone.
 */
import type { QueryResult, Scalar, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';

import { LIVE_METRICS } from '../live.js';

/** The window the stub says it ran: 28 days ending 2026-11-23. */
export const STUB_WINDOW: { readonly from: string; readonly to: string } = { from: '2026-10-26T00:00:00.000Z', to: '2026-11-23T00:00:00.000Z' };

/** A result of string columns, `rows` and the window it ran over. */
export function resultOf(
  columns: readonly string[],
  rows: readonly (readonly Scalar[])[],
  window: { readonly from: string | null; readonly to: string | null } = STUB_WINDOW,
): QueryResult {
  return {
    columns: columns.map((key) => ({ key, label: key, type: 'string' })),
    rows,
    meta: { asOf: '2026-11-22T09:00:00.000Z', partial: false, partialReasons: [], rowCount: rows.length, truncated: false, window },
  };
}

export const STUB_TOKENS: QueryResult = resultOf(['day', 'tokens'], [['2026-11-20', 1_000], ['2026-11-21', 3_000]]);

/** Tokens per day over the 28 days before `STUB_WINDOW`. */
export const STUB_PREVIOUS_TOKENS: QueryResult = resultOf(['day', 'tokens'], [['2026-10-23', 2_000]], { from: '2026-09-28T00:00:00.000Z', to: STUB_WINDOW.from });

export const STUB_BY_MODEL: QueryResult = resultOf(['day', 'model', 'tokens'], [
  ['2026-11-20', 'stub-model-b', 1_000],
  ['2026-11-21', 'stub-model-a', 2_000],
  ['2026-11-21', 'stub-model-b', 1_000],
  ['2026-11-21', null, 500],
]);

export const STUB_QUANTILES: QueryResult = resultOf(['week', 'p50', 'p90'], [['2026-11-16', 12.34, 40.06], ['2026-11-09', null, 8]]);

/** One call the stub took. */
export interface StubCall {
  readonly id: string;
  readonly window: Window | undefined;
}

/** The stub client and the calls it has taken so far. */
export interface StubLiveClient {
  readonly client: AtlasClient;
  readonly calls: readonly StubCall[];
}

/** A client whose `runMetric` answers the results above and records each call; every other route refuses. */
export function stubLiveClient(): StubLiveClient {
  const calls: StubCall[] = [];
  const unused = (): never => {
    throw new Error('the live source asked a route it does not use');
  };
  const client: AtlasClient = {
    listSources: unused,
    describeSource: unused,
    query: unused,
    listMetrics: unused,
    describeMetric: unused,
    runMetric: (id, window) => {
      calls.push({ id, window });
      if (id === LIVE_METRICS.tokensPerDay) {
        return Promise.resolve(window?.from === undefined
          ? STUB_TOKENS
          : STUB_PREVIOUS_TOKENS);
      }
      if (id === LIVE_METRICS.tokensByModel) return Promise.resolve(STUB_BY_MODEL);
      if (id === LIVE_METRICS.taskMinutesQuantiles) return Promise.resolve(STUB_QUANTILES);
      return Promise.reject(new Error(`no stub answer for ${id}`));
    },
  };
  return { client, calls };
}

/** A client whose every metric fails with `error`. */
export function failingClient(error: Error): AtlasClient {
  return { ...stubLiveClient().client, runMetric: () => Promise.reject(error) };
}
