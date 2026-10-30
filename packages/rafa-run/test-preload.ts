/**
 * What `bun test` run from this package's folder loads before its first
 * test file, as this folder's `bunfig.toml` names it under `[test]
 * preload`: one call of `registerConfigSections([CORE_SECTION,
 * RELEASE_SECTION])`, so every file reads core's settings and the
 * release's whether it runs alone or behind another. The release section
 * is the one run's tests read beyond core's: `rafa next`'s sources
 * resolve `pr.provider`, a key of the release section, and refuse with
 * exit 2 when the key is unknown and reads as `none`. The sections run's
 * sources take types from (checks, tests, loop retries, loop continue,
 * wrap-up and issues) are handed to those files as built settings in the
 * tests, which read none of them through the config.
 *
 * `bun test` run from the package's folder reads no `bunfig.toml` of the
 * root, so the root's preload, `src/tests/preload.ts`, does not run here.
 * That preload registers every section, core's adapters and the services
 * through `src/config-registry.ts`, `src/adapter-registry.ts` and
 * `src/service-registry.ts`, which lie outside the package and may not be
 * imported from it; this file takes core's section off core's config
 * barrel and the release section off its own subpath, imports nothing
 * from the root's `src/` and registers no service. The root's `bun test`
 * still runs these files, under the root's preload.
 */
import { RELEASE_SECTION } from '@open-tomato/rafa/config-schema-release';
import { CORE_SECTION, registerConfigSections } from '@open-tomato/rafa/core/config';

registerConfigSections([CORE_SECTION, RELEASE_SECTION]);
