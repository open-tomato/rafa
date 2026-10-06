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
 * The CLI cases read imports off source. `src/rafa.ts` imports the
 * dispatcher, the help renderer, the core registry, the module loader
 * and the since-last-command notice's command hook alone, and that
 * registry is held to
 * hold exactly the commands of the core command modules spelled here, so
 * a command registered and not spelled goes red. Each of those modules
 * wrapping a phase 0 command takes it as its one default import, and
 * that binding is held to be a root export's value, so a command the
 * terminal runs and a service cannot import goes red. `describe`, `init`,
 * `doctor`, `cleanup`, `status`, `self-update`, `roadmap`, `epic show`, `epic new`, `epic defer`, `epic promote`, `epic move`, `epic close`, `epic cancel`, `switch`, `board list`, the five plan readers, `plan list`, `plan show`,
 * `plan validate`, `plan risk` and `plan needs`, the six `loop` session actions, `loop stop`,
 * `loop pause`, `loop resume`, `loop status`, `loop list` and `loop wait`, the five
 * `issue` actions, and `module list` and `module exec` are held to be the
 * modules wrapping none. `describe` runs the roster builder
 * of `src/cli/describe.ts`, which is no root export, and each of the first
 * three plan readers imports `parsePlan` from the `./plan` entry, which is
 * one, where `plan risk` and `plan needs` import their readings from
 * `src/plan/risk.ts` and `src/plan/needs.ts`, which are not. A binding a module
 * takes by name, as `loop start` takes the CI defaults its flags show,
 * is a value and not a command, and is not held. Every parsed import list
 * is also held to the spelled one, which is what keeps a parser that
 * matched nothing from passing vacuously.
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
 * `RootCandidates` (`src/project/roots.ts`), which the entry leaves out,
 * failed with TS2305. That tsconfig sets `module` to `ESNext`, as the
 * repository's does: on `tsconfig.base.json` alone both probes also
 * failed with TS1343, on the `import.meta` reads of `src/plan.ts` and
 * `src/start.ts`.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, createAdapterRegistry, PORT_VERSIONS } from './adapters/registry.js';
import * as registryModule from './adapters/registry.js';
import { TRUSTED_PERMISSIONS } from './board/trust.js';
import { loadConfig, readConfigFile } from './config-load.js';
import * as configLoadModule from './config-load.js';
import {
  BOARD_RELATIONSHIP_MODES,
  CLAUDE_SETTING_SOURCES,
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  CONFIG_VERSIONS,
  ConfigError,
  configFilePath,
  INJECT_MODES,
  MODULE_SOURCE_KINDS,
  OUTPUT_MODES,
  parseConfigText,
  PR_PROVIDERS,
  PREREQUISITE_KINDS,
  RELEASE_AUTO,
  resolveConfig,
  STORE_BACKENDS,
  SYNC_STRATEGIES,
} from './config.js';
import * as configModule from './config.js';
import effortCollect from './effort/collect.js';
import effortReport from './effort/report.js';
import {
  EFFORT_KEY_PROJECTIONS,
  openNdjsonStore,
  openSqliteStore,
  selectEffortStore,
} from './effort/store/index.js';
import * as storeEntry from './effort/store/index.js';
import { mergeStore } from './effort/store/merge-store.js';
import {
  decodeWirePayload,
  encodeWirePayload,
  exportWirePayload,
  materialiseWirePayload,
  WIRE_FORMAT,
  WIRE_VERSION,
  WireExportRefusal,
  WireFormatError,
} from './effort/sync/wire.js';
import {
  FEATURE_TYPES,
  MANIFEST_VERSION,
  OUTPUT_CHANNELS,
  RUNNING_MANIFEST_SEAMS,
  validateManifest,
} from './modules/manifest.js';
import * as manifestModule from './modules/manifest.js';
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
import {
  DISK_FILE_SYSTEM,
  INIT_COMMAND,
  initHint,
  resolveScope,
  SCOPE_DIR,
  scopeAt,
  ScopeError,
  selfAndAncestors,
} from './project/scope.js';
import * as scopeModule from './project/scope.js';
import start from './start.js';

import * as entry from './index.js';

/** The runtime names the entry exposes, sorted as `sort` sorts them. */
const RUNTIME_EXPORTS = [
  'BOARD_RELATIONSHIP_MODES',
  'CLAUDE_SETTING_SOURCES',
  'CONFIG_DEFAULTS',
  'CONFIG_FILE',
  'CONFIG_VERSIONS',
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
  'readRafaBlocks',
  'renderInjection',
  'resolveConfig',
  'resolveScope',
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
  ['BOARD_RELATIONSHIP_MODES', entry.BOARD_RELATIONSHIP_MODES, BOARD_RELATIONSHIP_MODES],
  ['CLAUDE_SETTING_SOURCES', entry.CLAUDE_SETTING_SOURCES, CLAUDE_SETTING_SOURCES],
  ['CONFIG_DEFAULTS', entry.CONFIG_DEFAULTS, CONFIG_DEFAULTS],
  ['CONFIG_FILE', entry.CONFIG_FILE, CONFIG_FILE],
  ['CONFIG_VERSIONS', entry.CONFIG_VERSIONS, CONFIG_VERSIONS],
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
  ['readRafaBlocks', entry.readRafaBlocks, readRafaBlocks],
  ['renderInjection', entry.renderInjection, renderInjection],
  ['resolveConfig', entry.resolveConfig, resolveConfig],
  ['resolveScope', entry.resolveScope, resolveScope],
  ['runPreflight', entry.runPreflight, runPreflight],
  ['runShellProbe', entry.runShellProbe, runShellProbe],
  ['scopeAt', entry.scopeAt, scopeAt],
  ['selectEffortStore', entry.selectEffortStore, selectEffortStore],
  ['selfAndAncestors', entry.selfAndAncestors, selfAndAncestors],
  ['startCommand', entry.startCommand, start],
  ['validateManifest', entry.validateManifest, validateManifest],
];

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

/** What `src/rafa.ts` imports, spelled here. */
const CLI_IMPORTS: ImportList = [
  ['./cli/dispatch.js', ['dispatch']],
  ['./cli/help.js', ['renderHelp']],
  ['./commands/index.js', ['CORE_REGISTRY']],
  ['./modules/load.js', ['loadInvocationModules']],
  ['./status/hook.js', ['createStatusHook']],
];

/**
 * Each core command module, from `src/`, in the roster's order, and what
 * it imports, spelled here as {@link CLI_IMPORTS} is.
 */
