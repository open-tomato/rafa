/**
 * `loop.retries`, the loop's own retry count: how many times in a row one
 * run re-enters its task loop after a stop a blind re-run is known to pass,
 * with its field, its default, its spec and its reader.
 * `config-schema.ts`'s `RafaConfig` extends {@link LoopRetriesSettings},
 * and its `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below right
 * after `loop.worktreeDir` and ahead of `loop.wrapUp`, so the order
 * settings are reported in holds the `loop` section together.
 *
 * The key has its own module, as `config-schema-wrap-up.ts` has, because
 * `config-schema.ts`'s own note asks a new section for a sibling, and
 * the reader is a rule about a VALUE that only this key reads, so it
 * sits here beside it. Only `config-schema.ts` imports this file; a
 * caller reads the setting off the resolved `RafaConfig`, and
 * `start/run-setup.ts` checks `--retry` against the same two bounds.
 *
 * ## The key
 *
 * A soft stop of `rafa loop start` (a red suite step, a session that
 * exited nonzero, a session that left neither a report nor a commit)
 * ends the run today, and the person runs `rafa loop start` again by
 * hand, which resumes at the `[BLOCKED]` line or the inserted repair.
 * `loop.retries` is how many of those re-runs the loop makes itself,
 * in a row, at those stops alone (`start/retry-budget.ts`): a task done
 * past the stop, neither the stopped task nor a repair, starts the count
 * over.
 *
 *
 *   - It defaults to `false`: no retry, so a run stops where it always
 *     did until a person asks for more.
 *   - It accepts a whole number from 1 to 3. Each retry spends at least
 *     one more session, so the cap of 3 bounds what a run whose stop
 *     keeps coming back can spend before it halts: a task that keeps
 *     failing never starts its own count over.
 *   - `false` means no retry. It is spelled `false` and not `0`, so a
 *     number always names retries that run; `0` is refused, as are a
 *     negative number, a fraction and anything above 3. `true` is
 *     refused too: it names no count, and reading it as some count
 *     would be a choice nobody wrote.
 *
 * A quoted `"2"` is refused, as every other reader refuses a string
 * spelled like its type. The key is not a `CommandLineSetting`: the
 * flag that outranks it for one run is `loop start --retry=<n>`, read
 * by `start/run-setup.ts`.
 */
import type { SettingSpec } from './config-schema.js';
import type { Reader } from './config-sections.js';

import { refused } from './config-sections.js';

/** The fewest retries `loop.retries` accepts as a number. */
export const LOOP_RETRIES_MIN = 1;

/** The most retries `loop.retries` accepts. */
export const LOOP_RETRIES_MAX = 3;

/** How many times in a row one run re-enters its loop after a retry-safe stop, or `false` for none. */
export type LoopRetries = number | false;

/** The `loop.retries` setting, resolved. */
export interface LoopRetriesSettings {
  /**
   * The retries in a row one run makes after a retry-safe stop, or
   * `false` for none. `loop.retries`.
   */
  loopRetries: LoopRetries;
}

/** True for a whole number from {@link LOOP_RETRIES_MIN} to {@link LOOP_RETRIES_MAX}. */
export function isLoopRetryCount(raw: unknown): raw is number {
  return typeof raw === 'number'
    && Number.isSafeInteger(raw)
    && raw >= LOOP_RETRIES_MIN
    && raw <= LOOP_RETRIES_MAX;
}

/**
 * Accepts `false` or a whole number from 1 to 3, each as itself; the
 * module note says why `0`, `true` and a quoted number are refused.
 */
export const loopRetries: Reader<LoopRetries> = (raw, at) => raw === false || isLoopRetryCount(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, `false or a whole number from ${String(LOOP_RETRIES_MIN)} to ${String(LOOP_RETRIES_MAX)}`);

/** What `loop.retries` resolves to when no layer names it. */
export const LOOP_RETRIES_DEFAULTS: Readonly<LoopRetriesSettings> = Object.freeze({
  loopRetries: false,
});

/** The `loop.retries` setting spec. */
export const LOOP_RETRIES_SETTINGS: {
  readonly [K in keyof LoopRetriesSettings]: SettingSpec<K>;
} = {
  loopRetries: { key: 'loop.retries', read: loopRetries, cli: false },
};
