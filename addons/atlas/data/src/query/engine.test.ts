/**
 * Tests for the query engine, run through `defineTableSource` over a
 * replica built in a tmpdir: week grain, `groupBy`, the p90, bound
 * filters, `ne` reading true for a NULL value, the previous window, the
 * scan cap, an unknown field raising `InvalidParams` and a SQL-looking
 * field name refused before any select runs.
 */
import type { RunSelects } from './engine.js';
import type { SqlSelect } from './sql.js';
import type { DataSourceDescriptor, FieldDescriptor, QueryParams, Scalar } from '../contract/types.js';
import type { ReplicaReader } from '../replica/reader.js';
import type { DataSource, TableSourceSpec } from '../source.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { InvalidParams } from '../contract/errors.js';
import { openReplica } from '../replica/reader.js';
import { writeReplica } from '../replica/writer.js';
import { defineTableSource } from '../source.js';

import { MAX_SCAN_ROWS, runQuery } from './engine.js';

interface TaskRow {
  readonly id: string;
  readonly model: string | null;
  readonly startedAt: string;
  readonly minutes: number;
  readonly tokens: number;
  readonly status: string | null;
}

const NOW = new Date('2026-11-15T12:00:00.000Z');

function field(key: string, type: FieldDescriptor['type'], role: FieldDescriptor['role']): FieldDescriptor {
  const measured = role === 'measure';
  return {
    key,
    label: key,
    type,
    role,
    aggregates: measured
      ? ['count', 'sum', 'mean', 'min', 'max', 'p50', 'p90', 'p99']
      : ['count', 'count_distinct'],
    filterable: true,
    groupable: !measured,
  };
}

const DESCRIPTOR: Omit<DataSourceDescriptor, 'asOf' | 'partial' | 'partialReasons'> = {
  id: 'local.tasks',
  source: 'local',
  channel: 'tasks',
  title: 'Tasks',
  description: 'One row per session.',
  timeField: 'started_at',
  grains: ['day', 'week', 'month', 'all'],
  fields: [
    field('session_id', 'string', 'id'),
    field('model', 'string', 'dimension'),
    field('status', 'string', 'dimension'),
    field('started_at', 'datetime', 'time'),
    field('minutes', 'number', 'measure'),
    field('tokens', 'integer', 'measure'),
  ],
};

const SPEC: TableSourceSpec = { descriptor: DESCRIPTOR, table: 'task_facts' };

let dir = '';
let reader: ReplicaReader | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-query-engine-'));
});

afterEach(() => {
  reader?.close();
  reader = null;
  rmSync(dir, { recursive: true, force: true });
});

async function sourceOver(rows: readonly TaskRow[], maxScanRows?: number): Promise<DataSource> {
  const replicaPath = join(dir, 'atlas.sqlite');
  await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
    const insert = build.database.prepare(
      'INSERT INTO task_facts (session_id, kind, model, started_at, minutes, tokens, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const row of rows) insert.run(row.id, 'task', row.model, row.startedAt, row.minutes, row.tokens, row.status);
  });
  reader = openReplica(replicaPath);
  return defineTableSource(reader, SPEC, {
    now: () => NOW,
    ...(maxScanRows === undefined
      ? {}
      : { maxScanRows }),
  });
}

function task(id: string, startedAt: string, extra: Partial<TaskRow> = {}): TaskRow {
  return { id, model: 'opus', startedAt, minutes: 1, tokens: 100, status: 'done', ...extra };
}

/** The rows of `task_facts` read straight from the replica, for a control. */
function countWhere(where: string): number {
  const row = reader?.current().database
    .query<{ readonly n: number }, []>(`SELECT count(*) AS n FROM task_facts WHERE ${where}`)
    .get();
  return row?.n ?? -1;
}

/** A runner that records each select and answers no rows. */
function spyRunner(): { readonly run: RunSelects; readonly seen: SqlSelect[] } {
  const seen: SqlSelect[] = [];
  return {
    seen,
    run: (selects) => {
      seen.push(...selects);
      return selects.map(() => []);
    },
  };
}

