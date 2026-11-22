/**
 * Tests for `sql.ts`: each filter operator's condition and bindings, NULL
 * read as a value by `ne`, `in` and `nin`, the refusals, and an
 * identifier that is not lower snake case refused.
 */
import type { Filter } from '../contract/types.js';

import { describe, expect, it } from 'bun:test';

import { InvalidParams } from '../contract/errors.js';

import { filterClause, identifier, MAX_FILTER_VALUES, selectSql } from './sql.js';

function clause(filter: Filter): { readonly sql: string; readonly bindings: readonly unknown[] } {
  return filterClause(filter);
}

describe('filterClause', () => {
  it('binds the value of eq and of each comparison', () => {
    expect(clause({ field: 'tokens', op: 'gte', value: 10 })).toEqual({ sql: '"tokens" >= ?', bindings: [10] });
    expect(clause({ field: 'model', op: 'eq', value: 'opus' })).toEqual({ sql: '"model" = ?', bindings: ['opus'] });
  });

  it('reads ne and nin as true for NULL, unless nin lists NULL', () => {
    expect(clause({ field: 'module', op: 'ne', value: 'cli-gap' }))
      .toEqual({ sql: '("module" IS NULL OR "module" <> ?)', bindings: ['cli-gap'] });
    expect(clause({ field: 'module', op: 'nin', value: ['a', 'b'] }))
      .toEqual({ sql: '("module" IS NULL OR "module" NOT IN (?, ?))', bindings: ['a', 'b'] });
    expect(clause({ field: 'module', op: 'nin', value: ['a', null] }))
      .toEqual({ sql: '("module" IS NOT NULL AND "module" NOT IN (?))', bindings: ['a'] });
  });

  it('matches NULL under in when the list holds it', () => {
    expect(clause({ field: 'module', op: 'in', value: ['a', null] }))
      .toEqual({ sql: '("module" IN (?) OR "module" IS NULL)', bindings: ['a'] });
    expect(clause({ field: 'module', op: 'in', value: [null] })).toEqual({ sql: '"module" IS NULL', bindings: [] });
  });

  it('binds booleans as 1 and 0, and contains as text with no LIKE wildcard', () => {
    expect(clause({ field: 'security', op: 'eq', value: true })).toEqual({ sql: '"security" = ?', bindings: [1] });
    expect(clause({ field: 'what', op: 'contains', value: '50%_' })).toEqual({ sql: 'instr("what", ?) > 0', bindings: ['50%_'] });
  });

  it('asks for NULL with is_null, and for anything else with value false', () => {
    expect(clause({ field: 'status', op: 'is_null' })).toEqual({ sql: '"status" IS NULL', bindings: [] });
    expect(clause({ field: 'status', op: 'is_null', value: false })).toEqual({ sql: '"status" IS NOT NULL', bindings: [] });
  });

  it('refuses a null or list value for eq, an empty or overlong list for in, and text-less contains', () => {
    const tooMany = Array.from({ length: MAX_FILTER_VALUES + 1 }, (_, index) => index);

    expect(() => clause({ field: 'model', op: 'eq', value: null })).toThrow(InvalidParams);
    expect(() => clause({ field: 'model', op: 'eq', value: ['a'] })).toThrow(InvalidParams);
    expect(() => clause({ field: 'model', op: 'in', value: [] })).toThrow(InvalidParams);
    expect(() => clause({ field: 'model', op: 'in', value: tooMany })).toThrow(InvalidParams);
    expect(() => clause({ field: 'model', op: 'contains', value: 3 })).toThrow(InvalidParams);
  });
});

describe('identifier', () => {
  it('quotes a lower snake case name and refuses anything else', () => {
    expect(identifier('task_facts')).toBe('"task_facts"');
    expect(() => identifier('task_facts"; DROP TABLE x; --')).toThrow(InvalidParams);
    expect(() => identifier('Tokens')).toThrow(InvalidParams);
  });
});

describe('selectSql', () => {
  it('bounds the time field half open, orders newest first and asks one row past the cap', () => {
    const select = selectSql({
      table: 'daily_rollup',
      fields: ['day', 'tokens_total'],
      filters: [{ field: 'tokens_total', op: 'gt', value: 0 }],
      time: { field: 'day', from: '2026-11-01', to: '2026-11-08' },
      cap: 10,
    });

    expect(select).toEqual({
      sql: 'SELECT "day", "tokens_total" FROM "daily_rollup" WHERE "day" >= ? AND "day" < ? AND "tokens_total" > ? ORDER BY "day" DESC LIMIT ?',
      bindings: ['2026-11-01', '2026-11-08', 0, 11],
    });
  });
});
