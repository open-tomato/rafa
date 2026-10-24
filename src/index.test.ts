/**
 * Tests for the library's entry: the surface the package root exposes,
 * that it reaches everything the CLI reaches, and that importing it runs
 * nothing.
 *
 * The root's export list is spelled HERE rather than read off the
 * modules, so a name added to the entry or dropped from it fails a case
 * instead of agreeing with itself. Each value is held identical to its
 * module's own, which tells a re-export apart from a copy or a wrapper
 * answering the same thing.
 *
 * The containment cases are computed instead: every runtime name the
 * `./plan` entry, the `./store` entry, the two config modules, the scope
 * module, the adapter registry and the manifest module export is held to
 * be on the root as the same binding. Paired with the spelled
 * list, a name added to a subpath and not to the root reds the
 * containment case, and one added to both reds the spelled list, so
 * neither grows the root unseen.
 *
 * The first config module is read through its barrel,
 * `packages/rafa/src/core/config/index.ts`, the one path a file outside `packages/rafa/src/core/`
 * may import it by. The barrel is wider than the root: it also holds
 * core's section, the item readers, the section registry with the
 * key indexes it answers, and the dangerous listing with the running
 * command's phrases, which the tree reads and the package does not
 * publish. Those thirty-seven names are spelled under
 * {@link CONFIG_BARREL_ONLY} and left out of the containment case, so a
 * name added to the barrel still reds it until the name is added to the
 * root or to that list. The ten runtime names `config.ts` re-exports
 * from `config-sections.ts` (`INJECT_MODES` and the like) are on the
 * other barrel, `sections.ts`, and are held by the spelled list alone.
 * The barrel holds no `CONFIG_DEFAULTS`: the root publishes the
 * registry's, `src/config-registry.ts`, and the re-export case holds it
 * to the registry's.
 * The second config module, `config-load.ts`, is read through a barrel
 * of its own, `packages/rafa/src/core/config/load.ts`, which holds that module's
 * names and no other, so nothing is left out of its containment case.
 *
 * The CLI cases read imports off source. `src/rafa.ts` imports the
 * adapter registry's composition root (`src/adapter-registry.ts`) for
 * the `registerCoreAdapters` it calls, the dispatcher, the help
 * renderer, the core registry, the config registry
 * (`src/config-registry.ts`) for the `registerCoreConfigSections` it
 * calls, the module loader
 * and the since-last-command notice's command hook alone, and that
 * registry is held to
 * hold exactly the commands of the core command modules spelled here,
 * followed by the lazy commands of the bundled features spelled in
 * `FEATURE_COMMANDS`, so a command registered and not spelled goes red. Each of those modules
 * wrapping a phase 0 command takes it as its one default import, or,
 * when it takes no default, as its one binding from a feature
 * package's facade, and that binding is held to be a root export's
 * value, so a command the terminal runs and a service cannot import
 * goes red. A module taking a default and facade bindings both, as
 * `plan create` takes `plan`, two of the board's values and `endingWith`
 * of run's, runs its default, and its facade bindings are values it reads.
 * The command modules wrapping none are held too: the case that reaches the
 * phase 0 commands spells them path by path, every module of `COMMAND_MODULES`
 * whose import list lacks `wrapPhaseZeroCommand`, and that list of paths is
 * the one to read, where a list kept in this note fell behind it.
 * `describe` runs the roster builder of `src/cli/describe.ts`, which is
 * no root export. `plan show` takes `parsePlan` from the
 * `@open-tomato/rafa-run` facade, as `plan list`, `plan validate` and
 * `plan risk` take `listPlans`, `validatePlan` and `resolvePlanPath` from
 * it, and `plan needs` takes its readings from `src/plan/needs.ts`, which
 * is no facade name. A binding a module takes by name, as `loop start`
 * takes the CI defaults its flags show, is a value and not a command,
 * and is not held. Every parsed import list is also held to the spelled
 * one, which is what keeps a parser that matched nothing from passing
 * vacuously.
 *
 * The import cases run a probe in a fresh process, from an empty
 * directory outside any repository: import one module by absolute path,
 * then print the process's `SIGINT` and `SIGTERM` listener counts, its
 * exit code and the module's export count. Importing the entry prints
 * that line alone and leaves the directory holding only the probe. The
 * control imports `src/rafa.ts` the same way, which prints the CLI's
 * help above the probe's line and sets the exit code the dispatcher
 * answers, 0: the check can see a module that does something when
 * imported.
 *
 * Ten mutations were driven against this file, one run each, with the
 * unmodified modules green before them and restored byte-identical
 * after, and every one reddened at least one case. Eight changed the
 * entry: `startCommand`'s export dropped, `effortReportCommand` exported
 * as a wrapper, `parseReport` dropped, the SQLite migration function
 * exported as well, `loadConfig` and `resolveConfig` exported under each
 * other's names, and, red on the import probe alone, a `SIGINT`
 * listener, a printed line and an exit code added at import. Two
 * changed the phase 0 `src/rafa.ts`, which imported the five commands
 * itself: one more binding imported, and a module imported as a
 * namespace. Each of those two reddened both CLI cases of that time.
 *
 * Five more were driven on 2026-09-14 once `src/rafa.ts` dispatched
 * through the core registry, one run each over this file, with 50 pass
 * before and after and every file restored byte-identical (sha256). A
 * sixth command registered in `src/commands/index.ts` and not spelled
 * here reddened the registry case. `usageCommand` exported as a wrapper
 * reddened its re-export case and the reach case. One more binding
 * imported by `src/rafa.ts` reddened its imports case. A wrapper importing
 * its command as a namespace reddened four: its imports case, the
 * registry case, the reach case, and the control, since the module no
 * longer loads. `src/rafa.ts` setting no exit code reddened the control
 * alone.
 *
 * Five more were driven on 2026-09-15 once the preflight, the scope
 * module, the adapter registry and the manifest module joined the entry,
 * one run each over this file, `src/plan/index.test.ts` and
 * `src/tests/package-build.test.ts`, with 161 pass before and after and
 * every file restored byte-identical (sha256). `resolveScope` dropped
 * from the root reddened the name list, its re-export case, the scope
 * module's containment case and the import probe, whose export count
 * moved, with the root names case of `package-build.test.ts`.
 * `CORE_ADAPTER_REGISTRY` dropped reddened the same five for the
 * registry. `validateManifest` exported as a wrapper reddened its
 * re-export case and the manifest module's containment case.
 * `mergePlanPrerequisites` exported from `./plan` as a wrapper reddened
 * its re-export case here and in `src/plan/index.test.ts`. `forkWorktree`
 * exported from `./plan` and not from the root reddened the `./plan`
 * entry's containment case.
 *
 * The type names are not checked here, and `check-types` skips this
 * file. Checked through a tsconfig outside the repo, a probe
 * re-exporting from the entry all sixty-seven type names the `./plan`
 * entry, the `./store` entry and the two config modules export compiled,
 * and one naming `TaskDeclaration`, which the entry leaves out, failed
 * with TS2305. Checked again on 2026-09-15, a probe re-exporting all 107
 * type names the entry now exports compiled, and one naming
 * `RootCandidates` (`packages/rafa/src/project/roots.ts`), which the entry leaves out,
 * failed with TS2305. That tsconfig sets `module` to `ESNext`, as the
 * repository's does: on `packages/typescript-config/base.json` alone both
 * probes also failed with TS1343, on the `import.meta` reads of
 * `src/plan.ts` and `src/start.ts`.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  activeAdapterRegistry,
  CORE_ADAPTER_REGISTRY,
  createAdapterRegistry,
  PORT_VERSIONS,
  registerAdapters,
  restoreAdapters,
} from '@open-tomato/rafa/core/adapters';
import * as registryModule from '@open-tomato/rafa/core/adapters';
import {
  CONFIG_FILE,
  ConfigError,
  configFilePath,
  MODULE_SOURCE_KINDS,
  parseConfigText,
  PREREQUISITE_KINDS,
  resolveConfig,
} from '@open-tomato/rafa/core/config';
import * as configBarrel from '@open-tomato/rafa/core/config';
import { loadConfig, readConfigFile, readProjectScope } from '@open-tomato/rafa/core/config/load';
import * as configLoadModule from '@open-tomato/rafa/core/config/load';
import {
  BOARD_PROJECT_TEMPLATE_DEFAULT,
  BOARD_RELATIONSHIP_MODES,
  CLAUDE_SETTING_SOURCES,
  CONFIG_VERSIONS,
  INJECT_MODES,
  OUTPUT_MODES,
  PR_PROVIDERS,
  RELEASE_AUTO,
  STORE_BACKENDS,
  SYNC_STRATEGIES,
} from '@open-tomato/rafa/core/config/sections';
import {
  FEATURE_TYPES,
  MANIFEST_VERSION,
  OUTPUT_CHANNELS,
  RUNNING_MANIFEST_SEAMS,
  validateManifest,
} from '@open-tomato/rafa/modules/manifest';
import * as manifestModule from '@open-tomato/rafa/modules/manifest';
import {
  DISK_FILE_SYSTEM,
  INIT_COMMAND,
  initHint,
  resolveScope,
  SCOPE_DIR,
  scopeAt,
  ScopeError,
  selfAndAncestors,
} from '@open-tomato/rafa/project/scope';
import * as scopeModule from '@open-tomato/rafa/project/scope';
import {
  EFFORT_KEY_PROJECTIONS,
  openNdjsonStore,
  openSqliteStore,
  selectEffortStore,
} from '@open-tomato/rafa/store';
import * as storeEntry from '@open-tomato/rafa/store';
import { mergeStore } from '@open-tomato/rafa/store/merge-store';
import {
  decodeWirePayload,
  encodeWirePayload,
  exportWirePayload,
  materialiseWirePayload,
  WIRE_FORMAT,
  WIRE_VERSION,
  WireExportRefusal,
  WireFormatError,
} from '@open-tomato/rafa/store/wire';
import effortCollect from '@open-tomato/rafa-effort/effort/collect';
import effortReport from '@open-tomato/rafa-effort/effort/report';

import { CORE_ADAPTERS, registerCoreAdapters } from './adapter-registry.js';
import { TRUSTED_PERMISSIONS } from './board/trust.js';
import { CONFIG_DEFAULTS, registerCoreConfigSections } from './config-registry.js';
import {
  FINDING_KINDS,
  FINDING_SIGNALS,
  isRafaBlockKind,
  parsePlan,
  parseReport,
  PLAN_BLOCK_KINDS,
  PLAN_HEADER_FIELDS,
  RAFA_BLOCK_KINDS,
  readRafaBlocks,
  renderInjection,
  REPORT_STATUSES,
} from './plan/index.js';
import * as planEntry from './plan/index.js';
import plan from './plan.js';
import {
  loadPlanPrerequisites,
  mergePlanPrerequisites,
  parsePrerequisites,
  planPrerequisites,
  prerequisitesPathForPlan,
} from './preflight/prerequisites-md.js';
import { PROBE_TIMEOUT_MS, runPreflight, runShellProbe } from './preflight/run.js';
import start from './start.js';

import * as entry from './index.js';

/** The runtime names the entry exposes, sorted as `sort` sorts them. */
const RUNTIME_EXPORTS = [
  'BOARD_PROJECT_TEMPLATE_DEFAULT',
  'BOARD_RELATIONSHIP_MODES',
  'CLAUDE_SETTING_SOURCES',
  'CONFIG_DEFAULTS',
  'CONFIG_FILE',
  'CONFIG_VERSIONS',
  'CORE_ADAPTERS',
  'CORE_ADAPTER_REGISTRY',
  'ConfigError',
  'DISK_FILE_SYSTEM',
  'EFFORT_KEY_PROJECTIONS',
  'FEATURE_TYPES',
  'FINDING_KINDS',
  'FINDING_SIGNALS',
  'INIT_COMMAND',
  'INJECT_MODES',
  'MANIFEST_VERSION',
  'MODULE_SOURCE_KINDS',
  'OUTPUT_CHANNELS',
  'OUTPUT_MODES',
  'PLAN_BLOCK_KINDS',
  'PLAN_HEADER_FIELDS',
  'PORT_VERSIONS',
  'PREREQUISITE_KINDS',
  'PROBE_TIMEOUT_MS',
  'PR_PROVIDERS',
  'RAFA_BLOCK_KINDS',
  'RELEASE_AUTO',
  'REPORT_STATUSES',
  'RUNNING_MANIFEST_SEAMS',
  'SCOPE_DIR',
  'STORE_BACKENDS',
  'SYNC_STRATEGIES',
  'ScopeError',
  'TRUSTED_PERMISSIONS',
  'WIRE_FORMAT',
  'WIRE_VERSION',
  'WireExportRefusal',
  'WireFormatError',
  'activeAdapterRegistry',
  'configFilePath',
  'createAdapterRegistry',
  'decodeWirePayload',
  'effortCollectCommand',
  'effortReportCommand',
  'encodeWirePayload',
  'exportWirePayload',
  'initHint',
  'isRafaBlockKind',
  'loadConfig',
  'loadPlanPrerequisites',
  'materialiseWirePayload',
  'mergePlanPrerequisites',
  'mergeStore',
  'openNdjsonStore',
  'openSqliteStore',
  'parseConfigText',
  'parsePlan',
  'parsePrerequisites',
  'parseReport',
  'planCommand',
  'planPrerequisites',
  'prerequisitesPathForPlan',
  'readConfigFile',
  'readProjectScope',
  'readRafaBlocks',
  'registerAdapters',
  'registerCoreAdapters',
  'registerCoreConfigSections',
  'renderInjection',
  'resolveConfig',
  'resolveScope',
  'restoreAdapters',
  'runPreflight',
  'runShellProbe',
  'scopeAt',
  'selectEffortStore',
  'selfAndAncestors',
  'startCommand',
  'validateManifest',
];

