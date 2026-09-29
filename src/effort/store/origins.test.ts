/**
 * `origins.ts` through every production writer under `src/effort/store/`:
 * the origin pair each one stamps, `seq` counting on across a new mint,
 * and a row an older runtime inserted with NULL origins read by every
 * reader of its table.
 *
 * Every store is a real file under `tmpdir()`, opened through the
 * writers' own `withSqliteStore` call. A store there sits outside any
 * repository with commits, so a writer's own open finds no project and
 * mints nothing (`store-meta.ts`). A case that needs a minted store
 * mints it first through `withSqliteStore` with the project and the
 * store id injected; the host id is left to the real reader, because
 * each writer's own open takes no seam and reads it too, and a mint
 * under an injected host would be minted again, under a random id, by
 * the first writer. No case reads or asserts the host id itself.
 *
 * Each reading goes through `bun:sqlite` on a connection of its own,
 * never through the module, so the columns are spelled here.
 */
import type { FindingsDispatch } from './findings.js';
import type { OriginTable } from './origins.js';
import type { SessionEffortRow, CommitEffortRow } from './types.js';
import type { ReportFinding } from '../../report/parse.js';

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readProgressFindings } from '../../utils/progress.js';
import { readSkillFacts } from '../skill-facts.js';

import { writeReportAbsence } from './absences.js';
import { readPlanChanges, writeChanges } from './changes.js';
import { readSessionBudgets, writeDispatch } from './dispatches.js';
import { writeFindings } from './findings.js';
import { ORIGIN_TABLES } from './origins.js';
import { readPlanCi, writePlanCi } from './plan-ci.js';
import { readPreflightHalts, writePreflightChecks } from './preflight.js';
import { readReportedSkills, readTaskReportTallies, writeTaskReport } from './reports.js';
import { readSkillInvocations, writeSkillInvocations } from './skill-invocations.js';
import { openSqliteStore, sqliteStorePath, withSqliteStore } from './sqlite.js';
import { readStoreMeta } from './store-meta.js';
import { readTaskFinishes } from './task-finishes.js';
import { readTrackerRef, writeTrackerRef } from './tracker-refs.js';
import { writeTriage } from './triage.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-origins-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const PLAN = 'phase-1';

const TASK_LINE = 'Add the module';

/** When every row in this file was written, before or after a copy. */
const WRITTEN_AT = new Date('2026-09-29T10:00:00.000Z');

/** The earliest time a finish is read from, before every row here. */
const SINCE = '2026-01-01T00:00:00.000Z';

let planted = 0;

/** A repo root of its own, not yet on disk. */
function freshRoot(name: string): string {
  planted += 1;
  return join(scope, `${String(planted)}-${name}`);
}

/**
 * Creates the store under `root` and mints `storeId` into it, the
 * project injected so no git runs. Throws unless the row holds it.
 */
function mint(root: string, storeId: string, create = true): void {
  const path = sqliteStorePath(root);
  withSqliteStore(path, 'write', create, () => undefined, {
    readProject: () => ({ rootCommit: 'a1b2c3d4', remote: null }),
    newStoreId: () => storeId,
    now: () => WRITTEN_AT,
  });
  const recorded = storeIdOf(root);
  if (recorded !== storeId) throw new Error(`the mint of ${path} recorded ${String(recorded)}, not ${storeId}`);
}

/** A fresh root whose store is minted as `storeId`. */
function mintedRoot(name: string, storeId: string): string {
  const root = freshRoot(name);
  mint(root, storeId);
  return root;
}

