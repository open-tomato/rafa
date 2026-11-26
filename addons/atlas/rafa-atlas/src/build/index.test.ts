/**
 * Tests for `buildAtlas` over the ingest's fixture store: one build writes
 * the replica under the project root with `task_facts`, `daily_rollup`
 * and `plan_facts` filled and every source stamped, and a second build
 * replaces it whole. The git cases plant the git ingest's fixture
 * repository in the root with `git init`, or hand a stub runner, so no
 * case reads the project's history; a root holding no repository stamps
 * both git sources missing and the build goes on. The board cases plant
 * the board ingest's fixture cache in the root; a root holding none stamps
 * both board sources missing and the build goes on. The layer cases plant
 * three module folders, two with a package and one without, and build
 * with two layers: the folder each lists, by package or by folder, is
 * stamped with its layer and rank, and the third reads NULL, as every
 * folder does in the control build handed no layers.
 */
import type { GitRunner } from '../ingest/git.js';
import type { AtlasLayer } from '../layers.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { openReplica } from '@open-tomato/atlas-data/replica';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_SOURCE, ISSUES_SOURCE } from '../ingest/board.js';
import { TASKS_SOURCE } from '../ingest/effort.js';
import { BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, FINDINGS_SOURCE } from '../ingest/facts.js';
import { COMMITS_SOURCE, MARKS_SOURCE } from '../ingest/git.js';
import { PRS_SOURCE } from '../ingest/github.js';
import { MODULES_SOURCE } from '../ingest/modules.js';
import { FIXTURE_ROWS, FIXTURE_WATERMARK, writeBoardFixture } from '../ingest/testdata/board-cache.fixture.js';
import { sessionRow, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { writeGitFixture } from '../ingest/testdata/git-repo.fixture.js';

import { DAILY_SOURCE } from './daily.js';
import { PLANS_SOURCE } from './derive.js';

import { buildAtlas, replicaPathOf } from './index.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');

describe('buildAtlas over the buckets built so far', () => {
  it('writes the replica under the root with task_facts, daily_rollup and plan_facts filled and every source stamped', async () => {
    const root = join(scope, 'one');
    writeFixtureStore(root);

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });

    expect(summary.replicaPath).toBe(join(root, '.rafa', 'atlas', 'atlas.sqlite'));
    expect(summary.replicaPath).toBe(replicaPathOf(root));
    expect(summary.tables).toEqual(expect.objectContaining({ task_facts: 4, daily_rollup: 4, plan_facts: 1 }));
    expect(summary.sources.map((stamp) => stamp.source)).toEqual([
      TASKS_SOURCE, FINDINGS_SOURCE, BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, COMMITS_SOURCE, MARKS_SOURCE,
      ISSUES_SOURCE, BOARD_SOURCE, MODULES_SOURCE, PRS_SOURCE, DAILY_SOURCE, PLANS_SOURCE,
    ]);
    expect(summary.sources[11]).toEqual(expect.objectContaining({ rows: 4, readAt: BUILT_AT.toISOString() }));
    expect(summary.sources.slice(5, 11).map((stamp) => [stamp.rows, stamp.partial])).toEqual([[0, true], [0, true], [0, true], [0, true], [0, true], [0, true]]);
    expect(summary.sources[10]?.reason).toBe('not read: the build ran without --github');

    const reader = openReplica(summary.replicaPath);
    const replica = reader.current();
    reader.close();
    expect(replica.meta.buildId).toBe(summary.buildId);
    expect([...replica.sources.keys()].sort()).toEqual([
      BOARD_SOURCE, BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, COMMITS_SOURCE, DAILY_SOURCE, FINDINGS_SOURCE, ISSUES_SOURCE, MARKS_SOURCE,
      MODULES_SOURCE, PLANS_SOURCE, PRS_SOURCE, TASKS_SOURCE,
    ]);
    expect(existsSync(`${summary.replicaPath}.build-${summary.buildId}`)).toBe(false);
  });

  it('replaces the replica whole on a second build, with the rows the store holds then', async () => {
    const root = join(scope, 'two');
    writeFixtureStore(root);
    const first = await buildAtlas({ projectRoot: root, env: {} });
    openSqliteStore(root).append('sessions', [sessionRow({
      sessionId: 'session-late',
      kind: 'task',
      first: '2026-11-04T09:00:00.000Z',
      last: '2026-11-04T09:15:00.000Z',
    })]);

    const second = await buildAtlas({ projectRoot: root, env: {} });

    expect(first.tables).toEqual(expect.objectContaining({ task_facts: 4, daily_rollup: 4 }));
    expect(second.tables).toEqual(expect.objectContaining({ task_facts: 5, daily_rollup: 5 }));
    expect(second.buildId).not.toBe(first.buildId);
  });

  it('reads the root\'s git history into commit_facts and stretch_marks, adding the days only commits are on', async () => {
    const root = join(scope, 'git');
    writeFixtureStore(root);
    writeGitFixture(root);

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT });

    expect(summary.tables).toEqual(expect.objectContaining({ commit_facts: 7, stretch_marks: 4, daily_rollup: 6 }));
    expect(summary.sources.find((stamp) => stamp.source === COMMITS_SOURCE)).toEqual(expect.objectContaining({ rows: 7, partial: false }));
  });

  it('calls git only through the runner it is handed, in the order the ingest reads', async () => {
    const root = join(scope, 'stub');
    writeFixtureStore(root);
    writeGitFixture(root);
    const calls: string[] = [];
    const stub: GitRunner = (args) => {
      calls.push(args.join(' '));
      return { ok: false, stdout: '', stderr: 'fatal: the stub refuses' };
    };

    const summary = await buildAtlas({ projectRoot: root, env: {}, git: stub });

    expect(calls).toEqual(['rev-parse --verify --quiet refs/remotes/origin/HEAD^{commit}', 'rev-parse --verify --quiet HEAD^{commit}']);
    expect(summary.tables).toEqual(expect.objectContaining({ commit_facts: 0, stretch_marks: 0 }));
    expect(summary.sources.find((stamp) => stamp.source === MARKS_SOURCE)?.reason).toBe('no git history read: fatal: the stub refuses');
  });

  it('reads the root\'s board cache into issue_facts and today\'s board_snapshot, both stamped as of its watermark', async () => {
    const root = join(scope, 'board');
    writeFixtureStore(root);
    writeBoardFixture(root);

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT });
    const stampOf = (source: string): unknown => summary.sources.find((stamp) => stamp.source === source);

    expect(summary.tables).toEqual(expect.objectContaining({ issue_facts: FIXTURE_ROWS.length, board_snapshot: 11 }));
    expect(stampOf(ISSUES_SOURCE)).toEqual(expect.objectContaining({ rows: FIXTURE_ROWS.length, asOf: new Date(FIXTURE_WATERMARK).toISOString() }));
    expect(stampOf(BOARD_SOURCE)).toEqual(expect.objectContaining({ rows: 11, partial: false }));
  });

  it('goes on with a root holding no board cache, both board sources stamped missing and the others read', async () => {
    const root = join(scope, 'no-board');
    writeFixtureStore(root);

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT });
    const missing = summary.sources.filter((stamp) => stamp.reason?.startsWith('no board cache read') === true);

    expect(missing.map((stamp) => [stamp.source, stamp.rows, stamp.partial])).toEqual([[ISSUES_SOURCE, 0, true], [BOARD_SOURCE, 0, true]]);
    expect(summary.tables).toEqual(expect.objectContaining({ issue_facts: 0, board_snapshot: 0, task_facts: 4, plan_facts: 1 }));
    expect(existsSync(summary.replicaPath)).toBe(true);
  });

  it('refuses a root with no store, writing no replica', async () => {
    const root = join(scope, 'empty');

    await expect(buildAtlas({ projectRoot: root, env: {} })).rejects.toThrow('no effort store');
    expect(existsSync(replicaPathOf(root))).toBe(false);
  });
});

