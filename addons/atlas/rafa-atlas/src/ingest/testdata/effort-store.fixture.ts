/**
 * A fixture effort store for the ingest tests, written in a tmpdir with
 * core's store writers: `openSqliteStore(...).append` for sessions,
 * `writeDispatch` and `writeTaskReport` for the joined rows, and
 * `withSqliteStore` to mint the store's origin with the project injected,
 * so no git runs. Named without `.test` so bun never runs it alone.
 *
 * The first session is appended before the store is minted. A store
 * under `tmpdir()` outside any repository stamps no origin, so that row
 * holds NULL in `origin_store` and `origin_seq`, as the 1,051 rows of a
 * real store that predate `row-origins` do. Every row after the mint
 * carries the pair `(FIXTURE_STORE_ID, seq)`.
 *
 * No row is copied from a real store: every value is made up here.
 */
import type { SessionEffortRow } from '@open-tomato/rafa-core/store/types';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeDispatch } from '@open-tomato/rafa-core/store/dispatches';
import { guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { writeTaskReport } from '@open-tomato/rafa-core/store/reports';
import { openSqliteStore, sqliteStorePath, withSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { Database } from 'bun:sqlite';

/** The origin the fixture store is minted with. */
export const FIXTURE_STORE_ID = 'store-fixture-a';

/** The session appended before the mint, NULL in both origin columns. */
export const LEGACY_SESSION = 'session-legacy';

/** The two task sessions of one task line, the second a retry. */
export const TASK_SESSIONS: readonly [string, string] = ['session-task-1', 'session-task-2'];

/** A plan-generation session, with no dispatch and no report. */
export const PLAN_SESSION = 'session-plan';

/** The plan stub and task line the two task sessions ran. */
export const FIXTURE_PLAN = 'atlas-fixture';
export const FIXTURE_TASK_LINE = 'Add the fixture ingest';

const MINTED_AT = new Date('2026-11-01T08:00:00.000Z');

/** The fields a fixture session sets; the rest take the defaults below. */
export interface FixtureSession {
  readonly sessionId: string;
  readonly kind: SessionEffortRow['kind'];
  readonly first: string;
  readonly last: string;
  readonly tokens?: Partial<SessionEffortRow['usage']>;
  readonly modelCounts?: Record<string, number>;
}

/** A whole session row for `session`, every field not set a made-up default. */
export function sessionRow(session: FixtureSession): SessionEffortRow {
  const isTask = session.kind === 'task';
  return {
    sessionId: session.sessionId,
    filePath: `fixture-project/${session.sessionId}.jsonl`,
    lineCount: 10,
    recordCount: 10,
    unparsedLineCount: 0,
    recordTypeCounts: { assistant: 6, user: 4 },
    assistantRecordCount: 6,
    firstTimestamp: session.first,
    lastTimestamp: session.last,
    gitBranchCounts: { 'rafa-fixture': 10 },
    entrypointCounts: { 'sdk-cli': 10 },
    effortCounts: { high: 6 },
    sidechainRecordCount: 0,
    modelCounts: session.modelCounts ?? { 'model-a': 6 },
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 4_000,
      ephemeral1hInputTokens: 50,
      ephemeral5mInputTokens: 250,
      webSearchRequests: 0,
      webFetchRequests: 0,
      thinkingTokens: 70,
      ...session.tokens,
    },
    kind: session.kind,
    mode: 'local',
    branch: 'rafa-fixture',
    branchRecordCount: 10,
    distinctBranchCount: 1,
    branchType: 'feat',
    branchStub: 'fixture',
    planStub: isTask
      ? FIXTURE_PLAN
      : null,
    planStubMatch: isTask
      ? 'exact'
      : 'none',
    issueIdentifier: null,
    taskText: isTask
      ? FIXTURE_TASK_LINE
      : null,
    enqueueRecordIndex: isTask
      ? 0
      : null,
    sizeBytes: 1_000,
    modifiedAt: session.last,
    worktree: null,
  };
}

/** Mint `FIXTURE_STORE_ID` into the store under `root`, the project injected so no git runs. */
function mint(root: string): void {
  withSqliteStore(sqliteStorePath(root), 'write', false, () => undefined, {
    readProject: () => ({ rootCommit: 'f1x7c0de', remote: null }),
    newStoreId: () => FIXTURE_STORE_ID,
    now: () => MINTED_AT,
  });
}

/** One task session's dispatch and report, through core's writers. */
function writeTaskRows(root: string, sessionId: string, status: 'done' | 'blocked', at: string): void {
  const dispatch = { sessionId, planStub: FIXTURE_PLAN, taskLine: FIXTURE_TASK_LINE };
  writeDispatch(root, {
    ...dispatch,
    declaration: {
      raw: '{agent: implementer, model: declared-model}',
      agent: 'implementer',
      model: 'declared-model',
      effort: null,
      budget: 2.5,
      tools: null,
    },
    flags: [],
  }, { now: () => new Date(at) });
  writeTaskReport(root, {
    dispatch,
    outcome: status,
    report: { status, skillsUsed: ['skill-a', 'skill-b'] },
  }, { now: () => new Date(at) });
}

/**
 * Write the fixture store under `root`: the legacy session (seq 1, no
 * origin), the mint, then two task sessions of one task line with their
 * dispatches and reports, and a plan session.
 */
export function writeFixtureStore(root: string): void {
  const store = openSqliteStore(root);
  store.append('sessions', [sessionRow({
    sessionId: LEGACY_SESSION,
    kind: 'other',
    first: '2026-10-30T09:00:00.000Z',
    last: '2026-10-30T09:12:00.000Z',
  })]);
  mint(root);
  store.append('sessions', [
    sessionRow({
      sessionId: TASK_SESSIONS[0],
      kind: 'task',
      first: '2026-11-02T10:00:00.000Z',
      last: '2026-11-02T10:30:00.000Z',
      modelCounts: { 'model-a': 2, 'model-b': 5 },
    }),
    sessionRow({
      sessionId: TASK_SESSIONS[1],
      kind: 'task',
      first: '2026-11-03T10:00:00.000Z',
      last: '2026-11-03T10:45:00.000Z',
    }),
    sessionRow({
      sessionId: PLAN_SESSION,
      kind: 'plan-generation',
      first: '2026-11-01T09:00:00.000Z',
      last: '2026-11-01T09:05:00.000Z',
    }),
  ]);
  writeTaskRows(root, TASK_SESSIONS[0], 'blocked', '2026-11-02T10:31:00.000Z');
  writeTaskRows(root, TASK_SESSIONS[1], 'done', '2026-11-03T10:46:00.000Z');
}

/** Run `use` on the fixture store under `root`, opened read-write past the test guard. */
export function withFixtureDatabase<T>(root: string, use: (database: Database) => T): T {
  const path = sqliteStorePath(root);
  guardTestProcess(path);
  const database = new Database(path, { readwrite: true });
  try {
    return use(database);
  } finally {
    database.close();
  }
}

/**
 * Plant a session carrying the origin pair the legacy row's D3 key
 * reads, `(FIXTURE_STORE_ID, <its seq>)`, under its own session id and
 * `seq`: the shape a row takes when another store stamped it and a merge
 * carried it back. The store's partial unique index covers only rows
 * whose `origin_store` is not NULL, so it takes the row beside the
 * legacy one. Answers the legacy row's `seq`.
 */
export function plantOriginCopy(root: string, sessionId: string): number {
  return withFixtureDatabase(root, (database) => {
    const legacy = database
      .query<{ readonly seq: number; readonly row_json: string }, [string]>(
        'SELECT seq, row_json FROM sessions WHERE session_id = ?',
      )
      .get(LEGACY_SESSION);
    if (legacy === null) throw new Error('fixture: the legacy session is missing');
    const row = { ...(JSON.parse(legacy.row_json) as SessionEffortRow), sessionId };
    database.run(
      `INSERT INTO sessions (seq, session_id, row_json, origin_store, origin_seq)
        VALUES ((SELECT max(seq) + 1 FROM sessions), ?, ?, ?, ?)`,
      [sessionId, JSON.stringify(row), FIXTURE_STORE_ID, legacy.seq],
    );
    return legacy.seq;
  });
}

/** The SHA-256 of the store file under `root`, its bytes as they are now. */
export function storeDigest(root: string): string {
  return createHash('sha256')
    .update(readFileSync(sqliteStorePath(root)))
    .digest('hex');
}

/** The store directory under `root`, as core resolves it with no override. */
export function fixtureStoreDir(root: string): string {
  return join(root, '.rafa', 'effort');
}
