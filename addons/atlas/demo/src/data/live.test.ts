/**
 * Tests for the live page source over a stub client: the range windows of
 * D6, the requests the source makes, each `QueryResult` mapped into its
 * `LensResult` field, every other field marked not wired, an API that is
 * not there failing with the start line, and `?source=` reading as the
 * mock unless it names `live`. The stub client
 * (`testdata/live-client.fixture.ts`) records every call. The page drawn
 * over each source is `App.test.tsx`'s, since this file imports no TSX.
 */
import type { LensResult } from './source.js';
import type { StubCall } from './testdata/live-client.fixture.js';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';

import { AtlasRequestError, AtlasTransportError } from '@open-tomato/atlas-transport/client';
import { beforeEach, describe, expect, it } from 'bun:test';

import { readPageSource } from '../url.js';

import {
  createLiveLensSource,
  LIVE_UNAVAILABLE,
  liveResultOf,
  NOT_WIRED,
  RANGE_WINDOW,
  WIRED_FIELDS,
} from './live.js';
import { failingClient, resultOf, STUB_WINDOW, stubLiveClient } from './testdata/live-client.fixture.js';

const DAY_MS = 86_400_000;
const SPAN_MS = 28 * DAY_MS;

/** The page's history, read off the DOM global the preload registers. */
const pageHistory = (globalThis as unknown as { readonly history: { replaceState(data: unknown, unused: string, url: string): void } }).history;

async function liveResult(): Promise<{ readonly result: LensResult; readonly calls: readonly StubCall[] }> {
  const { client, calls } = stubLiveClient();
  return { result: await liveResultOf(client, 'past-month'), calls };
}

describe('RANGE_WINDOW', () => {
  it('holds D6: now is today for a KPI and seven days for a series, then 7d, 28d and 52w', () => {
    expect(RANGE_WINDOW).toEqual({
      'now': { series: { last: '7d' }, kpi: { last: '1d' } },
      'last-week': { series: { last: '7d' }, kpi: { last: '7d' } },
      'past-month': { series: { last: '28d' }, kpi: { last: '28d' } },
      'last-year': { series: { last: '52w' }, kpi: { last: '52w' } },
    });
    expect(Object.keys(RANGE_WINDOW)).toEqual(['now', 'last-week', 'past-month', 'last-year']);
  });
});

describe('liveResultOf over a stub client', () => {
  it('GUARD: asks the stub, each metric over the range\'s window, then tokens over the window before it', async () => {
    const { calls } = await liveResult();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual([
      { id: 'pm.tokens-per-day', window: { last: '28d' } },
      { id: 'arch.tokens-by-model', window: { last: '28d' } },
      { id: 'arch.task-minutes-p50-p90', window: { last: '28d' } },
      { id: 'pm.tokens-per-day', window: { from: '2026-09-28T00:00:00.000Z', to: STUB_WINDOW.from } },
    ]);
  });

  it('maps tokens per day to one point a row, and the daily average over the 28 days of the window', async () => {
    const { result } = await liveResult();

    expect(result.source).toBe('live');
    expect(result.mock.tokensPerDay).toEqual([
      { x: new Date('2026-11-20'), y: 1_000 },
      { x: new Date('2026-11-21'), y: 3_000 },
    ]);
    expect(result.mock.tokensDailyAverage).toBe(Math.round(4_000 / 28));
  });

  it('draws the previous window\'s days over the current ones, one window length later', async () => {
    const { result } = await liveResult();

    expect(result.mock.tokensPerDayPrevious).toEqual([{ x: new Date(new Date('2026-10-23').getTime() + SPAN_MS), y: 2_000 }]);
  });

  it('stacks one series per model, the biggest spender first, a point on every day and unknown for no model', async () => {
    const { result } = await liveResult();
    const series = result.mock.tokensByModel;

    expect(series.map((entry) => [entry.id, entry.label, entry.tone])).toEqual([
      ['stub-model-b', 'stub-model-b', 'series-1'],
      ['stub-model-a', 'stub-model-a', 'series-2'],
      ['unknown', 'unknown', 'series-3'],
    ]);
    expect(series[1]?.points).toEqual([
      { x: new Date('2026-11-20'), y: 0 },
      { x: new Date('2026-11-21'), y: 2_000 },
    ]);
  });

  it('maps the weekly quantiles to one decimal, an empty aggregate as 0', async () => {
    const { result } = await liveResult();

    expect(result.mock.taskMinutesQuantiles).toEqual([
      { week: new Date('2026-11-16'), p50: 12.3, p90: 40.1 },
      { week: new Date('2026-11-09'), p50: 0, p90: 8 },
    ]);
  });

  it('marks every other field not wired, the balance and the workspace included, and leaves them empty', async () => {
    const { result } = await liveResult();

    expect(result.notWired).toBe(NOT_WIRED);
    for (const field of WIRED_FIELDS) expect(result.notWired.has(field)).toBe(false);
    for (const field of ['tokensThisWeek', 'plansPerWeek', 'debtRatio', 'flakyChecks', 'balance', 'workspace'] as const) {
      expect(result.notWired.has(field)).toBe(true);
    }
    expect(result.notWired.size + WIRED_FIELDS.length).toBe(Object.keys(result.mock).length + 2);
    expect(result.mock.plansPerWeek).toEqual([]);
    expect(result.mock.tokensThisWeek).toBe(0);
    expect(result.balance).toEqual([]);
    expect(result.workspace.members).toEqual([]);
  });

  it('refuses an answer without the column a field is read from', async () => {
    const client: AtlasClient = { ...stubLiveClient().client, runMetric: () => Promise.resolve(resultOf(['day'], [])) };

    await expect(liveResultOf(client, 'now')).rejects.toThrow('atlas: the answer holds no tokens column');
  });
});

describe('createLiveLensSource', () => {
  it('fails with the start line when the API cannot be reached or has no replica, keeping the cause', async () => {
    const unreachable = new AtlasTransportError('the Atlas server could not be reached');
    const noReplica = new AtlasRequestError('replica_unavailable', 503, 'no replica');

    const first = await createLiveLensSource(failingClient(unreachable))('now').catch((error: unknown) => error);
    const second = await createLiveLensSource(failingClient(noReplica))('now').catch((error: unknown) => error);

    expect(first).toBeInstanceOf(Error);
    expect((first as Error).message).toBe(LIVE_UNAVAILABLE);
    expect((first as Error).cause).toBe(unreachable);
    expect((second as Error).message).toBe(LIVE_UNAVAILABLE);
  });

  it('control: passes any other error as it is', async () => {
    const invalid = new AtlasRequestError('invalid_params', 400, 'bad window');

    await expect(createLiveLensSource(failingClient(invalid))('now')).rejects.toBe(invalid);
  });
});

describe('the page source', () => {
  beforeEach(() => {
    pageHistory.replaceState(null, '', '/?still');
  });

  it('is the mock with no ?source, and with one it does not know', () => {
    expect(readPageSource()).toBe('mock');
    pageHistory.replaceState(null, '', '/?source=sample');
    expect(readPageSource()).toBe('mock');
  });

  it('control: is live when the page opens with ?source=live', () => {
    pageHistory.replaceState(null, '', '/?source=live&still');

    expect(readPageSource()).toBe('live');
  });
});