const COMMAND_MODULES: readonly (readonly [string, ImportList])[] = [
  ['./commands/plan/create.js', [
    ['../../next/ending.js', ['endingWith', 'HINT_FLAG_SPEC']],
    ['../../plan.js', ['default']],
    ['../wrap.js', ['wrapPhaseZeroCommand']],
  ]],
  ['./commands/plan/list.js', [
    ['../../plan/index.js', ['parsePlan']],
    ['./plan-files.js', [
      'countTasks',
      'expectNoArgument',
      'formatCounts',
      'isFile',
      'planFileName',
      'plural',
      'readSwitch',
      'requireProject',
      'resolvePlansDir',
      'stubOfPlanFile',
    ]],
  ]],
  ['./commands/plan/show.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../plan/index.js', ['parsePlan']],
    ['../../utils/plan-stamp.js', ['isStampableStub']],
    ['./plan-files.js', [
      'checkbox',
      'countTasks',
      'expectOneArgument',
      'formatCounts',
      'isFile',
      'issueLine',
      'planFileName',
      'requireProject',
      'resolvePlansDir',
    ]],
  ]],
  ['./commands/plan/validate.js', [
    ['../../agents/roster.js', [
      'collidingPlanSkills',
      'missingAgentLine',
      'missingPlanAgents',
      'resolveAgentRoster',
      'skillCollisionLine',
      'unresolvedPlanSkills',
      'unresolvedSkillLine',
    ]],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../plan/index.js', ['parsePlan']],
    ['../../plan/store-rules.js', ['storeRuleLine']],
    ['./plan-files.js', ['countTasks', 'expectOneArgument', 'formatCounts', 'isFile', 'issueLine', 'plural']],
    ['./store-check.js', ['checkStoreRules']],
  ]],
  ['./commands/plan/risk.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../plan/risk.js', ['assessPlanRisk', 'renderRiskText']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../../start/plan-path.js', ['DEFAULT_PLAN_FILE', 'resolvePlanPath']],
    ['./plan-files.js', ['expectAtMostOneArgument', 'isFile', 'plural', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
  ]],
  ['./commands/plan/needs.js', [
    ['../../check/references.js', ['pathDirectories']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../modules/load.js', ['loadModules', 'moduleSettings']],
    ['../../plan/needs.js', ['isUnmet', 'readPlanNeeds', 'readSpecNeeds']],
    ['../../start/plan-path.js', ['DEFAULT_PLAN_FILE', 'resolvePlanPath']],
    ['../skill/list.js', ['isSourceShape']],
    ['./plan-files.js', ['expectAtMostOneArgument', 'isFile', 'plural', 'readSwitch', 'requireProject']],
    ['./spec-route.js', ['resolveCreateSpec']],
  ]],
  ['./commands/loop/start.js', [
    ['../../next/ending.js', ['endingWith', 'HINT_FLAG_SPEC']],
    ['../../start/pr-lifecycle.js', ['DEFAULT_CI_ATTEMPTS', 'DEFAULT_CI_TIMEOUT_MIN']],
    ['../../start/runtime.js', ['refuseMisplacedRuntime']],
    ['../../start.js', ['default']],
    ['../wrap.js', ['wrapPhaseZeroCommand']],
  ]],
  ['./commands/loop/stop.js', [
    ['../../config-sections.js', ['messageOf']],
    ['../../loop/sessions.js', ['errorCode', 'readSession', 'SessionRecordError']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./loop-sessions.js', ['checkboxAt', 'isLive', 'pickSession', 'planLabel', 'readSessionChecklist', 'refusal', 'resolveLoopSeams', 'sessionIdFlag']],
  ]],
  ['./commands/loop/pause.js', [
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./loop-sessions.js', ['isLive', 'pickSession', 'refusal', 'resolveLoopSeams', 'sessionIdFlag', 'writeSession']],
  ]],
  ['./commands/loop/resume.js', [
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./loop-sessions.js', ['isLive', 'pickSession', 'refusal', 'resolveLoopSeams', 'sessionIdFlag', 'writeSession']],
  ]],
  ['./commands/loop/status.js', [
    ['../../config-sections.js', ['messageOf']],
    ['../../loop/sessions.js', ['sessionPhase']],
    ['../../utils/tracker.js', ['splitBlockerComment']],
    ['../plan/plan-files.js', ['countTasks', 'expectNoArgument']],
    ['./loop-sessions.js', [
      'estimateEta',
      'etaLine',
      'isLive',
      'phasedCounts',
      'phaseNote',
      'pickSession',
      'readSessionChecklist',
      'readSessionFinishes',
      'resolveLoopSeams',
      'sessionIdFlag',
      'sessionLine',
    ]],
  ]],
  ['./commands/loop/list.js', [
    ['../../loop/sessions.js', ['sessionPhase']],
    ['../plan/plan-files.js', ['countTasks', 'expectNoArgument']],
    ['./loop-sessions.js', [
      'isLive',
      'phasedCounts',
      'phaseNote',
      'projectRoot',
      'readRecords',
      'readSessionChecklist',
      'resolveLoopSeams',
      'sessionLine',
    ]],
  ]],
  ['./commands/loop/wait.js', [
    ['../../adapters/output/events.js', ['EVENT_PREFIX', 'oneLine', 'padKind']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../loop/awake-clock.js', ['createAwakeClock']],
    ['../../loop/events-file.js', ['eventsFileOf', 'readEventsFrom']],
    ['../../loop/sessions.js', ['readSession', 'SessionRecordError']],
    ['../../loop/wait-reasons.js', [
      'DEFAULT_WAIT_UNTIL',
      'matchEvent',
      'matchQuiet',
      'matchRecord',
      'parseWaitUntil',
      'WAIT_NO_SESSION_EXIT',
      'WAIT_REASONS',
      'WAIT_TIMEOUT_EXIT',
      'waitExitCode',
      'WaitUntilError',
    ]],
    ['../plan/plan-files.js', ['expectNoArgument', 'plural']],
    ['./loop-sessions.js', ['lineRefusal', 'NoSessionRefusal', 'pickSession', 'refusal', 'resolveLoopSeams', 'sessionIdFlag']],
  ]],
  ['./commands/issue/list.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../adapters/tracker/issue-values.js', ['ISSUE_STATES', 'ISSUE_TYPES']],
    ['../../board/board-cache.js', ['createCachedBoardListing']],
    ['../../board/boards.js', ['createGhBoardLister']],
    ['../../board/configured-relations.js', ['readConfiguredRelations']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../board/roadmap-board.js', ['createGhBoardListing', 'keepListing']],
    ['../../board/roadmap-epic-rows.js', ['hasEpicLines', 'readRoadmapEpicRows']],
    ['../../board/roadmap-rows.js', ['createPlanDirNames']],
    ['../../board/roadmap.js', ['createGhOpenPullRequests', 'createGhRoadmapSearch', 'ROADMAP_REFUSAL_EXIT']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../doctor-refs.js', ['readDoctorRefs', 'roadmapRefsCells']],
    ['../plan/plan-files.js', ['expectNoArgument', 'plansDirAt', 'readSwitch']],
    ['./issue-tracker.js', [
      'DEFAULT_ISSUE_SEAMS',
      'issueProject',
      'issueSubjectConfig',
      'keepsBoard',
      'lineRefusal',
      'onTracker',
      'readChoiceFlag',
      'readNonBlankFlag',
      'readTextFlag',
      'resolveIssueTracker',
    ]],
    ['./roadmap-check.js', ['EPIC_CHECK_EXIT', 'epicCheckFailure']],
    ['./roadmap-epic-table.js', ['renderEpicTable']],
    ['./roadmap-table.js', ['renderRoadmapTable']],
  ]],
  ['./commands/issue/show.js', [
    ['../plan/plan-files.js', ['expectOneArgument']],
    ['./issue-tracker.js', ['DEFAULT_ISSUE_SEAMS', 'issueRef', 'onTracker', 'resolveIssueTracker', 'urlLines']],
  ]],
  ['./commands/issue/create.js', [
    ['../../adapters/tracker/issue-values.js', ['ISSUE_PRIORITIES', 'ISSUE_TYPES']],
    ['../../config-sections.js', ['messageOf']],
    ['../../triage/triage.js', ['TRIAGE_MODULE']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./create-blocked.js', ['readSpecLine', 'settleSpecLine']],
    ['./issue-tracker.js', [
      'DEFAULT_ISSUE_SEAMS',
      'issueName',
      'lineRefusal',
      'onTracker',
      'readChoiceFlag',
      'readNonBlankFlag',
      'readRequiredFlag',
      'readTextFlag',
      'resolveIssueTracker',
      'urlLines',
    ]],
  ]],
  ['./commands/issue/comment.js', [
    ['../plan/plan-files.js', ['expectOneArgument']],
    ['./issue-tracker.js', ['DEFAULT_ISSUE_SEAMS', 'issueName', 'issueRef', 'onTracker', 'readRequiredFlag', 'resolveIssueTracker']],
  ]],
  ['./commands/issue/move.js', [
    ['../../adapters/tracker/issue-values.js', ['ISSUE_STATES']],
    ['./issue-tracker.js', ['DEFAULT_ISSUE_SEAMS', 'expectTwoArguments', 'issueName', 'issueRef', 'onTracker', 'readChoice', 'resolveIssueTracker']],
  ]],
  ['./commands/issue/ready.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner', 'moduleOfLabels', 'typeOfLabels']],
    ['../../board/epic-problems.js', ['epicProblemMessage', 'readEpicProblems']],
    ['../../board/gate.js', ['SPEC_NEEDS_WORK_LABEL']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../board/plan-spec.js', ['boardRepoLabel', 'issueSource']],
    ['../../board/readiness.js', ['hasSpecReadyLabel', 'READINESS_REFUSAL_EXIT', 'requireCompleteSpec', 'SPEC_READY_LABEL']],
    ['../../board/trust.js', ['ghBoardTrust', 'requireTrustedBoardAuthor']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../../config-sections.js', ['messageOf']],
    ['../../next/ending.js', ['endWithNextStep', 'HINT_FLAG_SPEC']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../../start/branch-decision.js', ['answeredYes']],
    ['./issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
  ]],
  ['./commands/issue/unblock.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/blocked.js', ['blockedFaultMessage', 'hasSpecBlockedLabel', 'readBlockedBy', 'SPEC_BLOCKED_LABEL']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../../config-sections.js', ['describeValue', 'isMapping', 'messageOf']],
    ['../doctor-blocked.js', ['BLOCKED_LIST_LIMIT', 'KNOWN_LIST_LIMIT']],
    ['../plan/plan-files.js', ['plural']],
    ['./issue-tracker.js', ['issueProject', 'lineRefusal']],
    ['./unblock-native.js', ['nativeUnblockReport', 'NATIVE_UNBLOCK_LINE', 'unblockRelationshipsMode']],
  ]],
  ['./commands/issue/check.js', [
    ['../../board/naming.js', ['boardId', 'notesFileName', 'SPEC_EXTENSION']],
    ['../../board/refs-gate.js', ['memoiseVerifier']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../refs/reading.js', ['readCopyRefs', 'readRefsText', 'restampCopyRefs']],
    ['../../refs/stamp.js', ['fingerprintText', 'RefsBlockError']],
    ['../../refs/verify.js', ['RefVerifyError']],
    ['../plan/plan-files.js', ['readSwitch']],
    ['../plan/refs-check.js', ['createPlanRefsVerifier']],
    ['./issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
  ]],
  ['./commands/pr/current.js', [
    ['../../config-sections.js', ['messageOf']],
    ['./pr-context.js', ['DEFAULT_PR_SEAMS', 'expectNoArguments', 'openPrContext', 'pickPullRequest', 'PR_USAGE']],
  ]],
  ['./commands/pr/show.js', [
    ['../../board/roadmap.js', ['closedIssuesIn']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/index.js', ['formatRows']],
    ['./current.js', ['SEPARATOR']],
    ['./last-triage.js', ['readLastTriage']],
    ['./pr-context.js', ['DEFAULT_PR_SEAMS', 'lineRefusal', 'onProvider', 'openPrContext', 'pickPullRequest', 'PR_USAGE', 'readPullArgument']],
  ]],
  ['./commands/pr/view.js', [
    ['./current.js', ['SEPARATOR']],
    ['./pr-context.js', ['DEFAULT_PR_SEAMS', 'onProvider', 'openPrContext', 'pickPullRequest', 'PR_USAGE', 'readPullArgument']],
  ]],
  ['./commands/pr/list.js', [
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/index.js', ['createGitRunner']],
    ['../../release/enabled.js', ['resolveReleaseEnabled']],
    ['./current.js', ['SEPARATOR']],
    ['./list-forecast.js', ['createBaseReader', 'forecastCell', 'forecastLine', 'listForecast']],
    ['./pr-context.js', ['DEFAULT_PR_SEAMS', 'expectNoArguments', 'onProvider', 'openPrContext', 'PR_USAGE']],
  ]],
  ['./commands/pr/wait.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../next/ending.js', ['endWithNextStep', 'HINT_FLAG_SPEC']],
    ['../../pr/index.js', ['failingRows', 'formatRows', 'waitForChecks']],
    ['../../start/pr-lifecycle.js', ['CI_POLL_INTERVAL_MS', 'DEFAULT_CI_TIMEOUT_MIN']],
    ['./current.js', ['SEPARATOR']],
    ['./pr-context.js', ['lineRefusal', 'onProvider', 'openPrContext', 'pickPullRequest', 'PR_USAGE', 'readPullArgument']],
  ]],
  ['./commands/pr/merge.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/roadmap-tick.js', ['tickSentence']],
    ['../../board/roadmap.js', ['closedIssuesIn']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../../effort/store/plan-ci.js', ['recordPlanCi']],
    ['../../next/ending.js', ['endWithNextStep', 'HINT_FLAG_SPEC']],
    ['../../pr/index.js', [
      'createGitRunner',
      'isMergeMethod',
      'MERGE_METHODS',
    ]],
    ['./merge-cleanup.js', ['cleanUpAfterMerge', 'INDENT', 'reportFollowUps']],
    ['./merge-freed.js', ['freedAfterMerge']],
    ['./merge-guard.js', ['guardBeforeMerge']],
    ['./merge-refuse.js', ['refuseFromGit']],
    ['./merge-tick.js', ['epicTickSentence', 'noBoardListsLine', 'tickRoadmapAfterMerge']],
    ['./merge-unblock.js', ['unblockAfterMerge']],
    ['./merge-unchecked.js', ['confirmUncheckedMerge', 'postUncheckedComment', 'readUncheckedMerge']],
    ['./pr-context.js', [
      'lineRefusal',
      'onProvider',
      'openPrContext',
      'pickPullRequest',
      'PR_USAGE',
      'readBooleanFlag',
      'readPullArgument',
    ]],
  ]],
  ['./commands/pr/triage.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../effort/store/plan-ci.js', ['recordPlanCi']],
    ['../../next/ending.js', ['endWithNextStep', 'HINT_FLAG_SPEC']],
    ['../../pr/index.js', ['createGitRunner']],
    ['../../pr/triage/classify.js', ['classifyTriage']],
    ['../../pr/triage/comment.js', ['triageCommentBody', 'writeTriageComment']],
    ['../../pr/triage/follow-up.js', ['buildFollowUpPrompt']],
    ['../../pr/triage/rerun.js', ['readTriageRerun']],
    ['../../pr/triage/select.js', ['selectTriagePullRequests']],
    ['./pr-context.js', [
      'lineRefusal',
      'onProvider',
      'openPrContext',
      'PR_USAGE',
      'readBooleanFlag',
      'readPullArgument',
    ]],
    ['./triage-guard.js', ['readTriageGuard']],
    ['./triage-read.js', ['readConflictFiles', 'readFailedLogs', 'readWorkflowCount']],
    ['./triage-report.js', ['evidenceOf', 'renderTriages', 'workflowCountOf']],
    ['./triage-resolve.js', ['resolvePullRequest']],
    ['./triage-trust.js', ['ghPermissionsIn', 'readTrustedTriageComment', 'repoLabel']],
  ]],
  ['./commands/effort/collect.js', [['../../effort/collect.js', ['default']], ['../wrap.js', ['wrapPhaseZeroCommand']]]],
  ['./commands/effort/report.js', [['../../effort/report.js', ['default']], ['../wrap.js', ['wrapPhaseZeroCommand']]]],
  ['./commands/effort/dashboard.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config.js', ['ConfigError']],
    ['../../effort/dashboard-format.js', ['formatDashboard']],
    ['../../effort/dashboard.js', ['readDashboard']],
    ['../../effort/report-args.js', ['parseReportArgs']],
    ['../plan/plan-files.js', ['expectNoArgument', 'requireProject']],
  ]],
  ['./commands/effort/fix-schema.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../effort/store/fix-schema.js', ['fixStoreSchema', 'SchemaFixRefusal']],
    ['../../effort/store/sqlite.js', ['sqliteStorePath']],
    ['../../loop/sessions.js', ['readSessions']],
    ['../plan/plan-files.js', ['expectNoArgument', 'readSwitch']],
  ]],
  ['./commands/effort/copy.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../effort/store/copy.js', ['copyEffortStore', 'EffortCopyFailure', 'EffortCopyRefusal']],
    ['../../effort/store/location.js', ['EFFORT_DIR_VARIABLE']],
    ['../../effort/store.js', ['EFFORT_STORE_DIR']],
    ['../plan/plan-files.js', ['expectNoArgument', 'requireProject']],
    ['./fix-schema.js', ['fileStamp']],
  ]],
  ['./commands/effort/schema.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../effort/store/location.js', ['effortStoreDir']],
    ['../../effort/store/schema-report.js', ['gateMeaning', 'readSchemaReport']],
    ['../../effort/store/sqlite.js', ['SQLITE_STORE_FILE_NAME']],
    ['../plan/plan-files.js', ['expectNoArgument', 'readSwitch', 'requireProject']],
  ]],
  ['./commands/effort/migrate.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../effort/store/development-build.js', ['DevelopmentBuildRefusedError']],
    ['../../effort/store/location.js', ['effortStoreDir']],
    ['../../effort/store/migrate.js', ['migrateStore', 'MigrateRefusal']],
    ['../../effort/store/sqlite.js', ['SQLITE_STORE_FILE_NAME']],
    ['../plan/plan-files.js', ['expectNoArgument', 'readSwitch', 'requireProject']],
    ['./fix-schema.js', ['fileStamp', 'keepsIdLine']],
  ]],
  ['./commands/effort/merge.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../effort/store/development-build.js', ['DevelopmentBuildRefusedError']],
    ['../../effort/store/location.js', ['effortStoreDir']],
    ['../../effort/store/merge-store.js', ['MergeRefusal', 'mergeStore']],
    ['../../effort/store/merge-union.js', ['UnionSchemaMismatch']],
    ['../../effort/store/rebuild-aside.js', ['RebuildRefusal']],
    ['../../effort/store/sqlite.js', ['SQLITE_STORE_FILE_NAME']],
    ['../plan/plan-files.js', ['expectOneArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['./fix-schema.js', ['fileStamp', 'keepsIdLine']],
  ]],
  ['./commands/effort/import.js', [
    ['../../effort/sync/file.js', ['createFileSync']],
    ['../plan/plan-files.js', ['expectOneArgument', 'readSwitch', 'requireProject', 'resolveProjectConfig']],
    ['./merge.js', ['mergeRefusalExit', 'mergeTargetPath', 'renderMerge']],
  ]],
  ['./commands/effort/move.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../effort/store/bring-forward.js', ['SchemaRefusedError']],
    ['../../effort/store/development-build.js', ['DevelopmentBuildRefusedError']],
    ['../../effort/store/location.js', ['effortStoreDir']],
    ['../../effort/store/merge-store.js', ['MOVE_TO_SQLITE']],
    ['../../effort/store/move.js', ['MOVE_TARGET', 'MoveRefusal', 'moveToSqlite']],
    ['../plan/plan-files.js', ['expectNoArgument', 'requireProject', 'resolveProjectConfig']],
  ]],
  ['./commands/module/list.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../modules/load.js', ['loadModules', 'moduleSettings']],
    ['../plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/module/exec.js', [['../../cli/command.js', ['CommandExit']], ['../../cli/registry.js', ['mountKey']]]],
  ['./commands/agent/vendor.js', [
    ['../../agents/roster.js', ['readAgentDirectory']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../inventory/trees.js', ['bundledAgentsDirectory']],
    ['../../utils/agent-definition.js', ['AGENT_DEFINITION_DIR', 'readFrontmatter']],
  ]],
  ['./commands/agent/list.js', [
    ['../../agents/roster.js', ['VENDOR_COMMAND']],
    ['../../check/references.js', ['pathDirectories']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../inventory/index.js', ['buildInventory']],
    ['../../modules/load.js', ['loadModules', 'moduleSettings']],
    ['../../schema/tiers.js', ['SKILL_TIERS']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['../skill/list.js', [
      'browseListing',
      'HIDDEN_MARK',
      'interactiveFlag',
      'interactiveTerminal',
      'isSourceShape',
      'knownSources',
      'matchesFilters',
      'skillRowLines',
      'STATE_FILTERS',
      'VISIBLE_MARK',
      'warningLines',
    ]],
  ]],
  ['./commands/agent/show.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../inventory/show.js', ['findShown', 'readShowView', 'renderShowView']],
    ['../plan/plan-files.js', ['expectOneArgument', 'readSwitch']],
    ['../skill/list.js', ['projectInventory', 'warningLines']],
    ['./list.js', ['DEFAULT_AGENT_LIST_SEAMS']],
  ]],
  ['./commands/agent/search.js', [['../skill/search.js', ['createSearchCommand', 'DEFAULT_SEARCH_SEAMS']]]],
  ['./commands/skill/check.js', [
    ['../check-report.js', ['checkCommandRun', 'DEFAULT_CHECK_SEAMS', 'SKILL_CHECK_USAGE']],
  ]],
  ['./commands/skill/list.js', [
    ['../../check/references.js', ['pathDirectories']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/terminal.js', ['processTerminal', 'refuseWithoutTerminal']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../inventory/browse.js', ['browse']],
    ['../../inventory/index.js', ['buildInventory']],
    ['../../modules/load.js', ['loadModules', 'moduleSettings']],
    ['../../schema/tiers.js', ['isSkillTier', 'SKILL_TIERS']],
    ['../plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/skill/show.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../inventory/show.js', ['findShown', 'readShowView', 'renderShowView']],
    ['../plan/plan-files.js', ['expectOneArgument', 'readSwitch']],
    ['./list.js', ['DEFAULT_SKILL_LIST_SEAMS', 'projectInventory', 'warningLines']],
  ]],
  ['./commands/skill/search.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../effort/store/index.js', ['selectEffortStore']],
    ['../../inventory/search/index.js', ['droppedLine', 'rankSearch', 'runSearch']],
    ['../plan/plan-files.js', ['expectOneArgument', 'readSwitch']],
    ['./list.js', ['DEFAULT_SKILL_LIST_SEAMS', 'projectInventory', 'warningLines']],
  ]],
  ['./commands/skill/demote.js', [
    ['../../check/references.js', ['pathDirectories']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../demote/apply.js', ['applyDemotion', 'DEMOTION_ACTION_KINDS', 'planDemotion']],
    ['../../demote/classify.js', ['DEMOTION_VERDICTS']],
    ['../../demote/draft.js', ['buildDemotionReport']],
    ['../../demote/report.js', ['countVerdicts', 'parseDemotionReport', 'REVIEWED_STATUS', 'writeDemotionReport']],
    ['../../demote/select.js', ['resolveDemotionScope', 'selectSources']],
  ]],
  ['./commands/skill/backfill.js', [
    ['../../backfill/backup.js', ['backupDirectory', 'backupFiles', 'countBackups']],
    ['../../backfill/derive.js', ['applyDerivation', 'countDerivations', 'DERIVATION_KINDS', 'planDerivation']],
    ['../../backfill/proposal-batch.js', ['selectProposals']],
    ['../../backfill/proposal-file.js', ['ANSWERED_ROW', 'BACKFILL_PATH', 'readProposalFiles', 'REVIEWED_FILE']],
    ['../../backfill/propose.js', ['applyProposals', 'PROPOSAL_ACTION_KINDS', 'runProposalPass']],
    ['../../check/references.js', ['pathDirectories']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../demote/select.js', ['resolveDemotionScope']],
  ]],
  ['./commands/instinct/check.js', [
    ['../check-report.js', ['checkCommandRun', 'DEFAULT_CHECK_SEAMS', 'INSTINCT_CHECK_USAGE']],
  ]],
  ['./commands/instinct/list.js', [
    ['../../adapters/learning/held.js', ['toHeldRecords']],
    ['../../adapters/registry.js', ['CORE_ADAPTER_REGISTRY']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../learning/index.js', ['triggerKey']],
    ['../plan/plan-files.js', ['expectNoArgument', 'resolveProjectConfig']],
    ['./instinct-records.js', ['allRecords', 'instinctProject', 'readScopes']],
    ['./promote.js', ['makeLearningAdapter', 'refusedPullMessage']],
  ]],
  ['./commands/instinct/show.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../schema/instinct.js', ['ACTION_HEADING', 'CAUSE_HEADING']],
    ['../plan/plan-files.js', ['expectOneArgument']],
    ['./instinct-records.js', ['findRecords', 'instinctProject', 'readScopes']],
  ]],
  ['./commands/instinct/flag.js', [
    ['../../adapters/registry.js', ['CORE_ADAPTER_REGISTRY']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../issue/issue-tracker.js', ['expectTwoArguments']],
    ['../plan/plan-files.js', ['requireProject', 'resolveProjectConfig']],
  ]],
  ['./commands/instinct/promote.js', [
    ['../../adapters/registry.js', ['CORE_ADAPTER_REGISTRY']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../learning/index.js', ['promotable']],
    ['../plan/plan-files.js', ['expectNoArgument', 'requireProject', 'resolveProjectConfig']],
  ]],
  ['./commands/release/status.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config-sections.js', ['messageOf']],
    ['../../config.js', ['ConfigError']],
    ['../../effort/attribution.js', ['planStubsFromFileNames', 'resolvePlanStub']],
    ['../../effort/store/changes.js', ['readPlanChanges']],
    ['../../pr/index.js', ['createGitRunner', 'gitSaid']],
    ['../../release/audit.js', ['auditCell', 'auditLines', 'readAudit']],
    ['../../release/changelog.js', ['groupChangeNotes', 'renderNoteLines']],
    ['../../release/level.js', ['highestChangeLevel']],
    ['../../release/version.js', ['parseSemanticVersion', 'readManifestVersion']],
    ['./status-fragments.js', ['readWaiting', 'waitingCell', 'waitingLines', 'waitingSettingsOf']],
  ]],
  ['./commands/release/settle.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../pr/index.js', ['createGitRunner', 'ghPullRequestsIn', 'requireGhProvider', 'resolvePrProvider']],
    ['../../release/settle-pr.js', ['settleByPr']],
    ['../../release/settle-push.js', ['settleByPush']],
    ['../../release/settle-tag.js', ['tagSettle']],
    ['../../release/settle-worktree.js', ['withSettleWorktree']],
    ['../../release/settle.js', ['readSettle', 'releaseCommitSubject']],
    ['../../release/version.js', ['RELEASE_BASE_BRANCH', 'RELEASE_REMOTE']],
    ['../plan/plan-files.js', ['expectNoArgument', 'readSwitch', 'resolveProjectConfig']],
  ]],
  ['./commands/release/tag.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../pr/index.js', ['createGitRunner', 'gitSaid']],
    ['../../release/receipt.js', ['readReceiptVerdict', 'receiptProblem']],
    ['../../release/version.js', ['readManifestVersion']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['../pr/merge-followups.js', ['versionTag']],
    ['./release-commit.js', ['readReleaseCommit']],
    ['./status.js', ['changelogVersions', 'DEFAULT_RELEASE_SEAMS', 'readTags']],
  ]],
  ['./commands/board/list.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/board-body.js', ['readBoardBody']],
    ['../../board/epic-board.js', ['openBoards']],
    ['../../board/owner-resolve.js', ['createOwnerResolver']],
    ['../../board/place.js', ['resolvePlace']],
    ['../../board/roadmap-board.js', ['createGhBoardListing']],
    ['../../board/setup.js', ['ROADMAP_LABEL']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../issue/issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
    ['../switch.js', ['defaultBoardOnce']],
  ]],
  ['./commands/epic/show.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/boards.js', ['createGhBoardLister', 'resolveDefaultBoard']],
    ['../../board/epic-cancel-notice.js', ['cancelledEpicNoticeLines']],
    ['../../board/epic-problems.js', ['epicProblemMessage']],
    ['../../board/epic-walk.js', ['epicLines', 'isNowEpic']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../board/roadmap-epic-rows.js', ['claimsOf', 'onceSeams', 'readListedEpics', 'readModeEpicProblems']],
    ['../../board/roadmap-rows.js', ['createPlanDirNames', 'readCurrentPlace', 'readLineRows']],
    ['../../board/roadmap.js', ['createGhOpenPullRequests', 'createGhRoadmapSearch', 'parseRoadmapBody', 'ROADMAP_REFUSAL_EXIT']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../doctor-refs.js', ['readDoctorRefs', 'roadmapRefsCells']],
    ['../issue/issue-tracker.js', ['DEFAULT_ISSUE_SEAMS', 'issueProject', 'issueSubjectConfig', 'lineRefusal']],
    ['../issue/list.js', ['roadmapBoard']],
    ['../issue/roadmap-epic-table.js', ['unknownLine']],
    ['../issue/roadmap-table.js', ['renderRoadmapTable']],
    ['../plan/plan-files.js', ['plansDirAt', 'readSwitch']],
  ]],
  ['./commands/epic/new.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/epic-checklist.js', ['appendLine', 'editChecklist']],
    ['../../board/epic-context.js', ['EPIC_TYPE_LABEL']],
    ['../../board/epic-problems.js', ['HORIZON_LABEL_PREFIX']],
    ['../../board/epic-template.js', ['renderEpicBody']],
    ['../../board/epics.js', ['EPIC_LABEL_PREFIX']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/place.js', ['resolvePlace']],
    ['../../board/roadmap-board.js', ['createGhBoardListing']],
    ['../../board/roadmap-epic-rows.js', ['HORIZONS']],
    ['../../board/roadmap-tick.js', ['createGhRoadmapBody']],
    ['../../board/setup.js', ['LABEL_LIST_LIMIT', 'listBoardLabels']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../issue/issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal', 'readChoiceFlag', 'readRequiredFlag']],
    ['../switch.js', ['defaultBoardOnce']],
    ['./move-native.js', ['NATIVE_MODE']],
  ]],
  ['./commands/epic/defer.js', [
    ['../../board/epic-trail.js', ['REASON_FLAG']],
    ['./horizon-change.js', ['DEFER_ACTION', 'runEpicHorizon', 'TO_FLAG']],
  ]],
  ['./commands/epic/promote.js', [
    ['../../board/epic-trail.js', ['REASON_FLAG']],
    ['./horizon-change.js', ['PROMOTE_ACTION', 'runEpicHorizon', 'TO_FLAG']],
  ]],
  ['./commands/epic/move.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/epic-horizon.js', ['branchNameOf']],
    ['../../board/epic-trail.js', ['blankReasonMessage', 'REASON_FLAG', 'readReason', 'renderMoveComment', 'unaskedReasonMessage']],
    ['../../board/epics.js', ['EPIC_LABEL_PREFIX', 'epicSlugsOf']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/roadmap-board.js', ['createGhBoardListing']],
    ['../../board/roadmap.js', ['branchClaims', 'closedIssuesIn', 'createGhOpenPullRequests', 'parseRoadmapBody', 'scanClaimBranches']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../issue/issue-tracker.js', ['issueProject', 'lineRefusal', 'readTextFlag']],
    ['./horizon-change.js', ['TO_FLAG', 'workPhrase']],
    ['./move-native.js', [
      'configuredMoveRelations',
      'NATIVE_MODE',
      'NATIVE_RETRY_HINT',
      'nativeAlreadyMessage',
      'nativeEpicLeft',
      'nativeParentLine',
      'readBoardRepository',
    ]],
  ]],
  ['./commands/epic/close.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../adapters/tracker/resolve.js', ['resolveTracker']],
    ['../../board/epic-body.js', ['readEpicBody']],
    ['../../board/epic-template.js', ['PLACEHOLDER_REASON']],
    ['../../board/epic-trail.js', ['renderCloseComment']],
    ['../../board/epics.js', ['EPIC_LABEL_PREFIX', 'epicSlugsOf', 'groupByEpicLabel']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/relations/labels.js', ['LABELS_READS']],
    ['../../board/roadmap-board.js', ['createGhBoardListing']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../effort/epic-cost.js', ['readEpicCost', 'renderEpicCost']],
    ['../../effort/store/index.js', ['selectEffortStore']],
    ['../../epic/verify-plan.js', ['buildVerifyPrompt', 'criteriaToAsk', 'parseVerifyPlan', 'readVerifyPrompt', 'splitCriteria']],
    ['../../epic/verify-run.js', ['runVerification']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../../start/dispatch.js', ['SESSION_ID_FLAG']],
    ['../../start/triage.js', ['unresolvedTracker']],
    ['../../triage/triage.js', ['namedSecrets', 'triageReport']],
    ['../../utils/claude.js', ['claudeArgs', 'spawnClaudeCaptured']],
    ['../issue/issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
    ['../plan/plan-files.js', ['readSwitch']],
  ]],
  ['./commands/epic/cancel.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/blocked.js', ['SPEC_BLOCKED_LABEL']],
    ['../../board/epic-checklist.js', ['editChecklist']],
    ['../../board/epic-dependents.js', ['readEpicDependents']],
    ['../../board/epic-trail.js', ['cancelMoveReason', 'REASON_FLAG', 'renderCancelComment', 'renderDependentComment', 'renderUnblockNote']],
    ['../../board/epics.js', ['isNotPlanned', 'localDay']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/relations/labels.js', ['createLabelsRelations', 'LABELS_READS']],
    ['../../board/roadmap-board.js', ['createGhBoardListing']],
    ['../../board/roadmap-tick.js', ['createGhRoadmapBody']],
    ['../../board/roadmap.js', ['createGhOpenPullRequests']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../issue/issue-tracker.js', ['issueProject', 'lineRefusal', 'readTextFlag']],
    ['./cancel-unblock.js', ['keptLinksLine', 'readUnblockStill']],
    ['./move.js', ['applyEpicMove', 'readEpicMove']],
  ]],
  ['./commands/claim/release.js', [
    ['../../claims/git.js', ['claimBranchIssue', 'fetchClaimBranches', 'makeOwnershipCommit', 'pushOwnershipCommit', 'readClaimBranch']],
    ['../../claims/labels.js', ['unlabelReleased']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/index.js', ['gitSaid']],
    ['../../start/branch-decision.js', ['BRANCH_PREFIX', 'REMOTE']],
    ['../../start/preflight-claim.js', ['createStartPreflightClaim']],
    ['../plan/plan-files.js', ['expectOneArgument', 'requireProject', 'resolveProjectConfig']],
  ]],
  ['./commands/claim/hand.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../start/branch-decision.js', ['REMOTE']],
    ['../../start/preflight-claim.js', ['createStartPreflightClaim']],
    ['../plan/plan-files.js', ['requireProject', 'resolveProjectConfig']],
    ['./release.js', ['findOwnedBranch', 'pushOnClaimTip', 'readClaimStoreId', 'readIssueArgument', 'readIssueBranches']],
  ]],
  ['./commands/claim/accept.js', [
    ['../../claims/record.js', ['parseClaimMessage']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../start/branch-decision.js', ['REMOTE']],
    ['../../start/preflight-claim.js', ['createStartPreflightClaim']],
    ['../plan/plan-files.js', ['requireProject', 'resolveProjectConfig']],
    ['./release.js', ['pushOnClaimTip', 'readClaimStoreId', 'readIssueArgument', 'readIssueBranches']],
  ]],
  ['./commands/claim/take.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../board/roadmap-claims.js', ['idleText']],
    ['../../claims/stale.js', ['readClaimState']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['CLAIMS_STALE_DISABLED', 'messageOf']],
    ['../../start/branch-decision.js', ['REMOTE']],
    ['../../start/preflight-claim.js', ['createStartPreflightClaim']],
    ['../plan/plan-files.js', ['requireProject', 'resolveProjectConfig']],
    ['./release.js', ['pushOnClaimTip', 'readClaimStoreId', 'readIssueArgument', 'readIssueBranches']],
  ]],
  ['./commands/update/current.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../../cli/version.js', ['RAFA_VERSION']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config-sections.js', ['messageOf']],
    ['../../pr/provider.js', ['resolvePrProvider']],
    ['../../project/lock.js', ['LOCK_FILE', 'readProjectLock']],
    ['../../project/scaffold.js', ['scaffoldConflicts']],
    ['../../project/update-current.js', ['applyUpdatePlan', 'planChanges', 'readUpdatePlan', 'UpdateStepError']],
    ['../../project/update-range.js', ['readCurrentRange']],
    ['../../project/worktree-root.js', ['mainCheckoutOf']],
    ['../../schema/project-id.js', ['gitRemoteUrl']],
    ['../plan/plan-files.js', ['expectNoArgument']],
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
  ['./commands/status.js', [
    ['../cli/command.js', ['CommandExit']],
    ['../effort/sync/contact.js', ['pullBeforeRead']],
    ['../status/render.js', ['renderStatus', 'statusData']],
    ['../status/sections.js', ['readStatusSections']],
    ['./plan/plan-files.js', ['resolveProjectConfig']],
  ]],
  ['./commands/next.js', [
    ['../cli/command.js', ['CommandExit']],
    ['../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../config-sections.js', ['messageOf']],
    ['../effort/sync/contact.js', ['pullBeforeRead']],
    ['../next/actions.js', ['actionInvocation', 'runAction']],
    ['../next/ceiling.js', ['ALWAYS_ASKED', 'allowedUnasked', 'BARE_YES_ACTIONS', 'readYesCeiling', 'YES_ACTIONS', 'YES_FLAG']],
    ['../next/ending.js', ['actionOutput']],
    ['../next/epic-end.js', ['epicEndLines', 'watchDryEpic']],
    ['../next/hint.js', ['commandWords', 'nextQuestion']],
    ['../next/lines.js', [
      'CLAIM_AHEAD_FLAG',
      'DRY_RUN_FLAG',
      'dryRunOf',
      'MAX_ACTIONS',
      'NEXT_USAGE',
      'proposalLine',
      'readClaimAhead',
      'readDryRun',
      'readRoadmap',
      'ROADMAP_FLAG',
      'stateLine',
      'stopLine',
    ]],
    ['../next/relations-mode.js', ['openNextRelations']],
    ['../next/settle-step.js', ['followsMerge', 'readSettleAfterMerge']],
    ['../next/sources.js', ['openNextSources']],
    ['../next/state.js', ['readHomeAfterLoop', 'readNextState']],
    ['../next/sync.js', ['fastForwardBase']],
    ['../start/branch-decision.js', ['REMOTE']],
    ['./issue/ready.js', ['lazyPrompter']],
    ['./plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/roadmap.js', [
    ['./issue/issue-tracker.js', ['DEFAULT_ISSUE_SEAMS']],
    ['./issue/list.js', ['ISSUE_LIST_FLAGS', 'runIssueList']],
  ]],
  ['./commands/switch.js', [
    ['../adapters/tracker/github.js', ['createGhRunner']],
    ['../board/boards.js', ['resolveDefaultBoard']],
    ['../board/configured-relations.js', ['readConfiguredRelations']],
    ['../board/epic-board.js', ['boardOfEpic', 'openBoards']],
    ['../board/place.js', ['resolvePlace']],
    ['../board/roadmap-board.js', ['createGhBoardListing']],
    ['../board/roadmap-epic-rows.js', ['horizonOf', 'readListedEpics']],
    ['../board/roadmap.js', ['createGhRoadmapSearch', 'parseRoadmapBody', 'scanClaimBranches']],
    ['../board/setup.js', ['ROADMAP_LABEL']],
    ['../claims/drift.js', ['checkDrift', 'driftLines']],
    ['../cli/command.js', ['CommandExit']],
    ['../config-sections.js', ['messageOf']],
    ['../pr/git.js', ['createGitRunner']],
    ['../project/position.js', ['hop', 'positionFilePath', 'rehome', 'writePositionFile']],
    ['./epic/show.js', ['firstNowEpic']],
    ['./issue/issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
  ]],
  ['./commands/init.js', [
    ['../adapters/tracker/github.js', ['createGhRunner']],
    ['../agents/vendorable.js', ['vendorableAgents', 'vendorableAgentWarnings']],
    ['../cli/command.js', ['CommandExit']],
    ['../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../config-load.js', ['loadConfig']],
    ['../config-sections.js', ['messageOf']],
    ['../config.js', ['ConfigError', 'configFilePath']],
    ['../pr/provider.js', ['resolvePrProvider']],
    ['../project/bin-path.js', ['readBinPath']],
    ['../project/gitignore.js', ['applyTracking', 'GITIGNORE_FILE', 'GitignoreError', 'TRACKING_DIGEST_FILE', 'withTrackingBlock']],
    ['../project/root-choice.js', ['candidateLines', 'firstCandidate', 'namedRoot', 'promptForRoot']],
    ['../project/roots.js', ['DISK_ROOTS_FILE_SYSTEM', 'gitToplevel', 'rootCandidates']],
    ['../project/scaffold.js', ['scaffoldConflicts', 'writeProjectScope', 'writeUserScope']],
    ['../schema/project-id.js', ['gitRemoteUrl']],
    ['./init-board.js', [
      'boardStepChanged',
      'epicGuardChanged',
      'relationsMoveChanged',
      'renderBoardStep',
      'renderEpicGuardStep',
      'renderRelationsMoveStep',
      'runBoardStep',
      'runEpicGuardStep',
      'runRelationsMoveStep',
    ]],
    ['./init-release.js', ['renderReleaseStep', 'runReleaseStep']],
  ]],
  ['./commands/doctor.js', [
    ['../cli/command.js', ['CommandExit']],
    ['../cli/version.js', ['versionLine']],
    ['../config-load.js', ['loadConfig']],
    ['../config-sections.js', ['messageOf']],
    ['../config.js', ['ConfigError']],
    ['../pr/preflight-items.js', ['ghPreflightItems']],
    ['../pr/provider.js', ['resolvePrProvider']],
    ['../preflight/first-dispatch.js', ['isFirstDispatch']],
    ['../preflight/prerequisites-md.js', ['loadPlanPrerequisites', 'malformedPrerequisiteLines', 'mergePlanPrerequisites', 'prerequisitesPathForPlan']],
    ['../preflight/run.js', ['runPreflight']],
    ['../start/plan-path.js', ['DEFAULT_PLAN_FILE', 'resolvePlanPath']],
    ['../start/risk-total.js', ['announceRiskTotal']],
    ['../utils/tracker.js', ['trackerPathFor']],
    ['./doctor-board.js', ['boardRunner', 'readDoctorBoard', 'relationsResultOf', 'renderDoctorBoard']],
    ['./doctor-cleanup.js', ['readDoctorCleanup', 'renderDoctorCleanup']],
    ['./doctor-deep.js', ['readDeep', 'renderDeep']],
    ['./doctor-description.js', ['DOCTOR_DESCRIPTION']],
    ['./doctor-effort-schema.js', ['effortSchemaRefusal', 'readDoctorEffortSchema', 'writeDoctorEffortSchema']],
    ['./doctor-effort-sync.js', ['effortSyncRefusal', 'readDoctorEffortSync', 'renderDoctorEffortSync']],
    ['./doctor-install.js', ['readInstall', 'writeInstall']],
    ['./doctor-refs.js', ['readDoctorRefs', 'renderDoctorRefs']],
    ['./doctor-release.js', ['readDoctorRelease', 'writeDoctorRelease']],
    ['./doctor-render.js', ['renderDoctor']],
    ['./doctor-tiers.js', ['checkDoctorTiers', 'renderDoctorTiers']],
    ['./plan/plan-files.js', ['isFile']],
  ]],
  ['./commands/cleanup.js', [
    ['../cleanup/index.js', ['cleanupSteps', 'defaultCleanupSeams', 'dryRunLines', 'readCleanup', 'runCleanupSteps']],
    ['../cli/command.js', ['CommandExit']],
    ['../cli/prompt/confirm.js', ['createLinePrompter']],
    ['../cli/prompt/multi-select.js', ['multiSelect']],
    ['../cli/prompt/terminal.js', ['processTerminal']],
    ['../pr/index.js', ['ghPullRequestsIn', 'resolvePrProvider']],
    ['./cleanup-render.js', ['branchRowLine', 'CLEANUP_GROUP_TITLES', 'cleanupData', 'cleanupNameWidth', 'renderCleanup', 'worktreeRowLine']],
    ['./issue/ready.js', ['lazyPrompter']],
    ['./plan/plan-files.js', ['expectNoArgument', 'readSwitch', 'resolveProjectConfig']],
  ]],
  ['./commands/self-update.js', [
    ['../cli/command.js', ['CommandExit']],
    ['../config-load.js', ['loadConfig']],
    ['../config-schema.js', ['SETTINGS']],
    ['../config-sections.js', ['messageOf']],
    ['../loop/sessions.js', ['isPidAlive', 'readSessions']],
    ['../project/bin-path.js', ['readBinPath']],
    ['../runtime/install.js', ['exitCodeFor', 'installRuntime', 'outcomeProblem', 'runBuild']],
    ['./plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/describe.js', [['../../package.json', ['version']], ['../cli/describe.js', ['describeRegistry']]]],
];

/**
 * A static relative import, possibly spanning lines, type-only or not.
 * Its clause holds no `;`, so a match never runs on from an import of a
 * bare module above it, such as `node:fs`, to the next relative one.
 */
const IMPORT_PATTERN = /^import\s+(type\s+)?([^;]+?)\s+from\s+'(\.\.?\/[^']+)';$/gm;

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
    .map((match) => [match[3] ?? '', bindingsOf(match[2] ?? '')]);
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
});

describe('what the CLI reaches, through the entry', () => {
  it('reads the imports src/rafa.ts takes as the ones spelled here', () => {
    expect(readImports(CLI_PATH)).toEqual(spelled(CLI_IMPORTS));
  });

  it.each(COMMAND_MODULES)('reads the imports %s takes as the ones spelled here', (path, imports) => {
    expect(readImports(join(SRC_DIR, path))).toEqual(spelled(imports));
  });

  it('dispatches through a registry holding exactly the commands of the modules spelled here', async () => {
    const { CORE_REGISTRY: registry } = await import(join(SRC_DIR, 'commands', 'index.js')) as {
      CORE_REGISTRY: { commands: (options: { includeHidden: boolean }) => readonly unknown[] };
    };
    const spelledCommands: unknown[] = [];
    for (const [path] of COMMAND_MODULES) {
      const module = await import(join(SRC_DIR, path)) as { default: unknown };
      spelledCommands.push(module.default);
    }

    expect(spelledCommands.filter((command) => command === undefined)).toEqual([]);
    expect(registry.commands({ includeHidden: true }).map((command) => spelledCommands.indexOf(command)))
      .toEqual(COMMAND_MODULES.map((_module, index) => index));
  });

  it('reaches the phase 0 command each wrapping core command module runs, its one default import, as a root export', async () => {
    const rootValues = new Set<unknown>(Object.values(entry));
    const wrapping = COMMAND_MODULES.filter(([, imports]) => imports.some(([, names]) => names.includes('wrapPhaseZeroCommand')));
    const defaultImports: number[] = [];
    const unreached: string[] = [];

    for (const [path] of wrapping) {
      const modulePath = join(SRC_DIR, path);
      const runs = readImports(modulePath).filter(([, names]) => names.includes('default'));
      defaultImports.push(runs.length);
      for (const [from] of runs) {
        const module = await import(join(modulePath, '..', from)) as { default: unknown };
        if (!rootValues.has(module.default)) unreached.push(`the default of ${from}, run by ${path}`);
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
      './commands/issue/list.js',
      './commands/issue/show.js',
      './commands/issue/create.js',
      './commands/issue/comment.js',
      './commands/issue/move.js',
      './commands/issue/ready.js',
      './commands/issue/unblock.js',
      './commands/issue/check.js',
      './commands/pr/current.js',
      './commands/pr/show.js',
      './commands/pr/view.js',
      './commands/pr/list.js',
      './commands/pr/wait.js',
      './commands/pr/merge.js',
      './commands/pr/triage.js',
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
      './commands/release/status.js',
      './commands/release/settle.js',
      './commands/release/tag.js',
      './commands/board/list.js',
      './commands/epic/show.js',
      './commands/epic/new.js',
      './commands/epic/defer.js',
      './commands/epic/promote.js',
      './commands/epic/move.js',
      './commands/epic/close.js',
      './commands/epic/cancel.js',
      './commands/claim/release.js',
      './commands/claim/hand.js',
      './commands/claim/accept.js',
      './commands/claim/take.js',
      './commands/update/current.js',
      './commands/update/self.js',
      './commands/update/project.js',
      './commands/update/rafa.js',
      './commands/update/port.js',
      './commands/update/board.js',
      './commands/update/next.js',
      './commands/update/latest.js',
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
    expect(defaultImports).toEqual(wrapping.map(() => 1));
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
