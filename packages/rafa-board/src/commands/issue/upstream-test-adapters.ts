/**
 * The adapters the `--upstream` test files read off
 * `CORE_ADAPTER_REGISTRY`, registered for a file run from this package's
 * folder (#1586).
 *
 * `bun test` run from the package's folder loads `test-preload.ts`,
 * which registers config sections and no adapter, so the tracker chain
 * and `dispatch`'s logger would read an empty registry there. Under the
 * root's `bun test`, `src/tests/preload.ts` has registered core's
 * adapters already, and registering a kind again would throw. So
 * {@link registerUpstreamTestAdapters} registers only the kinds the
 * active registry does not hold yet: the `console` logger and the `local`
 * and `github` trackers, made the way `src/adapter-registry.ts` makes
 * them, which this package may not import.
 *
 * This module is a test helper that is not itself a test file: bun runs
 * nothing in it until a `*.test.ts` calls it, and `check-types` reads
 * it, where it reads no test file.
 */
import type { AdapterRegistry, AnyAdapter } from '@open-tomato/rafa/core/adapters';

import { createConsoleLogger } from '@open-tomato/rafa/adapters/logger/console';
import { activeAdapterRegistry, PORT_VERSIONS, registerAdapters, restoreAdapters } from '@open-tomato/rafa/core/adapters';

import { createGhRunner, createGithubTracker } from '../../adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';

/** The adapters the four `--upstream` test files need, as core registers them. */
const UPSTREAM_TEST_ADAPTERS: readonly AnyAdapter[] = [
  {
    port: 'logger',
    kind: 'console',
    portVersion: PORT_VERSIONS.logger,
    create: ({ verbosity = 0, colour = false }) => createConsoleLogger({ verbosity, colour }),
  },
  {
    port: 'tracker',
    kind: 'local',
    portVersion: PORT_VERSIONS.tracker,
    create: ({ repoRoot, fallbackReason = null }) => createLocalTracker({
      issuesDir: localIssuesDir(repoRoot),
      fallbackReason,
    }),
  },
  {
    port: 'tracker',
    kind: 'github',
    portVersion: PORT_VERSIONS.tracker,
    create: ({ repoRoot, gh }) => createGithubTracker({ gh: gh ?? createGhRunner({ cwd: repoRoot }) }),
  },
];

/**
 * Registers each of {@link UPSTREAM_TEST_ADAPTERS} whose kind the active
 * registry does not hold, and answers a function that puts the registry
 * back as it was. Under the root's preload it registers nothing.
 */
export function registerUpstreamTestAdapters(): () => void {
  const held = activeAdapterRegistry();
  const missing = UPSTREAM_TEST_ADAPTERS.filter((adapter) => !held.kinds(adapter.port).includes(adapter.kind));
  if (missing.length === 0) return () => undefined;
  const previous: AdapterRegistry = registerAdapters(missing);
  return () => {
    restoreAdapters(previous);
  };
}
