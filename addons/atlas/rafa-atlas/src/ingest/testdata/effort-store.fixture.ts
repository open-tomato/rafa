/**
 * A fixture effort store for the ingest tests, written in a tmpdir with
 * core's store writers: `openSqliteStore(...).append` for sessions,
 * `writeDispatch` and `writeTaskReport` for the joined rows,
 * `writeFindings`, `writeTriage`, `writeTrackerRef`, `writeBugRoutes`,
 * `writeChanges` and `writePlanCi` for the fact buckets
 * (`writeFactsFixture`), and
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
import type { IssueRef } from '@open-tomato/rafa-core/ports';
import type { ReportBlocker, ReportBug, ReportChange, ReportFinding } from '@open-tomato/rafa-core/report/parse';
import type { BugRouteEntry } from '@open-tomato/rafa-core/store/bug-routes';
import type { SessionEffortRow } from '@open-tomato/rafa-core/store/types';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeBugRoutes } from '@open-tomato/rafa-core/store/bug-routes';
import { writeChanges } from '@open-tomato/rafa-core/store/changes';
import { writeDispatch } from '@open-tomato/rafa-core/store/dispatches';
import { writeFindings } from '@open-tomato/rafa-core/store/findings';
import { guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { writePlanCi } from '@open-tomato/rafa-core/store/plan-ci';
import { writeTaskReport } from '@open-tomato/rafa-core/store/reports';
import { openSqliteStore, sqliteStorePath, withSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { writeTrackerRef } from '@open-tomato/rafa-core/store/tracker-refs';
import { writeTriage } from '@open-tomato/rafa-core/store/triage';
import { bugKeyOf } from '@open-tomato/rafa-core/triage/bug-key';
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

/** The tracker file the fixture's bugs were keyed against; a relative path, so no home path is in it. */
export const FIXTURE_TRACKER = '.rafa/plans/PLAN_TRACKER-atlas-fixture.md';

/** One fixture bug: what the report said, and the GitHub issue its key was filed as. */
export interface FixtureBug {
  readonly what: string;
  readonly artifact: string;
  readonly issue: number;
}

/** The first task session's bug, filed from that session: its routed row reads issue 1234. */
export const FILED_BUG: FixtureBug = {
  what: 'the stage reader drops a closed epic',
  artifact: 'packages/rafa-board/src/stage.ts:41 returns null for a closed epic',
  issue: 1234,
};

/** The second session's bug naming a test case, which keys on the test with no tracker file. */
export const TEST_BUG: FixtureBug = {
  what: 'the triage check reads a red case as fallout',
  artifact: 'packages/rafa-pr/src/triage/own-check.test.ts:\n(fail) checkKind > reads a red case as fallout [3.00ms]',
  issue: 4321,
};

/**
 * The second session's other bug, whose reference the FIRST session holds
 * under the bug's key: a recurrence commented on, so its rows read no
 * issue number.
 */
export const RECURRING_BUG: FixtureBug = {
  what: 'the ci reader skips a draft pull request',
  artifact: 'packages/rafa-pr/src/ci/read.ts: draft skipped',
  issue: 5678,
};

/** The fixture's CI heads: read red then green, green then red, and red only. */
export const CI_HEADS = { flipped: 'a1a1a1a', greenThenRed: 'b2b2b2b', redOnly: 'c3c3c3c' } as const;

/** A report bug of `bug`, as `parseReport` answers one. */
function reportBug(bug: FixtureBug): ReportBug {
  return {
    what: bug.what,
    artifact: bug.artifact,
    security: false,
    kind: 'bug',
    module: null,
    action: null,
    reproduce: null,
    cause: null,
    extras: [],
  };
}

/** A report finding, every field not set null. */
function reportFinding(finding: Partial<ReportFinding> & Pick<ReportFinding, 'kind'>): ReportFinding {
  return {
    trigger: 'when the fixture ran',
    what: null,
    cause: null,
    resolution: null,
    artifact: null,
    signal: 'loud',
    domain: null,
    extras: [],
    ...finding,
  };
}

/** The GitHub reference core's tracker answers for `bug`. */
function issueRef(bug: FixtureBug): IssueRef {
  return { opt: bug.issue, kind: 'github', externalId: String(bug.issue), url: `https://github.com/example/fixture/issues/${String(bug.issue)}` };
}

