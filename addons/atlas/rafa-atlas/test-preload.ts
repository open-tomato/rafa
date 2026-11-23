/**
 * What `bun test` run from this package's folder loads before its first
 * test file, as this folder's `bunfig.toml` names it under `[test]
 * preload`: one call of `registerConfigSections([CORE_SECTION])`, so every
 * file reads core's settings whether it runs alone, behind another file,
 * or under the root's `bun test`, whose preload (`src/tests/preload.ts`)
 * registers every section.
 *
 * Without it, `registeredSettings()` throws "no config section is
 * registered" in a run from this folder and returns under the root's run,
 * so a test that reaches core's settings would pass in one place and fail
 * in the other. The ingest tests (`src/ingest/`) reach none today: they
 * pass from this folder with or without this file.
 * The root's preload imports the root's `src/`, which a workspace member
 * may not import, so this file takes core's section off core's config
 * subpath. It registers config sections only: it loads no config file and
 * calls no `loadConfig`.
 */
import { CORE_SECTION, registerConfigSections } from '@open-tomato/rafa-core/core/config';

registerConfigSections([CORE_SECTION]);
