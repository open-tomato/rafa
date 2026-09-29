/**
 * Forward compatibility: a store a newer rafa has already touched still
 * works with this build's writers and readers.
 *
 * `TAIL_MIGRATIONS` is `SQLITE_MIGRATIONS` with a synthetic additive tail
 * appended: a nullable column on every table the thirteen legacy entries
 * create, a new table this build knows nothing about, and a partial
 * unique index over a column no current writer ever sets. It is passed
 * to `bringForward` directly, never appended to `SQLITE_MIGRATIONS`, so
 * every store this suite builds is planted as an installed identity
 * already brought forward to that tail would leave it: the tail's ids
 * are logged in `schema_migrations`, and its column, table and index sit
 * in the file.
 *
 * Every current writer and every current reader is then run over that
 * store through its own module, exactly as `rafa effort collect` and the
 * task-report pipeline call it, never through a synthetic tail of its
 * own. `planSchema` (`schema-plan.ts`) answers `pending: []` for such an
 * open, since every id this build's own catalogue names is already
 * logged, so the open neither adopts nor applies anything and takes no
 * lock; `bring-forward.test.ts` covers that plan directly. What this
 * suite measures is downstream of it: that a writer's `INSERT` and a
 * reader's `SELECT`, each naming its own columns, never see the tail's
 * column, table or index at all, so a store a newer rafa has migrated
 * keeps working for this rafa's own reads and writes until this rafa is
 * itself replaced.
 *
 * One store per case, fresh under a temporary repo root, so a write in
 * one case can never read back a row another left behind.
 */
import type { SqliteMigration } from './migrations.js';
import type { CommitEffortRow, SessionEffortRow } from './types.js';
import type { PrerequisiteItem } from '../../config.js';
import type { IssueRef } from '../../ports/index.js';
import type { PreflightCheck } from '../../preflight/run.js';
import type {
  ReportBlocker,
  ReportBug,
  ReportChange,
  ReportFinding,
} from '../../report/parse.js';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readProgressFindings, writeProgress } from '../../utils/progress.js';
import { readSkillFacts } from '../skill-facts.js';

import { writeReportAbsence } from './absences.js';
import { bringForward } from './bring-forward.js';
import { readPlanChanges, writeChanges } from './changes.js';
import { readSessionBudgets, writeDispatch } from './dispatches.js';
import { type FindingsDispatch, writeFindings } from './findings.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { type PlanCiRow, readPlanCi, writePlanCi } from './plan-ci.js';
import { readPreflightHalts, writePreflightChecks } from './preflight.js';
import { readReportedSkills, readTaskReportTallies, writeTaskReport } from './reports.js';
import { readSkillInvocations, writeSkillInvocations } from './skill-invocations.js';
import { openSqliteStore, sqliteStorePath } from './sqlite.js';
import { readTaskFinishes } from './task-finishes.js';
import { readTrackerRef, writeTrackerRef } from './tracker-refs.js';
import { writeTriage } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-forward-compat-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Every table the thirteen legacy migrations create. */
const EXISTING_TABLES = [
  'sessions', 'commits', 'findings', 'blockers', 'out_of_scope_bugs',
  'report_absences', 'task_reports', 'preflight', 'dispatches',
  'changes', 'skill_invocations', 'plan_ci',
] as const;

/** The nullable column the synthetic tail adds to every legacy table. */
const FIXTURE_COLUMN = 'fixture_note';

/** A new nullable column on every legacy table, in one migration. */
const FIXTURE_COLUMNS: SqliteMigration = {
  id: 'fixture-forward-compat-columns',
  breaks: [],
  sql: EXISTING_TABLES.map((table) => `ALTER TABLE ${table} ADD COLUMN ${FIXTURE_COLUMN} TEXT;`).join('\n'),
};

/** A table no current writer or reader knows about. */
const FIXTURE_TABLE: SqliteMigration = {
  id: 'fixture-forward-compat-table',
  breaks: [],
  sql: `
    CREATE TABLE fixture_widgets (
      seq        INTEGER PRIMARY KEY,
      session_id TEXT,
      note       TEXT
    );
  `,
};

/**
 * A partial unique index over the tail's own column: no current writer
 * ever sets it, so every row this build inserts leaves it NULL and the
 * index never sees a conflict.
 */
const FIXTURE_INDEX: SqliteMigration = {
  id: 'fixture-forward-compat-index',
  breaks: [],
  sql: `
    CREATE UNIQUE INDEX dispatches_by_fixture_note
      ON dispatches (${FIXTURE_COLUMN})
      WHERE ${FIXTURE_COLUMN} IS NOT NULL;
  `,
};

