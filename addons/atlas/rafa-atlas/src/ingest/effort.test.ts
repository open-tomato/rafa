/**
 * Tests for `effort.ts` over a fixture store written in a tmpdir by core's
 * store writers (`testdata/effort-store.fixture.ts`): the D3 key keeps one
 * row per origin pair, a NULL-origin row lands once in each of two builds
 * under its store's id and `seq`, a missing column marks `local.tasks`
 * partial, and the live store's bytes are the same after the ingest.
 * Each reading that could pass for the wrong reason has a control beside
 * it.
 */
import type { EffortIngest } from './effort.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica, writeReplica } from '@open-tomato/atlas-data/replica';
import { guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { ingestEffort, TASKS_SOURCE } from './effort.js';
import { snapshotPathOf } from './snapshot.js';
import {
  FIXTURE_PLAN,
  FIXTURE_STORE_ID,
  FIXTURE_TASK_LINE,
  LEGACY_SESSION,
  PLAN_SESSION,
  plantOriginCopy,
  sessionRow,
  storeDigest,
  TASK_SESSIONS,
  withFixtureDatabase,
  writeFixtureStore,
} from './testdata/effort-store.fixture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-ingest-effort-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let planted = 0;

/** A fresh project root under the suite's scope, holding the fixture store. */
function fixtureRoot(name: string): string {
  planted += 1;
  const root = join(scope, `${String(planted)}-${name}`);
  writeFixtureStore(root);
  return root;
}

/** One `task_facts` row, as the tests read it back. */
interface FactRow {
  readonly session_id: string;
  readonly origin_store: string | null;
  readonly origin_seq: number | null;
  readonly kind: string;
  readonly plan_stub: string | null;
  readonly task_line: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly budget_usd: number | null;
  readonly day: string | null;
  readonly minutes: number | null;
  readonly tokens: number | null;
  readonly status: string | null;
  readonly attempt: number | null;
  readonly skills_used: number;
}

/** Build a replica under `root` filled by the ingest alone; answers the ingest and the replica's rows. */
async function build(root: string): Promise<{ readonly ingest: EffortIngest; readonly facts: FactRow[] }> {
  const replicaPath = join(root, '.rafa', 'atlas', 'atlas.sqlite');
  const result = await writeReplica({ replicaPath, projectLabel: 'fixture' }, (replica) => ingestEffort(replica, { root, env: {} }));
  const reader = openReplica(replicaPath);
  try {
    const facts = reader.current().database
      .query<FactRow, []>('SELECT * FROM task_facts ORDER BY origin_seq')
      .all();
    return { ingest: result.value, facts };
  } finally {
    reader.close();
  }
}

describe('ingestEffort, the D3 dedupe key', () => {
  it('stores a duplicate origin pair once, keeping the row written first', async () => {
    const root = fixtureRoot('duplicate');
    const legacySeq = plantOriginCopy(root, 'session-legacy-copy');

    const { ingest, facts } = await build(root);

    const pair = facts.filter((fact) => fact.origin_store === FIXTURE_STORE_ID && fact.origin_seq === legacySeq);
    expect(pair.map((fact) => fact.session_id)).toEqual([LEGACY_SESSION]);
    expect(ingest.read.duplicates).toBe(1);
    expect(facts.map((fact) => fact.session_id)).not.toContain('session-legacy-copy');
    expect(facts).toHaveLength(4);
  });

  it('control: the store holds both rows of that pair, which a plain UNIQUE key would both keep', () => {
    const root = fixtureRoot('duplicate-control');
    plantOriginCopy(root, 'session-legacy-copy');
    const pairs = withFixtureDatabase(root, (database) => database
      .query<{ readonly origin_store: string | null; readonly origin_seq: number | null }, [string, string]>(
        'SELECT origin_store, origin_seq FROM sessions WHERE session_id IN (?, ?) ORDER BY seq',
      )
      .all(LEGACY_SESSION, 'session-legacy-copy'));

    const plainPath = join(scope, `${String(planted)}-plain-unique.sqlite`);
    guardTestProcess(plainPath);
    const plain = new Database(plainPath, { create: true, readwrite: true });
    plain.run('CREATE TABLE t (origin_store TEXT, origin_seq INTEGER, UNIQUE (origin_store, origin_seq))');
    const insert = plain.prepare('INSERT OR IGNORE INTO t VALUES (?, ?)');
    for (const pair of pairs) insert.run(pair.origin_store, pair.origin_seq);
    const kept = plain.query<{ readonly n: number }, []>('SELECT count(*) AS n FROM t').get();
    plain.close();

    expect(pairs).toHaveLength(2);
    expect(kept?.n).toBe(2);
  });

  it('stores a NULL-origin row once in each of two builds, under the store id and its seq', async () => {
    const root = fixtureRoot('null-origin');
    const source = withFixtureDatabase(root, (database) => database
      .query<{ readonly seq: number; readonly origin_store: string | null }, [string]>(
        'SELECT seq, origin_store FROM sessions WHERE session_id = ?',
      )
      .get(LEGACY_SESSION));

    const first = await build(root);
    const second = await build(root);

    expect(source?.origin_store).toBeNull();
    for (const { facts } of [first, second]) {
      const legacy = facts.filter((fact) => fact.session_id === LEGACY_SESSION);
      expect(legacy).toEqual([expect.objectContaining({ origin_store: FIXTURE_STORE_ID, origin_seq: source?.seq })]);
      expect(facts).toHaveLength(4);
    }
  });
});

describe('ingestEffort, the column check', () => {
  it('marks local.tasks partial for a missing column and reads that field as NULL', async () => {
    const root = fixtureRoot('missing-column');
    withFixtureDatabase(root, (database) => database.run('ALTER TABLE dispatches DROP COLUMN agent'));

    const { ingest, facts } = await build(root);
    const replica = openReplica(join(root, '.rafa', 'atlas', 'atlas.sqlite'));
    const stamp = replica.current().sources.get(TASKS_SOURCE);
    replica.close();

    expect(ingest.read.columns.missing).toEqual(['dispatches.agent']);
    expect(stamp).toEqual(expect.objectContaining({ partial: true, rows: 4 }));
    expect(stamp?.reason).toContain('dispatches.agent');
    expect(facts.map((fact) => fact.agent)).toEqual([null, null, null, null]);
  });

  it('control: the whole fixture reads as whole, with the agent filled', async () => {
    const root = fixtureRoot('whole');

    const { ingest, facts } = await build(root);

    expect(ingest.read.columns.missing).toEqual([]);
    expect(ingest.stamp).toEqual(expect.objectContaining({ source: TASKS_SOURCE, partial: false, reason: null, rows: 4 }));
    expect(facts.filter((fact) => fact.kind === 'task').map((fact) => fact.agent)).toEqual(['implementer', 'implementer']);
  });
});

describe('ingestEffort, the live store', () => {
  it('leaves the store file\'s bytes as they were, across two builds', async () => {
    const root = fixtureRoot('bytes');
    const before = storeDigest(root);

    const { ingest } = await build(root);
    await build(root);

    expect(storeDigest(root)).toBe(before);
    expect(ingest.snapshot.snapshotPath).toBe(snapshotPathOf(root));
  });

  it('control: a write through core\'s store writer changes the digest', () => {
    const root = fixtureRoot('bytes-control');
    const before = storeDigest(root);

    openSqliteStore(root).append('sessions', [sessionRow({
      sessionId: 'session-late',
      kind: 'other',
      first: '2026-11-04T09:00:00.000Z',
      last: '2026-11-04T09:01:00.000Z',
    })]);

    expect(storeDigest(root)).not.toBe(before);
  });
});

describe('ingestEffort, the columns of a task fact', () => {
  it('joins the dispatch and report, sums four token counts and numbers attempts by start', async () => {
    const root = fixtureRoot('values');

    const { ingest, facts } = await build(root);
    const byId = new Map(facts.map((fact) => [fact.session_id, fact]));

    expect(byId.get(TASK_SESSIONS[0])).toEqual(expect.objectContaining({
      kind: 'task',
      plan_stub: FIXTURE_PLAN,
      task_line: FIXTURE_TASK_LINE,
      model: 'model-b',
      budget_usd: 2.5,
      day: '2026-11-02',
      minutes: 30,
      tokens: 100 + 20 + 300 + 4_000,
      status: 'blocked',
      attempt: 1,
      skills_used: 2,
    }));
    expect(byId.get(TASK_SESSIONS[1])).toEqual(expect.objectContaining({ status: 'done', attempt: 2, minutes: 45 }));
    expect(byId.get(PLAN_SESSION)).toEqual(expect.objectContaining({
      kind: 'plan-generation',
      model: 'model-a',
      status: null,
      attempt: null,
      skills_used: 0,
    }));
    expect(ingest.stamp.asOf).toBe('2026-11-03T10:46:00.000Z');
  });
});
