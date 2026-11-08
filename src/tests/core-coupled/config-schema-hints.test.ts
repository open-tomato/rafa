/**
 * Tests for the `hints` section: `hints.skills`, the one switch.
 *
 * The key is driven through the spec `SETTINGS` holds for it, so what is
 * proved is the reader the schema wires to the key, not a reader of the
 * same name. Every refusal sits beside an accepting control of the same
 * spec, so a reader that refused everything fails here. The key, its
 * default and each refusal are SPELLED, never read off the module, so a
 * module that renames the key or moves the default fails rather than
 * agreeing with itself.
 */
import { describe, expect, it } from 'bun:test';

import { HINTS_DEFAULTS, HINTS_SECTION } from '@open-tomato/rafa/config-schema-hints';
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

/** Reads `raw` through the spec `SETTINGS` holds for `hints.skills`. */
function readSkills(raw: unknown) {
  return SETTINGS.hintsSkills.read(raw, { label: 'F: hints.skills', key: 'hints.skills' });
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

describe('the key', () => {
  it('spells hintsSkills as hints.skills, file-only, read through flag', () => {
    expect(SETTINGS.hintsSkills.key).toBe('hints.skills');
    expect(SETTINGS.hintsSkills.cli).toBe(false);
    expect(SETTINGS.hintsSkills.read).toBe(flag);
  });

  it('resolves to false when no layer names it', () => {
    expect(CONFIG_DEFAULTS.hintsSkills).toBe(false);
    expect(resolveConfig().config.hintsSkills).toBe(false);
    expect(resolveConfig().sources.hintsSkills).toBe('default');
  });

  it('keeps the default in the section object, frozen', () => {
    expect(HINTS_DEFAULTS).toEqual({ hintsSkills: false });
    expect(Object.isFrozen(HINTS_DEFAULTS)).toBe(true);
  });
});

describe('the reader', () => {
  it('reads true and false, each as itself', () => {
    expect(readSkills(true)).toEqual({ value: true, problems: [], extras: [] });
    expect(readSkills(false)).toEqual({ value: false, problems: [], extras: [] });
  });

  it.each([
    ['true', '"true"'],
    [1, '1'],
    [0, '0'],
    [null, 'null'],
  ])('refuses %p, naming the key, the value and what was expected', (raw, shown) => {
    expect(readSkills(raw)).toEqual({
      value: undefined,
      problems: [`F: hints.skills is ${shown}, ${EXPECTED}`],
      extras: [],
    });
  });
});

describe('through a file', () => {
  it('reads true from the nested section as the file\'s', () => {
    const resolved = resolveConfig({ file: parseConfigText('hints:\n  skills: true\n', PATH) });

    expect(resolved.config.hintsSkills).toBe(true);
    expect(resolved.sources.hintsSkills).toBe('file');
  });

  it('reads false from the file as the file\'s, not the default\'s', () => {
    const resolved = resolveConfig({ file: parseConfigText('hints:\n  skills: false\n', PATH) });

    expect(resolved.config.hintsSkills).toBe(false);
    expect(resolved.sources.hintsSkills).toBe('file');
  });

  it.each([['"true"'], ['yes'], ['1']])('reports a file holding skills: %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`hints:\n  skills: ${spelled}\n`, PATH));

    expect(error.message).toContain('hints.skills is ');
    expect(error.message).toContain(EXPECTED);
  });
});

describe('the section', () => {
  it('is package hints, defining its one key with its default, with no check', () => {
    expect(HINTS_SECTION.package).toBe('hints');
    expect(Object.entries(HINTS_SECTION.settings).map(([setting, spec]) => [setting, spec?.key])).toEqual([
      ['hintsSkills', 'hints.skills'],
    ]);
    expect(HINTS_SECTION.defaults).toEqual({ hintsSkills: false });
    expect(HINTS_SECTION.checks ?? []).toEqual([]);
  });

  it('hands in the very spec SETTINGS reads, frozen', () => {
    expect(HINTS_SECTION.settings.hintsSkills).toBe(SETTINGS.hintsSkills);
    expect(Object.isFrozen(HINTS_SECTION)).toBe(true);
    expect(Object.isFrozen(HINTS_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(HINTS_SECTION.defaults)).toBe(true);
  });

  it('registers alone, its setting paired with a default', () => {
    const registry = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [HINTS_SECTION]);

    expect(registry.sections.map((section) => section.package)).toEqual(['hints']);
    expect(Object.keys(registry.settings)).toEqual(['hintsSkills']);
    expect(Object.keys(registry.defaults)).toEqual(['hintsSkills']);
  });
});
