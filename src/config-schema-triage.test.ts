/**
 * Tests for the `triage` section: `triage.similarity.threshold` and
 * `triage.similarity.candidates`.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. Every key,
 * default and refusal is SPELLED, never read off the module, so a
 * module that renames a key or moves a default fails rather than
 * agreeing with itself.
 */
import { describe, expect, it } from 'bun:test';

import {
  similarityCandidates,
  similarityThreshold,
  TRIAGE_DEFAULTS,
} from './config-schema-triage.js';
import { SETTINGS } from './config-schema.js';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The threshold's file key, spelled. */
const THRESHOLD = 'triage.similarity.threshold';

/** The candidates' file key, spelled. */
const CANDIDATES = 'triage.similarity.candidates';

/** What a refused threshold is expected to be. */
const EXPECTED_THRESHOLD = 'expected false or a number above 0 and at most 1';

/** What a refused candidate count is expected to be. */
const EXPECTED_CANDIDATES = 'expected a whole number from 1 to 10';

/** Reads `raw` through the spec `SETTINGS` holds for the threshold. */
function readThreshold(raw: unknown) {
  return SETTINGS.triageSimilarityThreshold.read(raw, { label: `F: ${THRESHOLD}`, key: THRESHOLD });
}

/** Reads `raw` through the spec `SETTINGS` holds for the candidates. */
function readCandidates(raw: unknown) {
  return SETTINGS.triageSimilarityCandidates.read(raw, { label: `F: ${CANDIDATES}`, key: CANDIDATES });
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
  it('spells triageSimilarityThreshold as triage.similarity.threshold, file-only, read through similarityThreshold', () => {
    expect(SETTINGS.triageSimilarityThreshold.key).toBe(THRESHOLD);
    expect(SETTINGS.triageSimilarityThreshold.cli).toBe(false);
    expect(SETTINGS.triageSimilarityThreshold.read).toBe(similarityThreshold);
  });

  it('spells triageSimilarityCandidates as triage.similarity.candidates, file-only, read through similarityCandidates', () => {
    expect(SETTINGS.triageSimilarityCandidates.key).toBe(CANDIDATES);
    expect(SETTINGS.triageSimilarityCandidates.cli).toBe(false);
    expect(SETTINGS.triageSimilarityCandidates.read).toBe(similarityCandidates);
  });

  it('resolves the threshold to 0.3 and the candidates to 3 when no layer names them', () => {
    const resolved = resolveConfig();

    expect([CONFIG_DEFAULTS.triageSimilarityThreshold, CONFIG_DEFAULTS.triageSimilarityCandidates]).toEqual([0.3, 3]);
    expect([resolved.config.triageSimilarityThreshold, resolved.config.triageSimilarityCandidates]).toEqual([0.3, 3]);
    expect([resolved.sources.triageSimilarityThreshold, resolved.sources.triageSimilarityCandidates])
      .toEqual(['default', 'default']);
  });

  it('keeps the defaults in the section object, frozen', () => {
    expect(TRIAGE_DEFAULTS).toEqual({ triageSimilarityThreshold: 0.3, triageSimilarityCandidates: 3 });
    expect(Object.isFrozen(TRIAGE_DEFAULTS)).toBe(true);
  });
});

describe('triage.similarity.threshold', () => {
  it.each([[0.01], [0.3], [0.5], [1]])('accepts %p as itself', (raw) => {
    expect(readThreshold(raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it('accepts false, for no similarity step', () => {
    expect(readThreshold(false)).toEqual({ value: false, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-1, '-1'],
    [1.5, '1.5'],
    [2, '2'],
    [true, 'true'],
    ['0.3', '"0.3"'],
    [null, 'null'],
  ])('refuses %p, naming the value and what was expected', (raw, shown) => {
    expect(readThreshold(raw)).toEqual({
      value: undefined,
      problems: [`F: ${THRESHOLD} is ${shown}, ${EXPECTED_THRESHOLD}`],
      extras: [],
    });
  });
});

describe('triage.similarity.candidates', () => {
  it.each([[1], [3], [10]])('accepts %p as itself', (raw) => {
    expect(readCandidates(raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-1, '-1'],
    [11, '11'],
    [2.5, '2.5'],
    [false, 'false'],
    ['3', '"3"'],
    [null, 'null'],
  ])('refuses %p, naming the value and what was expected', (raw, shown) => {
    expect(readCandidates(raw)).toEqual({
      value: undefined,
      problems: [`F: ${CANDIDATES} is ${shown}, ${EXPECTED_CANDIDATES}`],
      extras: [],
    });
  });
});

describe('through a file', () => {
  it('reads false and 10 from the nested section', () => {
    const layer = parseConfigText('triage:\n  similarity:\n    threshold: false\n    candidates: 10\n', PATH);
    const resolved = resolveConfig({ file: layer });

    expect([resolved.config.triageSimilarityThreshold, resolved.config.triageSimilarityCandidates]).toEqual([false, 10]);
    expect([resolved.sources.triageSimilarityThreshold, resolved.sources.triageSimilarityCandidates])
      .toEqual(['file', 'file']);
  });

  it.each([['0'], ['-1'], ['1.5']])('reports a threshold of %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`triage:\n  similarity:\n    threshold: ${spelled}\n`, PATH));

    expect(error.message).toContain(`${THRESHOLD} is ${spelled}, ${EXPECTED_THRESHOLD}`);
  });

  it.each([['0'], ['-1'], ['11']])('reports candidates of %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`triage:\n  similarity:\n    candidates: ${spelled}\n`, PATH));

    expect(error.message).toContain(`${CANDIDATES} is ${spelled}, ${EXPECTED_CANDIDATES}`);
  });
});
