/**
 * Tests for the release strategy port (`src/release/strategy.ts`): the
 * registry keyed by `release.strategy`, and the wrapper that answers a
 * throwing strategy as one line naming it and the error.
 *
 * Things here that would pass while wrong:
 *
 *  - A wrapper that answered `ok: false` for everything satisfies the
 *    throw cases, so a strategy that returns is folded through the same
 *    wrapper and must come back `ok: true` with its result untouched,
 *    null included.
 *  - A failure line that dropped everything after the first line of a
 *    multi-line message would still be one line, so the case asserts
 *    the whole message survives, collapsed.
 */
import type { FoldResult, ReleaseStrategyAdapter } from './strategy.js';

import { describe, expect, test } from 'bun:test';

import { RELEASE_STRATEGIES } from '../config-readers.js';

import {
  foldWithStrategy,
  RELEASE_STRATEGY_ADAPTERS,
  releaseStrategyFor,
  strategyFailureLine,
} from './strategy.js';

const RESULT: FoldResult = { version: '1.0.0', section: '## 1.0.0' };

/** A `semver-by-level`-named strategy whose fold does `fold`. */
function stub(fold: ReleaseStrategyAdapter['fold']): ReleaseStrategyAdapter {
  return { name: 'semver-by-level', fold };
}

describe('the strategy registry', () => {
  test('holds an adapter for every name release.strategy accepts, and no other', () => {
    expect(Object.keys(RELEASE_STRATEGY_ADAPTERS).sort()).toEqual([...RELEASE_STRATEGIES].sort());
  });

  test.each([...RELEASE_STRATEGIES])('the %p adapter answers to its own name', (name) => {
    expect(releaseStrategyFor(name, { heading: '## {version}' }).name).toBe(name);
  });

  test('builds semver-by-level over the configured heading', () => {
    const strategy = releaseStrategyFor('semver-by-level', { heading: '# v{version}' });
    const fragment = { plan: 'rafa-1', title: 'one', level: 'patch' as const, notes: ['- x'] };
    const answer = strategy.fold('0.1.0', [{ id: 'rafa-1', addedOn: '2026-09-29', fragment }]);
    expect(answer?.section.split('\n')[0]).toBe('# v0.1.1');
  });
});

describe('foldWithStrategy', () => {
  test('passes a result through, naming the strategy', () => {
    expect(foldWithStrategy(stub(() => RESULT), '0.1.0', [])).toEqual({
      ok: true,
      strategy: 'semver-by-level',
      result: RESULT,
    });
  });

  test('passes a null result through as nothing to settle', () => {
    expect(foldWithStrategy(stub(() => null), '0.1.0', [])).toEqual({
      ok: true,
      strategy: 'semver-by-level',
      result: null,
    });
  });

  test('hands the fold the version and the fragments it was given', () => {
    const seen: unknown[] = [];
    foldWithStrategy(stub((version, fragments) => {
      seen.push(version, fragments);
      return null;
    }), '0.9.0', []);
    expect(seen).toEqual(['0.9.0', []]);
  });

  test('turns a throw into one line naming the strategy and the error', () => {
    const outcome = foldWithStrategy(stub(() => {
      throw new Error('the base version "x" is no semantic version to bump');
    }), 'x', []);
    expect(outcome).toEqual({
      ok: false,
      strategy: 'semver-by-level',
      line: 'release strategy semver-by-level failed: the base version "x" is no semantic version to bump',
    });
  });

  test('turns the real adapter\'s throw into that line', () => {
    const strategy = releaseStrategyFor('semver-by-level', { heading: '## {version}' });
    const fragment = { plan: 'rafa-1', title: 'one', level: 'minor' as const, notes: ['- x'] };
    const outcome = foldWithStrategy(strategy, 'garbage', [{ id: 'rafa-1', addedOn: '2026-09-29', fragment }]);
    expect(outcome).toEqual({
      ok: false,
      strategy: 'semver-by-level',
      line: 'release strategy semver-by-level failed: the base version "garbage" is no semantic version to bump',
    });
  });

  test('keeps a multi-line message whole on one line', () => {
    const outcome = foldWithStrategy(stub(() => {
      throw new Error('first half\n  second half\n');
    }), '0.1.0', []);
    expect(outcome.ok
      ? ''
      : outcome.line).toBe('release strategy semver-by-level failed: first half second half');
  });
});

describe('strategyFailureLine', () => {
  test('names a thrown non-error by its string', () => {
    expect(strategyFailureLine('semver-by-level', 42)).toBe('release strategy semver-by-level failed: 42');
  });

  test('says so when the error carries no message', () => {
    expect(strategyFailureLine('semver-by-level', new Error(''))).toBe(
      'release strategy semver-by-level failed: it threw with no message',
    );
  });
});
