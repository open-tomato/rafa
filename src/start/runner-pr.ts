/**
 * The pull request the RUNNER opens: the last way a run's branch gets
 * one, after the wrap-up session and every retry it was given
 * (`loop.wrapUp.retries`, `start/wrap-up-retry.ts`) ended with none open
 * (`.rafa/specs/rafa-579-loop-run-ends-delivered.md`, #576).
 *
 * ## Only on a clean tree and a pushed branch
 *
 * The wrap-up session is the one that merges the base, commits and
 * pushes, and it did not finish. So the runner does not trust what it
 * left: {@link openRunnerPullRequest} reads the working tree first and
 * opens nothing over uncommitted edits, since a pull request opened then
 * would publish a branch that is not what the checkout holds, half a
 * merge among the possibilities. It then pushes the branch itself,
 * `--set-upstream` to `origin` (`pr/none.ts`), because the provider's
 * `create` never pushes (`pr/types.ts`, `PullRequestDraft`) and a branch
 * the session never pushed has no head on the remote to open from.
 * A push of a branch already up to date is git's own no-op, so pushing
 * unconditionally costs nothing and needs no second reading of the
 * remote. Only then is the pull request created.
 *
 * The three steps run in that order and the first to fail ends the
 * attempt: {@link RunnerPrOutcome} answers either the pull request as
 * opened, or `blocked`, naming the branch, the failed step
 * ({@link RUNNER_PR_STEPS}: dirty tree, push, create) and what was
 * wrong — the uncommitted files, what git said, or what the provider
 * said. A tree whose status git could not read at all is blocked at the
 * dirty-tree step too: an unread tree is not a clean one.
 *
 * Nothing here prints, throws or ends the run. The caller
 * (`start/wrap-up-run.ts`) reports the outcome, and a blocked one ends
 * the run with exit 1 and the record left `stopped`; that is why the
 * blocked outcome carries its report as {@link RunnerPrBlocked.message}.
 *
 * ## What the pull request says
 *
 * Its title is `rafa-<n>: <plan title>`, through
 * {@link pullRequestTitle} (`board/naming.ts`), the one spelling a
 * board-opened plan's pull request already has. Its body
 * ({@link runnerPullRequestBody}) opens `Closes #<n>`, so the merge
 * closes the issue as a wrap-up-opened pull request does, then carries
 * the release fragment's notes under a heading, and ends with
 * {@link UNFINISHED_WRAP_UP_LINE}, which tells the reviewer the wrap-up
 * did not finish and what that leaves to check. A fragment with no notes
 * gives the body no notes section rather than an empty heading.
 *
 * The notes are the fragment's as it stands in the checkout once
 * `finishRelease` has run: {@link fragmentNotesIn} reads the file that
 * stage verified and committed (`ReleaseFinish.fragment`), so the body
 * says what the commit ships, the session's rewrite or step 1's restored
 * text alike. A fragment that is absent or that `parseFragment` refuses
 * gives no notes.
 *
 * ## The project refresh
 *
 * Once the pull request is created, the issue its body closes is
 * refreshed on the repository's project
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "the loop's wrap-up opening a pull request — the issues it
 * closes"), so its Stage reads the open pull request. The refresh is a
 * mirror's catch-up and never the attempt's failure: its lines come back
 * in {@link RunnerPrOpened.warnings} for the caller to print after its
 * own, and a refresh that rejects is answered by `refreshFailedWarning`'s
 * line naming the issue and `rafa board sync`. A blocked attempt opened
 * nothing and refreshes nothing. {@link refreshClosedIssues} is the real
 * refresh: with `board.project.number` unset it opens no `gh` runner and
 * answers no line, so a repository that never opted in sees the attempt
 * alone.
 *
 * Every effect goes through {@link RunnerPrSeams}, so a test drives each
 * step's failure with no git, no network and no `gh`;
 * {@link runnerPrSeamsIn} holds the real ones over a checkout.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RefreshItems } from '../board/project/add-issue.js';
import type { RefreshConfig } from '../board/project/refresh.js';
import type { PullRequests, PullRequestSummary, PushOutcome } from '../pr/index.js';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createGhRunner } from '../adapters/tracker/github.js';
import { pullRequestTitle } from '../board/naming.js';
import { refreshFailedWarning, refreshIssueItems } from '../board/project/issue-board-refresh.js';
import { messageOf } from '../config-sections.js';
import { createGitRunner, ghPullRequestsIn, gitSaid, parseWorkingTree, pushBranch } from '../pr/index.js';
import { parseFragment } from '../release/fragment.js';

/** The steps an attempt can be blocked at, in the order they run. */
export const RUNNER_PR_STEPS = ['dirty tree', 'push', 'create'] as const;

