/**
 * Tests for the `bugs` section: `bugs.recheck.runs` and
 * `bugs.recheck.timeoutSeconds`.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key. Every refusal
 * sits beside an accepting control of the same spec, so a reader that
 * refused everything fails here. Keys, defaults, bounds and refusals
 * are SPELLED, never read off the module.
 */
import type { ConfigSetting } from '@open-tomato/rafa/core/config';

import { describe, expect, it } from 'bun:test';

import {
  BUGS_DEFAULTS,
  BUGS_SECTION,
  bugsRecheckRuns,
  bugsRecheckTimeoutSeconds,
} from '@open-tomato/rafa/config-schema-bugs';
import {
  ConfigError,
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  parseConfigText,
  resolveConfig,
} from '@open-tomato/rafa/core/config';

import { CONFIG_DEFAULTS, SETTINGS } from '../../config-registry.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The two keys, spelled. */
const RUNS = 'bugs.recheck.runs';
const TIMEOUT = 'bugs.recheck.timeoutSeconds';

/** Reads `raw` through the spec `SETTINGS` holds for `setting`. */
function readAs(setting: 'bugsRecheckRuns' | 'bugsRecheckTimeoutSeconds', raw: unknown) {
  const spec = SETTINGS[setting];
  return spec.read(raw, { label: `F: ${spec.key}`, key: spec.key });
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

describe('the keys', () => {
  it('spells both keys, file-only, each read through its own reader', () => {
    expect(SETTINGS.bugsRecheckRuns.key).toBe(RUNS);
    expect(SETTINGS.bugsRecheckRuns.cli).toBe(false);
    expect(SETTINGS.bugsRecheckRuns.read).toBe(bugsRecheckRuns);
    expect(SETTINGS.bugsRecheckTimeoutSeconds.key).toBe(TIMEOUT);
    expect(SETTINGS.bugsRecheckTimeoutSeconds.cli).toBe(false);
    expect(SETTINGS.bugsRecheckTimeoutSeconds.read).toBe(bugsRecheckTimeoutSeconds);
  });

  it('resolves to 5 runs and 300 seconds when no layer names them', () => {
    const { config, sources } = resolveConfig();

    expect([CONFIG_DEFAULTS.bugsRecheckRuns, CONFIG_DEFAULTS.bugsRecheckTimeoutSeconds]).toEqual([5, 300]);
    expect([config.bugsRecheckRuns, config.bugsRecheckTimeoutSeconds]).toEqual([5, 300]);
    expect([sources.bugsRecheckRuns, sources.bugsRecheckTimeoutSeconds]).toEqual(['default', 'default']);
  });

  it('keeps the defaults in the section object, frozen', () => {
    expect(BUGS_DEFAULTS).toEqual({ bugsRecheckRuns: 5, bugsRecheckTimeoutSeconds: 300 });
    expect(Object.isFrozen(BUGS_DEFAULTS)).toBe(true);
  });
});

describe('bugs.recheck.runs', () => {
  it.each([[1], [5], [20]])('accepts %p as itself', (raw) => {
    expect(readAs('bugsRecheckRuns', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-1, '-1'],
    [21, '21'],
    [1.5, '1.5'],
    ['5', '"5"'],
    [false, 'false'],
    [true, 'true'],
  ])('refuses %p, naming the range', (raw, shown) => {
    expect(readAs('bugsRecheckRuns', raw)).toEqual({
      value: undefined,
      problems: [`F: ${RUNS} is ${shown}, expected a whole number from 1 to 20`],
      extras: [],
    });
  });
});

describe('bugs.recheck.timeoutSeconds', () => {
  it.each([[1], [300], [3600]])('accepts %p as itself', (raw) => {
    expect(readAs('bugsRecheckTimeoutSeconds', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-30, '-30'],
    [3601, '3601'],
    [2.5, '2.5'],
    ['300', '"300"'],
    [false, 'false'],
    [true, 'true'],
  ])('refuses %p, naming the range', (raw, shown) => {
    expect(readAs('bugsRecheckTimeoutSeconds', raw)).toEqual({
      value: undefined,
      problems: [`F: ${TIMEOUT} is ${shown}, expected a whole number from 1 to 3600`],
      extras: [],
    });
  });
});

describe('through a file', () => {
  it('reads both keys from the bugs section', () => {
    const layer = parseConfigText('bugs:\n  recheck:\n    runs: 3\n    timeoutSeconds: 60\n', PATH);
    const { config, sources } = resolveConfig({ file: layer });

    expect([config.bugsRecheckRuns, config.bugsRecheckTimeoutSeconds]).toEqual([3, 60]);
    expect([sources.bugsRecheckRuns, sources.bugsRecheckTimeoutSeconds]).toEqual(['file', 'file']);
  });

  it.each([['0'], ['21'], ['1.5'], ['"5"'], ['false']])('reports runs: %s with a ConfigError naming the key and range', (spelled) => {
    const error = refusal(() => parseConfigText(`bugs:\n  recheck:\n    runs: ${spelled}\n`, PATH));

    expect(error.message).toContain(`${RUNS} is ${spelled}, expected a whole number from 1 to 20`);
  });

  it.each([['0'], ['3601'], ['true']])('reports timeoutSeconds: %s with a ConfigError naming the key and range', (spelled) => {
    const error = refusal(() => parseConfigText(`bugs:\n  recheck:\n    timeoutSeconds: ${spelled}\n`, PATH));

    expect(error.message).toContain(`${TIMEOUT} is ${spelled}, expected a whole number from 1 to 3600`);
  });
});

describe('the section', () => {
  it('is package bugs, defining its keys in this order with these defaults, with no check', () => {
    expect(BUGS_SECTION.package).toBe('bugs');
    expect(Object.entries(BUGS_SECTION.settings).map(([setting, spec]) => [setting, spec?.key])).toEqual([
      ['bugsRecheckRuns', RUNS],
      ['bugsRecheckTimeoutSeconds', TIMEOUT],
    ]);
    expect(BUGS_SECTION.defaults).toEqual({ bugsRecheckRuns: 5, bugsRecheckTimeoutSeconds: 300 });
    expect(BUGS_SECTION.checks ?? []).toEqual([]);
  });

  it('hands in the very specs SETTINGS reads, frozen', () => {
    const entries = Object.entries(BUGS_SECTION.settings);

    expect(entries.length).toBe(2);
    for (const [setting, spec] of entries) {
      expect([setting, SETTINGS[setting as ConfigSetting] === spec]).toEqual([setting, true]);
    }
    expect(Object.isFrozen(BUGS_SECTION)).toBe(true);
    expect(Object.isFrozen(BUGS_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(BUGS_SECTION.defaults)).toBe(true);
  });

  it('registers alone, each of its settings paired with a default', () => {
    const registry = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [BUGS_SECTION]);

    expect(registry.sections.map((section) => section.package)).toEqual(['bugs']);
    expect(Object.keys(registry.settings)).toEqual(Object.keys(BUGS_SECTION.settings));
    expect(Object.keys(registry.defaults).sort()).toEqual(Object.keys(BUGS_SECTION.settings).sort());
  });
});
