/**
 * The composition root of the service registry: the four functions of
 * run, pr and release that board's commands call, listed here and handed
 * to core when {@link registerCoreServices} is called.
 *
 * Core declares the registry (`packages/rafa/src/core/services/registry.ts`)
 * and imports no service: each function sits in run, pr or release, above
 * board, and reaches too far into its package to move into core, so board
 * calling it directly would be an edge into a package that moves after
 * it. This module, outside `packages/rafa/src/core/`, is the one place
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
 * `[test] preload`: a test that reaches a board command's default path
 * calls the real service whether it runs alone or behind another file,
 * and a test that wants a stub registers one over the active set and
 * restores the previous set after. A child process a test spawns runs
 * no preload, and reads the registration of the entry it runs.
 *
 * A second call, from an entry a test imports or from both entries in
 * one process, finds a set held already and answers the facade as it
 * is, registering nothing: the set held, core's or a test's stubs, stays
 * the active one.
 *
 * ## The whole set
 *
 * {@link CORE_SERVICES} `satisfies RafaServices`, so a key left out, or
 * a real function that drifts from its key's type, fails `tsc` here.
 */
import type { RafaServices } from '@open-tomato/rafa/core/services';

import { triageReport } from '@open-tomato/rafa-pr';
import { addStaleDocLine } from '@open-tomato/rafa-release';
import { endWithNextStep, readStaleDocsVersion } from '@open-tomato/rafa-run';

import { activeServices, registerServices, restoreServices } from '@open-tomato/rafa/core/services';

/**
 * The services core registers, keys sorted as `SERVICE_REASONS` sorts
 * them: release's `addStaleDocLine`, run's `endWithNextStep`, run's
 * `readStaleDocsVersion` and pr's `triageReport`.
 * {@link registerCoreServices} hands them to core.
 */
export const CORE_SERVICES: RafaServices = Object.freeze({
  addStaleDocLine,
  endWithNextStep,
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
