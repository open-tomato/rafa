/**
 * The facade of `rafa-run`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-run --entry`.
 */

export type {
  AheadCandidate,
  AheadRequest,
} from '../../src/claims/ahead.js';
export {
  aheadClaimedLine,
  aheadEnabled,
  aheadNotClaimedWarning,
  nextUndoneLine,
} from '../../src/claims/ahead.js';

export { readDeviceStoreId } from '../../src/claims/device.js';

export type { ClaimBranchReading } from '../../src/claims/git.js';
export {
  claimBranchGlob,
  claimBranchIssue,
  fetchClaimBranches,
  readClaimBranch,
} from '../../src/claims/git.js';

export { STAGE_LABELS } from '../../src/claims/labels.js';

export type {
  PlanClaim,
  PlanClaimContext,
  PlanClaimRequest,
} from '../../src/claims/plan-claim.js';
export { claimPlanIssue } from '../../src/claims/plan-claim.js';

export type {
  ClaimOwnership,
  ClaimState,
  ClaimStateName,
} from '../../src/claims/stale.js';
export {
  CLAIMED_LABEL,
  IN_DEVELOPMENT_LABEL,
  readClaimState,
} from '../../src/claims/stale.js';

export type {
  BranchRow,
  CleanupCounts,
  CleanupOutcome,
  CleanupPlan,
  CleanupRead,
  CleanupReading,
  CleanupSeams,
  CleanupSelection,
  CleanupSettings,
  CleanupStepKind,
  MergedBy,
  MergedRow,
  NotPushedRow,
  StaleRow,
} from '../../src/cleanup/index.js';
export {
  cleanupCounts,
  cleanupSteps,
  defaultCleanupSeams,
  deletedNotPushed,
  dryRunLines,
  readCleanup,
  runCleanupSteps,
} from '../../src/cleanup/index.js';

export type { RemoteOnlyRow } from '../../src/cleanup/remote-only.js';

export type { RunRow } from '../../src/cleanup/runs.js';

export type {
  WorktreeBlockKind,
  WorktreeRow,
  WorktreeSeams,
} from '../../src/cleanup/worktrees.js';
export {
  ADMIN_FILES,
  GIT_DIR,
  WORKTREE_STATUS,
  countChanges,
  defaultWorktreeSeams,
} from '../../src/cleanup/worktrees.js';

export { CLAIM_SUBJECT } from '../../src/commands/claim/declarations.js';

export {
  default as command,
  defaultBoardOnce,
} from '../../src/commands/switch.js';

export type { ChecksShape } from '../../src/config-schema-checks.js';
export {
  CHECKS_DEFAULTS,
  CHECKS_SECTION,
  CHECKS_SETTINGS,
  CHECK_NAMES,
} from '../../src/config-schema-checks.js';

export type { LoopContinueShape } from '../../src/config-schema-loop-continue.js';
export {
  LOOP_CONTINUE_DEFAULTS,
  LOOP_CONTINUE_SECTION,
  LOOP_CONTINUE_SETTINGS,
} from '../../src/config-schema-loop-continue.js';

export type {
  LoopRetries,
  LoopRetriesShape,
} from '../../src/config-schema-loop-retries.js';
export {
  LOOP_RETRIES_DEFAULTS,
  LOOP_RETRIES_SECTION,
  LOOP_RETRIES_SETTINGS,
} from '../../src/config-schema-loop-retries.js';

export type { TestsShape } from '../../src/config-schema-tests.js';
export {
  TESTS_DEFAULTS,
  TESTS_SECTION,
  TESTS_SETTINGS,
} from '../../src/config-schema-tests.js';

export type { WrapUpShape } from '../../src/config-schema-wrap-up.js';
export {
  WRAP_UP_DEFAULTS,
  WRAP_UP_SECTION,
  WRAP_UP_SETTINGS,
} from '../../src/config-schema-wrap-up.js';

export type {
  CheckAnswered,
  CheckUnanswered,
  VerifyRunRan,
} from '../../src/epic/verify-run.js';
export { runVerification } from '../../src/epic/verify-run.js';

