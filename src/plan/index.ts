/**
 * The plan format's entry: the block reader, the plan parser, the
 * report parser, the injection renderer, and the preflight with the
 * PREREQUISITES parser it reads a plan's own items through.
 *
 * The spec's `exports` map points the package's `./plan` subpath at
 * `./dist/plan/index.js`, which is this module built, and the roadmap
 * names what that subpath is for: the parsers a service implements
 * against. The phase 1 spec adds the preflight module to it, because
 * the scheduler parses the same plan format. A caller that reads plans
 * or task reports, renders one task's share of a plan, or checks the
 * prerequisites a run needs, and needs none of the rest of the library,
 * imports it from here.
 *
 * ## What the entry exports
 *
 *   - The block reader: {@link readRafaBlocks}, which answers every
 *     fenced `rafa:*` block of a document, with {@link isRafaBlockKind}
 *     and {@link RAFA_BLOCK_KINDS} naming the kinds this phase defines.
 *   - The plan parser: {@link parsePlan} and the model it answers, with
 *     {@link PLAN_BLOCK_KINDS} and {@link PLAN_HEADER_FIELDS} naming the
 *     blocks and header fields it reads.
 *   - The report parser: {@link parseReport}, which reads the last
 *     `rafa:report` block of a session's output into a report or a
 *     record of why there is none, with the report model and
 *     {@link REPORT_STATUSES}, {@link FINDING_KINDS} and
 *     {@link FINDING_SIGNALS} naming the values its closed fields take.
 *   - The injection renderer: {@link renderInjection}, with its request
 *     and its answer.
 *   - The mode names, {@link INJECT_MODES} and `InjectMode`, so a caller
 *     can spell and check a request's mode without importing the config
 *     module.
 *   - The preflight: {@link runPreflight}, which checks a run's required
 *     and optional items and answers the report a caller halts, warns
 *     and prompts from, with {@link runShellProbe}, the probe runner it
 *     uses unless handed another, {@link PROBE_TIMEOUT_MS}, and the
 *     options it takes and the report it answers.
 *   - The PREREQUISITES parser: {@link parsePrerequisites}, which reads
 *     the unticked items of a plan's `PREREQUISITES-<stub>.md`,
 *     {@link planPrerequisites}, which maps them onto required items,
 *     reminders and malformed items, {@link mergePlanPrerequisites} and
 *     {@link loadPlanPrerequisites}, which merge them into the config's
 *     items for one plan, and {@link prerequisitesPathForPlan}, which
 *     names that file for a plan.
 *
 * Nothing else. A subpath is a public surface: a name added to it later
 * breaks nobody, and a name removed breaks every caller that imported
 * it. So a type a model borrows from another module stays out: a task's
 * declaration is spelled `PlanTask['declaration']`, not imported from
 * the declaration module through here. The config's `PrerequisiteItem`
 * stays out by the same rule, spelled `PreflightTiers['required'][number]`
 * here and exported by name from the package root. Two preflight
 * exports stay out too: `forkWorktree` (`packages/rafa-run/src/preflight/fork.ts`), with
 * the command runner it spawns through, which nothing calls until the
 * loop forks worktrees, and `firstLineOf`, the wording helper the
 * runner and the fork share.
 *
 * ## Four parts live outside this directory
 *
 * The block reader and the plan parser live in `packages/rafa/src/core/plan/`, with
 * the files every part of rafa depends on. This entry re-exports them
 * from that folder's two barrels, `block-reader.ts` and `index.ts`, and
 * the names it exports are the ones it exported before they moved.
 *
 * The roadmap puts the report parser under this subpath too, but a
 * report is no plan: it is read out of a session's output, by
 * `packages/rafa/src/report/parse.ts`. The preflight is no plan either: it checks what
 * a run needs, and reads a plan only for the PREREQUISITES file beside
 * it. It is core's, in `packages/rafa/src/preflight/`, and this entry
 * takes its names from the subpaths `@open-tomato/rafa/preflight/run`
 * and `@open-tomato/rafa/preflight/prerequisites-md`. Both are exported
 * from here all the same, so a service implementing against `./plan`
 * reaches them through one entry.
 *
 * ## Importing the entry from inside the package
 *
 * `src/plan.ts`, the `rafa plan` command, sits beside this directory
 * under the same name. From `src/`, both `./plan` and `./plan.js`
 * resolve to that file and never to this entry, so a module inside the
 * package imports the entry as `./plan/index.js`. `index.test.ts` pins
 * all three resolutions.
 */
export type { InjectMode } from '@open-tomato/rafa/core/config/sections';
export type {
  MalformedPrerequisite,
  MarkdownPrerequisite,
  PlanPrerequisites,
  PreflightItems,
  PrerequisiteReminder,
  PrerequisiteSettings,
  PrerequisiteTag,
} from '@open-tomato/rafa/preflight/prerequisites-md';
export type {
  CheckOutcome,
  PreflightCheck,
  PreflightEnv,
  PreflightOptions,
  PreflightReport,
  PreflightTier,
  PreflightTiers,
  ProbeOptions,
  ProbeRun,
  ProbeRunner,
  ServiceRequester,
  ServiceRequestInit,
} from '@open-tomato/rafa/preflight/run';
export type {
  FindingKind,
  FindingSignal,
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
} from '@open-tomato/rafa/report/parse';
export type { LineSpan, RafaBlock, RafaBlockKind } from '@open-tomato/rafa/core/plan/block-reader';
export type {
  InjectionFallback,
  InjectionFallbackReason,
  InjectionRequest,
  InjectionTask,
  PlanInjection,
} from '@open-tomato/rafa/plan/inject';
export type {
  PlanBlockKind,
  PlanHeader,
  PlanHeaderExtra,
  PlanHeaderField,
  PlanIssue,
  PlanIssueReason,
  PlanModel,
  PlanStage,
  PlanTask,
  PlanTaskStatus,
} from '@open-tomato/rafa/core/plan';

export { INJECT_MODES } from '@open-tomato/rafa/core/config/sections';
export {
  loadPlanPrerequisites,
  mergePlanPrerequisites,
  parsePrerequisites,
  planPrerequisites,
  prerequisitesPathForPlan,
} from '@open-tomato/rafa/preflight/prerequisites-md';
export { PROBE_TIMEOUT_MS, runPreflight, runShellProbe } from '@open-tomato/rafa/preflight/run';
export { FINDING_KINDS, FINDING_SIGNALS, parseReport, REPORT_STATUSES } from '@open-tomato/rafa/report/parse';
export { isRafaBlockKind, RAFA_BLOCK_KINDS, readRafaBlocks } from '@open-tomato/rafa/core/plan/block-reader';
export { renderInjection } from '@open-tomato/rafa/plan/inject';
export { parsePlan, PLAN_BLOCK_KINDS, PLAN_HEADER_FIELDS } from '@open-tomato/rafa/core/plan';
