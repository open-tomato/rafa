/**
 * The facade of `rafa-pr`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-pr --entry`.
 */

export {
  bodyOf,
  checkoutOf,
  draftOf,
  redacted,
  settled,
} from '../../src/bugs/fill.js';

export {
  DIRTY_MARK,
  NO_COMMIT,
  codeVersionOf,
  versionsText,
} from '../../src/bugs/versions.js';

export type {
  BranchSettings,
  BranchesRead,
  BranchesReading,
  BranchesUnread,
  LocalBranch,
} from '../../src/cleanup/branches.js';
export {
  isKept,
  readBranches,
  readRemoteHead,
  resolveBaseBranch,
} from '../../src/cleanup/branches.js';

export type {
  BranchGroup,
  BranchGroups,
  BranchGroupsReading,
  BranchGroupsUnread,
  BranchHolder,
  BranchRow,
  GroupSettings,
  MergedBy,
  MergedRow,
  NotPushedRow,
  ProviderMerges,
  ReleasePaths,
  StaleRow,
} from '../../src/cleanup/groups.js';
export {
  MERGED_STATE_UNKNOWN,
  classifyBranches,
  holdBranchRows,
  readProviderMerges,
} from '../../src/cleanup/groups.js';

export type {
  CleanupFiles,
  CleanupOutcome,
  CleanupPlan,
  CleanupSelection,
  CleanupStep,
  CleanupStepKind,
  WithheldRemoval,
} from '../../src/cleanup/steps.js';
export {
  cleanupCommandLine,
  cleanupSteps,
  deletedNotPushed,
  dryRunLines,
  forcedFlagRefusal,
  removeRunStep,
  runCleanupSteps,
} from '../../src/cleanup/steps.js';

export { PR_SUBJECT } from '../../src/commands/pr/declarations.js';

export type { PrSeams } from '../../src/commands/pr/pr-context.js';
export {
  DEFAULT_PR_SEAMS,
  onProvider,
  openPrContext,
} from '../../src/commands/pr/pr-context.js';

export type { TriageShape } from '../../src/config-schema-triage.js';
export {
  TRIAGE_DEFAULTS,
  TRIAGE_SECTION,
  TRIAGE_SETTINGS,
} from '../../src/config-schema-triage.js';

export type {
  OpenLinesTracker,
  OpenStaleDocLine,
} from '../../src/docs/open-lines.js';
export { readOpenStaleDocLines } from '../../src/docs/open-lines.js';

export type {
  StaleDocEntry,
  StaleDocLineResult,
  StaleDocTickResult,
  StaleDocsTracker,
} from '../../src/docs/release-issue.js';
export {
  DOC_UPDATE_TASK_PREFIX,
  DOC_UPDATE_TITLE,
  addStaleDocLine,
  docUpdateLineText,
  staleDocLineText,
  staleDocsVersion,
  tickStaleDocLine,
} from '../../src/docs/release-issue.js';

export type { DocTaskInputOptions } from '../../src/docs/task-reading.js';
export {
  readDocTaskInput,
  renderDocTaskSection,
} from '../../src/docs/task-reading.js';

export type { NextOwnerGateOptions } from '../../src/next/owner-gate.js';
export { nextOwnerGate } from '../../src/next/owner-gate.js';

export { openNextRelations } from '../../src/next/relations-mode.js';

export {
  followsMerge,
  readSettleAfterMerge,
} from '../../src/next/settle-step.js';

export type {
  NextBoardOptions,
  NextSourceSeams,
  OpenedNextSources,
} from '../../src/next/sources.js';
export {
  DEFAULT_BASE_BRANCH,
  ghNextBoard,
  openNextSources,
} from '../../src/next/sources.js';

export type {
  RiskFinding,
  RiskReport,
} from '../../src/plan/risk.js';
export {
  assessPlanRisk,
  renderRiskText,
  riskTotalLine,
} from '../../src/plan/risk.js';

export type { AccountSeams } from '../../src/plan/risk/accounts.js';

export { mechanicalConflictBullet } from '../../src/pr/conflict-sentence.js';

export type {
  CheckRow,
  ChecksVerdict,
  GitResult,
  GitRunner,
  Mergeability,
  PrProviderReading,
  PullRequestDetail,
  PullRequestDraft,
  PullRequestSummary,
  PullRequests,
  PushOutcome,
  ResolvePrProviderOptions,
  WaitOptions,
  WaitResult,
  WorkingTreeStatus,
  WorktreeEntry,
} from '../../src/pr/index.js';
export {
  compareUrl,
  createGhPullRequests,
  createGitRunner,
  failingRows,
  formatRows,
  ghAuthOkIn,
  ghHostOf,
  ghPreflightItems,
  ghPullRequestsIn,
  gitSaid,
  parseWorkingTree,
  parseWorktrees,
  pushBranch,
  requireGhProvider,
  resolvePrProvider,
  waitForChecks,
} from '../../src/pr/index.js';

export type { OwnerApproval } from '../../src/pr/owner-approval.js';

export {
  ghMissingMessage,
  ghUnauthenticatedMessage,
  shellQuote,
} from '../../src/pr/preflight-items.js';

export { parseFailedLogLine } from '../../src/pr/triage/evidence.js';

export type { MergedPullRequest } from '../../src/pr/types.js';

export { WORKTREES_SUBDIR } from '../../src/pr/worktree.js';

export type {
  BaseRunAnswer,
  NamedTest,
} from '../../src/triage/base-run.js';
export {
  createBaseRunCache,
  runNamedTestAt,
} from '../../src/triage/base-run.js';

export {
  artifactOf,
  hasText,
} from '../../src/triage/bug-key.js';

export type { InheritedTriage } from '../../src/triage/inherited.js';
export { inheritedFailureOf } from '../../src/triage/inherited.js';

export { scoreText } from '../../src/triage/issue-text.js';

export type { KindRouteOptions } from '../../src/triage/kind-route.js';
export { checkedKindOf } from '../../src/triage/kind-route.js';

export { isLeftoverRepairTask } from '../../src/triage/leftover-repair.js';

export {
  readPlanBase,
  readPlanFiles,
} from '../../src/triage/plan-commits.js';

export type {
  BoardIssue,
  CauseJudgement,
  Filing,
  ScoringFixture,
} from '../../src/triage/scoring-fixture.js';
export {
  FIXTURE_REPO,
  causeOf,
  filingsOf,
} from '../../src/triage/scoring-fixture.js';

export type { RankedFields } from '../../src/triage/similarity.js';
export {
  causeSignalOf,
  issueWordsOf,
  jaccard,
  sharesBoundary,
  wordSetOf,
} from '../../src/triage/similarity.js';

export type {
  BugTriage,
  NamedSecret,
  SecretEnvironment,
  TriageOptions,
  TriageResult,
} from '../../src/triage/triage.js';
export {
  TRIAGE_MODULE,
  blockerTextOf,
  namedSecrets,
  redactSecrets,
  triageReport,
} from '../../src/triage/triage.js';
