/**
 * Tests for `ddl.ts`: the whitelist holds the seven PoC buckets and nothing
 * else, refuses every name that is not one of its own keys, and each
 * statement creates the table it is keyed by.
 */
import { describe, expect, it } from 'bun:test';

import { isReplicaTable, META_TABLES, REPLICA_TABLES, replicaDdl } from './ddl.js';

const BUCKETS = ['task_facts', 'plan_facts', 'daily_rollup', 'bug_facts', 'finding_facts', 'change_facts',
  'ci_facts'];

describe('REPLICA_TABLES', () => {
  it('holds the seven buckets of the PoC, and not the meta tables', () => {
    expect(Object.keys(REPLICA_TABLES)).toEqual(BUCKETS);
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
});

describe('isReplicaTable', () => {
  it('takes each bucket', () => {
    expect(BUCKETS.every((name) => isReplicaTable(name))).toBe(true);
  });

  it.each([
    ['a meta table', 'atlas_meta'],
    ['a table the PoC does not build', 'commit_facts'],
    ['a SQL-looking name', 'task_facts; DROP TABLE atlas_meta'],
    ['an inherited key', 'toString'],
    ['the empty string', ''],
  ])('refuses %s', (_label, name) => {
    expect(isReplicaTable(name)).toBe(false);
  });
});
