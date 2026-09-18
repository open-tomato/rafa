/**
 * The pull request port, and what a caller outside `src/pr/` imports.
 *
 * `src/utils/pr.ts`, deleted with this barrel, was the one module the
 * wrap-up stage reached `gh` through, and it named the CLI in every
 * signature. This barrel is what replaced it: `./types.js` declares what a provider answers, `./gh.js` is the
 * adapter over the GitHub CLI, `./checks.js` holds the check-row
 * readers, which are pure and belong to no provider,
 * `./merge.js` holds what `pr merge` refuses on and the clean-up steps
 * it runs afterwards, both as data, and
 * `./provider.js` answers which provider a repository gets and holds
 * the one exit-2 refusal every `pr` action shares,
 * `./preflight-items.js` builds the two required preflight items a `gh`
 * provider contributes, and `./none.js` is what a `none` provider gets
 * in place of a pull request: the branch pushed and a compare URL.
 *
 * It is a barrel, so it is imported as `../pr/index.js` and never as
 * `../pr.js` (`context/source.md`). It re-exports and defines nothing:
 * a caller needing a symbol that is not listed here adds it to the
 * module that owns it first.
 *
 * `./gh-fake.js` and `./gh-fake-shapes.js` are deliberately NOT here.
 * They are test helpers, and a barrel carrying them would put the
 * recorded fixtures of every `gh` answer into the import graph of the
 * loop itself.
 *
 * One caller outside `src/pr/` reaches past this barrel on purpose:
 * `src/config-sections.ts` takes `MERGE_METHODS` and `MergeMethod` from
 * `./types.js` directly, for `pr.mergeMethod`. `./gh.js` imports that
 * module, so the barrel would put the `gh` adapter and its spawner
 * behind every config read and make the graph cyclic. Its note records
 * the readings behind that choice; nothing else bypasses this file.
 */

export type {
  CheckOutcome,
  CheckRow,
  ChecksVerdict,
  WaitOptions,
  WaitResult,
} from './checks.js';
export type {
  ChecksReading,
  Mergeability,
  MergeMethod,
  MergeOutcome,
  PullRequestAuthor,
  PullRequestComment,
  PullRequestDetail,
  PullRequests,
  PullRequestState,
  PullRequestSummary,
} from './types.js';
export type { GhPullRequestsOptions } from './gh.js';
export type {
  CleanUpPlan,
  MergeRefusal,
  MergeRefusalReading,
  MergeRefusalReason,
  MergeState,
  MergeStep,
  MergeStepId,
  WorkingTreeStatus,
  WorktreeEntry,
} from './merge.js';
export type { PushOutcome } from './none.js';
export type {
  GhProviderReading,
  PrProviderReading,
  PrProviderSource,
  ResolvePrProviderOptions,
} from './provider.js';

export {
  classifyState,
  failingRows,
  formatRows,
  parseChecks,
  verdictOf,
  waitForChecks,
} from './checks.js';
export { isMergeMethod, MERGE_METHODS } from './types.js';
export {
  cleanUpSteps,
  commandLine,
  parseWorkingTree,
  parseWorktrees,
  readMergeRefusal,
  remainingFrom,
  worktreesHolding,
} from './merge.js';
export { compareUrl, pushBranch } from './none.js';
export { createGhPullRequests, ghAuthOk, ghAuthOkIn, ghPullRequestsIn } from './gh.js';
export {
  DEFAULT_GH_HOST,
  GH_INSTALL_LINE,
  ghAuthItem,
  ghAuthLine,
  ghHostOf,
  ghOnPathItem,
  ghPreflightItems,
} from './preflight-items.js';
export {
  isGitHubRemote,
  PR_NEEDS_GH,
  PR_REFUSAL_EXIT,
  remoteHost,
  requireGhProvider,
  resolvePrProvider,
} from './provider.js';
