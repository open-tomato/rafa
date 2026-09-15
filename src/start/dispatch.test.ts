/**
 * Tests for `storeTaskReport` (`start/dispatch.ts`) storing a session's
 * dispatch ahead of its report: one `dispatches` row holding what the task
 * declared and the flags its session was spawned with, whatever became of
 * the task, and no report at all when that row is refused.
 *
 * The rest of the module is driven elsewhere: the prompt and the flags in
 * `tests/declaration-dispatch.test.ts`, the session id and the report rows
 * in `tests/task-report.test.ts`. Every store here sits under a fresh root
 * in this file's temporary directory and is read back through `bun:sqlite`
 * directly. The lines the loop prints go to a sink output set for each
 * case and unset after it.
 */
import type { TaskReportStoreOptions } from './dispatch.js';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { parseTaskDeclaration, resolveDeclarationFlags } from '../utils/declaration.js';

import { storeTaskReport } from './dispatch.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A session output ending with a clean `done` report. */
const REPORTED = [
  'Done.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "it went fine"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  FENCE,
  '',
].join('\n');

/** The task line every case dispatches, its budget declared beside an agent. */
const LINE = 'Add the module  {agent=loop-implementer budget=0.5}';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-dispatch-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A new repo root under {@link tempRoot}, not yet created. */
function freshRoot(): string {
  planted += 1;
  return join(tempRoot, `root-${planted}`);
}

/** Every row a query answers over the store under `root`, opened read-only. */
function rawQuery<T>(root: string, sql: string): T[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}

/** What `start()` hands `storeTaskReport` for session `sessionId` on {@link LINE}. */
function storeOptions(
  root: string,
  sessionId: string,
  output: string,
  outcome: TaskReportStoreOptions['outcome'],
): TaskReportStoreOptions {
  const { text, declaration } = parseTaskDeclaration(LINE);
  return {
    repoRoot: root,
    planStub: 'demo',
    dispatch: {
      sessionId,
      taskText: text,
      output,
      declaration,
      flags: resolveDeclarationFlags(declaration, () => false).args,
    },
    outcome,
  };
}

describe('storeTaskReport, storing the dispatch', () => {
  let seen: string[] = [];

  beforeEach(() => {
    seen = [];
    setActiveOutput(sinkOutput({ error: (message) => seen.push(`error:${message}`) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('stores the dispatch beside the report, under the same session id', () => {
    const root = freshRoot();

    expect(storeTaskReport(storeOptions(root, 's-1', REPORTED, 'done'))).toBe(true);

    expect(rawQuery(root, 'SELECT session_id, plan_stub, task_line, agent, budget_usd, flags FROM dispatches')).toEqual([{
      session_id: 's-1',
      plan_stub: 'demo',
      task_line: 'Add the module',
      agent: 'loop-implementer',
      budget_usd: 0.5,
      flags: '["--agent","loop-implementer","--max-budget-usd","0.5"]',
    }]);
    expect(rawQuery(root, 'SELECT session_id, status, outcome FROM task_reports')).toEqual([
      { session_id: 's-1', status: 'done', outcome: 'done' },
    ]);
    expect(seen).toEqual([]);
  });

  it('stores the dispatch of a session that ended on its budget and left no report', () => {
    const root = freshRoot();

    expect(storeTaskReport(storeOptions(root, 's-2', 'Error: Exceeded USD budget (0.5)', 'blocked'))).toBe(true);

    expect(rawQuery(root, 'SELECT session_id, budget_usd FROM dispatches')).toEqual([{ session_id: 's-2', budget_usd: 0.5 }]);
    expect(rawQuery(root, 'SELECT session_id, outcome FROM report_absences')).toEqual([{ session_id: 's-2', outcome: 'blocked' }]);
    expect(rawQuery(root, 'SELECT session_id FROM task_reports')).toEqual([]);
  });

  it('stores no report when the dispatch row is refused, and answers false', () => {
    const root = freshRoot();
    const options = storeOptions(root, 's-3', REPORTED, 'done');
    const { declaration } = options.dispatch;
    if (declaration === null) throw new Error('the fixture line parsed to no declaration');
    const refused = { ...options, dispatch: { ...options.dispatch, declaration: { ...declaration, budget: 0 } } };

    expect(storeTaskReport(refused)).toBe(false);

    expect(existsSync(root)).toBe(false);
    expect(seen).toEqual([
      'error:\n❌ The report of session s-3 was not stored: effort store: dispatch write has budget 0, not null or a finite number above zero; nothing written',
      'error:   The session printed it above as it ran.',
    ]);
  });
});
