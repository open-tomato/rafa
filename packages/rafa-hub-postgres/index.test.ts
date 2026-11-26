/**
 * The package's entry and its `drizzle-kit` config: the entry exports
 * plain strings alone, as the leak rule asks, and the config points
 * `drizzle-kit` at the layout the entry names, on Postgres, with no
 * database or URL in it.
 */
import { describe, expect, it } from 'bun:test';

import config from './drizzle.config.js';

import * as entry from './index.js';

describe('the package entry', () => {
  it('exports the layout of the Drizzle files and nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual(['MIGRATIONS_FOLDER', 'SCHEMA_FILE']);
  });

  it('exports plain strings, no Drizzle value', () => {
    expect(Object.values(entry).filter((value) => typeof value !== 'string')).toEqual([]);
  });
});

describe('drizzle.config.ts', () => {
  it('generates for Postgres', () => {
    expect(config.dialect).toBe('postgresql');
  });

  it('reads the schema file and writes the migrations folder the entry names', () => {
    expect(config.schema).toBe(`./${entry.SCHEMA_FILE}`);
    expect(config.out).toBe(`./${entry.MIGRATIONS_FOLDER}`);
  });

  it('names no database and no URL', () => {
    expect(Object.keys(config).sort()).toEqual(['dialect', 'out', 'schema']);
  });
});
