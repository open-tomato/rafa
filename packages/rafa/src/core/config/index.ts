/**
 * The barrel over the config's schema and its layers: every name
 * `config-items.ts`, `config-schema.ts`, `core-section.ts`, `section.ts`,
 * `config.ts`, `dangerous.ts`, `scope.ts` and `default-routing.ts` export, less the names the
 * `sections.ts` barrel holds, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the eight
 * behind it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports the eight directly and never this
 * file.
 *
 * ## The barrels hold no name in common
 *
 * `packages/rafa/src/core/config/` has three barrels, all listed under `CORE_BARRELS`
 * in `scripts/survey/core-moves.ts`. `sections.ts` holds the leaf pair,
 * `config-sections.ts` and `config-readers.ts`, with `branch-template.ts`
 * beside it, and argues why the pair has a barrel of its own. `load.ts` holds `config-load.ts` alone, and
 * argues the same for it. This one holds the four files that read a
 * key or rank a layer, and `section.ts`, the contract a section file
 * outside `packages/rafa/src/core/` is typed by, the registry it is handed to and the
 * key indexes read off that registry. `dangerous.ts` joined it with the
 * running command's phrases (`runWithDangerousPhrases`), which the
 * dispatcher sets around every command. It fits neither other barrel:
 * it imports `config-sections.ts`, so it is no leaf for `sections.ts`,
 * and `src/index.ts` publishes `load.ts` whole, where the phrases and
 * pass lines are no published name.
 *
 * `scope.ts` joined it with a scope's paths, `Scope`, the project the
 * dispatcher resolved, `ProjectFound`, and `scopeAt`, whose walk,
 * `resolveScope`, stays in `packages/rafa/src/project/scope.ts`. It reads `config.ts`
 * and `core-section.ts` by value and `config-load.ts` as a type, so it
 * is no leaf for `sections.ts`, and `load.ts` holds `config-load.ts`
 * alone.
 *
 * `config.ts` re-exports twenty-seven names of `config-sections.ts`
 * (`InjectMode`, `OUTPUT_MODES`, `ConfigExtra` and the like), as it did
 * before it moved. None of them is exported here: a caller outside
 * `packages/rafa/src/core/` takes each from `sections.ts`, so a name has one barrel to
 * be learned from. A file that used to take `ConfigError` and
 * `OUTPUT_MODES` in one line from `config.js` now spells two lines.
 *
 * ## Why one barrel can hold all eight
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. None of the
 * eight files behind this one imports outward by value:
 * `core-section.ts` reads the routing defaults from `default-routing.ts`
 * beside it, and `packages/rafa-inventory/src/tiers/routing.ts` imports them from this barrel by
 * value with nothing here importing it back. No file behind it
 * imports a section file (`src/config-schema-*.ts`), by value or as a
 * type: `config-merged.ts`, which spread the eleven into one schema,
 * was retired when its importers moved to `src/config-registry.ts`,
 * `config.ts` reads every key index and runs every section's checks
 * off `section.ts`, and `src/tests/core-config-sections.sweep.test.ts`
 * holds the rule for every file under `packages/rafa/src/core/`. The registry imports
 * this barrel by value and nothing here imports the registry. A section
 * file reads its values from `sections.ts`, which imports none of the
 * eight, and adds its fields to `RafaConfig` with a `declare module` on
 * `config-schema.ts`, which the checker follows and which loads
 * nothing. `config-schema.ts` and `section.ts` import types alone.
 *
 * Measured when the three moved: the value imports of the non-test files
 * under `src/`, `scripts/` and `packages/` held six cycles before the
 * move and the same six after it, none through a file of this folder,
 * and each barrel, each of the three files and each section file loaded
 * first in a fresh `bun` process, `SETTINGS` holding its 89 entries
 * each time.
 *
 * Measured again when core's keys moved into `core-section.ts`, on bun
 * 1.3.14: each barrel, each of the five files, `section.ts`,
 * `packages/rafa-inventory/src/tiers/routing.ts` and each section file loaded first in a fresh
 * `bun` process, `SETTINGS` and `CONFIG_DEFAULTS` holding 89 entries and
 * `CORE_SECTION` 42 each time. The control, `config-schema-hub.ts`
 * reading `SETTINGS` off this barrel at load, threw `Cannot access
 * 'HUB_DEFAULTS' before initialization` when loaded first.
 *
 * Measured again when `section.ts` joined and each section file took a
 * `ConfigSection` of its own, on bun 1.3.14: each config barrel,
 * `section.ts`, the since-retired `config-merged.ts`, `config.ts` and
 * each section file loaded first in a fresh `bun` process with
 * `SETTINGS` holding 89 entries, and core's section and the eleven
 * merged by `mergeConfigSections` into the same 89 settings and the
 * same defaults as `SETTINGS` and `CONFIG_DEFAULTS`, with one check.
 *
 * Measured again when `config-merged.ts` was retired, on bun 1.3.14:
 * the value imports of the five files behind this one reach no section
 * file and not the registry, and each config barrel, each of the five
 * files, `config-load.ts`, the registry, `packages/rafa/src/effort/store/settings.ts`,
 * `packages/rafa-inventory/src/tiers/routing.ts`, `packages/rafa/src/core/adapters/registry.ts` and each
 * section file loaded first in a fresh `bun` process, the registry then
 * answering 89 registered settings and 89 defaults each time.
 *
 * Measured again when `dangerous.ts` joined, on bun 1.3.14: this
 * barrel, `dangerous.ts`, `config-load.ts`, the registry,
 * `src/cli/dispatch.ts` and `packages/rafa/src/core/command/command.ts` each loaded
 * first in a fresh `bun` process, the registry then holding 91 settings
 * and `dangerousKeys` three keys each time.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as `sections.ts` spells
 * its own, and taken from the file that declares it: `config.ts`
 * re-exports `RafaConfig` from `config-schema.ts`, `CONFIG_FILE` from
 * `core-section.ts` and the item types and kind lists from
 * `config-items.ts`, and each is exported here once. The merged schema
 * (`SETTINGS`, `CONFIG_DEFAULTS`, `SETTING_NAMES`, `SETTING_BY_KEY`,
 * `SECTIONS` and `knownKeysAbove`) is not here: a file outside
 * `packages/rafa/src/core/` imports it from `src/config-registry.ts`, and core reads
 * the registered settings, defaults and key indexes off `section.ts`.
 * A feature file that reads the whole `CONFIG_DEFAULTS` or `SETTINGS`
 * record without importing the registry takes `registeredDefaults()`
 * or `registeredSettings()` from here, which answer the registered
 * records typed whole.
 * Neither are the hub's `HubContext` and `HubTimeout`, which a file
 * imports from `packages/rafa/src/config-schema-hub.ts`.
 *
 * The published surface is narrower than this file. `src/index.ts`
 * re-exports part of it, and of the runtime names leaves out core's
 * section, the routing defaults, the item readers, `config.ts`'s two
 * document readers the loader reads a scope through, and the section
 * registry with its key indexes (`CORE_SECTION`, `moduleSource`, `registerConfigSections`,
 * `activeSettingByKey` and thirty-three more), which `src/index.test.ts`
 * spells under `CONFIG_BARREL_ONLY`. Its `CONFIG_DEFAULTS` is
 * `src/config-registry.ts`'s.
 *
 * `index.test.ts` holds the list to the eight files: every name any of
 * them exports and `sections.ts` does not is here once, as the same
 * binding, and no other name is here.
 */
