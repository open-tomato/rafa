/**
 * Tests for `catalogue.ts`: the PoC cut of spec section G first in each
 * lens, then the phase 4 metrics, every definition passing the contract's
 * schema, naming a source the registry defines, and having params the
 * engine plans against that source's descriptor, with and without a
 * window (a source with no time axis refusing one), and a formula that
 * reads the columns those params answer; then every PoC metric over a
 * replica built from the fixture store, with rows behind each and the
 * readings the fixture fixes, and the out-of-scope entries per week over
 * the replica with three planted rows: a machine-scoped one and a
 * `cli-gap` one left out, a NULL-scope one counted, the same params
 * without the two filters as the control. Then the task pile over two
 * replicas of the board fixture with three more open issues (a roadmap
 * issue, a `cli-gap` bug and a chore): built with `--github` it answers
 * the open typed issues by type and open time, the epic, the roadmap
 * issue and the `cli-gap` bug left out and the bug with no module in,
 * the same params without the type, epic and cli-gap filters as the
 * control; built without, it answers no row, the params without the
 * GitHub filter as the control. `catalogue-sources.test.ts` runs the
 * phase 4 metrics over a replica of every source. Controls show each check can fail: the
 * schema refuses a definition with an extra key, the engine refuses a
 * measure on a field the descriptor lacks, and the formula refuses a
 * column the result lacks.
 */
