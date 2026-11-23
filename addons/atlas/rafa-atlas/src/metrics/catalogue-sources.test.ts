/**
 * Tests for the phase 4 metrics of the catalogue over replicas of every
 * source, each built in a tmpdir root from the effort fixture store, the
 * git fixture repository (`git init`), a board cache of invented issues,
 * a module tree with a cut table, and, for the second root, a stub `gh`
 * answering fixture JSON under `--github`. No test runs `gh`.
 *
 * Each metric passes the schema and answers through the engine, its
 * formula applied, with no window (the card asks the board and module
 * metrics with none). Then the readings the fixtures fix: a bug with no
 * module counts and a `cli-gap` bug does not, the same params without
 * the filter as the control; a closed issue still labelled
 * `rafa:in-development` is not WIP, the label count as the control; and
 * the GitHub-only metrics answer no rows offline (trap 3), and rows once
 * the build read GitHub.
 *
 * The board rows past `FIXTURE_ROWS`:
 *
 * | # | State | Labels | Body |
 * |---|---|---|---|
 * | 41 | closed, completed | `type:epic`, `epic:done-notes` | none |
 * | 43 | open | `type:epic`, `epic:next-notes`, `horizon:next` | none |
 * | 54 | closed, completed | `type:bug`, `priority:medium` (no module) | a `## Plan` block |
 * | 55 | closed, completed | `type:bug`, `module:cli-gap`, `priority:medium` | a `## Plan` block |
 * | 56 | closed, not planned | `bug`, `module:notes` | a `## Plan` block |
 */
import type { AtlasRegistry } from '../registry.js';
import type { Filter, MetricDefinition, QueryParams, QueryResult, Scalar } from '@open-tomato/atlas-data/contract';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { applyFormula, MetricDefinitionSchema } from '@open-tomato/atlas-data/contract';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { buildAtlas } from '../build/index.js';
import { CUT_TABLE_FILE } from '../ingest/modules.js';
import { boardCacheText, FIXTURE_ROWS, FOLLOW_UPS_PLAN, fixtureRow, planBlockBody, writeBoardFixture } from '../ingest/testdata/board-cache.fixture.js';
import { FIXTURE_PLAN, writeFactsFixture, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { writeGitFixture } from '../ingest/testdata/git-repo.fixture.js';
import { FIXTURE_ISSUE_DATES, FIXTURE_PRS, fixtureGh } from '../ingest/testdata/github.fixture.js';
import { openAtlasRegistry } from '../registry.js';

import { METRIC_CATALOGUE } from './catalogue.js';
import { CLI_GAP_OUT } from './qa.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-catalogue-sources-')));
const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');
const registries: { offline: AtlasRegistry | null; github: AtlasRegistry | null } = { offline: null, github: null };

/** The phase 4 metrics, in catalogue order. */
const PHASE_FOUR_IDS = [
  'pm.milestone-completion',
  'arch.loc-per-module',
  'arch.coupling',
  'arch.violations',
  'dev.deploys-per-week',
  'dev.wip',
  'dev.pr-cycle-time',
  'qa.defect-density',
  'qa.bug-outcome-by-loop-start',
  'qa.drop-rate',
  'qa.defect-age',
  'qa.resolution-time',
  'qa.open-bugs-per-day',
  'qa.bugs-per-stretch',
];

/** The metrics that read the GitHub times, empty offline. */
const GITHUB_IDS = ['dev.pr-cycle-time', 'qa.defect-age', 'qa.resolution-time', 'qa.open-bugs-per-day', 'qa.bugs-per-stretch'];

/** The board rows the module note lists past the fixture's own. */
const EXTRA_ROWS = [
  fixtureRow(41, ['type:epic', 'epic:done-notes'], { state: 'CLOSED', stateReason: 'COMPLETED', title: 'Epic: the finished notes' }),
  fixtureRow(43, ['type:epic', 'epic:next-notes', 'horizon:next'], { title: 'Epic: the next notes' }),
  fixtureRow(54, ['type:bug', 'priority:medium'], { state: 'CLOSED', stateReason: 'COMPLETED', body: planBlockBody(FIXTURE_PLAN) }),
  fixtureRow(55, ['type:bug', 'module:cli-gap', 'priority:medium'], { state: 'CLOSED', stateReason: 'COMPLETED', body: planBlockBody(FIXTURE_PLAN) }),
  fixtureRow(56, ['bug', 'module:notes'], { state: 'CLOSED', stateReason: 'NOT_PLANNED', body: planBlockBody(FIXTURE_PLAN) }),
];