/** Each runtime name, the entry's value for it, and its module's own. */
const REEXPORTS: readonly (readonly [string, unknown, unknown])[] = [
  ['BOARD_PROJECT_TEMPLATE_DEFAULT', entry.BOARD_PROJECT_TEMPLATE_DEFAULT, BOARD_PROJECT_TEMPLATE_DEFAULT],
  ['BOARD_RELATIONSHIP_MODES', entry.BOARD_RELATIONSHIP_MODES, BOARD_RELATIONSHIP_MODES],
  ['CLAUDE_SETTING_SOURCES', entry.CLAUDE_SETTING_SOURCES, CLAUDE_SETTING_SOURCES],
  ['CONFIG_DEFAULTS', entry.CONFIG_DEFAULTS, CONFIG_DEFAULTS],
  ['CONFIG_FILE', entry.CONFIG_FILE, CONFIG_FILE],
  ['CONFIG_VERSIONS', entry.CONFIG_VERSIONS, CONFIG_VERSIONS],
  ['CORE_ADAPTERS', entry.CORE_ADAPTERS, CORE_ADAPTERS],
  ['CORE_ADAPTER_REGISTRY', entry.CORE_ADAPTER_REGISTRY, CORE_ADAPTER_REGISTRY],
  ['ConfigError', entry.ConfigError, ConfigError],
  ['DISK_FILE_SYSTEM', entry.DISK_FILE_SYSTEM, DISK_FILE_SYSTEM],
  ['EFFORT_KEY_PROJECTIONS', entry.EFFORT_KEY_PROJECTIONS, EFFORT_KEY_PROJECTIONS],
  ['FEATURE_TYPES', entry.FEATURE_TYPES, FEATURE_TYPES],
  ['FINDING_KINDS', entry.FINDING_KINDS, FINDING_KINDS],
  ['FINDING_SIGNALS', entry.FINDING_SIGNALS, FINDING_SIGNALS],
  ['INIT_COMMAND', entry.INIT_COMMAND, INIT_COMMAND],
  ['INJECT_MODES', entry.INJECT_MODES, INJECT_MODES],
  ['MANIFEST_VERSION', entry.MANIFEST_VERSION, MANIFEST_VERSION],
  ['MODULE_SOURCE_KINDS', entry.MODULE_SOURCE_KINDS, MODULE_SOURCE_KINDS],
  ['OUTPUT_CHANNELS', entry.OUTPUT_CHANNELS, OUTPUT_CHANNELS],
  ['OUTPUT_MODES', entry.OUTPUT_MODES, OUTPUT_MODES],
  ['PLAN_BLOCK_KINDS', entry.PLAN_BLOCK_KINDS, PLAN_BLOCK_KINDS],
  ['PLAN_HEADER_FIELDS', entry.PLAN_HEADER_FIELDS, PLAN_HEADER_FIELDS],
  ['PORT_VERSIONS', entry.PORT_VERSIONS, PORT_VERSIONS],
  ['PREREQUISITE_KINDS', entry.PREREQUISITE_KINDS, PREREQUISITE_KINDS],
  ['PROBE_TIMEOUT_MS', entry.PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS],
  ['PR_PROVIDERS', entry.PR_PROVIDERS, PR_PROVIDERS],
  ['RAFA_BLOCK_KINDS', entry.RAFA_BLOCK_KINDS, RAFA_BLOCK_KINDS],
  ['RELEASE_AUTO', entry.RELEASE_AUTO, RELEASE_AUTO],
  ['REPORT_STATUSES', entry.REPORT_STATUSES, REPORT_STATUSES],
  ['RUNNING_MANIFEST_SEAMS', entry.RUNNING_MANIFEST_SEAMS, RUNNING_MANIFEST_SEAMS],
  ['SCOPE_DIR', entry.SCOPE_DIR, SCOPE_DIR],
  ['STORE_BACKENDS', entry.STORE_BACKENDS, STORE_BACKENDS],
  ['SYNC_STRATEGIES', entry.SYNC_STRATEGIES, SYNC_STRATEGIES],
  ['ScopeError', entry.ScopeError, ScopeError],
  ['TRUSTED_PERMISSIONS', entry.TRUSTED_PERMISSIONS, TRUSTED_PERMISSIONS],
  ['WIRE_FORMAT', entry.WIRE_FORMAT, WIRE_FORMAT],
  ['WIRE_VERSION', entry.WIRE_VERSION, WIRE_VERSION],
  ['WireExportRefusal', entry.WireExportRefusal, WireExportRefusal],
  ['WireFormatError', entry.WireFormatError, WireFormatError],
  ['activeAdapterRegistry', entry.activeAdapterRegistry, activeAdapterRegistry],
  ['configFilePath', entry.configFilePath, configFilePath],
  ['createAdapterRegistry', entry.createAdapterRegistry, createAdapterRegistry],
  ['decodeWirePayload', entry.decodeWirePayload, decodeWirePayload],
  ['effortCollectCommand', entry.effortCollectCommand, effortCollect],
  ['effortReportCommand', entry.effortReportCommand, effortReport],
  ['encodeWirePayload', entry.encodeWirePayload, encodeWirePayload],
  ['exportWirePayload', entry.exportWirePayload, exportWirePayload],
  ['initHint', entry.initHint, initHint],
  ['isRafaBlockKind', entry.isRafaBlockKind, isRafaBlockKind],
  ['loadConfig', entry.loadConfig, loadConfig],
  ['loadPlanPrerequisites', entry.loadPlanPrerequisites, loadPlanPrerequisites],
  ['materialiseWirePayload', entry.materialiseWirePayload, materialiseWirePayload],
  ['mergePlanPrerequisites', entry.mergePlanPrerequisites, mergePlanPrerequisites],
  ['mergeStore', entry.mergeStore, mergeStore],
  ['openNdjsonStore', entry.openNdjsonStore, openNdjsonStore],
  ['openSqliteStore', entry.openSqliteStore, openSqliteStore],
  ['parseConfigText', entry.parseConfigText, parseConfigText],
  ['parsePlan', entry.parsePlan, parsePlan],
  ['parsePrerequisites', entry.parsePrerequisites, parsePrerequisites],
  ['parseReport', entry.parseReport, parseReport],
  ['planCommand', entry.planCommand, plan],
  ['planPrerequisites', entry.planPrerequisites, planPrerequisites],
  ['prerequisitesPathForPlan', entry.prerequisitesPathForPlan, prerequisitesPathForPlan],
  ['readConfigFile', entry.readConfigFile, readConfigFile],
  ['readProjectScope', entry.readProjectScope, readProjectScope],
  ['readRafaBlocks', entry.readRafaBlocks, readRafaBlocks],
  ['registerAdapters', entry.registerAdapters, registerAdapters],
  ['registerCoreAdapters', entry.registerCoreAdapters, registerCoreAdapters],
  ['registerCoreConfigSections', entry.registerCoreConfigSections, registerCoreConfigSections],
  ['renderInjection', entry.renderInjection, renderInjection],
  ['resolveConfig', entry.resolveConfig, resolveConfig],
  ['resolveScope', entry.resolveScope, resolveScope],
  ['restoreAdapters', entry.restoreAdapters, restoreAdapters],
  ['runPreflight', entry.runPreflight, runPreflight],
  ['runShellProbe', entry.runShellProbe, runShellProbe],
  ['scopeAt', entry.scopeAt, scopeAt],
  ['selectEffortStore', entry.selectEffortStore, selectEffortStore],
  ['selfAndAncestors', entry.selfAndAncestors, selfAndAncestors],
  ['startCommand', entry.startCommand, start],
  ['validateManifest', entry.validateManifest, validateManifest],
];

