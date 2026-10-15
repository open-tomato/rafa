/**
 * The command contracts, read at their old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/core/command/types.ts`,
 * behind the barrel `src/core/command/index.ts`. This file re-exports
 * that barrel's names under the same names, so an importer that names
 * this path reads the same bindings.
 */
export type {
  ArgSpec,
  CliCommand,
  CliContext,
  FlagSpec,
} from '../../core/command/index.js';
