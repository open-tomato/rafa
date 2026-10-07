/**
 * The git half of `rafa pr merge`'s refusals: {@link refuseFromGit}
 * gathers at the project root everything `readMergeRefusal`
 * (`src/pr/merge.ts`) decides from and refuses with exit code 1 on what
 * it answers.
 *
 * It reads `git status --porcelain` for the working tree,
 * `git ls-tree -r --name-only` over the pull request's head commit
 * (`headRefOid`) and over `origin/<base>` for the paths the merge
 * brings in — only when the tree has an untracked path, since only an
 * untracked path is weighed against them (`src/pr/merge.ts`, "Which
 * untracked paths refuse") —
 * `git worktree list --porcelain` for the worktrees (once, and again
 * after the loop worktree step freed one), and
 * `git rev-parse --show-toplevel` for the repository root. Between the
 * readings it runs the loop worktree step (`./merge-loop-worktree.ts`),
 * which frees a clean, ended loop worktree holding the head branch and
 * prints one line, or refuses on one that is not. The pull request, its
 * mergeability and its checks come in from `./merge.ts`, which read
 * them; what to refuse on, and in which order, stays `src/pr/merge.ts`'s.
 * A git reading that fails is refused naming what was being read; a
 * head commit this clone does not have is one, and fetching the head
 * branch is the way past it. When nothing is refused, the untracked
 * paths neither tree holds are named in one line and left in place.
 */
import type { MergeSeams } from './merge.js';
import type { PrContext } from './pr-context.js';
import type { ChecksReading, GitRunner, PullRequestDetail, WorktreeEntry } from '../../pr/index.js';

import { CommandExit } from '../../cli/command.js';
import {
  createGitRunner,
  gitSaid,
  parseTreePaths,
  parseWorkingTree,
  parseWorktrees,
  readMergeRefusal,
  untrackedLeftLine,
} from '../../pr/index.js';

import { defaultLoopWorktreeSeams, freeLoopHolderBeforeMerge } from './merge-loop-worktree.js';

/** What {@link refuseFromGit} reaches git, the config and the output through. */
export interface MergeAt { readonly git: GitRunner; readonly pr: PrContext; readonly seams: MergeSeams; readonly info: (line: string) => void }

/** A refusal of `pr merge` with exit code 1. */
function refusal(lines: readonly string[]): CommandExit {
  return new CommandExit(1, lines.join('\n'));
}

/** What git answered, or a refusal naming what was being read and what git said. */
function gitOrRefuse(git: GitRunner, args: readonly string[], doing: string): string {
  const result = git(args);
  if (result.ok) return result.stdout;
  throw refusal([`❌ Could not ${doing}: ${gitSaid(result)}`]);
}

/** The remote whose tracking branch of the base is read. */
const BASE_REMOTE = 'origin';

/**
 * Every path the merge brings in: the pull request's head commit and the
 * base's remote-tracking branch, both read with `git ls-tree`.
 */
function readIncoming(git: GitRunner, detail: PullRequestDetail): readonly string[] {
  const head = gitOrRefuse(
    git,
    ['ls-tree', '-r', '--name-only', detail.headRefOid],
    `read the files of #${detail.number}'s head ${detail.headRefOid} (git fetch ${BASE_REMOTE} ${detail.headRefName} brings it here)`,
  );
  const baseRef = `${BASE_REMOTE}/${detail.baseRefName}`;
  const base = gitOrRefuse(git, ['ls-tree', '-r', '--name-only', baseRef], `read the files of ${baseRef}`);
  return [...parseTreePaths(head), ...parseTreePaths(base)];
}

/** Everything `readMergeRefusal` reads off git, gathered at the project root, the loop worktree step first. */
export function refuseFromGit(merge: MergeAt, detail: PullRequestDetail, checks: ChecksReading, skipChecks: boolean): void {
  const { git, pr, seams } = merge;
  const tree = parseWorkingTree(gitOrRefuse(git, ['status', '--porcelain'], 'read the working tree'));
  const incoming = tree.untracked.length === 0
    ? []
    : readIncoming(git, detail);
  const listed = (): readonly WorktreeEntry[] => parseWorktrees(gitOrRefuse(git, ['worktree', 'list', '--porcelain'], 'list the worktrees'));
  const held = listed();
  const at = gitOrRefuse(git, ['rev-parse', '--show-toplevel'], 'read the repository root').trim();
  const place = { worktrees: held, branch: detail.headRefName, mainCheckout: at, worktreeDir: pr.worktreeDir, planDir: pr.planDir };
  const loopSeams = { ...defaultLoopWorktreeSeams(at), git, gitAt: seams.git ?? createGitRunner };
  const freed = freeLoopHolderBeforeMerge(loopSeams, place, { root: pr.project.root, isAlive: seams.isAlive });
  if (freed.kind === 'refused') throw refusal([`❌ ${freed.message}`]);
  if (freed.kind === 'freed') merge.info(freed.line);
  const worktrees = freed.kind === 'freed'
    ? listed()
    : held;
  const found = readMergeRefusal({
    number: detail.number,
    branch: detail.headRefName,
    base: detail.baseRefName,
    tree,
    incoming,
    merge: { mergeable: detail.mergeable, status: detail.mergeStateStatus },
    checks: checks.verdict,
    rows: checks.rows,
    skipChecks,
    worktrees,
    at,
  });
  if (found !== null) throw refusal([`❌ ${found.message}`]);
  // Past the refusal, no untracked path is one the incoming trees hold.
  const left = untrackedLeftLine(tree.untracked);
  if (left !== null) merge.info(left);
}
