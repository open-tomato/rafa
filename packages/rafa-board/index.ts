/**
 * The facade of `rafa-board`: every name a file outside the
 * package imports from it, re-exported from where it lives today.
 * Written by `bun scripts/survey/facade-names.ts --package=rafa-board --entry`.
 */

export type {
  GhResult,
  GhRunner,
  GhRunnerOptions,
} from '../../src/adapters/tracker/github.js';
export {
  GITHUB_LABELS,
  GITHUB_LABEL_MAX_LENGTH,
  createGhRunner,
  createGithubTracker,
} from '../../src/adapters/tracker/github.js';

export type { LocalTrackerOptions } from '../../src/adapters/tracker/local.js';
export {
  createLocalTracker,
  localIssuesDir,
} from '../../src/adapters/tracker/local.js';

export type {
  ResolveTrackerOptions,
  TrackerResolution,
} from '../../src/adapters/tracker/resolve.js';
export { resolveTracker } from '../../src/adapters/tracker/resolve.js';

export type { BlockedIssuesReport } from '../../src/board/blocked-issues.js';
export { readBlockedIssues } from '../../src/board/blocked-issues.js';

export type {
  AlternativeOffer,
  AlternativeOfferRequest,
  BlockedLine,
} from '../../src/board/blocked-line.js';
export {
  alternativeQuestion,
  blockedLineSentence,
  notReadySentence,
} from '../../src/board/blocked-line.js';

export type { BlockedReading } from '../../src/board/blocked.js';
export {
  SPEC_BLOCKED_LABEL,
  hasSpecBlockedLabel,
  readBlockedBy,
} from '../../src/board/blocked.js';

export {
  isOwnerHandle,
  normaliseFolder,
  readBoardBody,
} from '../../src/board/board-body.js';

export {
  createCachedBoardListing,
  invalidateRows,
} from '../../src/board/board-cache.js';

export type { OwnedBoard } from '../../src/board/board-owns.js';
export {
  ownedBoard,
  owningBoard,
} from '../../src/board/board-owns.js';

export type { DefaultBoard } from '../../src/board/boards.js';
export {
  createGhBoardLister,
  resolveDefaultBoard,
  unlabelledRoadmapMessage,
} from '../../src/board/boards.js';

export type { BranchScan } from '../../src/board/branch-scan.js';
export { scanClaimBranches } from '../../src/board/branch-scan.js';

export type { Codeowners } from '../../src/board/codeowners.js';
export { readCodeowners } from '../../src/board/codeowners.js';

export { readConfiguredRelations } from '../../src/board/configured-relations.js';

export type { BoardView } from '../../src/board/epic-board.js';
export {
  boardOfEpic,
  openBoards,
} from '../../src/board/epic-board.js';

export { cancelledEpicNoticeLines } from '../../src/board/epic-cancel-notice.js';

export type { EpicContext } from '../../src/board/epic-context.js';
export {
  epicContextArgs,
  readEpicContext,
} from '../../src/board/epic-context.js';

export {
  EPIC_GUARD_PATH,
  writeEpicGuard,
} from '../../src/board/epic-guard.js';

export type { EpicProblem } from '../../src/board/epic-problems.js';
export {
  epicProblemMessage,
  readEpicProblems,
} from '../../src/board/epic-problems.js';

export type { EpicTickOptions } from '../../src/board/epic-tick.js';
export {
  epicTickSentence,
  tickEpics,
} from '../../src/board/epic-tick.js';

export type { NextNowEpic } from '../../src/board/epic-walk.js';
export { isEpicIssue } from '../../src/board/epic-walk.js';

export type {
  Epic,
  EpicRelations,
  Epics,
} from '../../src/board/epics.js';
export {
  EPIC_LABEL_PREFIX,
  epicSlugsOf,
  readEpics,
} from '../../src/board/epics.js';

export { SKIP_REVIEW_FLAG } from '../../src/board/flags.js';

export type {
  GateIssue,
  SpecReviewGateOptions,
} from '../../src/board/gate.js';
export {
  enforceSpecReview,
  readGateFlags,
} from '../../src/board/gate.js';

export type { IssueBoard } from '../../src/board/issue-board.js';

export type {
  SpecIssue,
  SpecIssueReader,
} from '../../src/board/issue.js';
export { createGhSpecIssueReader } from '../../src/board/issue.js';

export { firstNowEpic } from '../../src/board/now-epic.js';

export type {
  OwnerResolution,
  OwnerResolver,
} from '../../src/board/owner-resolve.js';
export { createOwnerResolver } from '../../src/board/owner-resolve.js';

