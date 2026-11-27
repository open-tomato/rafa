/**
 * Tests for the readers of `hub.store` and `hub.index`
 * (`config-store.ts`): each key's default, each value refused,
 * `hub.store.postgres` refused under `engine: sqlite`, the SQLite library
 * chosen between the install record and `hub.store.sqliteLibrary`, and
 * the readings reaching `parseHubConfig`.
 *
 * Each refusal sits beside an accepting control of the same key, so a
 * reader that refused everything, or a check that never fired, fails
 * here rather than passing. Every refusal is spelled, never built from
 * the module's own constants. A section is handed in as the YAML a
 * config file would hold under `hub.store` or `hub.index`.
 */
import type { HubIndexConfig, HubStoreConfig, SectionReading, SqliteLibraryChoice } from './config-store.js';

import { describe, expect, it } from 'bun:test';

import { chooseSqliteLibrary, readIndexConfig, readStoreConfig } from './config-store.js';
import { parseHubConfig } from './config.js';

/** The config file's path, as a refusal names it. */
const PATH = '/srv/hub/hub.yaml';

/** What `hub.store.engine` says it expected. */
const ENGINE_EXPECTED = 'expected sqlite or postgres';

/** What `hub.store.sqliteLibrary` says it expected. */
const LIBRARY_EXPECTED = 'expected an absolute path to a vanilla libsqlite3, such as /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib';

/** What `hub.store.postgres.urlVariable` says it expected. */
const URL_VARIABLE_EXPECTED = 'expected an environment variable name of A-Z, 0-9 and _, not opening with a digit, such as POSTGRES_URL; the value written is not repeated';

/** Why `hub.store.postgres` is refused under `engine: sqlite`. */
const UNDER_SQLITE = 'is set while hub.store.engine is sqlite; expected hub.store.engine: postgres beside it, or no hub.store.postgres';

/** What `hub.index.rebuildAfterPush` says it expected. */
const REBUILD_EXPECTED = 'expected true or false';

/** What `hub.index.embedding.model` says it expected. */
const MODEL_EXPECTED = 'expected a model name of non-empty text with no white space at either end, such as nomic-embed-text-v1.5';

/** What `hub.index.embedding.precision` says it expected. */
const PRECISION_EXPECTED = 'expected half or full';

/** The section `lines` spell, as YAML parses it; undefined for no lines, a section left out. */
function yaml(...lines: string[]): unknown {
  return lines.length === 0
    ? undefined
    : Bun.YAML.parse(lines.join('\n'));
}

/** The `hub.store` reading of the section `lines` spell. */
function store(...lines: string[]): SectionReading<HubStoreConfig> {
  return readStoreConfig(PATH, yaml(...lines));
}

/** The `hub.index` reading of the section `lines` spell. */
function index(...lines: string[]): SectionReading<HubIndexConfig> {
  return readIndexConfig(PATH, yaml(...lines));
}

describe('hub.store defaults', () => {
  it('reads sqlite, no URL variable and no library when the section is left out or empty', () => {
    const expected: SectionReading<HubStoreConfig> = { value: { storeEngine: 'sqlite', postgresUrlVariable: null, sqliteLibrary: null }, problems: [] };

    expect(store()).toEqual(expected);
    expect(store('{}')).toEqual(expected);
    expect(Object.isFrozen(store().value)).toBe(true);
  });

  it('reads POSTGRES_URL under postgres when urlVariable or the whole postgres section is left out', () => {
    expect(store('engine: postgres').value).toEqual({ storeEngine: 'postgres', postgresUrlVariable: 'POSTGRES_URL', sqliteLibrary: null });
    expect(store('engine: postgres', 'postgres: {}').value?.postgresUrlVariable).toBe('POSTGRES_URL');
  });
});

describe('hub.store.engine', () => {
  it('reads sqlite and postgres as written', () => {
    expect([store('engine: sqlite').value?.storeEngine, store('engine: postgres').value?.storeEngine]).toEqual(['sqlite', 'postgres']);
  });

  it('refuses another engine, another case, a number and null without coercing', () => {
    const cases = ['mysql', 'Postgres', 'SQLITE', '1', 'null', '\'\''];

    expect(cases.map((raw) => store(`engine: ${raw}`).problems)).toEqual([
      [`/srv/hub/hub.yaml: hub.store.engine is "mysql", ${ENGINE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.engine is "Postgres", ${ENGINE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.engine is "SQLITE", ${ENGINE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.engine is 1, ${ENGINE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.engine is null, ${ENGINE_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.engine is "", ${ENGINE_EXPECTED}`],
    ]);
  });
});

