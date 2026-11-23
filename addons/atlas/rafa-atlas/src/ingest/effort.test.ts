/**
 * Tests for `effort.ts` and the fact buckets it fills through `facts.ts`,
 * over a fixture store written in a tmpdir by core's store writers
 * (`testdata/effort-store.fixture.ts`): the D3 key keeps one row per
 * origin pair, a NULL-origin row lands once in each of two builds under
 * its store's id and `seq`, a missing column marks only the sources read
 * from its table partial, and the live store's bytes are the same after
 * the ingest. Over the fact rows: a tracker-ref-only findings row stays
 * out of `finding_facts` and every count, a routed bug takes its issue
 * number from its own session's finding, a head read red then green reads
 * `flipped`, and `module` names the longest module a row's text names.
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
import { bugKeyOf } from '@open-tomato/rafa-core/triage/bug-key';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { ingestEffort, TASKS_SOURCE } from './effort.js';
import { BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, FINDINGS_SOURCE } from './facts.js';
import { snapshotPathOf } from './snapshot.js';
import {
  CI_HEADS,
  FILED_BUG,
  FIXTURE_PLAN,
  FIXTURE_STORE_ID,
  FIXTURE_TASK_LINE,
  LEGACY_SESSION,
  PLAN_SESSION,
  plantOriginCopy,
  RECURRING_BUG,
  sessionRow,
  storeDigest,
  TASK_SESSIONS,
  TEST_BUG,
  withFixtureDatabase,
  writeFactsFixture,
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
  readonly findings: number;
  readonly bugs: number;
  readonly blockers: number;
  readonly skills_used: number;
}

/** A fresh project root holding the fixture store with the fact rows added. */
function factsRoot(name: string): string {
  const root = fixtureRoot(name);
  writeFactsFixture(root);
  return root;
}

/** A replica row, by column. */
type ReplicaRow = Readonly<Record<string, string | number | null>>;

/** The four fact buckets. */
type FactTable = 'finding_facts' | 'bug_facts' | 'change_facts' | 'ci_facts';

const FACT_TABLES: readonly FactTable[] = ['finding_facts', 'bug_facts', 'change_facts', 'ci_facts'];

/** What one build answered: the ingest, `task_facts`, and each fact bucket's rows. */
interface Built {
  readonly ingest: EffortIngest;
  readonly facts: FactRow[];
  /** The rows of `table` in the replica, in insert order: `origin_seq` counts per store table, so it interleaves two. */
  readonly rowsOf: (table: FactTable) => readonly ReplicaRow[];
}