export type {
  PlaceNotice,
  ResolvedPlace,
} from '../../src/board/place.js';
export {
  resolvePlace,
  samePlace,
} from '../../src/board/place.js';

export type { PlanFieldStamp } from '../../src/board/plan-field.js';
export {
  issueFieldLine,
  stampPlanIssue,
} from '../../src/board/plan-field.js';

export type {
  PlanSpecOptions,
  PlanSpecResolution,
  ReadyOffer,
  ReadyOfferRequest,
} from '../../src/board/plan-spec.js';
export {
  boardRepoLabel,
  resolvePlanSpec,
} from '../../src/board/plan-spec.js';

export {
  PREVIOUS_COPY_WARN_ABOVE,
  countPreviousCopies,
  previousDir,
} from '../../src/board/previous-copy.js';

export { addFiledBugs } from '../../src/board/project/add-filed.js';

export type {
  RefreshAddedItems,
  RefreshItems,
} from '../../src/board/project/add-issue.js';

export { readIssueFacts } from '../../src/board/project/facts.js';

export { createGhProjectPort } from '../../src/board/project/gh.js';

export {
  createRefreshingGhIssueBoard,
  refreshFailedWarning,
  refreshIssueItems,
} from '../../src/board/project/issue-board-refresh.js';

export type {
  Project,
  ProjectItem,
  ProjectPort,
  ProjectRef,
} from '../../src/board/project/port.js';
export { matchProjectFields } from '../../src/board/project/port.js';

export type { ProgressFeed } from '../../src/board/project/progress.js';
export {
  commandProgressFeed,
  openPhase,
} from '../../src/board/project/progress.js';

export type {
  ProjectRetryConfig,
  ProjectRunnerSeams,
  RetryReport,
} from '../../src/board/project/project-runner.js';
export {
  commandRetrySeams,
  openProjectRunner,
} from '../../src/board/project/project-runner.js';

export {
  BOARD_SYNC_FIX,
  PROJECT_SCOPE_FIX,
  isMissingProjectScope,
  notRefreshedWarning,
  rateLimitWarning,
  skippedFieldWarning,
} from '../../src/board/project/refresh-warnings.js';

export type {
  ProjectRefresh,
  ProjectRefreshed,
  RefreshConfig,
  RefreshOptions,
} from '../../src/board/project/refresh.js';
export {
  readRefreshBoard,
  refreshProjectItems,
} from '../../src/board/project/refresh.js';

export {
  rankOf,
  stageOf,
} from '../../src/board/project/rules.js';

export {
  SPEC_READY_LABEL,
  findPinnedMigrations,
} from '../../src/board/readiness.js';

export { LABELS_READS } from '../../src/board/relations/labels.js';

export type {
  RelationsMoveFailure,
  RelationsMovePlan,
  RelationsMoveResult,
} from '../../src/board/relations/move.js';
export {
  planRelationsMove,
  writeRelationsMove,
} from '../../src/board/relations/move.js';

export { createNativeRelations } from '../../src/board/relations/native.js';

export type {
  BlockersReading,
  BoardRelations,
  RelationsReading,
} from '../../src/board/relations/port.js';
export { isWaiting } from '../../src/board/relations/port.js';

export { selectBoardRelations } from '../../src/board/relations/select.js';

export { readBoardRepository } from '../../src/board/repository.js';

export {
  ASSUMPTIONS_HEADING,
  REVIEW_MISSING_LINE,
  REVIEW_SKIPPED_LINE,
  stampReviewMissing,
  stampReviewSkipped,
} from '../../src/board/review-stamp.js';

export type {
  BoardIssue,
  BoardIssueLink,
  BoardIssueState,
  BoardListing,
} from '../../src/board/roadmap-board.js';
export {
  BOARD_LISTING_LIMIT,
  createGhBoardListing,
  parseBoardListing,
} from '../../src/board/roadmap-board.js';

export {
  claimBranchOfRef,
  idleText,
  weighBranchClaim,
} from '../../src/board/roadmap-claims.js';

export type { Horizon } from '../../src/board/roadmap-epic-rows.js';
export {
  horizonOf,
  readListedEpics,
} from '../../src/board/roadmap-epic-rows.js';

export { readCurrentPlace } from '../../src/board/roadmap-rows.js';

export type { RoadmapTickResult } from '../../src/board/roadmap-tick.js';
export {
  createGhRoadmapBody,
  tickRoadmapIssue,
  tickSentence,
} from '../../src/board/roadmap-tick.js';

export type {
  RoadmapLine,
  RoadmapReadings,
} from '../../src/board/roadmap.js';
export {
  closedIssuesIn,
  createGhOpenPullRequests,
  createGhRoadmapSearch,
  createRoadmapReadings,
  parseRoadmapBody,
} from '../../src/board/roadmap.js';

