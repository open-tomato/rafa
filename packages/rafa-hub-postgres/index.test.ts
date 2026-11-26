/**
 * The package's entry and its `drizzle-kit` config: the entry exports
 * the connector's function and plain strings alone, no Drizzle or
 * `Bun.sql` value, as the leak rule asks, and the config points
 * `drizzle-kit` at the layout the entry names, on Postgres, with no
 * database or URL in it.
 */
import { describe, expect, it } from 'bun:test';

import config from './drizzle.config.js';

import * as entry from './index.js';

describe('the package entry', () => {
  it('exports the connector and the layout of the Drizzle files, and nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual(['MIGRATIONS_FOLDER', 'SCHEMA_FILE', 'connectPostgresHub']);
  });

  it('exports plain strings beside the connector\'s function, no Drizzle value', () => {
    const values = Object.entries(entry).filter(([name]) => name !== 'connectPostgresHub');

    expect(values.filter(([, value]) => typeof value !== 'string')).toEqual([]);
    expect(typeof entry.connectPostgresHub).toBe('function');
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
