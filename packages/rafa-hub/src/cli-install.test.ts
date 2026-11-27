/**
 * Unit tests for `rafa-hub install` (`cli-install.ts`): its arguments,
 * the record it writes beside the config file, the model file's
 * SHA-256, flags left out keeping the record's values, the records it
 * replaces and its refusals. Every case writes fixtures under its own
 * temporary directory; no real store, library or model file is read.
 */
import type { HubInstallRecord } from './install-record.js';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { installCommandOf, installedLine, runInstall, sha256OfFile } from './cli-install.js';
import { HUB_CONFIG_ENV } from './config.js';
import { INSTALL_RECORD_FILE, readInstallRecord, writeInstallRecord } from './install-record.js';

const HUB = '1.4.0';
const OTHER_HUB = '1.3.0';

let root = '';
let configPath = '';
let recordPath = '';
let env: Readonly<Record<string, string | undefined>> = {};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-install-')));
  configPath = join(root, 'rafa-hub.yaml');
  recordPath = join(root, INSTALL_RECORD_FILE);
  env = { [HUB_CONFIG_ENV]: configPath };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** One run's exit code and the lines it printed on each stream. */
interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

/** Runs `rafa-hub install` over `args` for a hub at `hub`, collecting its lines. */
async function install(args: readonly string[], hub = HUB, environment = env): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runInstall(args, environment, hub, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out, err };
}

/** The record file as JSON, unchecked. */
function recordOnDisk(): unknown {
  return JSON.parse(readFileSync(recordPath, 'utf8'));
}

/** Writes a fixture file holding `text` at `name` under the case's root; answers its path. */
function fixture(name: string, text: string): string {
  const path = join(root, name);
  writeFileSync(path, text);
  return path;
}

/** The SHA-256 of `text` in hex, by `node:crypto`, the control the command's hash is checked against. */
function sha256(text: string): string {
  return createHash('sha256')
    .update(text)
    .digest('hex');
}

/** A valid record for `hub`, holding one model, to stand for one an earlier install wrote. */
function earlierRecord(hub: string, model: string): HubInstallRecord {
  return {
    installVersion: 1,
    hub,
    bun: '1.3.0',
    dataDir: join(root, 'kept-data'),
    sqliteLibrary: join(root, 'kept-libsqlite3.so'),
    models: [{ id: 'bge', path: model, hash: 'a'.repeat(64), dimension: 384 }],
  };
}

describe('installCommandOf', () => {
  it.each([
    [[], { dataDir: null, sqliteLibrary: null, model: null, modelPath: null, modelDimension: null }],
    [['--data-dir=/data'], { dataDir: '/data', sqliteLibrary: null, model: null, modelPath: null, modelDimension: null }],
    [
      ['--model-dimension=384', '--model=bge', '--model-path=/m/bge.gguf', '--sqlite-library=/lib/x.so'],
      { dataDir: null, sqliteLibrary: '/lib/x.so', model: 'bge', modelPath: '/m/bge.gguf', modelDimension: '384' },
    ],
    [['--data-dir='], { dataDir: '', sqliteLibrary: null, model: null, modelPath: null, modelDimension: null }],
    [['--data-dir=/a=b'], { dataDir: '/a=b', sqliteLibrary: null, model: null, modelPath: null, modelDimension: null }],
  ] as const)('reads %p', (args, command) => {
    expect(installCommandOf(args)).toEqual(command);
  });

  it.each([
    [['--data-dir']],
    [['--data-dir', '/data']],
    [['--data-dir=/a', '--data-dir=/b']],
    [['--store=/data']],
    [['data']],
    [['-data-dir=/data']],
  ] as const)('refuses %p', (args) => {
    expect(installCommandOf(args)).toBeNull();
  });
});

