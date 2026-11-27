/**
 * Tests for the hub's install record (`install-record.ts`): its file
 * name and place beside the config file, the writer, and the reader's
 * missing-record default and three refusals.
 *
 * Each refusal sits beside an accepting control of the same record, so
 * a reader that refused everything, or a check that never fired, fails
 * here rather than passing. Every expected sentence is SPELLED, never
 * built from the module's own constants. Records are fixtures written
 * under a fresh `tmpdir` directory per case; no real store, library or
 * model file is read.
 */
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HubConfigError } from './config.js';
import { defaultInstallRecord, installRecordPath, readInstallRecord, writeInstallRecord } from './install-record.js';

/** The running hub's version, as the tests hand it in. */
const HUB = '1.2.3';

/** A model file's SHA-256, as 64 lowercase hex characters. */
const HASH = 'a'.repeat(64);

/** The fixture directory of the case running. */
let root: string;

/** The fixture config file's path, in {@link root}. */
let configPath: string;

/** The record's path beside {@link configPath}. */
let recordPath: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'rafa-hub-install-record-')));
  configPath = join(root, 'hub.yaml');
  recordPath = join(root, 'rafa-hub.install.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A valid format `1` record for the hub at {@link HUB}, with `overrides` over it. */
function recordWith(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    installVersion: 1,
    hub: HUB,
    bun: '1.3.14',
    dataDir: '/data',
    sqliteLibrary: null,
    models: [{ id: 'minilm', path: '/models/minilm.gguf', hash: HASH, dimension: 384 }],
    ...overrides,
  };
}

/** A valid format `1` record for the hub at {@link HUB}, with `key` left out. */
function recordWithout(key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(recordWith()).filter(([name]) => name !== key));
}

/** Writes `raw` as the record's file, JSON unless it is already text. */
async function plant(raw: unknown): Promise<void> {
  const text = typeof raw === 'string'
    ? raw
    : JSON.stringify(raw);
  await writeFile(recordPath, text, 'utf8');
}

/** The problems `readInstallRecord` refuses with, or a failure when it reads. */
async function refusalOf(hubVersion: string = HUB): Promise<readonly string[]> {
  try {
    await readInstallRecord(configPath, hubVersion);
  } catch (error) {
    expect(error).toBeInstanceOf(HubConfigError);
    return (error as HubConfigError).problems;
  }
  throw new Error('expected the record to be refused, and it was read');
}

describe('installRecordPath', () => {
  it('names rafa-hub.install.json beside the config file', () => {
    expect(installRecordPath('/data/hub.yaml')).toBe('/data/rafa-hub.install.json');
  });

  it('resolves a relative config path against the working directory', () => {
    expect(installRecordPath('conf/hub.yaml')).toBe(join(process.cwd(), 'conf', 'rafa-hub.install.json'));
  });
});

describe('defaultInstallRecord', () => {
  it('holds the config file\'s directory, no library and no models', () => {
    expect(defaultInstallRecord('/srv/hub/hub.yaml', HUB)).toEqual({
      installVersion: 1,
      hub: HUB,
      bun: Bun.version,
      dataDir: '/srv/hub',
      sqliteLibrary: null,
      models: [],
    });
  });
});

describe('readInstallRecord with no record', () => {
  it('answers the defaults and one warning line naming rafa-hub install', async () => {
    const reading = await readInstallRecord(configPath, HUB);

    expect(reading.record).toEqual(defaultInstallRecord(configPath, HUB));
    expect(reading.record.dataDir).toBe(root);
    expect(reading.path).toBe(recordPath);
    expect(reading.warning).toBe(`${recordPath}: no install record; using the defaults (dataDir ${root}, no SQLite library, no models); run rafa-hub install to write one`);
  });

  it('answers no warning once a record exists', async () => {
    await plant(recordWith());

    const reading = await readInstallRecord(configPath, HUB);

    expect(reading.warning).toBeNull();
    expect(reading.record).toEqual(recordWith() as never);
    expect(Object.isFrozen(reading.record)).toBe(true);
    expect(Object.isFrozen(reading.record.models)).toBe(true);
  });

  it('refuses a record path it cannot read rather than answering the defaults', async () => {
    await mkdir(recordPath);

    const problems = await refusalOf();

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith(`${recordPath}: the install record could not be read: `);
    expect(problems[0]).toEndWith('; run rafa-hub install');
  });
});

describe('readInstallRecord refuses another format', () => {
  it('reads installVersion 1', async () => {
    await plant(recordWith({ installVersion: 1 }));

    expect((await readInstallRecord(configPath, HUB)).record.installVersion).toBe(1);
  });

  it.each([[2], ['1'], [null]])('refuses installVersion %p', async (installVersion) => {
    await plant(recordWith({ installVersion }));

    expect(await refusalOf()).toEqual([
      `${recordPath}: installVersion is ${JSON.stringify(installVersion)}, expected 1, the install record format this hub reads; run rafa-hub install`,
    ]);
  });

  it('refuses a record with no installVersion', async () => {
    await plant(recordWithout('installVersion'));

    expect(await refusalOf()).toEqual([
      `${recordPath}: installVersion is missing, expected 1, the install record format this hub reads; run rafa-hub install`,
    ]);
  });
});

describe('readInstallRecord refuses another hub version', () => {
  it('reads a record its own version wrote', async () => {
    await plant(recordWith({ hub: '0.9.0' }));

    expect((await readInstallRecord(configPath, '0.9.0')).record.hub).toBe('0.9.0');
  });

  it('refuses a record another version wrote, naming both', async () => {
    await plant(recordWith({ hub: '0.9.0' }));

    expect(await refusalOf('1.0.0')).toEqual([`${recordPath}: written by hub 0.9.0, and this hub is 1.0.0; run rafa-hub install`]);
  });

  it('names the version before a shape problem of the same record', async () => {
    await plant(recordWith({ hub: '0.9.0', dataDir: 'relative' }));

    expect(await refusalOf('1.0.0')).toEqual([`${recordPath}: written by hub 0.9.0, and this hub is 1.0.0; run rafa-hub install`]);
  });
});

