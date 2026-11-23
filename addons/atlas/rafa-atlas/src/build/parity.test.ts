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
 * The per-plan bug counts are the same check over `bug_routes`: the
 * engine's counts of the routed rows of `bug_facts`, by plan, by plan and
 * routed kind, and of the rows routed `filed`, equal rafa-effort's
 * `countBugKinds` over the store's rows. No registry source serves
 * `bug_facts` yet, so the engine reads it here through a source this file
 * defines over the replica, stamped by the build's `local.bugs` row.
 *
 * The fixture is the ingest's store (`writeFixtureStore` and
 * `writeFactsFixture`) widened through core's writer with sessions of
 * distinct spans and token counts, one of a second plan and one with no
 * span, so p50, p90 and the mean differ and an interpolated p90 differs
 * from the nearest-rank one, so a quantile rule other than nearest rank
 * could not pass. The second plan's session also routes three entries,
 * one under a kind other than the one its session said, so a count taken
 * on the `said` kind could not pass. No row is copied from a real store.
 */
import type { AtlasRegistry } from '../registry.js';
import type { FieldDescriptor } from '@open-tomato/atlas-data/contract';
import type { ReplicaReader } from '@open-tomato/atlas-data/replica';
import type { DataSource } from '@open-tomato/atlas-data/source';
import type { BugRouteRow } from '@open-tomato/rafa-core/store/bug-routes';
import type { SessionEffortRow } from '@open-tomato/rafa-core/store/types';
import type { PlanBugKinds } from '@open-tomato/rafa-effort/effort/report-kinds';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica } from '@open-tomato/atlas-data/replica';
import { defineTableSource } from '@open-tomato/atlas-data/source';
import { readBugRoutesForPlan, writeBugRoutes } from '@open-tomato/rafa-core/store/bug-routes';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { sessionTokenSum } from '@open-tomato/rafa-effort/effort/epic-cost';
import { sessionSpanMinutes } from '@open-tomato/rafa-effort/effort/report';
import { countBugKinds } from '@open-tomato/rafa-effort/effort/report-kinds';
import { quantile } from '@open-tomato/rafa-effort/effort/trend-stats';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { TASKS_SOURCE } from '../ingest/effort.js';
import { BUGS_SOURCE } from '../ingest/facts.js';
import { FIXTURE_PLAN, sessionRow, writeFactsFixture, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { openAtlasRegistry } from '../registry.js';

import { PLANS_SOURCE } from './derive.js';

import { buildAtlas, replicaPathOf } from './index.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-parity-')));
const root = join(scope, 'project');

/** A second plan, named by one widening session. */
const OTHER_PLAN = 'atlas-parity-other';

let registry: AtlasRegistry | null = null;
let storeRows: readonly SessionEffortRow[] = [];
let replica: ReplicaReader | null = null;
let storeRoutes: readonly BugRouteRow[] = [];

/** The second plan's session that routes entries. */
const OTHER_ROUTING_SESSION = 'session-parity-d';

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
    { ...widening(OTHER_ROUTING_SESSION, '2026-11-04T13:00:00.000Z', 17, 9_000), planStub: OTHER_PLAN },
    { ...widening('session-parity-spanless', '2026-11-04T14:00:00.000Z', 0, 2_000), firstTimestamp: null },
  ]);
  writeBugRoutes(root, {
    dispatch: { sessionId: OTHER_ROUTING_SESSION, planStub: OTHER_PLAN, taskLine: 'Widen the parity fixture' },
    routes: [
      { entryIndex: 0, what: 'a parity bug filed', said: 'bug', kind: 'bug', route: 'filed' },
      { entryIndex: 1, what: 'a parity bug of this plan', said: 'bug', kind: 'own-fallout', route: 'repair' },
      { entryIndex: 2, what: 'a parity file too long', said: 'convention', kind: 'convention', route: 'follow-up' },
    ],
  }, { now: () => new Date('2026-11-04T13:20:00.000Z') });
}

/** A text field of the bugs source, to group and filter by. */
function bugDimension(key: string): FieldDescriptor {
  return { key, label: key, type: 'string', role: 'dimension', aggregates: ['count', 'count_distinct'], filterable: true, groupable: true };
}

/** A source over `bug_facts`, stamped by the build's `local.bugs` row; see the module note. */
function bugsSource(reader: ReplicaReader): DataSource {
  return defineTableSource(reader, {
    descriptor: {
      id: BUGS_SOURCE,
      source: 'local',
      channel: 'bugs',
      title: 'Bugs',
      description: 'The parity test\'s source over bug_facts.',
      timeField: 'day',
      grains: ['plan', 'all'],
      fields: [
        { key: 'id', label: 'Bug', type: 'string', role: 'id', aggregates: ['count', 'count_distinct'], filterable: true, groupable: false },
        bugDimension('plan_stub'),
        bugDimension('source'),
        bugDimension('kind'),
        bugDimension('route'),
        { key: 'day', label: 'Day', type: 'date', role: 'time', aggregates: ['count', 'min', 'max'], filterable: true, groupable: true },
      ],
    },
    table: 'bug_facts',
  });
}

