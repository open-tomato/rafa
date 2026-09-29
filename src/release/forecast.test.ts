/**
 * Tests for the release forecast (`src/release/forecast.ts`).
 *
 * Things here that would pass while wrong:
 *
 *  - A forecast that folded the branch fragment alone gives the same
 *    version as the full batch whenever nothing waits, so the batch
 *    cases put a waiting minor ahead of a branch patch and assert the
 *    minor, and assert the section's receipt names both, in order.
 *  - A `none` answer that folded anyway would still say "ships no
 *    release" with the real strategy, so the `none` case folds through
 *    a strategy that throws: reaching it would come back `failed`.
 *  - The bump word read off the branch's own level instead of the two
 *    versions would pass every case where the two agree; the waiting
 *    minor case is where they differ.
 */
import type { FoldFragment, ReleaseStrategyAdapter } from './strategy.js';
import type { PlanReleaseLevel } from '../plan/parse.js';

import { describe, expect, test } from 'bun:test';

import {
  FORECAST_NO_FRAGMENT_SENTENCE,
  FORECAST_NONE_SENTENCE,
  forecastRelease,
  forecastSettle,
  SETTLE_EMPTY_SENTENCE,
  SETTLE_NONE_SENTENCE,
  settlesSentence,
  shipsSentence,
  versionBump,
} from './forecast.js';
import { releaseStrategyFor } from './strategy.js';

const SEMVER = releaseStrategyFor('semver-by-level', { heading: '## {version} — {date}, {title}' });

/** A fragment of `level` named `id`, added on `addedOn`. */
function fragmentOf(id: string, level: PlanReleaseLevel, addedOn = '2026-09-29'): FoldFragment {
  const notes = level === 'none'
    ? []
    : [`- Area ${id}: change`];
  return { id, addedOn, fragment: { plan: id, title: `title ${id}`, level, notes } };
}

/** A strategy that throws `message` whenever it is asked to fold. */
function throwing(message: string): ReleaseStrategyAdapter {
  return {
    name: 'semver-by-level',
    fold: () => {
      throw new Error(message);
    },
  };
}

describe('forecastRelease', () => {
  test('a branch minor over a clean base ships as the next minor', () => {
    const forecast = forecastRelease({
      strategy: SEMVER,
      baseVersion: '0.25.3',
      waiting: [],
      branch: fragmentOf('rafa-367', 'minor'),
    });
    expect(forecast.sentence).toBe('ships as the next minor, 0.26.0 if merged now');
    expect(forecast).toMatchObject({ kind: 'ships', strategy: 'semver-by-level', version: '0.26.0', bump: 'minor' });
  });

  test('folds the waiting fragments first and the branch last', () => {
    const forecast = forecastRelease({
      strategy: SEMVER,
      baseVersion: '0.25.0',
      waiting: [fragmentOf('rafa-354', 'minor', '2026-09-27')],
      branch: fragmentOf('rafa-356', 'patch', '2026-09-28'),
    });
    expect(forecast.sentence).toBe('ships as the next minor, 0.26.0 if merged now');
    if (forecast.kind !== 'ships') throw new Error(`expected ships, got ${forecast.kind}`);
    expect(forecast.section.split('\n').slice(0, 2)).toEqual([
      '## 0.26.0 — 2026-09-28, title rafa-354; title rafa-356',
      '<!-- rafa:fragments rafa-354 rafa-356 -->',
    ]);
    expect(forecast.baseVersion).toBe('0.25.0');
    expect(forecast.waiting).toEqual(['rafa-354']);
  });

  test('answers the section the same fold gives settle over the merged batch', () => {
    const waiting = [fragmentOf('rafa-1', 'patch'), fragmentOf('rafa-2', 'major')];
    const branch = fragmentOf('rafa-3', 'minor');
    const forecast = forecastRelease({ strategy: SEMVER, baseVersion: '1.4.2', waiting, branch });
    const settled = SEMVER.fold('1.4.2', [...waiting, branch]);
    expect(forecast).toMatchObject({ kind: 'ships', version: settled?.version, section: settled?.section });
    expect(forecast.sentence).toBe('ships as the next major, 2.0.0 if merged now');
  });

  test('a branch patch alone ships as the next patch', () => {
    const forecast = forecastRelease({
      strategy: SEMVER,
      baseVersion: '0.25.0',
      waiting: [],
      branch: fragmentOf('rafa-9', 'patch'),
    });
    expect(forecast.sentence).toBe('ships as the next patch, 0.25.1 if merged now');
  });

  test('a none fragment ships no release and is not folded', () => {
    const forecast = forecastRelease({
      strategy: throwing('must not be reached'),
      baseVersion: '0.25.0',
      waiting: [fragmentOf('rafa-354', 'minor')],
      branch: fragmentOf('rafa-356', 'none'),
    });
    expect(forecast).toEqual({ kind: 'none', strategy: null, sentence: FORECAST_NONE_SENTENCE });
  });

  test('a fold that answers null reads as no release, naming the strategy', () => {
    const forecast = forecastRelease({
      strategy: { name: 'semver-by-level', fold: () => null },
      baseVersion: '0.25.0',
      waiting: [],
      branch: fragmentOf('rafa-1', 'patch'),
    });
    expect(forecast).toEqual({ kind: 'none', strategy: 'semver-by-level', sentence: FORECAST_NONE_SENTENCE });
  });

  test('no branch fragment is told apart from a none fragment', () => {
    const forecast = forecastRelease({
      strategy: throwing('must not be reached'),
      baseVersion: '0.25.0',
      waiting: [fragmentOf('rafa-354', 'minor')],
      branch: null,
    });
    expect(forecast).toEqual({ kind: 'no-fragment', sentence: FORECAST_NO_FRAGMENT_SENTENCE });
    expect(FORECAST_NO_FRAGMENT_SENTENCE).not.toBe(FORECAST_NONE_SENTENCE);
  });

  test('a throwing strategy answers the port line naming it', () => {
    const forecast = forecastRelease({
      strategy: throwing('boom'),
      baseVersion: '0.25.0',
      waiting: [],
      branch: fragmentOf('rafa-1', 'minor'),
    });
    expect(forecast).toEqual({
      kind: 'failed',
      strategy: 'semver-by-level',
      sentence: 'release strategy semver-by-level failed: boom',
    });
  });

  test('an unreadable base version fails through the real strategy', () => {
    const forecast = forecastRelease({
      strategy: SEMVER,
      baseVersion: 'not-a-version',
      waiting: [],
      branch: fragmentOf('rafa-1', 'minor'),
    });
    expect(forecast.kind).toBe('failed');
    expect(forecast.sentence).toStartWith('release strategy semver-by-level failed: ');
  });

  test('a prerelease promoted to its release names the version alone', () => {
    const forecast = forecastRelease({
      strategy: SEMVER,
      baseVersion: '1.0.0-rc.1',
      waiting: [],
      branch: fragmentOf('rafa-1', 'major'),
    });
    expect(forecast).toMatchObject({ kind: 'ships', version: '1.0.0', bump: null });
    expect(forecast.sentence).toBe('ships as 1.0.0 if merged now');
  });
});

