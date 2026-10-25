/**
 * The open work `rafa epic move` names for an open issue that moves: every
 * scanned branch ref `branchClaims` reads as the issue's under the
 * project's branch template, named as a person types it (`branchNameOf`,
 * `packages/rafa-board/src/board/epic-horizon.ts`), and every open pull request whose body
 * closes it or whose head branch claims it, in ascending number.
 *
 * A claim branch is the template with the issue's stub,
 * `feat/rafa-<n>-<slug>` by default; {@link OpenWorkInput.branchTemplate}
 * carries the template the command read from `naming.branch`, and only
 * that template is read, so a branch under another one is no claim.
 *
 * A reading that fails — either half of the branch scan or the pull
 * request listing — is a problem sentence, never a throw, and the command
 * warns that the work named may be short. `./move.ts` holds the move and
 * calls {@link openWorkOf} for an open issue only.
 */
import type { OpenWork } from '../../board/epic-trail.js';
import type { OpenPullRequestLister, RoadmapPullRequest } from '../../board/roadmap.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { branchNameOf } from '../../board/epic-horizon.js';
import { branchClaims, closedIssuesIn, scanClaimBranches } from '../../board/roadmap.js';

/** What {@link openWorkOf} reads. */
export interface OpenWorkInput {
  /** The issue whose work is named. */
  readonly issue: number;
  /** Runs the branch scan's two git reads. */
  readonly git: GitRunner;
  /** The remote the branch scan asks; `origin` when left out. */
  readonly remote?: string;
  /** The branch template a branch claims the issue under; `DEFAULT_BRANCH_TEMPLATE` when left out. */
  readonly branchTemplate?: string;
  /** Every open pull request. */
  readonly pullRequests: OpenPullRequestLister;
}

/** The open work of an issue, with a sentence per reading that failed. */
export interface OpenWorkReading {
  readonly work: OpenWork;
  readonly problems: readonly string[];
}

/** True when `pull` is `issue`'s: its body closes it or its head branch claims it under `template`. */
export function pullIsFor(pull: RoadmapPullRequest, issue: number, template: string | undefined): boolean {
  return closedIssuesIn(pull.body).includes(issue) || branchClaims(pull.headRefName, issue, template);
}

/** The open work of `input.issue`; see the module note. */
export async function openWorkOf(input: OpenWorkInput): Promise<OpenWorkReading> {
  const scan = scanClaimBranches(input.git, input.remote, input.branchTemplate);
  const problems = [...scan.problems];
  let pulls: readonly RoadmapPullRequest[] = [];
  try {
    pulls = await input.pullRequests();
  } catch (error) {
    problems.push(`the open pull requests could not be read, so none is named: ${messageOf(error)}`);
  }
  const branches = scan.refs.filter((scanned) => branchClaims(scanned, input.issue, scan.branchTemplate)).map(branchNameOf);
  const numbers = pulls.filter((pull) => pullIsFor(pull, input.issue, scan.branchTemplate)).map((pull) => pull.number);
  return {
    work: Object.freeze({
      branches: Object.freeze([...new Set(branches)]),
      pullRequests: Object.freeze([...new Set(numbers)].sort((left, right) => left - right)),
    }),
    problems: Object.freeze(problems),
  };
}
