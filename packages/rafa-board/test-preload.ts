/**
 * What `bun test` run from this package's folder loads before its first
 * test file, as this folder's `bunfig.toml` names it under `[test]
 * preload`: one call of `registerConfigSections([CORE_SECTION,
 * BOARD_PROJECT_SECTION, ISSUES_SECTION, RELEASE_SECTION])`, so every file
 * reads core's settings, the board project's, the issues' and the release's
 * whether it runs alone or behind another. The board-project, issues and
 * release sections are the ones board reads beyond core's: its project
 * refresh, retries, progress and refs gate read the board-project settings,
 * its issue and epic commands and refs readers read the issues settings, and
 * its issue facts and refs extraction read the release settings (`release.directory`
 * and the `pr` keys), all through `registeredSettings` and `registeredDefaults`.
 *
 * `bun test` run from the package's folder reads no `bunfig.toml` of the
 * root, so the root's preload, `src/tests/preload.ts`, does not run here.
 * That preload registers every section, core's adapters and the services
 * through `src/config-registry.ts`, `src/adapter-registry.ts` and
 * `src/service-registry.ts`, which lie outside the package and may not be
 * imported from it; this file takes core's section off core's config
 * barrel and the other two off their own subpaths, imports nothing from
 * the root's `src/` and registers no service. The root's `bun test` still
 * runs these files, under the root's preload.
 */
import { BOARD_PROJECT_SECTION } from '@open-tomato/rafa/config-schema-board-project';
import { ISSUES_SECTION } from '@open-tomato/rafa/config-schema-issues';
import { RELEASE_SECTION } from '@open-tomato/rafa/config-schema-release';
import { CORE_SECTION, registerConfigSections } from '@open-tomato/rafa/core/config';

registerConfigSections([CORE_SECTION, BOARD_PROJECT_SECTION, ISSUES_SECTION, RELEASE_SECTION]);
