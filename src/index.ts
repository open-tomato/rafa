/**
 * The library's entry: the loop, the plan and report parsers, the effort
 * store and the config resolver, so a service importing the package
 * reaches everything the CLI reaches.
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
 *     answers: {@link startCommand} (`rafa start`, the loop),
 *     {@link planCommand} (`rafa plan`), {@link usageCommand}
 *     (`rafa usage`), {@link effortCollectCommand} (`rafa effort collect`)
 *     and {@link effortReportCommand} (`rafa effort report`). These are
 *     the five functions `src/rafa.ts` dispatches to, re-exported rather
 *     than wrapped, so a service calling one runs exactly what the
 *     terminal runs.
 *   - The whole `./plan` surface: the block reader, the plan parser, the
 *     report parser and the injection renderer, with the models they
 *     answer.
 *   - The whole `./store` surface: the port, both backends and the
 *     selector.
 *   - The whole config, `config.ts` and `config-load.ts`:
 *     {@link loadConfig}, which reads the project's `.rafa/config.yaml`
 *     under a root and the user scope's under a home and ranks the
 *     command line over both, the pure {@link parseConfigText} and
 *     {@link resolveConfig} it is built from, {@link readConfigFile},
 *     {@link ConfigError}, and the names and defaults every setting
 *     takes.
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
 * the argument list the command line would get, prints what the command
 * prints, and answers the working directory's git root as the repo it
 * acts on. `startCommand` and `planCommand` call `process.exit` on a
 * refusal and on some failures, and `startCommand` adds a `SIGINT`
 * listener once it runs. `effortCollectCommand` and
 * `effortReportCommand` set `process.exitCode` instead. The suffix keeps
 * those names apart from the library's own: `planCommand` generates a
 * plan with a Claude session, which `parsePlan` does not, and
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
 *   - `./ports`. The spec declares it in phase 0 and fills it in phase 1,
 *     from its own entry.
 *
 * Importing the entry imports the SQLite backend, and `bun:sqlite` with
 * it, so the entry needs Bun.
 */
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
  FindingKind,
  FindingSignal,
  InjectionFallback,
  InjectionFallbackReason,
  InjectionRequest,
  InjectionTask,
  LineSpan,
  PlanBlockKind,
  PlanHeader,
  PlanHeaderExtra,
  PlanHeaderField,
  PlanInjection,
  PlanIssue,
  PlanIssueReason,
  PlanModel,
  PlanStage,
  PlanTask,
  PlanTaskStatus,
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
  TaskReport,
} from './plan/index.js';

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
export { default as planCommand } from './plan.js';
export {
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
export { default as startCommand } from './start.js';
export { default as usageCommand } from './usage.js';
