/**
 * The barrel over the config's disk half: every name `config-load.ts`
 * exports, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports `config-load.ts` directly and never
 * this file.
 *
 * ## Why one file has a barrel of its own
 *
 * `packages/rafa/src/core/config/` has three barrels, all listed under `CORE_BARRELS`
 * in `scripts/survey/core-moves.ts`. `sections.ts` holds the leaf pair
 * and `index.ts` the four files that read a key or rank a layer, with
 * the section registry `section.ts`; each
 * argues its own grouping. This one holds `config-load.ts` alone,
 * because neither of the other two can take it.
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. One of the files
 * outside `packages/rafa/src/core/` that `config-load.ts` imports by value imports a
 * config barrel back by value: `packages/rafa/src/effort/store/settings.ts`, which
 * `loadConfig` hands the resolved busy timeout, reads `CONFIG_DEFAULTS`
 * from `src/config-registry.ts`, which imports `index.ts` by value, and
 * the timeout's bounds from `sections.ts`. `config-load.ts` once read
 * the logger's settings through `packages/rafa/src/config-schema-logger.ts`, which
 * takes its readers from `sections.ts`; it now calls the load hook
 * `section.ts` holds, which the registry sets, and imports no section
 * file.
 *
 * So `config-load.ts` behind `index.ts` closes a cycle through the
 * store's settings and the registry, and behind `sections.ts` one
 * through the store's settings. Neither file imports `loadConfig`, so a
 * barrel that holds it alone is imported back by neither.
 *
 * Measured when the file moved: the value imports of the non-test files
 * tracked under `src/` and `packages/` held six cycles before the move
 * and the same six after it, none through a file of this folder. The
 * control, the same tree with `index.ts` re-exporting `loadConfig` as
 * well, held a seventh: `config-load.ts`, `index.ts` and
 * `packages/rafa/src/effort/store/settings.ts`. That seventh loaded without a
 * `ReferenceError` in the four orders tried (`index.ts`, the store's
 * settings, `config-load.ts` and the logger's section file each first
 * in a fresh `bun` process), because `config-load.ts` reads the store's
 * setter inside `loadConfig` and never at load. The split holds the
 * rule rather than that reading: a later top-level read on either side
 * would fail in one import order only.
 *
 * Measured again when the logger's settings moved to the load hook, on
 * bun 1.3.14: `load.ts`, `config-load.ts`, `index.ts`, `sections.ts`,
 * `section.ts`, `config.ts`, the store's settings, the registry, the
 * logger's and the hub's section files and `adapters/logger/settings.ts`
 * each loaded first in a fresh `bun` process, the registry then holding
 * 89 settings, the hook set and one check each time.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other two
 * barrels spell theirs. `src/index.ts` re-exports all three, so this
 * barrel is exactly as wide as the published surface it feeds.
 *
 * `load.test.ts` holds the list to the file: every name `config-load.ts`
 * exports is here once, as the same binding, no other name is here, and
 * no name here is on either of the other two barrels.
 */
export type { ConfigRoots, ProjectScopeFiles } from './config-load.js';

export { loadConfig, readConfigFile, readProjectScope } from './config-load.js';
