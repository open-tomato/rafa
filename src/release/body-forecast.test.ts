/**
 * Tests for `./body-forecast.ts`: the forecast read back out of a pull
 * request body, and whether the base moved since it was computed.
 *
 * Every body a case reads is WRITTEN by the writer the wrap-up uses —
 * `forecastRelease` (`./forecast.ts`) folding with the real
 * `semver-by-level` strategy, then `releaseBodyBlock` and
 * `bodyWithRelease` (`./branch-forecast.ts`) — so a change to the block
 * the wrap-up writes that the reader does not follow turns these red,
 * where a hand-written block would keep passing.
 */
import type { BranchForecast } from './branch-forecast.js';
import type { FoldFragment } from './strategy.js';
import type { PlanReleaseLevel } from '../plan/parse.js';

import { describe, expect, it } from 'bun:test';

import { forecastMoved, readBodyForecast } from './body-forecast.js';
import { bodyWithRelease, releaseBodyBlock } from './branch-forecast.js';
import { FORECAST_NONE_SENTENCE, forecastRelease } from './forecast.js';
import { releaseStrategyFor } from './strategy.js';

const SEMVER = releaseStrategyFor('semver-by-level', { heading: '## {version} — {date}, {title}' });

/** A fragment of `level` named `id`. */
function fragmentOf(id: string, level: PlanReleaseLevel): FoldFragment {
  const notes = level === 'none'
    ? []
    : [`- Area ${id}: change`];
  return { id, addedOn: '2026-09-29', fragment: { plan: id, title: `title ${id}`, level, notes } };
}

/** The body the wrap-up writes for `branch` over `waiting` at `baseVersion`, under a description. */
function writtenBody(baseVersion: string, waiting: readonly FoldFragment[], branch: FoldFragment): string {
  const forecast: BranchForecast = {
    ok: true,
    ref: 'origin/main',
    baseVersion,
    waiting: waiting.map((each) => each.id),
    forecast: forecastRelease({ strategy: SEMVER, baseVersion, waiting, branch }),
    problems: [],
  };
  const block = releaseBodyBlock({ forecast, levelReport: 'the plan declares release: patch' });
  return bodyWithRelease('Closes #12\n\nWhat this does.', null, block);
}

describe('readBodyForecast', () => {
  it('reads the sentence and the basis back out of the block the wrap-up writes', () => {
    const body = writtenBody('0.25.0', [fragmentOf('rafa-19', 'patch'), fragmentOf('rafa-20', 'patch')], fragmentOf('rafa-21', 'minor'));

    expect(readBodyForecast(body)).toEqual({
      sentence: 'ships as the next minor, 0.26.0 if merged now',
      basis: { baseVersion: '0.25.0', waiting: ['rafa-19', 'rafa-20'] },
    });
  });

  it('reads an empty waiting list as no fragment, not as one with an empty id', () => {
    const body = writtenBody('0.25.0', [], fragmentOf('rafa-21', 'patch'));

    expect(readBodyForecast(body)?.basis).toEqual({ baseVersion: '0.25.0', waiting: [] });
  });

  it('keeps a parenthesis the sentence holds, cutting only the basis clause', () => {
    const body = writtenBody('0.25.0', [], fragmentOf('rafa-21', 'none'));

    expect(readBodyForecast(body)?.sentence).toBe(FORECAST_NONE_SENTENCE);
  });

  it('answers null for a body with no release block', () => {
    expect(readBodyForecast('Closes #12\n\nNo release block here.')).toBeNull();
  });

  it('answers null for an opening marker the body never closes', () => {
    expect(readBodyForecast('<!-- rafa:release v1 base=0.25.0 waiting= -->\nRelease forecast: this branch x (y)')).toBeNull();
  });

  it('answers no sentence and no basis for a forecast that was not computed', () => {
    const unread: BranchForecast = { ok: false, ref: 'origin/main', problem: 'origin/main:package.json declares no version', problems: [] };
    const body = bodyWithRelease('', null, releaseBodyBlock({ forecast: unread, levelReport: null }));

    expect(readBodyForecast(body)).toEqual({ sentence: null, basis: null });
  });

  it('answers no sentence for a block holding a level report alone', () => {
    const body = bodyWithRelease('', null, releaseBodyBlock({ forecast: null, levelReport: 'the plan declares release: patch' }));

    expect(readBodyForecast(body)).toEqual({ sentence: null, basis: null });
  });
});

describe('forecastMoved', () => {
  const basis = { baseVersion: '0.25.0', waiting: ['rafa-19', 'rafa-20'] };

  it('is false for the same version and the same waiting fragments', () => {
    expect(forecastMoved(basis, { baseVersion: '0.25.0', waiting: ['rafa-19', 'rafa-20'] })).toBe(false);
  });

  it('is true when the base version moved', () => {
    expect(forecastMoved(basis, { baseVersion: '0.26.0', waiting: ['rafa-19', 'rafa-20'] })).toBe(true);
  });

  it('is true when a fragment was added to the base', () => {
    expect(forecastMoved(basis, { baseVersion: '0.25.0', waiting: ['rafa-19', 'rafa-20', 'rafa-22'] })).toBe(true);
  });

  it('is true when the base settled its fragments', () => {
    expect(forecastMoved(basis, { baseVersion: '0.25.0', waiting: [] })).toBe(true);
  });

  it('is true when the same fragments wait in another order, which folds differently', () => {
    expect(forecastMoved(basis, { baseVersion: '0.25.0', waiting: ['rafa-20', 'rafa-19'] })).toBe(true);
  });
});