describe('versionBump', () => {
  test.each([
    ['0.25.3', '1.0.0', 'major'],
    ['0.25.3', '0.26.0', 'minor'],
    ['0.25.3', '0.25.4', 'patch'],
    ['0.25.3', '0.25.3', null],
    ['0.25.3', 'next', null],
    ['latest', '0.25.4', null],
  ] as const)('%p to %p moves %p', (base, next, bump) => {
    expect(versionBump(base, next)).toBe(bump);
  });
});

describe('shipsSentence', () => {
  test('names the bump when there is one, the version alone otherwise', () => {
    expect(shipsSentence('0.26.0', 'minor')).toBe('ships as the next minor, 0.26.0 if merged now');
    expect(shipsSentence('2026.9', null)).toBe('ships as 2026.9 if merged now');
  });
});

describe('forecastSettle', () => {
  test('folds every waiting fragment, in order, into the version settle would write', () => {
    const forecast = forecastSettle({
      strategy: SEMVER,
      baseVersion: '0.25.0',
      waiting: [fragmentOf('rafa-354', 'patch', '2026-09-27'), fragmentOf('rafa-356', 'minor', '2026-09-28')],
    });
    expect(forecast).toMatchObject({
      kind: 'settles',
      strategy: 'semver-by-level',
      baseVersion: '0.25.0',
      waiting: ['rafa-354', 'rafa-356'],
      version: '0.26.0',
      bump: 'minor',
    });
    expect(forecast.sentence).toBe('settles as the next minor, 0.26.0');
    if (forecast.kind !== 'settles') throw new Error(`expected settles, got ${forecast.kind}`);
    expect(forecast.section.split('\n')[1]).toBe('<!-- rafa:fragments rafa-354 rafa-356 -->');
  });

  test('answers the section settle folds over the same batch', () => {
    const waiting = [fragmentOf('rafa-1', 'patch'), fragmentOf('rafa-2', 'none')];
    const forecast = forecastSettle({ strategy: SEMVER, baseVersion: '0.1.0', waiting });
    const folded = SEMVER.fold('0.1.0', waiting);
    expect(forecast).toMatchObject({ kind: 'settles', version: folded?.version, section: folded?.section });
  });

  test('nothing waiting is not folded: a throwing strategy is never reached', () => {
    const forecast = forecastSettle({ strategy: throwing('reached'), baseVersion: '0.1.0', waiting: [] });
    expect(forecast).toEqual({ kind: 'empty', sentence: SETTLE_EMPTY_SENTENCE });
  });

  test('only none fragments waiting settle no release, naming the strategy', () => {
    const forecast = forecastSettle({ strategy: SEMVER, baseVersion: '0.1.0', waiting: [fragmentOf('rafa-1', 'none')] });
    expect(forecast).toEqual({ kind: 'none', strategy: 'semver-by-level', sentence: SETTLE_NONE_SENTENCE });
  });

  test('a throwing strategy answers the port line naming it', () => {
    const forecast = forecastSettle({
      strategy: throwing('boom'),
      baseVersion: '0.1.0',
      waiting: [fragmentOf('rafa-1', 'patch')],
    });
    expect(forecast.kind).toBe('failed');
    expect(forecast.sentence).toStartWith('release strategy semver-by-level failed: ');
    expect(forecast.sentence).toContain('boom');
  });
});

describe('settlesSentence', () => {
  test('names the bump when there is one, the version alone otherwise', () => {
    expect(settlesSentence('0.26.0', 'minor')).toBe('settles as the next minor, 0.26.0');
    expect(settlesSentence('2026.9', null)).toBe('settles as 2026.9');
  });
});