async function invalid(run: () => Promise<unknown>): Promise<InvalidParams> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof InvalidParams) return error;
    throw error;
  }
  throw new Error('expected InvalidParams');
}

describe('grain', () => {
  it('buckets by ISO week, keyed by the Monday, Sunday kept in the week it ends', async () => {
    const source = await sourceOver([
      task('a', '2026-11-02T09:00:00.000Z'),
      task('b', '2026-11-08T23:30:00.000Z'),
      task('c', '2026-11-09T00:10:00.000Z'),
    ]);

    const result = await source.query({ grain: 'week', measures: [{ field: 'session_id', agg: 'count', as: 'sessions' }] });

    expect(result.columns.map((column) => column.key)).toEqual(['week', 'sessions']);
    expect(result.rows).toEqual([['2026-11-02', 2], ['2026-11-09', 1]]);
  });

  it('control: the same rows by day answer one group a day', async () => {
    const source = await sourceOver([
      task('a', '2026-11-02T09:00:00.000Z'),
      task('b', '2026-11-08T23:30:00.000Z'),
      task('c', '2026-11-09T00:10:00.000Z'),
    ]);

    const result = await source.query({ grain: 'day', measures: [{ field: 'session_id', agg: 'count' }] });

    expect(result.rows).toEqual([['2026-11-02', 1], ['2026-11-08', 1], ['2026-11-09', 1]]);
  });
});

describe('groupBy', () => {
  it('answers one row per group with its sum, in group order', async () => {
    const source = await sourceOver([
      task('a', '2026-11-02T09:00:00.000Z', { model: 'sonnet', tokens: 50 }),
      task('b', '2026-11-03T09:00:00.000Z', { model: 'opus', tokens: 200 }),
      task('c', '2026-11-04T09:00:00.000Z', { model: 'opus', tokens: 300 }),
      task('d', '2026-11-04T10:00:00.000Z', { model: null, tokens: 7 }),
    ]);

    const result = await source.query({ groupBy: ['model'], measures: [{ field: 'tokens', agg: 'sum' }] });

    expect(result.columns.map((column) => column.key)).toEqual(['model', 'tokens_sum']);
    expect(result.rows).toEqual([['opus', 500], ['sonnet', 50], [null, 7]]);
    expect(result.meta.rowCount).toBe(4);
  });

  it('orders by a measure when asked, and limits after the order', async () => {
    const source = await sourceOver([
      task('a', '2026-11-02T09:00:00.000Z', { model: 'sonnet', tokens: 900 }),
      task('b', '2026-11-03T09:00:00.000Z', { model: 'opus', tokens: 200 }),
      task('c', '2026-11-04T09:00:00.000Z', { model: 'haiku', tokens: 300 }),
    ]);

    const result = await source.query({
      groupBy: ['model'],
      measures: [{ field: 'tokens', agg: 'sum', as: 'tokens' }],
      orderBy: [{ key: 'tokens', dir: 'desc' }],
      limit: 2,
    });

    expect(result.rows).toEqual([['sonnet', 900], ['haiku', 300]]);
  });
});

describe('quantiles', () => {
  it('answers p90 by nearest rank: the ninth of ten values, not an interpolation', async () => {
    const minutes = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5];
    const source = await sourceOver(minutes.map((value, index) => task(`s${index}`, `2026-11-0${(index % 9) + 1}T09:00:00.000Z`, { minutes: value })));

    const result = await source.query({
      measures: [
        { field: 'minutes', agg: 'p50' },
        { field: 'minutes', agg: 'p90' },
        { field: 'minutes', agg: 'p99' },
      ],
    });

    expect(result.rows).toEqual([[6, 9, 10]]);
  });
});