describe('hub.store.postgres.urlVariable', () => {
  it('keeps a variable name as written under postgres', () => {
    const names = ['POSTGRES_URL', 'RAFA_HUB_DATABASE', '_PG1'];

    expect(names.map((name) => store('engine: postgres', 'postgres:', `  urlVariable: ${name}`).value?.postgresUrlVariable)).toEqual(names);
  });

  it('refuses what is no variable name, never repeating the value written', () => {
    const url = 'postgres://hub:s3cret@db.internal/rafa';
    const cases = [`'${url}'`, 'postgres_url', '1POSTGRES', '\'\'', '\' POSTGRES_URL\'', '42', 'null', '[POSTGRES_URL]'];
    const refused = cases.map((raw) => store('engine: postgres', 'postgres:', `  urlVariable: ${raw}`).problems);

    expect(refused).toEqual(cases.map(() => [`/srv/hub/hub.yaml: hub.store.postgres.urlVariable is not an environment variable name, ${URL_VARIABLE_EXPECTED}`]));
    expect(refused.flat().some((problem) => problem.includes('s3cret') || problem.includes('db.internal'))).toBe(false);
  });

  it('refuses a postgres section that is not a mapping and an unknown key under it, the url key included', () => {
    expect(store('engine: postgres', 'postgres: POSTGRES_URL').problems).toEqual([
      '/srv/hub/hub.yaml: hub.store.postgres is "POSTGRES_URL", expected a mapping holding urlVariable',
    ]);
    expect(store('engine: postgres', 'postgres:', '  url: postgres://hub:s3cret@db/rafa').problems).toEqual([
      '/srv/hub/hub.yaml: hub.store.postgres.url is not a key the hub reads; expected one of hub.store.postgres.urlVariable',
    ]);
  });
});

describe('hub.store.postgres under engine: sqlite', () => {
  it('refuses each postgres key under sqlite written and left to its default', () => {
    expect(store('engine: sqlite', 'postgres:', '  urlVariable: POSTGRES_URL').problems).toEqual([
      `/srv/hub/hub.yaml: hub.store.postgres.urlVariable ${UNDER_SQLITE}`,
    ]);
    expect(store('postgres:', '  urlVariable: POSTGRES_URL').problems).toEqual([
      `/srv/hub/hub.yaml: hub.store.postgres.urlVariable ${UNDER_SQLITE}`,
    ]);
  });

  it('refuses an empty or scalar postgres section under sqlite by its own name', () => {
    expect([store('postgres: {}').problems, store('postgres: POSTGRES_URL').problems]).toEqual([
      [`/srv/hub/hub.yaml: hub.store.postgres ${UNDER_SQLITE}`],
      [`/srv/hub/hub.yaml: hub.store.postgres ${UNDER_SQLITE}`],
    ]);
  });

  it('names an unknown postgres key under sqlite as unknown, beside a known one refused for the engine', () => {
    expect(store('postgres:', '  url: postgres://db/rafa', '  urlVariable: POSTGRES_URL').problems).toEqual([
      '/srv/hub/hub.yaml: hub.store.postgres.url is not a key the hub reads; expected one of hub.store.postgres.urlVariable',
      `/srv/hub/hub.yaml: hub.store.postgres.urlVariable ${UNDER_SQLITE}`,
    ]);
  });

  it('checks only the shape of postgres when the engine itself is refused', () => {
    expect(store('engine: mysql', 'postgres:', '  urlVariable: POSTGRES_URL').problems).toEqual([
      `/srv/hub/hub.yaml: hub.store.engine is "mysql", ${ENGINE_EXPECTED}`,
    ]);
    expect(store('engine: mysql', 'postgres:', '  urlVariable: pg').problems).toEqual([
      `/srv/hub/hub.yaml: hub.store.engine is "mysql", ${ENGINE_EXPECTED}`,
    ]);
  });
});