describe('sha256OfFile', () => {
  it('answers the SHA-256 node:crypto answers for the same bytes', async () => {
    const text = 'model bytes '.repeat(50_000);
    const path = fixture('model.bin', text);

    expect(await sha256OfFile(path)).toBe(sha256(text));
    expect(await sha256OfFile(path)).not.toBe(sha256(`${text}.`));
  });

  it('answers the SHA-256 of an empty file', async () => {
    expect(await sha256OfFile(fixture('empty.bin', ''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('runInstall with no record there', () => {
  it('writes the defaults with no flags: dataDir the config file\'s directory, no library, no models', async () => {
    const ran = await install([]);

    expect(ran).toEqual({
      code: 0,
      out: [`rafa-hub install: wrote ${recordPath} for hub ${HUB} on bun ${Bun.version}: dataDir ${root}, sqliteLibrary none, Bun's own, models none`],
      err: [],
    });
    expect(recordOnDisk()).toEqual({ installVersion: 1, hub: HUB, bun: Bun.version, dataDir: root, sqliteLibrary: null, models: [] });
  });

  it('writes a record the reader reads for the same hub version', async () => {
    const library = fixture('libsqlite3.so', 'not a real library');
    expect((await install([`--sqlite-library=${library}`])).code).toBe(0);

    const reading = await readInstallRecord(configPath, HUB);
    expect(reading.warning).toBeNull();
    expect(reading.record.sqliteLibrary).toBe(library);
  });

  it('writes every flag, the model\'s hash the SHA-256 of its file', async () => {
    const library = fixture('libsqlite3.so', 'not a real library');
    const model = fixture('bge.gguf', 'not a real model');
    const dataDir = join(root, 'data');

    const ran = await install([`--data-dir=${dataDir}`, `--sqlite-library=${library}`, '--model=bge', `--model-path=${model}`, '--model-dimension=384']);

    expect(ran.code).toBe(0);
    expect(ran.err).toEqual([]);
    const written = { installVersion: 1, hub: HUB, bun: Bun.version, dataDir, sqliteLibrary: library, models: [{ id: 'bge', path: model, hash: sha256('not a real model'), dimension: 384 }] };
    expect(recordOnDisk()).toEqual(written);
    expect(ran.out).toEqual([installedLine(recordPath, written as HubInstallRecord)]);
    expect(ran.out[0]).toContain(`models bge (dimension 384, sha256 ${sha256('not a real model')})`);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('resolves relative paths against the working directory', async () => {
    const model = fixture('bge.gguf', 'model');
    const fromCwd = (path: string): string => relative(process.cwd(), path);

    const ran = await install([`--data-dir=${fromCwd(join(root, 'data'))}`, '--model=bge', `--model-path=${fromCwd(model)}`, '--model-dimension=8']);

    expect(ran.code).toBe(0);
    expect(recordOnDisk()).toMatchObject({ dataDir: join(root, 'data'), models: [{ path: model }] });
  });

  it('writes beside a config file that is not there yet, reading no config', async () => {
    const nested = join(root, 'etc', 'rafa-hub.yaml');

    const ran = await install([], HUB, { [HUB_CONFIG_ENV]: nested });

    expect(ran.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'etc', INSTALL_RECORD_FILE), 'utf8'))).toMatchObject({ dataDir: join(root, 'etc') });
  });
});

describe('runInstall over a record already there', () => {
  it('keeps every value of the record with no flags, the model not hashed again', async () => {
    const model = fixture('bge.gguf', 'model');
    const earlier = earlierRecord(HUB, model);
    await writeInstallRecord(recordPath, earlier);

    const ran = await install([]);

    expect(ran.code).toBe(0);
    expect(ran.err).toEqual([]);
    expect(recordOnDisk()).toEqual({ ...earlier, bun: Bun.version });
  });

  it('changes the flags given alone, keeping the rest', async () => {
    const model = fixture('bge.gguf', 'model');
    const earlier = earlierRecord(HUB, model);
    await writeInstallRecord(recordPath, earlier);
    const library = fixture('libsqlite3.so', 'library');

    expect((await install([`--sqlite-library=${library}`])).code).toBe(0);

    expect(recordOnDisk()).toEqual({ ...earlier, bun: Bun.version, sqliteLibrary: library });
  });

  it('hashes a model the record holds again, keeping its path and dimension when left out', async () => {
    const model = fixture('bge.gguf', 'model, second build');
    await writeInstallRecord(recordPath, earlierRecord(HUB, model));

    expect((await install(['--model=bge'])).code).toBe(0);

    expect(recordOnDisk()).toMatchObject({ models: [{ id: 'bge', path: model, hash: sha256('model, second build'), dimension: 384 }] });
  });

  it('replaces the entry of the model\'s id and keeps the others in their order', async () => {
    const first = fixture('bge.gguf', 'first');
    const second = fixture('minilm.gguf', 'second');
    await writeInstallRecord(recordPath, earlierRecord(HUB, first));
    expect((await install(['--model=minilm', `--model-path=${second}`, '--model-dimension=256'])).code).toBe(0);

    const ran = await install(['--model=bge', '--model-dimension=768']);

    expect(ran.code).toBe(0);
    const { models } = recordOnDisk() as { models: unknown[] };
    expect(models).toEqual([
      { id: 'bge', path: first, hash: sha256('first'), dimension: 768 },
      { id: 'minilm', path: second, hash: sha256('second'), dimension: 256 },
    ]);
  });

  it('rewrites a record another hub version wrote, keeping its values and saying so', async () => {
    const model = fixture('bge.gguf', 'model');
    const earlier = earlierRecord(OTHER_HUB, model);
    await writeInstallRecord(recordPath, earlier);
    await expect(readInstallRecord(configPath, HUB)).rejects.toThrow(`written by hub ${OTHER_HUB}`);

    const ran = await install([]);

    expect(ran.code).toBe(0);
    expect(ran.err).toEqual([`rafa-hub install: ${recordPath} was written by hub ${OTHER_HUB}; rewriting it for hub ${HUB}, keeping its values`]);
    expect(recordOnDisk()).toEqual({ ...earlier, hub: HUB, bun: Bun.version });
    expect((await readInstallRecord(configPath, HUB)).record.hub).toBe(HUB);
  });

  it.each([
    ['not JSON', '{ installVersion: 1'],
    ['another format', JSON.stringify({ installVersion: 2, hub: HUB, dataDir: '/kept' })],
    ['a shape off format 1', JSON.stringify({ installVersion: 1, hub: HUB, dataDir: '/kept' })],
    ['no object', '[]'],
  ])('replaces a file that is %s with the flags and the defaults, naming its problems', async (_what, text) => {
    writeFileSync(recordPath, text);

    const ran = await install([]);

    expect(ran.code).toBe(0);
    expect(ran.err).toHaveLength(1);
    expect(ran.err[0]).toStartWith(`rafa-hub install: ${recordPath} is no install record of format 1 (${recordPath}: `);
    expect(ran.err[0]).toEndWith('; writing a new one from the flags and the defaults');
    expect(recordOnDisk()).toEqual({ installVersion: 1, hub: HUB, bun: Bun.version, dataDir: root, sqliteLibrary: null, models: [] });
  });
});

describe('runInstall refusals', () => {
  /** Runs `args` and checks it refused with one line holding `problem`, writing nothing. */
  async function expectRefused(args: readonly string[], problem: string, environment = env): Promise<void> {
    const ran = await install(args, HUB, environment);

    expect(ran.code).toBe(1);
    expect(ran.out).toEqual([]);
    expect(ran.err).toHaveLength(1);
    expect(ran.err[0]).toStartWith('rafa-hub install: ');
    expect(ran.err[0]).toContain(problem);
    expect(ran.err[0]).toEndWith('; nothing was written');
    expect(existsSync(recordPath)).toBe(false);
  }

  it('refuses when RAFA_HUB_CONFIG is unset or empty', async () => {
    await expectRefused([], `${HUB_CONFIG_ENV} is not set`, {});
    await expectRefused([], `${HUB_CONFIG_ENV} is not set`, { [HUB_CONFIG_ENV]: ' ' });
  });

  it('refuses arguments that name no flag it takes, with its usage', async () => {
    await expectRefused(['--store=/data'], '--store=/data are not its arguments; usage: rafa-hub install [--data-dir=<path>]');
  });

  it('refuses a flag with no value', async () => {
    await expectRefused(['--data-dir='], '--data-dir has no value, expected --data-dir=<value>');
    await expectRefused(['--sqlite-library= '], '--sqlite-library has no value');
  });

  it('refuses a model path or dimension with no model', async () => {
    await expectRefused([`--model-path=${fixture('m.gguf', 'm')}`], '--model-path names no model; give --model=<id> with it');
    await expectRefused(['--model-dimension=8'], '--model-dimension names no model');
  });

  it.each([['0'], ['-3'], ['3.5'], ['08'], ['many']])('refuses the dimension %p', async (dimension) => {
    await expectRefused(['--model=bge', `--model-path=${fixture('m.gguf', 'm')}`, `--model-dimension=${dimension}`], `--model-dimension is ${JSON.stringify(dimension)}, expected a whole number above 0`);
  });

  it('refuses a new model with its path or dimension left out', async () => {
    await expectRefused(['--model=bge', '--model-dimension=8'], '--model=bge is no model of the record, so --model-path=<path> is needed');
    await expectRefused(['--model=bge', `--model-path=${fixture('m.gguf', 'm')}`], '--model=bge is no model of the record, so --model-dimension=<n> is needed');
  });

  it('refuses a model or library file that is not there, or is a directory', async () => {
    const absent = join(root, 'absent.gguf');
    await expectRefused(['--model=bge', `--model-path=${absent}`, '--model-dimension=8'], `--model-path names ${absent}, which could not be read`);
    await expectRefused([`--sqlite-library=${join(root, 'absent.so')}`], `--sqlite-library names ${join(root, 'absent.so')}, which could not be read`);
    mkdirSync(join(root, 'lib'));
    await expectRefused([`--sqlite-library=${join(root, 'lib')}`], `--sqlite-library names ${join(root, 'lib')}, which is not a file`);
  });

  it('refuses a data directory that is a file', async () => {
    const file = fixture('data', 'a file');
    await expectRefused([`--data-dir=${file}`], `--data-dir names ${file}, which is not a directory`);
  });

  it('refuses a record path it cannot read, leaving what is there', async () => {
    mkdirSync(recordPath);

    const ran = await install([]);

    expect(ran.code).toBe(1);
    expect(ran.err[0]).toStartWith(`rafa-hub install: ${recordPath}: the install record could not be read: `);
    expect(ran.err[0]).toEndWith('; nothing was written');
  });

  it('keeps the record already there when it refuses', async () => {
    const earlier = earlierRecord(HUB, fixture('bge.gguf', 'model'));
    await writeInstallRecord(recordPath, earlier);
    const before = readFileSync(recordPath, 'utf8');

    expect((await install(['--model=bge', '--model-path=/absent/model.gguf'])).code).toBe(1);

    expect(readFileSync(recordPath, 'utf8')).toBe(before);
  });
});
