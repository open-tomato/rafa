/**
 * Tests for the phase-0 config reader.
 *
 * The rules are tested where they live. `parseConfigText` and
 * `resolveConfig` are pure, so every precedence and refusal case runs
 * without a disk; only the `readConfigFile` and `loadConfig` cases
 * touch one, each under a fresh temporary root, so the suite reads no
 * `.rafa/` anywhere and runs on a machine that has never held one.
 *
 * Every precedence case plants values that DIFFER from the defaults in
 * each layer it names, which is what lets it fail: a resolver that
 * skipped the file would answer `sqlite` and `stage`, never the file's
 * `ndjson` and `full`. The one case where a layer spells the default
 * is there to pin the source record, which is the only thing that can
 * tell a file that was read from one that was skipped.
 *
 * Files are planted at the LITERAL `.rafa/config.yaml`, never at a
 * path the module computes, so a module reading the wrong path fails
 * here rather than agreeing with itself.
 *
 * Two cases are CHARACTERIZATIONS of bun rather than guards of this
 * module, and are named as such: a tab-indented child parsing as a
 * top-level key, and `Bun.file().exists()` answering false for a
 * directory. Each pins a measured claim the module note makes, so a
 * bun upgrade that changes either fails here and says which sentence
 * went stale.
 *
 * Twenty-eight module mutations were driven against this file and
 * every one reddened at least one case, with the restored module
 * byte-identical and green either side: the file over the command
 * line, each default moved, an unknown key dropped and an unknown key
 * refused, a null read as a value, any value accepted, an object
 * lookup in place of the `Map`, never descending into `plan`, only the
 * first problem reported, the file's source mislabelled, an unreadable
 * file read as absent, the file never read, warnings neither built nor
 * printed, an unusable command-line value downgraded to the file's,
 * the given-twice check dropped, an empty document refused, a list
 * taken for a mapping, the defaults unfrozen or shared by reference,
 * the wrong file name, an empty command-line value read as silence,
 * case-insensitive values, the parse error's cause dropped, a null
 * section refused, and `loadConfig` dropping the command line or
 * judging it before the file.
 */
import type { ConfigOverrides } from './config.js';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  ConfigError,
  configFilePath,
  loadConfig,
  parseConfigText,
  readConfigFile,
  resolveConfig,
} from './config.js';

/** The label every pure case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The known-keys tail every unknown-key warning ends with. */
const KNOWN = '(known keys: store, plan.inject)';

/** Chmod cannot deny a read to root; see the unreadable-file case. */
const isRoot = process.getuid?.() === 0;

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-config-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Parses `text` as a file labelled {@link PATH}. */
function fileOf(text: string) {
  return parseConfigText(text, PATH);
}

/** The {@link ConfigError} `run` throws. Fails when it throws none. */
function refusal(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and nothing was thrown');
}

/** A fresh repo root holding no config. */
function emptyRoot(): string {
  planted += 1;
  const root = join(tempRoot, `root-${planted}`);
  mkdirSync(root);
  return root;
}

/** The literal config path under `root`, spelled without the module. */
function literalPath(root: string): string {
  return join(root, '.rafa', 'config.yaml');
}

/** A fresh repo root with `text` planted at `.rafa/config.yaml`. */
function rootWith(text: string): string {
  const root = emptyRoot();
  mkdirSync(join(root, '.rafa'));
  writeFileSync(literalPath(root), text);
  return root;
}

describe('CONFIG_FILE', () => {
  it('is .rafa/config.yaml, joined under the root it is given', () => {
    expect(CONFIG_FILE).toBe(join('.rafa', 'config.yaml'));
    expect(configFilePath('/r')).toBe(join('/r', '.rafa', 'config.yaml'));
  });
});

describe('CONFIG_DEFAULTS', () => {
  it('are sqlite and stage', () => {
    expect(CONFIG_DEFAULTS).toEqual({ store: 'sqlite', inject: 'stage' });
  });

  it('are frozen, so no caller can move them for the next', () => {
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(true);
  });
});

