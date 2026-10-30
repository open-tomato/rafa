/**
 * Tests for settle's release delivery (`./release-delivery.ts`): which
 * guard readings over `RELEASE_PR_BRANCH` are the delivery, and the
 * line it prints. The readings are built by hand, since the guard's own
 * reading off git is `./guard.test.ts`'s and the two commands' cases run
 * it over real repositories.
 */
import type { GuardRead, GuardVerdict } from './guard.js';

import { describe, expect, it } from 'bun:test';

import { isReleaseBranch, releaseDeliveryLine, releaseDeliveryOf } from './release-delivery.js';
import { RELEASE_PR_BRANCH } from './settle-pr.js';

/** A stale verdict over a stamp of 0.25.0, the base as `relation` says. */
function stale(relation: 'passed' | 'released' | 'not-on-base'): GuardVerdict {
  return {
    answer: 'stale',
    stamp: { version: '0.25.0', section: null },
    base: { version: '0.24.0', section: null, commit: null },
    relation,
  };
}

/** A read guard over `name` with pull request `pullRequest`, judged `verdict`. */
function readOn(name: string, verdict: GuardVerdict, pullRequest: number | null = 722): GuardRead {
  return {
    ok: true,
    verdict,
    branch: { ref: `origin/${name}`, name, pullRequest, commit: 'a'.repeat(40) },
    base: { ref: 'origin/main', commit: 'b'.repeat(40) },
    forecast: null,
    levelReport: null,
    problems: [],
  };
}

describe('isReleaseBranch', () => {
  it('names the branch settle pushes to, and no other', () => {
    expect([isReleaseBranch(RELEASE_PR_BRANCH), isReleaseBranch('feat/release'), isReleaseBranch('rafa/release-2')])
      .toEqual([true, false, false]);
  });
});

describe('releaseDeliveryOf', () => {
  it('reads a stale stamp the base has not released on the release branch as the delivery', () => {
    expect(releaseDeliveryOf(readOn(RELEASE_PR_BRANCH, stale('not-on-base'))))
      .toEqual({ kind: 'release-delivery', pullRequest: 722, version: '0.25.0' });
  });

  it('leaves the same stamp on any other branch as the guard read it', () => {
    expect(releaseDeliveryOf(readOn('feat/stamped', stale('not-on-base')))).toBeNull();
  });

  it('leaves a release branch the base has passed, released or collided with as the guard read it', () => {
    const collision: GuardVerdict = {
      answer: 'collision',
      stamp: { version: '0.25.0', section: null },
      base: { version: '0.25.0', section: null, commit: null },
    };
    const readings = [stale('passed'), stale('released'), collision].map((verdict) => readOn(RELEASE_PR_BRANCH, verdict));

    expect(readings.map(releaseDeliveryOf)).toEqual([null, null, null]);
  });

  it('answers null for a release branch with no pull request, and for a guard that did not read', () => {
    expect(releaseDeliveryOf(readOn(RELEASE_PR_BRANCH, stale('not-on-base'), null))).toBeNull();
    expect(releaseDeliveryOf({ ok: false, problem: 'no merge base' })).toBeNull();
  });
});

describe('releaseDeliveryLine', () => {
  it('names the pull request and the version it lands', () => {
    expect(releaseDeliveryLine({ kind: 'release-delivery', pullRequest: 722, version: '0.34.1' }))
      .toBe('Release: #722 is settle\'s release pull request; merging it lands 0.34.1');
  });
});
