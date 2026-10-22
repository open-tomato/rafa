/**
 * Tests for the `features` section: `features.board`, `features.pr`,
 * `features.run` and `features.release`, the four switches.
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

import { describe, expect, it } from 'bun:test';

import { FEATURES_DEFAULTS, FEATURES_SECTION } from '@open-tomato/rafa/config-schema-features';
import {
  ConfigError,
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  parseConfigText,
  resolveConfig,
} from '@open-tomato/rafa/core/config';
import { flag } from '@open-tomato/rafa/core/config/sections';

import { CONFIG_DEFAULTS, SETTINGS } from '../../config-registry.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** What a refused value is expected to be. */
const EXPECTED = 'expected true or false';

/** The four settings and the name each sits under in `features`, in schema order. */
const FEATURES: readonly (readonly [ConfigSetting, string])[] = [
  ['featuresBoard', 'board'],
  ['featuresPr', 'pr'],
  ['featuresRun', 'run'],
  ['featuresRelease', 'release'],
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

describe('the keys', () => {
  it.each(FEATURES)('spells %s as features.%s, file-only, read through flag', (setting, name) => {
    expect(SETTINGS[setting].key).toBe(`features.${name}`);
    expect(SETTINGS[setting].cli).toBe(false);
    expect(SETTINGS[setting].read).toBe(flag);
  });

  it.each(FEATURES)('resolves %s to true when no layer names it', (setting) => {
    expect(CONFIG_DEFAULTS[setting]).toBe(true);
    expect(resolveConfig().config[setting]).toBe(true);
    expect(resolveConfig().sources[setting]).toBe('default');
  });

  it('keeps the defaults in the section object, frozen', () => {
    expect(FEATURES_DEFAULTS).toEqual({
      featuresBoard: true,
      featuresPr: true,
      featuresRun: true,
      featuresRelease: true,
    });
    expect(Object.isFrozen(FEATURES_DEFAULTS)).toBe(true);
  });
});

describe('each switch', () => {
  it.each(FEATURES)('reads false and true for %s, each as itself', (setting) => {
    expect(readAs(setting, false)).toEqual({ value: false, problems: [], extras: [] });
    expect(readAs(setting, true)).toEqual({ value: true, problems: [], extras: [] });
  });

  it.each([
    ['false', '"false"'],
    [0, '0'],
    [1, '1'],
    [null, 'null'],
  ])('refuses %p for every key, naming the key, the value and what was expected', (raw, shown) => {
    for (const [setting, name] of FEATURES) {
      expect(readAs(setting, raw)).toEqual({
        value: undefined,
        problems: [`F: features.${name} is ${shown}, ${EXPECTED}`],
        extras: [],
      });
    }
  });
});

describe('through a file', () => {
  it.each(FEATURES)('reads false for %s from the nested section, the others left at the default', (setting, name) => {
    const resolved = resolveConfig({ file: parseConfigText(`features:\n  ${name}: false\n`, PATH) });

    expect(resolved.config[setting]).toBe(false);
    expect(resolved.sources[setting]).toBe('file');
    for (const [other] of FEATURES.filter(([candidate]) => candidate !== setting)) {
      expect([other, resolved.config[other], resolved.sources[other]]).toEqual([other, true, 'default']);
    }
  });

  it('reads true from the file as the file\'s, not the default\'s', () => {
    const resolved = resolveConfig({ file: parseConfigText('features:\n  pr: true\n', PATH) });

    expect(resolved.config.featuresPr).toBe(true);
    expect(resolved.sources.featuresPr).toBe('file');
  });

  it.each([['"false"'], ['no'], ['0']])('reports a file holding pr: %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`features:\n  pr: ${spelled}\n`, PATH));

    expect(error.message).toContain('features.pr is ');
    expect(error.message).toContain(EXPECTED);
  });
});

describe('the section', () => {
  it('is package features, defining its keys in this order with these defaults, with no check', () => {
    expect(FEATURES_SECTION.package).toBe('features');
    expect(Object.entries(FEATURES_SECTION.settings).map(([setting, spec]) => [setting, spec?.key])).toEqual([
      ['featuresBoard', 'features.board'],
      ['featuresPr', 'features.pr'],
      ['featuresRun', 'features.run'],
      ['featuresRelease', 'features.release'],
    ]);
    expect(FEATURES_SECTION.checks ?? []).toEqual([]);
  });

  it('hands in the very specs SETTINGS reads, frozen', () => {
    const entries = Object.entries(FEATURES_SECTION.settings);

    expect(entries.length).toBe(4);
    for (const [setting, spec] of entries) {
      expect([setting, SETTINGS[setting as ConfigSetting] === spec]).toEqual([setting, true]);
    }
    expect(Object.isFrozen(FEATURES_SECTION)).toBe(true);
    expect(Object.isFrozen(FEATURES_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(FEATURES_SECTION.defaults)).toBe(true);
  });

  it('registers alone, each of its settings paired with a default', () => {
    const registry = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [FEATURES_SECTION]);

    expect(registry.sections.map((section) => section.package)).toEqual(['features']);
    expect(Object.keys(registry.settings)).toEqual(Object.keys(FEATURES_SECTION.settings));
    expect(Object.keys(registry.defaults).sort()).toEqual(Object.keys(FEATURES_SECTION.settings).sort());
  });
});
