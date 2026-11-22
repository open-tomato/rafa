/**
 * Parity between the Atlas engine and rafa-effort over one fixture store:
 * the p50 and p90 of session minutes and tokens the engine answers from
 * `local.tasks` equal rafa-effort's `quantile` over `sessionSpanMinutes`
 * and `sessionTokenSum` of the store's own rows, and the per-plan sums the
 * engine answers from `local.tasks` at the `plan` grain and from
 * `local.plans` equal the same functions summed by plan stub.
 *
 * rafa-effort's side reads the store's `sessions` rows as core's store
 * reads them, never the replica, so a column the ingest read wrong shows
 * here. Its functions are taken by subpath: the facade's `index.ts`
 * exports only names a non-test file outside the package imports, and
 * `"./*"` is the route for the tests outside it (see
 * `src/tests/facade-subpaths.sweep.test.ts`).
 *
 * The fixture is the ingest's store (`writeFixtureStore` and
 * `writeFactsFixture`) widened through core's writer with sessions of
 * distinct spans and token counts, one of a second plan and one with no
 * span, so p50, p90 and the mean differ and an interpolated p90 differs
 * from the nearest-rank one, so a quantile rule other than nearest rank
 * could not pass. No row is copied
 * from a real store.
 */
import type { AtlasRegistry } from '../registry.js';
import type { DataSource } from '@open-tomato/atlas-data/source';
import type { SessionEffortRow } from '@open-tomato/rafa-core/store/types';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { sessionTokenSum } from '@open-tomato/rafa-effort/effort/epic-cost';
import { sessionSpanMinutes } from '@open-tomato/rafa-effort/effort/report';
import { quantile } from '@open-tomato/rafa-effort/effort/trend-stats';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { TASKS_SOURCE } from '../ingest/effort.js';
import { FIXTURE_PLAN, sessionRow, writeFactsFixture, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { openAtlasRegistry } from '../registry.js';

import { PLANS_SOURCE } from './derive.js';

import { buildAtlas } from './index.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-parity-')));
const root = join(scope, 'project');

/** A second plan, named by one widening session. */
const OTHER_PLAN = 'atlas-parity-other';

let registry: AtlasRegistry | null = null;
let storeRows: readonly SessionEffortRow[] = [];

/** One widening session: its span ends `minutes` after it starts, its tokens raised by `extra`. */
function widening(sessionId: string, start: string, minutes: number, extra: number): SessionEffortRow {
  const first = new Date(start);
  const last = new Date(first.getTime() + minutes * 60_000);
  return sessionRow({
    sessionId,
    kind: 'task',
    first: first.toISOString(),
    last: last.toISOString(),
    tokens: { outputTokens: 20 + extra, cacheReadInputTokens: 4_000 + extra * 7 },
  });
}

/** The fixture store under `root`, widened as the module note says. */
function writeParityFixture(): void {
  writeFixtureStore(root);
  writeFactsFixture(root);
  openSqliteStore(root).append('sessions', [
    widening('session-parity-a', '2026-11-04T08:00:00.000Z', 3, 1_000),
    widening('session-parity-b', '2026-11-04T09:00:00.000Z', 95, 25_000),
    widening('session-parity-c', '2026-11-04T11:00:00.000Z', 61, 300),
    { ...widening('session-parity-d', '2026-11-04T13:00:00.000Z', 17, 9_000), planStub: OTHER_PLAN },
    { ...widening('session-parity-spanless', '2026-11-04T14:00:00.000Z', 0, 2_000), firstTimestamp: null },
  ]);
}

beforeAll(async () => {
  writeParityFixture();
  await buildAtlas({ projectRoot: root, env: {}, now: () => new Date('2026-11-05T12:00:00.000Z'), projectLabel: 'parity' });
  registry = await openAtlasRegistry({ projectRoot: root });
  storeRows = openSqliteStore(root).read('sessions');
});

afterAll(() => {
  registry?.close();
  rmSync(scope, { recursive: true, force: true });
});

function sourceOf(id: string): DataSource {
  const source = registry?.sources.get(id);
  if (source === undefined) throw new Error(`no source ${id}`);
  return source;
}

/** The spans rafa-effort reads off the store's rows, spanless rows left out as the engine leaves NULL out. */
function effortMinutes(rows: readonly SessionEffortRow[]): number[] {
  return rows.map(sessionSpanMinutes).filter((minutes): minutes is number => minutes !== null);
}

