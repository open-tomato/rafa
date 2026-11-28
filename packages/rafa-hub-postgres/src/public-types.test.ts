/**
 * The leak rule as a type test: no public export of the package names a
 * Drizzle or `Bun.sql` type, directly or through the
 * port's `HubStore` and `HubIndex` and the other types of the repository
 * its signature reaches (`testdata/public-type-leaks.ts`).
 *
 * The fixture `testdata/leaking-exports.fixture.ts` plants the faults, one
 * export each, beside clean controls: the reading that passes over the
 * entry fails over it.
 */
import type { PublicTypeReading } from './testdata/public-type-leaks.js';

import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import manifest from '../package.json';

import { readPublicTypes } from './testdata/public-type-leaks.js';

/** Building the program over the package and what it imports takes seconds, more on a loaded machine. */
const PROGRAM_TIMEOUT = 120_000;

setDefaultTimeout(PROGRAM_TIMEOUT);

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSCONFIG = `${PACKAGE_ROOT}tsconfig.json`;
const ENTRY = `${PACKAGE_ROOT}index.ts`;
const FIXTURE = `${PACKAGE_ROOT}src/testdata/leaking-exports.fixture.ts`;

/** The fixture's exports that plant a fault, each with the banned declaration it must be caught reaching. */
const PLANTED: Readonly<Record<string, string>> = {
  LeakedDatabase: 'BunSQLDatabase',
  LeakedDeprecatedQuery: 'Query',
  LeakedFragment: 'SQL',
  LeakedNestedOptions: 'TransactionSQL',
  eq: 'eq',
  leakedClient: 'SQL',
  leakedGlobalClient: 'sql',
  leakedImported: 'BunSQLDatabase',
};

/** The fixture's exports that name neither, which the reading must pass. */
const CONTROLS = ['CleanStore', 'cleanText'];

let entry: PublicTypeReading;
let fixture: PublicTypeReading;

beforeAll(() => {
  const readings = readPublicTypes(TSCONFIG, [ENTRY, FIXTURE]);
  entry = readings.get(ENTRY)!;
  fixture = readings.get(FIXTURE)!;
}, PROGRAM_TIMEOUT);

describe('the public types of the package', () => {
  it('has one public entry, the one read here', () => {
    expect(manifest.exports).toEqual({ '.': './index.ts' });
  });

  it('reads every export of the entry, values and types', () => {
    expect(entry.exports).toEqual([
      'EmbeddingPrecision',
      'EmbeddingRecord',
      'MIGRATIONS_FOLDER',
      'PostgresHubOptions',
      'PostgresIndexProbe',
      'PostgresIndexProbeOptions',
      'ReembedOutcome',
      'SCHEMA_FILE',
      'connectPostgresHub',
      'postgresIndexProbe',
    ]);
  });

  it('follows the signatures into the port, HubStore and HubIndex included', () => {
    expect(entry.reached).toEqual(expect.arrayContaining(['HubConnector', 'HubStore', 'HubIndex', 'HubStoreContext', 'IndexEmbedder']));
  });

  it('names no Drizzle and no Bun.sql type', () => {
    expect(entry.leaks).toEqual([]);
  });
});

describe('the planted fixture', () => {
  it('holds the planted exports and the controls', () => {
    expect(fixture.exports).toEqual([...Object.keys(PLANTED), ...CONTROLS].sort());
  });

  it('is red on every planted export and on no control', () => {
    const caught = [...new Set(fixture.leaks.map((leak) => leak.exportName))].sort();

    expect(caught).toEqual(Object.keys(PLANTED).sort());
  });

  it.each(Object.entries(PLANTED))('catches %s reaching %s', (exportName, typeName) => {
    const named = fixture.leaks.filter((leak) => leak.exportName === exportName).map((leak) => leak.typeName);

    expect(named).toContain(typeName);
  });

  it('says which library each leaked type comes from', () => {
    const libraryOf = (exportName: string): string[] => [
      ...new Set(fixture.leaks.filter((leak) => leak.exportName === exportName).map((leak) => leak.library)),
    ];

    expect(libraryOf('LeakedFragment')).toEqual(['drizzle']);
    expect(libraryOf('leakedClient')).toEqual(['Bun.sql']);
  });
});
