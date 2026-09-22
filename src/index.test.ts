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
 * dispatcher, the help renderer, the core registry and the module loader
 * alone, and that
 * registry is held to
 * hold exactly the commands of the core command modules spelled here, so
 * a command registered and not spelled goes red. Each of those modules
 * wrapping a phase 0 command takes it as its one default import, and
 * that binding is held to be a root export's value, so a command the
 * terminal runs and a service cannot import goes red. `describe`, `init`,
 * `doctor`, `self-update`, the three plan readers, `plan list`, `plan show` and
 * `plan validate`, the five `loop` session actions, `loop stop`,
 * `loop pause`, `loop resume`, `loop status` and `loop list`, the five
 * `issue` actions, and `module list` and `module exec` are held to be the
 * modules wrapping none. `describe` runs the roster builder
 * of `src/cli/describe.ts`, which is no root export, and each plan reader
 * imports `parsePlan` from the `./plan` entry, which is one. A binding a module
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
import { loadConfig, readConfigFile } from './config-load.js';
import * as configLoadModule from './config-load.js';
import {
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
import usage from './usage.js';

import * as entry from './index.js';

/** The runtime names the entry exposes, sorted as `sort` sorts them. */
const RUNTIME_EXPORTS = [
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
  'ScopeError',
  'configFilePath',
  'createAdapterRegistry',
  'effortCollectCommand',
  'effortReportCommand',
  'initHint',
  'isRafaBlockKind',
  'loadConfig',
  'loadPlanPrerequisites',
  'mergePlanPrerequisites',
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
  'usageCommand',
  'validateManifest',
];

/** Each runtime name, the entry's value for it, and its module's own. */
const REEXPORTS: readonly (readonly [string, unknown, unknown])[] = [
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
  ['ScopeError', entry.ScopeError, ScopeError],
  ['configFilePath', entry.configFilePath, configFilePath],
  ['createAdapterRegistry', entry.createAdapterRegistry, createAdapterRegistry],
  ['effortCollectCommand', entry.effortCollectCommand, effortCollect],
  ['effortReportCommand', entry.effortReportCommand, effortReport],
  ['initHint', entry.initHint, initHint],
  ['isRafaBlockKind', entry.isRafaBlockKind, isRafaBlockKind],
  ['loadConfig', entry.loadConfig, loadConfig],
  ['loadPlanPrerequisites', entry.loadPlanPrerequisites, loadPlanPrerequisites],
  ['mergePlanPrerequisites', entry.mergePlanPrerequisites, mergePlanPrerequisites],
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
  ['usageCommand', entry.usageCommand, usage],
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
    ['../../agents/roster.js', ['missingAgentLine', 'missingPlanAgents', 'resolveAgentRoster']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../plan/index.js', ['parsePlan']],
    ['./plan-files.js', ['countTasks', 'expectOneArgument', 'formatCounts', 'isFile', 'issueLine', 'plural']],
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
    ['../../utils/tracker.js', ['splitBlockerComment']],
    ['../plan/plan-files.js', ['countTasks', 'expectNoArgument', 'formatCounts']],
    ['./loop-sessions.js', [
      'estimateEta',
      'etaLine',
      'isLive',
      'pickSession',
      'readSessionChecklist',
      'readSessionFinishes',
      'resolveLoopSeams',
      'sessionIdFlag',
      'sessionLine',
    ]],
  ]],
  ['./commands/loop/list.js', [
    ['../plan/plan-files.js', ['countTasks', 'expectNoArgument', 'formatCounts']],
    ['./loop-sessions.js', ['isLive', 'projectRoot', 'readRecords', 'readSessionChecklist', 'resolveLoopSeams', 'sessionLine']],
  ]],
  ['./commands/issue/list.js', [
    ['../../adapters/tracker/issue-values.js', ['ISSUE_STATES', 'ISSUE_TYPES']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./issue-tracker.js', ['DEFAULT_ISSUE_SEAMS', 'lineRefusal', 'onTracker', 'readChoiceFlag', 'readNonBlankFlag', 'readTextFlag', 'resolveIssueTracker']],
  ]],
  ['./commands/issue/show.js', [
    ['../plan/plan-files.js', ['expectOneArgument']],
    ['./issue-tracker.js', ['DEFAULT_ISSUE_SEAMS', 'issueRef', 'onTracker', 'resolveIssueTracker', 'urlLines']],
  ]],
  ['./commands/issue/create.js', [
    ['../../adapters/tracker/issue-values.js', ['ISSUE_PRIORITIES', 'ISSUE_TYPES']],
    ['../../triage/triage.js', ['TRIAGE_MODULE']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./issue-tracker.js', [
      'DEFAULT_ISSUE_SEAMS',
      'issueName',
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
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/gate.js', ['SPEC_NEEDS_WORK_LABEL']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../board/plan-spec.js', ['boardRepoLabel', 'issueSource']],
    ['../../board/readiness.js', ['hasSpecReadyLabel', 'requireCompleteSpec', 'SPEC_READY_LABEL']],
    ['../../board/trust.js', ['ghBoardTrust', 'requireTrustedBoardAuthor']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['messageOf']],
    ['../../next/ending.js', ['endWithNextStep', 'HINT_FLAG_SPEC']],
    ['../../pr/git.js', ['createGitRunner']],
    ['../../project/root-choice.js', ['createLinePrompter']],
    ['../../start/branch-decision.js', ['answeredYes']],
    ['./issue-tracker.js', ['issueProject', 'issueSubjectConfig', 'lineRefusal']],
  ]],
  ['./commands/issue/unblock.js', [
    ['../../adapters/tracker/github.js', ['createGhRunner']],
    ['../../board/blocked.js', ['blockedFaultMessage', 'hasSpecBlockedLabel', 'readBlockedBy', 'SPEC_BLOCKED_LABEL']],
    ['../../board/issue-board.js', ['createGhIssueBoard']],
    ['../../board/issue.js', ['createGhSpecIssueReader']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-sections.js', ['describeValue', 'isMapping', 'messageOf']],
    ['../../project/root-choice.js', ['createLinePrompter']],
    ['../doctor-blocked.js', ['BLOCKED_LIST_LIMIT', 'KNOWN_LIST_LIMIT']],
    ['../plan/plan-files.js', ['plural']],
    ['./issue-tracker.js', ['lineRefusal']],
  ]],
  ['./commands/pr/current.js', [
    ['../../config-sections.js', ['messageOf']],
    ['./pr-context.js', ['DEFAULT_PR_SEAMS', 'expectNoArguments', 'openPrContext', 'pickPullRequest', 'PR_USAGE']],
  ]],
  ['./commands/pr/show.js', [
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
    ['./current.js', ['SEPARATOR']],
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
    ['../../cli/command.js', ['CommandExit']],
    ['../../next/ending.js', ['endWithNextStep', 'HINT_FLAG_SPEC']],
    ['../../pr/index.js', [
      'cleanUpSteps',
      'commandLine',
      'createGitRunner',
      'gitSaid',
      'isMergeMethod',
      'MERGE_METHODS',
      'parseWorkingTree',
      'parseWorktrees',
      'readMergeRefusal',
      'remainingFrom',
    ]],
    ['../../project/root-choice.js', ['createLinePrompter']],
    ['../../start/runtime.js', ['RUNTIME_SUBDIR']],
    ['./merge-followups.js', ['readFollowUps', 'readPackageFacts', 'versionTag']],
    ['./merge-tick.js', ['tickRoadmapAfterMerge']],
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
    ['./triage-read.js', ['readConflictFiles', 'readFailedLogs', 'readWorkflowCount']],
    ['./triage-report.js', ['evidenceOf', 'renderTriages', 'workflowCountOf']],
    ['./triage-resolve.js', ['resolvePullRequest']],
    ['./triage-trust.js', ['ghPermissionsIn', 'readTrustedTriageComment', 'repoLabel']],
  ]],
  ['./commands/effort/collect.js', [['../../effort/collect.js', ['default']], ['../wrap.js', ['wrapPhaseZeroCommand']]]],
  ['./commands/effort/report.js', [['../../effort/report.js', ['default']], ['../wrap.js', ['wrapPhaseZeroCommand']]]],
  ['./commands/module/list.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../modules/load.js', ['loadModules', 'moduleSettings']],
    ['../plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/module/exec.js', [['../../cli/command.js', ['CommandExit']], ['../../cli/registry.js', ['mountKey']]]],
  ['./commands/agent/vendor.js', [
    ['../../agents/roster.js', ['readAgentDefinitions']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../utils/agent-definition.js', ['AGENT_DEFINITION_DIR', 'readFrontmatter']],
  ]],
  ['./commands/agent/list.js', [
    ['../../agents/roster.js', ['resolveAgentRoster', 'VENDOR_COMMAND']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/skill/check.js', [
    ['../check-report.js', ['checkCommandRun', 'DEFAULT_CHECK_SEAMS', 'SKILL_CHECK_USAGE']],
  ]],
  ['./commands/skill/list.js', [
    ['../../check/references.js', ['pathDirectories']],
    ['../../check/run.js', ['checkDirectory']],
    ['../../cli/command.js', ['CommandExit']],
    ['../../schema/frontmatter.js', ['readFrontmatter']],
    ['../../schema/tiers.js', ['isSkillTier', 'resolveSkillTiers', 'SKILL_TIERS', 'tierExists']],
    ['../plan/plan-files.js', ['expectNoArgument']],
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
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['./instinct-records.js', ['allRecords', 'instinctProject', 'readScopes']],
  ]],
  ['./commands/instinct/show.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../schema/instinct.js', ['ACTION_HEADING', 'CAUSE_HEADING']],
    ['../plan/plan-files.js', ['expectOneArgument']],
    ['./instinct-records.js', ['findRecords', 'instinctProject', 'readScopes']],
  ]],
  ['./commands/release/status.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config-sections.js', ['messageOf']],
    ['../../config.js', ['ConfigError']],
    ['../../effort/attribution.js', ['planStubsFromFileNames', 'resolvePlanStub']],
    ['../../effort/store/changes.js', ['readPlanChanges']],
    ['../../pr/index.js', ['createGitRunner', 'gitSaid']],
    ['../../release/changelog.js', ['groupChangeNotes', 'renderNoteLines']],
    ['../../release/level.js', ['highestChangeLevel']],
    ['../../release/version.js', ['parseSemanticVersion', 'readManifestVersion']],
  ]],
  ['./commands/release/tag.js', [
    ['../../cli/command.js', ['CommandExit']],
    ['../../config-load.js', ['loadConfig']],
    ['../../config.js', ['ConfigError']],
    ['../../pr/index.js', ['createGitRunner', 'gitSaid']],
    ['../../release/version.js', ['readManifestVersion']],
    ['../plan/plan-files.js', ['expectNoArgument']],
    ['../pr/merge-followups.js', ['versionTag']],
    ['./status.js', ['changelogVersions', 'DEFAULT_RELEASE_SEAMS', 'readTags']],
  ]],
  ['./commands/next.js', [
    ['../cli/command.js', ['CommandExit']],
    ['../next/actions.js', ['actionInvocation', 'runAction']],
    ['../next/ceiling.js', ['ALWAYS_ASKED', 'allowedUnasked', 'BARE_YES_ACTIONS', 'readYesCeiling', 'YES_ACTIONS', 'YES_FLAG']],
    ['../next/ending.js', ['actionOutput']],
    ['../next/hint.js', ['commandWords', 'nextQuestion']],
    ['../next/sources.js', ['openNextSources']],
    ['../next/state.js', ['readNextState']],
    ['../next/sync.js', ['fastForwardBase']],
    ['../project/root-choice.js', ['createLinePrompter']],
    ['../start/branch-decision.js', ['REMOTE']],
    ['./issue/ready.js', ['lazyPrompter']],
    ['./plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/init.js', [
    ['../adapters/tracker/github.js', ['createGhRunner']],
    ['../agents/vendorable.js', ['vendorableAgents', 'vendorableAgentWarnings']],
    ['../cli/command.js', ['CommandExit']],
    ['../config-load.js', ['loadConfig']],
    ['../config-sections.js', ['messageOf']],
    ['../config.js', ['ConfigError', 'configFilePath']],
    ['../pr/provider.js', ['resolvePrProvider']],
    ['../project/bin-path.js', ['readBinPath']],
    ['../project/gitignore.js', ['applyTracking', 'GITIGNORE_FILE', 'GitignoreError', 'TRACKING_DIGEST_FILE', 'withTrackingBlock']],
    ['../project/root-choice.js', ['candidateLines', 'createLinePrompter', 'firstCandidate', 'namedRoot', 'promptForRoot']],
    ['../project/roots.js', ['DISK_ROOTS_FILE_SYSTEM', 'gitToplevel', 'rootCandidates']],
    ['../project/scaffold.js', ['scaffoldConflicts', 'writeProjectScope', 'writeUserScope']],
    ['../schema/project-id.js', ['gitRemoteUrl']],
    ['./init-board.js', ['boardStepChanged', 'renderBoardStep', 'runBoardStep']],
    ['./init-release.js', ['renderReleaseStep', 'runReleaseStep']],
  ]],
  ['./commands/doctor.js', [
    ['../adapters/tracker/github.js', ['createGhRunner']],
    ['../board/status.js', ['boardGaps', 'readBoardStatus']],
    ['../cli/command.js', ['CommandExit']],
    ['../cli/version.js', ['versionLine']],
    ['../config-load.js', ['loadConfig']],
    ['../config-sections.js', ['messageOf']],
    ['../config.js', ['ConfigError']],
    ['../effort/store/legacy.js', ['readLegacyStore']],
    ['../pr/preflight-items.js', ['ghPreflightItems']],
    ['../pr/provider.js', ['resolvePrProvider']],
    ['../preflight/first-dispatch.js', ['isFirstDispatch']],
    ['../preflight/prerequisites-md.js', ['loadPlanPrerequisites', 'mergePlanPrerequisites', 'prerequisitesPathForPlan']],
    ['../preflight/run.js', ['PROBE_TIMEOUT_MS', 'runPreflight']],
    ['../project/bin-path.js', ['readBinPath']],
    ['../project/pre-init-dirs.js', ['readPreInitDirs']],
    ['../start/plan-path.js', ['DEFAULT_PLAN_FILE', 'resolvePlanPath']],
    ['../utils/tracker.js', ['trackerPathFor']],
    ['./doctor-blocked.js', ['readBlockedIssues', 'renderBlockedIssues']],
    ['./init-board.js', ['BOARD_FIX', 'BOARD_HEADING']],
    ['./plan/plan-files.js', ['isFile', 'plural']],
  ]],
  ['./commands/self-update.js', [
    ['../cli/command.js', ['CommandExit']],
    ['../project/bin-path.js', ['readBinPath']],
    ['../runtime/install.js', ['exitCodeFor', 'installRuntime', 'outcomeProblem', 'runBuild']],
    ['./plan/plan-files.js', ['expectNoArgument']],
  ]],
  ['./commands/usage.js', [['../usage.js', ['default']], ['./wrap.js', ['wrapPhaseZeroCommand']]]],
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
      './commands/loop/stop.js',
      './commands/loop/pause.js',
      './commands/loop/resume.js',
      './commands/loop/status.js',
      './commands/loop/list.js',
      './commands/issue/list.js',
      './commands/issue/show.js',
      './commands/issue/create.js',
      './commands/issue/comment.js',
      './commands/issue/move.js',
      './commands/issue/ready.js',
      './commands/issue/unblock.js',
      './commands/pr/current.js',
      './commands/pr/show.js',
      './commands/pr/view.js',
      './commands/pr/list.js',
      './commands/pr/wait.js',
      './commands/pr/merge.js',
      './commands/pr/triage.js',
      './commands/module/list.js',
      './commands/module/exec.js',
      './commands/agent/vendor.js',
      './commands/agent/list.js',
      './commands/skill/check.js',
      './commands/skill/list.js',
      './commands/skill/demote.js',
      './commands/skill/backfill.js',
      './commands/instinct/check.js',
      './commands/instinct/list.js',
      './commands/instinct/show.js',
      './commands/release/status.js',
      './commands/release/tag.js',
      './commands/next.js',
      './commands/init.js',
      './commands/doctor.js',
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
