/**
 * The facade of `rafa-pr`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-pr --entry`.
 */

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
  heldReason,
  holdBranchRows,
  readProviderMerges,
} from '../../src/cleanup/groups.js';

export type {
  WorktreeBlockKind,
  WorktreeBlocker,
  WorktreeRead,
  WorktreeRow,
  WorktreeSeams,
  WorktreesRead,
  WorktreesReading,
  WorktreesUnread,
} from '../../src/cleanup/worktrees.js';
export {
  ADMIN_FILES,
  GIT_DIR,
  defaultWorktreeSeams,
  readWorktrees,
} from '../../src/cleanup/worktrees.js';

export { PR_SUBJECT } from '../../src/commands/pr/declarations.js';

export {
  baseWarning,
  openPull,
  renderOpen,
} from '../../src/commands/pr/open-pull.js';

export type { PrSeams } from '../../src/commands/pr/pr-context.js';
export {
  DEFAULT_PR_SEAMS,
  onProvider,
  openPrContext,
} from '../../src/commands/pr/pr-context.js';

export type { DocTaskInputOptions } from '../../src/docs/task-reading.js';
export {
  readDocTaskInput,
  renderDocTaskSection,
} from '../../src/docs/task-reading.js';

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
  PullRequestSummary,
  PullRequests,
  PushOutcome,
  ResolvePrProviderOptions,
  WaitOptions,
  WaitResult,
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
  parseWorktrees,
  pushBranch,
  requireGhProvider,
  resolvePrProvider,
  waitForChecks,
} from '../../src/pr/index.js';

export type { OwnerApproval } from '../../src/pr/owner-approval.js';
export {
  createGhTeamMembership,
  readOwnerApproval,
} from '../../src/pr/owner-approval.js';

export {
  ghMissingMessage,
  ghUnauthenticatedMessage,
} from '../../src/pr/preflight-items.js';

export type { SettleWaiting } from '../../src/pr/settle-waiting.js';
export { settleWaitingOn } from '../../src/pr/settle-waiting.js';

export { parseFailedLogLine } from '../../src/pr/triage/evidence.js';

export { retargetPullRequest } from '../../src/start/pr-retarget.js';

export type {
  BaseRunAnswer,
  NamedTest,
} from '../../src/triage/base-run.js';
export {
  createBaseRunCache,
  runNamedTestAt,
} from '../../src/triage/base-run.js';

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
  TriageOptions,
  TriageResult,
} from '../../src/triage/triage.js';
export {
  blockerTextOf,
  triageReport,
} from '../../src/triage/triage.js';