/**
 * The runtime names the config barrel holds and the root does not
 * publish: core's section, the routing defaults, the item readers and
 * the section registry with its key indexes and its load hook, and the
 * laying of a file's templates under its keys.
 */
const CONFIG_BARREL_ONLY: readonly string[] = [
  'CORE_SECTION',
  'ConfigSectionError',
  'DEFAULT_ROUTES',
  'DEFAULT_ROUTING',
  'EMPTY_CONFIG_REGISTRY',
  'MODULE_SOURCE_KEYS',
  'OPTIONAL_ITEM_KEYS',
  'REQUIRED_ITEM_KEYS',
  'activeChecks',
  'activeConfigLoadHook',
  'activeConfigTemplateHook',
  'activeDefaults',
  'activeKnownKeysAbove',
  'activeSectionPaths',
  'activeSections',
  'activeSettingByKey',
  'activeSettings',
  'dangerousKeys',
  'dangerousPassLines',
  'dangerousPhrases',
  'layTemplatesUnder',
  'mergeConfigSections',
  'moduleSource',
  'optionalPrerequisite',
  'parseConfigDocument',
  'readConfigDocument',
  'registerConfigSections',
  'registeredDefaults',
  'registeredSettings',
  'requiredPrerequisite',
  'restoreConfigSections',
  'restoreDangerousPhrases',
  'runWithDangerousPhrases',
  'setConfigLoadHook',
  'setConfigTemplateHook',
  'setDangerousPhrases',
  'writeDangerousPassLines',
];

/** The config barrel's runtime names less {@link CONFIG_BARREL_ONLY}. */
const configModule: Record<string, unknown> = Object.fromEntries(
  Object.entries(configBarrel).filter(([name]) => !CONFIG_BARREL_ONLY.includes(name)),
);

/** The modules whose every runtime name the root also carries. */
const CONTAINED: readonly (readonly [string, Record<string, unknown>])[] = [
  ['the ./plan entry', planEntry],
  ['the ./store entry', storeEntry],
  ['the config module', configModule],
  ['the config loader', configLoadModule],
  ['the scope module', scopeModule],
  ['the adapter registry', registryModule],
  ['the manifest module', manifestModule],
];

/** The `src/` directory, which the entry and the CLI both sit in. */
const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));

/** The CLI entry, read as source and imported by the control. */
const CLI_PATH = join(SRC_DIR, 'rafa.ts');

/** The entry under test, as the probe imports it. */
const ENTRY_PATH = join(SRC_DIR, 'index.ts');

/**
 * What a module imports: each module and the bindings taken from it,
 * `default` for a default import, in the source's order.
 */
type ImportList = readonly (readonly [string, readonly string[]])[];

/** What `src/rafa.ts` imports, spelled here; an import for its effect alone takes no binding. */
const CLI_IMPORTS: ImportList = [
  ['@open-tomato/rafa/modules/activate', ['activateModuleAdapters']],
  ['@open-tomato/rafa/modules/load', ['loadInvocationModules']],
  ['./adapter-registry.js', ['registerCoreAdapters']],
  ['./cli/dispatch.js', ['dispatch']],
  ['./cli/help.js', ['renderHelp']],
  ['./commands/index.js', ['createRosterRegistry']],
  ['./config-registry.js', ['registerCoreConfigSections']],
  ['./status/hook.js', ['createStatusHook']],
];

/**
 * Each core command module, from `src/`, in the roster's order, and what
 * it imports, spelled here as {@link CLI_IMPORTS} is. A bundled
 * feature's command modules are not here: the registry holds a lazy
 * command for each, spelled in {@link FEATURE_COMMANDS}.
 */
