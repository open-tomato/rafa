/**
 * What `bun test` runs before the first test file of the process, as
 * `bunfig.toml` names it under `[test] preload`: one call of
 * `registerCoreConfigSections`, then one of `registerCoreAdapters`, so
 * every file reads every setting registered with core, and core's
 * adapters off `CORE_ADAPTER_REGISTRY`, whether it runs alone or behind
 * another file.
 *
 * Neither `src/config-registry.ts` nor `src/adapter-registry.ts`
 * registers anything as it is imported, so an import of either kept for
 * its effect, in a test file, registers nothing; these calls are what
 * the suite relies on. A child process a test spawns runs no preload:
 * its script calls the roots itself before it reads either registry. `bun test` run from inside a
 * workspace package reads no `bunfig.toml` of the root, so that
 * package's suite runs with nothing registered unless the package names
 * a preload of its own, as `packages/rafa-inventory/bunfig.toml` does.
 */
import { registerCoreAdapters } from '../adapter-registry.js';
import { registerCoreConfigSections } from '../config-registry.js';

registerCoreConfigSections();
registerCoreAdapters();
