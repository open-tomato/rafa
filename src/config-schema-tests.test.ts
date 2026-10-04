/**
 * Tests for the `tests` section: `tests.fullSuiteTriggers`,
 * `tests.integration` and `tests.alwaysRun`.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. Every key,
 * default and refusal is SPELLED, never read off the module, so a
 * module that renames a key or moves a default fails rather than
 * agreeing with itself.
 */
import type { ConfigSetting } from './config-schema.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { globList, TESTS_DEFAULTS } from './config-schema-tests.js';
import { SETTINGS } from './config-schema.js';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The repository root, which the glob scans below run from. */
const ROOT = join(import.meta.dir, '..');

/** What a refused entry is expected to be. */
const EXPECTED_GLOB = 'expected a glob pattern relative to the repository root';

/** The three settings, their file keys and their defaults, in schema order. */
const THREE: readonly (readonly [ConfigSetting, string, readonly string[]])[] = [
  [
    'testsFullSuiteTriggers',
    'tests.fullSuiteTriggers',
    ['bunfig.toml', 'tsconfig*.json', 'package.json', 'bun.lock', 'bun.lockb'],
  ],
  [
    'testsIntegration',
    'tests.integration',
    [
      '**/*-integration.test.ts',
      '**/*.integration.test.ts',
      '**/*-spawned*.test.ts',
      '**/*-cli.test.ts',
    ],
  ],
  ['testsAlwaysRun', 'tests.alwaysRun', ['src/**/*.sweep.test.ts']],
];

/** Reads `raw` through the spec `SETTINGS` holds for `setting`. */
function readAs(setting: ConfigSetting, raw: unknown) {
  const { key } = SETTINGS[setting];
  return SETTINGS[setting].read(raw, { label: `F: ${key}`, key });
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

describe('the three keys', () => {
  it.each(THREE)('spells %s as %s, file-only, read through globList', (setting, key) => {
    expect(SETTINGS[setting].key).toBe(key);
    expect(SETTINGS[setting].cli).toBe(false);
    expect(SETTINGS[setting].read).toBe(globList);
  });

  it.each(THREE)('resolves %s (%s) to its default when no layer names it', (setting, _key, value) => {
    expect(CONFIG_DEFAULTS[setting]).toEqual(value);
    expect(resolveConfig().config[setting]).toEqual(value);
    expect(resolveConfig().sources[setting]).toBe('default');
  });

  it('keeps every default in the section object, frozen, each list too', () => {
    expect(Object.isFrozen(TESTS_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsFullSuiteTriggers)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsIntegration)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsAlwaysRun)).toBe(true);
  });

  it('names no preload file in the trigger default, which is read off bunfig.toml at run time', () => {
    expect(CONFIG_DEFAULTS.testsFullSuiteTriggers.filter((glob) => glob.includes('preload'))).toEqual([]);
  });
});

describe.each(THREE)('%s', (setting, key) => {
  it('accepts a list of relative globs, frozen, in the order written', () => {
    const reading = readAs(setting, ['src/**/*.ts', 'bunfig.toml']);

    expect(reading).toEqual({ value: ['src/**/*.ts', 'bunfig.toml'], problems: [], extras: [] });
    expect(Object.isFrozen(reading.value)).toBe(true);
  });

  it('accepts an empty list as said, not as the default', () => {
    expect(readAs(setting, [])).toEqual({ value: [], problems: [], extras: [] });
  });

  it('refuses a single string, which is not a list', () => {
    expect(readAs(setting, 'bunfig.toml')).toEqual({
      value: undefined,
      problems: [`F: ${key} is "bunfig.toml", expected a list of glob patterns`],
      extras: [],
    });
  });

  it('refuses an absolute pattern, which no repository-relative path matches', () => {
    expect(readAs(setting, ['ok/*.ts', '/abs/*.ts'])).toEqual({
      value: undefined,
      problems: [`F: ${key}[1] is "/abs/*.ts", ${EXPECTED_GLOB}`],
      extras: [],
    });
  });

  it.each([[''], ['   '], [7], [null], [true]])('refuses %p as an entry', (entry) => {
    const reading = readAs(setting, ['ok/*.ts', entry]);

    expect(reading.value).toBeUndefined();
    expect(reading.problems).toEqual([`F: ${key}[1] is ${JSON.stringify(entry)}, ${EXPECTED_GLOB}`]);
  });
});