/** The invented open and close times of {@link EXTRA_ROWS}. */
const EXTRA_DATES = [
  { number: 41, createdAt: '2026-10-01T09:00:00Z', closedAt: '2026-10-30T09:00:00Z' },
  { number: 43, createdAt: '2026-10-03T09:00:00Z', closedAt: null },
  { number: 54, createdAt: '2026-11-01T09:00:00Z', closedAt: '2026-11-03T09:00:00Z' },
  { number: 55, createdAt: '2026-11-01T09:00:00Z', closedAt: '2026-11-02T09:00:00Z' },
  { number: 56, createdAt: '2026-11-02T09:00:00Z', closedAt: '2026-11-04T09:00:00Z' },
];

/** The module tree: alpha and beta importing each other, the cut table covering alpha with one upward edge. */
const TREE: Readonly<Record<string, string>> = {
  'packages/alpha/package.json': JSON.stringify({ name: '@open-tomato/alpha' }),
  'packages/alpha/src/index.ts': 'import { shape } from \'@open-tomato/beta\';\nexport const draw = (): string => shape;\n',
  'packages/alpha/src/index.test.ts': 'import { draw } from \'@open-tomato/alpha\';\nit(\'draws\', () => draw());\n',
  'packages/beta/package.json': JSON.stringify({ name: '@open-tomato/beta' }),
  'packages/beta/src/index.ts': 'export { draw } from \'@open-tomato/alpha\';\nexport const shape = \'round\';\nexport const size = 2;\n',
  [CUT_TABLE_FILE]: JSON.stringify({
    packages: [{
      name: 'alpha',
      folders: ['packages/alpha/'],
      edges: [{ from: 'packages/alpha/src/index.ts', to: 'packages/beta/src/index.ts', kind: 'value' }],
    }],
  }),
};

/** A root holding every source's fixture. */
function writeRoot(name: string): string {
  const root = join(scope, name);
  writeFixtureStore(root);
  writeFactsFixture(root);
  writeGitFixture(root);
  writeBoardFixture(root, boardCacheText([...FIXTURE_ROWS, ...EXTRA_ROWS]));
  for (const [path, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

beforeAll(async () => {
  const offline = writeRoot('offline');
  const github = writeRoot('github');
  await buildAtlas({ projectRoot: offline, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });
  await buildAtlas({
    projectRoot: github,
    env: {},
    now: () => BUILT_AT,
    projectLabel: 'fixture',
    github: true,
    gh: fixtureGh(FIXTURE_PRS, [...FIXTURE_ISSUE_DATES, ...EXTRA_DATES]).runner,
  });
  registries.offline = await openAtlasRegistry({ projectRoot: offline, sourceOptions: { now: () => BUILT_AT } });
  registries.github = await openAtlasRegistry({ projectRoot: github, sourceOptions: { now: () => BUILT_AT } });
});

afterAll(() => {
  registries.offline?.close();
  registries.github?.close();
  rmSync(scope, { recursive: true, force: true });
});

function metricOf(id: string): MetricDefinition {
  const metric = METRIC_CATALOGUE.find((candidate) => candidate.id === id);
  if (metric === undefined) throw new Error(`no metric ${id}`);
  return metric;
}

/** `params` asked of `metric`'s source in the replica `which` names, with no window. */
async function queryOf(which: keyof typeof registries, metric: MetricDefinition, params: QueryParams): Promise<QueryResult> {
  const registry = registries[which];
  if (registry === null) throw new Error(`no ${which} registry`);
  const source = registry.sources.get(metric.sourceId);
  if (source === undefined) throw new Error(`no source ${metric.sourceId}`);
  return source.query(params);
}

/** The metric `id` asked of the replica `which` names, its formula applied. */
async function answerOf(which: keyof typeof registries, id: string): Promise<QueryResult> {
  const metric = metricOf(id);
  return applyFormula(await queryOf(which, metric, metric.params), metric.formula);
}

/** The rows of `result` as records by column key. */
function recordsOf(result: QueryResult): Readonly<Record<string, Scalar>>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.key, row[index] ?? null])));
}