export type { EventLine } from '../../src/loop/events-file.js';
export {
  eventsFileOf,
  readEventsFrom,
} from '../../src/loop/events-file.js';

export type {
  NextActionOptions,
  NextInvocation,
} from '../../src/next/actions.js';
export {
  LABELS_ONLY_ACTIONS,
  NEXT_COMMAND_ACTIONS,
  actionInvocation,
  runAction,
} from '../../src/next/actions.js';

export type { NextEndingSeams } from '../../src/next/ending.js';
export {
  actionOutput,
  endWithNextStep,
  endingWith,
} from '../../src/next/ending.js';

export {
  commandWords,
  nextQuestion,
} from '../../src/next/hint.js';

export type { NextHopStep } from '../../src/next/hop-rows.js';

export type {
  DryEpic,
  HopTarget,
  NextBoard,
  NextHopReading,
  NextRoadmapReading,
  NextRoadmapSources,
  NextSources,
  OpenPull,
  PickedLine,
  TakenBlocker,
  WaitingLine,
} from '../../src/next/readings.js';
export {
  readBranch,
  readBranchPlan,
  readOpenPull,
  readPlans,
} from '../../src/next/readings.js';

export type {
  NextActionId,
  NextAnswerId,
  NextState,
  NextStateId,
} from '../../src/next/state.js';
export {
  readHomeAfterLoop,
  readNextState,
} from '../../src/next/state.js';

export type {
  CheckOutcome,
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
  PreflightCheck,
  PreflightTier,
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
} from '../../src/plan/index.js';
export {
  FINDING_KINDS,
  FINDING_SIGNALS,
  PLAN_BLOCK_KINDS,
  PLAN_HEADER_FIELDS,
  RAFA_BLOCK_KINDS,
  REPORT_STATUSES,
  isRafaBlockKind,
  parsePlan,
  parseReport,
  readRafaBlocks,
  renderInjection,
} from '../../src/plan/index.js';

export type {
  PlanList,
  PlanListing,
} from '../../src/plan/list.js';
export { listPlans } from '../../src/plan/list.js';

export type { StoreRuleProblem } from '../../src/plan/store-rules.js';
export {
  findStoreRuleProblems,
  storeRuleLine,
} from '../../src/plan/store-rules.js';

export type { PlanValidation } from '../../src/plan/validate.js';
export { validatePlan } from '../../src/plan/validate.js';

export { isFirstDispatch } from '../../src/preflight/first-dispatch.js';

export type {
  MalformedPrerequisite,
  MarkdownPrerequisite,
  PlanPrerequisites,
  PreflightItems,
  PrerequisiteReminder,
  PrerequisiteSettings,
  PrerequisiteTag,
} from '../../src/preflight/prerequisites-md.js';
export {
  loadPlanPrerequisites,
  malformedPrerequisiteLines,
  mergePlanPrerequisites,
  parsePrerequisites,
  planPrerequisites,
  prerequisitesPathForPlan,
} from '../../src/preflight/prerequisites-md.js';

export type {
  PreflightEnv,
  PreflightOptions,
  PreflightReport,
  PreflightTiers,
  ProbeOptions,
  ProbeRun,
  ProbeRunner,
  ServiceRequestInit,
  ServiceRequester,
} from '../../src/preflight/run.js';
export {
  PROBE_TIMEOUT_MS,
  runPreflight,
  runShellProbe,
} from '../../src/preflight/run.js';

export type {
  BuildLines,
  InstallOptions,
  InstallSeams,
} from '../../src/runtime/install.js';
export {
  EXIT_COULD_NOT_RUN,
  FORCE_FLAG,
  RAFA_PACKAGE_NAME,
  exitCodeFor,
  installRuntime,
  outcomeProblem,
  runBuild,
} from '../../src/runtime/install.js';

export {
  REMOTE,
  branchNameFor,
  hasDiverged,
  parseBaseStanding,
} from '../../src/start/branch-decision.js';

export {
  isBudgetExit,
  markBudgetExit,
} from '../../src/start/budget.js';

export { guardCheckout } from '../../src/start/checkout-guard.js';