describe('hub.store.sqliteLibrary', () => {
  it('refuses a relative path, a padded path and an empty string, naming an absolute one', () => {
    const cases = ['lib/libsqlite3.dylib', './libsqlite3.dylib', '\' /opt/sqlite/libsqlite3.dylib\'', '\'\''];

    expect(cases.map((raw) => store(`sqliteLibrary: ${raw}`).problems)).toEqual([
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is "lib/libsqlite3.dylib", ${LIBRARY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is "./libsqlite3.dylib", ${LIBRARY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is " /opt/sqlite/libsqlite3.dylib", ${LIBRARY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is "", ${LIBRARY_EXPECTED}`],
    ]);
  });

  it('refuses a number, a boolean, null and a list without coercing', () => {
    const cases = ['42', 'true', 'null', '[/opt/sqlite/libsqlite3.dylib]'];

    expect(cases.map((raw) => store(`sqliteLibrary: ${raw}`).problems)).toEqual([
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is 42, ${LIBRARY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is true, ${LIBRARY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is null, ${LIBRARY_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.store.sqliteLibrary is /opt/sqlite/libsqlite3.dylib, ${LIBRARY_EXPECTED}`],
    ]);
  });

  it('keeps an absolute path as written, under either engine', () => {
    expect([
      store('sqliteLibrary: /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib').value?.sqliteLibrary,
      store('sqliteLibrary: /usr/lib/../lib/libsqlite3.so').value?.sqliteLibrary,
      store('engine: postgres', 'sqliteLibrary: /usr/lib/libsqlite3.so').value?.sqliteLibrary,
    ]).toEqual(['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/lib/../lib/libsqlite3.so', '/usr/lib/libsqlite3.so']);
  });
});

/** The install record's path, as a warning and a refusal name it. */
const RECORD = '/srv/hub/rafa-hub.install.json';

/** A library the record or the file names. */
const HOMEBREW = '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib';

/** The library {@link chooseSqliteLibrary} picks from the record's `record` and the file's `file`. */
function choose(record: string | null, file: string | null): SectionReading<SqliteLibraryChoice> {
  return chooseSqliteLibrary({ path: RECORD, library: record }, { path: PATH, library: file });
}

/** The warning `hub.store.sqliteLibrary` gives when it names `library`. */
function keyWarning(library: string): string {
  return `/srv/hub/hub.yaml: hub.store.sqliteLibrary is read for this release only; run rafa-hub install --sqlite-library=${library} to record it in /srv/hub/rafa-hub.install.json, then remove the key`;
}

describe('chooseSqliteLibrary', () => {
  it('loads the record\'s library, or none, with no warning, when the file names none', () => {
    expect([choose(HOMEBREW, null), choose(null, null)]).toEqual([
      { value: { library: HOMEBREW, warning: null }, problems: [] },
      { value: { library: null, warning: null }, problems: [] },
    ]);
    expect(Object.isFrozen(choose(HOMEBREW, null).value)).toBe(true);
  });

  it('loads the file\'s library with one warning naming rafa-hub install when the record names none', () => {
    expect(choose(null, HOMEBREW)).toEqual({ value: { library: HOMEBREW, warning: keyWarning(HOMEBREW) }, problems: [] });
  });

  it('loads the record\'s library, still warning, when both name one library, written alike or by two spellings of one path', () => {
    expect([choose(HOMEBREW, HOMEBREW), choose('/usr/lib/libsqlite3.so', '/usr/lib/../lib/libsqlite3.so')]).toEqual([
      { value: { library: HOMEBREW, warning: keyWarning(HOMEBREW) }, problems: [] },
      { value: { library: '/usr/lib/libsqlite3.so', warning: keyWarning('/usr/lib/../lib/libsqlite3.so') }, problems: [] },
    ]);
  });

  it('refuses two different libraries with one problem naming both files, both libraries and rafa-hub install', () => {
    expect(choose('/usr/lib/libsqlite3.so', HOMEBREW)).toEqual({
      problems: [
        '/srv/hub/hub.yaml: hub.store.sqliteLibrary is "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib" and the install record /srv/hub/rafa-hub.install.json names "/usr/lib/libsqlite3.so"; expected one library: remove hub.store.sqliteLibrary, or run rafa-hub install --sqlite-library=/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib to record it instead',
      ],
    });
  });
});

describe('hub.index defaults', () => {
  it('reads a rebuild after each push, no model and half precision when the section or embedding is left out or empty', () => {
    const expected: SectionReading<HubIndexConfig> = { value: { rebuildAfterPush: true, embeddingModel: null, embeddingPrecision: 'half' }, problems: [] };

    expect(index()).toEqual(expected);
    expect(index('{}')).toEqual(expected);
    expect(index('embedding: {}')).toEqual(expected);
    expect(Object.isFrozen(index().value)).toBe(true);
  });
});

describe('hub.index.rebuildAfterPush', () => {
  it('refuses a quoted boolean, a number, null and yes without coercing', () => {
    const cases = ['\'false\'', '0', '1', 'null', 'yes'];

    expect(cases.map((raw) => index(`rebuildAfterPush: ${raw}`).problems)).toEqual([
      [`/srv/hub/hub.yaml: hub.index.rebuildAfterPush is "false", ${REBUILD_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.rebuildAfterPush is 0, ${REBUILD_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.rebuildAfterPush is 1, ${REBUILD_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.rebuildAfterPush is null, ${REBUILD_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.rebuildAfterPush is "yes", ${REBUILD_EXPECTED}`],
    ]);
  });

  it('reads true and false as written', () => {
    expect([index('rebuildAfterPush: false').value?.rebuildAfterPush, index('rebuildAfterPush: true').value?.rebuildAfterPush]).toEqual([false, true]);
  });
});

describe('hub.index.embedding.model', () => {
  it('keeps a model name as written', () => {
    const names = ['nomic-embed-text-v1.5', 'bge small en', 'org/model:Q4_K_M'];

    expect(names.map((name) => index('embedding:', `  model: '${name}'`).value?.embeddingModel)).toEqual(names);
  });

  it('refuses empty text, padded text, a number, null and a list without coercing', () => {
    const cases = ['\'\'', '\' nomic\'', '\'nomic \'', '768', 'null', '[nomic]'];

    expect(cases.map((raw) => index('embedding:', `  model: ${raw}`).problems)).toEqual([
      [`/srv/hub/hub.yaml: hub.index.embedding.model is "", ${MODEL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.model is " nomic", ${MODEL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.model is "nomic ", ${MODEL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.model is 768, ${MODEL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.model is null, ${MODEL_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.model is nomic, ${MODEL_EXPECTED}`],
    ]);
  });
});

describe('hub.index.embedding.precision', () => {
  it('reads half and full as written, with or without a model', () => {
    expect([
      index('embedding:', '  precision: half').value?.embeddingPrecision,
      index('embedding:', '  precision: full').value?.embeddingPrecision,
      index('embedding:', '  model: nomic-embed-text-v1.5', '  precision: full').value,
    ]).toEqual(['half', 'full', { rebuildAfterPush: true, embeddingModel: 'nomic-embed-text-v1.5', embeddingPrecision: 'full' }]);
  });

  it('refuses another precision, another case, a width, null and a boolean without coercing', () => {
    const cases = ['double', 'Half', '16', 'null', 'true'];

    expect(cases.map((raw) => index('embedding:', `  precision: ${raw}`).problems)).toEqual([
      [`/srv/hub/hub.yaml: hub.index.embedding.precision is "double", ${PRECISION_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.precision is "Half", ${PRECISION_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.precision is 16, ${PRECISION_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.precision is null, ${PRECISION_EXPECTED}`],
      [`/srv/hub/hub.yaml: hub.index.embedding.precision is true, ${PRECISION_EXPECTED}`],
    ]);
  });

  it('refuses an embedding section that is not a mapping and a key it does not read, dimension included', () => {
    expect(index('embedding: nomic').problems).toEqual([
      '/srv/hub/hub.yaml: hub.index.embedding is "nomic", expected a mapping holding model, precision',
    ]);
    expect(index('embedding:', '  model: nomic-embed-text-v1.5', '  dimension: 768').problems).toEqual([
      '/srv/hub/hub.yaml: hub.index.embedding.dimension is not a key the hub reads; expected one of hub.index.embedding.model, hub.index.embedding.precision',
    ]);
  });
});

describe('the readings in parseHubConfig', () => {
  it('sets a postgres store and an embedding on the hub config, and refuses them with every other problem', () => {
    const text = (...lines: string[]) => ['hub:', '  repository: open-tomato/rafa', ...lines.map((line) => `  ${line}`)].join('\n');

    expect(parseHubConfig(text('store:', '  engine: postgres', 'index:', '  embedding:', '    model: nomic-embed-text-v1.5'), PATH)).toMatchObject({
      storeEngine: 'postgres',
      postgresUrlVariable: 'POSTGRES_URL',
      sqliteLibrary: null,
      rebuildAfterPush: true,
      embeddingModel: 'nomic-embed-text-v1.5',
      embeddingPrecision: 'half',
    });
    expect(() => parseHubConfig(text('port: 0', 'store:', '  postgres: {}', 'index:', '  embedding:', '    precision: double'), PATH)).toThrow([
      '/srv/hub/hub.yaml: hub.port is 0, expected a whole number from 1 to 65535, such as 7373',
      `/srv/hub/hub.yaml: hub.store.postgres ${UNDER_SQLITE}`,
      `/srv/hub/hub.yaml: hub.index.embedding.precision is "double", ${PRECISION_EXPECTED}`,
    ].join('\n'));
  });
});