/** Runs `read` over the store under `root` on a read-only connection of its own. */
function readRaw<T>(root: string, read: (db: Database) => T): T {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** The store id the store under `root` records, or null when it records none. */
function storeIdOf(root: string): string | null {
  return readRaw(root, (db) => readStoreMeta(db)?.storeId ?? null);
}

/** One row's append order and origin pair. */
interface OriginRow {
  readonly seq: number;
  readonly origin_store: string | null;
  readonly origin_seq: number | null;
}

/** Every row of `table`'s append order and origin pair, in append order. */
function originsOf(root: string, table: OriginTable): OriginRow[] {
  return readRaw(root, (db) => db
    .query<OriginRow, []>(`SELECT seq, origin_store, origin_seq FROM ${table} ORDER BY seq`)
    .all());
}

/** The dispatch of task session `session` under {@link PLAN}. */
function dispatchOf(session: string): FindingsDispatch {
  return { sessionId: session, planStub: PLAN, taskLine: TASK_LINE };
}

/** A finding keyed by `artifact`. */
function findingOf(artifact: string): ReportFinding {
  return {
    trigger: 'when a store is copied',
    kind: 'gotcha',
    what: 'the copy stamps a new origin',
    cause: null,
    resolution: null,
    artifact,
    signal: 'loud',
    domain: null,
    extras: [],
  };
}

/** A fixed clock for every writer that takes one. */
const CLOCK = { now: () => WRITTEN_AT };

/** Ids unique across the file, for every writer that takes them. */
function seamsOf(session: string): { now: () => Date; newId: () => string } {
  let count = 0;
  return {
    ...CLOCK,
    newId: () => {
      count += 1;
      return `${session}-${String(count)}`;
    },
  };
}

/** Appends task session `session`'s row through the port. The cast is the plant. */
function appendSession(root: string, session: string): void {
  const row = { sessionId: session, assistantRecordCount: 1 } as unknown as SessionEffortRow;
  openSqliteStore(root).append('sessions', [row]);
}

/** One production writer, the tables it inserts into, and one write of task session `session`. */
interface WriterCase {
  readonly name: string;
  readonly tables: readonly OriginTable[];
  readonly write: (root: string, session: string) => void;
}

/** Every production insert under `src/effort/store/`, each through the writer that runs it. */
const WRITERS: readonly WriterCase[] = [
  {
    name: 'the port\'s append of a session',
    tables: ['sessions'],
    write: appendSession,
  },
  {
    name: 'the port\'s append of a commit',
    tables: ['commits'],
    write: (root, session) => {
      const row = { sha: `sha-${session}`, insertions: 1 } as unknown as CommitEffortRow;
      openSqliteStore(root).append('commits', [row]);
    },
  },
  {
    name: 'writeFindings',
    tables: ['findings'],
    write: (root, session) => {
      const write = { dispatch: dispatchOf(session), outcome: 'done' as const, findings: [findingOf(`finding-${session}`)] };
      writeFindings(root, write, seamsOf(`finding-${session}`));
    },
  },
  {
    name: 'writeTriage',
    tables: ['blockers', 'out_of_scope_bugs'],
    write: (root, session) => {
      writeTriage(root, {
        dispatch: dispatchOf(session),
        outcome: 'blocked',
        blockers: [{ what: 'the fixture is missing', artifact: null, extras: [] }],
        outOfScopeBugs: [{ what: 'the helper drops a row', artifact: null, security: false, extras: [] }],
      }, seamsOf(`triage-${session}`));
    },
  },
  {
    name: 'writeReportAbsence',
    tables: ['report_absences'],
    write: (root, session) => {
      writeReportAbsence(root, {
        dispatch: dispatchOf(`${session}-absent`),
        outcome: 'done',
        absence: { present: false, reason: 'no-block', block: null, text: 'The output holds no rafa:report block.' },
      }, seamsOf(`absence-${session}`));
    },
  },
  {
    name: 'writeTaskReport',
    tables: ['task_reports'],
    write: (root, session) => {
      writeTaskReport(root, {
        dispatch: dispatchOf(session),
        outcome: 'done',
        report: { status: 'done', skillsUsed: ['bun-testing'] },
      }, seamsOf(`report-${session}`));
    },
  },
  {
    name: 'writePreflightChecks',
    tables: ['preflight'],
    write: (root, session) => {
      writePreflightChecks(root, {
        runId: `run-${session}`,
        checks: [{
          tier: 'required',
          item: { kind: 'env', name: 'UNSET_TOKEN', probe: null },
          outcome: 'fail',
          durationMs: 3,
          failure: 'presence check: UNSET_TOKEN is not set',
        }],
      }, CLOCK);
    },
  },
  {
    name: 'writeDispatch',
    tables: ['dispatches'],
    write: (root, session) => {
      writeDispatch(root, {
        sessionId: session,
        planStub: PLAN,
        taskLine: TASK_LINE,
        declaration: { raw: '{budget=0.5}', agent: null, model: null, effort: null, budget: 0.5, tools: null },
        flags: ['--max-budget-usd', '0.5'],
        resolver: 'tag',
        skillsOffered: ['bun-testing'],
        lessonsOffered: [],
      }, CLOCK);
    },
  },
  {
    name: 'writeChanges',
    tables: ['changes'],
    write: (root, session) => {
      writeChanges(root, {
        dispatch: dispatchOf(session),
        changes: [{ level: 'patch', area: null, summary: `the ${session} change`, extras: [] }],
      }, seamsOf(`change-${session}`));
    },
  },
  {
    name: 'writeSkillInvocations',
    tables: ['skill_invocations'],
    write: (root, session) => {
      writeSkillInvocations(root, [{ sessionId: session, uses: [{ name: 'bun-testing', sidechain: false, count: 2 }] }]);
    },
  },
  {
    name: 'writePlanCi',
    tables: ['plan_ci'],
    write: (root, session) => {
      writePlanCi(root, { planStub: PLAN, pr: 7, headSha: `sha-${session}`, verdict: 'green', failing: [], readAt: WRITTEN_AT.toISOString() });
    },
  },
  {
    name: 'writeTrackerRef, inserting the row it sets the reference on',
    tables: ['findings'],
    write: (root, session) => {
      writeTrackerRef(root, {
        dispatch: dispatchOf(session),
        outcome: 'done',
        artifact: `issue-${session}`,
        ref: { opt: 0, kind: 'local', externalId: '1', url: null },
      }, seamsOf(`ref-${session}`));
    },
  },
];

describe('every production insert stamps the store\'s origin', () => {
  it('covers each of the twelve tables a merge unions', () => {
    const covered = new Set(WRITERS.flatMap(({ tables }) => tables));

    expect([...covered].sort()).toEqual([...ORIGIN_TABLES].sort());
  });

  it.each(WRITERS.map((writer) => [writer.name, writer] as const))('%s stamps the minted origin and each row\'s own seq', (_, writer) => {
    const root = mintedRoot('stamped', 'store-a');

    writer.write(root, 's-1');
    writer.write(root, 's-2');

    for (const table of writer.tables) {
      const rows = originsOf(root, table);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(rows.map(({ seq }) => ({ seq, origin_store: 'store-a', origin_seq: seq })));
    }
    expect(storeIdOf(root)).toBe('store-a');
  });

  it.each(WRITERS.map((writer) => [writer.name, writer] as const))('%s stamps neither column on a store with no origin, and seq still counts', (_, writer) => {
    const root = freshRoot('unminted');

    writer.write(root, 's-1');
    writer.write(root, 's-2');

    expect(storeIdOf(root)).toBeNull();
    for (const table of writer.tables) {
      expect(originsOf(root, table)).toEqual([
        { seq: 1, origin_store: null, origin_seq: null },
        { seq: 2, origin_store: null, origin_seq: null },
      ]);
    }
  });
});

describe('seq across a new mint', () => {
  /** A copy of the store under `from`, under a root of its own, minted as `storeId`. */
  function copiedRoot(from: string, storeId: string): string {
    const root = freshRoot('copy');
    const path = sqliteStorePath(root);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(sqliteStorePath(from), path);
    mint(root, storeId, false);
    return root;
  }

  it('keeps counting seq from the copied rows, under the copy\'s new origin', () => {
    const original = mintedRoot('original', 'store-a');
    writeFindings(original, { dispatch: dispatchOf('s-1'), outcome: 'done', findings: [findingOf('one'), findingOf('two')] }, seamsOf('before'));

    const copy = copiedRoot(original, 'store-b');
    writeFindings(copy, { dispatch: dispatchOf('s-2'), outcome: 'done', findings: [findingOf('three')] }, seamsOf('copy'));
    writeFindings(original, { dispatch: dispatchOf('s-3'), outcome: 'done', findings: [findingOf('three')] }, seamsOf('after'));

    const shared = [
      { seq: 1, origin_store: 'store-a', origin_seq: 1 },
      { seq: 2, origin_store: 'store-a', origin_seq: 2 },
    ];
    expect(originsOf(copy, 'findings')).toEqual([...shared, { seq: 3, origin_store: 'store-b', origin_seq: 3 }]);
    expect(originsOf(original, 'findings')).toEqual([...shared, { seq: 3, origin_store: 'store-a', origin_seq: 3 }]);
  });

  it('counts on in the port\'s tables too', () => {
    const original = mintedRoot('original-port', 'store-a');
    appendSession(original, 's-1');

    const copy = copiedRoot(original, 'store-b');
    appendSession(copy, 's-2');

    expect(originsOf(copy, 'sessions')).toEqual([
      { seq: 1, origin_store: 'store-a', origin_seq: 1 },
      { seq: 2, origin_store: 'store-b', origin_seq: 2 },
    ]);
  });
});

/**
 * One row for each of the twelve tables as a runtime before `row-origins`
 * inserts it: every column it knew named, the origin columns left out,
 * all under task session `old` (its absence under `old-absent`) and
 * {@link PLAN}, each shaped for the reader of its table to answer it.
 */
const PLANTED: readonly (readonly [OriginTable, string])[] = [
  ['sessions', 'INSERT INTO sessions (session_id, row_json) VALUES (\'old\', \'{"sessionId":"old","assistantRecordCount":1}\')'],
  ['commits', 'INSERT INTO commits (sha, row_json) VALUES (\'sha-old\', \'{"sha":"sha-old","insertions":1}\')'],
  ['findings', 'INSERT INTO findings (id, session_id, plan_stub, task_line, kind, trigger, what, cause, resolution, artifact, signal, outcome, tracker_ref, collected_at)'
    + ' VALUES (\'f-old\', \'old\', \'phase-1\', \'Add the module\', \'gotcha\', \'when an old runtime writes\', \'the row has no origin\', NULL, NULL, \'issue-old\', \'silent\', \'done\','
    + ' \'{"opt":0,"kind":"local","externalId":"9","url":null}\', \'2026-09-28T10:00:00.000Z\')'],
  ['blockers', 'INSERT INTO blockers (id, session_id, plan_stub, task_line, what, artifact, outcome, collected_at)'
    + ' VALUES (\'b-old\', \'old\', \'phase-1\', \'Add the module\', \'an old blocker\', NULL, \'blocked\', \'2026-09-28T10:00:00.000Z\')'],
  ['out_of_scope_bugs', 'INSERT INTO out_of_scope_bugs (id, session_id, plan_stub, task_line, what, artifact, security, scope, outcome, collected_at)'
    + ' VALUES (\'o-old\', \'old\', \'phase-1\', \'Add the module\', \'an old bug\', NULL, 0, \'rafa\', \'blocked\', \'2026-09-28T10:00:00.000Z\')'],
  ['report_absences', 'INSERT INTO report_absences (id, session_id, plan_stub, task_line, reason, detail, block_body, outcome, collected_at)'
    + ' VALUES (\'a-old\', \'old-absent\', \'phase-1\', \'Add the module\', \'no-block\', \'The output holds no rafa:report block.\', NULL, \'done\', \'2026-09-28T10:00:00.000Z\')'],
  ['task_reports', 'INSERT INTO task_reports (id, session_id, plan_stub, task_line, status, outcome, collected_at, skills_used)'
    + ' VALUES (\'r-old\', \'old\', \'phase-1\', \'Add the module\', \'done\', \'done\', \'2026-09-28T10:00:00.000Z\', \'["old-skill"]\')'],
  ['preflight', 'INSERT INTO preflight (run_id, position, tier, kind, item, probe, outcome, duration_ms, failure, collected_at)'
    + ' VALUES (\'run-old\', 0, \'required\', \'env\', \'OLD_TOKEN\', NULL, \'fail\', 4, \'presence check: OLD_TOKEN is not set\', \'2026-09-28T10:00:00.000Z\')'],
  ['dispatches', 'INSERT INTO dispatches (session_id, plan_stub, task_line, declaration, agent, model, effort, budget_usd, tools, flags, resolver, skills_offered, lessons_offered, collected_at)'
    + ' VALUES (\'old\', \'phase-1\', \'Add the module\', \'{budget=2}\', NULL, NULL, NULL, 2, NULL, \'[]\', \'planner\', \'["old-skill"]\', NULL, \'2026-09-28T10:00:00.000Z\')'],
  ['changes', 'INSERT INTO changes (id, session_id, plan_stub, task_line, level, area, summary, collected_at)'
    + ' VALUES (\'c-old\', \'old\', \'phase-1\', \'Add the module\', \'minor\', NULL, \'the old change\', \'2026-09-28T10:00:00.000Z\')'],
  ['skill_invocations', 'INSERT INTO skill_invocations (session_id, name, sidechain, count) VALUES (\'old\', \'old-skill\', 1, 3)'],
  ['plan_ci', 'INSERT INTO plan_ci (plan_stub, pr, head_sha, verdict, failing, read_at)'
    + ' VALUES (\'phase-1\', 6, \'sha-old\', \'red\', \'["lint"]\', \'2026-09-28T10:00:00.000Z\')'],
];

describe('a row planted with NULL origins', () => {
  /**
   * A store minted as `store-a` holding, in each table, the planted row
   * first and then the rows every writer stamps for session `new`.
   */
  function mixedRoot(): string {
    const root = mintedRoot('mixed', 'store-a');
    const db = new Database(sqliteStorePath(root), { readwrite: true });
    try {
      for (const [, sql] of PLANTED) db.run(sql);
    } finally {
      db.close();
    }
    for (const writer of WRITERS) writer.write(root, 'new');
    return root;
  }

  const root = mixedRoot();

  it('sits beside stamped rows in every table, NULL in both columns', () => {
    for (const table of ORIGIN_TABLES) {
      const rows = originsOf(root, table);
      expect(rows[0]).toEqual({ seq: 1, origin_store: null, origin_seq: null });
      expect(rows.slice(1).length).toBeGreaterThan(0);
      expect(rows.slice(1)).toEqual(rows.slice(1).map(({ seq }) => ({ seq, origin_store: 'store-a', origin_seq: seq })));
    }
    expect(PLANTED.map(([table]) => table)).toEqual([...ORIGIN_TABLES]);
  });

  it('is read by the port\'s read and keys', () => {
    const store = openSqliteStore(root);

    expect(store.read('sessions').map((row) => row.sessionId)).toEqual(['old', 'new']);
    expect([...store.keys('sessions')]).toEqual(['old', 'new']);
    expect(store.read('commits').map((row) => row.sha)).toEqual(['sha-old', 'sha-new']);
    expect([...store.keys('commits')]).toEqual(['sha-old', 'sha-new']);
  });

  it('is read by readTrackerRef and readProgressFindings', () => {
    expect(readTrackerRef(root, 'issue-old')).toEqual({ opt: 0, kind: 'local', externalId: '9', url: null });
    expect(readTrackerRef(root, 'issue-new')).toEqual({ opt: 0, kind: 'local', externalId: '1', url: null });
    expect(readProgressFindings(root, PLAN).map(({ artifact }) => artifact)).toEqual(['issue-new', 'finding-new', 'issue-old']);
  });

  it('is read by readSessionBudgets', () => {
    expect(readSessionBudgets(root).map(({ sessionId, budgetUsd }) => [sessionId, budgetUsd])).toEqual([['old', 2], ['new', 0.5]]);
  });

  it('is read by readTaskReportTallies, readReportedSkills and readTaskFinishes', () => {
    expect(readTaskReportTallies(root)).toEqual([{ planStub: PLAN, status: 'done', outcome: 'done', reports: 2 }]);
    expect(readReportedSkills(root).map(({ sessionId, skillsUsed }) => [sessionId, skillsUsed])).toEqual([
      ['old', ['old-skill']],
      ['new', ['bun-testing']],
    ]);
    expect(readTaskFinishes(root, { planStub: PLAN, since: SINCE })).toEqual([
      '2026-09-28T10:00:00.000Z',
      '2026-09-28T10:00:00.000Z',
      WRITTEN_AT.toISOString(),
      WRITTEN_AT.toISOString(),
    ]);
  });

  it('is read by readPreflightHalts', () => {
    expect(readPreflightHalts(root).map(({ runId, checks }) => [runId, checks])).toEqual([['run-old', 1], ['run-new', 1]]);
  });

  it('is read by readPlanChanges', () => {
    expect(readPlanChanges(root, PLAN).map(({ summary }) => summary)).toEqual(['the old change', 'the new change']);
  });

  it('is read by readSkillInvocations', () => {
    expect(readSkillInvocations(root)).toEqual([
      { sessionId: 'old', name: 'old-skill', sidechain: true, count: 3 },
      { sessionId: 'new', name: 'bun-testing', sidechain: false, count: 2 },
    ]);
  });

  it('is read by readPlanCi', () => {
    expect(readPlanCi(root).map(({ headSha, verdict }) => [headSha, verdict])).toEqual([['sha-old', 'red'], ['sha-new', 'green']]);
  });

  it('is read by readSkillFacts, from dispatches, findings, blockers and bugs alike', () => {
    const facts = readSkillFacts(root).map((fact) => ({
      sessionId: fact.sessionId,
      resolver: fact.resolver,
      invoked: fact.invoked,
      findings: fact.findings.map(({ artifact }) => artifact),
      blockers: fact.blockers.map(({ what }) => what),
      outOfScopeBugs: fact.outOfScopeBugs.map(({ what }) => what),
      planCi: fact.planCi.length,
    }));

    expect(facts).toEqual([
      {
        sessionId: 'old',
        resolver: 'planner',
        invoked: [{ name: 'old-skill', count: 3 }],
        findings: ['issue-old'],
        blockers: ['an old blocker'],
        outOfScopeBugs: ['an old bug'],
        planCi: 2,
      },
      {
        sessionId: 'new',
        resolver: 'tag',
        invoked: [{ name: 'bun-testing', count: 2 }],
        findings: ['finding-new', 'issue-new'],
        blockers: ['the fixture is missing'],
        outOfScopeBugs: ['the helper drops a row'],
        planCi: 2,
      },
    ]);
  });
});

/** A production insert found in a module's source, and the table it names. */
interface FoundInsert {
  readonly file: string;
  readonly table: string;
  readonly stamped: boolean;
}

/** The placeholder a stamped insert's column list interpolates. */
const STAMP_PLACEHOLDER = ['${', 'STAMPED_COLUMNS', '}'].join('');

/** Every `INSERT INTO` in `source`, the table it names, and whether its column list holds the stamp. */
function insertsIn(file: string, source: string): FoundInsert[] {
  return [...source.matchAll(/INSERT (?:OR \w+ )?INTO (\S+) \(([^)]*)\)/g)].map((match) => ({
    file,
    table: match[1] ?? '',
    stamped: (match[2] ?? '').includes(STAMP_PLACEHOLDER),
  }));
}