/** The `number` column of each row, in row order. */
function numbersOf(result: QueryResult): Scalar[] {
  return recordsOf(result).map((row) => row['number'] ?? null);
}

/** `metric`'s filters with the cli-gap filter left out: the control's params. */
function withoutCliGapFilter(metric: MetricDefinition): QueryParams {
  const filters: readonly Filter[] = (metric.params.filters ?? []).filter((filter) => filter !== CLI_GAP_OUT);
  return { ...metric.params, filters };
}

describe('the phase 4 metrics', () => {
  it('are served by the registry, each once', () => {
    const served = [...(registries.offline?.metrics.keys() ?? [])];

    expect(served.filter((id) => PHASE_FOUR_IDS.includes(id))).toEqual(PHASE_FOUR_IDS);
  });

  it.each(PHASE_FOUR_IDS)('%s passes the MetricDefinition schema', (id) => {
    expect(MetricDefinitionSchema.safeParse(metricOf(id)).success).toBe(true);
  });

  it.each(PHASE_FOUR_IDS)('%s runs on the engine over the --github replica, with rows behind its answer', async (id) => {
    const answer = await answerOf('github', id);

    expect(answer.rows.length).toBeGreaterThan(0);
    expect(answer.meta.rowCount).toBeGreaterThanOrEqual(answer.rows.length);
  });

  it.each(PHASE_FOUR_IDS.filter((id) => !GITHUB_IDS.includes(id)))('%s answers rows offline, from the git, board and module sources alone', async (id) => {
    expect((await answerOf('offline', id)).rows.length).toBeGreaterThan(0);
  });

  it.each(GITHUB_IDS)('%s answers no rows offline, where the cache holds no times (trap 3)', async (id) => {
    expect((await answerOf('offline', id)).rows).toEqual([]);
  });
});

describe('the bug metrics leave out cli-gap and keep a bug with no module', () => {
  it('counts the loop bugs of the plan by outcome: the no-module fix in, the cli-gap fix and follow-up out', async () => {
    const rows = recordsOf(await answerOf('offline', 'qa.bug-outcome-by-loop-start'));

    expect(rows).toEqual([
      { plan_stub: FIXTURE_PLAN, state: 'CLOSED', state_reason: 'COMPLETED', bugs: 1 },
      { plan_stub: FIXTURE_PLAN, state: 'CLOSED', state_reason: 'NOT_PLANNED', bugs: 1 },
      { plan_stub: FIXTURE_PLAN, state: 'OPEN', state_reason: null, bugs: 1 },
    ]);
  });

  it('control: the same params with no cli-gap filter count both cli-gap bugs', async () => {
    const metric = metricOf('qa.bug-outcome-by-loop-start');
    const rows = recordsOf(await queryOf('offline', metric, withoutCliGapFilter(metric)));

    expect(rows).toEqual([
      { plan_stub: FIXTURE_PLAN, state: 'CLOSED', state_reason: 'COMPLETED', bugs: 2 },
      { plan_stub: FIXTURE_PLAN, state: 'CLOSED', state_reason: 'NOT_PLANNED', bugs: 1 },
      { plan_stub: FIXTURE_PLAN, state: 'OPEN', state_reason: null, bugs: 1 },
      { plan_stub: FOLLOW_UPS_PLAN, state: 'CLOSED', state_reason: 'NOT_PLANNED', bugs: 1 },
    ]);
  });

  it('reads the drop rate over the closed loop bugs: one fixed with no module, one dropped', async () => {
    const rows = recordsOf(await answerOf('offline', 'qa.drop-rate'));

    expect(rows).toEqual([
      { state_reason: 'COMPLETED', bugs: 1, share: 0.5 },
      { state_reason: 'NOT_PLANNED', bugs: 1, share: 0.5 },
    ]);
  });

  it('answers the resolution time of the no-module fix alone, the cli-gap fix left out; the control orders by close time', async () => {
    const result = await answerOf('github', 'qa.resolution-time');
    const control = await queryOf('github', metricOf('qa.resolution-time'), withoutCliGapFilter(metricOf('qa.resolution-time')));

    expect(recordsOf(result).map((row) => [row['number'], row['priority']])).toEqual([[54, 'medium']]);
    expect(numbersOf(control)).toEqual([55, 54]);
  });

  it('lists the bugs behind open bugs per day and bugs per stretch, no cli-gap bug among them', async () => {
    const open = numbersOf(await answerOf('github', 'qa.open-bugs-per-day'));
    const stretch = numbersOf(await answerOf('github', 'qa.bugs-per-stretch'));
    const control = numbersOf(await queryOf('github', metricOf('qa.open-bugs-per-day'), withoutCliGapFilter(metricOf('qa.open-bugs-per-day'))));

    expect(open).toEqual([50, 52, 54, 56]);
    expect(stretch).toEqual(open);
    expect([...control].sort()).toEqual([50, 51, 52, 54, 55, 56]);
  });

  it('counts the open bugs per day they were opened for the defect age, the no-module bug in', async () => {
    const rows = recordsOf(await answerOf('github', 'qa.defect-age'));

    expect(rows).toEqual([{ day: '2026-10-21', bugs: 1 }, { day: '2026-10-24', bugs: 1 }]);
  });
});