describe('filters', () => {
  it('binds a filter value, so SQL text in it matches nothing and runs nothing', async () => {
    const hostile = 'done\' OR \'1\'=\'1';
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z'), task('b', '2026-11-03T09:00:00.000Z', { status: 'blocked' })]);

    const result = await source.query({ filters: [{ field: 'status', op: 'eq', value: hostile }], fields: ['session_id'] });

    expect(result.rows).toEqual([]);
    expect(countWhere('1 = 1')).toBe(2);
  });

  it('control: the same filter with a stored value matches its row', async () => {
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z'), task('b', '2026-11-03T09:00:00.000Z', { status: 'blocked' })]);

    const result = await source.query({ filters: [{ field: 'status', op: 'eq', value: 'blocked' }], fields: ['session_id'] });

    expect(result.rows).toEqual([['b']]);
  });

  it('puts each value and window bound in the bindings and none in the SQL text', () => {
    const spy = spyRunner();
    const params: QueryParams = {
      window: { from: '2026-11-01', to: '2026-11-07' },
      filters: [{ field: 'status', op: 'in', value: ['done', 'blocked'] }, { field: 'tokens', op: 'gt', value: 5 }],
      measures: [{ field: 'tokens', agg: 'sum' }],
    };

    runQuery(spy.run, { table: 'task_facts', descriptor: { ...DESCRIPTOR, asOf: null, partial: false, partialReasons: [] } }, params, { now: NOW });

    const [select] = spy.seen;
    expect(select?.bindings).toEqual(['2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z', 'done', 'blocked', 5, MAX_SCAN_ROWS + 1]);
    for (const value of ['2026-11', 'done', 'blocked', '5']) expect(select?.sql).not.toContain(value);
  });

  it('reads ne as true for a NULL value, where plain SQL <> drops the row', async () => {
    const source = await sourceOver([
      task('a', '2026-11-02T09:00:00.000Z', { status: 'done' }),
      task('b', '2026-11-03T09:00:00.000Z', { status: 'blocked' }),
      task('c', '2026-11-04T09:00:00.000Z', { status: null }),
    ]);

    const result = await source.query({ filters: [{ field: 'status', op: 'ne', value: 'blocked' }], fields: ['session_id', 'status'] });

    expect(result.rows).toEqual([['a', 'done'], ['c', null]]);
    expect(countWhere('status <> \'blocked\'')).toBe(1);
  });
});

describe('windows', () => {
  const rows: readonly TaskRow[] = [
    task('old', '2026-10-30T09:00:00.000Z', { tokens: 1 }),
    task('p1', '2026-11-02T09:00:00.000Z', { tokens: 10 }),
    task('p2', '2026-11-08T23:59:00.000Z', { tokens: 20 }),
    task('c1', '2026-11-09T00:00:00.000Z', { tokens: 100 }),
    task('c2', '2026-11-15T08:00:00.000Z', { tokens: 200 }),
    task('next', '2026-11-16T00:00:00.000Z', { tokens: 1000 }),
  ];

  it('answers the window just before the asked one in meta.previous, as long as it', async () => {
    const source = await sourceOver(rows);

    const result = await source.query({
      window: { from: '2026-11-09', to: '2026-11-15' },
      measures: [{ field: 'tokens', agg: 'sum' }],
      compare: 'previous',
    });

    expect(result.rows).toEqual([[300]]);
    expect(result.meta.window).toEqual({ from: '2026-11-09T00:00:00.000Z', to: '2026-11-16T00:00:00.000Z' });
    expect(result.meta.previous).toEqual({
      rows: [[30]],
      window: { from: '2026-11-02T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' },
    });
  });

  it('counts last: 7d back from the end of today, today included', async () => {
    const source = await sourceOver(rows);

    const result = await source.query({ window: { last: '7d' }, fields: ['session_id'], compare: 'previous' });

    expect(result.rows).toEqual([['c1'], ['c2']]);
    expect(result.meta.previous?.rows).toEqual([['p1'], ['p2']]);
  });

  it('leaves meta.previous out when compare is not asked', async () => {
    const source = await sourceOver(rows);

    const result = await source.query({ window: { last: '7d' }, fields: ['session_id'] });

    expect(result.meta.previous).toBeUndefined();
  });

  it('refuses compare: previous over a window open at one end', async () => {
    const source = await sourceOver(rows);

    const error = await invalid(() => source.query({ window: { from: '2026-11-09' }, fields: ['session_id'], compare: 'previous' }));

    expect(error.details.fields).toEqual(['window']);
  });
});

