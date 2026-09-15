/**
 * Tests for the dispatch writer, its reader, and the migration that
 * creates their table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading of the table goes through `bun:sqlite` directly and
 * never through the module, save in the reader's own cases, so the
 * columns and the one-row-per-session rule are spelled here rather than
 * read off the code under test. Each write is built the way the loop
 * builds one: the declaration is `parseTaskDeclaration`'s answer over a
 * task line a plan could write, and the flags are what
 * `resolveDeclarationFlags` answered for it.
 *
 * Each refusal sits beside the write it was varied from, which the store
 * takes, so a writer refusing everything reddens.
 */
import type { DispatchWrite } from './dispatches.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { parseTaskDeclaration, resolveDeclarationFlags } from '../../utils/declaration.js';

import { readSessionBudgets, writeDispatch } from './dispatches.js';
import {
  migrateSchema,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_VERSION,
  sqliteStorePath,
} from './sqlite.js';

/** A dispatch row as the table holds it. */
interface StoredDispatch {
  seq: number;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  declaration: string | null;
  agent: string | null;
  model: string | null;
  effort: string | null;
  budget_usd: number | null;
  tools: string | null;
  flags: string;
  collected_at: string;
}

/** The table's columns, in order. */
const COLUMNS = [
  'seq',
  'session_id',
  'plan_stub',
  'task_line',
  'declaration',
  'agent',
  'model',
  'effort',
  'budget_usd',
  'tools',
  'flags',
  'collected_at',
];

/** Every table a store at the last version holds, by name. */
const TABLES = [
  'blockers',
  'commits',
  'dispatches',
  'findings',
  'out_of_scope_bugs',
  'preflight',
  'report_absences',
  'sessions',
  'task_reports',
];

/** The time every write here is stamped with. */
const WRITTEN_AT = '2026-09-15T12:00:00.000Z';

/** The clock every write here reads. */
const CLOCK = { now: () => new Date(WRITTEN_AT) };

/** The plan every write here is dispatched under. */
const STUB = 'phase-1-installable';

/** A task line declaring every recognised key, and a key the grammar keeps as an extra. */
const FULL_LINE = 'Add the module  {agent=loop-implementer model=opus effort=high budget=0.5 tools=Read,Bash skills=bun-testing}';

/** A lone high surrogate, built from its code unit. */
const LONE_HIGH = String.fromCharCode(0xd800);

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-dispatches-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A new repo root under {@link tempBase}, not yet created. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** Every row a query answers over the store under `root`, opened read-only. */
function rawQuery<T>(root: string, sql: string, ...params: string[]): T[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<T, string[]>(sql).all(...params);
  } finally {
    db.close();
  }
}

/** Every dispatch row under `root`, in append order. */
function rowsOf(root: string): StoredDispatch[] {
  return rawQuery<StoredDispatch>(root, 'SELECT * FROM dispatches ORDER BY seq');
}

/** Every table under `root`, by name. */
function tablesOf(root: string): string[] {
  const tables = rawQuery<{ name: string }>(root, 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name', 'table');
  return tables.map(({ name }) => name);
}

/**
 * The write the loop makes for `sessionId` dispatched on `line`: its text,
 * its declaration, and the flags it resolves to when no agent definition
 * declares an effort.
 */
function writeOf(sessionId: string, line: string, planStub: string | null = STUB): DispatchWrite {
  const { text, declaration } = parseTaskDeclaration(line);
  return {
    sessionId,
    planStub,
    taskLine: text,
    declaration,
    flags: resolveDeclarationFlags(declaration, () => false).args,
  };
}

describe('the dispatches table', () => {
  it('is created with its columns, in order, at the last version', () => {
    const root = freshRoot('columns');

    const result = writeDispatch(root, writeOf('s-1', 'Do it  {effort=low}'), CLOCK);

    expect(result).toEqual({ path: sqliteStorePath(root), appended: 1, skipped: 0 });
    expect(result.path.startsWith(`${tempBase}/`)).toBe(true);
    const columns = rawQuery<{ name: string }>(root, 'SELECT name FROM pragma_table_info(?) ORDER BY cid', 'dispatches');
    expect(columns.map(({ name }) => name)).toEqual(COLUMNS);
    expect(tablesOf(root)).toEqual(TABLES);
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-6 store forward, keeping the rows it holds', () => {
    const root = freshRoot('v6');
    mkdirSync(dirname(sqliteStorePath(root)), { recursive: true });
    const db = new Database(sqliteStorePath(root), { create: true, readwrite: true });
    migrateSchema(db, sqliteStorePath(root), SQLITE_MIGRATIONS.slice(0, 6));
    db.run(
      'INSERT INTO task_reports (id, session_id, task_line, status, outcome, collected_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['t-1', 's-0', 'A task', 'done', 'done', WRITTEN_AT],
    );
    db.close();

    // The control: the first six entries make every earlier table and no
    // dispatches table, so the table this write fills came from a later
    // entry, and was not added to a shipped one.
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'dispatches'));

    writeDispatch(root, writeOf('s-1', 'Do it'), CLOCK);

    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT id FROM task_reports')).toEqual([{ id: 't-1' }]);
    expect(rowsOf(root).map(({ session_id }) => session_id)).toEqual(['s-1']);
  });
});

