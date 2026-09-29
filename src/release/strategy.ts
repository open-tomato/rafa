/**
 * The release strategy port: the one call that turns the base branch's
 * version and the fragments waiting on it into the next version and its
 * changelog section.
 *
 * ```text
 * fold(currentVersion, orderedFragments) → { version, section } | null
 * ```
 *
 * The forecast in a pull request body, the guard before a merge and
 * `rafa release settle` all go through {@link foldWithStrategy}, so the
 * three can never disagree about what a batch of fragments is worth.
 *
 * ## Committed data only
 *
 * A strategy's inputs are the version the base branch declares and the
 * fragments present in its tree, in the order git says each was added.
 * It never reads the network, a label or the clock, so two machines
 * folding the same tree get byte-identical answers. Anything that would
 * need the clock is passed in: {@link FoldFragment.addedOn} is the UTC
 * date of the commit that added the fragment, which is where a
 * section's `{date}` comes from. Configuration a strategy renders with,
 * `release.heading`, is handed to its factory once
 * ({@link ReleaseStrategyOptions}) rather than read by the fold.
 *
 * ## Null is "nothing to settle"
 *
 * A fold answers null when the batch ships nothing — no fragment, or
 * only `level: none` ones — and a {@link FoldResult} otherwise. It does
 * not answer null for a batch it cannot fold: an unreadable base version
 * is a THROW, because "nothing to settle" would let settle exit 0 over
 * fragments that are still waiting.
 *
 * ## The registry and the wrapper
 *
 * {@link RELEASE_STRATEGY_ADAPTERS} is keyed by the values
 * `release.strategy` accepts (`RELEASE_STRATEGIES` in
 * `src/config-readers.ts`), typed as a complete record of them, so a
 * name added to the config's closed list without an adapter fails the
 * type check rather than a settle.
 *
 * {@link foldWithStrategy} is the one place a fold is called. A strategy
 * that throws is answered as {@link FoldOutcome} `ok: false` with one
 * line naming the strategy and the error, so settle writes nothing and
 * prints that line, and every answer — success or not — names the
 * strategy that gave it.
 */
import type { ReleaseStrategy } from '../config-readers.js';
import type { Fragment } from './fragment.js';

import { createSemverByLevel } from './strategies/semver-by-level.js';

/** One fragment as a fold reads it: its content, name and add date. */
export interface FoldFragment {
  /**
   * The fragment's file name without `.md` — `rafa-247`, or
   * `rafa-247-2` for a plan's second waiting fragment. The receipt
   * comment names fragments by this id, which is unique in a tree
   * where the plan id need not be.
   */
  readonly id: string;
  /** The parsed fragment. */
  readonly fragment: Fragment;
  /**
   * The UTC date, `YYYY-MM-DD`, of the commit that added the fragment
   * to the base branch. Passed in so the fold never reads the clock.
   */
  readonly addedOn: string;
}

/** What a fold answers when the batch ships something. */
export interface FoldResult {
  /** The version the base branch moves to. */
  readonly version: string;
  /**
   * The changelog section: heading, receipt comment and notes, with no
   * trailing newline — the shape `insertChangelogEntry` takes.
   */
  readonly section: string;
}

/** The one call a strategy answers; see the module note. */
export type Fold = (
  currentVersion: string,
  orderedFragments: readonly FoldFragment[],
) => FoldResult | null;

/** A strategy: its `release.strategy` name and its fold. */
export interface ReleaseStrategyAdapter {
  /** The name `release.strategy` selects it by. */
  readonly name: ReleaseStrategy;
  /** Folds a batch into a version and a section, or null for none. */
  readonly fold: Fold;
}

/** The configuration a strategy renders with, fixed at construction. */
export interface ReleaseStrategyOptions {
  /** `release.heading`, the template of the section's heading line. */
  readonly heading: string;
}

/** Builds one strategy over the project's configuration. */
export type ReleaseStrategyFactory = (options: ReleaseStrategyOptions) => ReleaseStrategyAdapter;

/** Every strategy `release.strategy` may name, by that name. */
export const RELEASE_STRATEGY_ADAPTERS: Readonly<Record<ReleaseStrategy, ReleaseStrategyFactory>> = {
  'semver-by-level': createSemverByLevel,
};

/** The strategy `name` names, built over `options`. */
export function releaseStrategyFor(
  name: ReleaseStrategy,
  options: ReleaseStrategyOptions,
): ReleaseStrategyAdapter {
  return RELEASE_STRATEGY_ADAPTERS[name](options);
}

/** What {@link foldWithStrategy} answers; both arms name the strategy. */
export type FoldOutcome =
  | {
    readonly ok: true;
    readonly strategy: ReleaseStrategy;
    /** The fold's answer; null when the batch ships nothing. */
    readonly result: FoldResult | null;
  }
  | {
    readonly ok: false;
    readonly strategy: ReleaseStrategy;
    /** One line naming the strategy and the error, for a caller to print. */
    readonly line: string;
  };

/** Whitespace runs, newlines included. */
const WHITESPACE = /\s+/g;

/** What `thrown` says, on one line. */
function messageOf(thrown: unknown): string {
  const raw = thrown instanceof Error
    ? thrown.message
    : String(thrown);
  const message = raw.replace(WHITESPACE, ' ').trim();
  return message === ''
    ? 'it threw with no message'
    : message;
}

/** The one line a throwing strategy is reported as. */
export function strategyFailureLine(strategy: ReleaseStrategy, thrown: unknown): string {
  return `release strategy ${strategy} failed: ${messageOf(thrown)}`;
}

/**
 * `strategy`'s fold over `currentVersion` and `orderedFragments`, with
 * a throw turned into one line naming the strategy and the error. The
 * only place a fold is called.
 */
export function foldWithStrategy(
  strategy: ReleaseStrategyAdapter,
  currentVersion: string,
  orderedFragments: readonly FoldFragment[],
): FoldOutcome {
  try {
    const result = strategy.fold(currentVersion, orderedFragments);
    return { ok: true, strategy: strategy.name, result };
  } catch (thrown) {
    return { ok: false, strategy: strategy.name, line: strategyFailureLine(strategy.name, thrown) };
  }
}
