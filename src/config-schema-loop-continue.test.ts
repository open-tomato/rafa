/**
 * Tests for the four keys `rafa loop start --continue` reads:
 * `loop.retriesOnContinue`, `loop.continue.criteria`,
 * `loop.continue.criteriaMode` and `loop.forceWrapUp.maxNewFailures`.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. The keys,
 * their defaults, their bounds and their refusals are SPELLED, never
 * read off the module, so a module that renames a key or moves a
 * default fails rather than agreeing with itself.
 */
import type { ConfigSetting } from './config-schema.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  CONTINUE_CRITERIA_MODES,
  FORCE_WRAP_UP_MAX_NEW_FAILURES_MAX,
  FORCE_WRAP_UP_MAX_NEW_FAILURES_MIN,
  LOOP_CONTINUE_DEFAULTS,
  RETRIES_ON_CONTINUE_MAX,
  RETRIES_ON_CONTINUE_MIN,
} from './config-schema-loop-continue.js';
import { SETTINGS } from './config-schema.js';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

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
  it('spells each setting as its dotted key, file-only', () => {
    const spelled = ([
      'loopRetriesOnContinue',
      'loopContinueCriteria',
      'loopContinueCriteriaMode',
      'loopForceWrapUpMaxNewFailures',
    ] as const).map((setting) => [setting, SETTINGS[setting].key, SETTINGS[setting].cli]);

    expect(spelled).toEqual([
      ['loopRetriesOnContinue', 'loop.retriesOnContinue', false],
      ['loopContinueCriteria', 'loop.continue.criteria', false],
      ['loopContinueCriteriaMode', 'loop.continue.criteriaMode', false],
      ['loopForceWrapUpMaxNewFailures', 'loop.forceWrapUp.maxNewFailures', false],
    ]);
  });

  it('resolves each to its default when no layer names it', () => {
    const { config, sources } = resolveConfig();

    expect([
      config.loopRetriesOnContinue,
      config.loopContinueCriteria,
      config.loopContinueCriteriaMode,
      config.loopForceWrapUpMaxNewFailures,
    ]).toEqual([1, join('.rafa', 'continue-criteria.md'), 'extend', false]);
    expect([
      sources.loopRetriesOnContinue,
      sources.loopContinueCriteria,
      sources.loopContinueCriteriaMode,
      sources.loopForceWrapUpMaxNewFailures,
    ]).toEqual(['default', 'default', 'default', 'default']);
    expect(CONFIG_DEFAULTS.loopRetriesOnContinue).toBe(1);
  });

  it('keeps the defaults in the section object, frozen', () => {
    expect(LOOP_CONTINUE_DEFAULTS).toEqual({
      loopRetriesOnContinue: 1,
      loopContinueCriteria: join('.rafa', 'continue-criteria.md'),
      loopContinueCriteriaMode: 'extend',
      loopForceWrapUpMaxNewFailures: false,
    });
    expect(Object.isFrozen(LOOP_CONTINUE_DEFAULTS)).toBe(true);
  });

  it('bounds retriesOnContinue from 1 to 3 and maxNewFailures from 1 to 50', () => {
    expect([RETRIES_ON_CONTINUE_MIN, RETRIES_ON_CONTINUE_MAX]).toEqual([1, 3]);
    expect([FORCE_WRAP_UP_MAX_NEW_FAILURES_MIN, FORCE_WRAP_UP_MAX_NEW_FAILURES_MAX]).toEqual([1, 50]);
  });

  it('names the two criteria modes, extend first', () => {
    expect(CONTINUE_CRITERIA_MODES).toEqual(['extend', 'replace']);
  });
});