describe('parseConfigText', () => {
  it('reads both settings from the nested form', () => {
    const file = fileOf('store: ndjson\nplan:\n  inject: full\n');

    expect(file.values).toEqual({ store: 'ndjson', inject: 'full' });
    expect(file.extras).toEqual([]);
    expect(file.path).toBe(PATH);
  });

  it('reads plan.inject written flat as the same setting', () => {
    expect(fileOf('plan.inject: task\n').values.inject).toBe('task');
  });

  it.each([
    ['an empty file', ''],
    ['a whitespace-only file', '  \n\n'],
    ['a comment-only file', '# store: ndjson\n'],
    ['a bare document marker', '---\n'],
  ])('reads %s as a file that says nothing', (_label, text) => {
    const file = fileOf(text);

    expect(file.values).toEqual({ store: undefined, inject: undefined });
    expect(file.extras).toEqual([]);
  });

  it('reads a null value as silence rather than as a problem', () => {
    const file = fileOf('store:\nplan:\n  # inject: full\n');

    expect(file.values).toEqual({ store: undefined, inject: undefined });
    expect(file.extras).toEqual([]);
  });

  it('retains an unknown key, top-level or under plan, with its value', () => {
    const text = [
      'store: sqlite',
      'tracker:',
      '  kind: linear',
      'plan:',
      '  inject: stage',
      '  depth: 3',
      '',
    ].join('\n');
    const file = fileOf(text);

    expect(file.values).toEqual({ store: 'sqlite', inject: 'stage' });
    expect(file.extras).toEqual([
      { key: 'tracker', value: { kind: 'linear' } },
      { key: 'plan.depth', value: 3 },
    ]);
  });

  it('treats a key named like an Object.prototype member as unknown', () => {
    const text = [
      'constructor: a',
      'toString: b',
      '__proto__: c',
      'plan:',
      '  hasOwnProperty: d',
      '',
    ].join('\n');
    const file = fileOf(text);

    expect(file.values).toEqual({ store: undefined, inject: undefined });
    expect(file.extras.map((extra) => extra.key)).toEqual([
      'constructor',
      'toString',
      '__proto__',
      'plan.hasOwnProperty',
    ]);
  });

  it('characterizes a tab-indented child as a top-level key', () => {
    const file = fileOf('plan:\n\tinject: full\n');

    expect(file.values.inject).toBeUndefined();
    expect(file.extras).toEqual([{ key: 'inject', value: 'full' }]);
  });

  it('refuses malformed YAML, naming the file and keeping the cause', () => {
    const error = refusal(() => fileOf('store: [unclosed\n'));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${PATH}: not valid YAML (`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toStartWith('rafa config: ');
  });

  it.each([
    ['a list', '- store\n- ndjson\n', 'a list'],
    ['a scalar', 'sqlite\n', '"sqlite"'],
    ['a multi-document stream', 'store: ndjson\n---\nstore: sqlite\n', 'a list'],
  ])('refuses %s at the top level', (_label, text, found) => {
    expect(refusal(() => fileOf(text)).problems).toEqual([
      `${PATH}: expected a mapping at the top level, found ${found}`,
    ]);
  });

  it('refuses every value a setting does not accept, in one error', () => {
    const text = 'store: postgres\nplan:\n  inject: everything\n';

    expect(refusal(() => fileOf(text)).problems).toEqual([
      `${PATH}: store is "postgres", expected one of: sqlite, ndjson`,
      `${PATH}: plan.inject is "everything", expected one of: full, stage, task`,
    ]);
  });

  it.each([
    ['a different case', 'SQLite', '"SQLite"'],
    ['a number', '3', '3'],
    ['a boolean', 'true', 'true'],
    ['a list', '[sqlite]', 'a list'],
    ['a mapping', '{ backend: sqlite }', 'a mapping'],
  ])('refuses a store given as %s', (_label, value, found) => {
    expect(refusal(() => fileOf(`store: ${value}\n`)).problems).toEqual([
      `${PATH}: store is ${found}, expected one of: sqlite, ndjson`,
    ]);
  });

  it('refuses a plan that is not a mapping', () => {
    expect(refusal(() => fileOf('plan: stage\n')).problems).toEqual([
      `${PATH}: plan must be a mapping, found "stage"`,
    ]);
  });

  it('refuses a setting given both flat and nested', () => {
    const text = 'plan.inject: full\nplan:\n  inject: task\n';

    expect(refusal(() => fileOf(text)).problems).toEqual([
      `${PATH}: plan.inject is given more than once`,
    ]);
  });
});

describe('resolveConfig', () => {
  it('answers the defaults when no layer names a setting', () => {
    expect(resolveConfig()).toEqual({
      config: { store: 'sqlite', inject: 'stage' },
      sources: { store: 'default', inject: 'default' },
      path: null,
      extras: [],
      warnings: [],
    });
  });

  it('lets the file outrank the default', () => {
    const file = fileOf('store: ndjson\nplan:\n  inject: full\n');
    const resolved = resolveConfig({ file });

    expect(resolved.config).toEqual({ store: 'ndjson', inject: 'full' });
    expect(resolved.sources).toEqual({ store: 'file', inject: 'file' });
    expect(resolved.path).toBe(PATH);
  });

  it('lets the command line outrank the file', () => {
    const file = fileOf('store: ndjson\nplan:\n  inject: full\n');
    const resolved = resolveConfig({
      file,
      cli: { store: 'sqlite', inject: 'task' },
    });

    expect(resolved.config).toEqual({ store: 'sqlite', inject: 'task' });
    expect(resolved.sources).toEqual({ store: 'cli', inject: 'cli' });
  });

  it('ranks each setting on its own', () => {
    const file = fileOf('store: ndjson\nplan:\n  inject: full\n');
    const resolved = resolveConfig({ file, cli: { inject: 'task' } });

    expect(resolved.config).toEqual({ store: 'ndjson', inject: 'task' });
    expect(resolved.sources).toEqual({ store: 'file', inject: 'cli' });
  });

  it('lets the command line outrank the default with no file', () => {
    const resolved = resolveConfig({ file: null, cli: { store: 'ndjson' } });

    expect(resolved.config).toEqual({ store: 'ndjson', inject: 'stage' });
    expect(resolved.sources).toEqual({ store: 'cli', inject: 'default' });
  });

  it('records a file spelling the default as the layer that answered', () => {
    const fromFile = resolveConfig({ file: fileOf('store: sqlite\n') });
    const fromNothing = resolveConfig();

    expect(fromFile.config.store).toBe(fromNothing.config.store);
    expect(fromFile.sources.store).toBe('file');
    expect(fromNothing.sources.store).toBe('default');
  });

  it('treats an override of undefined as no flag given', () => {
    const file = fileOf('plan:\n  inject: full\n');
    const resolved = resolveConfig({ file, cli: { inject: undefined } });

    expect(resolved.config.inject).toBe('full');
    expect(resolved.sources.inject).toBe('file');
  });

  it.each([
    ['an empty value', { inject: '' }, 'inject is ""', 'full, stage, task'],
    ['a misspelt mode', { inject: 'stag' }, 'inject is "stag"', 'full, stage, task'],
    ['a misspelt backend', { store: 'sqllite' }, 'store is "sqllite"', 'sqlite, ndjson'],
  ] as [string, ConfigOverrides, string, string][])(
    'refuses %s on the command line',
    (_label, cli, said, expected) => {
      expect(refusal(() => resolveConfig({ cli })).problems).toEqual([
        `command line: ${said}, expected one of: ${expected}`,
      ]);
    },
  );

  it('names every unusable command-line value at once', () => {
    const error = refusal(() => resolveConfig({ cli: { store: 'x', inject: 'y' } }));

    expect(error.problems).toHaveLength(2);
  });

  it('never downgrades an unusable command-line value to the file', () => {
    const file = fileOf('plan:\n  inject: full\n');

    expect(() => resolveConfig({ file, cli: { inject: 'bogus' } }))
      .toThrow(ConfigError);
  });

  it('warns once per retained unknown key and resolves regardless', () => {
    const file = fileOf('tracker: linear\nplan:\n  depth: 3\n');
    const resolved = resolveConfig({ file });

    expect(resolved.warnings).toEqual([
      `rafa config: unknown key "tracker" in ${PATH} has no effect in this version ${KNOWN}`,
      `rafa config: unknown key "plan.depth" in ${PATH} has no effect in this version ${KNOWN}`,
    ]);
    expect(resolved.extras).toEqual(file.extras);
    expect(resolved.config).toEqual({ store: 'sqlite', inject: 'stage' });
  });

  it('warns about nothing when the file holds only known keys', () => {
    expect(resolveConfig({ file: fileOf('store: ndjson\n') }).warnings)
      .toEqual([]);
  });

  it('answers fresh objects, so one result cannot leak into the next', () => {
    const first = resolveConfig();
    first.config.store = 'ndjson';

    expect(resolveConfig().config.store).toBe('sqlite');
  });
});

describe('readConfigFile', () => {
  it('answers null for a root with no config, and creates nothing', () => {
    const root = emptyRoot();

    expect(readConfigFile(root)).toBeNull();
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('reads the file planted at .rafa/config.yaml', () => {
    const root = rootWith('store: ndjson\n');
    const file = readConfigFile(root);

    expect(file?.values.store).toBe('ndjson');
    expect(file?.path).toBe(literalPath(root));
  });

  it('refuses a directory at the config path rather than reading it as absent', () => {
    const root = emptyRoot();
    mkdirSync(literalPath(root), { recursive: true });
    const error = refusal(() => readConfigFile(root));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${literalPath(root)}: cannot be read (`);
  });

  it('characterizes Bun.file().exists() as false for a directory', async () => {
    const root = emptyRoot();
    mkdirSync(literalPath(root), { recursive: true });

    expect(existsSync(literalPath(root))).toBe(true);
    expect(await Bun.file(literalPath(root)).exists()).toBe(false);
  });

  it.skipIf(isRoot)('refuses a config file it cannot read', () => {
    const root = rootWith('store: ndjson\n');
    chmodSync(literalPath(root), 0o000);
    const error = refusal(() => readConfigFile(root));

    expect(error.problems[0]).toStartWith(`${literalPath(root)}: cannot be read (`);
    expect(error.cause).toMatchObject({ code: 'EACCES' });
  });

  it('passes the parser refusals through', () => {
    const root = rootWith('store: postgres\n');

    expect(refusal(() => readConfigFile(root)).problems).toEqual([
      `${literalPath(root)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });
});

describe('loadConfig', () => {
  it('resolves the defaults silently for a root with no config', () => {
    const lines: string[] = [];
    const resolved = loadConfig(emptyRoot(), {}, (line) => lines.push(line));

    expect(resolved.config).toEqual({ store: 'sqlite', inject: 'stage' });
    expect(resolved.sources).toEqual({ store: 'default', inject: 'default' });
    expect(lines).toEqual([]);
  });

  it('reads the file and lets the command line outrank it', () => {
    const root = rootWith('store: ndjson\nplan:\n  inject: full\n');
    const resolved = loadConfig(root, { inject: 'task' }, () => {});

    expect(resolved.config).toEqual({ store: 'ndjson', inject: 'task' });
    expect(resolved.sources).toEqual({ store: 'file', inject: 'cli' });
    expect(resolved.path).toBe(literalPath(root));
  });

  it('prints one warning per unknown key and still resolves', () => {
    const root = rootWith('tracker: linear\nstore: ndjson\n');
    const lines: string[] = [];
    const resolved = loadConfig(root, {}, (line) => lines.push(line));

    expect(lines).toEqual([
      `rafa config: unknown key "tracker" in ${literalPath(root)} has no effect in this version ${KNOWN}`,
    ]);
    expect(resolved.config.store).toBe('ndjson');
  });

  it('prints through console.warn by default', () => {
    const root = rootWith('tracker: linear\n');
    const warned: unknown[][] = [];
    spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args);
    });

    try {
      loadConfig(root);
    } finally {
      mock.restore();
    }

    expect(warned).toHaveLength(1);
    expect(String(warned[0]?.[0])).toContain('unknown key "tracker"');
  });

  it('judges the file before it looks at the command line', () => {
    const root = rootWith('store: postgres\n');
    const error = refusal(() => loadConfig(root, { inject: 'bogus' }, () => {}));

    expect(error.problems).toEqual([
      `${literalPath(root)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });
});
