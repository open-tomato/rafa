/**
 * Tests for `buildAtlas` over the ingest's fixture store: one build writes
 * the replica under the project root with `task_facts` and `daily_rollup`
 * filled and every source stamped, and a second build replaces it whole.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica } from '@open-tomato/atlas-data/replica';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { TASKS_SOURCE } from '../ingest/effort.js';
import { BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, FINDINGS_SOURCE } from '../ingest/facts.js';
import { sessionRow, writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';

import { DAILY_SOURCE } from './daily.js';

import { buildAtlas, replicaPathOf } from './index.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');

describe('buildAtlas over the buckets built so far', () => {
  it('writes the replica under the root with task_facts and daily_rollup filled and every source stamped', async () => {
    const root = join(scope, 'one');
    writeFixtureStore(root);

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });

    expect(summary.replicaPath).toBe(join(root, '.rafa', 'atlas', 'atlas.sqlite'));
    expect(summary.replicaPath).toBe(replicaPathOf(root));
    expect(summary.tables).toEqual(expect.objectContaining({ task_facts: 4, daily_rollup: 4, plan_facts: 0 }));
    expect(summary.sources.map((stamp) => stamp.source)).toEqual([
      TASKS_SOURCE, FINDINGS_SOURCE, BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, DAILY_SOURCE,
    ]);
    expect(summary.sources[5]).toEqual(expect.objectContaining({ rows: 4, readAt: BUILT_AT.toISOString() }));

    const reader = openReplica(summary.replicaPath);
    const replica = reader.current();
    reader.close();
    expect(replica.meta.buildId).toBe(summary.buildId);
    expect([...replica.sources.keys()].sort()).toEqual([
      BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, DAILY_SOURCE, FINDINGS_SOURCE, TASKS_SOURCE,
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

  it('refuses a root with no store, writing no replica', async () => {
    const root = join(scope, 'empty');

    await expect(buildAtlas({ projectRoot: root, env: {} })).rejects.toThrow('no effort store');
    expect(existsSync(replicaPathOf(root))).toBe(false);
  });
});
