/**
 * The composition root of the service registry: the five functions of
 * run, pr and release that a lower package's commands call, four of them
 * board's and one release's, listed here and handed to core when
 * {@link registerCoreServices} is called.
 *
 * Core declares the registry (`packages/rafa/src/core/services/registry.ts`)
 * and imports no service: each function sits in a package above the lower
 * package, board or release, that calls it, and reaches too far into its
 * package to move into core, so the lower package calling it directly
 * would be an edge into a package that moves after it. This module, outside `packages/rafa/src/core/`, is the one place
 * they are listed, {@link CORE_SERVICES}, each taken from its package's
 * facade (`@open-tomato/rafa-run`, `@open-tomato/rafa-pr` and
 * `@open-tomato/rafa-release`) as `src/adapter-registry.ts` takes core's
 * adapters from theirs. Each key's reason is `SERVICE_REASONS`, in core.
 *
 * Importing it registers nothing. {@link registerCoreServices} calls
 * `registerServices` with that set, so every member of `activeServices()`
 * calls the real function, and answers the facade. The root is called,
 * never imported for its effect: under `"sideEffects": false` in a
 * manifest, `bun build` drops an import kept for its effect alone.
 * `src/rafa.ts` and `src/index.ts` call it as they load, straight after
 * `registerCoreAdapters`, and `src/cli/feature-load-probe.ts` after it in
 * each function that calls the adapters' root; core never imports this
 * module. Until something calls it, every member of `activeServices()`
 * throws, naming its key and this module.
 *
 * `bun test` calls it once for the test process, from
 * `src/tests/preload.ts`, which `bunfig.toml` names under
 * `[test] preload`: a test that reaches a board or release command's
 * default path calls the real service whether it runs alone or behind
 * another file, and a test that wants a stub registers one over the
 * active set and restores the previous set after. A child process a test spawns runs
 * no preload, and reads the registration of the entry it runs.
 *
 * A second call, from an entry a test imports or from both entries in
 * one process, finds a set held already and answers the facade as it
 * is, registering nothing: the set held, core's or a test's stubs, stays
 * the active one.
 *
 * ## The release reading `rafa epic close` cannot take
 *
 * Board imports no release, so `close-docs.ts` hands `addStaleDocLine`
 * no `newestRelease`. The key's function is therefore release's
 * `addStaleDocLine` behind {@link addStaleDocLineWithRelease}: when the
 * caller left `newestRelease` out, it reads the newest root release tag
 * through release's `newestRootRelease`, `git tag --list` in the
 * process's working directory, which a command runs in its project (the
 * tags are the repository's, from any directory of it), and hands it on.
 * A listing that fails, or a reader that throws, hands nothing, and the
 * issue is found by its exact title as before; a caller that read the
 * tags itself, as the wrap-up does, has its reading passed on untouched,
 * null included.
 *
 * ## The whole set
 *
 * {@link CORE_SERVICES} `satisfies RafaServices`, so a key left out, or
 * a real function that drifts from its key's type, fails `tsc` here.
 */
import type { AddStaleDocLineService, RafaServices } from '@open-tomato/rafa/core/services';

import { ghPullRequestsIn, triageReport } from '@open-tomato/rafa-pr';
import { addStaleDocLine, newestRootRelease } from '@open-tomato/rafa-release';
import { endWithNextStep, readStaleDocsVersion } from '@open-tomato/rafa-run';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { activeServices, registerServices, restoreServices } from '@open-tomato/rafa/core/services';

/** The newest root release tag of the repository the process runs in; see the module note. */
function newestReleaseHere(): string | null | undefined {
  return newestRootRelease(createGitRunner(process.cwd()));
}

/**
 * release's `addStaleDocLine`, handed the newest root release tag
 * `readNewestRelease` answers whenever the caller left `newestRelease`
 * out; see the module note. Never rejects, as `addStaleDocLine` does not.
 */
export function addStaleDocLineWithRelease(
  readNewestRelease: () => string | null | undefined = newestReleaseHere,
): AddStaleDocLineService {
  return (options) => {
    if (options.newestRelease !== undefined) return addStaleDocLine(options);
    let newestRelease: string | null | undefined;
    try {
      newestRelease = readNewestRelease();
    } catch {
      newestRelease = undefined;
    }
    return addStaleDocLine({ ...options, newestRelease });
  };
}

/**
 * The services core registers, keys sorted as `SERVICE_REASONS` sorts
 * them: release's `addStaleDocLine` behind
 * {@link addStaleDocLineWithRelease}, run's `endWithNextStep`, pr's
 * `ghPullRequestsIn` as `pullRequestsIn`, run's `readStaleDocsVersion`
 * and pr's `triageReport`.
 * {@link registerCoreServices} hands them to core.
 */
export const CORE_SERVICES: RafaServices = Object.freeze({
  addStaleDocLine: addStaleDocLineWithRelease(),
  endWithNextStep,
  pullRequestsIn: ghPullRequestsIn,
  readStaleDocsVersion,
  triageReport,
} satisfies RafaServices);

/**
 * Registers {@link CORE_SERVICES} through `registerServices` when no set
 * is held, and answers `activeServices()`, the facade whose members call
 * the active set.
 *
 * When a set is held already, core's or another's, it registers nothing
 * and the held set stays active, so the preload and an entry may both
 * call it in one process. The registry answers no reading of its set
 * but the one `registerServices` answers, so the held set is read by
 * registering and, when one was held, putting it straight back; nothing
 * runs between the two calls. Throws what `registerServices` throws on a
 * member that is not a function, leaving the active set as it was.
 */
export function registerCoreServices(): RafaServices {
  const previous = registerServices(CORE_SERVICES);
  if (previous !== null) restoreServices(previous);
  return activeServices();
}
