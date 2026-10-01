/**
 * The `loop.wrapUp` section of the config schema: the one setting the
 * wrap-up reads when its session ends without an open pull request,
 * with its field, its default, its spec and its reader.
 * `config-schema.ts`'s `RafaConfig` extends {@link WrapUpSettings}, and
 * its `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below right
 * after `loop.worktreeDir`, so the order settings are reported in holds
 * the `loop` section together.
 *
 * The section has its own module, as `config-schema-release.ts` and
 * `config-schema-tests.ts` do, because `config-schema.ts` stood at 578
 * lines and `config-sections.ts` at 642, measured with `wc -l`, when
 * this key was added: the schema module's own note asks a new section
 * for a sibling, and the reader is a rule about a VALUE that only this
 * key reads, so it sits here beside it. Only `config-schema.ts` imports
 * this file; a caller reads the setting off the resolved `RafaConfig`.
 *
 * ## The key
 *
 * `.rafa/specs/rafa-579-loop-run-ends-delivered.md` has a loop run end
 * with its pull request open. When the wrap-up session ends and no pull
 * request is open for the branch, the runner spawns another wrap-up
 * session that is told the pull request is missing, and
 * `loop.wrapUp.retries` is how many of those it spawns before opening
 * the pull request itself:
 *
 *   - It defaults to `1`: one retry session, which costs one more
 *     session's spend on the run that needed it and nothing on a run
 *     whose first wrap-up opened the pull request.
 *   - It accepts a whole number from 1 to 3. Each retry is a full
 *     session, so the cap of 3 bounds what a run whose wrap-up keeps
 *     missing the pull request can spend before the runner opens it.
 *   - `false` means no retry: the runner goes straight to opening the
 *     pull request itself. It is spelled `false` and not `0`, so a
 *     number always names sessions that run; `0` is refused, as are a
 *     negative number, a fraction and anything above 3. `true` is
 *     refused too: it names no count, and reading it as the default
 *     would be a choice nobody wrote.
 *
 * A quoted `"2"` is refused, as every other reader refuses a string
 * spelled like its type. The key is not a `CommandLineSetting`: the
 * command line has no spelling for `false` or a number this module
 * would not have to invent.
 */
import type { SettingSpec } from './config-schema.js';
import type { Reader } from './config-sections.js';

import { refused } from './config-sections.js';

/** The fewest retry sessions `loop.wrapUp.retries` accepts as a number. */
export const WRAP_UP_RETRIES_MIN = 1;

/** The most retry sessions `loop.wrapUp.retries` accepts. */
export const WRAP_UP_RETRIES_MAX = 3;

/**
 * How many retry wrap-up sessions a run spawns when its wrap-up ends
 * with no pull request open, or `false` for none.
 */
export type WrapUpRetries = number | false;

/** The `loop.wrapUp` section's settings, resolved. */
export interface WrapUpSettings {
  /**
   * The retry wrap-up sessions spawned before the runner opens the pull
   * request itself, or `false` for none. `loop.wrapUp.retries`.
   */
  loopWrapUpRetries: WrapUpRetries;
}

/** True for a whole number from {@link WRAP_UP_RETRIES_MIN} to {@link WRAP_UP_RETRIES_MAX}. */
function isRetryCount(raw: unknown): raw is number {
  return typeof raw === 'number'
    && Number.isSafeInteger(raw)
    && raw >= WRAP_UP_RETRIES_MIN
    && raw <= WRAP_UP_RETRIES_MAX;
}

/**
 * Accepts `false` or a whole number from 1 to 3, each as itself; the
 * module note says why `0`, `true` and a quoted number are refused.
 */
export const wrapUpRetries: Reader<WrapUpRetries> = (raw, at) => raw === false || isRetryCount(raw)
  ? { value: raw, problems: [], extras: [] }
  : refused(at, raw, `false or a whole number from ${String(WRAP_UP_RETRIES_MIN)} to ${String(WRAP_UP_RETRIES_MAX)}`);

/** What the `loop.wrapUp` setting resolves to when no layer names it. */
export const WRAP_UP_DEFAULTS: Readonly<WrapUpSettings> = Object.freeze({
  loopWrapUpRetries: 1,
});

/** The `loop.wrapUp` section's setting spec. */
export const WRAP_UP_SETTINGS: {
  readonly [K in keyof WrapUpSettings]: SettingSpec<K>;
} = {
  loopWrapUpRetries: { key: 'loop.wrapUp.retries', read: wrapUpRetries, cli: false },
};