describe('the production inserts, read from source', () => {
  const modules = readdirSync(import.meta.dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const found = modules.flatMap((name) => insertsIn(name, readFileSync(join(import.meta.dir, name), 'utf8')));

  it('stamps every insert into a merged table, and leaves the three bookkeeping ones alone', () => {
    const unstamped = found.filter(({ stamped }) => !stamped).map(({ file, table }) => `${file}: ${table}`);

    const stamped = found.filter((insert) => insert.stamped).map(({ file }) => file);

    expect([...stamped].sort()).toEqual([
      'absences.ts', 'changes.ts', 'dispatches.ts', 'findings.ts', 'plan-ci.ts', 'preflight.ts',
      'reports.ts', 'skill-invocations.ts', 'sqlite.ts', 'tracker-refs.ts', 'triage.ts', 'triage.ts',
    ]);
    expect(unstamped.sort()).toEqual([
      ['bring-forward.ts: ', '${', 'MIGRATION_LOG_TABLE}'].join(''),
      ['fix-schema.ts: main.', '${', 'quoted(table)}'].join(''),
      'store-meta.ts: store_meta',
    ]);
  });

  it('reads an insert whose column list lacks the stamp as unstamped (control)', () => {
    const source = 'const SQL = `INSERT INTO findings (id, session_id) VALUES (?, ?)`;';

    expect(insertsIn('planted.ts', source)).toEqual([{ file: 'planted.ts', table: 'findings', stamped: false }]);
  });
});