beforeAll(async () => {
  writeParityFixture();
  await buildAtlas({ projectRoot: root, env: {}, now: () => new Date('2026-11-05T12:00:00.000Z'), projectLabel: 'parity' });
  registry = await openAtlasRegistry({ projectRoot: root });
  storeRows = openSqliteStore(root).read('sessions');
  storeRoutes = [FIXTURE_PLAN, OTHER_PLAN, null].flatMap((plan) => readBugRoutesForPlan(root, plan));
  replica = openReplica(replicaPathOf(root));
});

afterAll(() => {
  registry?.close();
  replica?.close();
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

/** The engine's count of the routed rows of `bug_facts` grouped by `groupBy`, filtered by `route` when given. */
async function engineRoutedCounts(groupBy: readonly string[], route?: string): Promise<readonly (readonly unknown[])[]> {
  if (replica === null) throw new Error('no replica');
  const result = await bugsSource(replica).query({
    groupBy,
    measures: [{ field: 'id', agg: 'count', as: 'n' }],
    filters: [
      { field: 'source', op: 'eq', value: 'routed' },
      ...(route === undefined
        ? []
        : [{ field: 'route', op: 'eq' as const, value: route }]),
    ],
  });
  return result.rows;
}

/** rafa-effort's counts over the store's routes, as plan stub to its figures. */
function effortBugKinds(): Record<string, PlanBugKinds> {
  const counted = countBugKinds(storeRoutes.map(({ planStub, kind, route }) => ({ planStub, kind, route })));
  return Object.fromEntries(counted
    .filter((plan): plan is PlanBugKinds & { readonly planStub: string } => plan.planStub !== null)
    .map((plan) => [plan.planStub, plan]));
}

/** `rows` of plan stub, then key, then count, as plan stub to key to count. */
function byPlanAndKey(rows: readonly (readonly unknown[])[]): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const [plan, key, count] of rows) {
    const planCounts = counts[String(plan)] ?? {};
    counts[String(plan)] = { ...planCounts, [String(key)]: Number(count) };
  }
  return counts;
}

/** rafa-effort's kind counts with the zero kinds left out, as the engine answers no group for them. */
function effortKindCounts(plans: Record<string, PlanBugKinds>): Record<string, Record<string, number>> {
  return Object.fromEntries(Object.entries(plans).map(([plan, figures]) => [
    plan,
    Object.fromEntries(Object.entries(figures.kinds).filter(([, count]) => count > 0)),
  ]));
}

describe('the engine against rafa-effort, per-plan bug counts', () => {
  it('reads the routes of both plans from the store, under more than one kind each', () => {
    const plans = effortBugKinds();

    expect(Object.keys(plans).sort()).toEqual([FIXTURE_PLAN, OTHER_PLAN].sort());
    expect(storeRoutes.some((route) => route.planStub === null)).toBe(false);
    for (const figures of Object.values(plans)) {
      expect(Object.values(figures.kinds).filter((count) => count > 0).length).toBeGreaterThan(1);
    }
  });

  it('answers the routed entries of each plan as countBugKinds counts them', async () => {
    const expected = Object.fromEntries(Object.entries(effortBugKinds()).map(([plan, figures]) => [plan, figures.entries]));
    const rows = await engineRoutedCounts(['plan_stub']);

    expect(Object.fromEntries(rows.map(([plan, count]) => [String(plan), Number(count)]))).toEqual(expected);
  });

  it('answers each plan\'s count by routed kind as countBugKinds counts them', async () => {
    expect(byPlanAndKey(await engineRoutedCounts(['plan_stub', 'kind']))).toEqual(effortKindCounts(effortBugKinds()));
  });

  it('answers each plan\'s entries routed filed as countBugKinds counts them', async () => {
    const expected = Object.fromEntries(Object.entries(effortBugKinds()).map(([plan, figures]) => [plan, figures.filed]));
    const rows = await engineRoutedCounts(['plan_stub'], 'filed');

    expect(Object.fromEntries(rows.map(([plan, count]) => [String(plan), Number(count)]))).toEqual(expected);
  });

  it('control: countBugKinds over the kind each session said does not match the engine', async () => {
    const onSaid = countBugKinds(storeRoutes.map(({ planStub, said, kind, route }) => ({ planStub, kind: said ?? kind, route })));
    const plans = Object.fromEntries(onSaid
      .filter((plan): plan is PlanBugKinds & { readonly planStub: string } => plan.planStub !== null)
      .map((plan) => [plan.planStub, plan]));

    expect(byPlanAndKey(await engineRoutedCounts(['plan_stub', 'kind']))).not.toEqual(effortKindCounts(plans));
  });
});
