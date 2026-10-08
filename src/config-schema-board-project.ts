/**
 * The five limits of the `board.project` section: how a call to the
 * GitHub project is retried, how often a long refresh says where it is,
 * and how its field writes are batched and spaced. Each has its field,
 * its default, its reader and its spec here. `config-schema.ts`'s
 * `RafaConfig` extends {@link BoardProjectLimitSettings}, and its
 * `CONFIG_DEFAULTS` and `SETTINGS` spread the objects below right after
 * `board.project.number`, so the order settings are reported in holds the
 * `board.project` section together.
 *
 * `board.project.template` and `board.project.number` stay in
 * `config-schema.ts`, whose readings note in `config-schema-readings.ts`
 * argues them. These five have their own module, as the `loop.wrapUp`
 * key does, because `config-schema.ts` stood at 617 lines and
 * `config-sections.ts` at 744, measured with `wc -l`, when they were
 * added: five more specs and five readers would have put the readers'
 * module within a page of the 800-line cap of `context/source.md`. Only
 * `config-schema.ts` imports this file; a caller reads each setting off
 * the resolved `RafaConfig`.
 *
 * ## The keys
 *
 * Issues #922, #923 and #900 found a refresh reading one page of a list,
 * failing on the first network error and printing nothing while it ran.
 * The fix reads every limit off the config, never a constant:
 *
 * | Key | Counts | Default | Accepts |
 * |---|---|---|---|
 * | `retries` | tries after a failure, per call | 3 | 1 to 10, or `false` |
 * | `retryWaitSeconds` | the first wait; each later one doubles | 2 | 1 to 60 |
 * | `progressSeconds` | the most time between two progress lines | 10 | 1 to 300, or `false` |
 * | `writeBatchSize` | field writes per request | 20 | 1 to 100 |
 * | `writePauseMs` | the pause between two write requests | 1000 | 0 to 60000 |
 *
 * ## The readings
 *
 * Four readings the plan leaves to this module:
 *
 *   - `false` is the one spelling of "off", and only two keys take it.
 *     `retries: false` makes a failed call fail at once, as before the
 *     key existed; `progressSeconds: false` drops the lines between the
 *     start line and the end line, which stay. A wait, a batch and a
 *     pause have no "off" that means anything: a batch of none writes
 *     nothing, and a refresh with no waits is `retries: false`.
 *   - `0` and a negative number are refused on every key but
 *     `writePauseMs`, and never read as off. A number always names a
 *     count or a time that happens, as `loop.wrapUp.retries` has it, so
 *     a person who wrote `0` meaning "never" learns to write `false`.
 *     `writePauseMs: 0` is a pause of no time, a number that still
 *     happens, and is accepted: it is what a test or a project with a
 *     generous rate limit writes.
 *   - Each cap is the plan's, and bounds what one refresh can cost: ten
 *     retries, the first wait at most a minute, a progress line at least
 *     every five minutes, a hundred field writes to a request and a
 *     pause of at most a minute. A cap is a config change away from
 *     moving; none was measured against a GitHub limit.
 *   - `true`, a fraction and a quoted number are refused, as every
 *     reader in `config-sections.ts` refuses them: `true` names no
 *     count, and reading it as the default would be a choice nobody
 *     wrote.
 *
 * None is a `CommandLineSetting`, for the reason `board.project.number`
 * gives in `config-schema-readings.ts`: every command that refreshes the
 * project must write it the same way, which one run's flag would split.
 */
import type { SettingSpec } from './config-schema.js';
import type { Reader } from './config-sections.js';

import { refused } from './config-sections.js';

/** The fewest tries after a failure `board.project.retries` accepts as a number. */
export const BOARD_PROJECT_RETRIES_MIN = 1;

/** The most tries after a failure `board.project.retries` accepts. */
export const BOARD_PROJECT_RETRIES_MAX = 10;

/** The shortest first wait `board.project.retryWaitSeconds` accepts. */
export const BOARD_PROJECT_RETRY_WAIT_MIN_SECONDS = 1;

/** The longest first wait `board.project.retryWaitSeconds` accepts. */
export const BOARD_PROJECT_RETRY_WAIT_MAX_SECONDS = 60;

/** The shortest gap between progress lines `board.project.progressSeconds` accepts. */
export const BOARD_PROJECT_PROGRESS_MIN_SECONDS = 1;

/** The longest gap between progress lines `board.project.progressSeconds` accepts. */
export const BOARD_PROJECT_PROGRESS_MAX_SECONDS = 300;

/** The fewest field writes per request `board.project.writeBatchSize` accepts. */
export const BOARD_PROJECT_WRITE_BATCH_MIN = 1;

/** The most field writes per request `board.project.writeBatchSize` accepts. */
export const BOARD_PROJECT_WRITE_BATCH_MAX = 100;

/** The shortest pause between write requests `board.project.writePauseMs` accepts. */
export const BOARD_PROJECT_WRITE_PAUSE_MIN_MS = 0;

/** The longest pause between write requests `board.project.writePauseMs` accepts. */
export const BOARD_PROJECT_WRITE_PAUSE_MAX_MS = 60_000;

