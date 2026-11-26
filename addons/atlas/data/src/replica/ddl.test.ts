/**
 * Tests for `ddl.ts`: the whitelist holds the seven PoC buckets and the six
 * of the git, GitHub, board and module sources and nothing else, refuses
 * every name that is not one of its own keys, each statement creates the
 * table it is keyed by, and a fresh build holds the version 5 columns of
 * `module_facts` and `issue_facts`.
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

/** One column of `table` as `pragma_table_info` answers it. */
interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
}

/** The type, NOT NULL flag and default of each column of `table` named in `names`, in that order. */
function columnInfoOf(table: string, names: readonly string[]): ColumnInfo[] {
  const database = new Database(':memory:');
  try {
    for (const statement of replicaDdl()) database.run(statement);
    const rows = database
      .query<ColumnInfo, [string]>('SELECT name, type, "notnull", dflt_value FROM pragma_table_info(?)')
      .all(table);
    return names.map((name) => rows.find((row) => row.name === name) ?? { name, type: '', notnull: -1, dflt_value: null });
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

  it('gives module_facts the three line kinds, zero by default, and a nullable layer and rank', () => {
    expect(columnInfoOf('module_facts', ['docs_loc', 'config_loc', 'fixtures_loc', 'layer', 'layer_rank'])).toEqual([
      { name: 'docs_loc', type: 'INTEGER', notnull: 1, dflt_value: '0' },
      { name: 'config_loc', type: 'INTEGER', notnull: 1, dflt_value: '0' },
      { name: 'fixtures_loc', type: 'INTEGER', notnull: 1, dflt_value: '0' },
      { name: 'layer', type: 'TEXT', notnull: 0, dflt_value: null },
      { name: 'layer_rank', type: 'INTEGER', notnull: 0, dflt_value: null },
    ]);
  });

  it('stores zero lines of each new kind and a NULL layer for a module row that names neither', () => {
    const database = new Database(':memory:');
    for (const statement of replicaDdl()) database.run(statement);
    database.run('INSERT INTO module_facts (path, package) VALUES (?, ?)', ['src', 'fixture']);
    const row = database
      .query<Record<string, unknown>, []>(
        'SELECT docs_loc, config_loc, fixtures_loc, layer, layer_rank FROM module_facts',
      )
      .get();
    database.close();

    expect(row).toEqual({ docs_loc: 0, config_loc: 0, fixtures_loc: 0, layer: null, layer_rank: null });
  });

  it('gives issue_facts a nullable issue_type text column', () => {
    expect(columnInfoOf('issue_facts', ['issue_type'])).toEqual([
      { name: 'issue_type', type: 'TEXT', notnull: 0, dflt_value: null },
    ]);
  });

  it('control: reads a column the DDL does not hold as missing', () => {
    expect(columnInfoOf('module_facts', ['source_loc'])).toEqual([
      { name: 'source_loc', type: '', notnull: -1, dflt_value: null },
    ]);
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
