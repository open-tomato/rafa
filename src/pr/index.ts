/**
 * The pull request port, and what a caller outside `src/pr/` imports.
 *
 * `src/utils/pr.ts`, deleted with this barrel, was the one module the
 * wrap-up stage reached `gh` through, and it named the CLI in every
 * signature. This barrel is what replaced it: `./types.js` declares what a provider answers, `./gh.js` is the
 * adapter over the GitHub CLI, and `./checks.js` holds the check-row
 * readers, which are pure and belong to no provider.
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

export {
  classifyState,
  failingRows,
  formatRows,
  parseChecks,
  verdictOf,
  waitForChecks,
} from './checks.js';
export { isMergeMethod, MERGE_METHODS } from './types.js';
export { createGhPullRequests, ghAuthOk, ghAuthOkIn, ghPullRequestsIn } from './gh.js';
