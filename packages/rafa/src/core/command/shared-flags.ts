/**
 * The flags commands of several features declare, spelled once.
 *
 * {@link HINT_FLAG_SPEC} is the `--no-hint` flag of the six commands
 * that end by naming the step that follows (`src/next/ending.ts`):
 * `pr merge`, `pr wait`, `pr triage`, `plan create`, `issue ready` and
 * `loop start`. They belong to four features, and three of them are
 * declared in a declarations file (`packages/rafa-pr/src/commands/pr/declarations.ts`,
 * `packages/rafa-board/src/commands/issue/declarations.ts`), which imports core's entries
 * alone and no module under `src/`. So the flag lives here, where every
 * one of the six can reach it, and each declares this value itself
 * rather than a copy its tests would have to hold equal.
 *
 * {@link DEFAULT_CI_TIMEOUT_MIN} is here for the same reason: the
 * loop's `--ci-timeout` (`src/commands/loop/start.ts`,
 * `src/start/run-setup.ts`) and `pr wait`'s `--timeout`
 * (`packages/rafa-pr/src/commands/pr/declarations.ts`, `packages/rafa-pr/src/commands/pr/wait.ts`) both
 * default to it, and the second is spelled in a declarations file.
 *
 * The file imports nothing by value: it names `command.ts` with
 * `import type` for {@link RafaFlagSpec}, which is erased before
 * anything loads.
 */
import type { RafaFlagSpec } from './command.js';

/** The flag each of the six commands declares to let a hint be turned off. */
export const HINT_FLAG = 'hint';

/**
 * The flag each of the six declares, so `--no-hint` suppresses the
 * ending. Boolean and defaulting to true, which is what makes
 * `--no-hint` read as false for it (`src/cli/core/parseArgs.ts`).
 */
export const HINT_FLAG_SPEC: RafaFlagSpec = Object.freeze({
  name: HINT_FLAG,
  description: 'Ends by naming the one step that follows, asking it where there is a terminal to answer on;'
    + ' `--no-hint` reads nothing and prints nothing.',
  type: 'boolean',
  default: true,
});

/**
 * How many minutes a pull request's checks are polled before the wait
 * gives up on them. The loop's `--ci-timeout` and `pr wait`'s
 * `--timeout` both default to it, so one wait typed by hand and the
 * loop's own CI gate hold a pull request to the same deadline;
 * `pr triage --resolve` waits this long too.
 */
export const DEFAULT_CI_TIMEOUT_MIN: number = 20;
