/**
 * The facade of `rafa-run`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-run --entry`.
 */

export { readDeviceStoreId } from './src/claims/device.js';

export { STAGE_LABELS } from './src/claims/labels.js';

export type {
  PlanClaim,
  PlanClaimContext,
  PlanClaimRequest,
} from './src/claims/plan-claim.js';
export { claimPlanIssue } from './src/claims/plan-claim.js';

export type {
  BranchRow,
  CleanupCounts,
  CleanupRead,
  CleanupReading,
  CleanupSeams,
  CleanupSettings,
  MergedBy,
  MergedRow,
  NotPushedRow,
  StaleRow,
  WorktreeBlockKind,
  WorktreeRow,
} from './src/cleanup/index.js';
export {
  cleanupCounts,
  defaultCleanupSeams,
  readCleanup,
} from './src/cleanup/index.js';

export type { RemoteOnlyRow } from './src/cleanup/remote-only.js';

export type { RunRow } from './src/cleanup/runs.js';

export type {
  CleanupOutcome,
  CleanupPlan,
  CleanupSelection,
  CleanupStepKind,
} from './src/cleanup/steps.js';
export {
  cleanupSteps,
  deletedNotPushed,
  dryRunLines,
  runCleanupSteps,
} from './src/cleanup/steps.js';

export { CLAIM_SUBJECT } from './src/commands/claim/declarations.js';

export { default as command } from './src/commands/switch.js';

export type { EventLine } from './src/loop/events-file.js';
export {
  eventsFileOf,
  readEventsFrom,
} from './src/loop/events-file.js';

export type {
  NextActionOptions,
  NextInvocation,
} from './src/next/actions.js';
export {
  LABELS_ONLY_ACTIONS,
  NEXT_COMMAND_ACTIONS,
  actionInvocation,
  runAction,
} from './src/next/actions.js';

export {
  actionOutput,
  endWithNextStep,
  endingWith,
} from './src/next/ending.js';

export {
  commandWords,
  nextQuestion,
} from './src/next/hint.js';

export type { NextHopStep } from './src/next/hop-rows.js';

export type { NextOwnerGateOptions } from './src/next/owner-gate.js';
export { nextOwnerGate } from './src/next/owner-gate.js';

export type {
  DryEpic,
  NextBoard,
  NextRoadmapReading,
  NextSources,
  OpenPull,
  PickedLine,
} from './src/next/readings.js';
export {
  readBranch,
  readBranchPlan,
  readOpenPull,
  readPlans,
} from './src/next/readings.js';

export { openNextRelations } from './src/next/relations-mode.js';

export {
  followsMerge,
  readSettleAfterMerge,
} from './src/next/settle-step.js';

export type {
  NextBoardOptions,
  NextSourceSeams,
  OpenedNextSources,
} from './src/next/sources.js';
export {
  ghNextBoard,
  openNextSources,
} from './src/next/sources.js';

export type {
  NextActionId,
  NextAnswerId,
  NextState,
} from './src/next/state.js';
export {
  readHomeAfterLoop,
  readNextState,
} from './src/next/state.js';

export type {
  PlanList,
  PlanListing,
} from './src/plan/list.js';
export { listPlans } from './src/plan/list.js';

export type { StoreRuleProblem } from './src/plan/store-rules.js';
export {
  findStoreRuleProblems,
  storeRuleLine,
} from './src/plan/store-rules.js';

export { isFirstDispatch } from './src/preflight/first-dispatch.js';

export type {
  BuildLines,
  InstallOptions,
  InstallSeams,
} from './src/runtime/install.js';
export {
  EXIT_COULD_NOT_RUN,
  FORCE_FLAG,
  exitCodeFor,
  installRuntime,
  outcomeProblem,
  runBuild,
} from './src/runtime/install.js';

export {
  isBudgetExit,
  markBudgetExit,
} from './src/start/budget.js';

export { guardCheckout } from './src/start/checkout-guard.js';

export {
  advanceExpectation,
  haltIfCheckoutMoved,
  openCheckoutExpectation,
} from './src/start/checkout-watch.js';

export { announceRunDirs } from './src/start/checkout.js';

export {
  finishCleanExit,
  heldOnNothingLeftBehind,
} from './src/start/commit.js';

export {
  configuredRetries,
  refuseRetryWithoutBudget,
  refuseUnusableCriteria,
} from './src/start/continue-args.js';

export { LoopEnd } from './src/start/continue-exits.js';

export { createRunDecisions } from './src/start/continue-run.js';

export type { TaskLearning } from './src/start/dispatch.js';
export {
  dispatchTask,
  renderProgressForDispatch,
  storeTaskReport,
} from './src/start/dispatch.js';

export type { TaskHandout } from './src/start/handout.js';

export {
  bindEventsFile,
  emitLoopEvent,
  injectionPlace,
  taskPosition,
  taskTokens,
  unbindEventsFile,
  unlessText,
} from './src/start/loop-events.js';

export { holdWhilePaused } from './src/start/pause.js';

export {
  DEFAULT_PLAN_FILE,
  resolvePlanPath,
} from './src/start/plan-path.js';

export { DEFAULT_CI_ATTEMPTS } from './src/start/pr-lifecycle.js';

export { createStartPreflightClaim } from './src/start/preflight-claim.js';

export { createStartPreflightDrift } from './src/start/preflight-drift.js';

export { runStartPreflight } from './src/start/preflight.js';

export {
  createRunRetries,
  resolveRunRetries,
  retryTaskOf,
} from './src/start/retry-budget.js';

export { announceRiskTotal } from './src/start/risk-total.js';

export { settleRunCheckout } from './src/start/run-checkout.js';

export {
  announcePlanIssues,
  injectSourceLabel,
  loadRunConfig,
  refuseDetachedRun,
  refuseEffortDirRun,
} from './src/start/run-config.js';

export {
  guardRunBranch,
  readRunArgs,
  refuseWorktreeBesideCreateBranch,
  refuseWorktreeWhileTracking,
} from './src/start/run-setup.js';

export {
  refuseMisplacedRuntime,
  runFromSelectedRuntime,
} from './src/start/runtime.js';

export { haltBeforeSession } from './src/start/session-guard.js';

export {
  openRunSession,
  readPreviousDecisionNeeded,
  readPreviousPassOver,
} from './src/start/session.js';

export {
  createStartStaleDocs,
  readStaleDocsVersion,
} from './src/start/stale-docs.js';

export { setActivePlanStub } from './src/start/stamp.js';

export {
  announceRunStepOnly,
  readRunStepOnly,
} from './src/start/step-only-report.js';

export { createRunSuiteSteps } from './src/start/suite-steps-run.js';

export { readAlwaysRunFiles } from './src/start/task-gate-lines.js';

export {
  createStartTriage,
  runStartFailures,
} from './src/start/triage.js';

export { readTypeCheckRecipe } from './src/start/type-step.js';

export { runWrapUp } from './src/start/wrap-up-run.js';

export type { WrapUpLearning } from './src/start/wrap-up.js';

export { createDeadlineSpawner } from './src/suite/deadline-spawn.js';