describe('dev.wip counts by stage, never by label', () => {
  it('counts the two open issues in Claimed or In development', async () => {
    expect(recordsOf(await answerOf('offline', 'dev.wip'))).toEqual([{ issues: 2 }]);
  });

  it('leaves out issue 7, closed and still labelled rafa:in-development', async () => {
    const metric = metricOf('dev.wip');
    const wip = numbersOf(await queryOf('offline', metric, { fields: ['number'], filters: metric.params.filters ?? [], orderBy: [{ key: 'number', dir: 'asc' }] }));

    expect(wip).toEqual([50, 52]);
    expect(wip).not.toContain(7);
  });

  it('control: counting the rafa:in-development label takes issue 7 in', async () => {
    const labelled = numbersOf(await queryOf('offline', metricOf('dev.wip'), {
      fields: ['number'],
      filters: [{ field: 'labels_json', op: 'contains', value: '"rafa:in-development"' }],
      orderBy: [{ key: 'number', dir: 'asc' }],
    }));

    expect(labelled).toEqual([7, 50]);
  });
});

describe('the git, board and module readings', () => {
  it('counts the two v* release tags as deploys, the nightly tag and the off-walk tag not', async () => {
    const rows = recordsOf(await answerOf('offline', 'dev.deploys-per-week'));

    expect(rows.reduce((sum, row) => sum + Number(row['deploys']), 0)).toBe(2);
  });

  it('answers the epics by horizon, state and close reason', async () => {
    const rows = recordsOf(await answerOf('offline', 'pm.milestone-completion'));

    expect(rows).toEqual([
      { horizon: 'later', state: 'CLOSED', state_reason: 'COMPLETED', epics: 1 },
      { horizon: 'next', state: 'OPEN', state_reason: null, epics: 1 },
      { horizon: 'now', state: 'OPEN', state_reason: null, epics: 1 },
    ]);
  });

  it('answers the module readings: LOC and files per module, test files left out, the import fan both ways, alpha\'s one upward edge, and a density of zero bugs', async () => {
    const loc = recordsOf(await answerOf('offline', 'arch.loc-per-module'));
    const coupling = recordsOf(await answerOf('offline', 'arch.coupling'));
    const violations = recordsOf(await answerOf('offline', 'arch.violations'));
    const density = recordsOf(await answerOf('offline', 'qa.defect-density'));

    expect(loc.map((row) => [row['path'], row['loc'], row['files']])).toEqual([['packages/beta', 3, 1], ['packages/alpha', 2, 1]]);
    expect(coupling.map((row) => [row['path'], row['fan_in'], row['fan_out']])).toEqual([['packages/alpha', 1, 1], ['packages/beta', 1, 1]]);
    expect(violations).toEqual([{ path: 'packages/alpha', edges: 1 }]);
    expect(density.map((row) => row['bugs_per_line'])).toEqual([0, 0]);
  });

  it('answers each merged pull request for the cycle histogram, oldest merge first', async () => {
    expect(numbersOf(await answerOf('github', 'dev.pr-cycle-time'))).toEqual([7, 45, 61]);
  });
});