export {
  advanceExpectation,
  haltIfCheckoutMoved,
  openCheckoutExpectation,
} from '../../src/start/checkout-watch.js';

export { announceRunDirs } from '../../src/start/checkout.js';

export {
  finishCleanExit,
  heldOnNothingLeftBehind,
} from '../../src/start/commit.js';

export {
  configuredRetries,
  refuseRetryWithoutBudget,
  refuseUnusableCriteria,
} from '../../src/start/continue-args.js';

export { LoopEnd } from '../../src/start/continue-exits.js';

export { createRunDecisions } from '../../src/start/continue-run.js';

export type { TaskLearning } from '../../src/start/dispatch.js';
export {
  dispatchTask,
  renderProgressForDispatch,
  storeTaskReport,
} from '../../src/start/dispatch.js';

export type { TaskHandout } from '../../src/start/handout.js';

export {
  bindEventsFile,
  emitLoopEvent,
  injectionPlace,
  taskPosition,
  taskTokens,
  unbindEventsFile,
  unlessText,
} from '../../src/start/loop-events.js';

export { holdWhilePaused } from '../../src/start/pause.js';

export {
  DEFAULT_PLAN_FILE,
  resolvePlanPath,
} from '../../src/start/plan-path.js';

export {
  CI_POLL_INTERVAL_MS,
  DEFAULT_CI_ATTEMPTS,
} from '../../src/start/pr-lifecycle.js';

export { retargetedLine } from '../../src/start/pr-retarget.js';

export { createStartPreflightClaim } from '../../src/start/preflight-claim.js';

export { createStartPreflightDrift } from '../../src/start/preflight-drift.js';

export { runStartPreflight } from '../../src/start/preflight.js';

export {
  createRunRetries,
  resolveRunRetries,
  retryTaskOf,
} from '../../src/start/retry-budget.js';

export { announceRiskTotal } from '../../src/start/risk-total.js';

export { settleRunCheckout } from '../../src/start/run-checkout.js';

export {
  announcePlanIssues,
  injectSourceLabel,
  loadRunConfig,
  refuseDetachedRun,
  refuseEffortDirRun,
} from '../../src/start/run-config.js';

export {
  guardRunBranch,
  readRunArgs,
  refuseWorktreeBesideCreateBranch,
  refuseWorktreeWhileTracking,
} from '../../src/start/run-setup.js';

export {
  RUNTIME_SUBDIR,
  refuseMisplacedRuntime,
  runFromSelectedRuntime,
} from '../../src/start/runtime.js';

export type { SessionServing } from '../../src/start/serving.js';
export { resolveSessionTiers } from '../../src/start/serving.js';

export { haltBeforeSession } from '../../src/start/session-guard.js';

export {
  openRunSession,
  readPreviousDecisionNeeded,
  readPreviousPassOver,
} from '../../src/start/session.js';

export {
  createStartStaleDocs,
  readStaleDocsVersion,
} from '../../src/start/stale-docs.js';

export { setActivePlanStub } from '../../src/start/stamp.js';

export {
  announceRunStepOnly,
  readRunStepOnly,
} from '../../src/start/step-only-report.js';

export { createRunSuiteSteps } from '../../src/start/suite-steps-run.js';

export { readAlwaysRunFiles } from '../../src/start/task-gate-lines.js';

export {
  createStartTriage,
  runStartFailures,
  unresolvedTracker,
} from '../../src/start/triage.js';

export { readTypeCheckRecipe } from '../../src/start/type-step.js';

export { worktreeDirAt } from '../../src/start/worktree-dir.js';

export { runWrapUp } from '../../src/start/wrap-up-run.js';

export type { WrapUpLearning } from '../../src/start/wrap-up.js';

export { createDeadlineSpawner } from '../../src/suite/deadline-spawn.js';

export type {
  JunitCase,
  SuiteFailure,
  SuiteResult,
  SuiteRunOptions,
  SuiteSpawner,
} from '../../src/suite/run.js';
export {
  parseJunitCases,
  runSuite,
  suiteEnv,
} from '../../src/suite/run.js';
