/**
 * Tests for `buildAtlas` over the ingest's fixture store: one build writes
 * the replica under the project root with `task_facts`, `daily_rollup`
 * and `plan_facts` filled and every source stamped, and a second build
 * replaces it whole. The git cases plant the git ingest's fixture
 * repository in the root with `git init`, or hand a stub runner, so no
 * case reads the project's history; a root holding no repository stamps
 * both git sources missing and the build goes on. The board cases plant
 * the board ingest's fixture cache in the root; a root holding none stamps
 * both board sources missing and the build goes on.
 */
import type { GitRunner } from '../ingest/git.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica } from '@open-tomato/atlas-data/replica';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
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
