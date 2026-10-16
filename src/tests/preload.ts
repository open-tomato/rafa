/**
 * What `bun test` runs before the first test file of the process, as
 * `bunfig.toml` names it under `[test] preload`: one call of
 * `registerCoreAdapters`, so every file reads core's adapters off
 * `CORE_ADAPTER_REGISTRY` registered, whether it runs alone or behind
 * another file.
 *
 * `src/adapter-registry.ts` registers nothing as it is imported, so an
 * import of it kept for its effect, in a test file, registers nothing
 * either; this call is what the suite relies on. A child process a test
 * spawns runs no preload: its script calls `registerCoreAdapters`
 * itself before it reads the registry. `bun test` run from inside a
 * workspace package reads no `bunfig.toml` of the root, so that
 * package's suite runs with nothing registered.
 */
import { registerCoreAdapters } from '../adapter-registry.js';

registerCoreAdapters();