/** One of {@link RUNNER_PR_STEPS}. */
export type RunnerPrStep = typeof RUNNER_PR_STEPS[number];

/** The heading the fragment's notes sit under in the body. */
export const RELEASE_NOTES_HEADING = '## Release notes';

/** The body's last line: the wrap-up did not finish, and what that leaves to check. */
export const UNFINISHED_WRAP_UP_LINE = '> ⚠️ The wrap-up did not finish: no wrap-up session opened this pull request, so the loop opened it. Check that the base is merged in, the release notes were rewritten and the lessons were promoted before merging.';

/** What the working tree read as, or why it could not be read. */
export type WorkingTreeReading =
  | { readonly ok: true; readonly entries: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The effects {@link openRunnerPullRequest} reaches through.
 * {@link runnerPrSeamsIn} makes the real ones.
 */
export interface RunnerPrSeams {
  /** The checkout's `git status --porcelain` lines, or why git could not answer. */
  readonly readWorkingTree: () => WorkingTreeReading;
  /** Pushes the branch to `origin` with upstream set. */
  readonly pushBranch: (branch: string) => Promise<PushOutcome>;
  /** The provider the pull request is created through. */
  readonly pulls: Pick<PullRequests, 'create'>;
  /** Refreshes `issues` on the project once the pull request is open, answering its warning lines. */
  readonly refreshProject: (issues: readonly number[]) => Promise<readonly string[]>;
}

/** What one runner-opened pull request is made from. */
export interface RunnerPrInput {
  /** The run's branch, the pull request's head. */
  readonly branch: string;
  /** The branch the pull request goes into. */
  readonly base: string;
  /** The issue the plan implements: `rafa-<n>` in the title, `Closes #<n>` in the body. */
  readonly issue: number;
  /** The plan's title, as its heading names it. */
  readonly planTitle: string;
  /** The release fragment's note lines, as {@link fragmentNotesIn} reads them. */
  readonly notes: readonly string[];
}

/** An attempt that opened the pull request. */
export interface RunnerPrOpened {
  readonly kind: 'opened';
  /** The pull request as the provider answered it. */
  readonly pull: PullRequestSummary;
  /** The project refresh's warning lines, for the caller to print after its own; empty for none. */
  readonly warnings: readonly string[];
}

/** An attempt a step stopped; see the module note. */
export interface RunnerPrBlocked {
  readonly kind: 'blocked';
  /** The branch no pull request was opened for. */
  readonly branch: string;
  /** The step that failed. */
  readonly step: RunnerPrStep;
  /** What was wrong: the uncommitted files, git's words, or the provider's. */
  readonly detail: string;
  /** The report naming the branch, the step and the detail, for the caller to print. */
  readonly message: string;
}

/** How one {@link openRunnerPullRequest} ended. */
export type RunnerPrOutcome = RunnerPrOpened | RunnerPrBlocked;

/** What {@link refreshClosedIssues} reads and refreshes through. */
export interface ClosedIssuesRefreshOptions {
  /** The config keys the refresh reads. */
  readonly config: RefreshConfig;
  /** Opens the runner the refresh sends through; called only with `board.project.number` set. */
  readonly openGh: () => GhRunner;
  /** The refresh; `refreshIssueItems` when left out. */
  readonly refresh?: RefreshItems;
}

/**
 * Refreshes `issues`, the ones the opened pull request closes, on the
 * project, answering every warning line; never rejects, and opens no
 * runner with `board.project.number` unset. See the module note.
 */
export async function refreshClosedIssues(options: ClosedIssuesRefreshOptions, issues: readonly number[]): Promise<readonly string[]> {
  const { config, openGh, refresh = refreshIssueItems } = options;
  if (config.boardProjectNumber === null || issues.length === 0) return [];
  try {
    return (await refresh({ config, gh: openGh() }, issues)).warnings;
  } catch (error) {
    return [refreshFailedWarning(issues[0] ?? 0, error)];
  }
}

/** The real seams, each made in `dir`, the run's checkout, the refresh reading `config`. */
export function runnerPrSeamsIn(dir: string, config: RefreshConfig): RunnerPrSeams {
  const git = createGitRunner(dir);
  return {
    readWorkingTree: () => {
      const status = git(['status', '--porcelain']);
      if (!status.ok) return { ok: false, reason: gitSaid(status) || 'git status failed and said nothing' };
      return { ok: true, entries: parseWorkingTree(status.stdout).entries };
    },
    pushBranch: (branch) => Promise.resolve(pushBranch(dir, branch)),
    pulls: ghPullRequestsIn(dir),
    refreshProject: (issues) => refreshClosedIssues({ config, openGh: () => createGhRunner({ cwd: dir }) }, issues),
  };
}

/**
 * The note lines of the fragment at `fragment`, relative to `checkout`,
 * or none when there is no fragment, the file cannot be read, or
 * `parseFragment` refuses it. See the module note.
 */
export function fragmentNotesIn(checkout: string, fragment: string | null): readonly string[] {
  if (fragment === null) return [];
  let text: string;
  try {
    text = readFileSync(path.resolve(checkout, fragment), 'utf8');
  } catch {
    return [];
  }
  const reading = parseFragment(text);
  return reading.ok
    ? reading.fragment.notes
    : [];
}

/**
 * The runner-opened pull request's body: `Closes #<n>`, the notes under
 * {@link RELEASE_NOTES_HEADING} when there are any, and
 * {@link UNFINISHED_WRAP_UP_LINE}.
 */
export function runnerPullRequestBody(issue: number, notes: readonly string[]): string {
  const section = notes.length === 0
    ? []
    : [RELEASE_NOTES_HEADING, '', ...notes, ''];
  return [`Closes #${String(issue)}`, '', ...section, UNFINISHED_WRAP_UP_LINE].join('\n');
}

/** A blocked outcome, its message composed from the branch, the step and the detail. */
function blocked(branch: string, step: RunnerPrStep, detail: string): RunnerPrBlocked {
  const message = [
    `❌ The run is blocked: the loop could not open the pull request for ${branch} at the ${step} step.`,
    ...detail.split('\n').map((line) => `   ${line}`),
  ].join('\n');
  return { kind: 'blocked', branch, step, detail, message };
}

/** The dirty-tree detail: how many entries, then each as git wrote it. */
function dirtyDetail(entries: readonly string[]): string {
  return [
    `The working tree holds ${String(entries.length)} uncommitted change(s); commit or discard them, then run again:`,
    ...entries.map((entry) => `  ${entry}`),
  ].join('\n');
}

/** The refresh of `issue` through `seams`, a rejection answered as its failed line; never rejects. */
async function refreshAfterOpen(seams: RunnerPrSeams, issue: number): Promise<readonly string[]> {
  try {
    return await seams.refreshProject([issue]);
  } catch (error) {
    return [refreshFailedWarning(issue, error)];
  }
}

/**
 * Opens the run's pull request: the tree read, the branch pushed, the
 * pull request created, each only once the one before succeeded, then
 * the issue it closes refreshed on the project. See the module note.
 */
export async function openRunnerPullRequest(input: RunnerPrInput, seams: RunnerPrSeams): Promise<RunnerPrOutcome> {
  const { branch } = input;

  const tree = seams.readWorkingTree();
  if (!tree.ok) return blocked(branch, 'dirty tree', `The working tree could not be read: ${tree.reason}`);
  if (tree.entries.length > 0) return blocked(branch, 'dirty tree', dirtyDetail(tree.entries));

  const push = await seams.pushBranch(branch);
  if (!push.ok) {
    const said = push.output.trim() === ''
      ? 'git push failed and said nothing'
      : push.output.trim();
    return blocked(branch, 'push', said);
  }

  let pull: PullRequestSummary;
  try {
    pull = await seams.pulls.create({
      head: branch,
      base: input.base,
      title: pullRequestTitle(input.issue, input.planTitle),
      body: runnerPullRequestBody(input.issue, input.notes),
    });
  } catch (error) {
    return blocked(branch, 'create', messageOf(error));
  }
  return { kind: 'opened', pull, warnings: await refreshAfterOpen(seams, input.issue) };
}