/** One task session's report rows, through core's writers: findings first, as triage writes them. */
interface SessionRows {
  readonly sessionId: string;
  readonly outcome: 'done' | 'blocked';
  readonly at: string;
  readonly findings: readonly ReportFinding[];
  readonly blockers: readonly ReportBlocker[];
  readonly bugs: readonly FixtureBug[];
  /** The bugs whose reference this session stores, under each bug's key. */
  readonly refs: readonly FixtureBug[];
  readonly routes: readonly Omit<BugRouteEntry, 'entryIndex'>[];
  readonly changes: readonly ReportChange[];
}

function writeSessionRows(root: string, rows: SessionRows): void {
  const dispatch = { sessionId: rows.sessionId, planStub: FIXTURE_PLAN, taskLine: FIXTURE_TASK_LINE };
  const seams = { now: () => new Date(rows.at) };
  writeFindings(root, { dispatch, outcome: rows.outcome, findings: rows.findings }, seams);
  writeTriage(root, { dispatch, outcome: rows.outcome, blockers: rows.blockers, outOfScopeBugs: rows.bugs.map(reportBug) }, seams);
  for (const bug of rows.refs) {
    writeTrackerRef(root, {
      dispatch,
      outcome: rows.outcome,
      artifact: bugKeyOf(FIXTURE_TRACKER, bug.artifact, bug.what),
      ref: issueRef(bug),
    }, seams);
  }
  writeBugRoutes(root, { dispatch, routes: rows.routes.map((route, entryIndex) => ({ ...route, entryIndex })) }, seams);
  writeChanges(root, { dispatch, changes: rows.changes }, seams);
}

/**
 * Add the report rows of both task sessions to the fixture store under
 * `root`, written by `writeFixtureStore` first, and three CI heads of the
 * plan: the first session holds two findings with a kind, a blocker,
 * {@link FILED_BUG} with its route and reference, the reference of
 * {@link RECURRING_BUG}, and a patch change; the second a finding,
 * {@link TEST_BUG} and {@link RECURRING_BUG} with their routes, the
 * reference of {@link TEST_BUG} only, and a minor change.
 */
export function writeFactsFixture(root: string): void {
  writeSessionRows(root, {
    sessionId: TASK_SESSIONS[0],
    outcome: 'blocked',
    at: '2026-11-02T10:32:00.000Z',
    findings: [
      reportFinding({ kind: 'gotcha', what: 'a report helper throws', artifact: 'packages/rafa-effort/src/effort/report.ts: undefined is not a function' }),
      reportFinding({ kind: 'pattern', what: 'addons/atlas/data holds NULLs distinct in a UNIQUE key', signal: 'silent' }),
    ],
    blockers: [{ what: 'the store is locked', artifact: 'database is locked', extras: [] }],
    bugs: [FILED_BUG],
    refs: [FILED_BUG, RECURRING_BUG],
    routes: [{ what: FILED_BUG.what, said: 'bug', kind: 'bug', route: 'filed' }],
    changes: [{ level: 'patch', area: 'board', summary: 'the stage reader keeps closed epics', extras: [] }],
  });
  writeSessionRows(root, {
    sessionId: TASK_SESSIONS[1],
    outcome: 'done',
    at: '2026-11-03T10:47:00.000Z',
    findings: [reportFinding({ kind: 'location', what: 'the CI reader lives in rafa-pr', artifact: 'ci/read.ts' })],
    blockers: [],
    bugs: [TEST_BUG, RECURRING_BUG],
    refs: [TEST_BUG],
    routes: [
      { what: TEST_BUG.what, said: 'bug', kind: 'bug', route: 'filed' },
      { what: RECURRING_BUG.what, said: 'own-gap', kind: 'own-gap', route: 'repair' },
    ],
    changes: [{ level: 'minor', area: null, summary: 'packages/rafa-pr reads draft pull requests', extras: [] }],
  });
  const reading = (headSha: string, verdict: 'green' | 'red', readAt: string): void => {
    writePlanCi(root, {
      planStub: FIXTURE_PLAN,
      pr: 7,
      headSha,
      verdict,
      failing: verdict === 'red'
        ? [`check-${headSha}`]
        : [],
      readAt,
    });
  };
  reading(CI_HEADS.flipped, 'red', '2026-11-03T11:00:00.000Z');
  reading(CI_HEADS.flipped, 'green', '2026-11-03T11:20:00.000Z');
  reading(CI_HEADS.greenThenRed, 'green', '2026-11-03T12:00:00.000Z');
  reading(CI_HEADS.greenThenRed, 'red', '2026-11-03T12:20:00.000Z');
  reading(CI_HEADS.redOnly, 'red', '2026-11-03T13:00:00.000Z');
}
