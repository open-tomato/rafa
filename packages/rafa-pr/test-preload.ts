/**
 * What `bun test` run from this package's folder loads before its first
 * test file, as this folder's `bunfig.toml` names it under `[test]
 * preload`: one call of `registerConfigSections([CORE_SECTION,
 * RELEASE_SECTION, TRIAGE_SECTION])`, so every file reads core's
 * settings, the release's and the triage's whether it runs alone or
 * behind another. The release and triage sections are the ones pr reads
 * beyond core's: the `pr.*` keys the command tests plant in their project
 * files live in the release section, and the `triage.*` keys the triage
 * tests plant live in the triage section.
 *
 * `bun test` run from the package's folder reads no `bunfig.toml` of the
 * root, so the root's preload, `src/tests/preload.ts`, does not run here.
 * That preload registers every section, core's adapters and the services
 * through `src/config-registry.ts`, `src/adapter-registry.ts` and
 * `src/service-registry.ts`, which lie outside the package and may not be
 * imported from it; this file takes core's section off core's config
 * barrel and the release and triage sections off their own subpaths,
 * imports nothing from the root's `src/` and registers no service. The
 * root's `bun test` still runs these files, under the root's preload.
 */
import { RELEASE_SECTION } from '@open-tomato/rafa/config-schema-release';
import { TRIAGE_SECTION } from '@open-tomato/rafa/config-schema-triage';
import { CORE_SECTION, registerConfigSections } from '@open-tomato/rafa/core/config';

registerConfigSections([CORE_SECTION, RELEASE_SECTION, TRIAGE_SECTION]);