describe('loop.retriesOnContinue', () => {
  const expected = 'expected false or a whole number from 1 to 3';

  it.each([[1], [2], [3]])('accepts %p as itself', (raw) => {
    expect(readAs('loopRetriesOnContinue', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it('accepts false, for no retry', () => {
    expect(readAs('loopRetriesOnContinue', false)).toEqual({ value: false, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-1, '-1'],
    [4, '4'],
    [1.5, '1.5'],
    [true, 'true'],
    ['2', '"2"'],
    [null, 'null'],
  ])('refuses %p, naming the value and what was expected', (raw, shown) => {
    expect(readAs('loopRetriesOnContinue', raw)).toEqual({
      value: undefined,
      problems: [`F: loop.retriesOnContinue is ${shown}, ${expected}`],
      extras: [],
    });
  });
});

describe('loop.forceWrapUp.maxNewFailures', () => {
  const expected = 'expected false or a whole number from 1 to 50';

  it.each([[1], [2], [49], [50]])('accepts %p as itself', (raw) => {
    expect(readAs('loopForceWrapUpMaxNewFailures', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it('accepts false, for no new failure tolerated', () => {
    expect(readAs('loopForceWrapUpMaxNewFailures', false)).toEqual({ value: false, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-1, '-1'],
    [51, '51'],
    [2.5, '2.5'],
    [true, 'true'],
    ['5', '"5"'],
    [null, 'null'],
  ])('refuses %p, naming the value and what was expected', (raw, shown) => {
    expect(readAs('loopForceWrapUpMaxNewFailures', raw)).toEqual({
      value: undefined,
      problems: [`F: loop.forceWrapUp.maxNewFailures is ${shown}, ${expected}`],
      extras: [],
    });
  });
});

describe('loop.continue.criteria', () => {
  it.each([['.rafa/continue-criteria.md'], ['docs/criteria.md'], ['/abs/criteria.md']])('accepts %p as written', (raw) => {
    expect(readAs('loopContinueCriteria', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    ['', '""'],
    [7, '7'],
    [false, 'false'],
    [null, 'null'],
  ])('refuses %p, naming the value and a file path', (raw, shown) => {
    expect(readAs('loopContinueCriteria', raw)).toEqual({
      value: undefined,
      problems: [`F: loop.continue.criteria is ${shown}, expected a file path`],
      extras: [],
    });
  });
});

describe('loop.continue.criteriaMode', () => {
  it.each([['extend'], ['replace']])('accepts %p as itself', (raw) => {
    expect(readAs('loopContinueCriteriaMode', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    ['append', '"append"'],
    ['Extend', '"Extend"'],
    [true, 'true'],
    [null, 'null'],
  ])('refuses %p, naming the two modes', (raw, shown) => {
    expect(readAs('loopContinueCriteriaMode', raw)).toEqual({
      value: undefined,
      problems: [`F: loop.continue.criteriaMode is ${shown}, expected one of: extend, replace`],
      extras: [],
    });
  });
});

describe('through a file', () => {
  it('reads all four from the loop section, each its own key', () => {
    const layer = parseConfigText([
      'loop:',
      '  retries: 2',
      '  retriesOnContinue: 3',
      '  continue:',
      '    criteria: docs/criteria.md',
      '    criteriaMode: replace',
      '  forceWrapUp:',
      '    maxNewFailures: 5',
      '  wrapUp:',
      '    retries: 1',
    ].join('\n'), PATH);
    const { config, sources } = resolveConfig({ file: layer });

    expect([
      config.loopRetries,
      config.loopRetriesOnContinue,
      config.loopContinueCriteria,
      config.loopContinueCriteriaMode,
      config.loopForceWrapUpMaxNewFailures,
      config.loopWrapUpRetries,
    ]).toEqual([2, 3, 'docs/criteria.md', 'replace', 5, 1]);
    expect(sources.loopContinueCriteriaMode).toBe('file');
  });

  it('reads false for both counts', () => {
    const layer = parseConfigText('loop:\n  retriesOnContinue: false\n  forceWrapUp:\n    maxNewFailures: false\n', PATH);
    const { config, sources } = resolveConfig({ file: layer });

    expect([config.loopRetriesOnContinue, config.loopForceWrapUpMaxNewFailures]).toEqual([false, false]);
    expect([sources.loopRetriesOnContinue, sources.loopForceWrapUpMaxNewFailures]).toEqual(['file', 'file']);
  });

  it.each([['0'], ['-1'], ['4'], ['1.5'], ['true'], ['"2"']])('reports retriesOnContinue holding %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`loop:\n  retriesOnContinue: ${spelled}\n`, PATH));

    expect(error.message).toContain(`loop.retriesOnContinue is ${spelled}, expected false or a whole number from 1 to 3`);
  });

  it.each([['0'], ['-1'], ['51'], ['1.5'], ['true'], ['"5"']])('reports maxNewFailures holding %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`loop:\n  forceWrapUp:\n    maxNewFailures: ${spelled}\n`, PATH));

    expect(error.message).toContain(`loop.forceWrapUp.maxNewFailures is ${spelled}, expected false or a whole number from 1 to 50`);
  });

  it('reports an unknown criteria mode with a ConfigError naming the key', () => {
    const error = refusal(() => parseConfigText('loop:\n  continue:\n    criteriaMode: append\n', PATH));

    expect(error.message).toContain('loop.continue.criteriaMode is "append", expected one of: extend, replace');
  });
});