/** Three module folders: two packages and a root folder with no package. */
const MODULE_TREE: Readonly<Record<string, string>> = {
  'packages/core/package.json': JSON.stringify({ name: '@open-tomato/fixture-core' }),
  'packages/core/src/index.ts': 'export const core = 1;\n',
  'packages/extra/package.json': JSON.stringify({ name: '@open-tomato/fixture-extra' }),
  'packages/extra/src/index.ts': 'export const extra = 1;\n',
  'src/commands/index.ts': 'export const commands = 1;\n',
};

/** The two layers the case builds with: one listing a package, one a folder. */
const TWO_LAYERS: readonly AtlasLayer[] = [
  { name: 'core', modules: ['@open-tomato/fixture-core'] },
  { name: 'app', modules: ['src/commands'] },
];

/** A root holding the fixture store and {@link MODULE_TREE}. */
function moduleRoot(name: string): string {
  const root = join(scope, name);
  writeFixtureStore(root);
  for (const [path, text] of Object.entries(MODULE_TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Each `module_facts` row's path, layer and rank, by path. */
function layerRows(replicaPath: string): readonly (readonly unknown[])[] {
  const database = new Database(replicaPath, { readonly: true });
  try {
    return database.query<{ path: string; layer: string | null; layer_rank: number | null }, []>(
      'SELECT path, layer, layer_rank FROM module_facts ORDER BY path',
    ).all()
      .map((row) => [row.path, row.layer, row.layer_rank]);
  } finally {
    database.close();
  }
}

describe('buildAtlas stamping each module\'s layer', () => {
  it('stamps the layer and rank of each folder two layers list, by package and by folder, and NULL for the unlisted one', async () => {
    const root = moduleRoot('layers');

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, layers: TWO_LAYERS });

    expect(layerRows(summary.replicaPath)).toEqual([
      ['packages/core', 'core', 0],
      ['packages/extra', null, null],
      ['src/commands', 'app', 1],
    ]);
  });

  it('control: the same tree built with no layers reads NULL in every folder', async () => {
    const root = moduleRoot('no-layers');

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT });

    expect(layerRows(summary.replicaPath)).toEqual([
      ['packages/core', null, null],
      ['packages/extra', null, null],
      ['src/commands', null, null],
    ]);
  });
});