/** The engine's p50 and p90 of `field` over every row of `local.tasks`. */
async function engineQuantiles(field: string): Promise<readonly unknown[]> {
  const result = await sourceOf(TASKS_SOURCE).query({
    measures: [{ field, agg: 'p50', as: 'p50' }, { field, agg: 'p90', as: 'p90' }],
  });
  return result.rows[0] ?? [];
}

/** The engine's rows at the `plan` grain of `source`, as plan stub to its sums of `fields`. */
async function enginePlanSums(source: string, fields: readonly string[]): Promise<Record<string, readonly unknown[]>> {
  const result = await sourceOf(source).query({
    grain: 'plan',
    measures: fields.map((field) => ({ field, agg: 'sum' as const, as: field })),
  });
  return Object.fromEntries(result.rows
    .filter((row) => typeof row[0] === 'string')
    .map((row) => [String(row[0]), row.slice(1)]));
}

/** rafa-effort's minutes and tokens summed by plan stub, the rows naming no plan left out. */
function effortPlanSums(): Record<string, readonly number[]> {
  const sums = new Map<string, readonly [number, number]>();
  for (const row of storeRows) {
    if (row.planStub === null) continue;
    const [minutes, tokens] = sums.get(row.planStub) ?? [0, 0];
    sums.set(row.planStub, [minutes + (sessionSpanMinutes(row) ?? 0), tokens + sessionTokenSum(row)]);
  }
  return Object.fromEntries(sums);
}

describe('the engine against rafa-effort, quantiles', () => {
  it('reads the same sessions from the store as the replica holds, the spanless one among them', async () => {
    const count = await sourceOf(TASKS_SOURCE).query({ measures: [{ field: 'session_id', agg: 'count', as: 'n' }] });

    expect(storeRows.length).toBeGreaterThan(5);
    expect(count.rows[0]?.[0]).toBe(storeRows.length);
    expect(effortMinutes(storeRows)).toHaveLength(storeRows.length - 1);
  });

  it('answers the p50 and p90 of session minutes as quantile over sessionSpanMinutes', async () => {
    const minutes = effortMinutes(storeRows);

    expect(await engineQuantiles('minutes')).toEqual([quantile(minutes, 0.5), quantile(minutes, 0.9)]);
  });

  it('answers the p50 and p90 of session tokens as quantile over sessionTokenSum', async () => {
    const tokens = storeRows.map(sessionTokenSum);

    expect(await engineQuantiles('tokens')).toEqual([quantile(tokens, 0.5), quantile(tokens, 0.9)]);
  });

  it('control: the fixture parts p50 from p90 and the mean, and nearest rank from the interpolated p90, so a wrong rule could not pass', () => {
    for (const values of [effortMinutes(storeRows), storeRows.map(sessionTokenSum)]) {
      const sorted = [...values].sort((left, right) => left - right);
      const rank = (sorted.length - 1) * 0.9;
      const below = sorted[Math.floor(rank)] ?? 0;
      const interpolated = below + (rank - Math.floor(rank)) * ((sorted[Math.ceil(rank)] ?? 0) - below);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const p50 = quantile(values, 0.5);

      expect(p50).not.toBe(quantile(values, 0.9));
      expect(p50).not.toBe(mean);
      expect(quantile(values, 0.9)).not.toBe(interpolated);
    }
  });
});

describe('the engine against rafa-effort, per-plan sums', () => {
  it('answers local.tasks by plan with the minutes and tokens rafa-effort sums for each plan', async () => {
    const expected = effortPlanSums();

    expect(Object.keys(expected).sort()).toEqual([FIXTURE_PLAN, OTHER_PLAN].sort());
    expect(await enginePlanSums(TASKS_SOURCE, ['minutes', 'tokens'])).toEqual(expected);
  });

  it('answers local.plans with the same per-plan sums', async () => {
    expect(await enginePlanSums(PLANS_SOURCE, ['minutes', 'tokens'])).toEqual(effortPlanSums());
  });

  it('control: a plan sum taken with the thinking tokens rafa-effort leaves out does not match', async () => {
    const withThinking = Object.fromEntries(Object.entries(effortPlanSums()).map(([plan, [minutes, tokens]]) => {
      const thinking = storeRows
        .filter((row) => row.planStub === plan)
        .reduce((sum, row) => sum + row.usage.thinkingTokens, 0);
      return [plan, [minutes, (tokens ?? 0) + thinking]];
    }));

    expect(await enginePlanSums(TASKS_SOURCE, ['minutes', 'tokens'])).not.toEqual(withThinking);
  });
});