export { readRoadmapSetting } from '../../src/board/setup-config.js';

export type {
  BoardOutcome,
  BoardPart,
} from '../../src/board/setup-parts.js';

export { ROADMAP_LABEL } from '../../src/board/setup-roadmap.js';

export type { BoardSetupReport } from '../../src/board/setup.js';
export {
  TEMPLATES_DIRNAME,
  anythingAt,
  boardChanged,
  listBoardLabels,
  missingBoardLabels,
  setUpBoard,
  setUpLabels,
  writeShippedFile,
} from '../../src/board/setup.js';

export type {
  RefreshOffer,
  RefreshOfferRequest,
} from '../../src/board/snapshot-settle.js';
export { refreshQuestion } from '../../src/board/snapshot-settle.js';

export type { SpecReviewReading } from '../../src/board/spec-review.js';
export { parseSpecReview } from '../../src/board/spec-review.js';

export type { ResolvedSpec } from '../../src/board/spec-source.js';
export {
  SOURCE_REFUSAL_EXIT,
  noSourceMessage,
  readSpecSourceFlags,
} from '../../src/board/spec-source.js';

export type {
  BoardRow,
  BoardStatus,
  BoardStatusOutcome,
} from '../../src/board/status.js';
export {
  boardGaps,
  readBoardStatus,
} from '../../src/board/status.js';

export type {
  BoardTrust,
  Permissions,
  TrustReading,
} from '../../src/board/trust.js';
export {
  createGhPermissions,
  ghBoardTrust,
  readAuthorTrust,
  readBoardTrust,
  requireTrustedAuthor,
  trustRefusalClause,
} from '../../src/board/trust.js';

export { unblockAfterMerge } from '../../src/board/unblock-after-merge.js';

export type {
  UnblockAsk,
  UnblockReport,
} from '../../src/board/unblock.js';

export { causeOf } from '../../src/bugs/cause-rule.js';

export { BOARD_SUBJECT } from '../../src/commands/board/declarations.js';

export type {
  DoctorRefsReading,
  DoctorRefsSeams,
} from '../../src/commands/doctor-refs.js';
export {
  readDoctorRefs,
  renderDoctorRefs,
} from '../../src/commands/doctor-refs.js';

export { EPIC_SUBJECT } from '../../src/commands/epic/declarations.js';

export { NATIVE_MODE } from '../../src/commands/epic/move-native.js';

export {
  ISSUE_LIST_FLAGS,
  ISSUE_SUBJECT,
} from '../../src/commands/issue/declarations.js';

export type {
  IssueSeams,
  IssueTrackerData,
  LineFlags,
} from '../../src/commands/issue/issue-tracker.js';
export {
  DEFAULT_ISSUE_SEAMS,
  expectTwoArguments,
  issueName,
  issueProject,
  issueRef,
  issueSubjectConfig,
  lineRefusal,
  onTracker,
  readChoiceFlag,
  readNonBlankFlag,
  readRequiredFlag,
  readTextFlag,
  resolveIssueTracker,
} from '../../src/commands/issue/issue-tracker.js';

// Type-only on purpose: a value export would load the issue-ready command
// module with the facade, and the roster keeps feature command modules lazy.
export type { ReadyReport, runIssueReady } from '../../src/commands/issue/ready.js';

export {
  CREATE_DANGEROUS_PHRASES,
  checkCreateRefs,
  registryRoster,
} from '../../src/commands/plan/refs-check.js';

export type { CriterionCheck } from '../../src/epic/verify-plan.js';
export { fenceFor } from '../../src/epic/verify-plan.js';

export type {
  HopDecision,
  HopHalt,
  HopMove,
  TakenBy,
} from '../../src/next/hop-chain.js';
export {
  hopDecisionSentence,
  hopMoveSentence,
  oneHopAllows,
} from '../../src/next/hop-chain.js';

export {
  awayTargetOf,
  blockedLineReadings,
  followHopRecord,
  pickerFor,
  readHopAnswer,
  walkBoard,
  walkEpic,
  walkTarget,
} from '../../src/next/relation-readings.js';

export type { Ref } from '../../src/refs/extract.js';
export { extractRefs } from '../../src/refs/extract.js';

export type { LiveReading } from '../../src/refs/stamp.js';
export { fingerprintText } from '../../src/refs/stamp.js';

export type { RefVerifier } from '../../src/refs/verify.js';
export {
  createRefVerifier,
  tsSymbolsOutliner,
} from '../../src/refs/verify.js';
