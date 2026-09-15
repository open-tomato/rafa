/**
 * The library's entry: the loop, the plan and report parsers, the
 * preflight, the effort store, the config resolver, scope resolution,
 * the adapter registry and the manifest validator, so a service
 * importing the package reaches everything the CLI reaches.
 *
 * The spec's `exports` map points the package root, `.`, at
 * `./dist/index.js`, which is this module built, and names what the root
 * is for: the library a service imports, where `./cli` is the binary a
 * terminal runs. The roadmap's rule for the two is that the CLI is a thin
 * caller adding no behaviour a service could not reach by import. This
 * entry is where that rule is kept.
 *
 * ## What the entry exports
 *
 *   - The CLI's commands, each under the name of the command line it
 *     answers: {@link startCommand} (`rafa loop start`, the loop),
 *     {@link planCommand} (`rafa plan create`), {@link usageCommand}
 *     (`rafa usage`), {@link effortCollectCommand} (`rafa effort collect`)
 *     and {@link effortReportCommand} (`rafa effort report`). These are
 *     the five functions the core commands in `src/commands/` wrap, each
 *     handed the words typed after its routing words and the root of the
 *     project the dispatcher resolved. The entry
 *     re-exports them as they are, so a service calling one runs exactly
 *     what the terminal runs.
 *   - The whole `./plan` surface: the block reader, the plan parser, the
 *     report parser, the injection renderer, the preflight runner and the
 *     PREREQUISITES parser, with the models they answer.
 *   - The whole `./store` surface: the port, both backends and the
 *     selector.
 *   - The whole config, `config.ts` and `config-load.ts`:
 *     {@link loadConfig}, which reads the project's `.rafa/config.yaml`
 *     under a root and the user scope's under a home and ranks the
 *     command line over both, the pure {@link parseConfigText} and
 *     {@link resolveConfig} it is built from, {@link readConfigFile},
 *     {@link ConfigError}, and the names and defaults every setting
 *     takes.
 *   - The whole scope module, `project/scope.ts`: {@link resolveScope},
 *     which walks up from a directory to the nearest one holding
 *     `.rafa/config.yaml` and answers the project root with both scopes,
 *     the `ConfigRoots` {@link loadConfig} reads, or the `rafa init` hint
 *     when no directory holds one, with {@link ScopeError},
 *     {@link scopeAt}, {@link initHint} and the filesystem seam the walk
 *     reads.
 *   - The whole adapter registry, `adapters/registry.ts`:
 *     {@link createAdapterRegistry}, {@link CORE_ADAPTER_REGISTRY}, which
 *     holds core's own adapters keyed by port type and kind, and
 *     {@link PORT_VERSIONS}, the version core serves of each port.
 *   - The whole manifest module, `modules/manifest.ts`:
 *     {@link validateManifest}, which reads the `rafa` manifest of a
 *     module's `package.json` and names every failure, with the schema's
 *     closed lists and {@link RUNNING_MANIFEST_SEAMS}, the rafa version
 *     and port versions a manifest is held against. It is how a module
 *     author validates a manifest locally, as the modules spec asks.
 *
 * Every subpath's names are on the root too, the same bindings, so a
 * service that starts from the root never has to learn a subpath to
 * reach one more name. Nothing is defined here: the entry only
 * re-exports, and `index.test.ts` holds each value identical to its
 * module's own.
 *
 * ## Why the commands carry a `Command` suffix
 *
 * A command is the terminal's contract, not a library call. Each takes
 * the argument list the command line would get, then the root of the
 * project it acts on, which behind the terminal is the nearest directory
 * at or above the working directory holding `.rafa/config.yaml`, and
 * prints what the command prints. Each writes through the active output
 * (`src/adapters/output/active.ts`), the `text` adapter on
 * `process.stdout` until something sets another. None calls
 * `process.exit`: a refusal throws `CommandExit` (`src/cli/command.ts`)
 * with the refusal as its message, which the command leaves to its caller
 * to print. `planCommand` also throws it with the exit code a `claude`
 * planner's rejection carries, and `startCommand` with exit code 0 once
 * an interrupted task is marked. The dispatcher behind the terminal turns
 * each into its exit code, and writes a refusal's message to stderr.
 * `startCommand` also adds a `SIGINT` listener once it runs. The
 * suffix keeps those names apart from the library's own: `planCommand`
 * generates a plan with a Claude session, which `parsePlan` does not, and
 * `effortReportCommand` rolls up effort rows, which `parseReport` does
 * not.
 *
 * ## What the entry leaves out
 *
 *   - `src/rafa.ts` itself. It dispatches on `process.argv` when it is
 *     imported, so an entry importing it would run the CLI inside every
 *     service that imports the package. Importing this entry runs
 *     nothing: no output, no signal listener, no exit code, nothing
 *     written. `index.test.ts` measures that in a fresh process, with
 *     `src/rafa.ts` as the control that prints.
 *   - The helpers behind the commands (the task dispatch, the commit and
 *     report writers, the effort collector's halves). The CLI reaches
 *     them only through a command, and an entry is a public surface: a
 *     name added later breaks nobody, and a name removed breaks every
 *     caller that imported it.
 *   - The rest of `src/project/` and `src/modules/`: the root candidates,
 *     prompt and scaffold behind `rafa init`, and the module loader
 *     behind `rafa module list` and the CLI's start-up. Each is reached
 *     through a command, for the same reason.
 *   - `./ports`. The spec declares it in phase 0 and fills it in phase 1,
 *     from its own entry.
 *
 * Importing the entry imports the SQLite backend, and `bun:sqlite` with
 * it, so the entry needs Bun.
 */
