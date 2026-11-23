/**
 * Tests for `catalogue.ts`: the PoC cut of spec section G, every
 * definition passing the contract's schema, naming a source the registry
 * defines, and having params the engine plans against that source's
 * descriptor, with and without a window, and a formula that reads the
 * columns those params answer; then every metric over a replica built
 * from the fixture store, with rows behind each and the readings the
 * fixture fixes. Controls show each check can fail: the schema refuses a
 * definition with an extra key, the engine refuses a measure on a field
 * the descriptor lacks, and the formula refuses a column the result lacks.
 */
import type { DataSourceDescriptor, MetricDefinition, QueryParams, QueryResult, Scalar } from '@open-tomato/atlas-data/contract';
import type { TableSourceSpec } from '@open-tomato/atlas-data/source';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyFormula, InvalidParams, MetricDefinitionSchema } from '@open-tomato/atlas-data/contract';
import { runQuery } from '@open-tomato/atlas-data/query';
import { writeBugRoutes } from '@open-tomato/rafa-core/store/bug-routes';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { buildAtlas } from '../build/index.js';
import { FIXTURE_PLAN, FIXTURE_TASK_LINE, TASK_SESSIONS, writeFactsFixture, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { openAtlasRegistry, type AtlasRegistry } from '../registry.js';
import { SOURCE_SPECS } from '../sources.js';

import { METRIC_CATALOGUE } from './catalogue.js';
import { NOT_CLI_GAP } from './qa.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-catalogue-')));
const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');
const WINDOW = { last: '28d' } as const;
let registry: AtlasRegistry | null = null;

/** The ids of section G's table, row by row; the fourth PM row names two. */
const POC_IDS = [
  'pm.budget-burn',
  'pm.tokens-per-day',
  'pm.plan-completion',
  'pm.planned-vs-sessions',
  'pm.active-blockers',
  'arch.debt-ratio',
  'arch.task-minutes-p50-p90',
  'arch.tokens-by-model',
  'arch.preflight-halts',
  'dev.tasks-done-per-week',
  'dev.task-cycle',
  'dev.red-ci-share',
  'dev.plans-completed-per-week',
  'qa.bugs-by-kind',
  'qa.regressions',
  'qa.flaky-checks',
  'qa.filed-share',
];

/** The metrics labelled proxy, each with what it stands in for. */
const PROXY_IDS = [
  'pm.plan-completion',
  'arch.debt-ratio',
  'arch.task-minutes-p50-p90',
  'arch.preflight-halts',
  'dev.tasks-done-per-week',
  'dev.plans-completed-per-week',
];

/** The routed bug the test plants beside the fixture's: the one own-fallout row. */
const FALLOUT_BUG = 'the replica drops a routed bug';

beforeAll(async () => {
  const root = join(scope, 'built');
  writeFixtureStore(root);
  writeFactsFixture(root);
  writeBugRoutes(root, {
    dispatch: { sessionId: TASK_SESSIONS[1], planStub: FIXTURE_PLAN, taskLine: FIXTURE_TASK_LINE },
    routes: [{ what: FALLOUT_BUG, said: 'own-fallout', kind: 'own-fallout', route: 'repair', entryIndex: 2 }],
  }, { now: () => new Date('2026-11-03T11:00:00.000Z') });
  await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });
  registry = await openAtlasRegistry({ projectRoot: root, sourceOptions: { now: () => BUILT_AT } });
});

afterAll(() => {
  registry?.close();
  rmSync(scope, { recursive: true, force: true });
});

function metricOf(id: string): MetricDefinition {
  const metric = METRIC_CATALOGUE.find((candidate) => candidate.id === id);
  if (metric === undefined) throw new Error(`no metric ${id}`);
  return metric;
}

function specOf(metric: MetricDefinition): TableSourceSpec {
  const spec = SOURCE_SPECS.find((candidate) => candidate.descriptor.id === metric.sourceId);
  if (spec === undefined) throw new Error(`no source ${metric.sourceId}`);
  return spec;
}

function descriptorOf(spec: TableSourceSpec): DataSourceDescriptor {
  return { ...spec.descriptor, asOf: null, partial: false, partialReasons: [] };
}