const COMMAND_MODULES: readonly (readonly [string, ImportList])[] = [
  ['./commands/plan/create.js', [
    ['@open-tomato/rafa-board', ['CREATE_DANGEROUS_PHRASES', 'registryRoster']],
    ['@open-tomato/rafa-run', ['endingWith']],
    ['@open-tomato/rafa/core/command', ['HINT_FLAG_SPEC']],
    ['../../plan.js', ['default']],
    ['../wrap.js', ['wrapPhaseZeroCommand']],
  ]],
  ['./commands/plan/list.js', [
    ['@open-tomato/rafa-run', ['listPlans']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject', 'resolvePlansDir']],
    ['@open-tomato/rafa/core/plan', ['formatCounts', 'plural']],
  ]],
  ['./commands/plan/show.js', [
    ['@open-tomato/rafa-run', ['parsePlan']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'requireProject', 'resolvePlansDir']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/plan', ['checkbox', 'countTasks', 'formatCounts', 'isFile', 'issueLine', 'isStampableStub', 'planFileName']],
  ]],
  ['./commands/plan/validate.js', [
    ['@open-tomato/rafa-inventory', ['collidingPlanSkills', 'missingAgentLine', 'missingPlanAgents', 'resolveAgentRoster', 'skillCollisionLine', 'unresolvedPlanSkills', 'unresolvedSkillLine']],
    ['@open-tomato/rafa-run', ['prerequisitesPathForPlan', 'storeRuleLine', 'validatePlan']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/plan', ['formatCounts', 'issueLine', 'plural']],
    ['./bundled-check.js', ['bundledEditLine', 'findBundledEdits', 'writeTierPins']],
    ['./store-check.js', ['checkStoreRules']],
  ]],
  ['./commands/plan/risk.js', [
    ['@open-tomato/rafa-board', ['createGhRunner']],
    ['@open-tomato/rafa-pr', ['assessPlanRisk', 'renderRiskText']],
    ['@open-tomato/rafa-run', ['DEFAULT_PLAN_FILE', 'resolvePlanPath']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectAtMostOneArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/git', ['createGitRunner']],
    ['@open-tomato/rafa/core/plan', ['isFile', 'plural']],
  ]],
  ['./commands/plan/needs.js', [
    ['@open-tomato/rafa-inventory', ['pathDirectories']],
    ['@open-tomato/rafa-run', ['DEFAULT_PLAN_FILE', 'resolvePlanPath']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectAtMostOneArgument', 'readSwitch', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/core/plan', ['isFile', 'plural']],
    ['@open-tomato/rafa/modules/load', ['loadModules', 'moduleSettings']],
    ['../../plan/needs.js', ['isUnmet', 'readPlanNeeds', 'readSpecNeeds']],
    ['../skill/list.js', ['isSourceShape']],
    ['./spec-route.js', ['resolveCreateSpec']],
  ]],
  ['./commands/loop/start.js', [
    ['@open-tomato/rafa-run', ['DEFAULT_CI_ATTEMPTS', 'endingWith', 'refuseMisplacedRuntime']],
    ['@open-tomato/rafa/core/command', ['DEFAULT_CI_TIMEOUT_MIN', 'HINT_FLAG_SPEC']],
    ['../../start.js', ['default']],
    ['../wrap.js', ['wrapPhaseZeroCommand']],
  ]],
  ['./commands/loop/stop.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/loop', ['errorCode', 'readSession', 'SessionRecordError']],
    ['@open-tomato/rafa/core/loop/readings', ['isLive', 'planLabel', 'readSessionChecklist', 'refusal', 'resolveLoopSeams']],
    ['./loop-sessions.js', ['checkboxAt', 'pickSession', 'sessionIdFlag']],
  ]],
  ['./commands/loop/pause.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/loop/readings', ['isLive', 'refusal', 'resolveLoopSeams']],
    ['./loop-sessions.js', ['pickSession', 'sessionIdFlag', 'writeSession']],
  ]],
  ['./commands/loop/resume.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/loop/readings', ['isLive', 'refusal', 'resolveLoopSeams']],
    ['./loop-sessions.js', ['pickSession', 'sessionIdFlag', 'writeSession']],
  ]],
  ['./commands/loop/status.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/loop', ['sessionPhase']],
    ['@open-tomato/rafa/core/loop/readings', ['estimateEta', 'isLive', 'readSessionChecklist', 'readSessionFinishes', 'resolveLoopSeams', 'sessionLine']],
    ['@open-tomato/rafa/core/plan', ['countTasks']],
    ['../../loop/blocked-tasks.js', ['blockedTasks']],
    ['./loop-sessions.js', ['etaLine', 'phasedCounts', 'phaseNote', 'pickSession', 'sessionIdFlag']],
  ]],
  ['./commands/loop/list.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/loop', ['sessionPhase']],
    ['@open-tomato/rafa/core/loop/readings', ['isLive', 'readRecords', 'readSessionChecklist', 'resolveLoopSeams', 'sessionLine']],
    ['@open-tomato/rafa/core/plan', ['countTasks']],
    ['./loop-sessions.js', ['phasedCounts', 'phaseNote', 'projectRoot']],
  ]],
  ['./commands/loop/wait.js', [
    ['@open-tomato/rafa-run', ['eventsFileOf', 'readEventsFrom']],
    ['@open-tomato/rafa/adapters/output/events', ['EVENT_PREFIX', 'oneLine', 'padKind']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/loop', ['readSession', 'SessionRecordError']],
    ['@open-tomato/rafa/core/loop/readings', ['refusal', 'resolveLoopSeams']],
    ['@open-tomato/rafa/core/plan', ['plural']],
    ['../../loop/awake-clock.js', ['createAwakeClock']],
    ['../../loop/wait-reasons.js', ['DEFAULT_WAIT_UNTIL', 'matchEvent', 'matchQuiet', 'matchRecord', 'parseWaitUntil', 'WAIT_NO_SESSION_EXIT', 'WAIT_REASONS', 'WAIT_TIMEOUT_EXIT', 'waitExitCode', 'WaitUntilError']],
    ['./loop-sessions.js', ['lineRefusal', 'NoSessionRefusal', 'pickSession', 'sessionIdFlag']],
  ]],
  ['./commands/effort/collect.js', [
    ['@open-tomato/rafa-effort', ['collect']],
    ['../wrap.js', ['wrapPhaseZeroCommand']],
  ]],
  ['./commands/effort/report.js', [
    ['@open-tomato/rafa-effort', ['report']],
    ['../wrap.js', ['wrapPhaseZeroCommand']],
  ]],
  ['./commands/effort/dashboard.js', [
    ['@open-tomato/rafa-effort', ['formatDashboard', 'parseReportArgs', 'readDashboard']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
  ]],
  ['./commands/effort/fix-schema.js', [
    ['@open-tomato/rafa-effort', ['fileStamp']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/loop', ['readSessions']],
    ['@open-tomato/rafa/store/fix-schema', ['fixStoreSchema', 'SchemaFixRefusal']],
    ['@open-tomato/rafa/store/sqlite', ['sqliteStorePath']],
  ]],
  ['./commands/effort/copy.js', [
    ['@open-tomato/rafa-effort', ['fileStamp']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/store/copy', ['copyEffortStore', 'EffortCopyFailure', 'EffortCopyRefusal']],
    ['@open-tomato/rafa/store/location', ['EFFORT_DIR_VARIABLE']],
    ['@open-tomato/rafa/store/ndjson-files', ['EFFORT_STORE_DIR']],
  ]],
  ['./commands/effort/schema.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/store/location', ['effortStoreDir']],
    ['@open-tomato/rafa/store/schema-report', ['gateMeaning', 'readSchemaReport']],
    ['@open-tomato/rafa/store/sqlite', ['SQLITE_STORE_FILE_NAME']],
  ]],
  ['./commands/effort/migrate.js', [
    ['@open-tomato/rafa-effort', ['fileStamp']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/store/development-build', ['DevelopmentBuildRefusedError']],
    ['@open-tomato/rafa/store/location', ['effortStoreDir']],
    ['@open-tomato/rafa/store/migrate', ['migrateStore', 'MigrateRefusal']],
    ['@open-tomato/rafa/store/sqlite', ['SQLITE_STORE_FILE_NAME']],
    ['./fix-schema.js', ['keepsIdLine']],
  ]],
  ['./commands/effort/merge.js', [
    ['@open-tomato/rafa-effort', ['fileStamp']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/store/development-build', ['DevelopmentBuildRefusedError']],
    ['@open-tomato/rafa/store/location', ['effortStoreDir']],
    ['@open-tomato/rafa/store/merge-store', ['MergeRefusal', 'mergeStore']],
    ['@open-tomato/rafa/store/merge-union', ['UnionSchemaMismatch']],
    ['@open-tomato/rafa/store/rebuild-aside', ['RebuildRefusal']],
    ['@open-tomato/rafa/store/sqlite', ['SQLITE_STORE_FILE_NAME']],
    ['./fix-schema.js', ['keepsIdLine']],
  ]],
  ['./commands/effort/import.js', [
    ['@open-tomato/rafa-effort', ['createFileSync']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['./merge.js', ['mergeRefusalExit', 'mergeTargetPath', 'renderMerge']],
  ]],
  ['./commands/effort/move.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/store/bring-forward', ['SchemaRefusedError']],
    ['@open-tomato/rafa/store/development-build', ['DevelopmentBuildRefusedError']],
    ['@open-tomato/rafa/store/location', ['effortStoreDir']],
    ['@open-tomato/rafa/store/merge-store', ['MOVE_TO_SQLITE']],
    ['@open-tomato/rafa/store/move', ['MOVE_TARGET', 'MoveRefusal', 'moveToSqlite']],
  ]],
  ['./commands/module/list.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/modules/load', ['loadModules', 'moduleSettings']],
  ]],
  ['./commands/module/exec.js', [
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['../../cli/registry.js', ['mountKey']],
  ]],
  ['./commands/agent/vendor.js', [
    ['@open-tomato/rafa-inventory', ['bundledAgentsDirectory', 'readAgentDirectory']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/schema/frontmatter', ['readFrontmatter']],
    ['@open-tomato/rafa/utils/agent-definition', ['AGENT_DEFINITION_DIR']],
  ]],
  ['./commands/agent/list.js', [
    ['@open-tomato/rafa-inventory', ['VENDOR_COMMAND', 'buildInventory', 'pathDirectories']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/modules/load', ['loadModules', 'moduleSettings']],
    ['@open-tomato/rafa/schema/tiers', ['SKILL_TIERS']],
    ['../skill/list.js', ['browseListing', 'HIDDEN_MARK', 'interactiveFlag', 'interactiveTerminal', 'isSourceShape', 'knownSources', 'matchesFilters', 'skillRowLines', 'STATE_FILTERS', 'VISIBLE_MARK', 'warningLines']],
  ]],
  ['./commands/agent/show.js', [
    ['@open-tomato/rafa-inventory', ['findShown', 'readShowView', 'renderShowView']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'readSwitch']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['../skill/list.js', ['projectInventory', 'warningLines']],
    ['./list.js', ['DEFAULT_AGENT_LIST_SEAMS']],
  ]],
  ['./commands/agent/search.js', [
    ['../skill/search.js', ['createSearchCommand', 'DEFAULT_SEARCH_SEAMS']],
  ]],
  ['./commands/skill/check.js', [
    ['../check-report.js', ['checkCommandRun', 'DEFAULT_CHECK_SEAMS', 'SKILL_CHECK_USAGE']],
  ]],
  ['./commands/skill/list.js', [
    ['@open-tomato/rafa-inventory', ['buildInventory', 'pathDirectories']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/modules/load', ['loadModules', 'moduleSettings']],
    ['@open-tomato/rafa/schema/tiers', ['isSkillTier', 'SKILL_TIERS']],
    ['../../cli/prompt/terminal.js', ['processTerminal', 'refuseWithoutTerminal']],
    ['../../inventory/browse.js', ['browse']],
  ]],
  ['./commands/skill/show.js', [
    ['@open-tomato/rafa-inventory', ['findShown', 'readShowView', 'renderShowView']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'readSwitch']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['./list.js', ['DEFAULT_SKILL_LIST_SEAMS', 'projectInventory', 'warningLines']],
  ]],
  ['./commands/skill/search.js', [
    ['@open-tomato/rafa-effort', ['collectSessionRow']],
    ['@open-tomato/rafa-inventory', ['droppedLine', 'rankSearch', 'runSearch']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'readSwitch']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/store', ['selectEffortStore']],
    ['./list.js', ['DEFAULT_SKILL_LIST_SEAMS', 'projectInventory', 'warningLines']],
  ]],
  ['./commands/skill/demote.js', [
    ['@open-tomato/rafa-inventory', ['DEMOTION_ACTION_KINDS', 'DEMOTION_VERDICTS', 'REVIEWED_STATUS', 'applyDemotion', 'buildDemotionReport', 'countVerdicts', 'parseDemotionReport', 'pathDirectories', 'planDemotion', 'resolveDemotionScope', 'selectSources', 'writeDemotionReport']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
  ]],
  ['./commands/skill/backfill.js', [
    ['@open-tomato/rafa-inventory', ['ANSWERED_ROW', 'BACKFILL_PATH', 'DERIVATION_KINDS', 'PROPOSAL_ACTION_KINDS', 'REVIEWED_FILE', 'applyDerivation', 'applyProposals', 'backupDirectory', 'backupFiles', 'countBackups', 'countDerivations', 'pathDirectories', 'planDerivation', 'readProposalFiles', 'resolveDemotionScope', 'runProposalPass', 'selectProposals']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
  ]],
  ['./commands/instinct/check.js', [
    ['../check-report.js', ['checkCommandRun', 'DEFAULT_CHECK_SEAMS', 'INSTINCT_CHECK_USAGE']],
  ]],
  ['./commands/instinct/list.js', [
    ['@open-tomato/rafa-inventory', ['readScopes', 'toHeldRecords', 'triggerKey']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/adapters', ['CORE_ADAPTER_REGISTRY']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['./instinct-records.js', ['allRecords', 'instinctProject']],
    ['./promote.js', ['makeLearningAdapter', 'refusedPullMessage']],
  ]],
  ['./commands/instinct/show.js', [
    ['@open-tomato/rafa-inventory', ['ACTION_HEADING', 'CAUSE_HEADING', 'readScopes']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['./instinct-records.js', ['findRecords', 'instinctProject']],
  ]],
  ['./commands/instinct/flag.js', [
    ['@open-tomato/rafa-board', ['expectTwoArguments']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/adapters', ['CORE_ADAPTER_REGISTRY']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
  ]],
  ['./commands/instinct/promote.js', [
    ['@open-tomato/rafa-inventory', ['promotable']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/adapters', ['CORE_ADAPTER_REGISTRY']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
  ]],
  ['./commands/update/current.js', [
    ['@open-tomato/rafa-board', ['createGhRunner']],
    ['@open-tomato/rafa-pr', ['resolvePrProvider']],
    ['@open-tomato/rafa-release', ['LOCK_FILE', 'readProjectLock']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit', 'createLinePrompter', 'RAFA_VERSION']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/project/worktree-root', ['mainCheckoutOf']],
    ['@open-tomato/rafa/schema/project-id', ['gitRemoteUrl']],
    ['../../project/scaffold.js', ['scaffoldConflicts']],
    ['../../project/update-current.js', ['applyUpdatePlan', 'planChanges', 'readUpdatePlan', 'UpdateStepError']],
    ['../../project/update-range.js', ['readCurrentRange']],
  ]],
  ['./commands/update/self.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/update/project.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/update/rafa.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/update/port.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/update/board.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/update/next.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/update/latest.js', [
    ['./stub.js', ['createUpdateStub']],
  ]],
  ['./commands/config/set.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['configFilePath']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['../../config-set.js', ['ConfigSetRefusal', 'withConfigSetting']],
    ['../../utils/agent-shell.js', ['AGENT_SHELL_ENV', 'isAgentShell']],
  ]],
  ['./commands/config/show.js', [
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['../../config-registry.js', ['SETTING_BY_KEY', 'SETTING_NAMES', 'SETTINGS']],
  ]],
  ['./commands/ci/status.js', [
    ['@open-tomato/rafa-board', ['createGhRunner', 'readNonBlankFlag', 'readRequiredFlag']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['../../ci/failed-cases.js', ['readFailedCases']],
    ['../../ci/runs.js', ['readNewestRun']],
    ['../../ci/status-reading.js', ['CI_STATUS_EXIT', 'readFailedLog', 'renderCiStatus', 'verdictOf']],
  ]],
  ['./commands/stretch/start.js', [
    ['@open-tomato/rafa-board', ['lineRefusal', 'readChoiceFlag', 'readTextFlag']],
    ['@open-tomato/rafa-pr', ['DEFAULT_BASE_BRANCH', 'readRemoteHead']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['configFilePath']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/git', ['createGitRunner', 'gitSaid']],
    ['@open-tomato/rafa/core/loop', ['readSessions']],
    ['../../config-set.js', ['ConfigSetRefusal', 'withConfigSetting']],
    ['../../stretch/folder.js', ['agentFilePath', 'defaultSeams', 'liveStretches', 'newestWatched', 'nextStretch', 'projectName', 'stretchFolder', 'tmuxSessionName', 'tmuxTarget']],
    ['../../stretch/launch.js', ['besideEngineerPrompt', 'claudeLine', 'DEFAULT_RAFA_COMMAND', 'lineText', 'OPERATOR_ROLES', 'roleCommand', 'tmuxLines']],
    ['../../stretch/operators.js', ['copyOperators', 'defaultOperatorsSeams', 'findOperators', 'linkedOperatorLines', 'linkedOperators', 'missingOperatorsLine', 'operatorsCopyPath']],
    ['../../stretch/prompt.js', ['defaultPromptSeams', 'engineerPrompt']],
  ]],
  ['./commands/stretch/item.js', [
    ['@open-tomato/rafa-board', ['createGhRunner', 'createGithubTracker']],
    ['@open-tomato/rafa/board/naming', ['boardId']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectOneArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/loop', ['isPidAlive', 'readSessions']],
    ['@open-tomato/rafa/core/plan', ['plansDirAt', 'stubOfPlanFile']],
    ['../../stretch/folder.js', ['stretchFolder']],
    ['../../stretch/launch.js', ['DEFAULT_RAFA_COMMAND', 'lineText']],
    ['./item-merge.js', ['afterLoopWait', 'mergeDryRunLines']],
    ['./start.js', ['PR_BASE_KEY', 'STRETCH_BRANCH_PREFIX']],
  ]],
  ['./commands/stretch/end.js', [
    ['@open-tomato/rafa-pr', ['DEFAULT_BASE_BRANCH', 'DEFAULT_PR_SEAMS', 'onProvider', 'openPrContext', 'readRemoteHead']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config', ['configFilePath']],
    ['@open-tomato/rafa/core/config/sections', ['describeValue', 'isMapping', 'messageOf']],
    ['@open-tomato/rafa/core/git', ['createGitRunner']],
    ['../../config-set.js', ['ConfigSetRefusal', 'withConfigSetting']],
    ['../../stretch/folder.js', ['stretchFolder']],
    ['../../stretch/items.js', ['malformedItemLines', 'readItems']],
    ['../../stretch/launch.js', ['lineText']],
    ['./item.js', ['stretchOfBase']],
    ['./start.js', ['PR_BASE_KEY', 'STRETCH_BRANCH_PREFIX', 'stretchBranch', 'stretchRecordPath']],
  ]],
  ['./commands/bug/codes.js', [
    ['@open-tomato/rafa-board', ['DEFAULT_ISSUE_SEAMS', 'createGhRunner', 'issueName', 'lineRefusal', 'readNonBlankFlag', 'resolveTracker']],
    ['@open-tomato/rafa/adapters/logger/active', ['activeLogger']],
    ['@open-tomato/rafa/bugs/record', ['parseBugRecord']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/errors/codes', ['familyOf', 'NEW_CONTEXT_LEAF', 'UNKNOWN_FAMILY']],
    ['@open-tomato/rafa/errors/rafa-codes', ['FAMILY_DESCRIPTIONS', 'listedCodes']],
    ['../../errors/match.js', ['nearDuplicates', 'suggestWithProposals']],
  ]],
  ['./commands/bug/recheck.js', [
    ['@open-tomato/rafa-board', ['DEFAULT_ISSUE_SEAMS', 'boardRepoLabel', 'createGhRunner', 'ghBoardTrust', 'issueName', 'issueRef', 'lineRefusal', 'onTracker', 'readBoardTrust', 'resolveIssueTracker', 'trustRefusalClause']],
    ['@open-tomato/rafa-pr', ['DIRTY_MARK', 'NO_COMMIT', 'checkoutOf', 'codeVersionOf', 'namedSecrets', 'redactSecrets']],
    ['@open-tomato/rafa-run', ['suiteEnv']],
    ['@open-tomato/rafa/bugs/record', ['parseBugRecord']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit', 'RAFA_VERSION']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/git', ['createGitRunner']],
    ['@open-tomato/rafa/triage/local-paths', ['localPathRedactor']],
    ['../../bugs/test-reference.js', ['readTestReference', 'resolveTestReference']],
    ['./recheck-report.js', ['recheckComment', 'referenceText', 'renderRecheck']],
    ['./recheck-run.js', ['recheckBug']],
  ]],
  ['./commands/docs/plan.js', [
    ['@open-tomato/rafa-board', ['DEFAULT_ISSUE_SEAMS', 'resolveTracker']],
    ['@open-tomato/rafa-pr', ['DOC_UPDATE_TASK_PREFIX', 'DOC_UPDATE_TITLE', 'readOpenStaleDocLines']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'requireProject', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/plan', ['plansDirAt', 'isStampableStub', 'planStampLine', 'escapeBlockerText']],
  ]],
  ['./commands/status.js', [
    ['@open-tomato/rafa-effort', ['pullBeforeRead']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['../status/render.js', ['renderStatus', 'statusData']],
    ['../status/sections.js', ['readStatusSections']],
  ]],
  ['./commands/next.js', [
    ['@open-tomato/rafa-effort', ['pullBeforeRead']],
    ['@open-tomato/rafa-pr', ['followsMerge', 'openNextRelations', 'openNextSources', 'readSettleAfterMerge']],
    ['@open-tomato/rafa-release', ['epicEndLines', 'watchDryEpic']],
    ['@open-tomato/rafa-run', ['REMOTE', 'actionInvocation', 'actionOutput', 'commandWords', 'nextQuestion', 'readHomeAfterLoop', 'readNextState', 'runAction']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit', 'createLinePrompter', 'lazyPrompter']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['../next/ceiling.js', ['ALWAYS_ASKED', 'allowedUnasked', 'BARE_YES_ACTIONS', 'readYesCeiling', 'YES_ACTIONS', 'YES_FLAG']],
    ['../next/lines.js', ['CLAIM_AHEAD_FLAG', 'DRY_RUN_FLAG', 'dryRunOf', 'MAX_ACTIONS', 'NEXT_USAGE', 'proposalLine', 'readClaimAhead', 'readDryRun', 'readRoadmap', 'ROADMAP_FLAG', 'stateLine', 'stopLine']],
    ['../next/sync.js', ['fastForwardBase']],
  ]],
  ['./commands/roadmap.js', [
    ['@open-tomato/rafa-board', ['DEFAULT_ISSUE_SEAMS', 'ISSUE_LIST_FLAGS']],
  ]],
  ['./commands/switch.js', [
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/git', ['createGitRunner']],
    ['@open-tomato/rafa/project/position', ['hop', 'positionFilePath', 'rehome', 'writePositionFile']],
    ['../adapters/tracker/github.js', ['createGhRunner']],
    ['../board/boards.js', ['resolveDefaultBoard']],
    ['../board/configured-relations.js', ['readConfiguredRelations']],
    ['../board/epic-board.js', ['boardOfEpic', 'openBoards']],
    ['../board/now-epic.js', ['firstNowEpic']],
    ['../board/place.js', ['resolvePlace']],
    ['../board/roadmap-board.js', ['createGhBoardListing']],
    ['../board/roadmap-epic-rows.js', ['horizonOf', 'readListedEpics']],
    ['../board/roadmap.js', ['createGhRoadmapSearch', 'parseRoadmapBody', 'scanClaimBranches']],
    ['../board/setup.js', ['ROADMAP_LABEL']],
    ['../claims/drift.js', ['checkDrift', 'driftLines']],
    ['./issue/issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
  ]],
  ['./commands/init.js', [
    ['@open-tomato/rafa-board', ['commandProgressFeed', 'commandRetrySeams', 'createGhRunner']],
    ['@open-tomato/rafa-inventory', ['vendorableAgentWarnings', 'vendorableAgents']],
    ['@open-tomato/rafa-pr', ['resolvePrProvider']],
    ['@open-tomato/rafa/core/command', ['CommandExit', 'createLinePrompter']],
    ['@open-tomato/rafa/core/config', ['ConfigError', 'configFilePath']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/project/bin-path', ['readBinPath']],
    ['@open-tomato/rafa/project/roots', ['DISK_ROOTS_FILE_SYSTEM', 'gitToplevel', 'rootCandidates']],
    ['@open-tomato/rafa/schema/project-id', ['gitRemoteUrl']],
    ['../project/gitignore.js', ['applyTracking', 'GITIGNORE_FILE', 'GitignoreError', 'TRACKING_DIGEST_FILE', 'withTrackingBlock']],
    ['../project/root-choice.js', ['candidateLines', 'firstCandidate', 'namedRoot', 'promptForRoot']],
    ['../project/scaffold.js', ['scaffoldConflicts', 'writeProjectScope', 'writeUserScope']],
    ['./init-board-project.js', ['projectStepChanged', 'renderProjectStep', 'runProjectStep']],
    ['./init-board.js', ['boardStepChanged', 'epicGuardChanged', 'relationsMoveChanged', 'renderBoardStep', 'renderEpicGuardStep', 'renderRelationsMoveStep', 'runBoardStep', 'runEpicGuardStep', 'runRelationsMoveStep']],
    ['./init-release.js', ['renderReleaseStep', 'runReleaseStep']],
  ]],
  ['./commands/doctor.js', [
    ['@open-tomato/rafa-board', ['commandRetrySeams', 'readDoctorRefs', 'registryRoster', 'renderDoctorRefs']],
    ['@open-tomato/rafa-effort', ['readDoctorEffortSync']],
    ['@open-tomato/rafa-pr', ['ghPreflightItems', 'resolvePrProvider']],
    ['@open-tomato/rafa-run', ['DEFAULT_PLAN_FILE', 'announceRiskTotal', 'isFirstDispatch', 'loadPlanPrerequisites', 'malformedPrerequisiteLines', 'mergePlanPrerequisites', 'prerequisitesPathForPlan', 'resolvePlanPath', 'runPreflight']],
    ['@open-tomato/rafa/core/command', ['CommandExit', 'versionLine']],
    ['@open-tomato/rafa/core/config', ['ConfigError']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/plan', ['isFile', 'trackerPathFor']],
    ['./doctor-board.js', ['boardRunner', 'readDoctorBoard', 'relationsResultOf', 'renderDoctorBoard']],
    ['./doctor-cleanup.js', ['readDoctorCleanup', 'renderDoctorCleanup']],
    ['./doctor-config.js', ['loadDoctorConfig']],
    ['./doctor-deep.js', ['readDeep', 'renderDeep']],
    ['./doctor-description.js', ['DOCTOR_DESCRIPTION']],
    ['./doctor-effort-schema.js', ['effortSchemaRefusal', 'readDoctorEffortSchema', 'writeDoctorEffortSchema']],
    ['./doctor-effort-sync.js', ['effortSyncRefusal', 'renderDoctorEffortSync']],
    ['./doctor-install.js', ['readInstall', 'writeInstall']],
    ['./doctor-project.js', ['readDoctorProject', 'renderDoctorProject']],
    ['./doctor-release.js', ['readDoctorRelease', 'writeDoctorRelease']],
    ['./doctor-render.js', ['renderDoctor']],
    ['./doctor-stretch.js', ['writeDoctorStretch']],
    ['./doctor-tiers.js', ['checkDoctorTiers', 'renderDoctorTiers']],
  ]],
  ['./commands/cleanup.js', [
    ['@open-tomato/rafa-pr', ['ghPullRequestsIn', 'resolvePrProvider']],
    ['@open-tomato/rafa-run', ['cleanupSteps', 'defaultCleanupSeams', 'deletedNotPushed', 'dryRunLines', 'readCleanup', 'runCleanupSteps']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument', 'readSwitch', 'resolveProjectConfig']],
    ['@open-tomato/rafa/core/command', ['CommandExit', 'createLinePrompter', 'lazyPrompter']],
    ['../cli/prompt/multi-select.js', ['multiSelect']],
    ['../cli/prompt/terminal.js', ['processTerminal']],
    ['./cleanup-render.js', ['branchRowLine', 'CLEANUP_GROUP_TITLES', 'cleanupData', 'cleanupNameWidth', 'remoteOnlyRowLine', 'renderCleanup', 'runRowLine', 'worktreeRowLine']],
  ]],
  ['./commands/self-update.js', [
    ['@open-tomato/rafa-run', ['exitCodeFor', 'installRuntime', 'outcomeProblem', 'runBuild']],
    ['@open-tomato/rafa/commands/plan/plan-files', ['expectNoArgument']],
    ['@open-tomato/rafa/core/command', ['CommandExit']],
    ['@open-tomato/rafa/core/config/load', ['loadConfig']],
    ['@open-tomato/rafa/core/config/sections', ['messageOf']],
    ['@open-tomato/rafa/core/loop', ['isPidAlive']],
    ['@open-tomato/rafa/project/bin-path', ['readBinPath']],
    ['@open-tomato/rafa/runtime/live-loops', ['liveLoopsOf']],
    ['../config-registry.js', ['SETTINGS']],
  ]],
  ['./commands/describe.js', [
    ['../../package.json', ['version']],
    ['../cli/describe.js', ['describeRegistry']],
  ]],
];

/**
 * Each bundled feature, in the order its commands follow core's in the
 * registry: the file that exports it, from `src/`, the name it is
 * exported under, and the spelling of each of its commands, in order.
 */
const FEATURE_COMMANDS: readonly (readonly [entry: string, name: string, commands: readonly string[]])[] = [
  ['./commands/board/index.js', 'BOARD_FEATURE', [
    'issue list', 'issue show', 'issue create', 'issue comment', 'issue move', 'issue ready', 'issue unblock', 'issue check', 'issue edit',
    'board list', 'board sync',
    'epic show', 'epic new', 'epic defer', 'epic promote', 'epic move', 'epic close', 'epic cancel',
  ]],
  ['./commands/pr/index.js', 'PR_FEATURE', [
    'pr current', 'pr show', 'pr view', 'pr open', 'pr retarget', 'pr close', 'pr list', 'pr wait', 'pr merge', 'pr triage',
  ]],
  ['./commands/claim/index.js', 'RUN_FEATURE', ['claim release', 'claim hand', 'claim accept', 'claim take']],
  ['./commands/release/index.js', 'RELEASE_FEATURE', ['release status', 'release settle', 'release tag', 'release publish', 'release workflows', 'release fragment', 'release list']],
];

/**
 * A static import of a project file, relative, by one of core's
 * subpaths (`@open-tomato/rafa/<subpath>`, #1090) or by a feature
 * package's facade (`@open-tomato/rafa-<name>`, #808), possibly spanning
 * lines, type-only or not, or one taken for its effect alone, with no
 * clause. Its clause holds no `;`, so a match never runs on from an
 * import of another bare module above it, such as `node:fs`, to the next
 * project one.
 */
const IMPORT_PATTERN = /^import\s+(?:(type\s+)?([^;]+?)\s+from\s+)?'((?:\.\.?\/|@open-tomato\/rafa\/)[^']+|@open-tomato\/rafa-[a-z]+)';$/gm;

/** A feature package's facade, imported by its name alone (#808). */
const FACADE_PATTERN = /^@open-tomato\/rafa-[a-z]+$/;

/** One import's clause read as the bindings it takes. */
function bindingsOf(clause: string): string[] {
  const named = /^(?:(\w+)\s*,\s*)?\{([^}]*)\}$/.exec(clause);
  if (named !== null) {
    const names = (named[2] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => part.split(/\s+as\s+/)[0] ?? part);
    return named[1] === undefined
      ? names
      : ['default', ...names];
  }
  if (/^\w+$/.test(clause)) return ['default'];
  throw new Error(`a module imports with a clause this test does not read: ${clause}`);
}

/** A module's runtime imports, read off its source: the `.ts` file a `.js` specifier names. */
function readImports(path: string): [string, string[]][] {
  const source = readFileSync(path.replace(/\.js$/, '.ts'), 'utf8');
  return [...source.matchAll(IMPORT_PATTERN)]
    .filter((match) => match[1] === undefined)
    .map((match) => [
      match[3] ?? '',
      match[2] === undefined
        ? []
        : bindingsOf(match[2]),
    ]);
}

/** An import list spelled here, in the shape {@link readImports} answers. */
function spelled(imports: ImportList): [string, string[]][] {
  return imports.map(([from, names]) => [from, [...names]]);
}

/** What the probe printed and left behind. */
interface ProbeRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** What the probe's directory holds afterwards, sorted. */
  files: string[];
}

/** The line the probe prints once the module is imported. */
interface ProbeReading {
  sigint: number;
  sigterm: number;
  exitCode: unknown;
  exports: number;
}

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-entry-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/**
 * Imports one module in a fresh process from an empty directory of its
 * own, and reports what that process printed and left behind.
 */
function probeImport(modulePath: string): ProbeRun {
  const cwd = mkdtempSync(join(tempBase, 'probe-'));

  writeFileSync(join(cwd, 'probe.ts'), [
    `const loaded = await import(${JSON.stringify(modulePath)});`,
    'console.log(JSON.stringify({',
    '  sigint: process.listenerCount(\'SIGINT\'),',
    '  sigterm: process.listenerCount(\'SIGTERM\'),',
    '  exitCode: process.exitCode ?? null,',
    '  exports: Object.keys(loaded).length,',
    '}));',
    '',
  ].join('\n'));

  const run = Bun.spawnSync([process.execPath, 'probe.ts'], { cwd, env: process.env });
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
    files: readdirSync(cwd).sort(),
  };
}

/** The probe's reading, from the last line it printed. */
function readingOf(run: ProbeRun): ProbeReading {
  const lines = run.stdout.trimEnd().split('\n');
  return JSON.parse(lines[lines.length - 1] ?? '') as ProbeReading;
}

describe('the package root entry', () => {
  it('exports exactly the runtime names it declares', () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it.each(REEXPORTS)('re-exports %s itself, not a copy or a wrapper', (_name, value, own) => {
    expect(value).toBe(own);
  });

  it.each(CONTAINED)('carries every runtime name of %s, as the same binding', (_label, module) => {
    const names = Object.keys(module);
    const onRoot: Record<string, unknown> = entry;
    const missing = names.filter((name) => !(name in onRoot) || onRoot[name] !== module[name]);

    expect(names.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('leaves off the root exactly the config barrel names spelled as the barrel\'s alone', () => {
    const onRoot: Record<string, unknown> = entry;
    const offRoot = Object.keys(configBarrel)
      .filter((name) => !(name in onRoot))
      .sort();

    expect(offRoot).toEqual([...CONFIG_BARREL_ONLY].sort());
  });
});

describe('what the CLI reaches, through the entry', () => {
  it('reads the imports src/rafa.ts takes as the ones spelled here', () => {
    expect(readImports(CLI_PATH)).toEqual(spelled(CLI_IMPORTS));
  });

  it.each(COMMAND_MODULES)('reads the imports %s takes as the ones spelled here', (path, imports) => {
    expect(readImports(join(SRC_DIR, path))).toEqual(spelled(imports));
  });

  it('dispatches through a registry holding exactly the commands of the modules spelled here, then those of the features spelled here', async () => {
    const { CORE_REGISTRY: registry } = await import(join(SRC_DIR, 'commands', 'index.js')) as {
      CORE_REGISTRY: { commands: (options: { includeHidden: boolean }) => readonly unknown[] };
    };
    const spelledCommands: unknown[] = [];
    for (const [path] of COMMAND_MODULES) {
      const module = await import(join(SRC_DIR, path)) as { default: unknown };
      spelledCommands.push(module.default);
    }
    const featureSpellings: string[][] = [];
    for (const [path, name] of FEATURE_COMMANDS) {
      const module = await import(join(SRC_DIR, path)) as Record<string, { commands: readonly { subject?: string; action: string }[] } | undefined>;
      const commands = module[name]?.commands ?? [];
      featureSpellings.push(commands.map((command) => `${command.subject ?? ''} ${command.action}`));
      spelledCommands.push(...commands);
    }

    expect(spelledCommands.filter((command) => command === undefined)).toEqual([]);
    expect(featureSpellings).toEqual(FEATURE_COMMANDS.map(([, , spellings]) => [...spellings]));
    expect(registry.commands({ includeHidden: true }).map((command) => spelledCommands.indexOf(command)))
      .toEqual(spelledCommands.map((_command, index) => index));
    expect(spelledCommands).toHaveLength(COMMAND_MODULES.length + FEATURE_COMMANDS.flatMap(([, , spellings]) => spellings).length);
  });

  it('reaches the phase 0 command each wrapping core command module runs, its one default import, or its facade binding when it has none, as a root export', async () => {
    const rootValues = new Set<unknown>(Object.values(entry));
    const wrapping = COMMAND_MODULES.filter(([, imports]) => imports.some(([, names]) => names.includes('wrapPhaseZeroCommand')));
    const runImports: number[] = [];
    const unreached: string[] = [];

    for (const [path] of wrapping) {
      const modulePath = join(SRC_DIR, path);
      const imports = readImports(modulePath);
      // The run is the module's default import when it takes one: a
      // module that also takes facade bindings, as `plan create` takes
      // the board's, takes them as values. Only a module with no
      // default takes its phase 0 command from a facade.
      const defaults = imports.flatMap(([from, names]) => names
        .filter((name) => name === 'default')
        .map((name) => [from, name] as const));
      const runs = defaults.length > 0
        ? defaults
        : imports
          .filter(([from]) => FACADE_PATTERN.test(from))
          .flatMap(([from, names]) => names.map((name) => [from, name] as const));
      runImports.push(runs.length);
      for (const [from, name] of runs) {
        const specifier = FACADE_PATTERN.test(from)
          ? from
          : join(modulePath, '..', from);
        const module = await import(specifier) as Record<string, unknown>;
        if (!rootValues.has(module[name])) unreached.push(`the ${name} of ${from}, run by ${path}`);
      }
    }

    expect(COMMAND_MODULES.filter((module) => !wrapping.includes(module)).map(([path]) => path)).toEqual([
      './commands/plan/list.js',
      './commands/plan/show.js',
      './commands/plan/validate.js',
      './commands/plan/risk.js',
      './commands/plan/needs.js',
      './commands/loop/stop.js',
      './commands/loop/pause.js',
      './commands/loop/resume.js',
      './commands/loop/status.js',
      './commands/loop/list.js',
      './commands/loop/wait.js',
      './commands/effort/dashboard.js',
      './commands/effort/fix-schema.js',
      './commands/effort/copy.js',
      './commands/effort/schema.js',
      './commands/effort/migrate.js',
      './commands/effort/merge.js',
      './commands/effort/import.js',
      './commands/effort/move.js',
      './commands/module/list.js',
      './commands/module/exec.js',
      './commands/agent/vendor.js',
      './commands/agent/list.js',
      './commands/agent/show.js',
      './commands/agent/search.js',
      './commands/skill/check.js',
      './commands/skill/list.js',
      './commands/skill/show.js',
      './commands/skill/search.js',
      './commands/skill/demote.js',
      './commands/skill/backfill.js',
      './commands/instinct/check.js',
      './commands/instinct/list.js',
      './commands/instinct/show.js',
      './commands/instinct/flag.js',
      './commands/instinct/promote.js',
      './commands/update/current.js',
      './commands/update/self.js',
      './commands/update/project.js',
      './commands/update/rafa.js',
      './commands/update/port.js',
      './commands/update/board.js',
      './commands/update/next.js',
      './commands/update/latest.js',
      './commands/config/set.js',
      './commands/config/show.js',
      './commands/ci/status.js',
      './commands/stretch/start.js',
      './commands/stretch/item.js',
      './commands/stretch/end.js',
      './commands/bug/codes.js',
      './commands/bug/recheck.js',
      './commands/docs/plan.js',
      './commands/status.js',
      './commands/next.js',
      './commands/roadmap.js',
      './commands/switch.js',
      './commands/init.js',
      './commands/doctor.js',
      './commands/cleanup.js',
      './commands/self-update.js',
      './commands/describe.js',
    ]);
    expect(runImports).toEqual(wrapping.map(() => 1));
    expect(unreached).toEqual([]);
  });
});

describe('importing the entry', () => {
  it('prints nothing, listens for no signal, sets no exit code and writes nothing', () => {
    const run = probeImport(ENTRY_PATH);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(readingOf(run)).toEqual({
      sigint: 0,
      sigterm: 0,
      exitCode: null,
      exports: RUNTIME_EXPORTS.length,
    });
    expect(run.files).toEqual(['probe.ts']);
  });

  it('is told apart from the CLI, which prints its help and sets its exit code when imported', () => {
    const run = probeImport(CLI_PATH);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('rafa <subject> <action> [args] [flags]\n');
    expect(run.stdout.trimEnd().split('\n').length).toBeGreaterThan(1);
    expect(readingOf(run)).toMatchObject({ exitCode: 0, exports: 0 });
  });
});
