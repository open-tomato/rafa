/**
 * Tests for `openAtlasRegistry` over a replica built from the ingest's
 * fixture store and the git ingest's fixture repository, made in the same
 * root with `git init`, and the board ingest's fixture cache: the ten
 * sources and the metrics by id, each source's
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
import { BOARD_SOURCE, ISSUES_SOURCE } from './ingest/board.js';
import { TASKS_SOURCE } from './ingest/effort.js';
import { BUGS_SOURCE, CI_SOURCE, FINDINGS_SOURCE } from './ingest/facts.js';
import { COMMITS_SOURCE, MARKS_SOURCE } from './ingest/git.js';
import { FIXTURE_EPIC_SLUG, writeBoardFixture } from './ingest/testdata/board-cache.fixture.js';
import { writeFactsFixture, writeFixtureStore } from './ingest/testdata/effort-store.fixture.js';
import { writeGitFixture } from './ingest/testdata/git-repo.fixture.js';
import { METRIC_CATALOGUE } from './metrics/catalogue.js';
import { openAtlasRegistry } from './registry.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-registry-')));
const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');
const root = join(scope, 'project');
let registry: AtlasRegistry | null = null;

beforeAll(async () => {
  writeFixtureStore(root);
  writeFactsFixture(root);
  writeGitFixture(root);
  writeBoardFixture(root);
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
  it('lists local.tasks, local.daily, local.plans, local.bugs, local.findings, local.ci, local.commits, local.marks, local.issues then local.board, and the catalogue by id', () => {
    expect([...open().sources.keys()]).toEqual([
      TASKS_SOURCE, DAILY_SOURCE, PLANS_SOURCE, BUGS_SOURCE, FINDINGS_SOURCE, CI_SOURCE, COMMITS_SOURCE, MARKS_SOURCE, ISSUES_SOURCE, BOARD_SOURCE,
    ]);
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
    expect(plans.partialReasons.join(' ')).toContain('merged_at is not read yet');
    expect(plans.partialReasons.join(' ')).not.toContain('epic_slug');
    expect(tasks.asOf).not.toBeNull();
    expect(daily.partial).toBe(true);
    expect(daily.partialReasons.join(' ')).toContain('prs_merged is not read yet');
    expect(daily.partialReasons.join(' ')).not.toContain('commits');
  });

  it('describes local.commits and local.marks stamped whole, and sums daily commits to the commits read', async () => {
    const described = await Promise.all([COMMITS_SOURCE, MARKS_SOURCE].map(async (id) => sourceOf(id).describe()));
    const commits = await sourceOf(COMMITS_SOURCE).query({ measures: [{ field: 'sha', agg: 'count', as: 'n' }] });
    const marks = await sourceOf(MARKS_SOURCE).query({ groupBy: ['lane'], measures: [{ field: 'number', agg: 'count', as: 'n' }] });
    const tags = await sourceOf(COMMITS_SOURCE).query({ measures: [{ field: 'release_tag', agg: 'count', as: 'n' }] });

    expect(described.every((descriptor) => DataSourceDescriptorSchema.safeParse(descriptor).success)).toBe(true);
    expect(described.map((descriptor) => [descriptor.partial, descriptor.asOf])).toEqual([
      [false, '2026-11-05T09:00:00.000Z'], [false, '2026-11-05T09:00:00.000Z'],
    ]);
    expect(commits.rows[0]?.[0]).toBe(7);
    expect(Object.fromEntries(marks.rows)).toEqual({ A: 1, M: 3 });
    expect(tags.rows[0]?.[0]).toBe(2);
    expect(await totalOf(DAILY_SOURCE, 'commits')).toBe(7);
  });

  it('describes local.issues and local.board in the contract\'s shape, and reads WIP by stage and the epic of a bug', async () => {
    const described = await Promise.all([ISSUES_SOURCE, BOARD_SOURCE].map(async (id) => sourceOf(id).describe()));
    const stages = await sourceOf(ISSUES_SOURCE).query({
      filters: [{ field: 'state', op: 'eq', value: 'OPEN' }],
      groupBy: ['stage'],
      measures: [{ field: 'number', agg: 'count', as: 'n' }],
    });
    const bugs = await sourceOf(ISSUES_SOURCE).query({
      filters: [{ field: 'is_bug', op: 'eq', value: 1 }, { field: 'epic_slug', op: 'eq', value: FIXTURE_EPIC_SLUG }],
      measures: [{ field: 'number', agg: 'count', as: 'n' }],
    });
    const snapshot = await sourceOf(BOARD_SOURCE).query({ measures: [{ field: 'count', agg: 'sum', as: 'issues' }] });

    expect(described.every((descriptor) => DataSourceDescriptorSchema.safeParse(descriptor).success)).toBe(true);
    expect(described.map((descriptor) => descriptor.partial)).toEqual([true, false]);
    expect(Object.fromEntries(stages.rows)).toEqual(expect.objectContaining({ 'In development': 1, 'Claimed': 1 }));
    expect(bugs.rows[0]?.[0]).toBe(1);
    expect(snapshot.rows[0]?.[0]).toBe(6);
  });

  it('describes local.bugs, local.findings and local.ci in the contract\'s shape, each with the rows its build stamped', async () => {
    const described = await Promise.all([BUGS_SOURCE, FINDINGS_SOURCE, CI_SOURCE].map(async (id) => sourceOf(id).describe()));
    const counts = await Promise.all([BUGS_SOURCE, FINDINGS_SOURCE, CI_SOURCE].map(async (id) => {
      const result = await sourceOf(id).query({ measures: [{ field: id === CI_SOURCE
        ? 'head_sha'
        : 'id', agg: 'count', as: 'n' }] });
      return result.rows[0]?.[0];
    }));

    expect(described.every((descriptor) => DataSourceDescriptorSchema.safeParse(descriptor).success)).toBe(true);
    expect(described.map((descriptor) => descriptor.asOf === null)).toEqual([false, false, false]);
    expect(counts).toEqual([6, 4, 5]);
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
