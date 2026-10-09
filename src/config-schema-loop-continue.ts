/**
 * The four keys `rafa loop start --continue` reads, with their fields,
 * their defaults, their specs and their readers:
 * `loop.retriesOnContinue`, `loop.continue.criteria`,
 * `loop.continue.criteriaMode` and `loop.forceWrapUp.maxNewFailures`.
 * `config-schema.ts`'s `RafaConfig` extends {@link LoopContinueSettings},
 * and its `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below right
 * after `loop.retries` and ahead of `loop.wrapUp`, so the order settings
 * are reported in holds the `loop` section together.
 *
 * The keys have their own module, as `config-schema-loop-retries.ts`
 * has, because `config-schema.ts`'s own note asks a new section for a
 * sibling, and the two count readers are rules about VALUES that only
 * these keys read. Only `config-schema.ts` imports this file; a caller
 * reads the settings off the resolved `RafaConfig`.
 *
 * ## The keys
 *
 * Under `--continue`, a stop that would end the run is handed to a
 * decision instead (`start/decision-prompt.ts`, `start/decision-parse.ts`):
 * retry the task with a new approach, stop, jump over it, or defer it
 * until a later task is done.
 *
 *   - `loop.retriesOnContinue` is the retry budget a `--continue` run
 *     opens when `--retry` is not typed: `false` or a whole number from
 *     1 to 3, default `1`, counted in a row as `loop.retries` is
 *     (`start/retry-budget.ts`). A run without `--continue` never reads it.
 *     It follows `loop.retries`' rules: `false` and not `0` means no
 *     retry, and `0`, a negative number, a fraction, anything above 3,
 *     `true` and a quoted number are refused.
 *   - `loop.continue.criteria` is the project's own criteria file, read
 *     from the project root on every decision, default
 *     `.rafa/continue-criteria.md`. A missing file is not an error here:
 *     whether it may be missing is the mode's rule.
 *   - `loop.continue.criteriaMode` says how the project file meets the
 *     bundled base criteria: `extend` (the default) appends it under the
 *     base, `replace` uses it alone, and a `replace` whose file is
 *     missing is refused when the run starts.
 *   - `loop.forceWrapUp.maxNewFailures` is how many NEW suite failures
 *     `--force-wrap-up` tolerates before it refuses the wrap-up: `false`
 *     (the default, none tolerated) or a whole number from 1 to 50, with
 *     the same refusals as the retry count. Inherited baseline failures
 *     are not counted.
 *
 * None is a `CommandLineSetting`: the flags that outrank a key for one
 * run (`--retry=<n>`) are read by `start/run-setup.ts`.
 */
import type { SettingSpec } from './config-schema.js';
import type { Reader } from './config-sections.js';

import { join } from 'node:path';

import { oneOf, refused, text } from './config-sections.js';

/** The fewest retries `loop.retriesOnContinue` accepts as a number. */
export const RETRIES_ON_CONTINUE_MIN = 1;

/** The most retries `loop.retriesOnContinue` accepts. */
export const RETRIES_ON_CONTINUE_MAX = 3;

/** The fewest new failures `loop.forceWrapUp.maxNewFailures` accepts as a number. */
export const FORCE_WRAP_UP_MAX_NEW_FAILURES_MIN = 1;

/** The most new failures `loop.forceWrapUp.maxNewFailures` accepts. */
export const FORCE_WRAP_UP_MAX_NEW_FAILURES_MAX = 50;

/** How the project criteria file meets the bundled base criteria. */
export const CONTINUE_CRITERIA_MODES = ['extend', 'replace'] as const;

/** One of {@link CONTINUE_CRITERIA_MODES}. */
export type ContinueCriteriaMode = (typeof CONTINUE_CRITERIA_MODES)[number];

/** A whole-number count a key bounds, or `false` for none. */
export type ContinueCount = number | false;

/** The settings `loop start --continue` reads, resolved. */
export interface LoopContinueSettings {
  /**
   * The retries a `--continue` run opens when `--retry` is not typed,
   * or `false` for none. `loop.retriesOnContinue`.
   */
  loopRetriesOnContinue: ContinueCount;
  /** The project criteria file, from the project root. `loop.continue.criteria`. */
  loopContinueCriteria: string;
  /** How the project criteria meet the base. `loop.continue.criteriaMode`. */
  loopContinueCriteriaMode: ContinueCriteriaMode;
  /**
   * The new suite failures `--force-wrap-up` tolerates, or `false` for
   * none. `loop.forceWrapUp.maxNewFailures`.
   */
  loopForceWrapUpMaxNewFailures: ContinueCount;
}

/** A reader accepting `false` or a whole number from `min` to `max`, each as itself. */
function countOrFalse(min: number, max: number): Reader<ContinueCount> {
  const expected = `false or a whole number from ${String(min)} to ${String(max)}`;
  return (raw, at) => raw === false || (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= min && raw <= max)
    ? { value: raw, problems: [], extras: [] }
    : refused(at, raw, expected);
}

/** Accepts `false` or a whole number from 1 to 3; the module note says why. */
export const retriesOnContinue: Reader<ContinueCount> = countOrFalse(
  RETRIES_ON_CONTINUE_MIN,
  RETRIES_ON_CONTINUE_MAX,
);

/** Accepts `false` or a whole number from 1 to 50; the module note says why. */
export const forceWrapUpMaxNewFailures: Reader<ContinueCount> = countOrFalse(
  FORCE_WRAP_UP_MAX_NEW_FAILURES_MIN,
  FORCE_WRAP_UP_MAX_NEW_FAILURES_MAX,
);

/** Accepts a non-blank path, kept as written. */
export const continueCriteria: Reader<string> = text('a file path');

/** Accepts `extend` or `replace`. */
export const continueCriteriaMode: Reader<ContinueCriteriaMode> = oneOf(CONTINUE_CRITERIA_MODES);

/** What the four settings resolve to when no layer names them. */
export const LOOP_CONTINUE_DEFAULTS: Readonly<LoopContinueSettings> = Object.freeze({
  loopRetriesOnContinue: 1,
  loopContinueCriteria: join('.rafa', 'continue-criteria.md'),
  loopContinueCriteriaMode: 'extend',
  loopForceWrapUpMaxNewFailures: false,
});

/** The four settings' specs. */
export const LOOP_CONTINUE_SETTINGS: {
  readonly [K in keyof LoopContinueSettings]: SettingSpec<K>;
} = {
  loopRetriesOnContinue: { key: 'loop.retriesOnContinue', read: retriesOnContinue, cli: false },
  loopContinueCriteria: { key: 'loop.continue.criteria', read: continueCriteria, cli: false },
  loopContinueCriteriaMode: { key: 'loop.continue.criteriaMode', read: continueCriteriaMode, cli: false },
  loopForceWrapUpMaxNewFailures: {
    key: 'loop.forceWrapUp.maxNewFailures',
    read: forceWrapUpMaxNewFailures,
    cli: false,
  },
};
