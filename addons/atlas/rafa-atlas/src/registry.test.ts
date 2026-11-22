/**
 * Tests for `openAtlasRegistry` over a replica built from the ingest's
 * fixture store: the three sources and the metrics by id, each source's
 * descriptor with the freshness its build stamped, the replica's build
 * time, the token sum one source answers equal to the other's, the derived
 * columns (`work_type`, the day counts, `local.plans`) read through the
 * engine with an unlisted column refused as the control, and
 * `ReplicaUnavailable` for a root with no replica.
 */
import type { AtlasRegistry } from './registry.js';
import type { DataSource } from '@open-tomato/atlas-data/source';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DataSourceDescriptorSchema, InvalidParams, ReplicaUnavailable } from '@open-tomato/atlas-data/contract';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { DAILY_SOURCE } from './build/daily.js';
import { PLANS_SOURCE } from './build/derive.js';
import { buildAtlas } from './build/index.js';
import { TASKS_SOURCE } from './ingest/effort.js';
import { writeFactsFixture, writeFixtureStore } from './ingest/testdata/effort-store.fixture.js';
import { METRIC_CATALOGUE } from './metrics/catalogue.js';
import { openAtlasRegistry } from './registry.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-registry-')));
const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');
const root = join(scope, 'project');
let registry: AtlasRegistry | null = null;

beforeAll(async () => {
  writeFixtureStore(root);
  writeFactsFixture(root);
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
  it('lists local.tasks, local.daily then local.plans, and the catalogue by id', () => {
    expect([...open().sources.keys()]).toEqual([TASKS_SOURCE, DAILY_SOURCE, PLANS_SOURCE]);
    expect([...open().metrics.keys()]).toEqual(METRIC_CATALOGUE.map((metric) => metric.id));
  });

  it('describes each source in the contract\'s shape, stamped by the build', async () => {
    const tasks = await sourceOf(TASKS_SOURCE).describe();
    const daily = await sourceOf(DAILY_SOURCE).describe();
    const plans = await sourceOf(PLANS_SOURCE).describe();

    expect(DataSourceDescriptorSchema.safeParse(tasks).success).toBe(true);
    expect(DataSourceDescriptorSchema.safeParse(daily).success).toBe(true);
    expect(DataSourceDescriptorSchema.safeParse(plans).success).toBe(true);
    expect(plans.partial).toBe(true);
    expect(plans.partialReasons.join(' ')).toContain('epic_slug, merged_at are not read yet');
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

  it('groups sessions by work_type, the D4 column the derivation fills', async () => {
    const result = await sourceOf(TASKS_SOURCE).query({
      groupBy: ['work_type'],
      measures: [{ field: 'session_id', agg: 'count', as: 'n' }],
    });
    const typed = result.rows.filter((row) => row[0] !== null);

    expect(Object.fromEntries(typed)).toEqual({ feature: 1, fix: 1 });
  });

  it('answers each day count summed equal to the sessions behind it', async () => {
    const byDay = await sourceOf(TASKS_SOURCE).query({
      groupBy: ['day'],
      measures: [{ field: 'session_id', agg: 'count', as: 'n' }],
    });
    const dated = byDay.rows.filter((row) => row[0] !== null).reduce((sum, row) => sum + Number(row[1]), 0);
    const sumsOf = async (fields: readonly string[]): Promise<readonly unknown[]> => {
      const result = await sourceOf(DAILY_SOURCE).query({ measures: fields.map((field) => ({ field, agg: 'sum' as const, as: field })) });
      return result.rows[0] ?? [];
    };
    const counts = ['sessions', 'task_sessions', 'tasks_done', 'tasks_blocked', 'findings', 'bugs', 'changes'];
    const cells = await sumsOf(counts);
    const unsessioned = await sumsOf(['preflight_runs', 'preflight_halts', 'commits', 'prs_merged']);

    expect(dated).toBeGreaterThan(0);
    expect(cells[0]).toBe(dated);
    expect(cells.every((cell) => typeof cell === 'number')).toBe(true);
    expect(cells[counts.indexOf('changes')]).toBe(2);
    expect(unsessioned).toHaveLength(4);
  });

  it('answers local.plans by plan, its session counts summing to the sessions that name a plan', async () => {
    const byPlan = await sourceOf(PLANS_SOURCE).query({
      grain: 'plan',
      measures: [{ field: 'sessions', agg: 'sum', as: 'sessions' }, { field: 'tasks_planned', agg: 'sum', as: 'planned' }],
    });
    const fromTasks = await sourceOf(TASKS_SOURCE).query({
      grain: 'plan',
      measures: [{ field: 'session_id', agg: 'count', as: 'n' }],
    });
    const named = fromTasks.rows.filter((row) => row[0] !== null).reduce((sum, row) => sum + Number(row[1]), 0);
    const total = byPlan.rows.reduce((sum, row) => sum + Number(row[1]), 0);

    expect(byPlan.rows.length).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(0);
    expect(total).toBe(named);
  });

  it('control: refuses a replica column no spec lists, such as the dedupe key', async () => {
    await expect(sourceOf(TASKS_SOURCE).query({
      measures: [{ field: 'origin_seq', agg: 'sum', as: 'n' }],
    })).rejects.toThrow(InvalidParams);
  });

  it('refuses a root with no replica as ReplicaUnavailable', async () => {
    await expect(openAtlasRegistry({ projectRoot: join(scope, 'empty') })).rejects.toThrow(ReplicaUnavailable);
  });
});