export type {
  Adapter,
  AdapterContext,
  AdapterRegistry,
  AnyAdapter,
  PortImplementations,
} from './adapters/registry.js';
export type { ConfigRoots } from './config-load.js';
export type {
  ClaudeSettingSource,
  CommandLineSetting,
  ConfigExtra,
  ConfigFile,
  ConfigLayer,
  ConfigLayers,
  ConfigOverrides,
  ConfigSetting,
  ConfigSource,
  ConfigVersion,
  InjectMode,
  ModuleSource,
  ModuleSourceKind,
  OptionalPrerequisiteItem,
  OutputMode,
  PrerequisiteItem,
  PrerequisiteKind,
  RafaConfig,
  ResolvedConfig,
  StoreBackend,
} from './config.js';
export type {
  AppendResult,
  CommitEffortRow,
  EffortKeyProjections,
  EffortRow,
  EffortRowByKind,
  EffortRowKind,
  EffortStore,
  NdjsonAppendResult,
  NdjsonEffortStore,
  SelectedEffortStore,
  SessionEffortRow,
  SessionMode,
  SqliteEffortStore,
  StoreReadResult,
} from './effort/store/index.js';
export type {
  AdapterProvision,
  CommandsProvision,
  FeatureType,
  ManifestProvides,
  ManifestSeams,
  ManifestValidation,
  McpServer,
  ModuleFeatureType,
  ModuleManifest,
  OutputChannel,
  OutputProvision,
} from './modules/manifest.js';
export type {
  CheckOutcome,
  FindingKind,
  FindingSignal,
  InjectionFallback,
  InjectionFallbackReason,
  InjectionRequest,
  InjectionTask,
  LineSpan,
  MarkdownPrerequisite,
  PlanBlockKind,
  PlanHeader,
  PlanHeaderExtra,
  PlanHeaderField,
  PlanInjection,
  PlanIssue,
  PlanIssueReason,
  PlanModel,
  PlanPrerequisites,
  PlanStage,
  PlanTask,
  PlanTaskStatus,
  PreflightCheck,
  PreflightEnv,
  PreflightItems,
  PreflightOptions,
  PreflightReport,
  PreflightTier,
  PreflightTiers,
  PrerequisiteReminder,
  PrerequisiteSettings,
  PrerequisiteTag,
  ProbeOptions,
  ProbeRun,
  ProbeRunner,
  RafaBlock,
  RafaBlockKind,
  ReportAbsenceReason,
  ReportAbsent,
  ReportBlocker,
  ReportBug,
  ReportExtra,
  ReportFinding,
  ReportIssue,
  ReportIssueReason,
  ReportPresent,
  ReportReading,
  ReportStatus,
  ServiceRequester,
  ServiceRequestInit,
  TaskReport,
} from './plan/index.js';
export type {
  NoProject,
  ProjectFound,
  Scope,
  ScopeFileSystem,
  ScopeResolution,
  ScopeSeams,
} from './project/scope.js';

export { CORE_ADAPTER_REGISTRY, createAdapterRegistry, PORT_VERSIONS } from './adapters/registry.js';
export { loadConfig, readConfigFile } from './config-load.js';
export {
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
  PREREQUISITE_KINDS,
  resolveConfig,
  STORE_BACKENDS,
} from './config.js';
export { default as effortCollectCommand } from './effort/collect.js';
export { default as effortReportCommand } from './effort/report.js';
export {
  EFFORT_KEY_PROJECTIONS,
  openNdjsonStore,
  openSqliteStore,
  selectEffortStore,
} from './effort/store/index.js';
export {
  FEATURE_TYPES,
  MANIFEST_VERSION,
  OUTPUT_CHANNELS,
  RUNNING_MANIFEST_SEAMS,
  validateManifest,
} from './modules/manifest.js';
export { default as planCommand } from './plan.js';
export {
  FINDING_KINDS,
  FINDING_SIGNALS,
  isRafaBlockKind,
  loadPlanPrerequisites,
  mergePlanPrerequisites,
  parsePlan,
  parsePrerequisites,
  parseReport,
  PLAN_BLOCK_KINDS,
  PLAN_HEADER_FIELDS,
  planPrerequisites,
  prerequisitesPathForPlan,
  PROBE_TIMEOUT_MS,
  RAFA_BLOCK_KINDS,
  readRafaBlocks,
  renderInjection,
  REPORT_STATUSES,
  runPreflight,
  runShellProbe,
} from './plan/index.js';
export {
  DISK_FILE_SYSTEM,
  INIT_COMMAND,
  initHint,
  resolveScope,
  SCOPE_DIR,
  scopeAt,
  ScopeError,
  selfAndAncestors,
} from './project/scope.js';
export { default as startCommand } from './start.js';
export { default as usageCommand } from './usage.js';
