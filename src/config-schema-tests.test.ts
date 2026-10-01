/**
 * Tests for the `tests` section: `tests.fullSuiteTriggers` and
 * `tests.integration`.
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

/** What a refused entry is expected to be. */
const EXPECTED_GLOB = 'expected a glob pattern relative to the repository root';

/** The two settings, their file keys and their defaults, in schema order. */
const TWO: readonly (readonly [ConfigSetting, string, readonly string[]])[] = [
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

describe('the two keys', () => {
  it.each(TWO)('spells %s as %s, file-only, read through globList', (setting, key) => {
    expect(SETTINGS[setting].key).toBe(key);
    expect(SETTINGS[setting].cli).toBe(false);
    expect(SETTINGS[setting].read).toBe(globList);
  });

  it.each(TWO)('resolves %s (%s) to its default when no layer names it', (setting, _key, value) => {
    expect(CONFIG_DEFAULTS[setting]).toEqual(value);
    expect(resolveConfig().config[setting]).toEqual(value);
    expect(resolveConfig().sources[setting]).toBe('default');
  });

  it('keeps both defaults in the section object, frozen, each list too', () => {
    expect(Object.isFrozen(TESTS_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsFullSuiteTriggers)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsIntegration)).toBe(true);
  });

  it('names no preload file in the trigger default, which is read off bunfig.toml at run time', () => {
    expect(CONFIG_DEFAULTS.testsFullSuiteTriggers.filter((glob) => glob.includes('preload'))).toEqual([]);
  });
});

describe.each(TWO)('%s', (setting, key) => {
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

describe('the tests section through a file', () => {
  it('resolves both keys from the file, outranking the defaults', () => {
    const file = parseConfigText(
      'tests:\n  fullSuiteTriggers: ["*.toml", test/setup.ts]\n  integration: []\n',
      PATH,
    );
    const resolved = resolveConfig({ file });

    expect(resolved.config.testsFullSuiteTriggers).toEqual(['*.toml', 'test/setup.ts']);
    expect(resolved.config.testsIntegration).toEqual([]);
    expect([resolved.sources.testsFullSuiteTriggers, resolved.sources.testsIntegration]).toEqual(['file', 'file']);
  });

  it('refuses a file carrying an absolute pattern, naming the file and the entry', () => {
    const error = refusal(() => parseConfigText('tests:\n  integration: ["/e2e/*.test.ts"]\n', PATH));

    expect(error.problems).toEqual([`${PATH}: tests.integration[0] is "/e2e/*.test.ts", ${EXPECTED_GLOB}`]);
  });

  it('warns of no unknown key for either, so both sit in the known-key index', () => {
    const file = parseConfigText('tests:\n  fullSuiteTriggers: []\n  integration: []\n', PATH);

    expect(file.extras).toEqual([]);
    expect(resolveConfig({ file }).warnings).toEqual([]);
  });
});
