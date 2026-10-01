/**
 * Tests for the `loop.wrapUp` section: `loop.wrapUp.retries`.
 *
 * The key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. The key,
 * its default and its refusal are SPELLED, never read off the module,
 * so a module that renames the key or moves the default fails rather
 * than agreeing with itself.
 */
import { describe, expect, it } from 'bun:test';

import { WRAP_UP_DEFAULTS, wrapUpRetries } from './config-schema-wrap-up.js';
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
const KEY = 'loop.wrapUp.retries';

/** What a refused value is expected to be. */
const EXPECTED = 'expected false or a whole number from 1 to 3';

/** Reads `raw` through the spec `SETTINGS` holds for `loopWrapUpRetries`. */
function readAs(raw: unknown) {
  return SETTINGS.loopWrapUpRetries.read(raw, { label: `F: ${KEY}`, key: KEY });
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
  it('spells loopWrapUpRetries as loop.wrapUp.retries, file-only, read through wrapUpRetries', () => {
    expect(SETTINGS.loopWrapUpRetries.key).toBe(KEY);
    expect(SETTINGS.loopWrapUpRetries.cli).toBe(false);
    expect(SETTINGS.loopWrapUpRetries.read).toBe(wrapUpRetries);
  });

  it('resolves to 1 when no layer names it', () => {
    expect(CONFIG_DEFAULTS.loopWrapUpRetries).toBe(1);
    expect(resolveConfig().config.loopWrapUpRetries).toBe(1);
    expect(resolveConfig().sources.loopWrapUpRetries).toBe('default');
  });

  it('keeps the default in the section object, frozen', () => {
    expect(WRAP_UP_DEFAULTS).toEqual({ loopWrapUpRetries: 1 });
    expect(Object.isFrozen(WRAP_UP_DEFAULTS)).toBe(true);
  });
});

describe('loop.wrapUp.retries', () => {
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
  it('reads false from the nested section', () => {
    const layer = parseConfigText('loop:\n  wrapUp:\n    retries: false\n', PATH);

    expect(resolveConfig({ file: layer }).config.loopWrapUpRetries).toBe(false);
    expect(resolveConfig({ file: layer }).sources.loopWrapUpRetries).toBe('file');
  });

  it('reads 3 from the nested section, beside loop.worktreeDir', () => {
    const layer = parseConfigText('loop:\n  worktreeDir: trees\n  wrapUp:\n    retries: 3\n', PATH);

    expect(resolveConfig({ file: layer }).config.loopWrapUpRetries).toBe(3);
  });

  it.each([['0'], ['-1'], ['4']])('reports a file holding %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`loop:\n  wrapUp:\n    retries: ${spelled}\n`, PATH));

    expect(error.message).toContain(`${KEY} is ${spelled}, ${EXPECTED}`);
  });
});