/** This build's catalogue, with the synthetic additive tail appended. */
const TAIL_MIGRATIONS: readonly SqliteMigration[] = [
  ...SQLITE_MIGRATIONS,
  FIXTURE_COLUMNS,
  FIXTURE_TABLE,
  FIXTURE_INDEX,
];

let rootCount = 0;

/**
 * A fresh repo root under the temporary directory, its store already
 * brought to `TAIL_MIGRATIONS`, as an installed identity ahead of this
 * build would leave it. Every writer and reader below opens it by
 * `repoRoot` alone, through its own module, never through a store this
 * helper hands back open.
 */
function buildTailedStore(): string {
  rootCount += 1;
  const repoRoot = join(tempBase, `repo-${String(rootCount)}`);
  const path = sqliteStorePath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: TAIL_MIGRATIONS, appliedBy: '0.99.0+a-newer-rafa' });
  } finally {
    db.close();
  }
  return repoRoot;
}

/** The names `sqlite_master` holds for one type, in a fresh connection. */
function namesOf(path: string, type: 'table' | 'index'): readonly string[] {
  const db = new Database(path, { readwrite: true });
  try {
    return db
      .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name')
      .all(type)
      .map(({ name }) => name);
  } finally {
    db.close();
  }
}

/** The columns `table` holds, in a fresh connection. */
function columnsOf(path: string, table: string): readonly string[] {
  const db = new Database(path, { readwrite: true });
  try {
    return db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map(({ name }) => name);
  } finally {
    db.close();
  }
}

describe('the synthetic tail', () => {
  it('adds a nullable column to every legacy table, a new table and a partial unique index', () => {
    const repoRoot = buildTailedStore();
    const path = sqliteStorePath(repoRoot);

    expect(namesOf(path, 'table')).toContain('fixture_widgets');
    expect(namesOf(path, 'index')).toContain('dispatches_by_fixture_note');
    for (const table of EXISTING_TABLES) {
      expect(columnsOf(path, table)).toContain(FIXTURE_COLUMN);
    }
  });
});

describe('the kind rows: append, keys and read', () => {
  it('appends and reads sessions and commits, unaffected by the tail', () => {
    const repoRoot = buildTailedStore();
    const store = openSqliteStore(repoRoot);
    const session = { sessionId: 'aaaa-1111', assistantRecordCount: 3 } as unknown as SessionEffortRow;
    const commit = { sha: 'deadbeef', insertions: 4 } as unknown as CommitEffortRow;

    const appended = store.append('sessions', [session]);
    store.append('commits', [commit]);

    expect(appended).toEqual({ path: sqliteStorePath(repoRoot), appended: 1, skipped: 0 });
    expect(store.read('sessions')).toEqual([session]);
    expect(store.read('commits')).toEqual([commit]);
    expect(store.keys('sessions')).toEqual(new Set(['aaaa-1111']));
  });
});

describe('dispatches: writeDispatch and readSessionBudgets', () => {
  it('records a dispatch with every optional field, and reads its budget back', () => {
    const repoRoot = buildTailedStore();

    const result = writeDispatch(repoRoot, {
      sessionId: 'session-dispatch',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
      declaration: { raw: '{budget=5}', agent: null, model: null, effort: null, budget: 5, tools: null },
      flags: ['--budget', '5'],
      resolver: 'tag',
      skillsOffered: ['tdd-workflow'],
      lessonsOffered: [],
    }, { now: () => new Date('2026-09-28T12:00:00.000Z') });

    expect(result).toEqual({ path: sqliteStorePath(repoRoot), appended: 1, skipped: 0 });
    expect(readSessionBudgets(repoRoot)).toEqual([
      { sessionId: 'session-dispatch', planStub: 'rafa-234', taskLine: 'Add the forward-compat suite', budgetUsd: 5 },
    ]);
  });
});

describe('tracker refs: writeTrackerRef and readTrackerRef', () => {
  it('inserts a findings row holding the reference, and reads it back by artifact', () => {
    const repoRoot = buildTailedStore();
    const ref: IssueRef = { opt: 42, kind: 'github', externalId: '99', url: 'https://example.com/99' };

    const result = writeTrackerRef(repoRoot, {
      dispatch: { sessionId: 'session-tracker', planStub: 'rafa-234', taskLine: 'Add the forward-compat suite' },
      outcome: 'done',
      artifact: 'forward-compat: exit 1',
      ref,
    }, { now: () => new Date('2026-09-28T12:00:00.000Z') });

    expect(result.action).toBe('inserted');
    expect(readTrackerRef(repoRoot, 'forward-compat: exit 1')).toEqual(ref);
  });
});

/** A required item whose probe passes. */
const BUN_ITEM: PrerequisiteItem = Object.freeze({ kind: 'tool', name: 'bun', probe: 'bun --version' });

