/**
 * What `bun test` run from this package's folder loads before its first
 * test file, as this folder's `bunfig.toml` names it under `[test]
 * preload`: one call of `registerConfigSections([CORE_SECTION])`, so every
 * file reads core's settings whether it runs alone or behind another.
 *
 * `bun test` run from the package's folder reads no `bunfig.toml` of the
 * root, so the root's preload, `src/tests/preload.ts`, does not run here.
 * That preload registers every section and core's adapters through
 * `src/config-registry.ts` and `src/adapter-registry.ts`, which lie
 * outside the package and may not be imported from it; this file takes
 * core's section alone, off core's config barrel, and imports nothing from
 * the root's `src/`. The root's `bun test` still runs these files, under
 * the root's preload.
 */
import { CORE_SECTION, registerConfigSections } from '@open-tomato/rafa/core/config';

registerConfigSections([CORE_SECTION]);