/** Build a replica under `root` filled by the ingest alone, handed `modules`; answers the ingest and the replica's rows. */
async function build(root: string, modules: readonly string[] = []): Promise<Built> {
  const replicaPath = join(root, '.rafa', 'atlas', 'atlas.sqlite');
  const result = await writeReplica(
    { replicaPath, projectLabel: 'fixture' },
    (replica) => ingestEffort(replica, { root, env: {}, modules }),
  );
  const reader = openReplica(replicaPath);
  try {
    const { database } = reader.current();
    const facts = database
      .query<FactRow, []>('SELECT * FROM task_facts ORDER BY origin_seq')
      .all();
    const held = new Map(FACT_TABLES.map((table) => [
      table,
      database.query<ReplicaRow, []>(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]));
    return { ingest: result.value, facts, rowsOf: (table) => held.get(table) ?? [] };
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

/** The `findings` rows of `sessionId` in the store, read straight, past the ingest. */
function storeFindings(root: string, sessionId: string): { readonly kind: string | null; readonly artifact: string | null; readonly tracker_ref: string | null }[] {
  return withFixtureDatabase(root, (database) => database
    .query<{ readonly kind: string | null; readonly artifact: string | null; readonly tracker_ref: string | null }, [string]>(
      'SELECT kind, artifact, tracker_ref FROM findings WHERE session_id = ? ORDER BY seq',
    )
    .all(sessionId));
}

/** The `task_facts` row of `sessionId`. */
function taskOf(built: Built, sessionId: string): FactRow | undefined {
  return built.facts.find((fact) => fact.session_id === sessionId);
}

describe('ingestEffort, finding_facts', () => {
  it('keeps the tracker-ref-only findings rows out of the bucket and out of the session\'s count', async () => {
    const root = factsRoot('tracker-ref-only');

    const built = await build(root);
    const findings = built.rowsOf('finding_facts');
    const first = findings.filter((row) => row.session_id === TASK_SESSIONS[0] && row.source === 'finding');

    expect(first.map((row) => row.kind)).toEqual(['gotcha', 'pattern']);
    expect(findings.filter((row) => row.source === 'finding' && row.kind === null)).toEqual([]);
    expect(taskOf(built, TASK_SESSIONS[0])).toEqual(expect.objectContaining({ findings: 2, blockers: 1 }));
    expect(taskOf(built, TASK_SESSIONS[1])).toEqual(expect.objectContaining({ findings: 1, blockers: 0 }));
    expect(built.ingest.facts.trackerRefOnly).toBe(3);
  });

  it('control: the store holds those rows in the session, kindless and with a reference, which a plain count would take', () => {
    const root = factsRoot('tracker-ref-only-control');

    const rows = storeFindings(root, TASK_SESSIONS[0]);

    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.kind === null && row.tracker_ref !== null)).toHaveLength(2);
  });

  it('stamps local.findings with the three findings and the blocker, whole', async () => {
    const root = factsRoot('findings-stamp');

    const { ingest, rowsOf } = await build(root);
    const stamp = ingest.stamps.find((each) => each.source === FINDINGS_SOURCE);

    expect(rowsOf('finding_facts').map((row) => row.source)).toEqual(['finding', 'finding', 'finding', 'blocker']);
    expect(stamp).toEqual(expect.objectContaining({ rows: 4, partial: false, reason: null, asOf: '2026-11-03T10:47:00.000Z' }));
  });
});

describe('ingestEffort, bug_facts', () => {
  it('gives a routed bug the issue number its own session\'s finding holds under the bug\'s key', async () => {
    const root = factsRoot('routed-issue');

    const built = await build(root);
    const routed = built.rowsOf('bug_facts').filter((row) => row.source === 'routed');
    const filed = routed.find((row) => row.what === FILED_BUG.what);

    expect(filed).toEqual(expect.objectContaining({
      session_id: TASK_SESSIONS[0],
      artifact: FILED_BUG.artifact,
      kind: 'bug',
      route: 'filed',
      outcome: 'blocked',
      issue_number: FILED_BUG.issue,
    }));
    expect(routed.find((row) => row.what === TEST_BUG.what)?.issue_number).toBe(TEST_BUG.issue);
    expect(taskOf(built, TASK_SESSIONS[0])?.bugs).toBe(1);
    expect(taskOf(built, TASK_SESSIONS[1])?.bugs).toBe(2);
  });

  it('control: a reference another session holds under a bug\'s key, which a match across sessions would take, lends it none', async () => {
    const root = factsRoot('routed-issue-control');
    const key = bugKeyOf('', RECURRING_BUG.artifact, RECURRING_BUG.what);

    const { rowsOf } = await build(root);
    const held = storeFindings(root, TASK_SESSIONS[0]).filter((row) => row.artifact?.endsWith(key) === true);
    const recurring = rowsOf('bug_facts').filter((row) => row.what === RECURRING_BUG.what);

    expect(held).toHaveLength(1);
    expect(held[0]?.tracker_ref).toContain(`"externalId":"${String(RECURRING_BUG.issue)}"`);
    expect(recurring.map((row) => [row.source, row.session_id, row.issue_number])).toEqual([
      ['out_of_scope', TASK_SESSIONS[1], null],
      ['routed', TASK_SESSIONS[1], null],
    ]);
  });

  it('gives each out-of-scope bug the same issue number as its routed row, and keeps the scope columns off the routed one', async () => {
    const root = factsRoot('out-of-scope-issue');

    const { rowsOf } = await build(root);
    const filed = rowsOf('bug_facts').filter((row) => row.what === FILED_BUG.what);

    expect(filed.map((row) => [row.source, row.issue_number, row.security])).toEqual([
      ['out_of_scope', FILED_BUG.issue, 0],
      ['routed', FILED_BUG.issue, null],
    ]);
  });
});

describe('ingestEffort, ci_facts', () => {
  it('reads every reading of a head read red, then green, as flipped', async () => {
    const root = factsRoot('flipped');

    const { rowsOf, ingest } = await build(root);
    const readings = rowsOf('ci_facts').filter((row) => row.head_sha === CI_HEADS.flipped);

    expect(readings.map((row) => [row.verdict, row.flipped, row.failing_count])).toEqual([
      ['red', 1, 1],
      ['green', 1, 0],
    ]);
    expect(ingest.stamps.find((each) => each.source === CI_SOURCE)).toEqual(expect.objectContaining({
      rows: 5,
      asOf: '2026-11-03T13:00:00.000Z',
      partial: false,
    }));
  });

  it('control: a head read green then red, and one read red only, read 0', async () => {
    const root = factsRoot('flipped-control');

    const { rowsOf } = await build(root);
    const others = rowsOf('ci_facts').filter((row) => row.head_sha !== CI_HEADS.flipped);

    expect(others.map((row) => [row.head_sha, row.verdict, row.flipped])).toEqual([
      [CI_HEADS.greenThenRed, 'green', 0],
      [CI_HEADS.greenThenRed, 'red', 0],
      [CI_HEADS.redOnly, 'red', 0],
    ]);
    expect(others.find((row) => row.verdict === 'red')?.failing_json).toBe(`["check-${CI_HEADS.greenThenRed}"]`);
  });
});

describe('ingestEffort, change_facts and the module column', () => {
  it('stores each change with its level, and names the longest module a row\'s text names', async () => {
    const root = factsRoot('modules');
    const modules = ['addons/atlas', 'packages/rafa', 'packages/rafa-board', 'packages/rafa-effort', 'packages/rafa-pr'];

    const { rowsOf, ingest } = await build(root, modules);

    expect(rowsOf('change_facts').map((row) => [row.session_id, row.level, row.module])).toEqual([
      [TASK_SESSIONS[0], 'patch', null],
      [TASK_SESSIONS[1], 'minor', 'packages/rafa-pr'],
    ]);
    expect(rowsOf('finding_facts').map((row) => row.module)).toEqual(['packages/rafa-effort', 'addons/atlas', null, null]);
    expect(rowsOf('bug_facts').find((row) => row.what === FILED_BUG.what)?.module).toBe('packages/rafa-board');
    expect(ingest.stamps.map((each) => each.source)).toEqual([TASKS_SOURCE, FINDINGS_SOURCE, BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE]);
  });

  it('control: with no modules handed, every module reads NULL', async () => {
    const root = factsRoot('modules-control');

    const { rowsOf } = await build(root);

    for (const table of FACT_TABLES.filter((name) => name !== 'ci_facts')) {
      const named = rowsOf(table)
        .map((row) => row.module)
        .filter((module) => module !== null);
      expect(named).toEqual([]);
    }
  });
});

describe('ingestEffort, a missing fact column', () => {
  it('marks only the sources read from its table partial, and reads that field as NULL', async () => {
    const root = factsRoot('missing-fact-column');
    withFixtureDatabase(root, (database) => database.run('ALTER TABLE findings DROP COLUMN signal'));

    const { ingest, rowsOf } = await build(root);
    const partial = ingest.stamps.filter((each) => each.partial).map((each) => [each.source, each.reason]);

    expect(partial).toEqual([
      [FINDINGS_SOURCE, 'the effort store has no findings.signal; those fields read NULL'],
      [BUGS_SOURCE, 'the effort store has no findings.signal; those fields read NULL'],
    ]);
    expect(rowsOf('finding_facts').map((row) => row.signal)).toEqual([null, null, null, null]);
  });

  it('control: the whole fixture stamps every source whole, the signals filled', async () => {
    const root = factsRoot('missing-fact-column-control');

    const { ingest, rowsOf } = await build(root);

    expect(ingest.stamps.filter((each) => each.partial)).toEqual([]);
    expect(rowsOf('finding_facts').map((row) => row.signal)).toEqual(['loud', 'silent', 'loud', null]);
  });
});
