/**
 * The `sync` entry of the `sync-fixture` module: a `git` strategy that
 * moves no rows, which `src/modules/load.test.ts` loads from this
 * directory to hold that a module's `sync` adapter is registered under
 * its port type and kind.
 *
 * Its push answers `pushed` with no path and its pull `nothing-to-sync`,
 * so a case can tell the adapter it made apart from any core strategy.
 * It takes no context: a fixture strategy touches no repository.
 */
import type { Sync } from '../../../ports/index.js';

/** Makes the fixture's `git` strategy. */
export default function create(): Sync {
  return {
    kind: 'git',
    push: async () => ({ status: 'pushed', path: null }),
    pull: async () => ({ status: 'nothing-to-sync' }),
  };
}
