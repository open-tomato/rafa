/**
 * Tests for `loop.retries`, the loop's own retry count.
 *
 * The key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. The key,
 * its default, its bounds and its refusal are SPELLED, never read off
 * the module, so a module that renames the key or moves the default
 * fails rather than agreeing with itself.
 */
import { describe, expect, it } from 'bun:test';

import {
  LOOP_RETRIES_DEFAULTS,
  LOOP_RETRIES_MAX,
  LOOP_RETRIES_MIN,
  loopRetries,
} from './config-schema-loop-retries.js';
import { SETTINGS } from './config-schema.js';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The file key, spelled. */
const KEY = 'loop.retries';

/** What a refused value is expected to be. */
const EXPECTED = 'expected false or a whole number from 1 to 3';

/** Reads `raw` through the spec `SETTINGS` holds for `loopRetries`. */
function readAs(raw: unknown) {
  return SETTINGS.loopRetries.read(raw, { label: `F: ${KEY}`, key: KEY });
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
  it('spells loopRetries as loop.retries, file-only, read through loopRetries', () => {
    expect(SETTINGS.loopRetries.key).toBe(KEY);
    expect(SETTINGS.loopRetries.cli).toBe(false);
    expect(SETTINGS.loopRetries.read).toBe(loopRetries);
  });

  it('resolves to false when no layer names it', () => {
    expect(CONFIG_DEFAULTS.loopRetries).toBe(false);
    expect(resolveConfig().config.loopRetries).toBe(false);
    expect(resolveConfig().sources.loopRetries).toBe('default');
  });

  it('keeps the default in the section object, frozen', () => {
    expect(LOOP_RETRIES_DEFAULTS).toEqual({ loopRetries: false });
    expect(Object.isFrozen(LOOP_RETRIES_DEFAULTS)).toBe(true);
  });

  it('bounds the count from 1 to 3', () => {
    expect([LOOP_RETRIES_MIN, LOOP_RETRIES_MAX]).toEqual([1, 3]);
  });
});

describe('loop.retries', () => {
  it.each([[1], [2], [3]])('accepts %p as itself', (raw) => {
    expect(readAs(raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it('accepts false, for no retry', () => {
    expect(readAs(false)).toEqual({ value: false, problems: [], extras: [] });
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
    expect(readAs(raw)).toEqual({
      value: undefined,
      problems: [`F: ${KEY} is ${shown}, ${EXPECTED}`],
      extras: [],
    });
  });
});

describe('through a file', () => {
  it('reads false from the loop section', () => {
    const layer = parseConfigText('loop:\n  retries: false\n', PATH);

    expect(resolveConfig({ file: layer }).config.loopRetries).toBe(false);
    expect(resolveConfig({ file: layer }).sources.loopRetries).toBe('file');
  });

  it('reads 2 beside loop.wrapUp.retries, each its own key', () => {
    const layer = parseConfigText('loop:\n  retries: 2\n  wrapUp:\n    retries: 3\n', PATH);
    const { config } = resolveConfig({ file: layer });

    expect([config.loopRetries, config.loopWrapUpRetries]).toEqual([2, 3]);
  });

  it.each([['0'], ['-1'], ['4'], ['1.5'], ['true'], ['"2"']])('reports a file holding %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`loop:\n  retries: ${spelled}\n`, PATH));

    expect(error.message).toContain(`${KEY} is ${spelled}, ${EXPECTED}`);
  });
});
