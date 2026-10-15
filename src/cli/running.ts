/**
 * The running command record, read at its old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/core/command/running.ts`,
 * behind the barrel `src/core/command/index.ts`. This file re-exports
 * that barrel's names under the same names, so an importer that names
 * this path reads the same bindings.
 */
export type { RunningCommand } from '../core/command/index.js';

export {
  restoreRunningCommand,
  runAsRunningCommand,
  runningCommand,
  setRunningCommand,
} from '../core/command/index.js';