export type {
  ModuleSource,
  ModuleSourceKind,
  OptionalPrerequisiteItem,
  PrerequisiteItem,
  PrerequisiteKind,
  PrerequisiteScope,
} from './config-items.js';
export type {
  CommandLineSetting,
  ConfigSetting,
  RafaConfig,
  SettingSpec,
} from './config-schema.js';
export type { CoreSection, CoreSetting } from './core-section.js';
export type {
  ConfigCheck,
  ConfigCheckInput,
  ConfigLoadHook,
  ConfigSection,
  ConfigSectionRegistry,
  ConfigTemplateHook,
  SettingsRecord,
} from './section.js';
export type {
  ConfigFile,
  ConfigLayer,
  ConfigLayers,
  ConfigOverrides,
  ConfigSource,
  ResolvedConfig,
  TemplateLayer,
} from './config.js';
export type { DangerousPhrases } from './dangerous.js';
export type { ProjectFound, Scope } from './scope.js';
export type { Route } from './default-routing.js';

export {
  MODULE_SOURCE_KEYS,
  MODULE_SOURCE_KINDS,
  moduleSource,
  OPTIONAL_ITEM_KEYS,
  optionalPrerequisite,
  PREREQUISITE_KINDS,
  REQUIRED_ITEM_KEYS,
  requiredPrerequisite,
} from './config-items.js';
export { CONFIG_FILE, CORE_SECTION, SCOPE_DIR } from './core-section.js';
export {
  activeChecks,
  activeConfigLoadHook,
  activeConfigTemplateHook,
  activeDefaults,
  activeKnownKeysAbove,
  activeSectionPaths,
  activeSections,
  activeSettingByKey,
  activeSettings,
  ConfigSectionError,
  EMPTY_CONFIG_REGISTRY,
  mergeConfigSections,
  registerConfigSections,
  registeredDefaults,
  registeredSettings,
  restoreConfigSections,
  setConfigLoadHook,
  setConfigTemplateHook,
} from './section.js';
export {
  ConfigError,
  configFilePath,
  layTemplatesUnder,
  parseConfigDocument,
  parseConfigText,
  readConfigDocument,
  resolveConfig,
} from './config.js';
export {
  dangerousKeys,
  dangerousPassLines,
  dangerousPhrases,
  restoreDangerousPhrases,
  runWithDangerousPhrases,
  setDangerousPhrases,
  writeDangerousPassLines,
} from './dangerous.js';
export { scopeAt } from './scope.js';
export { DEFAULT_ROUTES, DEFAULT_ROUTING } from './default-routing.js';
