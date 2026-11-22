/**
 * Tests for `catalogue.ts`: every definition passes the contract's
 * schema, names a source the registry defines, and has params the engine
 * plans against that source's descriptor, with and without a window, and
 * over a replica built from the fixture store. Controls show each check
 * can fail: the schema refuses a definition with an extra key, and the
 * engine refuses a measure on a field the descriptor lacks.
 */
import type { DataSourceDescriptor, MetricDefinition, QueryParams } from '@open-tomato/atlas-data/contract';
import type { TableSourceSpec } from '@open-tomato/atlas-data/source';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InvalidParams, MetricDefinitionSchema } from '@open-tomato/atlas-data/contract';
import { runQuery } from '@open-tomato/atlas-data/query';
import { afterAll, describe, expect, it } from 'bun:test';

import { buildAtlas } from '../build/index.js';
import { writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { openAtlasRegistry } from '../registry.js';
import { SOURCE_SPECS } from '../sources.js';

import { METRIC_CATALOGUE } from './catalogue.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-catalogue-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const BUILT_AT = new Date('2026-11-05T12:00:00.000Z');

/** The ids Phase 1 ships. */
const PHASE_ONE = ['pm.tokens-per-day', 'arch.tokens-by-model', 'arch.task-minutes-p50-p90'];

function specOf(metric: MetricDefinition): TableSourceSpec {
  const spec = SOURCE_SPECS.find((candidate) => candidate.descriptor.id === metric.sourceId);
  if (spec === undefined) throw new Error(`no source ${metric.sourceId}`);
  return spec;
}

function descriptorOf(spec: TableSourceSpec): DataSourceDescriptor {
  return { ...spec.descriptor, asOf: null, partial: false, partialReasons: [] };
}

/** Plan and run `params` against the spec's descriptor over a runner that answers no rows. */
function runEmpty(spec: TableSourceSpec, params: QueryParams): ReturnType<typeof runQuery> {
  return runQuery((selects) => selects.map(() => []), { table: spec.table, descriptor: descriptorOf(spec) }, params, { now: BUILT_AT });
}

describe('METRIC_CATALOGUE', () => {
  it('holds the three Phase 1 metrics, each id once', () => {
    const ids = METRIC_CATALOGUE.map((metric) => metric.id);

    expect(ids).toEqual(PHASE_ONE);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(PHASE_ONE)('%s passes the MetricDefinition schema', (id) => {
    const metric = METRIC_CATALOGUE.find((candidate) => candidate.id === id);

    expect(MetricDefinitionSchema.safeParse(metric).success).toBe(true);
  });

  it('control: the schema refuses a definition with a key the contract lacks', () => {
    const metric = { ...METRIC_CATALOGUE[0], colour: 'red' };

    expect(MetricDefinitionSchema.safeParse(metric).success).toBe(false);
  });

  it('labels the proxy metric with what it stands in for and the note a card shows', () => {
    const proxies = METRIC_CATALOGUE.filter((metric) => metric.feasibility === 'proxy');

    expect(proxies.map((metric) => metric.id)).toEqual(['arch.task-minutes-p50-p90']);
    expect(proxies.every((metric) => (metric.proxyFor ?? '') !== '' && (metric.proxyNote ?? '') !== '')).toBe(true);
  });

  it.each(PHASE_ONE)('%s names a source the registry defines', (id) => {
    const metric = METRIC_CATALOGUE.find((candidate) => candidate.id === id);
    if (metric === undefined) throw new Error(`no metric ${id}`);

    expect(SOURCE_SPECS.map((spec) => spec.descriptor.id)).toContain(metric.sourceId);
  });
});

describe('the catalogue params against the engine', () => {
  it.each(PHASE_ONE)('%s plans and runs against its source\'s descriptor, with and without a window', (id) => {
    const metric = METRIC_CATALOGUE.find((candidate) => candidate.id === id);
    if (metric === undefined) throw new Error(`no metric ${id}`);
    const spec = specOf(metric);

    const bare = runEmpty(spec, metric.params);
    const windowed = runEmpty(spec, { ...metric.params, window: { last: '28d' } });

    expect(bare.rows).toEqual([]);
    expect(bare.columns.map((column) => column.key)).toEqual(windowed.columns.map((column) => column.key));
    expect(windowed.meta.window.from).not.toBeNull();
  });

  it('control: the engine refuses a catalogue params whose measure names a field the descriptor lacks', () => {
    const metric = METRIC_CATALOGUE[0];
    if (metric === undefined) throw new Error('empty catalogue');
    const params: QueryParams = { ...metric.params, measures: [{ field: 'tokens_unknown', agg: 'sum' }] };

    expect(() => runEmpty(specOf(metric), params)).toThrow(InvalidParams);
  });

  it('answers every metric over a replica built from the fixture store, with rows behind each', async () => {
    const root = join(scope, 'built');
    writeFixtureStore(root);
    await buildAtlas({ projectRoot: root, env: {}, now: () => BUILT_AT, projectLabel: 'fixture' });
    const registry = await openAtlasRegistry({ projectRoot: root, sourceOptions: { now: () => BUILT_AT } });

    try {
      const answers = await Promise.all(METRIC_CATALOGUE.map(async (metric) => {
        const source = registry.sources.get(metric.sourceId);
        if (source === undefined) throw new Error(`no source ${metric.sourceId}`);
        return [metric.id, (await source.query({ ...metric.params, window: { last: '28d' } })).meta.rowCount] as const;
      }));

      expect(answers.every(([, rows]) => rows > 0)).toBe(true);
    } finally {
      registry.close();
    }
  });
});