/** How many times a failed project call is tried again, or `false` for never. */
export type BoardProjectRetries = number | false;

/** The most seconds between two progress lines, or `false` for no lines between start and end. */
export type BoardProjectProgressSeconds = number | false;

/** The `board.project` section's limits, resolved. */
export interface BoardProjectLimitSettings {
  /**
   * The tries after a failure, per call, or `false` for none.
   * `board.project.retries`.
   */
  boardProjectRetries: BoardProjectRetries;
  /**
   * The first wait before a retry, in seconds; each later one doubles.
   * `board.project.retryWaitSeconds`.
   */
  boardProjectRetryWaitSeconds: number;
  /**
   * The most seconds between two progress lines, or `false` for none
   * between the start and end lines. `board.project.progressSeconds`.
   */
  boardProjectProgressSeconds: BoardProjectProgressSeconds;
  /** The field writes sent in one request. `board.project.writeBatchSize`. */
  boardProjectWriteBatchSize: number;
  /**
   * The pause between two write requests, in milliseconds.
   * `board.project.writePauseMs`.
   */
  boardProjectWritePauseMs: number;
}

/** True for a whole number from `min` to `max`, both included. */
function isWholeBetween(raw: unknown, min: number, max: number): raw is number {
  return typeof raw === 'number'
    && Number.isSafeInteger(raw)
    && raw >= min
    && raw <= max;
}

/** What a refusal of a whole number from `min` to `max` says was expected. */
function rangeWords(min: number, max: number): string {
  return `a whole number from ${String(min)} to ${String(max)}`;
}

/** Accepts a whole number from `min` to `max`, each as itself. */
function wholeBetween(min: number, max: number): Reader<number> {
  return (raw, at) => isWholeBetween(raw, min, max)
    ? { value: raw, problems: [], extras: [] }
    : refused(at, raw, rangeWords(min, max));
}

/** Accepts `false` or a whole number from `min` to `max`, each as itself. */
function offOrWholeBetween(min: number, max: number): Reader<number | false> {
  return (raw, at) => raw === false || isWholeBetween(raw, min, max)
    ? { value: raw, problems: [], extras: [] }
    : refused(at, raw, `false or ${rangeWords(min, max)}`);
}

/** Accepts `board.project.retries`; the module note says why `0` and `true` are refused. */
export const boardProjectRetries: Reader<BoardProjectRetries> = offOrWholeBetween(
  BOARD_PROJECT_RETRIES_MIN,
  BOARD_PROJECT_RETRIES_MAX,
);

/** Accepts `board.project.retryWaitSeconds`, with no `false`. */
export const boardProjectRetryWaitSeconds: Reader<number> = wholeBetween(
  BOARD_PROJECT_RETRY_WAIT_MIN_SECONDS,
  BOARD_PROJECT_RETRY_WAIT_MAX_SECONDS,
);

/** Accepts `board.project.progressSeconds`; `false` keeps only the start and end lines. */
export const boardProjectProgressSeconds: Reader<BoardProjectProgressSeconds> = offOrWholeBetween(
  BOARD_PROJECT_PROGRESS_MIN_SECONDS,
  BOARD_PROJECT_PROGRESS_MAX_SECONDS,
);

/** Accepts `board.project.writeBatchSize`, with no `false`. */
export const boardProjectWriteBatchSize: Reader<number> = wholeBetween(
  BOARD_PROJECT_WRITE_BATCH_MIN,
  BOARD_PROJECT_WRITE_BATCH_MAX,
);

/** Accepts `board.project.writePauseMs`, `0` among them, with no `false`. */
export const boardProjectWritePauseMs: Reader<number> = wholeBetween(
  BOARD_PROJECT_WRITE_PAUSE_MIN_MS,
  BOARD_PROJECT_WRITE_PAUSE_MAX_MS,
);

/** What the `board.project` limits resolve to when no layer names them. */
export const BOARD_PROJECT_LIMIT_DEFAULTS: Readonly<BoardProjectLimitSettings> = Object.freeze({
  boardProjectRetries: 3,
  boardProjectRetryWaitSeconds: 2,
  boardProjectProgressSeconds: 10,
  boardProjectWriteBatchSize: 20,
  boardProjectWritePauseMs: 1000,
});

/** The `board.project` limits' setting specs. */
export const BOARD_PROJECT_LIMIT_SETTINGS: {
  readonly [K in keyof BoardProjectLimitSettings]: SettingSpec<K>;
} = {
  boardProjectRetries: { key: 'board.project.retries', read: boardProjectRetries, cli: false },
  boardProjectRetryWaitSeconds: {
    key: 'board.project.retryWaitSeconds',
    read: boardProjectRetryWaitSeconds,
    cli: false,
  },
  boardProjectProgressSeconds: {
    key: 'board.project.progressSeconds',
    read: boardProjectProgressSeconds,
    cli: false,
  },
  boardProjectWriteBatchSize: {
    key: 'board.project.writeBatchSize',
    read: boardProjectWriteBatchSize,
    cli: false,
  },
  boardProjectWritePauseMs: {
    key: 'board.project.writePauseMs',
    read: boardProjectWritePauseMs,
    cli: false,
  },
};