import type { DataSourceDescriptor, Filter, MetricDefinition, QueryParams, QueryResult, Scalar } from '@open-tomato/atlas-data/contract';
import type { TableSourceSpec } from '@open-tomato/atlas-data/source';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyFormula, InvalidParams, MetricDefinitionSchema } from '@open-tomato/atlas-data/contract';
import { runQuery } from '@open-tomato/atlas-data/query';
import { writeBugRoutes } from '@open-tomato/rafa-core/store/bug-routes';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { buildAtlas, replicaPathOf } from '../build/index.js';
import { boardCacheText, FIXTURE_ROWS, fixtureRow, writeBoardFixture } from '../ingest/testdata/board-cache.fixture.js';
import { FIXTURE_PLAN, FIXTURE_TASK_LINE, TASK_SESSIONS, writeFactsFixture, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { FIXTURE_ISSUE_DATES, FIXTURE_PRS, fixtureGh } from '../ingest/testdata/github.fixture.js';
import { openAtlasRegistry, type AtlasRegistry } from '../registry.js';
import { SOURCE_SPECS } from '../sources.js';

import { METRIC_CATALOGUE } from './catalogue.js';
import { NOT_MACHINE_OR_CLI_GAP } from './pm.js';
import { BOARD_BUGS, CLI_GAP_OUT, NOT_CLI_GAP, READ_FROM_GITHUB } from './qa.js';

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

/** The metrics past the PoC cut of each lens, phase 4's and later, in the order each lens lists them after its PoC cut. */
const PHASE_FOUR_IDS = {
  pm: ['pm.milestone-completion', 'pm.minutes-per-agent', 'pm.out-of-scope-per-week', 'pm.task-pile'],
  architect: ['arch.loc-per-module', 'arch.coupling', 'arch.violations'],
  developer: ['dev.deploys-per-week', 'dev.wip', 'dev.pr-cycle-time'],
  qa: [
    'qa.defect-density',
    'qa.bug-outcome-by-loop-start',
    'qa.drop-rate',
    'qa.defect-age',
    'qa.resolution-time',
    'qa.open-bugs-per-day',
    'qa.bugs-per-stretch',
  ],
} as const;

/** Every id the catalogue serves, by lens: each lens's PoC rows, then its phase 4 metrics. */
const ALL_IDS = [
  ...POC_IDS.slice(0, 5), ...PHASE_FOUR_IDS.pm,
  ...POC_IDS.slice(5, 9), ...PHASE_FOUR_IDS.architect,
  ...POC_IDS.slice(9, 13), ...PHASE_FOUR_IDS.developer,
  ...POC_IDS.slice(13), ...PHASE_FOUR_IDS.qa,
];

/** The metrics labelled proxy, each with what it stands in for. */
const PROXY_IDS = [
  'pm.plan-completion',
  'pm.minutes-per-agent',
  'arch.debt-ratio',
  'arch.task-minutes-p50-p90',
  'arch.preflight-halts',
  'arch.loc-per-module',
  'arch.coupling',
  'arch.violations',
  'dev.tasks-done-per-week',
  'dev.plans-completed-per-week',
  'qa.defect-density',
];

/** The metrics that answer rows only after a build run with --github. */
const GITHUB_IDS = ['pm.task-pile', 'dev.pr-cycle-time', 'qa.defect-age', 'qa.resolution-time', 'qa.open-bugs-per-day', 'qa.bugs-per-stretch'];

/** The routed bug the test plants beside the fixture's: the one own-fallout row. */
const FALLOUT_BUG = 'the replica drops a routed bug';

/**
 * The out-of-scope rows planted in the built replica: one scoped to this
 * machine and one with module `cli-gap` in ISO week 45, which the
 * fixture's three out-of-scope bugs fill, and one with a NULL scope and
 * module in week 44, alone there. The engine keys a week by its Monday.
 */
const PLANTED_OUT_OF_SCOPE = [
  { id: 'planted-machine', scope: 'machine', module: null, day: '2026-11-04' },
  { id: 'planted-cli-gap', scope: 'bug', module: 'cli-gap', day: '2026-11-04' },
  { id: 'planted-null-scope', scope: null, module: null, day: '2026-10-28' },
] as const;

/** Plant {@link PLANTED_OUT_OF_SCOPE} as out-of-scope rows of `bug_facts` in the replica under `root`. */
function plantOutOfScope(root: string): void {
  const database = new Database(replicaPathOf(root));
  try {
    const insert = database.prepare<unknown, [string, string | null, string | null, string]>(
      'INSERT INTO bug_facts (id, source, scope, module, day) VALUES (?, \'out_of_scope\', ?, ?, ?)',
    );
    for (const row of PLANTED_OUT_OF_SCOPE) insert.run(row.id, row.scope, row.module, row.day);
  } finally {
    database.close();
  }
}

/**
 * The open issues the task pile's builds add to the board fixture's: the
 * roadmap issue, a `cli-gap` bug and a chore. The fixture already holds an
 * open epic (40), an open spec (42), an open bug with module `notes` (50),
 * an open bug with no module (52) and an open issue with no type (53).
 */
const PILE_ROWS = [
  fixtureRow(44, ['type:roadmap'], { title: 'Roadmap' }),
  fixtureRow(57, ['type:bug', 'module:cli-gap']),
  fixtureRow(58, ['type:chore']),
];

/** The open times `gh issue list` answers for {@link PILE_ROWS}. */
const PILE_DATES = [
  { number: 44, createdAt: '2026-09-01T09:00:00Z', closedAt: null },
  { number: 57, createdAt: '2026-10-30T09:00:00Z', closedAt: null },
  { number: 58, createdAt: '2026-11-03T09:00:00Z', closedAt: null },
];

/** The task pile's two replicas, built from the board fixture with {@link PILE_ROWS}, with and without the GitHub read. */
const pileRegistries: { offline: AtlasRegistry | null; github: AtlasRegistry | null } = { offline: null, github: null };

/** A root holding the effort fixture store and the board cache with {@link PILE_ROWS}. */
function writePileRoot(name: string): string {
  const root = join(scope, name);
  writeFixtureStore(root);
  writeBoardFixture(root, boardCacheText([...FIXTURE_ROWS, ...PILE_ROWS]));
  return root;
}

beforeAll(async () => {
  const root = join(scope, 'built');
  writeFixtureStore(root);
  writeFactsFixture(root);
  writeBugRoutes(root, {
    dispatch: { sessionId: TASK_SESSIONS[1], planStub: FIXTURE_PLAN, taskLine: FIXTURE_TASK_LINE },
    routes: [{ what: FALLOUT_BUG, said: 'own-fallout', kind: 'own-fallout', route: 'repair', entryIndex: 2 }],
  }, { now: () => new Date('2026-11-03T11:00:00.000Z') });
  await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });
  plantOutOfScope(root);
  registry = await openAtlasRegistry({ projectRoot: root, sourceOptions: { now: () => BUILT_AT } });
  const offline = writePileRoot('pile-offline');
  const github = writePileRoot('pile-github');
  await buildAtlas({ projectRoot: offline, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });
  await buildAtlas({
    projectRoot: github,
    env: {},
    now: () => BUILT_AT,
    projectLabel: 'fixture',
    github: true,
    gh: fixtureGh(FIXTURE_PRS, [...FIXTURE_ISSUE_DATES, ...PILE_DATES]).runner,
  });
  pileRegistries.offline = await openAtlasRegistry({ projectRoot: offline, sourceOptions: { now: () => BUILT_AT } });
  pileRegistries.github = await openAtlasRegistry({ projectRoot: github, sourceOptions: { now: () => BUILT_AT } });
});

afterAll(() => {
  registry?.close();
  pileRegistries.offline?.close();
  pileRegistries.github?.close();
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

/** True for params that measure with no group key: the engine answers one total row, 0 over no rows. */
function isOneTotal(params: QueryParams): boolean {
  return (params.measures ?? []).length > 0 && (params.grain ?? 'all') === 'all' && (params.groupBy ?? []).length === 0;
}

/** The rows of `result` as records by column key. */
function recordsOf(result: QueryResult): Readonly<Record<string, Scalar>>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.key, row[index] ?? null])));
}