describe('tests.alwaysRun', () => {
  it('accepts a glob that matches no file, since the sweeps it names may not exist yet', () => {
    const glob = 'src/no-such-folder/**/*.sweep.test.ts';

    expect(Array.from(new Bun.Glob(glob).scanSync({ cwd: ROOT }))).toEqual([]);
    expect(readAs('testsAlwaysRun', [glob])).toEqual({ value: [glob], problems: [], extras: [] });
  });

  it('finds this file through the same scan, so the empty scan above could fail', () => {
    const scan = Array.from(new Bun.Glob('src/config-schema-tests.test.ts').scanSync({ cwd: ROOT }));

    expect(scan).toEqual(['src/config-schema-tests.test.ts']);
  });

  it('matches a sweep\'s name with its default glob, and a plain test\'s not', () => {
    const glob = new Bun.Glob('src/**/*.sweep.test.ts');

    expect(glob.match('src/tests/sweep-suffix.sweep.test.ts')).toBe(true);
    expect(glob.match('src/config-schema-tests.test.ts')).toBe(false);
  });

  it('keeps a file\'s [] as empty, outranking the default', () => {
    const resolved = resolveConfig({ file: parseConfigText('tests:\n  alwaysRun: []\n', PATH) });

    expect(resolved.config.testsAlwaysRun).toEqual([]);
    expect(resolved.sources.testsAlwaysRun).toBe('file');
  });

  it('refuses an absolute pattern in a file, naming the file and the entry', () => {
    const error = refusal(() => parseConfigText('tests:\n  alwaysRun: ["/src/**/*.sweep.test.ts"]\n', PATH));

    expect(error.problems).toEqual([`${PATH}: tests.alwaysRun[0] is "/src/**/*.sweep.test.ts", ${EXPECTED_GLOB}`]);
  });
});

describe('the tests section through a file', () => {
  it('resolves every key from the file, outranking the defaults', () => {
    const file = parseConfigText(
      'tests:\n  fullSuiteTriggers: ["*.toml", test/setup.ts]\n  integration: []\n  alwaysRun: ["e2e/*.sweep.ts"]\n',
      PATH,
    );
    const resolved = resolveConfig({ file });

    expect(resolved.config.testsFullSuiteTriggers).toEqual(['*.toml', 'test/setup.ts']);
    expect(resolved.config.testsIntegration).toEqual([]);
    expect(resolved.config.testsAlwaysRun).toEqual(['e2e/*.sweep.ts']);
    expect([
      resolved.sources.testsFullSuiteTriggers,
      resolved.sources.testsIntegration,
      resolved.sources.testsAlwaysRun,
    ]).toEqual(['file', 'file', 'file']);
  });

  it('refuses a file carrying an absolute pattern, naming the file and the entry', () => {
    const error = refusal(() => parseConfigText('tests:\n  integration: ["/e2e/*.test.ts"]\n', PATH));

    expect(error.problems).toEqual([`${PATH}: tests.integration[0] is "/e2e/*.test.ts", ${EXPECTED_GLOB}`]);
  });

  it('warns of no unknown key for any of them, so all three sit in the known-key index', () => {
    const file = parseConfigText('tests:\n  fullSuiteTriggers: []\n  integration: []\n  alwaysRun: []\n', PATH);

    expect(file.extras).toEqual([]);
    expect(resolveConfig({ file }).warnings).toEqual([]);
  });
});
