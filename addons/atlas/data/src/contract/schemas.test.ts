/**
 * Tests for `schemas.ts`: query params valid and invalid, strict objects,
 * the window rule, the JSON Schema the params schema renders to, and the
 * descriptor, result, metric and envelope schemas.
 */
import type { DataSourceDescriptor, FieldDescriptor, QueryParams, QueryResult } from './types.js';

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  DataSourceDescriptorSchema,
  envelopeSchema,
  FieldDescriptorSchema,
  FormulaSchema,
  LensSchema,
  MAX_LIMIT,
  MetricDefinitionSchema,
  QueryParamsSchema,
  QueryResultSchema,
  WindowSchema,
} from './schemas.js';

const FULL_PARAMS: QueryParams = {
  window: { last: '28d' },
  grain: 'week',
  groupBy: ['model'],
  measures: [{ field: 'tokens_total', agg: 'sum', as: 'tokens' }],
  filters: [
    { field: 'kind', op: 'eq', value: 'task' },
    { field: 'model', op: 'in', value: ['opus', 'sonnet'] },
    { field: 'plan', op: 'is_null' },
  ],
  orderBy: [{ key: 'tokens', dir: 'desc' }],
  limit: 100,
  compare: 'previous',
};

const FIELD: FieldDescriptor = {
  key: 'tokens_total',
  label: 'Tokens',
  type: 'integer',
  role: 'measure',
  aggregates: ['sum', 'mean'],
  filterable: true,
  groupable: false,
};

const RESULT: QueryResult = {
  columns: [{ key: 'day', label: 'Day', type: 'date' }],
  rows: [['2026-11-01'], ['2026-11-02']],
  meta: {
    asOf: '2026-11-20T10:00:00.000Z',
    partial: false,
    partialReasons: [],
    rowCount: 2,
    truncated: false,
    window: { from: '2026-11-01', to: null },
  },
};

