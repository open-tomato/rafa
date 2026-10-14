/**
 * The effort levels a task's declaration may name, held in core so the
 * store's dispatch writer (`dispatches.ts`) can type a declared effort
 * without importing the declaration parser above core.
 *
 * `src/utils/declaration.ts` re-exports both names unchanged, and is
 * still where a task line's `effort=` value is read and checked.
 */

/** Levels `--effort` accepts, taken from the CLI's own help text. */
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** One of the five levels `--effort` accepts. */
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
