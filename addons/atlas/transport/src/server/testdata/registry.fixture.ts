/**
 * An in-memory registry for the server tests: two sources over no
 * database, each answering a fixed descriptor and recording the params
 * its query was handed, and two metrics on two lenses. A source can be
 * told to throw from `describe` or `query`, so a test reaches the 400,
 * 503 and 500 answers without a replica.
 */
import type { AtlasRegistry } from '../handler.js';
import type {
  DataSourceDescriptor,
  MetricDefinition,
  QueryParams,
  QueryResult,
} from '@open-tomato/atlas-data/contract';
import type { DataSource } from '@open-tomato/atlas-data/source';

export const BUILT_AT = '2026-11-05T12:00:00.000Z';
export const TASKS_AS_OF = '2026-11-05T11:00:00.000Z';
export const RESULT_AS_OF = '2026-11-05T10:00:00.000Z';

export const TASKS_DESCRIPTOR: DataSourceDescriptor = {
  id: 'local.tasks',
  source: 'local',
  channel: 'tasks',
  title: 'Tasks',
  description: 'One row per task session.',
  timeField: 'day',
  grains: ['day', 'week', 'all'],
  fields: [
    { key: 'day', label: 'Day', type: 'date', role: 'time', aggregates: ['count'], filterable: true, groupable: true },
    {
      key: 'tokens',
      label: 'Tokens',
      type: 'integer',
      role: 'measure',
      unit: 'tokens',
      aggregates: ['sum'],
      filterable: true,
      groupable: false,
    },
  ],
  asOf: TASKS_AS_OF,
  partial: false,
  partialReasons: [],
};

export const DAILY_DESCRIPTOR: DataSourceDescriptor = {
  ...TASKS_DESCRIPTOR,
  id: 'local.daily',
  channel: 'daily',
  title: 'Daily',
  description: 'One row per day.',
  asOf: null,
  partial: true,
  partialReasons: ['sessions: a column is missing'],
};

export const TASKS_RESULT: QueryResult = {
  columns: [
    { key: 'day', label: 'Day', type: 'date' },
    { key: 'tokens', label: 'Tokens', type: 'integer', unit: 'tokens' },
  ],
  rows: [['2026-11-04', 120], ['2026-11-05', 80]],
  meta: {
    asOf: RESULT_AS_OF,
    partial: false,
    partialReasons: [],
    rowCount: 2,
    truncated: false,
    window: { from: '2026-11-04', to: '2026-11-05' },
  },
};

export const PM_METRIC: MetricDefinition = {
  id: 'pm.tokens-per-day',
  title: 'Tokens per day',
  lenses: ['pm'],
  description: 'Tokens per day.',
  sourceId: 'local.daily',
  params: { grain: 'day', measures: [{ field: 'tokens', agg: 'sum' }] },
  formula: { kind: 'none' },
  chart: 'line',
  feasibility: 'direct',
};

export const ARCH_METRIC: MetricDefinition = {
  ...PM_METRIC,
  id: 'arch.tokens-by-model',
  title: 'Tokens by model',
  lenses: ['architect'],
  sourceId: 'local.tasks',
};

/** What a stub source throws, by the member that throws it. */
export interface StubFaults {
  readonly describe?: unknown;
  readonly query?: unknown;
}

/** A source answering `descriptor` and `TASKS_RESULT`, recording each query's params. */
export interface StubSource extends DataSource {
  readonly queried: readonly QueryParams[];
}

export function stubSource(descriptor: DataSourceDescriptor, faults: StubFaults = {}): StubSource {
  const queried: QueryParams[] = [];
  return {
    id: descriptor.id,
    queried,
    describe: async () => {
      if ('describe' in faults) throw faults.describe;
      return descriptor;
    },
    query: async (params) => {
      queried.push(params);
      if ('query' in faults) throw faults.query;
      return TASKS_RESULT;
    },
  };
}

export interface StubRegistryOptions {
  readonly tasks?: StubSource;
  readonly daily?: StubSource;
  /** Thrown by `asOf()` in place of answering `BUILT_AT`. */
  readonly asOfFault?: unknown;
}

export function stubRegistry(options: StubRegistryOptions = {}): AtlasRegistry {
  const tasks = options.tasks ?? stubSource(TASKS_DESCRIPTOR);
  const daily = options.daily ?? stubSource(DAILY_DESCRIPTOR);
  return {
    sources: new Map<string, DataSource>([[tasks.id, tasks], [daily.id, daily]]),
    metrics: new Map([[PM_METRIC.id, PM_METRIC], [ARCH_METRIC.id, ARCH_METRIC]]),
    asOf: () => {
      if ('asOfFault' in options) throw options.asOfFault;
      return BUILT_AT;
    },
  };
}
