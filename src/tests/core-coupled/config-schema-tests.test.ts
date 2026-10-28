/**
 * Tests for the `tests` section: `tests.fullSuiteTriggers`,
 * `tests.integration`, `tests.contract` and `tests.alwaysRun`, the four
 * glob lists, and
 * `tests.retakeRedAlone`, the one switch.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. Every key,
 * default and refusal is SPELLED, never read off the module, so a
 * module that renames a key or moves a default fails rather than
 * agreeing with itself.
 */
import type { ConfigSetting } from '@open-tomato/rafa/core/config';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { globList, TESTS_DEFAULTS, TESTS_SECTION, TESTS_SETTINGS } from '@open-tomato/rafa/config-schema-tests';
import {
  ConfigError,
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  parseConfigText,
  resolveConfig,
} from '@open-tomato/rafa/core/config';
import { flag } from '@open-tomato/rafa/core/config/sections';

import { templateEntry } from '../../config/templates.js';
import { CONFIG_DEFAULTS, SETTINGS } from '../../config-registry.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The repository root, which the glob scans below run from. */
const ROOT = join(import.meta.dir, '..', '..', '..');

/** What a refused entry is expected to be. */
const EXPECTED_GLOB = 'expected a glob pattern relative to the repository root';

/** The four glob settings, their file keys and their defaults, in schema order. */
const GLOB_KEYS: readonly (readonly [ConfigSetting, string, readonly string[]])[] = [
  ['testsFullSuiteTriggers', 'tests.fullSuiteTriggers', []],
  ['testsIntegration', 'tests.integration', []],
  ['testsContract', 'tests.contract', []],
  ['testsAlwaysRun', 'tests.alwaysRun', ['src/**/*.sweep.test.ts']],
];

/**
 * The three glob keys whose default is empty, their leaf under `tests`,
 * and the values the `escalation` template holds for them.
 */
const TEMPLATE_GLOBS: readonly (readonly ['fullSuiteTriggers' | 'integration' | 'contract', readonly string[]])[] = [
  ['fullSuiteTriggers', ['bunfig.toml', 'tsconfig*.json', 'package.json', 'bun.lock', 'bun.lockb']],
  [
    'integration',
    [
      '**/*-integration.test.ts',
      '**/*.integration.test.ts',
      '**/*-spawned*.test.ts',
      '**/*-cli.test.ts',
    ],
  ],
  ['contract', ['**/*.contract.test.ts']],
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

describe('the four glob keys', () => {
  it.each(GLOB_KEYS)('spells %s as %s, file-only, read through globList', (setting, key) => {
    expect(SETTINGS[setting].key).toBe(key);
    expect(SETTINGS[setting].cli).toBe(false);
    expect(SETTINGS[setting].read).toBe(globList);
  });

  it.each(GLOB_KEYS)('resolves %s (%s) to its default when no layer names it', (setting, _key, value) => {
    expect(CONFIG_DEFAULTS[setting]).toEqual(value);
    expect(resolveConfig().config[setting]).toEqual(value);
    expect(resolveConfig().sources[setting]).toBe('default');
  });

  it('keeps every default in the section object, frozen, each list too', () => {
    expect(Object.isFrozen(TESTS_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsFullSuiteTriggers)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsIntegration)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsContract)).toBe(true);
    expect(Object.isFrozen(TESTS_DEFAULTS.testsAlwaysRun)).toBe(true);
  });

  it('names no preload file in the trigger default, which is read off bunfig.toml at run time', () => {
    expect(CONFIG_DEFAULTS.testsFullSuiteTriggers.filter((glob) => glob.includes('preload'))).toEqual([]);
  });

  it.each(TEMPLATE_GLOBS)('finds tests.%s\'s old default in the escalation template, read by globList', (leaf, value) => {
    const written = templateEntry('escalation')?.tests?.[leaf];

    expect(written).toEqual(value);
    expect(globList(written, { label: `F: tests.${leaf}`, key: `tests.${leaf}` })).toEqual({
      value,
      problems: [],
      extras: [],
    });
  });

  it('names no preload file in the template\'s triggers either', () => {
    const triggers = templateEntry('escalation')?.tests?.fullSuiteTriggers ?? [];

    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.filter((glob) => glob.includes('preload'))).toEqual([]);
  });
});