describe('readInstallRecord refuses a file that is no valid record', () => {
  /** A shape problem of the record, as the reader spells it. */
  function invalid(what: string): string {
    return `${recordPath}: not a valid install record: ${what}; run rafa-hub install`;
  }

  it('reads a record with no models and a library path', async () => {
    await plant(recordWith({ models: [], sqliteLibrary: '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib' }));

    const { record } = await readInstallRecord(configPath, HUB);

    expect(record.models).toEqual([]);
    expect(record.sqliteLibrary).toBe('/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib');
  });

  it('refuses text that is not JSON', async () => {
    await plant('{ installVersion: 1');

    const problems = await refusalOf();

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith(`${recordPath}: not a valid install record: not valid JSON: `);
    expect(problems[0]).toEndWith('; run rafa-hub install');
  });

  it.each([['[]', '[]'], ['null', 'null'], ['"text"', '"text"']])('refuses %s, which is no JSON object', async (text, shown) => {
    await plant(text);

    expect(await refusalOf()).toEqual([invalid(`${shown} is no JSON object`)]);
  });

  it('refuses a missing key and an unknown one, each once', async () => {
    await plant({ ...recordWithout('bun'), addons: [] });

    expect(await refusalOf()).toEqual([
      invalid('bun is missing'),
      invalid('addons is not a key of install record format 1'),
    ]);
  });

  it('refuses a hub that is no string', async () => {
    await plant(recordWith({ hub: 123 }));

    expect(await refusalOf()).toEqual([invalid('hub is 123, expected the version of the hub that wrote the record')]);
  });

  it('refuses each scalar of the wrong shape, every problem at once', async () => {
    await plant(recordWith({ bun: '', dataDir: 'data', sqliteLibrary: 'lib/libsqlite3.so' }));

    expect(await refusalOf()).toEqual([
      invalid('bun is "", expected the Bun version the hub was installed with'),
      invalid('dataDir is "data", expected an absolute directory path'),
      invalid('sqliteLibrary is "lib/libsqlite3.so", expected the SQLite library\'s absolute path, or null'),
    ]);
  });

  it('refuses models that are no list', async () => {
    await plant(recordWith({ models: {} }));

    expect(await refusalOf()).toEqual([invalid('models is {}, expected a list of models, empty when none is installed')]);
  });

  it('refuses each model field of the wrong shape', async () => {
    await plant(recordWith({
      models: [
        'minilm',
        { id: '', path: 'models/m.gguf', hash: 'A'.repeat(64), dimension: 0 },
        { id: 'm', path: '/m.gguf', hash: HASH, dimension: 1.5, size: 3 },
      ],
    }));

    expect(await refusalOf()).toEqual([
      invalid('models[0] is "minilm", expected an object holding id, path, hash, dimension'),
      invalid('models[1].id is "", expected a non-empty model id'),
      invalid('models[1].path is "models/m.gguf", expected the model file\'s absolute path'),
      invalid(`models[1].hash is "${'A'.repeat(64)}", expected the model file's SHA-256 as 64 lowercase hex characters`),
      invalid('models[1].dimension is 0, expected a whole number above 0'),
      invalid('models[2].size is not a key of install record format 1'),
      invalid('models[2].dimension is 1.5, expected a whole number above 0'),
    ]);
  });

  it('refuses a model missing a key', async () => {
    await plant(recordWith({ models: [{ id: 'minilm', path: '/m.gguf', hash: HASH }] }));

    expect(await refusalOf()).toEqual([invalid('models[0].dimension is missing')]);
  });

  it('refuses two models with one id', async () => {
    const model = { id: 'minilm', path: '/m.gguf', hash: HASH, dimension: 384 };
    await plant(recordWith({ models: [model, { ...model, path: '/n.gguf' }] }));

    expect(await refusalOf()).toEqual([invalid('models holds "minilm" more than once, expected one entry per model id')]);
  });
});

describe('writeInstallRecord', () => {
  it('writes the whole record as the reader reads it back', async () => {
    const record = recordWith() as never;

    await writeInstallRecord(recordPath, record);

    expect((await readInstallRecord(configPath, HUB)).record).toEqual(record);
    expect(await readFile(recordPath, 'utf8')).toBe(`${JSON.stringify(recordWith(), null, 2)}\n`);
  });

  it('replaces a record already there, leaving no staged file', async () => {
    await writeInstallRecord(recordPath, recordWith({ dataDir: '/old' }) as never);

    await writeInstallRecord(recordPath, recordWith({ dataDir: '/new' }) as never);

    expect((await readInstallRecord(configPath, HUB)).record.dataDir).toBe('/new');
    expect(await readdir(root)).toEqual(['rafa-hub.install.json']);
  });

  it('creates the directory the record goes in', async () => {
    const nested = join(root, 'data', 'rafa-hub.install.json');

    await writeInstallRecord(nested, defaultInstallRecord(nested, HUB));

    expect((await readInstallRecord(nested, HUB)).warning).toBeNull();
  });

  it('refuses a record the reader would refuse, writing nothing', async () => {
    let thrown: unknown;
    try {
      await writeInstallRecord(recordPath, recordWith({ dataDir: 'data' }) as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HubConfigError);
    expect((thrown as HubConfigError).problems).toEqual([
      `${recordPath}: not a valid install record: dataDir is "data", expected an absolute directory path; run rafa-hub install`,
    ]);
    expect(await readdir(root)).toEqual([]);
  });
});
