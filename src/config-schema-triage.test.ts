/**
 * Tests for the `triage` section: `triage.similarity.threshold`,
 * `triage.similarity.candidates` and the three
 * `triage.similarity.weights.*` bonuses.
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

import {
  ConfigError,
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  parseConfigText,
  resolveConfig,
} from '@open-tomato/rafa/core/config';

import { CONFIG_DEFAULTS, SETTINGS } from './config-registry.js';
import {
  similarityCandidates,
  similarityThreshold,
  similarityWeight,
  TRIAGE_DEFAULTS,
  TRIAGE_SECTION,
} from './config-schema-triage.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The threshold's file key, spelled. */
const THRESHOLD = 'triage.similarity.threshold';

/** The candidates' file key, spelled. */
const CANDIDATES = 'triage.similarity.candidates';

/** Each weight's setting and its file key, spelled. */
const WEIGHTS = [
  ['triageSimilarityWeightsCauseLeaf', 'triage.similarity.weights.causeLeaf'],
  ['triageSimilarityWeightsCauseFamily', 'triage.similarity.weights.causeFamily'],
  ['triageSimilarityWeightsBoundary', 'triage.similarity.weights.boundary'],
] as const;

/** What a refused weight is expected to be. */
const EXPECTED_WEIGHT = 'expected a number from 0 to 1';

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

/** Reads `raw` through the spec `SETTINGS` holds for the causeLeaf weight. */
function readWeight(raw: unknown) {
  const [setting, key] = WEIGHTS[0];
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

describe('the five keys', () => {
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

  it.each(WEIGHTS)('spells %s as %s, file-only, read through similarityWeight', (setting, key) => {
    expect(SETTINGS[setting].key).toBe(key);
    expect(SETTINGS[setting].cli).toBe(false);
    expect(SETTINGS[setting].read).toBe(similarityWeight);
  });

  it('resolves the weights to 0.15, 0.05 and 0.1 when no layer names them', () => {
    const resolved = resolveConfig();

    expect(WEIGHTS.map(([setting]) => CONFIG_DEFAULTS[setting])).toEqual([0.15, 0.05, 0.1]);
    expect(WEIGHTS.map(([setting]) => resolved.config[setting])).toEqual([0.15, 0.05, 0.1]);
    expect(WEIGHTS.map(([setting]) => resolved.sources[setting])).toEqual(['default', 'default', 'default']);
  });

  it('resolves the threshold to 0.3 and the candidates to 3 when no layer names them', () => {
    const resolved = resolveConfig();

    expect([CONFIG_DEFAULTS.triageSimilarityThreshold, CONFIG_DEFAULTS.triageSimilarityCandidates]).toEqual([0.3, 3]);
    expect([resolved.config.triageSimilarityThreshold, resolved.config.triageSimilarityCandidates]).toEqual([0.3, 3]);
    expect([resolved.sources.triageSimilarityThreshold, resolved.sources.triageSimilarityCandidates])
      .toEqual(['default', 'default']);
  });

  it('keeps the defaults in the section object, frozen', () => {
    expect(TRIAGE_DEFAULTS).toEqual({
      triageSimilarityThreshold: 0.3,
      triageSimilarityCandidates: 3,
      triageSimilarityWeightsCauseLeaf: 0.15,
      triageSimilarityWeightsCauseFamily: 0.05,
      triageSimilarityWeightsBoundary: 0.1,
    });
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

describe('triage.similarity.weights.*', () => {
  it.each([[0], [0.05], [0.15], [1]])('accepts %p as itself, 0 included to turn a signal off', (raw) => {
    expect(readWeight(raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    [-0.01, '-0.01'],
    [-1, '-1'],
    [1.01, '1.01'],
    [2, '2'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [true, 'true'],
    [false, 'false'],
    ['0.15', '"0.15"'],
    [null, 'null'],
  ])('refuses %p, naming the value and what was expected', (raw, shown) => {
    expect(readWeight(raw)).toEqual({
      value: undefined,
      problems: [`F: ${WEIGHTS[0][1]} is ${shown}, ${EXPECTED_WEIGHT}`],
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

  it('reads each weight from the nested weights section, 0 included', () => {
    const text = 'triage:\n  similarity:\n    weights:\n      causeLeaf: 0\n      causeFamily: 1\n      boundary: 0.5\n';
    const resolved = resolveConfig({ file: parseConfigText(text, PATH) });

    expect(WEIGHTS.map(([setting]) => resolved.config[setting])).toEqual([0, 1, 0.5]);
    expect(WEIGHTS.map(([setting]) => resolved.sources[setting])).toEqual(['file', 'file', 'file']);
  });

  it.each([['-1'], ['1.5'], ['true'], ['"0.1"']])('reports a boundary weight of %s with a ConfigError naming the key', (spelled) => {
    const error = refusal(() => parseConfigText(`triage:\n  similarity:\n    weights:\n      boundary: ${spelled}\n`, PATH));

    expect(error.message).toContain(`triage.similarity.weights.boundary is ${spelled}, ${EXPECTED_WEIGHT}`);
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

describe('the section', () => {
  it('is package triage, defining its keys in this order with these defaults, with no check', () => {
    expect(TRIAGE_SECTION.package).toBe('triage');
    expect(Object.entries(TRIAGE_SECTION.settings).map(([setting, spec]) => [setting, spec?.key])).toEqual([
      ['triageSimilarityThreshold', 'triage.similarity.threshold'],
      ['triageSimilarityCandidates', 'triage.similarity.candidates'],
      ['triageSimilarityWeightsCauseLeaf', 'triage.similarity.weights.causeLeaf'],
      ['triageSimilarityWeightsCauseFamily', 'triage.similarity.weights.causeFamily'],
      ['triageSimilarityWeightsBoundary', 'triage.similarity.weights.boundary'],
    ]);
    expect(TRIAGE_SECTION.defaults).toEqual({
      triageSimilarityThreshold: 0.3,
      triageSimilarityCandidates: 3,
      triageSimilarityWeightsCauseLeaf: 0.15,
      triageSimilarityWeightsCauseFamily: 0.05,
      triageSimilarityWeightsBoundary: 0.1,
    });
    expect(TRIAGE_SECTION.checks ?? []).toEqual([]);
  });

  it('hands in the very specs SETTINGS reads, frozen', () => {
    const entries = Object.entries(TRIAGE_SECTION.settings);

    expect(entries.length).toBeGreaterThan(0);
    for (const [setting, spec] of entries) {
      expect([setting, SETTINGS[setting as ConfigSetting] === spec]).toEqual([setting, true]);
    }
    expect(Object.isFrozen(TRIAGE_SECTION)).toBe(true);
    expect(Object.isFrozen(TRIAGE_SECTION.settings)).toBe(true);
    expect(Object.isFrozen(TRIAGE_SECTION.defaults)).toBe(true);
  });

  it('registers alone, each of its settings paired with a default', () => {
    const registry = mergeConfigSections(EMPTY_CONFIG_REGISTRY, [TRIAGE_SECTION]);

    expect(registry.sections.map((section) => section.package)).toEqual(['triage']);
    expect(Object.keys(registry.settings)).toEqual(Object.keys(TRIAGE_SECTION.settings));
    expect(Object.keys(registry.defaults).sort()).toEqual(Object.keys(TRIAGE_SECTION.settings).sort());
  });
});
