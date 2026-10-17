/**
 * The flags commands of several features declare, spelled once.
 *
 * {@link HINT_FLAG_SPEC} is the `--no-hint` flag of the six commands
 * that end by naming the step that follows (`src/next/ending.ts`):
 * `pr merge`, `pr wait`, `pr triage`, `plan create`, `issue ready` and
 * `loop start`. They belong to four features, and three of them are
 * declared in a declarations file (`src/commands/pr/declarations.ts`,
 * `src/commands/issue/declarations.ts`), which imports core's entries
 * alone and no module under `src/`. So the flag lives here, where every
 * one of the six can reach it, and each declares this value itself
 * rather than a copy its tests would have to hold equal.
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