/** Plan and run `params` against the spec's descriptor over a runner that answers no rows. */
function runEmpty(spec: TableSourceSpec, params: QueryParams): QueryResult {
  return runQuery((selects) => selects.map(() => []), { table: spec.table, descriptor: descriptorOf(spec) }, params, { now: BUILT_AT });
}

/** The metric `id` asked of the built replica over the last 28 days, its formula applied. */
async function answerOf(id: string): Promise<QueryResult> {
  if (registry === null) throw new Error('no registry');
  const metric = metricOf(id);
  const source = registry.sources.get(metric.sourceId);
  if (source === undefined) throw new Error(`no source ${metric.sourceId}`);
  return applyFormula(await source.query({ ...metric.params, window: WINDOW }), metric.formula);
}

/** The rows of `result` as records by column key. */
function recordsOf(result: QueryResult): Readonly<Record<string, Scalar>>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.key, row[index] ?? null])));
}

describe('METRIC_CATALOGUE', () => {
  it('holds the PoC cut of section G in its order, each id once', () => {
    const ids = METRIC_CATALOGUE.map((metric) => metric.id);

    expect(ids).toEqual(POC_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives each lens the metrics of its rows: five on the PM rows, four on each other lens', () => {
    const count = (lens: MetricDefinition['lenses'][number]): number => METRIC_CATALOGUE.filter((metric) => metric.lenses.includes(lens)).length;

    expect([count('pm'), count('architect'), count('developer'), count('qa')]).toEqual([5, 4, 4, 4]);
  });

  it.each(POC_IDS)('%s passes the MetricDefinition schema', (id) => {
    expect(MetricDefinitionSchema.safeParse(metricOf(id)).success).toBe(true);
  });

  it('control: the schema refuses a definition with a key the contract lacks', () => {
    const metric = { ...METRIC_CATALOGUE[0], colour: 'red' };

    expect(MetricDefinitionSchema.safeParse(metric).success).toBe(false);
  });

  it('labels each proxy metric with what it stands in for and the note a card shows', () => {
    const proxies = METRIC_CATALOGUE.filter((metric) => metric.feasibility === 'proxy');

    expect(proxies.map((metric) => metric.id)).toEqual(PROXY_IDS);
    expect(proxies.every((metric) => (metric.proxyFor ?? '') !== '' && (metric.proxyNote ?? '') !== '')).toBe(true);
  });

  it('serves only metrics it can measure: none needs the GitHub source or a collector', () => {
    expect(METRIC_CATALOGUE.filter((metric) => metric.feasibility === 'gh' || metric.feasibility === 'collect')).toEqual([]);
  });

  it('keeps cli-gap bugs out of every bug metric', () => {
    const bugMetrics = METRIC_CATALOGUE.filter((metric) => metric.sourceId === 'local.bugs');

    expect(bugMetrics.map((metric) => metric.id)).toEqual(['qa.bugs-by-kind', 'qa.regressions', 'qa.filed-share']);
    expect(bugMetrics.every((metric) => NOT_CLI_GAP.every((filter) => metric.params.filters?.includes(filter) === true))).toBe(true);
  });

  it.each(POC_IDS)('%s names a source the registry defines', (id) => {
    expect(SOURCE_SPECS.map((spec) => spec.descriptor.id)).toContain(metricOf(id).sourceId);
  });
});

describe('the catalogue params against the engine', () => {
  it.each(POC_IDS)('%s plans and runs against its source\'s descriptor, with and without a window, and its formula reads the answer', (id) => {
    const metric = metricOf(id);
    const spec = specOf(metric);

    const bare = runEmpty(spec, metric.params);
    const windowed = runEmpty(spec, { ...metric.params, window: WINDOW });

    expect(bare.rows).toEqual([]);
    expect(bare.columns.map((column) => column.key)).toEqual(windowed.columns.map((column) => column.key));
    expect(windowed.meta.window.from).not.toBeNull();
    expect(() => applyFormula(windowed, metric.formula)).not.toThrow();
  });

  it('control: the engine refuses a catalogue params whose measure names a field the descriptor lacks', () => {
    const metric = metricOf('pm.tokens-per-day');
    const params: QueryParams = { ...metric.params, measures: [{ field: 'tokens_unknown', agg: 'sum' }] };

    expect(() => runEmpty(specOf(metric), params)).toThrow(InvalidParams);
  });

  it('control: a formula naming a column the params do not answer is refused', () => {
    const metric = metricOf('dev.red-ci-share');
    const answer = runEmpty(specOf(metric), metric.params);

    expect(() => applyFormula(answer, { kind: 'share', of: 'tokens', as: 'share' })).toThrow(InvalidParams);
  });
});

describe('the catalogue over a replica built from the fixture store', () => {
  it.each(POC_IDS)('%s answers rows from the replica, with the rows behind them counted', async (id) => {
    const answer = await answerOf(id);

    expect(answer.rows.length).toBeGreaterThan(0);
    expect(answer.meta.rowCount).toBeGreaterThanOrEqual(answer.rows.length);
  });

  it('lists the one blocker of the blocked session as the active blocker', async () => {
    const rows = recordsOf(await answerOf('pm.active-blockers'));

    expect(rows).toEqual([{ day: '2026-11-02', plan_stub: FIXTURE_PLAN, task_line: FIXTURE_TASK_LINE, what: 'the store is locked' }]);
  });

  it('answers the red share over the readings that ran a check: three red of five', async () => {
    const rows = recordsOf(await answerOf('dev.red-ci-share'));

    expect(rows).toEqual([
      { verdict: 'green', readings: 2, share: 0.4 },
      { verdict: 'red', readings: 3, share: 0.6 },
    ]);
  });

  it('lists as flaky only the failing set of the head read red then green', async () => {
    const rows = recordsOf(await answerOf('qa.flaky-checks'));

    expect(rows).toEqual([{ failing_json: '["check-a1a1a1a"]', failures: 1, heads: 1 }]);
  });

  it('counts routed bugs by kind, the planted own-fallout one the only regression', async () => {
    const kinds = recordsOf(await answerOf('qa.bugs-by-kind'));
    const regressions = recordsOf(await answerOf('qa.regressions'));
    const total = (rows: readonly Readonly<Record<string, Scalar>>[]): number => rows.reduce((sum, row) => sum + Number(row.bugs), 0);

    expect(Object.fromEntries(kinds.map((row) => [row.kind, row.bugs]))).toEqual({ 'bug': 2, 'own-fallout': 1, 'own-gap': 1 });
    expect(total(regressions)).toBe(1);
  });

  it('reads module ne cli-gap as true for a bug naming no module, so every routed bug of the fixture stays in', async () => {
    if (registry === null) throw new Error('no registry');
    const bugs = registry.sources.get('local.bugs');
    if (bugs === undefined) throw new Error('no local.bugs');
    const unfiltered = await bugs.query({
      window: WINDOW,
      filters: [{ field: 'source', op: 'eq', value: 'routed' }],
      groupBy: ['module'],
      measures: [{ field: 'id', agg: 'count', as: 'bugs' }],
    });
    const routes = recordsOf(await answerOf('qa.filed-share'));

    expect(recordsOf(unfiltered)).toEqual([{ module: null, bugs: 4 }]);
    expect(routes.reduce((sum, row) => sum + Number(row.bugs), 0)).toBe(4);
  });

  it('splits task minutes by work type into shares summing to one', async () => {
    const rows = recordsOf(await answerOf('arch.debt-ratio'));
    const typed = rows.filter((row) => row.work_type !== null);

    expect(typed.map((row) => row.work_type).sort()).toEqual(['feature', 'fix']);
    expect(rows.reduce((sum, row) => sum + Number(row.share), 0)).toBeCloseTo(1, 9);
  });

  it('answers the plan\'s task sessions against its planned tasks, none planned for a plan with no file', async () => {
    const rows = recordsOf(await answerOf('pm.planned-vs-sessions'));

    expect(rows.find((row) => row.plan_stub === FIXTURE_PLAN)).toMatchObject({ sessions: 2 });
  });
});
