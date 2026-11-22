/**
 * Tests for `errors.ts`: `InvalidParams` as an `Error` whose details are
 * the field names it was handed, and nothing else.
 */
import { describe, expect, it } from 'bun:test';

import { InvalidParams } from './errors.js';

describe('InvalidParams', () => {
  it('is an Error named InvalidParams carrying its message', () => {
    const error = new InvalidParams('no field tokens', ['tokens']);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(InvalidParams);
    expect(error.name).toBe('InvalidParams');
    expect(error.message).toBe('no field tokens');
  });

  it('holds the field names in details, copied from the list handed in', () => {
    const fields = ['model', 'agent'];
    const error = new InvalidParams('cannot group', fields);
    fields.push('later');

    expect(error.details).toEqual({ fields: ['model', 'agent'] });
  });

  it('holds an empty list when handed no field', () => {
    expect(new InvalidParams('bad').details).toEqual({ fields: [] });
  });
});