/** A required presence check on a variable the environment does not hold. */
const UNSET_ITEM: PrerequisiteItem = Object.freeze({ kind: 'env', name: 'UNSET_TOKEN', probe: null });

describe('preflight: writePreflightChecks and readPreflightHalts', () => {
  it('records a run\'s checks, and reads back the one that halted it', () => {
    const repoRoot = buildTailedStore();
    const passed: PreflightCheck = { tier: 'required', item: BUN_ITEM, outcome: 'pass', durationMs: 7, failure: null };
    const failed: PreflightCheck = {
      tier: 'required',
      item: UNSET_ITEM,
      outcome: 'fail',
      durationMs: 3,
      failure: 'presence check: UNSET_TOKEN is not set',
    };

    writePreflightChecks(repoRoot, { runId: 'run-forward-compat', checks: [passed, failed] }, {
      now: () => new Date('2026-09-28T12:00:00.000Z'),
    });

    expect(readPreflightHalts(repoRoot)).toEqual([{
      runId: 'run-forward-compat',
      collectedAt: '2026-09-28T12:00:00.000Z',
      checks: 2,
      failed: [{
        kind: 'env',
        item: 'UNSET_TOKEN',
        probe: null,
        outcome: 'fail',
        durationMs: 3,
        failure: 'presence check: UNSET_TOKEN is not set',
      }],
    }]);
  });
});

describe('skill invocations: writeSkillInvocations and readSkillInvocations', () => {
  it('records a session\'s uses, and reads them back', () => {
    const repoRoot = buildTailedStore();

    writeSkillInvocations(repoRoot, [{
      sessionId: 'session-skills',
      uses: [{ name: 'tdd-workflow', sidechain: false, count: 2 }],
    }]);

    expect(readSkillInvocations(repoRoot)).toEqual([
      { sessionId: 'session-skills', name: 'tdd-workflow', sidechain: false, count: 2 },
    ]);
  });
});

describe('changes: writeChanges and readPlanChanges', () => {
  it('records a report\'s change note, and reads it back under its plan', () => {
    const repoRoot = buildTailedStore();
    const dispatch: FindingsDispatch = {
      sessionId: 'session-changes',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
    };
    const change: ReportChange = { level: 'patch', area: null, summary: 'Add the forward-compat suite', extras: [] };

    writeChanges(repoRoot, { dispatch, changes: [change] }, { now: () => new Date('2026-09-28T12:00:00.000Z') });

    expect(readPlanChanges(repoRoot, 'rafa-234')).toEqual([{
      sessionId: 'session-changes',
      taskLine: 'Add the forward-compat suite',
      level: 'patch',
      area: null,
      summary: 'Add the forward-compat suite',
      collectedAt: '2026-09-28T12:00:00.000Z',
    }]);
  });
});

describe('report absences and task reports, joined by readTaskFinishes', () => {
  it('records a report and an absence for one plan, and reads both finishes back', () => {
    const repoRoot = buildTailedStore();
    const reportDispatch: FindingsDispatch = {
      sessionId: 'session-report',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
    };
    const absentDispatch: FindingsDispatch = {
      sessionId: 'session-absent',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
    };

    writeTaskReport(repoRoot, {
      dispatch: reportDispatch,
      outcome: 'done',
      report: { status: 'done', skillsUsed: ['tdd-workflow'] },
    }, { now: () => new Date('2026-09-28T12:00:00.000Z') });

    writeReportAbsence(repoRoot, {
      dispatch: absentDispatch,
      outcome: 'done',
      absence: { present: false, reason: 'no-block', block: null, text: 'the output held no rafa:report block' },
    }, { now: () => new Date('2026-09-28T12:05:00.000Z') });

    expect(readTaskReportTallies(repoRoot)).toEqual([
      { planStub: 'rafa-234', status: 'done', outcome: 'done', reports: 1 },
    ]);
    expect(readReportedSkills(repoRoot)).toEqual([{
      sessionId: 'session-report',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
      outcome: 'done',
      skillsUsed: ['tdd-workflow'],
    }]);
    expect(readTaskFinishes(repoRoot, { planStub: 'rafa-234', since: '2026-09-28T00:00:00.000Z' })).toEqual([
      '2026-09-28T12:00:00.000Z',
      '2026-09-28T12:05:00.000Z',
    ]);
  });
});