describe.each(GLOB_KEYS)('%s', (setting, key) => {
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

describe('tests.contract', () => {
  it('matches a contract test\'s name in any folder with the template\'s glob, and a plain test\'s not', () => {
    const glob = new Bun.Glob('**/*.contract.test.ts');

    expect(glob.match('packages/rafa/src/config/load.contract.test.ts')).toBe(true);
    expect(glob.match('src/x.contract.test.ts')).toBe(true);
    expect(glob.match('src/tests/core-coupled/config-schema-tests.test.ts')).toBe(false);
  });

  it('keeps a file\'s [] as empty, outranking the default', () => {
    const resolved = resolveConfig({ file: parseConfigText('tests:\n  contract: []\n', PATH) });

    expect(resolved.config.testsContract).toEqual([]);
    expect(resolved.sources.testsContract).toBe('file');
  });
});

describe('tests.alwaysRun', () => {
  it('accepts a glob that matches no file, since the sweeps it names may not exist yet', () => {
    const glob = 'src/no-such-folder/**/*.sweep.test.ts';

    expect(Array.from(new Bun.Glob(glob).scanSync({ cwd: ROOT }))).toEqual([]);
    expect(readAs('testsAlwaysRun', [glob])).toEqual({ value: [glob], problems: [], extras: [] });
  });

  it('finds this file through the same scan, so the empty scan above could fail', () => {
    const scan = Array.from(new Bun.Glob('src/tests/core-coupled/config-schema-tests.test.ts').scanSync({ cwd: ROOT }));

    expect(scan).toEqual(['src/tests/core-coupled/config-schema-tests.test.ts']);
  });

  it('matches a sweep\'s name with its default glob, and a plain test\'s not', () => {
    const glob = new Bun.Glob('src/**/*.sweep.test.ts');

    expect(glob.match('src/tests/sweep-suffix.sweep.test.ts')).toBe(true);
    expect(glob.match('src/tests/core-coupled/config-schema-tests.test.ts')).toBe(false);
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

describe('tests.retakeRedAlone', () => {
  it('is spelled tests.retakeRedAlone, file-only, read as a YAML boolean, and written last in the section', () => {
    expect(SETTINGS.testsRetakeRedAlone.key).toBe('tests.retakeRedAlone');
    expect(SETTINGS.testsRetakeRedAlone.cli).toBe(false);
    expect(SETTINGS.testsRetakeRedAlone.read).toBe(flag);
    expect(Object.keys(TESTS_SETTINGS)).toEqual([
      'testsFullSuiteTriggers',
      'testsIntegration',
      'testsContract',
      'testsAlwaysRun',
      'testsRetakeRedAlone',
    ]);
  });

  it('is on when no layer names it', () => {
    expect(TESTS_DEFAULTS.testsRetakeRedAlone).toBe(true);
    expect(CONFIG_DEFAULTS.testsRetakeRedAlone).toBe(true);
    expect(resolveConfig().config.testsRetakeRedAlone).toBe(true);
    expect(resolveConfig().sources.testsRetakeRedAlone).toBe('default');
  });

  it('is turned off by a file saying false, outranking the default', () => {
    const resolved = resolveConfig({ file: parseConfigText('tests:\n  retakeRedAlone: false\n', PATH) });

    expect(resolved.config.testsRetakeRedAlone).toBe(false);
    expect(resolved.sources.testsRetakeRedAlone).toBe('file');
    expect(resolved.warnings).toEqual([]);
  });

  it.each([['"false"'], ['off'], ['0'], ['[]']])('refuses %s, which is no YAML boolean', (written) => {
    const error = refusal(() => parseConfigText(`tests:\n  retakeRedAlone: ${written}\n`, PATH));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toContain('tests.retakeRedAlone is ');
    expect(error.problems[0]).toContain(', expected true or false');
    // Control: the same key with a boolean is read.
    expect(parseConfigText('tests:\n  retakeRedAlone: true\n', PATH).extras).toEqual([]);
  });
});

describe('the tests section through a file', () => {
  it('resolves every key from the file, outranking the defaults', () => {
    const file = parseConfigText(
      'tests:\n  fullSuiteTriggers: ["*.toml", test/setup.ts]\n  integration: []\n  contract: ["pkg/**/*.pact.ts"]\n  alwaysRun: ["e2e/*.sweep.ts"]\n',
      PATH,
    );
    const resolved = resolveConfig({ file });

    expect(resolved.config.testsFullSuiteTriggers).toEqual(['*.toml', 'test/setup.ts']);
    expect(resolved.config.testsIntegration).toEqual([]);
    expect(resolved.config.testsContract).toEqual(['pkg/**/*.pact.ts']);
    expect(resolved.config.testsAlwaysRun).toEqual(['e2e/*.sweep.ts']);
    expect([
      resolved.sources.testsFullSuiteTriggers,
      resolved.sources.testsIntegration,
      resolved.sources.testsContract,
      resolved.sources.testsAlwaysRun,
    ]).toEqual(['file', 'file', 'file', 'file']);
  });

  it('refuses a file carrying an absolute pattern, naming the file and the entry', () => {
    const error = refusal(() => parseConfigText('tests:\n  integration: ["/e2e/*.test.ts"]\n', PATH));

    expect(error.problems).toEqual([`${PATH}: tests.integration[0] is "/e2e/*.test.ts", ${EXPECTED_GLOB}`]);
  });

  it('warns of no unknown key for any of them, so all four sit in the known-key index', () => {
    const file = parseConfigText(
      'tests:\n  fullSuiteTriggers: []\n  integration: []\n  contract: []\n  alwaysRun: []\n',
      PATH,
    );

    expect(file.extras).toEqual([]);
    expect(resolveConfig({ file }).warnings).toEqual([]);
  });
});

describe('the section', () => {
  it('is package tests, defining its keys in this order with these defaults, with no check', () => {
    expect(TESTS_SECTION.package).toBe('tests');
    expect(Object.entries(TESTS_SECTION.settings).map(([setting, spec]) => [setting, spec?.key])).toEqual([
      ['testsFullSuiteTriggers', 'tests.fullSuiteTriggers'],
      ['testsIntegration', 'tests.integration'],
      ['testsContract', 'tests.contract'],
      ['testsAlwaysRun', 'tests.alwaysRun'],
      ['testsRetakeRedAlone', 'tests.retakeRedAlone'],
    ]);
    expect(TESTS_SECTION.defaults).toEqual({
      testsFullSuiteTriggers: [],
      testsIntegration: [],
      testsContract: [],
      testsAlwaysRun: ['src/**/*.sweep.test.ts'],
      testsRetakeRedAlone: true,
    });
    expect(TESTS_SECTION.checks ?? []).toEqual([]);
  });

  it('hands in the very specs SETTINGS reads, frozen', () => {
    const entries = Object.entries(TESTS_SECTION.settings);

    expect(entries.length).toBeGreaterThan(0);
    for (const [setting, spec] of entries) {
      expect([setting, SETTINGS[setting as ConfigSetting] === spec]).toEqual([setting, true]);
    }
    expect(Object.isFrozen(TESTS_SECTION)).toBe(true);
    expect(Object.isFrozen(TESTS_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(TESTS_SECTION.defaults)).toBe(true);
  });

  it('registers alone, each of its settings paired with a default', () => {
    const registry = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [TESTS_SECTION]);

    expect(registry.sections.map((section) => section.package)).toEqual(['tests']);
    expect(Object.keys(registry.settings)).toEqual(Object.keys(TESTS_SECTION.settings));
    expect(Object.keys(registry.defaults).sort()).toEqual(Object.keys(TESTS_SECTION.settings).sort());
  });
});
