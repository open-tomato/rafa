/**
 * The barrel over the config's schema and its layers: every name
 * `config-items.ts`, `config-schema.ts` and `config.ts` export, less the
 * names the `sections.ts` barrel holds, and nothing else.
 *
 * A file outside `src/core/` imports this file and never the three
 * behind it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports the three directly and never this
 * file.
 *
 * ## The barrels hold no name in common
 *
 * `src/core/config/` has three barrels, all listed under `CORE_BARRELS`
 * in `scripts/survey/core-moves.ts`. `sections.ts` holds the leaf pair,
 * `config-sections.ts` and `config-readers.ts`, and argues why the pair
 * has a barrel of its own. `load.ts` holds `config-load.ts` alone, and
 * argues the same for it. This one holds the three files that read a
 * key or rank a layer.
 *
 * `config.ts` re-exports twenty-seven names of `config-sections.ts`
 * (`InjectMode`, `OUTPUT_MODES`, `ConfigExtra` and the like), as it did
 * before it moved. None of them is exported here: a caller outside
 * `src/core/` takes each from `sections.ts`, so a name has one barrel to
 * be learned from. A file that used to take `ConfigError` and
 * `OUTPUT_MODES` in one line from `config.js` now spells two lines.
 *
 * ## Why one barrel can hold all three
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle. Two of the three
 * files behind this one import outward by value: `config-schema.ts`
 * reads the eleven section files (`src/config-schema-*.ts`) and
 * `src/tiers/routing.ts`, and `config.ts` reads
 * `src/config-schema-hub.ts`. Each of those twelve files imports this
 * barrel with `import type` alone (`SettingSpec`, `ConfigSource`,
 * `ConfigLayers`), which is erased before anything loads. The values a
 * section file reads come from `sections.ts`, which imports none of the
 * three.
 *
 * Measured when the three moved: the value imports of the non-test files
 * under `src/`, `scripts/` and `packages/` held six cycles before the
 * move and the same six after it, none through a file of this folder,
 * and each barrel, each of the three files and each section file loaded
 * first in a fresh `bun` process, `SETTINGS` holding its 89 entries
 * each time.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as `sections.ts` spells
 * its own, and taken from the file that declares it: `config.ts`
 * re-exports `RafaConfig`, `CONFIG_DEFAULTS` and `CONFIG_FILE` from
 * `config-schema.ts` and the item types and kind lists from
 * `config-items.ts`, and each is exported here once. `HubContext` and
 * `HubTimeout` are the two names none of the three declares:
 * `config.ts` re-exports them as types from `src/config-schema-hub.ts`,
 * and they pass through unchanged.
 *
 * The published surface is narrower than this file. `src/index.ts`
 * re-exports part of it, and of the runtime names leaves out the
 * schema's indexes and the item readers (`SETTINGS`, `moduleSource` and
 * ten more), which `src/index.test.ts` spells under
 * `CONFIG_BARREL_ONLY`.
 *
 * `index.test.ts` holds the list to the three files: every name any of
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
export type {
  ConfigFile,
  ConfigLayer,
  ConfigLayers,
  ConfigOverrides,
  ConfigSource,
  HubContext,
  HubTimeout,
  ResolvedConfig,
} from './config.js';

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
export {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  isCommandLineSetting,
  knownKeysAbove,
  SCOPE_DIR,
  SECTIONS,
  SETTING_BY_KEY,
  SETTING_NAMES,
  SETTINGS,
} from './config-schema.js';
export {
  ConfigError,
  configFilePath,
  parseConfigText,
  resolveConfig,
} from './config.js';