describe('writeDispatch', () => {
  it('stores each declared value, and the flags that reached the CLI', () => {
    const root = freshRoot('full');

    writeDispatch(root, writeOf('s-1', FULL_LINE), CLOCK);

    expect(rowsOf(root)).toEqual([{
      seq: 1,
      session_id: 's-1',
      plan_stub: STUB,
      task_line: 'Add the module',
      declaration: '{agent=loop-implementer model=opus effort=high budget=0.5 tools=Read,Bash skills=bun-testing}',
      agent: 'loop-implementer',
      model: 'opus',
      effort: 'high',
      budget_usd: 0.5,
      tools: 'Read,Bash',
      flags: '["--agent","loop-implementer","--effort","high","--max-budget-usd","0.5"]',
      collected_at: WRITTEN_AT,
    }]);
  });

  it('stores a task with no declaration as no values and no flags', () => {
    const root = freshRoot('bare');

    writeDispatch(root, writeOf('s-1', 'Add the module', null), CLOCK);

    expect(rowsOf(root)).toEqual([{
      seq: 1,
      session_id: 's-1',
      plan_stub: null,
      task_line: 'Add the module',
      declaration: null,
      agent: null,
      model: null,
      effort: null,
      budget_usd: null,
      tools: null,
      flags: '[]',
      collected_at: WRITTEN_AT,
    }]);
  });

  it('stores a value the parser dropped as no value, keeping it in the block', () => {
    const root = freshRoot('dropped');

    writeDispatch(root, writeOf('s-1', 'Do it  {budget=$2 effort=low}'), CLOCK);

    const [row] = rowsOf(root);
    expect(row).toMatchObject({
      declaration: '{budget=$2 effort=low}',
      effort: 'low',
      budget_usd: null,
      flags: '["--effort","low"]',
    });
  });

  it('adds nothing for a session already recorded, keeping its first row', () => {
    const root = freshRoot('dedup');

    expect(writeDispatch(root, writeOf('s-1', 'Do it  {budget=1}'), CLOCK).appended).toBe(1);
    const again = writeDispatch(root, writeOf('s-1', 'Do it  {budget=2}'), CLOCK);
    const other = writeDispatch(root, writeOf('s-2', 'Do it  {budget=2}'), CLOCK);

    expect(again).toMatchObject({ appended: 0, skipped: 1 });
    expect(other).toMatchObject({ appended: 1, skipped: 0 });
    expect(rowsOf(root).map(({ session_id, budget_usd }) => [session_id, budget_usd])).toEqual([['s-1', 1], ['s-2', 2]]);
  });

  it('refuses a write it cannot store, opening nothing', () => {
    const good = writeOf('s-1', FULL_LINE);
    const declaration = good.declaration;
    if (declaration === null) throw new Error('the full line parsed to no declaration');
    const withDeclaration = (fields: Record<string, unknown>): DispatchWrite => (
      { ...good, declaration: { ...declaration, ...fields } } as unknown as DispatchWrite
    );
    const refused: readonly (readonly [string, DispatchWrite])[] = [
      ['an empty session id', { ...good, sessionId: '' }],
      ['a blank plan stub', { ...good, planStub: ' ' }],
      ['a task line holding a lone surrogate', { ...good, taskLine: `Add ${LONE_HIGH}` }],
      ['no declaration field at all', { ...good, declaration: undefined } as unknown as DispatchWrite],
      ['a blank block', withDeclaration({ raw: '' })],
      ['a blank agent', withDeclaration({ agent: '' })],
      ['a zero budget', withDeclaration({ budget: 0 })],
      ['a budget that is no number', withDeclaration({ budget: '0.5' })],
      ['an infinite budget', withDeclaration({ budget: Number.POSITIVE_INFINITY })],
      ['an empty tool list', withDeclaration({ tools: [] })],
      ['a tool name holding a comma', withDeclaration({ tools: ['Read,Bash'] })],
      ['flags that are not strings', { ...good, flags: [42] } as unknown as DispatchWrite],
    ];

    for (const [label, write] of refused) {
      const root = freshRoot('refused');
      expect(() => writeDispatch(root, write, CLOCK), label).toThrow(/^effort store: dispatch write .+; nothing written$/);
      expect(existsSync(root), label).toBe(false);
    }

    // The control: the write each refusal was varied from is stored.
    const root = freshRoot('refused-control');
    expect(writeDispatch(root, good, CLOCK).appended).toBe(1);
  });
});

describe('readSessionBudgets', () => {
  it('reads back the sessions dispatched with a budget, alone, in append order', () => {
    const root = freshRoot('budgets');
    writeDispatch(root, writeOf('s-1', 'Do it  {agent=doc-updater budget=0.25}'), CLOCK);
    writeDispatch(root, writeOf('s-2', 'Do it  {effort=low}'), CLOCK);
    writeDispatch(root, writeOf('s-3', 'Do it too  {budget=3}', null), CLOCK);

    expect(readSessionBudgets(root)).toEqual([
      { sessionId: 's-1', planStub: STUB, taskLine: 'Do it', budgetUsd: 0.25 },
      { sessionId: 's-3', planStub: null, taskLine: 'Do it too', budgetUsd: 3 },
    ]);
    expect(rowsOf(root)).toHaveLength(3);
  });

  it('reads none, and creates nothing, under a root with no store', () => {
    const root = freshRoot('absent');

    expect(readSessionBudgets(root)).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });
});
