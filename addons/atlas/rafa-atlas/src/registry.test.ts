/**
 * Tests for `openAtlasRegistry` over a replica built from the ingest's
 * fixture store: the two sources and the three metrics by id, each
 * source's descriptor with the freshness its build stamped, the replica's
 * build time, the token sum one source answers equal to the other's, and
 * `ReplicaUnavailable` for a root with no replica.
 */
import type { AtlasRegistry } from './registry.js';
import type { DataSource } from '@open-tomato/atlas-data/source';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DataSourceDescriptorSchema, ReplicaUnavailable } from '@open-tomato/atlas-data/contract';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { DAILY_SOURCE } from './build/daily.js';
import { buildAtlas } from './build/index.js';
import { TASKS_SOURCE } from './ingest/effort.js';
import { writeFixtureStore } from './ingest/testdata/effort-store.fixture.js';
import { METRIC_CATALOGUE } from './metrics/catalogue.js';
import { openAtlasRegistry } from './registry.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-registry-')));
const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');
const root = join(scope, 'project');
let registry: AtlasRegistry | null = null;

beforeAll(async () => {
  writeFixtureStore(root);
  await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });
  registry = await openAtlasRegistry({ projectRoot: root });
});

afterAll(() => {
  registry?.close();
  rmSync(scope, { recursive: true, force: true });
});

function open(): AtlasRegistry {
  if (registry === null) throw new Error('no registry');
  return registry;
}

function sourceOf(id: string): DataSource {
  const source = open().sources.get(id);
  if (source === undefined) throw new Error(`no source ${id}`);
  return source;
}

/** The single cell of a one-row, one-measure answer. */
async function totalOf(id: string, field: string): Promise<unknown> {
  const result = await sourceOf(id).query({ measures: [{ field, agg: 'sum', as: 'total' }] });
  return result.rows[0]?.[0];
}

describe('openAtlasRegistry over a built replica', () => {
  it('lists local.tasks then local.daily, and the catalogue by id', () => {
    expect([...open().sources.keys()]).toEqual([TASKS_SOURCE, DAILY_SOURCE]);
    expect([...open().metrics.keys()]).toEqual(METRIC_CATALOGUE.map((metric) => metric.id));
  });

  it('describes each source in the contract\'s shape, stamped by the build', async () => {
    const tasks = await sourceOf(TASKS_SOURCE).describe();
    const daily = await sourceOf(DAILY_SOURCE).describe();

    expect(DataSourceDescriptorSchema.safeParse(tasks).success).toBe(true);
    expect(DataSourceDescriptorSchema.safeParse(daily).success).toBe(true);
    expect(tasks.asOf).not.toBeNull();
    expect(daily.partial).toBe(true);
    expect(daily.partialReasons.join(' ')).toContain('commits, prs_merged are not read yet');
  });

  it('answers the replica\'s build time as its asOf', () => {
    expect(open().asOf()).toBe(BUILT_AT.toISOString());
  });

  it('answers the same token total from local.daily as from local.tasks, over rows that hold some', async () => {
    const fromTasks = await totalOf(TASKS_SOURCE, 'tokens');
    const fromDaily = await totalOf(DAILY_SOURCE, 'tokens_total');

    expect(typeof fromTasks).toBe('number');
    expect(fromTasks).toBeGreaterThan(0);
    expect(fromDaily).toBe(fromTasks);
  });

  it('refuses a root with no replica as ReplicaUnavailable', async () => {
    await expect(openAtlasRegistry({ projectRoot: join(scope, 'empty') })).rejects.toThrow(ReplicaUnavailable);
  });
});