describe('the scan cap', () => {
  it('is 200 000 rows', () => {
    expect(MAX_SCAN_ROWS).toBe(200_000);
  });

  it('marks a cut scan truncated and keeps the newest rows', async () => {
    const source = await sourceOver([
      task('a', '2026-11-02T09:00:00.000Z'),
      task('b', '2026-11-03T09:00:00.000Z'),
      task('c', '2026-11-04T09:00:00.000Z'),
    ], 2);

    const result = await source.query({ fields: ['session_id'], orderBy: [{ key: 'session_id', dir: 'asc' }] });

    expect(result.rows).toEqual([['b'], ['c']]);
    expect(result.meta).toMatchObject({ truncated: true, rowCount: 2 });
  });

  it('control: a scan under the cap is not truncated', async () => {
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z'), task('b', '2026-11-03T09:00:00.000Z')], 2);

    const result = await source.query({ fields: ['session_id'] });

    expect(result.meta).toMatchObject({ truncated: false, rowCount: 2 });
  });
});

describe('refused params', () => {
  it('raises InvalidParams naming an unknown field', async () => {
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z')]);

    const error = await invalid(() => source.query({ measures: [{ field: 'cost', agg: 'sum' }] }));

    expect(error.details.fields).toEqual(['cost']);
  });

  it('refuses a SQL-looking field name before any select runs', () => {
    const spy = spyRunner();
    const target = { table: 'task_facts', descriptor: { ...DESCRIPTOR, asOf: null, partial: false, partialReasons: [] } };
    const names = ['tokens) FROM task_facts; DROP TABLE task_facts; --', 'model" FROM sqlite_master --'];

    for (const name of names) {
      expect(() => runQuery(spy.run, target, { groupBy: [name], measures: [{ field: 'tokens', agg: 'sum' }] })).toThrow(InvalidParams);
      expect(() => runQuery(spy.run, target, { fields: [name] })).toThrow(InvalidParams);
    }
    expect(spy.seen).toEqual([]);
  });

  it('control: a known field through the same runner reaches a select', () => {
    const spy = spyRunner();
    const target = { table: 'task_facts', descriptor: { ...DESCRIPTOR, asOf: null, partial: false, partialReasons: [] } };

    runQuery(spy.run, target, { fields: ['tokens'] });

    expect(spy.seen.map((select) => select.sql)).toEqual(['SELECT "tokens" FROM "task_facts" ORDER BY "started_at" DESC LIMIT ?']);
  });

  it('refuses an aggregate the field does not accept, and a groupBy on a measure', async () => {
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z')]);

    const byAggregate = await invalid(() => source.query({ measures: [{ field: 'model', agg: 'sum' }] }));
    const byGroup = await invalid(() => source.query({ groupBy: ['tokens'], measures: [{ field: 'tokens', agg: 'sum' }] }));

    expect(byAggregate.details.fields).toEqual(['model']);
    expect(byGroup.details.fields).toEqual(['tokens']);
  });

  it('refuses params that fail the schema, naming the path at fault', async () => {
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z')]);

    const error = await invalid(() => source.query({ limit: 0 }));

    expect(error.details.fields).toEqual(['limit']);
  });
});

describe('cells', () => {
  it('answers a row of no matches as one ungrouped row, as SQL does', async () => {
    const source = await sourceOver([task('a', '2026-11-02T09:00:00.000Z')]);

    const result = await source.query({
      filters: [{ field: 'model', op: 'eq', value: 'none' }],
      measures: [{ field: 'session_id', agg: 'count' }, { field: 'tokens', agg: 'sum' }],
    });

    expect(result.rows).toEqual([[0, null] satisfies Scalar[]]);
  });
});
