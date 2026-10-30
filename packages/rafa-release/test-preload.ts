/**
 * What `bun test` run from this package's folder loads before its first
 * test file, as this folder's `bunfig.toml` names it under `[test]
 * preload`: one call of `registerConfigSections([CORE_SECTION,
 * RELEASE_SECTION])`, so every file reads core's settings and the
 * release's whether it runs alone or behind another. The release section
 * is the one release reads beyond core's: its enabled check, version,
 * changelog and scaffold read the release settings through
 * `registeredSettings` and `registeredDefaults`.
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