describe('findings: writeFindings, rendered by readProgressFindings and writeProgress', () => {
  it('records a finding, and renders it into progress.txt', () => {
    const repoRoot = buildTailedStore();
    const dispatch: FindingsDispatch = {
      sessionId: 'session-findings',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
    };
    const finding: ReportFinding = {
      trigger: 'when a store carries a synthetic additive tail',
      kind: 'pattern',
      what: 'every current writer and reader still works, naming its own columns',
      cause: null,
      resolution: null,
      artifact: null,
      signal: 'silent',
      domain: null,
      extras: [],
    };

    writeFindings(repoRoot, { dispatch, outcome: 'done', findings: [finding] });

    const rows = readProgressFindings(repoRoot, 'rafa-234');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ planStub: 'rafa-234', kind: 'pattern', trigger: finding.trigger, what: finding.what });

    const write = writeProgress(repoRoot, 'rafa-234');
    expect(write.rendered).toBe(1);
    expect(write.text).toContain(finding.what ?? '');
  });
});

describe('triage: writeTriage records blockers and out-of-scope bugs', () => {
  it('inserts one row per list, unaffected by the tail', () => {
    const repoRoot = buildTailedStore();
    const dispatch: FindingsDispatch = {
      sessionId: 'session-triage',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
    };
    const blocker: ReportBlocker = { what: 'a blocker the tail did not cause', artifact: null, extras: [] };
    const bug: ReportBug = { what: 'a bug the tail did not cause', artifact: null, security: false, extras: [] };

    const result = writeTriage(repoRoot, { dispatch, outcome: 'done', blockers: [blocker], outOfScopeBugs: [bug] });

    expect(result.blockers).toEqual({ appended: 1, skipped: 0, rejected: [] });
    expect(result.outOfScopeBugs).toEqual({ appended: 1, skipped: 0, rejected: [] });
  });
});

describe('plan CI: writePlanCi and readPlanCi', () => {
  it('records a reading, and reads it back under its plan', () => {
    const repoRoot = buildTailedStore();
    const row: PlanCiRow = {
      planStub: 'rafa-234',
      pr: 258,
      headSha: 'deadbeef',
      verdict: 'green',
      failing: [],
      readAt: '2026-09-28T12:00:00.000Z',
    };

    writePlanCi(repoRoot, row);

    expect(readPlanCi(repoRoot, 'rafa-234')).toEqual([row]);
  });
});

describe('skill facts: readSkillFacts joins every table across the tail', () => {
  it('assembles one fact row from the dispatch, the report, findings, blockers, invocations and plan CI', () => {
    const repoRoot = buildTailedStore();
    const dispatch: FindingsDispatch = {
      sessionId: 'session-facts',
      planStub: 'rafa-234',
      taskLine: 'Add the forward-compat suite',
    };
    const planCiRow: PlanCiRow = {
      planStub: 'rafa-234',
      pr: 258,
      headSha: 'deadbeef',
      verdict: 'green',
      failing: [],
      readAt: '2026-09-28T12:00:00.000Z',
    };

    writeDispatch(repoRoot, {
      sessionId: dispatch.sessionId,
      planStub: dispatch.planStub,
      taskLine: dispatch.taskLine,
      declaration: null,
      flags: [],
      resolver: 'tag',
      skillsOffered: ['tdd-workflow'],
      lessonsOffered: [],
    });
    writeTaskReport(repoRoot, {
      dispatch,
      outcome: 'done',
      report: { status: 'done', skillsUsed: ['tdd-workflow'] },
    });
    writeFindings(repoRoot, {
      dispatch,
      outcome: 'done',
      findings: [{
        trigger: 'when running the forward-compat suite',
        kind: 'pattern',
        what: 'the tail is inert to every writer',
        cause: null,
        resolution: null,
        artifact: null,
        signal: 'silent',
        domain: null,
        extras: [],
      }],
    });
    writeTriage(repoRoot, {
      dispatch,
      outcome: 'done',
      blockers: [{ what: 'a blocker', artifact: null, extras: [] }],
      outOfScopeBugs: [],
    });
    writeSkillInvocations(repoRoot, [{
      sessionId: dispatch.sessionId,
      uses: [{ name: 'tdd-workflow', sidechain: false, count: 1 }],
    }]);
    writePlanCi(repoRoot, planCiRow);

    const facts = readSkillFacts(repoRoot);
    expect(facts).toHaveLength(1);
    const [fact] = facts;
    expect(fact).toMatchObject({
      sessionId: 'session-facts',
      planStub: 'rafa-234',
      outcome: 'done',
      skillsUsed: ['tdd-workflow'],
      resolver: 'tag',
      skillsOffered: ['tdd-workflow'],
      lessonsOffered: [],
      invoked: [{ name: 'tdd-workflow', count: 1 }],
    });
    expect(fact?.findings).toHaveLength(1);
    expect(fact?.blockers).toEqual([{ what: 'a blocker', artifact: null }]);
    expect(fact?.planCi).toEqual([planCiRow]);
  });
});