describe('METRIC_CATALOGUE', () => {
  it('holds the PoC cut of section G in its order, each lens\'s phase 4 metrics after its own rows, each id once', () => {
    const ids = METRIC_CATALOGUE.map((metric) => metric.id);

    expect(ids).toEqual(ALL_IDS);
    expect(ids.filter((id) => POC_IDS.includes(id))).toEqual(POC_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives each lens the metrics of its rows: five then four on PM, four then three, four then three, four then seven', () => {
    const count = (lens: MetricDefinition['lenses'][number]): number => METRIC_CATALOGUE.filter((metric) => metric.lenses.includes(lens)).length;

    expect([count('pm'), count('architect'), count('developer'), count('qa')]).toEqual([9, 7, 7, 11]);
  });

  it.each(ALL_IDS)('%s passes the MetricDefinition schema', (id) => {
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

  it('serves no metric that needs a collector, and labels gh the six that need the GitHub times', () => {
    expect(METRIC_CATALOGUE.filter((metric) => metric.feasibility === 'collect')).toEqual([]);
    expect(METRIC_CATALOGUE.filter((metric) => metric.feasibility === 'gh').map((metric) => metric.id)).toEqual(GITHUB_IDS);
  });

  it('keeps cli-gap bugs out of every bug metric over local.bugs and over the board\'s bug issues', () => {
    const bugMetrics = METRIC_CATALOGUE.filter((metric) => metric.sourceId === 'local.bugs');
    const boardBugMetrics = METRIC_CATALOGUE.filter((metric) => metric.params.filters?.some((filter) => filter.field === 'is_bug') === true);

    const routedMetrics = bugMetrics.filter((metric) => metric.params.filters?.some((filter) => filter.field === 'source' && filter.value === 'routed') === true);
    const outOfScopeMetrics = bugMetrics.filter((metric) => !routedMetrics.includes(metric));

    expect(bugMetrics.map((metric) => metric.id)).toEqual(['pm.out-of-scope-per-week', 'qa.bugs-by-kind', 'qa.regressions', 'qa.filed-share']);
    expect(routedMetrics.every((metric) => NOT_CLI_GAP.every((filter) => metric.params.filters?.includes(filter) === true))).toBe(true);
    expect(outOfScopeMetrics.map((metric) => metric.id)).toEqual(['pm.out-of-scope-per-week']);
    expect(outOfScopeMetrics.every((metric) => NOT_MACHINE_OR_CLI_GAP.every((filter) => metric.params.filters?.includes(filter) === true))).toBe(true);
    expect(boardBugMetrics.map((metric) => metric.id)).toEqual(PHASE_FOUR_IDS.qa.slice(1));
    expect(boardBugMetrics.every((metric) => BOARD_BUGS.every((filter) => metric.params.filters?.includes(filter) === true))).toBe(true);
  });

  it.each(ALL_IDS)('%s names a source the registry defines', (id) => {
    expect(SOURCE_SPECS.map((spec) => spec.descriptor.id)).toContain(metricOf(id).sourceId);
  });
});

describe('the catalogue params against the engine', () => {
  it.each(ALL_IDS.filter((id) => specOf(metricOf(id)).descriptor.timeField !== null))(
    '%s plans and runs against its source\'s descriptor, with and without a window, and its formula reads the answer',
    (id) => {
      const metric = metricOf(id);
      const spec = specOf(metric);

      const bare = runEmpty(spec, metric.params);
      const windowed = runEmpty(spec, { ...metric.params, window: WINDOW });

      expect(bare.rows).toEqual(isOneTotal(metric.params)
        ? [(metric.params.measures ?? []).map(() => 0)]
        : []);
      expect(bare.columns.map((column) => column.key)).toEqual(windowed.columns.map((column) => column.key));
      expect(windowed.meta.window.from).not.toBeNull();
      expect(() => applyFormula(windowed, metric.formula)).not.toThrow();
    },
  );

  it.each(ALL_IDS.filter((id) => specOf(metricOf(id)).descriptor.timeField === null))(
    '%s, over a source with no time axis, plans and runs with no window, its formula reads the answer, and a window is refused',
    (id) => {
      const metric = metricOf(id);
      const spec = specOf(metric);

      expect(() => applyFormula(runEmpty(spec, metric.params), metric.formula)).not.toThrow();
      expect(() => runEmpty(spec, { ...metric.params, window: WINDOW })).toThrow(InvalidParams);
    },
  );

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

describe('the minutes per agent over the fixture replica', () => {
  it('sums both task sessions under their one agent, the minutes the cycle scatter lists for them', async () => {
    const rows = recordsOf(await answerOf('pm.minutes-per-agent'));
    const cycle = recordsOf(await answerOf('dev.task-cycle'));

    expect(rows).toEqual([{ agent: 'implementer', minutes: 75, sessions: 2 }]);
    expect(cycle.reduce((sum, row) => sum + Number(row.minutes), 0)).toBe(75);
  });
});

describe('the out-of-scope entries per week over the fixture replica', () => {
  it('counts every out-of-scope row per ISO week, the machine and cli-gap rows left out and the NULL-scope row in', async () => {
    const rows = recordsOf(await answerOf('pm.out-of-scope-per-week'));

    expect(rows).toEqual([{ week: '2026-10-26', entries: 1 }, { week: '2026-11-02', entries: 3 }]);
  });

  it('control: the same params without the machine and cli-gap filters count both planted rows in week 45', async () => {
    if (registry === null) throw new Error('no registry');
    const bugs = registry.sources.get('local.bugs');
    if (bugs === undefined) throw new Error('no local.bugs');
    const metric = metricOf('pm.out-of-scope-per-week');
    const filters = (metric.params.filters ?? []).filter((filter) => !NOT_MACHINE_OR_CLI_GAP.includes(filter));
    const rows = recordsOf(await bugs.query({ ...metric.params, filters, window: WINDOW }));

    expect(filters).toEqual([{ field: 'source', op: 'eq', value: 'out_of_scope' }]);
    expect(rows).toEqual([{ week: '2026-10-26', entries: 1 }, { week: '2026-11-02', entries: 5 }]);
  });
});

/** `params` asked with no window of `local.issues` in the task pile replica `which` names. */
async function pileQuery(which: keyof typeof pileRegistries, params: QueryParams): Promise<QueryResult> {
  const issues = pileRegistries[which]?.sources.get('local.issues');
  if (issues === undefined) throw new Error(`no local.issues in the ${which} replica`);
  return issues.query(params);
}

describe('the task pile over the board fixture', () => {
  it('answers the open typed issues by type and open time, the epic, the roadmap issue and the cli-gap bug left out, the bug with no module in', async () => {
    const metric = metricOf('pm.task-pile');
    const rows = recordsOf(applyFormula(await pileQuery('github', metric.params), metric.formula));

    expect(rows).toEqual([
      { issue_type: 'bug', created_at: '2026-10-21T09:00:00.000Z', issues: 1 },
      { issue_type: 'bug', created_at: '2026-10-24T09:00:00.000Z', issues: 1 },
      { issue_type: 'chore', created_at: '2026-11-03T09:00:00.000Z', issues: 1 },
      { issue_type: 'spec', created_at: '2026-10-02T09:00:00.000Z', issues: 1 },
    ]);
  });

  it('control: without the type, epic and cli-gap filters the epic, the roadmap issue, the cli-gap bug and the untyped issue answer too', async () => {
    const metric = metricOf('pm.task-pile');
    const kept = (filter: Filter): boolean => filter.field !== 'issue_type' && filter.field !== 'is_epic' && filter !== CLI_GAP_OUT;
    const filters = (metric.params.filters ?? []).filter(kept);
    const rows = recordsOf(await pileQuery('github', { ...metric.params, filters, groupBy: ['issue_type'], orderBy: [{ key: 'issue_type', dir: 'asc' }] }));

    expect(filters).toEqual([{ field: 'state', op: 'eq', value: 'OPEN' }, READ_FROM_GITHUB]);
    expect(rows).toEqual([
      { issue_type: 'bug', issues: 3 },
      { issue_type: 'chore', issues: 1 },
      { issue_type: 'epic', issues: 1 },
      { issue_type: 'roadmap', issues: 1 },
      { issue_type: 'spec', issues: 1 },
      { issue_type: null, issues: 1 },
    ]);
  });

  it('answers no row from a replica built without --github, where no issue has an open time', async () => {
    const metric = metricOf('pm.task-pile');

    expect((await pileQuery('offline', metric.params)).rows).toEqual([]);
  });

  it('control: the offline replica holds the open typed issues, which the params without the GitHub filter answer', async () => {
    const metric = metricOf('pm.task-pile');
    const filters = (metric.params.filters ?? []).filter((filter) => filter !== READ_FROM_GITHUB);
    const rows = recordsOf(await pileQuery('offline', { ...metric.params, filters }));

    expect(rows.map((row) => [row.issue_type, row.created_at])).toEqual([['bug', null], ['chore', null], ['spec', null]]);
    expect(rows.map((row) => row.issues)).toEqual([2, 1, 1]);
  });
});
