/**
 * The `bugs` section of the config schema: `bugs.recheck.runs` and
 * `bugs.recheck.timeoutSeconds`, the two numbers `rafa bug recheck`
 * (#953) reads. {@link BUGS_SECTION} hands them to core as one
 * `ConfigSection`, package `bugs`, and the `declare module` below adds
 * {@link BugsSettings} to `RafaConfig`. {@link BugsShape} holds the keys
 * a file writes, which `src/config/shape.ts` composes into
 * `ConfigShape`, the nested file shape. `config-registry.ts` lists the
 * section right after the `errors` section, and its `CONFIG_DEFAULTS`
 * and `SETTINGS` spread the objects below right after the `errors` ones.
 *
 * ## The keys
 *
 * - `bugs.recheck.runs` is how many FURTHER runs recheck makes after a
 *   first run that passed, to tell a bug that is gone from a flaky one:
 *   a whole number from 1 to 20, default 5. A first run that failed or
 *   judged nothing ends the bug's runs, so this count is never spent on
 *   it.
 * - `bugs.recheck.timeoutSeconds` is the deadline of one run, in
 *   seconds: a whole number from 1 to 3600, default 300. A run that
 *   passes it is a failed run.
 *
 * Each reader refuses `0`, a negative number, a fraction, a quoted
 * number, `true` and `false` and a value above its cap, naming the
 * range: neither key has an "off" spelling, since recheck with no
 * further run, or with no deadline, is a recheck nobody asked for.
 * Neither key is a `CommandLineSetting`.
 */
import type { ConfigSection, SettingSpec } from '@open-tomato/rafa/core/config';
import type { Reader } from '@open-tomato/rafa/core/config/sections';

import { refused } from '@open-tomato/rafa/core/config/sections';

declare module '@open-tomato/rafa/core/config/config-schema' {
  /** The `bugs` section's fields, added to core's. */
  interface RafaConfig extends BugsSettings {}
}

/** The `bugs` keys a file writes; `src/config/shape.ts` composes them into `ConfigShape`. */
export interface BugsShape {
  readonly bugs: {
    readonly recheck: {
      readonly runs: number;
      readonly timeoutSeconds: number;
    };
  };
}

/** The `bugs` settings, resolved. */
export interface BugsSettings {
  /** `bugs.recheck.runs`: the further runs after a first pass. */
  bugsRecheckRuns: number;
  /** `bugs.recheck.timeoutSeconds`: one run's deadline, in seconds. */
  bugsRecheckTimeoutSeconds: number;
}

/** The fewest further runs `bugs.recheck.runs` accepts. */
export const BUGS_RECHECK_RUNS_MIN = 1;

/** The most further runs `bugs.recheck.runs` accepts. */
export const BUGS_RECHECK_RUNS_MAX = 20;

/** The shortest deadline `bugs.recheck.timeoutSeconds` accepts. */
export const BUGS_RECHECK_TIMEOUT_MIN = 1;

/** The longest deadline `bugs.recheck.timeoutSeconds` accepts: an hour. */
export const BUGS_RECHECK_TIMEOUT_MAX = 3600;

/**
 * A reader of a whole number from `min` to `max`, each as itself; any
 * other value, a quoted number and a boolean included, is refused
 * naming the range.
 *
 * @param min - The least value accepted.
 * @param max - The greatest value accepted.
 * @returns The reader.
 */
function wholeNumberIn(min: number, max: number): Reader<number> {
  return (raw, at) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= min && raw <= max
    ? { value: raw, problems: [], extras: [] }
    : refused(at, raw, `a whole number from ${String(min)} to ${String(max)}`);
}

/** Reads `bugs.recheck.runs`. */
export const bugsRecheckRuns: Reader<number> = wholeNumberIn(BUGS_RECHECK_RUNS_MIN, BUGS_RECHECK_RUNS_MAX);

/** Reads `bugs.recheck.timeoutSeconds`. */
export const bugsRecheckTimeoutSeconds: Reader<number> = wholeNumberIn(
  BUGS_RECHECK_TIMEOUT_MIN,
  BUGS_RECHECK_TIMEOUT_MAX,
);

/** What the `bugs` settings resolve to when no layer names them. */
export const BUGS_DEFAULTS: Readonly<BugsSettings> = Object.freeze({
  bugsRecheckRuns: 5,
  bugsRecheckTimeoutSeconds: 300,
});

/** Every `bugs` setting. */
export const BUGS_SETTINGS: { readonly [K in keyof BugsSettings]: SettingSpec<K> } = {
  bugsRecheckRuns: { key: 'bugs.recheck.runs', read: bugsRecheckRuns, cli: false },
  bugsRecheckTimeoutSeconds: { key: 'bugs.recheck.timeoutSeconds', read: bugsRecheckTimeoutSeconds, cli: false },
};

/** The `bugs` section: `bugs.recheck.runs` and `bugs.recheck.timeoutSeconds`, with their defaults and no check. */
export const BUGS_SECTION: ConfigSection = Object.freeze({
  package: 'bugs',
  settings: Object.freeze(BUGS_SETTINGS),
  defaults: BUGS_DEFAULTS,
});
