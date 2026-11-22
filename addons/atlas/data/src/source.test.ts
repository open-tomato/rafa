/**
 * Tests for `source.ts`: a table source describes itself with the
 * freshness its build stamped, refuses a spec off the whitelist or the
 * contract when it is defined (a SQL-looking table or field key among
 * them), and refuses a query whose signal is already aborted.
 */
import type { FieldDescriptor } from './contract/types.js';
import type { ReplicaReader } from './replica/reader.js';
import type { TableSourceSpec } from './source.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DataSourceDescriptorSchema } from './contract/schemas.js';
import { openReplica } from './replica/reader.js';
import { writeReplica } from './replica/writer.js';
import { defineTableSource } from './source.js';

const DAY: FieldDescriptor = {
  key: 'day',
  label: 'Day',
  type: 'date',
  role: 'time',
  aggregates: ['count'],
  filterable: true,
  groupable: true,
};

const TOKENS: FieldDescriptor = {
  key: 'tokens_total',
  label: 'Tokens',
  type: 'integer',
  role: 'measure',
  unit: 'tokens',
  aggregates: ['sum'],
  filterable: true,
  groupable: false,
};

const SPEC: TableSourceSpec = {
  descriptor: {
    id: 'local.daily',
    source: 'local',
    channel: 'daily',
    title: 'Daily',
    description: 'One row per day.',
    timeField: 'day',
    grains: ['day', 'week', 'all'],
    fields: [DAY, TOKENS],
  },
  table: 'daily_rollup',
  stamps: ['local.tasks', 'local.ci'],
};

let dir = '';
let reader: ReplicaReader | null = null;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-source-'));
  const replicaPath = join(dir, 'atlas.sqlite');
  await writeReplica({ replicaPath, projectLabel: 'fixture' }, (build) => {
    build.database.run('INSERT INTO daily_rollup (day, tokens_total) VALUES (\'2026-11-02\', 40), (\'2026-11-03\', 2)');
    build.stampSource({ source: 'local.tasks', asOf: '2026-11-03T10:00:00.000Z', readAt: build.builtAt, rows: 2, partial: false, reason: null });
    build.stampSource({ source: 'local.ci', asOf: '2026-11-01T10:00:00.000Z', readAt: build.builtAt, rows: 0, partial: true, reason: 'plan_ci lacks failing' });
    build.stampSource({ source: 'local.other', asOf: '2026-12-01T10:00:00.000Z', readAt: build.builtAt, rows: 0, partial: true, reason: 'not read' });
  });
  reader = openReplica(replicaPath);
});

afterEach(() => {
  reader?.close();
  reader = null;
  rmSync(dir, { recursive: true, force: true });
});

function open(): ReplicaReader {
  if (reader === null) throw new Error('no reader');
  return reader;
}

describe('defineTableSource describe', () => {
  it('stamps asOf as the newest of its sources and partial with their reasons, and passes the schema', async () => {
    const descriptor = await defineTableSource(open(), SPEC).describe();

    expect(descriptor).toMatchObject({ id: 'local.daily', asOf: '2026-11-03T10:00:00.000Z', partial: true, partialReasons: ['plan_ci lacks failing'] });
    expect(DataSourceDescriptorSchema.safeParse(descriptor).success).toBe(true);
  });

  it('reads the row under its own id when the spec names no stamps, and null when there is none', async () => {
    const bare: TableSourceSpec = { descriptor: SPEC.descriptor, table: SPEC.table };

    const descriptor = await defineTableSource(open(), bare).describe();

    expect(descriptor).toMatchObject({ asOf: null, partial: false, partialReasons: [] });
  });

  it('answers the same freshness in a query\'s meta', async () => {
    const result = await defineTableSource(open(), SPEC).query({ grain: 'week', measures: [{ field: 'tokens_total', agg: 'sum' }] });

    expect(result.rows).toEqual([['2026-11-02', 42]]);
    expect(result.meta).toMatchObject({ asOf: '2026-11-03T10:00:00.000Z', partial: true });
  });
});

describe('defineTableSource refusals', () => {
  it('refuses a table that is not a key of REPLICA_TABLES, a SQL-looking one among them', () => {
    expect(() => defineTableSource(open(), { ...SPEC, table: 'atlas_meta' })).toThrow('is not a replica table');
    expect(() => defineTableSource(open(), { ...SPEC, table: 'daily_rollup; DROP TABLE atlas_meta' })).toThrow('is not a replica table');
  });

  it('refuses a SQL-looking field key through the descriptor schema', () => {
    const hostile: FieldDescriptor = { ...TOKENS, key: 'tokens_total" FROM atlas_meta --' };

    expect(() => defineTableSource(open(), { ...SPEC, descriptor: { ...SPEC.descriptor, fields: [DAY, hostile] } }))
      .toThrow('does not match the contract at fields.1.key');
  });

  it('refuses a time field that is not one of its fields, and a key listed twice', () => {
    expect(() => defineTableSource(open(), { ...SPEC, descriptor: { ...SPEC.descriptor, timeField: 'started_at' } }))
      .toThrow('is not one of its fields');
    expect(() => defineTableSource(open(), { ...SPEC, descriptor: { ...SPEC.descriptor, fields: [DAY, TOKENS, TOKENS] } }))
      .toThrow('listed twice');
  });

  it('control: the spec as written is defined', () => {
    expect(defineTableSource(open(), SPEC).id).toBe('local.daily');
  });

  it('rejects a query whose signal is already aborted, and answers the same query without one', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = defineTableSource(open(), SPEC);

    await expect(source.query({}, controller.signal)).rejects.toThrow();
    expect((await source.query({})).rows).toHaveLength(2);
  });
});