describe('QueryParamsSchema, valid params', () => {
  it('takes an empty object, every member being optional', () => {
    expect(QueryParamsSchema.safeParse({}).success).toBe(true);
  });

  it('takes params using every member', () => {
    expect(QueryParamsSchema.parse(FULL_PARAMS)).toEqual(FULL_PARAMS);
  });

  it('takes a window of from and to, as dates or as stamps with an offset', () => {
    const window = { from: '2026-11-01', to: '2026-11-20T12:00:00+01:00' };

    expect(QueryParamsSchema.safeParse({ window }).success).toBe(true);
  });

  it('control: takes a limit of 1 and of MAX_LIMIT', () => {
    expect(QueryParamsSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(QueryParamsSchema.safeParse({ limit: MAX_LIMIT }).success).toBe(true);
  });
});

describe('QueryParamsSchema, invalid params', () => {
  it('refuses an extra key at the top, the object being strict', () => {
    const parsed = QueryParamsSchema.safeParse({ grain: 'day', sql: 'select 1' });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('refuses an extra key inside a nested member', () => {
    const measures = [{ field: 'tokens_total', agg: 'sum', having: 1 }];

    expect(QueryParamsSchema.safeParse({ measures }).success).toBe(false);
  });

  it('refuses a window holding both last and from, naming the rule', () => {
    const parsed = QueryParamsSchema.safeParse({ window: { last: '7d', from: '2026-11-01' } });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('last and from exclude each other');
  });

  it('control: takes last with to, the rule binding last to from only', () => {
    expect(WindowSchema.safeParse({ last: '7d', to: '2026-11-20' }).success).toBe(true);
  });

  it('refuses a last that is not a count and a unit', () => {
    expect(WindowSchema.safeParse({ last: '7y' }).success).toBe(false);
    expect(WindowSchema.safeParse({ last: 'd' }).success).toBe(false);
    expect(WindowSchema.safeParse({ last: '12345d' }).success).toBe(false);
  });

  it('refuses a from that is no ISO date or stamp', () => {
    expect(WindowSchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('refuses a grain, an aggregate or an operator outside the closed set', () => {
    expect(QueryParamsSchema.safeParse({ grain: 'hour' }).success).toBe(false);
    expect(
      QueryParamsSchema.safeParse({ measures: [{ field: 'x', agg: 'median' }] }).success,
    ).toBe(false);
    expect(
      QueryParamsSchema.safeParse({ filters: [{ field: 'x', op: 'like', value: 'a' }] }).success,
    ).toBe(false);
  });

  it('refuses a limit off the range or not whole', () => {
    expect(QueryParamsSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(QueryParamsSchema.safeParse({ limit: MAX_LIMIT + 1 }).success).toBe(false);
    expect(QueryParamsSchema.safeParse({ limit: 2.5 }).success).toBe(false);
  });

  it('refuses lists longer than their caps', () => {
    expect(QueryParamsSchema.safeParse({ groupBy: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    const measures = Array.from({ length: 9 }, () => ({ field: 'x', agg: 'sum' }));
    expect(QueryParamsSchema.safeParse({ measures }).success).toBe(false);
  });

  it('refuses a compare other than previous, and a filter value that is an object', () => {
    expect(QueryParamsSchema.safeParse({ compare: 'year' }).success).toBe(false);
    expect(
      QueryParamsSchema.safeParse({ filters: [{ field: 'x', op: 'eq', value: { a: 1 } }] }).success,
    ).toBe(false);
  });
});

describe('z.toJSONSchema(QueryParamsSchema)', () => {
  it('renders the same JSON Schema as the snapshot', () => {
    expect(z.toJSONSchema(QueryParamsSchema)).toMatchSnapshot();
  });

  it('closes every object to extra keys', () => {
    const rendered = JSON.stringify(z.toJSONSchema(QueryParamsSchema));

    expect(rendered).toContain('"additionalProperties":false');
    expect(rendered).not.toContain('"additionalProperties":true');
  });
});

describe('the descriptor schemas', () => {
  it('take a field and a source descriptor', () => {
    const descriptor: DataSourceDescriptor = {
      id: 'local.tasks',
      source: 'local',
      channel: 'tasks',
      title: 'Tasks',
      description: 'One row per task session.',
      timeField: 'started_at',
      grains: ['day', 'week'],
      fields: [FIELD],
      asOf: null,
      partial: true,
      partialReasons: ['sessions.usage missing'],
    };

    expect(DataSourceDescriptorSchema.parse(descriptor)).toEqual(descriptor);
  });

  it('refuse a field key that is not lower snake case', () => {
    expect(FieldDescriptorSchema.safeParse({ ...FIELD, key: 'tokens; drop table x' }).success).toBe(
      false,
    );
    expect(FieldDescriptorSchema.safeParse({ ...FIELD, key: 'Tokens' }).success).toBe(false);
  });
});

describe('the result and metric schemas', () => {
  it('take a result, and refuse a cell that is no scalar', () => {
    expect(QueryResultSchema.safeParse(RESULT).success).toBe(true);
    expect(QueryResultSchema.safeParse({ ...RESULT, rows: [[{ day: 1 }]] }).success).toBe(false);
  });

  it('take a metric definition with each formula kind', () => {
    const formulas = [
      { kind: 'none' },
      { kind: 'ratio', numerator: 'a', denominator: 'b', as: 'rate' },
      { kind: 'share', of: 'a', as: 'part' },
      { kind: 'cumulative', of: 'a', as: 'total' },
    ];
    const metric = {
      id: 'pm.tokens-per-day',
      title: 'Tokens per day',
      lenses: ['pm'],
      description: 'Tokens summed per day.',
      sourceId: 'local.daily',
      params: { grain: 'day', measures: [{ field: 'tokens_total', agg: 'sum' }] },
      chart: 'line',
      feasibility: 'direct',
    };

    for (const formula of formulas) {
      expect(MetricDefinitionSchema.safeParse({ ...metric, formula }).success).toBe(true);
    }
  });

  it('refuse a formula missing its column, or of a kind not in the four', () => {
    expect(FormulaSchema.safeParse({ kind: 'share', as: 'part' }).success).toBe(false);
    expect(FormulaSchema.safeParse({ kind: 'delta', of: 'a', as: 'b' }).success).toBe(false);
  });

  it('take the four lenses and refuse another', () => {
    expect(LensSchema.safeParse('qa').success).toBe(true);
    expect(LensSchema.safeParse('ops').success).toBe(false);
  });
});

describe('envelopeSchema', () => {
  const schema = envelopeSchema(QueryResultSchema);
  const meta = { asOf: null, version: '1.0.0', elapsedMs: 3 };

  it('takes an ok envelope and an error envelope', () => {
    expect(schema.safeParse({ status: 'ok', data: RESULT, error: null, meta }).success).toBe(true);
    const error = { code: 'invalid_params', message: 'no such field', details: { fields: ['x'] } };
    expect(schema.safeParse({ status: 'error', data: null, error, meta }).success).toBe(true);
  });

  it('refuses an ok envelope with an error, and an error envelope without one', () => {
    const error = { code: 'internal', message: 'internal error' };

    expect(schema.safeParse({ status: 'ok', data: RESULT, error, meta }).success).toBe(false);
    expect(schema.safeParse({ status: 'error', data: null, error: null, meta }).success).toBe(false);
  });

  it('refuses data off the inner schema and an error code outside the set', () => {
    expect(schema.safeParse({ status: 'ok', data: { rows: [] }, error: null, meta }).success).toBe(
      false,
    );
    const error = { code: 'teapot', message: 'no' };
    expect(schema.safeParse({ status: 'error', data: null, error, meta }).success).toBe(false);
  });
});
