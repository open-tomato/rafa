/**
 * Tests for `standard.ts`: `validateStandard` over a zod schema, and over a
 * hand-written Standard Schema that is no zod, sync and async.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { describe, expect, it } from 'bun:test';

import { QueryParamsSchema } from './schemas.js';
import { validateStandard } from './standard.js';

/** A Standard Schema of positive numbers, with no zod behind it. */
function positive(delay: boolean): StandardSchemaV1<unknown, number> {
  function check(value: unknown): StandardSchemaV1.Result<number> {
    return typeof value === 'number' && value > 0
      ? { value }
      : { issues: [{ message: 'not a positive number' }] };
  }
  return {
    '~standard': {
      version: 1,
      vendor: 'hand',
      validate: (value) => delay
        ? Promise.resolve(check(value))
        : check(value),
    },
  };
}

describe('validateStandard over zod', () => {
  it('answers the parsed value for valid params', async () => {
    const validated = await validateStandard(QueryParamsSchema, { grain: 'day' });

    expect(validated).toEqual({ ok: true, value: { grain: 'day' } });
  });

  it('answers the issues, with their paths, for invalid params', async () => {
    const validated = await validateStandard(QueryParamsSchema, { limit: 0 });

    expect(validated.ok).toBe(false);
    const issues = validated.ok
      ? []
      : validated.issues;
    expect(issues.length).toBe(1);
    expect(issues[0]?.path).toEqual(['limit']);
  });
});

describe('validateStandard over a schema that is no zod', () => {
  it('reads only ~standard, sync or async', async () => {
    for (const delay of [false, true]) {
      expect(await validateStandard(positive(delay), 3)).toEqual({ ok: true, value: 3 });
      expect(await validateStandard(positive(delay), -1)).toEqual({
        ok: false,
        issues: [{ message: 'not a positive number' }],
      });
    }
  });
});
