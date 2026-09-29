/**
 * The release forecast: what one branch's fragment would ship as if its
 * pull request merged now, and the sentence that says so.
 *
 * ```text
 * ships as the next minor, 0.26.0 if merged now
 * ```
 *
 * ## The fold, run as a forecast
 *
 * A forecast is the fold settle would run once the branch has merged:
 * the base branch's version, the fragments already waiting on the base
 * in their add order, and the branch's fragment after them, because a
 * merge now would add it last. It goes through `foldWithStrategy`
 * (`./strategy.ts`) like every other fold, so the forecast a pull
 * request shows and the section settle writes cannot disagree over the
 * same tree. This module reads nothing: the caller reads the base's
 * version and fragments (`./fragment-tree.ts`) and the branch's
 * fragment, and passes in the branch fragment's add date, so no clock
 * is read here either.
 *
 * ## The four answers
 *
 *   - `ships` — the fold answered a version. The sentence names the
 *     part of the base version that moves (`major`, `minor`, `patch`)
 *     read off the two versions, not off the fragments, so a batch
 *     whose waiting minor outranks the branch's patch reads "the next
 *     minor": that is the release the branch lands in. When no number
 *     moves (a prerelease promoted to its release) or a version is not
 *     semver, the sentence names the version alone.
 *   - `none` — the branch's fragment says `level: none`, or the fold
 *     answered null. The branch ships no release, whatever waits on
 *     the base: a waiting minor is not this branch's release. A `none`
 *     fragment is not folded at all.
 *   - `no-fragment` — the branch carries no fragment. Told apart from
 *     `none` on purpose: `none` is a decision written down, a missing
 *     fragment is a wrap-up that did not run or a branch that predates
 *     fragments.
 *   - `failed` — the strategy threw; the sentence is the port's one line
 *     naming the strategy and the error.
 *
 * Every answer that folded names the strategy, and a `ships` answer
 * carries the base version and the waiting ids it was computed against,
 * so a reader can tell when the base has moved since.
 */
import type { ReleaseStrategy } from '../config-readers.js';
import type { FoldFragment, ReleaseStrategyAdapter } from './strategy.js';

import { foldWithStrategy } from './strategy.js';
import { parseSemanticVersion } from './version.js';

/** The part of a version a forecast says moves. */
export type ForecastBump = 'major' | 'minor' | 'patch';

/** What the forecast was computed against, for telling when it is stale. */
export interface ForecastBasis {
  /** The base branch's version the fold started from. */
  readonly baseVersion: string;
  /** The ids of the fragments waiting on the base, in fold order. */
  readonly waiting: readonly string[];
}

/** What {@link forecastRelease} answers; see the module note. */
export type Forecast =
  | (ForecastBasis & {
    readonly kind: 'ships';
    readonly strategy: ReleaseStrategy;
    /** The version the base moves to if the branch merges now. */
    readonly version: string;
    /** The part of the base version that moves; null when none can be named. */
    readonly bump: ForecastBump | null;
    /** The section settle would write for that batch. */
    readonly section: string;
    readonly sentence: string;
  })
  | {
    readonly kind: 'none';
    /** The strategy that folded; null when a `none` fragment was not folded. */
    readonly strategy: ReleaseStrategy | null;
    readonly sentence: string;
  }
  | { readonly kind: 'no-fragment'; readonly sentence: string }
  | { readonly kind: 'failed'; readonly strategy: ReleaseStrategy; readonly sentence: string };

/** What {@link forecastRelease} reads. */
export interface ForecastInput {
  /** The strategy `release.strategy` names. */
  readonly strategy: ReleaseStrategyAdapter;
  /** The version the base branch's version file declares. */
  readonly baseVersion: string;
  /** The fragments waiting on the base branch, in add order. */
  readonly waiting: readonly FoldFragment[];
  /** The branch's own fragment, or null when it carries none. */
  readonly branch: FoldFragment | null;
}

/** The sentence of a branch whose fragment ships nothing. */
export const FORECAST_NONE_SENTENCE = 'ships no release (level none)';

/** The sentence of a branch that carries no fragment. */
export const FORECAST_NO_FRAGMENT_SENTENCE = 'carries no release fragment';

/** The ranks the three numbers are compared in, highest first. */
const BUMP_ORDER: readonly ForecastBump[] = ['major', 'minor', 'patch'];

/** The highest number that differs from `base` to `next`, or null. */
export function versionBump(base: string, next: string): ForecastBump | null {
  const from = parseSemanticVersion(base);
  const to = parseSemanticVersion(next);
  if (from === null || to === null) return null;
  return BUMP_ORDER.find((part) => from[part] !== to[part]) ?? null;
}

/** The sentence of a forecast that ships `version`, moving `bump`. */
export function shipsSentence(version: string, bump: ForecastBump | null): string {
  return bump === null
    ? `ships as ${version} if merged now`
    : `ships as the next ${bump}, ${version} if merged now`;
}

/** What the branch would ship if it merged now; see the module note. */
export function forecastRelease(input: ForecastInput): Forecast {
  const { strategy, baseVersion, waiting, branch } = input;
  if (branch === null) return { kind: 'no-fragment', sentence: FORECAST_NO_FRAGMENT_SENTENCE };
  if (branch.fragment.level === 'none') {
    return { kind: 'none', strategy: null, sentence: FORECAST_NONE_SENTENCE };
  }

  const outcome = foldWithStrategy(strategy, baseVersion, [...waiting, branch]);
  if (!outcome.ok) return { kind: 'failed', strategy: outcome.strategy, sentence: outcome.line };
  if (outcome.result === null) {
    return { kind: 'none', strategy: outcome.strategy, sentence: FORECAST_NONE_SENTENCE };
  }

  const { version, section } = outcome.result;
  const bump = versionBump(baseVersion, version);
  return {
    kind: 'ships',
    strategy: outcome.strategy,
    baseVersion,
    waiting: waiting.map((each) => each.id),
    version,
    bump,
    section,
    sentence: shipsSentence(version, bump),
  };
}
