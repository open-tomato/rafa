/**
 * Tests for `ddl.ts`: the whitelist holds the seven PoC buckets and the six
 * of the git, GitHub, board and module sources and nothing else, refuses
 * every name that is not one of its own keys, and each statement creates
 * the table it is keyed by.
 */
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { isReplicaTable, META_TABLES, REPLICA_TABLES, replicaDdl } from './ddl.js';

const POC_BUCKETS = ['task_facts', 'plan_facts', 'daily_rollup', 'bug_facts', 'finding_facts', 'change_facts',
  'ci_facts'];

const SOURCE_BUCKETS = ['commit_facts', 'pr_facts', 'issue_facts', 'board_snapshot', 'module_facts',
  'stretch_marks'];

const BUCKETS = [...POC_BUCKETS, ...SOURCE_BUCKETS];

/** The columns of `table` in a fresh in-memory replica, in order. */
function columnsOf(table: string): string[] {
  const database = new Database(':memory:');
  try {
    for (const statement of replicaDdl()) database.run(statement);
    return database
      .query<{ readonly name: string }, [string]>('SELECT name FROM pragma_table_info(?) ORDER BY cid')
      .all(table)
      .map((row) => row.name);
  } finally {
    database.close();
  }
}

/** The primary key columns of `table` in a fresh in-memory replica, in key order. */
function primaryKeyOf(table: string): string[] {
  const database = new Database(':memory:');
  try {
    for (const statement of replicaDdl()) database.run(statement);
    return database
      .query<{ readonly name: string }, [string]>('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk')
      .all(table)
      .map((row) => row.name);
  } finally {
    database.close();
  }
}

describe('REPLICA_TABLES', () => {
  it('holds the seven buckets of the PoC, then the six of the new sources, and not the meta tables', () => {
    expect(Object.keys(REPLICA_TABLES)).toEqual(BUCKETS);
    expect(Object.keys(REPLICA_TABLES).slice(POC_BUCKETS.length)).toEqual(SOURCE_BUCKETS);
    expect(Object.keys(META_TABLES)).toEqual(['atlas_meta', 'atlas_sources']);
  });

  it('keys each statement by the table it creates', () => {
    const entries = [...Object.entries(META_TABLES), ...Object.entries(REPLICA_TABLES)];

    for (const [table, statement] of entries) {
      expect(statement.startsWith(`CREATE TABLE ${table} (`)).toBe(true);
    }
  });

  it('runs the meta tables first, then the buckets, in replicaDdl', () => {
    expect(replicaDdl()).toEqual([...Object.values(META_TABLES), ...Object.values(REPLICA_TABLES)]);
  });

  it('creates every table of replicaDdl in one database', () => {
    const database = new Database(':memory:');
    for (const statement of replicaDdl()) database.run(statement);
    const tables = database
      .query<{ readonly name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY rowid')
      .all()
      .map((row) => row.name);
    database.close();

    expect(tables).toEqual([...Object.keys(META_TABLES), ...BUCKETS]);
  });

  it('gives issue_facts the module and priority columns of D15', () => {
    expect(columnsOf('issue_facts')).toEqual(expect.arrayContaining(['module', 'priority', 'stage', 'plan_stub']));
  });

  it('keys stretch_marks by number and part, with its lane, end time and pull request', () => {
    expect(columnsOf('stretch_marks')).toEqual(['number', 'part', 'lane', 'ended_at', 'pr_number']);
    expect(primaryKeyOf('stretch_marks')).toEqual(['number', 'part']);
  });

  it('keys board_snapshot by day and stage', () => {
    expect(columnsOf('board_snapshot')).toEqual(['taken_at', 'day', 'stage', 'count']);
    expect(primaryKeyOf('board_snapshot')).toEqual(['day', 'stage']);
  });

  it('control: answers no column for a table the replica does not hold', () => {
    expect(columnsOf('session_facts')).toEqual([]);
  });
});

describe('isReplicaTable', () => {
  it('takes each bucket', () => {
    expect(BUCKETS.every((name) => isReplicaTable(name))).toBe(true);
  });

  it.each([
    ['a meta table', 'atlas_meta'],
    ['a table no source builds', 'session_facts'],
    ['a SQL-looking name', 'task_facts; DROP TABLE atlas_meta'],
    ['an inherited key', 'toString'],
    ['the empty string', ''],
  ])('refuses %s', (_label, name) => {
    expect(isReplicaTable(name)).toBe(false);
  });
});
